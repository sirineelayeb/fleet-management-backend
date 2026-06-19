'use strict';

// =============================================================================
//  HaulTrack — TrackingService
//  Handles every incoming IoT telemetry frame end-to-end:
//    1. Throttle duplicate frames
//    2. Resolve device → truck, fire health alerts
//    3. Fetch active mission + trip
//    4. Persist location record + update truck snapshot
//    5. Drive mission state machine (start / complete)
//    6. Broadcast real-time events via Socket.IO
// =============================================================================

const Device             = require('../models/Device');
const Truck              = require('../models/Truck');
const Driver             = require('../models/Driver');
const Mission            = require('../models/Mission');
const Shipment           = require('../models/Shipment');
const LocationHistory    = require('../models/LocationHistory');
const TripHistory        = require('../models/TripHistory');
const TripHistoryService = require('./tripHistoryService');
const notificationService = require('./notificationService');

// -----------------------------------------------------------------------------
//  CONSTANTS
// -----------------------------------------------------------------------------
const BATTERY_LOW_PCT      = 20;               // % — fire alert below this
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;   // 5 min gap → device was offline
const DESTINATION_RADIUS_M = 500;             // metres — "arrived" tolerance
const EARTH_RADIUS_KM      = 6371;
const MISSION_START_SPEED  = 5;               // km/h — above this → mission starts
const MISSION_STOP_SPEED   = 5;               // km/h — below this (+ at dest) → completes

// =============================================================================
class TrackingService {

  constructor() {
    // Throttle: skip DB writes that arrive too fast for the same device
    this._lastProcessedAt = new Map();  // deviceId → timestamp ms
    this._THROTTLE_MS     = 3_000;

    // Per-device alert dedup — prevents repeated identical notifications
    this._alertState = new Map();       // deviceId → { lowBatterySent, offlineSent }
  }

  // ===========================================================================
  //  PUBLIC ENTRY POINT
  // ===========================================================================

  /**
   * Process one telemetry frame from a device.
   * Called by the MQTT subscriber whenever a message arrives on fleet/+/gps.
   *
   * @param {object} data  – parsed MQTT payload
   * @param {object} io    – Socket.IO server instance
   * @param {string} source – 'mqtt' | 'api' | etc.
   */
async processTracking(data, io, source = 'mqtt') {
  const {
    deviceId,
    location,
    speed = 0,
    heading = 0,
    batteryLevel,
    firmwareVersion,
    timestamp,
  } = data;

  // ─────────────────────────────────────────────
  // 1. Validate payload
  // ─────────────────────────────────────────────
  if (!deviceId || !location?.lat || !location?.lng) {
    console.warn('[Tracking] Invalid payload');
    return;
  }

  // ─────────────────────────────────────────────
  // 2. Ignore stale messages (VERY IMPORTANT FIX)
  // ─────────────────────────────────────────────
  if (timestamp) {
    const msgTime = new Date(timestamp).getTime();

    // only reject if timestamp is in the FUTURE (bad data)
    if (msgTime > Date.now() + 60_000) {
      return;
    }
  }

  // ─────────────────────────────────────────────
  // 3. Throttle per device
  // ─────────────────────────────────────────────
  if (this._shouldThrottle(deviceId)) {
    return;
  }

  // ─────────────────────────────────────────────
  // 4. Deduplicate GPS (CRITICAL FIX)
  // ─────────────────────────────────────────────
  if (!this._lastGPS) this._lastGPS = new Map();

  const last = this._lastGPS.get(deviceId);

  const isDuplicate =
    last &&
    last.lat === location.lat &&
    last.lng === location.lng &&
    last.speed === speed &&
    last.heading === heading;

  if (isDuplicate) {
    console.log(`[Tracking] Duplicate ignored: ${deviceId}`);
    return;
  }

  this._lastGPS.set(deviceId, {
    lat: location.lat,
    lng: location.lng,
    speed,
    heading,
  });

  try {
    // ─────────────────────────────────────────────
    // 5. Resolve device & truck (NO STATUS CHANGE HERE)
    // ─────────────────────────────────────────────
    const { device, truck } = await this._resolveDeviceAndTruck(
      deviceId,
      batteryLevel,
      firmwareVersion,
      io
    );

    if (!device || !truck) return;

    // ─────────────────────────────────────────────
    // 6. Get mission/trip
    // ─────────────────────────────────────────────
    const { activeMission, activeTrip } =
      await this._getActiveMissionAndTrip(truck._id);

    // ─────────────────────────────────────────────
    // 7. Persist location (ONLY place where lastSeen should update)
    // ─────────────────────────────────────────────
    const locationRecord = await this._persistLocation({
      truck,
      activeMission,
      activeTrip,
      location,
      speed,
      heading,
      batteryLevel,
      timestamp: new Date(), // 🔥 FORCE SERVER TIME (IMPORTANT FIX)
      source,
    });

    // ─────────────────────────────────────────────
    // 8. Mission logic (safe)
    // ─────────────────────────────────────────────
    if (activeMission) {
      await this._handleMissionTransitions({
        truck,
        activeMission,
        activeTrip,
        location,
        speed,
        io,
      });
    }

    // ─────────────────────────────────────────────
    // 9. Emit realtime update
    // ─────────────────────────────────────────────
    this._emitLocationUpdate(
      io,
      truck,
      location,
      speed,
      heading,
      batteryLevel,
      activeMission
    );

    // ─────────────────────────────────────────────
    // 10. Log
    // ─────────────────────────────────────────────
    console.log(
      `[Tracking] ${deviceId} → ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)} ` +
      `@ ${speed} km/h | ${truck.licensePlate} | Mission: ${
        activeMission?.missionNumber ?? 'none'
      }`
    );

    return { locationRecord, truck, activeMission };

  } catch (err) {
    console.error('[Tracking] processTracking error:', err);
    throw err;
  }
}

  // ===========================================================================
  //  STEP 1 — DEVICE + TRUCK RESOLUTION & HEALTH CHECKS
  // ===========================================================================

async _resolveDeviceAndTruck(deviceId, batteryLevel, firmwareVersion, io) {
  const device = await Device.findOne({ deviceId });
  if (!device) return {};

  // ── Early exit — unassigned device, don't update anything ──
  if (!device.truck) return {};

  device.lastSeen = new Date();

  if (batteryLevel !== undefined)    device.batteryLevel    = batteryLevel;
  if (firmwareVersion !== undefined) device.firmwareVersion = firmwareVersion;

  if (device.status !== 'maintenance') {
    device.status = 'active';
  }

  await device.save();

  if (batteryLevel !== undefined) {
    await this._checkLowBattery(device, batteryLevel, io);
  }

  const truck = await Truck.findById(device.truck);
  if (!truck) return {};

  return { device, truck };
}

  // ---------------------------------------------------------------------------

_checkOfflineRecovery(device, deviceId, io) {
    if (!device.lastSeen) return;
    const gapMs      = Date.now() - new Date(device.lastSeen).getTime();
    const wasOffline = gapMs > OFFLINE_THRESHOLD_MS;
    const state      = this._getAlertState(deviceId);

    if (wasOffline && !state.offlineSent) {
      state.offlineSent = true;
      const gapMinutes = Math.round(gapMs / 60_000);
      console.log(`[Tracking] Device ${deviceId} back online after ${gapMinutes} min`);
      // Send notification
      notificationService.createNotification('device_reconnected', {
        deviceId: device.deviceId,
        truckId: device.truck,
        lastSeen: device.lastSeen,
        gapMinutes,
      }, io);
    }
    if (!wasOffline) {
      state.offlineSent = false;
    }
}

  async _checkLowBattery(device, batteryLevel, io) {
    const state = this._getAlertState(device.deviceId);

    if (batteryLevel < BATTERY_LOW_PCT && !state.lowBatterySent) {
      state.lowBatterySent = true;
      await notificationService.createNotification('device_low_battery', {
        deviceId:    device.deviceId,
        truckId:     device.truck,
        batteryLevel,
      }, io);
      console.log(`[Tracking] Low battery: ${device.deviceId} @ ${batteryLevel}%`);
    }

    if (batteryLevel >= BATTERY_LOW_PCT) {
      state.lowBatterySent = false;
    }
  }

  /**
   * Mark truck as in_mission and driver as busy whenever the device is actively
   * pinging.  Idempotent — skips trucks in maintenance / inactive / already set.
   */
  async _markTruckOnline(truckId, io) {
    const truck = await Truck.findById(truckId);
    if (!truck) return;

    if (['maintenance', 'inactive', 'in_mission'].includes(truck.status)) return;

    truck.status = 'in_mission';
    await truck.save();

    if (truck.driver) {
      await Driver.findByIdAndUpdate(truck.driver, { status: 'busy' });
    }

    console.log(`[Tracking] Truck ${truck.licensePlate} → in_mission`);

    io?.to('admin').to('shipment_manager').emit('truck_status_changed', {
      truckId:      truck._id,
      licensePlate: truck.licensePlate,
      status:       'in_mission',
    });
  }

  // ===========================================================================
  //  STEP 2 — ACTIVE MISSION + TRIP
  // ===========================================================================

  async _getActiveMissionAndTrip(truckId) {
    const activeMission = await Mission.findOne({
      truck:  truckId,
      status: { $in: ['not_started', 'in_progress'] },
    }).populate({
      path:   'shipment',
      select: 'shipmentId origin destination destinationCoordinates assignedTo actualDepartureDate',
    });

    if (!activeMission) return { activeMission: null, activeTrip: null };

    const activeTrip = await TripHistory
      .findOne({ mission: activeMission._id, status: { $in: ['planned', 'in_progress'] } })
      .sort({ startTime: -1 });

    return { activeMission, activeTrip };
  }

  // ===========================================================================
  //  STEP 3 — PERSIST LOCATION
  // ===========================================================================

  async _persistLocation({ truck, activeMission, activeTrip, location, speed, heading,
                            batteryLevel, timestamp, source }) {
    const locationRecord = await LocationHistory.create({
      truck:    truck._id,
      mission:  activeMission?._id ?? null,
      trip:     activeTrip?._id    ?? null,
      location: {
        type:        'Point',
        coordinates: [location.lng, location.lat],  // GeoJSON order: [lng, lat]
      },
      speed, heading, batteryLevel,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      source,
    });

    // Keep the truck's "last known" snapshot in sync
    await Truck.findByIdAndUpdate(truck._id, {
      currentLocation: { lat: location.lat, lng: location.lng },
      currentSpeed:    speed,
      lastTelemetryAt: new Date(),
    });

    return locationRecord;
  }

  // ===========================================================================
  //  STEP 4 — MISSION STATE MACHINE
  // ===========================================================================

  async _handleMissionTransitions({ truck, activeMission, activeTrip, location, speed, io }) {
    switch (activeMission.status) {

      case 'not_started':
        if (speed > MISSION_START_SPEED) {
          await this._startMission(truck, activeMission, activeTrip, io);
        }
        break;

      case 'in_progress': {
        const dest = activeMission.shipment?.destinationCoordinates;
        if (!dest?.lat) break;   // no geo-fence configured → can't auto-complete

        if (speed < MISSION_STOP_SPEED && this._isAtDestination(location, dest)) {
          await this._completeMission(truck, activeMission, activeTrip, io);
        }
        break;
      }

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------

  async _startMission(truck, mission, trip, io) {
    const now = new Date();

    mission.status    = 'in_progress';
    mission.startTime = now;
    await mission.save();

    if (trip) {
      trip.status    = 'in_progress';
      trip.startTime = now;
      await trip.save();
    }

    if (mission.shipment) {
      await Shipment.findByIdAndUpdate(mission.shipment._id, {
        status:              'in_progress',
        actualDepartureDate: now,
      });
    }

    await notificationService.createNotification('mission_started', {
      missionNumber:  mission.missionNumber,
      shipmentNumber: mission.shipment?.shipmentId,
      origin:         mission.shipment?.origin,
      destination:    mission.shipment?.destination,
      truckPlate:     truck.licensePlate,
      managerId:      mission.shipment?.assignedTo?.toString() ?? null,
    }, io);

    console.log(`[Mission] ${mission.missionNumber} started — truck ${truck.licensePlate}`);
    this._emitMissionEvent(io, 'mission_started', mission, truck);
  }

  // ---------------------------------------------------------------------------

  async _completeMission(truck, mission, trip, io) {
    const now = new Date();

    mission.status  = 'completed';
    mission.endTime = now;
    await mission.save();

    if (trip) {
      await TripHistoryService.completeTrip(trip._id, now);
    }

    await Truck.findByIdAndUpdate(truck._id, {
      status:       'available',
      currentSpeed: 0,
    });

    await Driver.findByIdAndUpdate(mission.driver, {
      status:        'available',
      assignedTruck: null,
    });

    await Shipment.findByIdAndUpdate(mission.shipment._id, {
      status:             'completed',
      actualDeliveryDate: now,
    });

    await notificationService.createNotification('mission_completed', {
      missionNumber:  mission.missionNumber,
      shipmentNumber: mission.shipment?.shipmentId,
      origin:         mission.shipment?.origin,
      destination:    mission.shipment?.destination,
      truckPlate:     truck.licensePlate,
      distance:       mission.totalDistance,
      managerId:      mission.shipment?.assignedTo?.toString() ?? null,
    }, io);

    console.log(`[Mission] ${mission.missionNumber} completed — truck ${truck.licensePlate}`);
    this._emitMissionEvent(io, 'mission_completed', mission, truck);
  }

  // ===========================================================================
  //  STEP 5 — REAL-TIME SOCKET.IO BROADCASTS
  // ===========================================================================

  _emitLocationUpdate(io, truck, location, speed, heading, batteryLevel, activeMission) {
    if (!io) return;

    // Full payload → admin & shipment-manager dashboards
    io.to('admin').to('shipment_manager').emit('truck_location', {
      truckId:       truck._id,
      licensePlate:  truck.licensePlate,
      location:      { lat: location.lat, lng: location.lng },
      speed, heading,
      batteryLevel,
      status:        truck.status,
      missionId:     activeMission?._id,
      missionNumber: activeMission?.missionNumber,
      shipmentId:    activeMission?.shipment?.shipmentId,
      timestamp:     new Date(),
    });

    // Lightweight payload → driver's own truck room
    io.to(`truck_${truck._id}`).emit('gps_update', {
      location:  { lat: location.lat, lng: location.lng },
      speed, heading,
      timestamp: new Date(),
    });
  }

  _emitMissionEvent(io, event, mission, truck) {
    io?.to('admin').to('shipment_manager').emit(event, {
      missionId:     mission._id,
      missionNumber: mission.missionNumber,
      truckId:       truck._id,
      licensePlate:  truck.licensePlate,
      shipmentId:    mission.shipment?.shipmentId,
    });
  }

  // ===========================================================================
  //  PRIVATE HELPERS
  // ===========================================================================

  _getAlertState(deviceId) {
    if (!this._alertState.has(deviceId)) {
      this._alertState.set(deviceId, { lowBatterySent: false, offlineSent: false });
    }
    return this._alertState.get(deviceId);
  }

  _shouldThrottle(deviceId) {
    const now  = Date.now();
    const last = this._lastProcessedAt.get(deviceId) ?? 0;
    if (now - last < this._THROTTLE_MS) return true;

    this._lastProcessedAt.set(deviceId, now);

    // Evict stale entries so the Map doesn't grow unbounded in large fleets
    if (this._lastProcessedAt.size > 1_000) {
      const cutoff = now - 10 * 60_000;
      for (const [id, ts] of this._lastProcessedAt) {
        if (ts < cutoff) this._lastProcessedAt.delete(id);
      }
    }

    return false;
  }

  // Haversine formula — returns distance in kilometres
  _calculateDistanceKm(lat1, lng1, lat2, lng2) {
    if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
    const toRad = (d) => d * Math.PI / 180;
    const dLat  = toRad(lat2 - lat1);
    const dLng  = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  _isAtDestination(currentLocation, destinationCoords) {
    if (!destinationCoords?.lat) return false;
    const distanceM = this._calculateDistanceKm(
      currentLocation.lat, currentLocation.lng,
      destinationCoords.lat, destinationCoords.lng
    ) * 1_000;
    console.log("DISTANCE =", distanceM);
    return distanceM <= DESTINATION_RADIUS_M;
  }

  // ===========================================================================
  //  QUERY HELPERS  (called by controllers / other services)
  // ===========================================================================

  async getTruckHistory(truckId, { limit = 100, startDate = null, endDate = null } = {}) {
    const query = { truck: truckId };
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate)   query.timestamp.$lte = new Date(endDate);
    }
    return LocationHistory.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('trip mission');
  }

  async getMissionHistory(missionId, { limit = 500 } = {}) {
    return LocationHistory.find({ mission: missionId })
      .sort({ timestamp: 1 })
      .limit(limit)
      .populate('truck');
  }

  async getShipmentLocation(shipmentId) {
    const shipment = await Shipment.findById(shipmentId).populate('truck');
    if (!shipment?.truck) return null;
    const { truck } = shipment;
    return {
      lat:        truck.currentLocation?.lat,
      lng:        truck.currentLocation?.lng,
      speed:      truck.currentSpeed,
      lastUpdate: truck.lastTelemetryAt,
      status:     truck.status,
    };
  }
}

// Export a singleton — one instance owns all throttle/alert state across the app
module.exports = new TrackingService();
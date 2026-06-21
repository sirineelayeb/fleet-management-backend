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
const BATTERY_RESET_PCT    = 25;               // % — reset alert only above this (hysteresis)
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;   // 5 min gap → device was offline
const STALE_MS             = 5 * 60 * 1000;   // reject timestamps older than 5 min
const DESTINATION_RADIUS_M = 500;             // metres — "arrived" tolerance
const DUPLICATE_DISTANCE_M = 10;              // treat as same location if within 10m
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

    // Last known GPS (for duplicate detection)
    this._lastGPS = new Map();          // deviceId → { lat, lng, speed, heading, timestamp }
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
      timestamp, // device-provided timestamp (optional)
    } = data;

    // ─────────────────────────────────────────────
    // 1. Validate payload
    // ─────────────────────────────────────────────
    if (!deviceId || !location?.lat || !location?.lng) {
      console.warn('[Tracking] Invalid payload');
      return;
    }

    // ─────────────────────────────────────────────
    // 2. Reject stale messages (too old or too future)
    // ─────────────────────────────────────────────
    if (timestamp) {
      const msgTime = new Date(timestamp).getTime();
      const now = Date.now();

      // Reject if timestamp is more than STALE_MS in the past OR >60s in the future
      if (msgTime < now - STALE_MS || msgTime > now + 60_000) {
        console.log(`[Tracking] Ignored stale/future timestamp for ${deviceId}: ${timestamp}`);
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
    // 4. Deduplicate GPS (within 10m, same speed & heading)
    // ─────────────────────────────────────────────
    const last = this._lastGPS.get(deviceId);
    let isDuplicate = false;
    if (last) {
      const distance = this._calculateDistanceKm(
        last.lat, last.lng,
        location.lat, location.lng
      ) * 1000; // to metres
      isDuplicate = (
        distance <= DUPLICATE_DISTANCE_M &&
        Math.abs(last.speed - speed) < 0.1 &&
        Math.abs(last.heading - heading) < 1.0
      );
    }

    if (isDuplicate) {
      console.log(`[Tracking] Duplicate GPS ignored: ${deviceId}`);
      return;
    }

    // Store this GPS for future dedup
    this._lastGPS.set(deviceId, {
      lat: location.lat,
      lng: location.lng,
      speed,
      heading,
      timestamp: Date.now(),
    });

    // Clean up _lastGPS periodically
    if (this._lastGPS.size > 1000) {
      const cutoff = Date.now() - 10 * 60_000;
      for (const [id, data] of this._lastGPS) {
        if (data.timestamp < cutoff) this._lastGPS.delete(id);
      }
    }

    try {
      // ─────────────────────────────────────────────
      // 5. Resolve device & truck, fire health alerts
      // ─────────────────────────────────────────────
      const { device, truck } = await this._resolveDeviceAndTruck(
        deviceId,
        batteryLevel,
        firmwareVersion,
        io
      );

      if (!device || !truck) return;

      // ─────────────────────────────────────────────
      // 6. Get active mission/trip
      // ─────────────────────────────────────────────
      const { activeMission, activeTrip } =
        await this._getActiveMissionAndTrip(truck._id);

      // ─────────────────────────────────────────────
      // 7. Persist location (server time, but keep device timestamp separately)
      // ─────────────────────────────────────────────
      const locationRecord = await this._persistLocation({
        truck,
        activeMission,
        activeTrip,
        location,
        speed,
        heading,
        batteryLevel,
        deviceTimestamp: timestamp ? new Date(timestamp) : null,
        source,
      });
      if (speed > 0) {
        const truckService = require('./truckService');
        await truckService.checkSpeedViolation(truck._id, speed, location, io);
      }


      // ─────────────────────────────────────────────
      // 8. Mission logic (only if truck is not in maintenance)
      // ─────────────────────────────────────────────
      if (activeMission && truck.status !== 'maintenance') {
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

    // Capture previous lastSeen for offline detection
    const prevLastSeen = device.lastSeen;

    // Update device fields
    device.lastSeen = new Date();
    if (batteryLevel !== undefined)    device.batteryLevel    = batteryLevel;
    if (firmwareVersion !== undefined) device.firmwareVersion = firmwareVersion;
    if (device.status !== 'maintenance') {
      device.status = 'active';
    }
    await device.save();

    // Health checks
    if (batteryLevel !== undefined) {
      await this._checkLowBattery(device, batteryLevel, io);
    }

    // Offline recovery detection (uses previous lastSeen)
    if (prevLastSeen) {
      this._checkOfflineRecovery(device, prevLastSeen, io);
    }

    const truck = await Truck.findById(device.truck);
    if (!truck) return {};

    return { device, truck };
  }

  // ---------------------------------------------------------------------------

  _checkOfflineRecovery(device, prevLastSeen, io) {
    const gapMs = Date.now() - new Date(prevLastSeen).getTime();
    const wasOffline = gapMs > OFFLINE_THRESHOLD_MS;
    const state = this._getAlertState(device.deviceId);

    if (wasOffline && !state.offlineSent) {
      state.offlineSent = true;
      const gapMinutes = Math.round(gapMs / 60_000);
      console.log(`[Tracking] Device ${device.deviceId} back online after ${gapMinutes} min`);
      // Send notification (catch errors)
      notificationService.createNotification('device_reconnected', {
        deviceId: device.deviceId,
        truckId: device.truck,
        lastSeen: device.lastSeen,
        gapMinutes,
      }, io).catch(err => console.error('[Notif] Offline recovery notification failed:', err));
    }
    if (!wasOffline) {
      state.offlineSent = false;
    }
  }

  async _checkLowBattery(device, batteryLevel, io) {
    const state = this._getAlertState(device.deviceId);

    // Send alert when battery drops below threshold and not already sent
    if (batteryLevel < BATTERY_LOW_PCT && !state.lowBatterySent) {
      state.lowBatterySent = true;
      await notificationService.createNotification('device_low_battery', {
        deviceId:    device.deviceId,
        truckId:     device.truck,
        batteryLevel,
      }, io).catch(err => console.error('[Notif] Low battery notification failed:', err));
      console.log(`[Tracking] Low battery: ${device.deviceId} @ ${batteryLevel}%`);
    }

    // Reset alert only when battery rises above BATTERY_RESET_PCT (hysteresis)
    if (batteryLevel >= BATTERY_RESET_PCT) {
      state.lowBatterySent = false;
    }
  }

  /**
   * Mark truck as in_mission and driver as busy. Idempotent.
   * Now actually called during mission start.
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
                            batteryLevel, deviceTimestamp, source }) {
    const locationRecord = await LocationHistory.create({
      truck:    truck._id,
      mission:  activeMission?._id ?? null,
      trip:     activeTrip?._id    ?? null,
      location: {
        type:        'Point',
        coordinates: [location.lng, location.lat],  // GeoJSON order: [lng, lat]
      },
      speed, heading, batteryLevel,
      timestamp: new Date(),                 // server time (for indexing)
      deviceTimestamp,                       // store original if provided
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
  //  STEP 4 — MISSION STATE MACHINE (with atomic updates)
  // ===========================================================================

  async _handleMissionTransitions({ truck, activeMission, activeTrip, location, speed, io }) {
    switch (activeMission.status) {

      case 'not_started':
        if (speed > MISSION_START_SPEED) {
          await this._startMission(truck, activeMission, activeTrip, io);
        }
        break;

      case 'in_progress': {
        console.log("========== MISSION CHECK ==========");
        console.log("Mission:", activeMission.missionNumber);
        console.log("Mission status:", activeMission.status);
        console.log("Shipment status:", activeMission.shipment?.status);
        console.log("Speed:", speed);

        const dest = activeMission.shipment?.destinationCoordinates;

        console.log("Destination:", dest);

        if (!dest?.lat) {
          console.log("NO DESTINATION COORDINATES");
          break;
        }

        const atDest = this._isAtDestination(location, dest);

        if (atDest && speed <= MISSION_STOP_SPEED) {
          console.log("AT DESTINATION → COMPLETING MISSION");
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
    console.log("ENTERING START MISSION");

    const now = new Date();

    // Atomic update: only start if still not_started
    const updatedMission = await Mission.findOneAndUpdate(
      { _id: mission._id, status: 'not_started' },
      { status: 'in_progress', startTime: now },
      { new: true }
    );

    if (!updatedMission) {
      console.log(`[Mission] ${mission.missionNumber} already started by another process.`);
      return;
    }

    // Update trip if exists
    if (trip) {
      await TripHistory.findOneAndUpdate(
        { _id: trip._id, status: 'planned' },
        { status: 'in_progress', startTime: now }
      );
    }

    // ── USE ORIGINAL (populated) mission for shipment update ──
    if (mission.shipment) {
      await Shipment.findByIdAndUpdate(mission.shipment._id, {
        status: 'in_progress',
        actualDepartureDate: now,
      });
    }

    // Mark truck and driver as online/busy
    await this._markTruckOnline(truck._id, io);

    // ── USE ORIGINAL mission for notification ──
    await notificationService.createNotification('mission_started', {
      missionNumber:  mission.missionNumber,
      shipmentNumber: mission.shipment?.shipmentId,
      origin:         mission.shipment?.origin,
      destination:    mission.shipment?.destination,
      truckPlate:     truck.licensePlate,
      managerId:      mission.shipment?.assignedTo?.toString() ?? null,
    }, io).catch(err => console.error('[Notif] Mission start notification failed:', err));

    console.log(`[Mission] ${updatedMission.missionNumber} started — truck ${truck.licensePlate}`);
    this._emitMissionEvent(io, 'mission_started', updatedMission, truck);
  }

  // ---------------------------------------------------------------------------

async _completeMission(truck, mission, trip, io) {
  const now = new Date();

  const updatedMission = await Mission.findOneAndUpdate(
    { _id: mission._id, status: 'in_progress' },
    { status: 'completed', endTime: now },
    { new: true }
  );
  if (!updatedMission) return;

  if (mission.shipment) {
    await Shipment.findByIdAndUpdate(mission.shipment._id, {
      status: 'completed',
      actualDeliveryDate: now,
    });
  }

  if (trip) await TripHistoryService.completeTrip(trip._id, now);

  const completedTrip = await TripHistory.findById(trip?._id).select('actualDistanceKm');

  await Truck.findByIdAndUpdate(truck._id, { status: 'available', currentSpeed: 0 });

  if (updatedMission.driver) {
    await Driver.findByIdAndUpdate(updatedMission.driver, { status: 'available' });
  }

  // Single notification, after everything is done
  await notificationService.createNotification('mission_completed', {
    missionNumber:  mission.missionNumber,
    shipmentNumber: mission.shipment?.shipmentId,
    truckPlate:     truck.licensePlate,
    distance:       parseFloat((completedTrip?.actualDistanceKm ?? 0).toFixed(2)),
    managerId:      mission.shipment?.assignedTo?.toString() ?? null,
  }, io).catch(err => console.error('[Notif] Mission complete notification failed:', err));

  console.log(`[Mission] ${updatedMission.missionNumber} completed — truck ${truck.licensePlate}`);
  this._emitMissionEvent(io, 'mission_completed', updatedMission, truck);
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
    if (
      !currentLocation?.lat ||
      !currentLocation?.lng ||
      !destinationCoords?.lat ||
      !destinationCoords?.lng
    ) return false;

    const distanceM = this._calculateDistanceKm(
      currentLocation.lat,
      currentLocation.lng,
      destinationCoords.lat,
      destinationCoords.lng
    ) * 1000;

    console.log("DISTANCE =", distanceM.toFixed(2), "m");

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
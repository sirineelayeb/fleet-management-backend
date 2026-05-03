const Device              = require('../models/Device');
const Truck               = require('../models/Truck');
const LocationHistory     = require('../models/LocationHistory');
const Mission             = require('../models/Mission');
const TripHistory         = require('../models/TripHistory');
const Shipment            = require('../models/Shipment');
const Driver              = require('../models/Driver');
const TripHistoryService  = require('./tripHistoryService');
const notificationService = require('./notificationService'); 

// ─── Thresholds ───────────────────────────────────────────────────────────────

const BATTERY_LOW_PCT      = 20;               // fire device_low_battery below this %
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;   // 5 min without ping = was offline

// ─────────────────────────────────────────────────────────────────────────────

class TrackingService {
  constructor() {
    this._lastProcessed    = new Map(); // deviceId → last write timestamp (ms)
    this._THROTTLE_MS      = 3000;      // min 3s between DB writes per device

    /**
     * Per-device alert dedup — prevents spamming the same notification
     * every 3 seconds while the condition persists.
     * Resets automatically when the condition clears.
     */
    this._deviceAlertState = new Map(); // deviceId → { lowBatterySent, offlineSent }
  }

  // ─── Public entry point ───────────────────────────────────────────────────

  async processTracking(data, io, source = 'unknown') {
    const {
      deviceId,
      location,
      speed        = 0,
      heading      = 0,
      batteryLevel,
      temperature,
      timestamp
    } = data;

    if (this._shouldThrottle(deviceId)) {
      console.log(`⏭️  Throttled: ${deviceId}`);
      return;
    }

    try {
      // Step 1: resolve device + truck, fire device-health notifications
      const { device, truck } = await this._resolveDeviceAndTruck(
        deviceId, batteryLevel, temperature, io
      );
      if (!device || !truck) return;

      // Step 2: find active mission + trip
      const { activeMission, activeTrip } = await this._getActiveMissionAndTrip(truck._id);

      // Step 3: write location to DB + update truck state
      const locationRecord = await this._updateLocation({
        truck, activeMission, activeTrip,
        location, speed, heading, batteryLevel, temperature, timestamp, source
      });

      // Step 4: mission state machine (start / complete)
      if (activeMission) {
        await this._handleMissionTransitions({
          truck, activeMission, activeTrip, location, speed, io
        });
      }

      // Step 5: emit real-time update to relevant rooms
      this._emitLocationUpdate(
        io, truck, location, speed, heading, batteryLevel, temperature, activeMission
      );

      console.log(
        `📍 ${deviceId} → ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` +
        ` @ ${speed}km/h | Truck: ${truck.licensePlate}` +
        ` | Mission: ${activeMission?.missionNumber || 'None'}`
      );

      return { locationRecord, truck, activeMission };

    } catch (error) {
      console.error('❌ Error in processTracking:', error);
      throw error;
    }
  }

  // ─── Step 1: Device resolution + health notifications ────────────────────

  async _resolveDeviceAndTruck(deviceId, batteryLevel, temperature, io) {
    const device = await Device.findOne({ deviceId });
    if (!device) {
      console.log(`⚠️ Device not found: ${deviceId}`);
      return {};
    }

    const alertState = this._getAlertState(deviceId);

    // ── Offline reconnect: check gap BEFORE updating lastSeen ──────────────
    // If lastSeen was stale the device was offline — fire once on reconnect.
    // The watchdog job handles the "still offline, no ping arriving" path.
    if (device.lastSeen) {
      const gapMs      = Date.now() - new Date(device.lastSeen).getTime();
      const wasOffline = gapMs > OFFLINE_THRESHOLD_MS;

      if (wasOffline && !alertState.offlineSent) {
        alertState.offlineSent = true;
        await notificationService.createNotification('device_reconnected', {
          deviceId:   device.deviceId,
          truckId:    device.truck,
          lastSeen:   device.lastSeen,
          gapMinutes: Math.round(gapMs / 60000),
        }, io);
        console.log(`📡 Device ${deviceId} back online after ${Math.round(gapMs / 60000)} min`);
      }

      if (!wasOffline) {
        alertState.offlineSent = false;
      }
    }

    // lastSeen update triggers pre('save') → status becomes 'active' automatically ✅
    device.lastSeen = new Date();

    // ── Persist latest telemetry ───────────────────────────────────────────
    device.lastSeen = new Date();
    if (batteryLevel !== undefined) device.batteryLevel = batteryLevel;
    if (temperature  !== undefined) device.temperature  = temperature;
    await device.save();

    // ── Low battery: check AFTER saving so DB reflects latest value ────────
    if (batteryLevel !== undefined) {
      if (batteryLevel < BATTERY_LOW_PCT && !alertState.lowBatterySent) {
        alertState.lowBatterySent = true;
        await notificationService.createNotification('device_low_battery', {
          deviceId:    device.deviceId,
          truckId:     device.truck,
          batteryLevel,
        }, io);
        console.log(`🔋 Device ${deviceId} low battery: ${batteryLevel}%`);
      }

      if (batteryLevel >= BATTERY_LOW_PCT) {
        alertState.lowBatterySent = false; // battery recovered — allow next alert
      }
    }

    // ── Resolve truck ──────────────────────────────────────────────────────
    if (!device.truck) {
      console.log(`⚠️ No truck assigned to device: ${deviceId}`);
      return {};
    }

    const truck = await Truck.findById(device.truck);
    if (!truck) {
      console.log(`⚠️ Truck not found for device: ${deviceId}`);
      return {};
    }

    return { device, truck };
  }

  // ─── Step 2: Active mission + trip ────────────────────────────────────────

  async _getActiveMissionAndTrip(truckId) {
    const activeMission = await Mission.findOne({
      truck:  truckId,
      status: { $in: ['not_started', 'in_progress'] }
    }).populate('shipment');

    let activeTrip = null;
    if (activeMission) {
      activeTrip = await TripHistory.findOne({
        mission: activeMission._id,
        status:  { $in: ['planned', 'in_progress'] }
      }).sort({ startTime: -1 });
    }

    return { activeMission, activeTrip };
  }

  // ─── Step 3: Persist location ─────────────────────────────────────────────

  async _updateLocation({
    truck, activeMission, activeTrip,
    location, speed, heading, batteryLevel, temperature, timestamp, source
  }) {
    const locationRecord = await LocationHistory.create({
      truck:    truck._id,
      trip:     activeTrip?._id    || null,
      mission:  activeMission?._id || null,
      location: {
        type:        'Point',
        coordinates: [location.lng, location.lat] // GeoJSON: [lng, lat]
      },
      speed, heading, batteryLevel, temperature,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      source
    });

    truck.currentLocation = { lat: location.lat, lng: location.lng };
    truck.currentSpeed    = speed;
    truck.lastTelemetryAt = new Date();
    await truck.save();

    return locationRecord;
  }

  // ─── Step 4: Mission state machine ────────────────────────────────────────

  async _handleMissionTransitions({ truck, activeMission, activeTrip, location, speed, io }) {
    // Truck started moving → start mission
    if (activeMission.status === 'not_started' && speed > 5) {
      await this._startMission(truck, activeMission, activeTrip, io);
      return;
    }

    // Truck stopped near destination → complete mission
    if (activeMission.status === 'in_progress' && activeMission.shipment) {
      const dest = activeMission.shipment.destinationCoordinates;

      if (!dest?.lat) {
        // No coordinates — auto-complete impossible.
        // Admin uses force-complete from the dashboard.
        return;
      }

      if (speed < 5 && this.isAtDestination(location, dest)) {
        await this._completeMission(truck, activeMission, activeTrip, io);
      }
    }
  }

  async _startMission(truck, mission, trip, io) {
    mission.status    = 'in_progress';
    mission.startTime = new Date();
    await mission.save();

    if (trip) {
      trip.status    = 'in_progress';
      trip.startTime = new Date();
      await trip.save();
    }

    if (mission.shipment) {
      await Shipment.findByIdAndUpdate(mission.shipment._id, {
        status:              'in_progress',
        actualDepartureDate: new Date()
      });
    }

    // ✅ Get the assigned manager from the shipment
    const shipment = await Shipment.findById(mission.shipment._id).select('assignedTo');
    const managerId = shipment?.assignedTo?.toString() || null;

    await notificationService.createNotification('mission_started', {
      shipmentNumber: mission.shipment?.shipmentId,
      origin:         mission.shipment?.origin,
      destination:    mission.shipment?.destination,
      truckPlate:     truck.licensePlate,
      missionNumber:  mission.missionNumber,
      managerId,      // ← pass the specific manager
    }, io);

    console.log(`🚛 Mission ${mission.missionNumber} started for truck ${truck.licensePlate}`);
    this._emitMissionEvent(io, 'mission_started', mission, truck);
  }

  async _completeMission(truck, mission, trip, io) {
    mission.status  = 'completed';
    mission.endTime = new Date();
    await mission.save();

    if (trip) {
      await TripHistoryService.completeTrip(trip._id, new Date());
    }

    truck.status       = 'available';
    truck.currentSpeed = 0;
    await truck.save();

    await Driver.findByIdAndUpdate(mission.driver, {
      status:        'available',
      assignedTruck: null
    });

    await Shipment.findByIdAndUpdate(mission.shipment._id, {
      status:             'completed',
      actualDeliveryDate: new Date()
    });

    // Persist to DB (bell icon) + emit to dashboard rooms
    await notificationService.createNotification('mission_completed', {
      shipmentNumber: mission.shipment?.shipmentId,
      origin:         mission.shipment?.origin,
      destination:    mission.shipment?.destination,
      truckPlate:     truck.licensePlate,
      missionNumber:  mission.missionNumber,
      distance:       mission.totalDistance,
      managerId, 
    }, io);

    console.log(`✅ Mission ${mission.missionNumber} completed for truck ${truck.licensePlate}`);
    this._emitMissionEvent(io, 'mission_completed', mission, truck);
  }

  // ─── Step 5: Real-time emit ───────────────────────────────────────────────

  _emitMissionEvent(io, event, mission, truck) {
    if (!io) return;
    io.to('admin').to('shipment_manager').emit(event, {
      missionId:     mission._id,
      missionNumber: mission.missionNumber,
      truckId:       truck._id,
      licensePlate:  truck.licensePlate,
      shipmentId:    mission.shipment?.shipmentId
    });
  }

  _emitLocationUpdate(io, truck, location, speed, heading, batteryLevel, temperature, activeMission) {
    if (!io) return;

    const payload = {
      truckId:       truck._id,
      licensePlate:  truck.licensePlate,
      location:      { lat: location.lat, lng: location.lng },
      speed,
      heading,
      timestamp:     new Date(),
      batteryLevel,
      temperature,
      status:        truck.status,
      missionId:     activeMission?._id,
      missionNumber: activeMission?.missionNumber,
      shipmentId:    activeMission?.shipment?.shipmentId
    };

    const adminRoom          = io.sockets.adapter.rooms.get('admin');
    const shipmentManagerRoom = io.sockets.adapter.rooms.get('shipment_manager');

    if ((adminRoom?.size || 0) > 0 || (shipmentManagerRoom?.size || 0) > 0) {
      io.to('admin').to('shipment_manager').emit('truck_location', payload);
      console.log(`✅ Emitted truck_location to admin and shipment_manager rooms`);
    } else {
      console.log(`⚠️ No clients in admin or shipment_manager rooms, skipping emit`);
    }

    // Per-truck room for driver's own view
    io.to(`truck_${truck._id}`).emit('gps_update', {
      location:  { lat: location.lat, lng: location.lng },
      speed,
      heading,
      timestamp: new Date()
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _getAlertState(deviceId) {
    if (!this._deviceAlertState.has(deviceId)) {
      this._deviceAlertState.set(deviceId, { lowBatterySent: false, offlineSent: false });
    }
    return this._deviceAlertState.get(deviceId);
  }

  _shouldThrottle(deviceId) {
    const now  = Date.now();
    const last = this._lastProcessed.get(deviceId) || 0;
    if (now - last < this._THROTTLE_MS) return true;
    this._lastProcessed.set(deviceId, now);

    // Evict stale entries to prevent unbounded Map growth
    if (this._lastProcessed.size > 1000) {
      const cutoff = now - 10 * 60 * 1000;
      for (const [id, ts] of this._lastProcessed) {
        if (ts < cutoff) this._lastProcessed.delete(id);
      }
    }

    return false;
  }

  isAtDestination(currentLocation, destinationCoordinates) {
    if (!destinationCoordinates?.lat) return false;
    return this.calculateDistance(
      currentLocation.lat, currentLocation.lng,
      destinationCoordinates.lat, destinationCoordinates.lng
    ) * 1000 <= 100; // km → meters, threshold 100m
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─── Query helpers ────────────────────────────────────────────────────────

  async getTruckHistory(truckId, limit = 100, startDate = null, endDate = null) {
    const query = { truck: truckId };
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate)   query.timestamp.$lte = new Date(endDate);
    }
    return LocationHistory.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('trip')
      .populate('mission');
  }

  async getMissionHistory(missionId, limit = 500) {
    return LocationHistory.find({ mission: missionId })
      .sort({ timestamp: 1 })
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
      status:     truck.status
    };
  }
}

module.exports = new TrackingService();
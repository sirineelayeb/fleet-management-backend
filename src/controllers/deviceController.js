const Device = require('../models/Device');
const LocationHistory = require('../models/LocationHistory');
const Truck = require('../models/Truck');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const Shipment = require('../models/Shipment');
const Driver = require('../models/Driver');
const Gate = require('../models/Gate');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notificationService');
const tripHistoryService = require('../services/tripHistoryService');
const driverService = require('../services/driverService');

// Configuration
const CONFIG = {
  AUTO_START_SPEED_THRESHOLD: 5,      // km/h
  AUTO_COMPLETE_DISTANCE_KM: 0.1,     // 100 meters
  AUTO_COMPLETE_DEBOUNCE_COUNT: 2,    // consecutive points required
  SPEED_LIMIT_ALERT: 80,              // km/h
  DEBOUNCE_TIMEOUT_MS: 10 * 60 * 1000 // 10 minutes
};

// State maps (per truck)
const truckGateState = new Map();          // { gateId }
const autoCompleteDebounce = new Map();    // { count, lastTimestamp }

class DeviceController {
  
  // ============================================================
  // MAIN TRACKING HANDLER
  // ============================================================
  handleTrackingData = catchAsync(async (req, res) => {
    const { deviceId, location, speed = 0, heading = 0, temperature, batteryLevel } = req.body;
    const io = req.app.get('io');

    // 1. Validate device & truck
    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const truck = await Truck.findById(device.truck);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    // 2. Get active mission and trip
    const mission = await Mission.findOne({
      truck: truck._id,
      status: { $in: ['not_started', 'in_progress'] }
    }).populate('shipment');
    const trip = mission ? await TripHistory.findOne({ mission: mission._id }) : null;

    // 3. Save location point
    await LocationHistory.create({
      truck: truck._id,
      trip: trip?._id || null,
      mission: mission?._id || null,
      location: { type: 'Point', coordinates: [location.lng, location.lat] },
      speed, heading, batteryLevel, temperature,
      timestamp: new Date(),
      source: 'device'
    });

    // 4. Update truck live data
    truck.currentLocation = { lat: location.lat, lng: location.lng };
    truck.currentSpeed = speed;
    truck.lastTelemetryAt = new Date();
    await truck.save();

    // 5. Real‑time location event
    if (io) {
      io.emit('truck_location', {
        truckId: truck._id,
        licensePlate: truck.licensePlate,
        location: { lat: location.lat, lng: location.lng },
        speed,
        timestamp: new Date()
      });
    }

    // 6. Gate geofencing (loading zones)
    await this.processGateGeofencing(truck, location, io);

    // 7. Speed alert
    if (speed > CONFIG.SPEED_LIMIT_ALERT) {
      await notificationService.createNotification('speed_violation', {
        licensePlate: truck.licensePlate,
        speed
      }, io);
    }

    // 8. No active mission – just update device and exit
    if (!mission) {
      await this.updateDeviceStatus(device, batteryLevel);
      return res.json({ success: true, message: 'No active mission' });
    }

    // 9. Auto‑start mission if moving
    if (mission.status === 'not_started' && speed > CONFIG.AUTO_START_SPEED_THRESHOLD) {
      await this.startMission(mission, trip, truck, io);
    }

    // 10. Update max speed for trip
    if (trip && mission.status === 'in_progress' && speed > (trip.maxSpeed || 0)) {
      trip.maxSpeed = speed;
      await trip.save();
    }

    // 11. Auto‑complete mission if near destination and stopped
    if (mission.status === 'in_progress' && mission.shipment?.destinationCoordinates) {
      await this.autoCompleteMission(mission, trip, truck, location, speed, io);
    }

    // 12. Update device lastSeen & battery
    await this.updateDeviceStatus(device, batteryLevel);

    res.json({ success: true });
  });

  // ============================================================
  // GATE GEOFENCING
  // ============================================================
  async processGateGeofencing(truck, location, io) {
    const gates = await Gate.find({ isActive: true, isLoadingZone: true });
    let currentGate = null;
    for (const gate of gates) {
      if (!gate.location) continue;
      const dist = this.calculateDistance(
        { lat: location.lat, lng: location.lng },
        { lat: gate.location.lat, lng: gate.location.lng }
      );
      if (dist <= (gate.radiusMeters / 1000)) {
        currentGate = gate;
        break;
      }
    }

    const truckId = truck._id.toString();
    const prevGateId = truckGateState.get(truckId)?.gateId;

    if (!prevGateId && currentGate) {
      await this.handleLoadingZoneTransition(truck, currentGate, true, io);
      truckGateState.set(truckId, { gateId: currentGate._id });
    } else if (prevGateId && !currentGate) {
      const prevGate = await Gate.findById(prevGateId);
      if (prevGate) await this.handleLoadingZoneTransition(truck, prevGate, false, io);
      truckGateState.delete(truckId);
    } else if (prevGateId && currentGate && prevGateId !== currentGate._id) {
      const oldGate = await Gate.findById(prevGateId);
      if (oldGate) await this.handleLoadingZoneTransition(truck, oldGate, false, io);
      await this.handleLoadingZoneTransition(truck, currentGate, true, io);
      truckGateState.set(truckId, { gateId: currentGate._id });
    }
  }

  async handleLoadingZoneTransition(truck, gate, isEntry, io) {
    if (!gate.isLoadingZone) return;

    const mission = await Mission.findOne({ truck: truck._id, status: 'in_progress' });
    if (!mission) return;

    const shipment = await Shipment.findById(mission.shipment);
    if (!shipment) return;

    if (isEntry) {
      if (!shipment.loadingStartedAt) {
        shipment.loadingStartedAt = new Date();
        await shipment.save();
        if (io) io.emit('loading_started', { truck: truck.licensePlate, gate: gate.name, startedAt: shipment.loadingStartedAt });
      }
    } else {
      if (shipment.loadingStartedAt && !shipment.loadingCompletedAt) {
        shipment.loadingCompletedAt = new Date();
        shipment.actualLoadingDurationMinutes = (shipment.loadingCompletedAt - shipment.loadingStartedAt) / (1000 * 60);
        await shipment.save();

        const overtime = shipment.actualLoadingDurationMinutes - (shipment.plannedLoadingDurationMinutes || 0);
        if (overtime > 0) {
          await notificationService.createNotification('loading_overtime', {
            truckLicense: truck.licensePlate,
            gateName: gate.name,
            plannedMinutes: shipment.plannedLoadingDurationMinutes,
            actualMinutes: shipment.actualLoadingDurationMinutes,
            overtimeMinutes: overtime
          }, io);
        }

        if (io) io.emit('loading_completed', { truck: truck.licensePlate, gate: gate.name, completedAt: shipment.loadingCompletedAt, actualDurationMinutes: shipment.actualLoadingDurationMinutes });
      }
    }
  }

  // ============================================================
  // MISSION LIFECYCLE HELPERS
  // ============================================================
  async startMission(mission, trip, truck, io) {
    mission.status = 'in_progress';
    mission.startTime = new Date();
    await mission.save();

    if (mission.shipment) {
      mission.shipment.actualDepartureDate = new Date();
      mission.shipment.status = 'in_progress';
      await mission.shipment.save();
    }

    if (trip) {
      trip.status = 'in_progress';
      trip.actualStartTime = new Date();
      await trip.save();
    }

    truck.status = 'in_mission';
    await truck.save();

    const driver = await Driver.findById(mission.driver);
    if (driver) {
      driver.status = 'busy';
      await driver.save();
    }

    if (io) {
      io.emit('mission_started', {
        missionId: mission._id,
        truckId: truck._id,
        shipmentId: mission.shipment?._id,
        startTime: mission.startTime
      });
    }
  }

  async autoCompleteMission(mission, trip, truck, location, speed, io) {
    const dist = this.calculateDistance(
      { lat: location.lat, lng: location.lng },
      mission.shipment.destinationCoordinates
    );
    const isStopped = speed === 0;
    const isNear = dist < CONFIG.AUTO_COMPLETE_DISTANCE_KM;

    const truckId = truck._id.toString();
    const now = Date.now();
    let debounce = autoCompleteDebounce.get(truckId) || { count: 0, lastTimestamp: now };

    // Reset debounce if conditions not met
    if (!isNear || !isStopped) {
      if (debounce.count > 0) autoCompleteDebounce.delete(truckId);
      return;
    }

    // Increment counter
    debounce.count++;
    debounce.lastTimestamp = now;
    autoCompleteDebounce.set(truckId, debounce);

    // Check if enough consecutive points
    if (debounce.count >= CONFIG.AUTO_COMPLETE_DEBOUNCE_COUNT) {
      if (mission.status !== 'in_progress') return;
      if (!trip) {
        console.error(`No trip found for mission ${mission._id} – auto‑complete aborted`);
        return;
      }

      await tripHistoryService.completeTrip(trip._id, new Date());

      mission.status = 'completed';
      mission.endTime = new Date();
      await mission.save();

      if (mission.shipment) {
        mission.shipment.actualDeliveryDate = new Date();
        mission.shipment.status = 'completed';
        await mission.shipment.save();
          try {
                await driverService.updateDriverScoreForMission(mission._id, mission.shipment.actualDeliveryDate);
              } catch (err) {
                console.error('Failed to update driver score for mission', mission._id, err);
              }
            }

            truck.status = 'available';
            await truck.save();

            const driver = await Driver.findById(mission.driver);
            if (driver) {
              driver.status = 'available';
              await driver.save();
      }

      truck.status = 'available';
      await truck.save();

      

      if (io) {
        io.emit('mission_completed', {
          missionId: mission._id,
          truckId: truck._id,
          shipmentId: mission.shipment?._id,
          endTime: mission.endTime
        });
      }

      autoCompleteDebounce.delete(truckId);
    }
  }

  // ============================================================
  // UTILITIES
  // ============================================================
  async updateDeviceStatus(device, batteryLevel) {
    device.lastSeen = new Date();
    if (batteryLevel) device.batteryLevel = batteryLevel;
    await device.save();
  }

  calculateDistance(point1, point2) {
    const R = 6371;
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
    const deltaLon = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(deltaLat/2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ============================================================
  // DEVICE CRUD (unchanged, but simplified where possible)
  // ============================================================
  getAllDevices = catchAsync(async (req, res) => {
    const devices = await Device.find().populate('truck', 'licensePlate brand model');
    res.json({ success: true, count: devices.length, data: devices });
  });

  getDevice = catchAsync(async (req, res) => {
    const device = await Device.findById(req.params.id).populate('truck', 'licensePlate brand model');
    if (!device) throw new AppError('Device not found', 404);
    res.json({ success: true, data: device });
  });

registerDevice = catchAsync(async (req, res) => {
  const { deviceId, truckId, type } = req.body;

  if (await Device.findOne({ deviceId })) {
    throw new AppError('Device already registered', 400);
  }

  let truck = null;
  if (truckId) {
    truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);
  }

  const device = await Device.create({
    deviceId,
    truck: truckId || null,
    type: type || 'esp32',
    status: 'active',
    batteryLevel: 100,
    lastSeen: new Date()
  });

  // If a truck was provided, add device to its devices array
  if (truck) {
    await Truck.findByIdAndUpdate(truckId, { $addToSet: { devices: device._id } });
  }

  res.status(201).json({ success: true, message: 'Device registered', data: device });
});

  updateDevice = catchAsync(async (req, res) => {
    const device = await Device.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!device) throw new AppError('Device not found', 404);
    res.json({ success: true, message: 'Device updated', data: device });
  });

deleteDevice = catchAsync(async (req, res) => {
  const device = await Device.findById(req.params.id);
  if (!device) throw new AppError('Device not found', 404);

  // Remove device from truck's devices array (if assigned)
  if (device.truck) {
    await Truck.findByIdAndUpdate(device.truck, { $pull: { devices: device._id } });
  }

  await device.deleteOne();
  res.json({ success: true, message: 'Device deleted' });
});
getUnassignedTrucks = catchAsync(async (req, res) => {
  const trucks = await Truck.find({ devices: { $size: 0 } })
    .select('licensePlate brand model');
  res.json({ success: true, count: trucks.length, data: trucks });
});
assignToTruck = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { truckId } = req.body;

  if (!truckId) {
    throw new AppError('Truck ID is required', 400);
  }

  const device = await Device.findById(id);
  if (!device) throw new AppError('Device not found', 404);

  const truck = await Truck.findById(truckId);
  if (!truck) throw new AppError('Truck not found', 404);

  // Remove device from its current truck (if any)
  if (device.truck) {
    await Truck.findByIdAndUpdate(device.truck, { $pull: { devices: device._id } });
  }

  // Add device to the new truck's devices array (avoid duplicates)
  await Truck.findByIdAndUpdate(truckId, { $addToSet: { devices: device._id } });

  // Update device's truck reference
  device.truck = truckId;
  await device.save();

  const updatedDevice = await Device.findById(id).populate('truck', 'licensePlate brand model');
  const updatedTruck = await Truck.findById(truckId).populate('devices', 'deviceId type status');

  res.json({
    success: true,
    message: 'Device assigned to truck',
    data: { device: updatedDevice, truck: updatedTruck }
  });
});

unassignFromTruck = catchAsync(async (req, res) => {
  const { id } = req.params;

  const device = await Device.findById(id);
  if (!device) throw new AppError('Device not found', 404);

  if (!device.truck) {
    return res.json({ success: true, message: 'Device is already unassigned' });
  }

  const truckId = device.truck;

  // Remove device from truck's devices array
  await Truck.findByIdAndUpdate(truckId, { $pull: { devices: device._id } });

  // Clear device's truck reference
  device.truck = null;
  await device.save();

  res.json({ success: true, message: 'Device unassigned from truck' });
});
}
module.exports = new DeviceController();
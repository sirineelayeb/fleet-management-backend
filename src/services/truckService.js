const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const Device = require('../models/Device');
const Mission = require('../models/Mission')
const AppError = require('../utils/AppError');
const notificationService = require('./notificationService');

class TruckService {
  // ==================== HELPERS ====================
  normalizePlate(plate) {
    if (!plate) return plate;
    const numbers = plate.replace(/[^0-9]/g, '');
    if (numbers.length >= 4) {
      const half = Math.floor(numbers.length / 2);
      return `${numbers.substring(0, half)} TN ${numbers.substring(half)}`;
    }
    return plate;
  }

  async checkSpeedViolation(truckId, currentSpeed, location = null, io = null) {
    const truck = await Truck.findById(truckId);
    if (!truck) return { violated: false };

    const speedLimit = truck.speedLimit || 90;
    if (currentSpeed <= speedLimit) return { violated: false };

    const excessSpeed = currentSpeed - speedLimit;
    const severity = excessSpeed > 20 ? 'critical' : (excessSpeed > 10 ? 'high' : 'medium');

    await notificationService.createNotification('speed_violation', {
      truckId: truck._id,
      licensePlate: truck.licensePlate,
      brand: truck.brand,
      model: truck.model,
      currentSpeed,
      speedLimit,
      excessSpeed,
      location: location || 'Unknown location',
      severity,
      timestamp: new Date()
    }, io);

    console.log(`⚠️ SPEED VIOLATION: ${truck.licensePlate} - ${currentSpeed}/${speedLimit} km/h (Excess: ${excessSpeed})`);

    return { violated: true, excessSpeed, severity };
  }

  // ==================== CRUD OPERATIONS ====================
  async create(truckData) {
    const normalizedPlate = this.normalizePlate(truckData.licensePlate);

    // Check uniqueness
    const [existingPlate, existingVin] = await Promise.all([
      Truck.findOne({ licensePlate: normalizedPlate }),
      truckData.vin ? Truck.findOne({ vin: truckData.vin.toUpperCase() }) : null
    ]);

    if (existingPlate) throw new AppError('License plate already exists', 400);
    if (existingVin) throw new AppError('VIN already exists', 400);

    const truck = new Truck({
      licensePlate: normalizedPlate,
      brand: truckData.brand,
      model: truckData.model,
      year: truckData.year,
      capacity: truckData.capacity,
      type: truckData.type || 'normal',
      status: truckData.status || 'available',
      vin: truckData.vin?.toUpperCase(),
      currentSpeed: 0,
      speedLimit: truckData.speedLimit ?? 90,
      devices: truckData.devices || []
    });

    await truck.save();
    await truck.populate([{ path: 'driver', select: 'name phone' }, { path: 'devices', select: 'deviceId status' }]);

    return truck;
  }

  async findAll(filters = {}, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    return await Truck.find(filters)
      .populate('driver', 'name phone status')
      .populate('devices', 'deviceId status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
  }

  async findById(id) {
    const truck = await Truck.findById(id)
      .populate('driver', 'name phone licenseNumber score')
      .populate('devices', 'deviceId type status batteryLevel firmwareVersion lastSeen');
    if (!truck) throw new AppError('Truck not found', 404);
    return truck;
  }

  async update(id, truckData) {
    delete truckData.currentSpeed;
    delete truckData.createdAt;
    delete truckData.updatedAt;

    if (truckData.speedLimit !== undefined && truckData.speedLimit !== null) {
      truckData.speedLimit = parseFloat(truckData.speedLimit);
    }

    const updatedTruck = await Truck.findByIdAndUpdate(id, truckData, { new: true, runValidators: true })
      .populate('driver', 'name phone')
      .populate('devices', 'deviceId status');

    if (!updatedTruck) throw new AppError('Truck not found', 404);
    return updatedTruck;
  }

  async delete(id) {
    const truck = await Truck.findById(id);
    if (!truck) throw new AppError('Truck not found', 404);
    if (truck.status === 'in_mission') throw new AppError('Cannot delete truck in mission', 400);

    if (truck.driver) await Driver.findByIdAndUpdate(truck.driver, { assignedTruck: null });
    if (truck.devices?.length) await Device.updateMany({ _id: { $in: truck.devices } }, { truck: null });

    await Truck.findByIdAndDelete(id);
    return { success: true };
  }

  // ==================== DRIVER ASSIGNMENT HISTORY ====================
  async getDriverAssignmentHistory(truckId) {
    // Verify truck exists
    const truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);
    
    // Get all missions for this truck with driver info
    const missions = await Mission.find({ truck: truckId })
      .populate('driver', 'name licenseNumber phone email status score')
      .select('driver startTime endTime status createdAt')
      .sort({ startTime: -1 });
    
    // Get current assigned driver
    const currentDriver = await Driver.findOne({ assignedTruck: truckId })
      .select('name licenseNumber phone email status score');
    
    // Group missions by driver
    const driverMap = new Map();
    
    missions.forEach(mission => {
      if (mission.driver) {
        const driverId = mission.driver._id.toString();
        
        if (!driverMap.has(driverId)) {
          driverMap.set(driverId, {
            driver: mission.driver,
            assignments: [],
            firstAssigned: mission.startTime || mission.createdAt,
            lastAssigned: mission.endTime || mission.createdAt,
            totalMissions: 1
          });
        } else {
          const existing = driverMap.get(driverId);
          existing.totalMissions++;
          if (mission.endTime && mission.endTime > existing.lastAssigned) {
            existing.lastAssigned = mission.endTime;
          }
          if (mission.startTime && mission.startTime < existing.firstAssigned) {
            existing.firstAssigned = mission.startTime;
          }
        }
        
        driverMap.get(driverId).assignments.push({
          missionId: mission._id,
          startTime: mission.startTime,
          endTime: mission.endTime,
          status: mission.status,
          assignedAt: mission.createdAt
        });
      }
    });
    
    // Convert map to array
    const driverHistory = Array.from(driverMap.values());
    
    // Calculate total trips per driver
    driverHistory.forEach(history => {
      history.totalTrips = history.assignments.length;
    });
    
    return {
      truck: {
        _id: truck._id,
        licensePlate: truck.licensePlate,
        displayPlate: truck.displayPlate,
        brand: truck.brand,
        model: truck.model,
        status: truck.status
      },
      currentDriver: currentDriver,
      driverHistory: driverHistory,
      totalDriversAssigned: driverHistory.length,
      totalMissions: missions.length
    };
  }

  // ==================== REAL-TIME TRACKING ====================
  async updateSpeed(id, speed, location = null, io = null) {
    const truck = await Truck.findById(id);
    if (!truck) throw new AppError('Truck not found', 404);

    truck.currentSpeed = speed;
    truck.lastSpeedUpdate = new Date();
    await truck.save();

    const violation = await this.checkSpeedViolation(id, speed, location, io);

    if (location?.lat && location?.lng) {
      const LocationHistory = require('../models/LocationHistory');
      await LocationHistory.create({
        truck: truck._id,
        location: { type: 'Point', coordinates: [location.lng, location.lat] },
        speed,
        timestamp: new Date(),
        source: 'gps'
      });
    }

    return { truck, violation };
  }

  async updateLocation(id, lat, lng, speed = 0, io = null) {
    return this.updateSpeed(id, speed, { lat, lng }, io);
  }

  // ==================== STATUS MANAGEMENT ====================
  async updateStatus(id, status, io = null) {
    const validStatuses = ['available', 'in_mission', 'maintenance', 'inactive'];
    if (!validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be: ${validStatuses.join(', ')}`, 400);
    }

    const truck = await Truck.findById(id);
    if (!truck) throw new AppError('Truck not found', 404);

    const oldStatus = truck.status;
    truck.status = status;
    await truck.save();

    if (status === 'maintenance') {
      await notificationService.createNotification('maintenance_required', {
        licensePlate: truck.licensePlate,
        brand: truck.brand,
        model: truck.model,
        oldStatus
      }, io);
    }

    if (oldStatus !== status && (status === 'inactive' || oldStatus === 'maintenance')) {
      await notificationService.createNotification('status_changed', {
        licensePlate: truck.licensePlate,
        oldStatus,
        newStatus: status
      }, io);
    }

    return await truck.populate('driver', 'name phone');
  }

  async getAvailableTrucks() {
    return await Truck.find({ status: 'available' }).populate('driver', 'name phone status');
  }

  // ==================== ASSIGNMENTS ====================
  async assignDriver(truckId, driverId) {
    const [truck, driver] = await Promise.all([
      Truck.findById(truckId),
      Driver.findById(driverId)
    ]);

    if (!truck) throw new AppError('Truck not found', 404);
    if (!driver) throw new AppError('Driver not found', 404);
    if (driver.status !== 'available') throw new AppError(`Driver is ${driver.status}`, 400);

    const existingAssignment = await Truck.findOne({ driver: driverId, _id: { $ne: truckId } });
    if (existingAssignment) throw new AppError(`Driver already assigned to ${existingAssignment.licensePlate}`, 400);

    if (truck.driver && truck.driver.toString() !== driverId) {
      await Driver.findByIdAndUpdate(truck.driver, { assignedTruck: null });
    }

    await Driver.findByIdAndUpdate(driverId, { assignedTruck: truckId });
    truck.driver = driverId;
    await truck.save();

    return await truck.populate('driver', 'name phone status');
  }

  async unassignDriver(truckId) {
    const truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);
    if (!truck.driver) throw new AppError('No driver assigned', 400);

    await Driver.findByIdAndUpdate(truck.driver, { assignedTruck: null });
    truck.driver = null;
    await truck.save();

    return await truck.populate('devices', 'deviceId type status');
  }

  async assignDevice(truckId, deviceId) {
    const [truck, device] = await Promise.all([
      Truck.findById(truckId),
      Device.findById(deviceId)
    ]);

    if (!truck) throw new AppError('Truck not found', 404);
    if (!device) throw new AppError('Device not found', 404);
    if (device.truck) throw new AppError('Device already assigned', 400);

    await Truck.findByIdAndUpdate(truckId, { $addToSet: { devices: deviceId } });
    device.truck = truckId;
    await device.save();

    return await Truck.findById(truckId).populate('devices').populate('driver', 'name phone status');
  }

  async unassignDevice(truckId, deviceId) {
    const truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);
    if (!truck.devices?.includes(deviceId)) throw new AppError('Device not assigned to this truck', 400);

    await Truck.findByIdAndUpdate(truckId, { $pull: { devices: deviceId } });
    await Device.findByIdAndUpdate(deviceId, { truck: null });

    return await Truck.findById(truckId).populate('devices').populate('driver', 'name phone status');
  }

  // ==================== STATISTICS & REPORTS ====================
  async getTruckStats() {
    const [total, available, inMission, maintenance, inactive] = await Promise.all([
      Truck.countDocuments(),
      Truck.countDocuments({ status: 'available' }),
      Truck.countDocuments({ status: 'in_mission' }),
      Truck.countDocuments({ status: 'maintenance' }),
      Truck.countDocuments({ status: 'inactive' })
    ]);

    const allTrucks = await Truck.find({});
    const avgSpeed = allTrucks.reduce((sum, t) => sum + (t.currentSpeed || 0), 0) / (allTrucks.length || 1);
    const speedingTrucks = allTrucks.filter(t => (t.currentSpeed || 0) > (t.speedLimit || 90)).length;

    return {
      total,
      available,
      inMission,
      maintenance,
      inactive,
      utilizationRate: total > 0 ? parseFloat(((inMission / total) * 100).toFixed(1)) : 0,
      averageSpeed: parseFloat(avgSpeed.toFixed(1)),
      speedingTrucks
    };
  }

  async getSpeedViolations(truckId, startDate = null, endDate = null) {
    const query = { type: 'speed_violation', 'data.truckId': truckId };
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    const Notification = require('../models/Notification');
    return await Notification.find(query).sort({ createdAt: -1 }).limit(100);
  }
  async getRecentAssignments(truckId, days = 30) {
    const truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get missions (driver assignments) within date range
    const missions = await Mission.find({
      truck: truckId,
      createdAt: { $gte: startDate }
    })
      .populate('driver', 'name licenseNumber phone email status score')
      .sort({ createdAt: -1 });

    // Get device assignments from truck.devices with their assignment dates
    // Note: You need to track when devices were assigned. Add an 'assignedAt' field to Device schema
    const devices = await Device.find({
      _id: { $in: truck.devices },
      assignedAt: { $gte: startDate } // Requires schema change
    }).sort({ assignedAt: -1 });

    // Group missions by driver
    const driverMap = new Map();
    missions.forEach(mission => {
      if (mission.driver) {
        const driverId = mission.driver._id.toString();
        if (!driverMap.has(driverId)) {
          driverMap.set(driverId, {
            driver: mission.driver,
            assignments: [],
            firstAssigned: mission.createdAt,
            lastAssigned: mission.createdAt,
            totalMissions: 1
          });
        } else {
          const existing = driverMap.get(driverId);
          existing.totalMissions++;
          if (mission.createdAt > existing.lastAssigned) {
            existing.lastAssigned = mission.createdAt;
          }
        }
        driverMap.get(driverId).assignments.push({
          missionId: mission._id,
          assignedAt: mission.createdAt,
          status: mission.status
        });
      }
    });

    return {
      period: `${days} days`,
      startDate,
      endDate: new Date(),
      drivers: Array.from(driverMap.values()),
      devices: devices
    };
  }

  async getAssignmentsByDateRange(truckId, startDate, endDate) {
    const truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);

    // Get missions within date range
    const missions = await Mission.find({
      truck: truckId,
      createdAt: { $gte: startDate, $lte: endDate }
    })
      .populate('driver', 'name licenseNumber phone email status score')
      .sort({ createdAt: -1 });

    // Get unique drivers from these missions
    const driversMap = new Map();
    missions.forEach(mission => {
      if (mission.driver) {
        const driverId = mission.driver._id.toString();
        if (!driversMap.has(driverId)) {
          driversMap.set(driverId, {
            driver: mission.driver,
            firstAssigned: mission.createdAt,
            lastAssigned: mission.createdAt,
            missionsCount: 1
          });
        } else {
          const existing = driversMap.get(driverId);
          existing.missionsCount++;
          if (mission.createdAt > existing.lastAssigned) {
            existing.lastAssigned = mission.createdAt;
          }
          if (mission.createdAt < existing.firstAssigned) {
            existing.firstAssigned = mission.createdAt;
          }
        }
      }
    });

    // Get devices assigned within date range (requires assignedAt field)
    const devices = await Device.find({
      truck: truckId,
      assignedAt: { $gte: startDate, $lte: endDate }
    }).sort({ assignedAt: -1 });

    return {
      startDate,
      endDate,
      drivers: Array.from(driversMap.values()),
      devices: devices,
      totalMissions: missions.length
    };
  }
}

module.exports = new TruckService();
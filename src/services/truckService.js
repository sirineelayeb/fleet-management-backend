// backend/src/services/truckService.js
const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const Device = require('../models/Device');
const AppError = require('../utils/AppError');
const notificationService = require('./notificationService');
class TruckService {
  // CREATE
  async create(truckData) {
    // Check if license plate already exists
    const existingTruck = await Truck.findOne({ 
      licensePlate: truckData.licensePlate 
    });
    
    if (existingTruck) {
      throw new AppError('License plate already exists', 400);
    }

    // Check if VIN is unique
    if (truckData.vin) {
      const existingVin = await Truck.findOne({ 
        vin: truckData.vin.toUpperCase() 
      });
      if (existingVin) {
        throw new AppError('VIN already exists', 400);
      }
    }
    
    const truck = new Truck(truckData);
    const savedTruck = await truck.save();
    
    // Populate references
    return await Truck.findById(savedTruck._id)
      .populate('driver', 'name phone')
      .populate('devices', 'deviceId status');
  }
 async count(filters = {}) {
    return await Truck.countDocuments(filters);
  }

 // READ ALL with pagination -
  async findAll(filters = {}, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    
    const trucks = await Truck.find(filters)
      .populate('driver', 'name phone status')
      .populate('devices', 'deviceId status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    return trucks;
  }

  // READ ALL without pagination (for backward compatibility)
  async findAllNoPagination(filters = {}) {
    const trucks = await Truck.find(filters)
      .populate('driver', 'name phone status')
      .populate('devices', 'deviceId type status batteryLevel firmwareVersion lastSeen')
      .sort({ createdAt: -1 });
    
    return trucks;
  }

  // READ BY ID
  async findById(id) {
    const truck = await Truck.findById(id)
      .populate('driver', 'name phone licenseNumber score')
      .populate('devices', 'deviceId type status batteryLevel firmwareVersion lastSeen');
    
    if (!truck) {
      throw new AppError('Truck not found', 404);
    }
    return truck;
  }

  // UPDATE
  async update(id, truckData) {
    const truck = await Truck.findById(id);
    if (!truck) {
      throw new AppError('Truck not found', 404);
    }
    
    // Check license plate uniqueness if being updated
    if (truckData.licensePlate && truckData.licensePlate !== truck.licensePlate) {
      const existingTruck = await Truck.findOne({ 
        licensePlate: truckData.licensePlate 
      });
      if (existingTruck) {
        throw new AppError('License plate already exists', 400);
      }
    }
    
    // Check VIN uniqueness if being updated
    if (truckData.vin && truckData.vin !== truck.vin) {
      const existingVin = await Truck.findOne({ 
        vin: truckData.vin.toUpperCase(),
        _id: { $ne: id }
      });
      if (existingVin) {
        throw new AppError('VIN already exists', 400);
      }
    }
    
    const updatedTruck = await Truck.findByIdAndUpdate(
      id,
      truckData,
      { new: true, runValidators: true }
    ).populate('driver', 'name phone')
     .populate('devices', 'deviceId type status batteryLevel firmwareVersion lastSeen');    
    return updatedTruck;
  }

  // DELETE
  async delete(id) {
    const truck = await Truck.findById(id);
    if (!truck) {
      throw new AppError('Truck not found', 404);
    }
    
    // Check if truck is in mission
    if (truck.status === 'in_mission') {
      throw new AppError('Cannot delete truck that is currently in a mission', 400);
    }
    
    // Clear driver assignment if exists
    if (truck.driver) {
      await Driver.findByIdAndUpdate(truck.driver, { assignedTruck: null });
    }
    
    // Clear device assignment if exists
    if (truck.device) {
      await Device.findByIdAndUpdate(truck.device, { truck: null });
    }
    
    await Truck.findByIdAndDelete(id);
    return { success: true };
  }

  async updateLocation(id, lat, lng, speed = 0) {
    const truck = await Truck.findById(id);
    if (!truck) {
      throw new AppError('Truck not found', 404);
    }
    
    // 1. Save to LocationHistory for tracking
    const LocationHistory = require('../models/LocationHistory');
    await LocationHistory.create({
      truck: truck._id,
      location: {
        type: 'Point',
        coordinates: [lng, lat]  // GeoJSON format: [longitude, latitude]
      },
      speed: speed,
      timestamp: new Date(),
      source: 'manual'  // or 'gps', 'device'
    });
    
    // 2. Update truck's current location
    truck.currentLocation = { lat, lng };
    truck.currentSpeed = speed;
    truck.lastTelemetryAt = new Date();
    await truck.save();
    
    // 3. Check for speed violation (optional)
    if (speed > 80) {
      const notificationService = require('./notificationService');
      await notificationService.createNotification('speed_violation', {
        licensePlate: truck.licensePlate,
        speed: speed,
        location: `${lat}, ${lng}`
      }, null); // Pass io if available
    }
    
    return truck;
  }

  // UPDATE STATUS
  async updateStatus(id, status, io = null) {
    const validStatuses = ['available', 'in_mission', 'maintenance', 'inactive'];
    if (!validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }
    
    const truck = await Truck.findById(id);
    if (!truck) {
      throw new AppError('Truck not found', 404);
    }
    
    const oldStatus = truck.status;
    truck.status = status;
    await truck.save();
    
    // Maintenance notification
    if (status === 'maintenance') {
      await notificationService.createNotification('maintenance_required', {
        licensePlate: truck.licensePlate,
        brand: truck.brand,
        model: truck.model,
        oldStatus: oldStatus
      }, io);
    }
    
    // Optional: Status changed notification (for critical changes)
    if (oldStatus !== status && (status === 'inactive' || oldStatus === 'maintenance')) {
      await notificationService.createNotification('status_changed', {
        licensePlate: truck.licensePlate,
        oldStatus: oldStatus,
        newStatus: status
      }, io);
    }
    
    // Populate driver and return
    return await truck.populate('driver', 'name phone');
  }

// GET AVAILABLE TRUCKS 
async getAvailableTrucks() {
  const trucks = await Truck.find({ 
    status: 'available'
  }).populate('driver', 'name phone status');
  
  return trucks;
}

  // ASSIGN DRIVER
  async assignDriver(truckId, driverId) {
    const truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);
    
    const driver = await Driver.findById(driverId);
    if (!driver) throw new AppError('Driver not found', 404);
    
    // Check driver availability
    if (driver.status !== 'available') {
      throw new AppError(`Driver is ${driver.status} and cannot be assigned`, 400);
    }
    
    // Check if driver is already assigned to another truck
    const existingAssignment = await Truck.findOne({ 
      driver: driverId, 
      _id: { $ne: truckId } 
    });
    
    if (existingAssignment) {
      throw new AppError(`Driver is already assigned to truck ${existingAssignment.licensePlate}`, 400);
    }
    
    // Clear previous driver if exists
    if (truck.driver && truck.driver.toString() !== driverId) {
      await Driver.findByIdAndUpdate(truck.driver, { assignedTruck: null });
    }
    
    // Assign both sides
    await Driver.findByIdAndUpdate(driverId, { assignedTruck: truckId });
    
    truck.driver = driverId;
    await truck.save();
    
    return await truck.populate('driver', 'name phone status');
  }

  // UNASSIGN DRIVER
  async unassignDriver(truckId) {
    const truck = await Truck.findById(truckId);
    if (!truck) throw new AppError('Truck not found', 404);
    
    if (!truck.driver) {
      throw new AppError('Truck has no driver assigned', 400);
    }
    
    // Clear driver assignment
    await Driver.findByIdAndUpdate(truck.driver, { assignedTruck: null });
    
    truck.driver = null;
    await truck.save();
    
    return await truck.populate('devices', 'deviceId type status batteryLevel firmwareVersion lastSeen');  }

  // ASSIGN DEVICE
 async assignDevice(truckId, deviceId) {
  const truck = await Truck.findById(truckId);
  if (!truck) throw new AppError('Truck not found', 404);
  
  const device = await Device.findById(deviceId);
  if (!device) throw new AppError('Device not found', 404);
  if (device.truck) throw new AppError('Device already assigned to another truck', 400);
  
  // Add device to truck's devices array (avoid duplicates)
  await Truck.findByIdAndUpdate(truckId, { $addToSet: { devices: deviceId } });
  
  // Set device's truck reference
  device.truck = truckId;
  await device.save();
  
  return await Truck.findById(truckId)
    .populate('devices')
    .populate('driver', 'name phone status');
}

  // UNASSIGN DEVICE
async unassignDevice(truckId, deviceId) {
  const truck = await Truck.findById(truckId);
  if (!truck) throw new AppError('Truck not found', 404);

  // Ensure the truck has a devices array (fallback for old data)
  const deviceIds = truck.devices || [];
  if (!deviceIds.includes(deviceId)) {
    throw new AppError('Device not assigned to this truck', 400);
  }

  // Remove the specific device from the truck's devices array
  await Truck.findByIdAndUpdate(truckId, { $pull: { devices: deviceId } });

  // Clear the truck reference on the device
  await Device.findByIdAndUpdate(deviceId, { truck: null });

  // Return populated truck with devices and driver
  return await Truck.findById(truckId)
    .populate('devices')
    .populate('driver', 'name phone status');
}
  // GET TRUCK STATISTICS
  async getTruckStats() {
    const [total, available, inMission, maintenance] = await Promise.all([
      Truck.countDocuments(),
      Truck.countDocuments({ status: 'available' }),
      Truck.countDocuments({ status: 'in_mission' }),
      Truck.countDocuments({ status: 'maintenance' })
    ]);
    
    const utilizationRate = total > 0 
      ? ((inMission / total) * 100).toFixed(1) 
      : 0;
    
    // Get trucks with telemetry (last 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const activeWithTelemetry = await Truck.countDocuments({
      lastTelemetryAt: { $gte: tenMinutesAgo }
    });
    
    return {
      total,
      available,
      inMission,
      maintenance,
      activeWithTelemetry,
      utilizationRate: parseFloat(utilizationRate)
    };
  }
}

module.exports = new TruckService();
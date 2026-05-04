const Driver = require('../models/Driver');
const Truck = require('../models/Truck');
const Shipment = require('../models/Shipment');
const Mission = require('../models/Mission');
const ScoreConfig = require('../models/ScoreConfig');
const DriverScoreLog = require('../models/DriverScoreLog');
const AppError = require('../utils/AppError');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

class DriverService {

  // ── Read ──────────────────────────────────────────────────────────────────
  
  async getAllDrivers({ status, search, limit = 10, page = 1 }) {
    const filters = {};
    
    if (status) filters.status = status;
    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { cin: { $regex: search, $options: 'i' } },
        { licenseNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (page - 1) * limit;
    const total = await Driver.countDocuments(filters);
    const pages = Math.ceil(total / limit);
    
    const drivers = await Driver.find(filters)
      .populate('assignedTruck', 'licensePlate brand model')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    return {
      drivers,
      total,
      page: parseInt(page),
      pages,
      limit: parseInt(limit)
    };
  }

  async getDriverById(id) {
    const driver = await Driver.findById(id)
      .populate('assignedTruck', 'licensePlate displayPlate brand model status type capacity currentLocation');
    
    if (!driver) throw new AppError('Driver not found', 404);
    return driver;
  }

  async getAvailableDrivers() {
    return Driver.find({ 
      status: 'available',
      isActive: true
    })
    .select('name email phone licenseNumber score')
    .sort({ name: 1 });
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async createDriver(data) {
    // Validate required fields
    const requiredFields = ['cin', 'name', 'licenseNumber', 'phone'];
    for (const field of requiredFields) {
      if (!data[field]) {
        throw new AppError(`${field} is required`, 400);
      }
    }

    // Format name if firstName/lastName are provided (for backward compatibility)
    if (data.firstName || data.lastName) {
      data.name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
      delete data.firstName;
      delete data.lastName;
    }

    // Create driver with only allowed fields
    const driverData = {
      cin: data.cin,
      name: data.name,
      licenseNumber: data.licenseNumber,
      phone: data.phone,
      email: data.email || null,
      photo: data.photo || null,
      hireDate: data.hireDate || new Date(),
      status: 'available', // default status
      score: 100, // default score
      isActive: true // default active
    };

    const driver = await Driver.create(driverData);
    return driver.populate('assignedTruck', 'licensePlate displayPlate brand model');
  }

  async updateDriver(id, data) {
    try {
      const driver = await Driver.findById(id);
      if (!driver) throw new AppError('Driver not found', 404);

      // Handle name from firstName/lastName (backward compatibility)
      if (data.firstName || data.lastName) {
        data.name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
        delete data.firstName;
        delete data.lastName;
      }

      // Handle truck assignment
      if (data.assignedTruck !== undefined && data.assignedTruck !== driver.assignedTruck?.toString()) {
        
        if (data.assignedTruck) {
          const truck = await Truck.findById(data.assignedTruck);
          if (!truck) throw new AppError('Truck not found', 404);

          // Check if truck already has a driver
          if (truck.driver && truck.driver.toString() !== driver._id.toString()) {
            throw new AppError('Truck is already assigned to another driver', 400);
          }

          // Clear previous truck assignment if exists
          if (driver.assignedTruck) {
            await Truck.findByIdAndUpdate(
              driver.assignedTruck,
              { driver: null }
            );
          }

          // Assign new truck
          await Truck.findByIdAndUpdate(
            data.assignedTruck,
            { driver: driver._id }
          );
        } 
        else if (data.assignedTruck === null && driver.assignedTruck) {
          // Unassign from current truck
          await Truck.findByIdAndUpdate(
            driver.assignedTruck,
            { driver: null }
          );
        }
      }

      const updatedDriver = await Driver.findByIdAndUpdate(
        id,
        data,
        { 
          new: true, 
          runValidators: true
        }
      ).populate('assignedTruck', 'licensePlate displayPlate brand model status type capacity');

      return updatedDriver;
    } catch (error) {
      console.error('Error in updateDriver:', error);
      throw error;
    }
  }

  async assignToTruck(driverId, truckId) {
    try {
      const driver = await Driver.findById(driverId);
      if (!driver) throw new AppError('Driver not found', 404);

      const truck = await Truck.findById(truckId);
      if (!truck) throw new AppError('Truck not found', 404);

      // Check driver availability
      if (driver.status !== 'available') {
        throw new AppError(`Driver is ${driver.status} and cannot be assigned`, 400);
      }

      // Check if driver already assigned to another truck
      if (driver.assignedTruck && driver.assignedTruck.toString() !== truckId) {
        throw new AppError('Driver is already assigned to another truck', 400);
      }

      // Check if truck already has a driver
      if (truck.driver && truck.driver.toString() !== driverId) {
        throw new AppError('Truck already has a different driver assigned', 400);
      }

      // Check if truck is available
      if (truck.status !== 'available') {
        throw new AppError(`Truck is ${truck.status} and cannot accept driver assignment`, 400);
      }

      // Assign both sides
      await Driver.findByIdAndUpdate(driverId, { assignedTruck: truckId });
      await Truck.findByIdAndUpdate(truckId, { driver: driverId });

      const [updatedDriver, updatedTruck] = await Promise.all([
        Driver.findById(driverId).populate('assignedTruck', 'licensePlate displayPlate brand model status'),
        Truck.findById(truckId).populate('driver', 'name email phone')
      ]);

      return { driver: updatedDriver, truck: updatedTruck };
    } catch (error) {
      console.error('Error in assignToTruck:', error);
      throw error;
    }
  }

  async unassignFromTruck(driverId) {
    try {
      const driver = await Driver.findById(driverId);
      if (!driver) throw new AppError('Driver not found', 404);

      const truckId = driver.assignedTruck;
      if (!truckId) {
        throw new AppError('Driver is not assigned to any truck', 400);
      }

      // Check if driver is on a mission
      const activeMission = await Mission.findOne({
        driver: driverId,
        status: 'in_progress'
      });

      if (activeMission) {
        throw new AppError('Cannot unassign driver with active mission', 400);
      }

      await Driver.findByIdAndUpdate(driverId, { assignedTruck: null });
      await Truck.findByIdAndUpdate(truckId, { driver: null });

      const [updatedDriver, updatedTruck] = await Promise.all([
        Driver.findById(driverId).populate('assignedTruck', 'licensePlate displayPlate brand model'),
        Truck.findById(truckId).populate('driver', 'name email phone')
      ]);

      return { driver: updatedDriver, truck: updatedTruck };
    } catch (error) {
      console.error('Error in unassignFromTruck:', error);
      throw error;
    }
  }

  async deleteDriver(id) {
    try {
      const driver = await Driver.findById(id);
      if (!driver) throw new AppError('Driver not found', 404);

      // Check if driver has active missions
      const activeMission = await Mission.findOne({
        driver: id,
        status: 'in_progress'
      });

      if (activeMission) {
        throw new AppError('Cannot delete driver with active mission', 400);
      }

      // Unassign from truck if assigned
      if (driver.assignedTruck) {
        await Truck.findByIdAndUpdate(
          driver.assignedTruck,
          { driver: null }
        );
      }

      // Delete profile photo if exists
      if (driver.photo?.publicId) {
        await cloudinary.uploader.destroy(driver.photo.publicId);
      }

      await driver.deleteOne();
      return { success: true, message: 'Driver deleted successfully' };
    } catch (error) {
      console.error('Error in deleteDriver:', error);
      throw error;
    }
  }

  // ── Photo ─────────────────────────────────────────────────────────────────
  async uploadDriverPhoto(id, file) {
    const driver = await Driver.findById(id);
    if (!driver) throw new AppError('Driver not found', 404);

    // Delete old photo from Cloudinary if exists
    if (driver.photo?.publicId) {
      await cloudinary.uploader.destroy(driver.photo.publicId);
    }

    driver.photo = {
      url:       file.path,      // https://res.cloudinary.com/... URL
      publicId:  file.filename,  // Cloudinary public_id
      uploadedAt: new Date(),
    };

    await driver.save();
    return driver.populate('assignedTruck', 'licensePlate displayPlate brand model status');
  }

  async deleteDriverPhoto(id) {
    const driver = await Driver.findById(id);
    if (!driver) throw new AppError('Driver not found', 404);
    if (!driver.photo?.url) throw new AppError('No photo to delete', 400);

    if (driver.photo.publicId) {
      await cloudinary.uploader.destroy(driver.photo.publicId);
    }

    driver.photo = undefined;
    await driver.save();
    return driver.populate('assignedTruck', 'licensePlate displayPlate brand model status');
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  async getDriverStats() {
    const [total, available, busy, offDuty, assigned] = await Promise.all([
      Driver.countDocuments(),
      Driver.countDocuments({ status: 'available', isActive: true }),
      Driver.countDocuments({ status: 'busy' }),
      Driver.countDocuments({ status: 'off_duty' }),
      Driver.countDocuments({ assignedTruck: { $ne: null } })
    ]);

    return {
      total,
      available,
      busy,
      offDuty,
      assigned,
      availableForAssignment: total - assigned,
      utilizationRate: total > 0 ? ((busy / total) * 100).toFixed(1) : 0
    };
  }

  // Get driver with full history
  async getDriverWithHistory(id) {
    const driver = await Driver.findById(id)
      .populate('assignedTruck', 'licensePlate displayPlate brand model status type capacity');
    
    if (!driver) throw new AppError('Driver not found', 404);
    
    // Get all missions where this driver was involved
    const missions = await Mission.find({ driver: id })
      .populate('truck', 'licensePlate displayPlate brand model')
      .populate('shipment', 'description origin destination shipmentType weightKg')
      .sort({ createdAt: -1 })
      .limit(50);
    
    // Get shipment history
    const shipments = await Shipment.find({ driver: id })
      .populate('truck', 'licensePlate brand model')
      .sort({ createdAt: -1 })
      .limit(50);
    
    return {
      ...driver.toObject(),
      missionHistory: missions,
      shipmentHistory: shipments,
      totalMissions: missions.length,
      totalShipments: shipments.length
    };
  }

  // Get all drivers with their last truck assignment
  async getAllDriversWithLastTruck() {
    const drivers = await Driver.find()
      .populate('assignedTruck', 'licensePlate displayPlate brand model status')
      .sort({ name: 1 });
    
    const driversWithHistory = await Promise.all(drivers.map(async (driver) => {
      // Find last mission with this driver
      const lastMission = await Mission.findOne({ driver: driver._id })
        .populate('truck', 'licensePlate displayPlate brand model')
        .sort({ createdAt: -1 });
      
      // Count total assignments
      const assignmentCount = await Mission.countDocuments({ driver: driver._id });
      
      return {
        _id: driver._id,
        name: driver.name,
        email: driver.email,
        phone: driver.phone,
        licenseNumber: driver.licenseNumber,
        status: driver.status,
        score: driver.score,
        hireDate: driver.hireDate,
        profilePhoto: driver.profilePhoto,
        currentTruck: driver.assignedTruck,
        lastAssignedTruck: lastMission?.truck || null,
        lastAssignmentDate: lastMission?.createdAt || null,
        totalAssignments: assignmentCount
      };
    }));
    
    return driversWithHistory;
  }

  // Get driver's truck assignment history
  async getDriverTruckAssignmentHistory(driverId) {
    const driver = await Driver.findById(driverId)
      .select('name licenseNumber');
    
    if (!driver) throw new AppError('Driver not found', 404);
    
    // Get all missions with truck assignments
    const missions = await Mission.find({ driver: driverId })
      .populate('truck', 'licensePlate displayPlate brand model year capacity type')
      .populate('shipment', 'origin destination shipmentType weightKg')
      .select('createdAt status startTime endTime')
      .sort({ createdAt: -1 });
    
    // Format assignment history
    const history = missions.map(mission => ({
      id: mission._id,
      truck: mission.truck,
      assignedAt: mission.createdAt,
      startTime: mission.startTime,
      endTime: mission.endTime,
      status: mission.status,
      shipment: mission.shipment
    }));
    
    // Get current truck
    const currentTruck = await Truck.findOne({ driver: driverId })
      .select('licensePlate displayPlate brand model status type');
    
    return {
      driver: {
        _id: driver._id,
        name: driver.name,
        licenseNumber: driver.licenseNumber
      },
      totalAssignments: history.length,
      currentTruck: currentTruck,
      history: history
    };
  }

  // Update driver status
  async updateDriverStatus(id, status) {
    const validStatuses = ['available', 'busy', 'off_duty'];
    if (!validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError('Driver not found', 404);

    driver.status = status;
    await driver.save();

    return driver.populate('assignedTruck', 'licensePlate displayPlate brand model');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _deleteFile(filePath) {
    const fullPath = path.join(__dirname, '..', filePath);
    fs.unlink(fullPath, (err) => {
      if (err) console.error('Delete error:', err);
    });
  }
  // ── Driver Scoring System ─────────────────────────────────────────────────

  async getScoreConfig() {
  let config = await ScoreConfig.findOne();
  if (!config) {
    // Create default config if none exists
    config = await ScoreConfig.create({});
  }
  return config;
}

async updateScoreConfig(data) {
  let config = await ScoreConfig.findOne();
  if (!config) {
    config = new ScoreConfig();
  }
  Object.assign(config, data);
  await config.save();
  return config;
}

async getDriverScoreLogs(driverId, limit = 50) {
  const logs = await DriverScoreLog.find({ driver: driverId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('mission', 'shipment startTime endTime')
    .populate('admin', 'name email');
  return logs;
}

async adjustDriverScoreManually(driverId, changeAmount, remark, adminId) {
  const driver = await Driver.findById(driverId);
  if (!driver) throw new AppError('Driver not found', 404);

  let newScore = driver.score + changeAmount;
  newScore = Math.min(100, Math.max(0, newScore)); // clamp 0-100

  driver.score = newScore;
  await driver.save();

  // Log the manual adjustment
  await DriverScoreLog.create({
    driver: driverId,
    changeAmount,
    newScore,
    reason: 'manual_adjustment',
    remark,
    admin: adminId
  });

  return driver;
}

  async updateDriverScoreForMission(missionId, actualDeliveryDate) {
    const mission = await Mission.findById(missionId)
      .populate('shipment')
      .populate('driver');
    if (!mission) throw new AppError('Mission not found', 404);
    if (mission.status !== 'completed') return null;

    const shipment = mission.shipment;
    if (!shipment.plannedDeliveryDate) return null;

    const config = await this.getScoreConfig();
    const plannedDate = new Date(shipment.plannedDeliveryDate);
    const actualDate = new Date(actualDeliveryDate);

    // Compare by date (ignoring time)
    const isEarly = actualDate < plannedDate;
    const isOnTime = actualDate.toDateString() === plannedDate.toDateString();
    const isLate = actualDate > plannedDate;

    let changeAmount = 0;
    let reason = '';

    if (isEarly) {
      changeAmount = config.earlyPoints;
      reason = 'early_delivery';
    } else if (isOnTime) {
      changeAmount = config.onTimePoints;
      reason = 'on_time_delivery';
    } else {
      changeAmount = config.latePenalty;
      reason = 'late_delivery';
    }

    if (changeAmount === 0) return null;

    const driver = mission.driver;
    let newScore = driver.score + changeAmount;
    newScore = Math.min(100, Math.max(0, newScore));

    driver.score = newScore;
    await driver.save();

    await DriverScoreLog.create({
      driver: driver._id,
      changeAmount,
      newScore,
      reason,
      mission: missionId,
      remark: `Planned: ${plannedDate.toISOString()}, Actual: ${actualDate.toISOString()}`
    });

    return { driver, changeAmount, newScore, reason };
  }

  
}

module.exports = new DriverService();
const Truck = require('../models/Truck');  
const TruckService = require('../services/truckService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class TruckController {
  // GET /api/trucks
  getAllTrucks = catchAsync(async (req, res) => {
    try {
      const { status, search, page = 1, limit = 10 } = req.query;
      const filters = {};
      
      if (status) filters.status = status;
      if (search) {
        filters.$or = [
          { licensePlate: { $regex: search, $options: 'i' } },
          { brand: { $regex: search, $options: 'i' } },
          { model: { $regex: search, $options: 'i' } },
          { vin: { $regex: search, $options: 'i' } }
        ];
      }
      
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;
      
      // Get total count - using Truck model directly
      const total = await Truck.countDocuments(filters);
      
      // Get paginated trucks
      const trucks = await Truck.find(filters)
        .populate('driver', 'name phone status')
        .populate('device', 'deviceId status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);
      
      console.log(`Found ${trucks.length} trucks out of ${total} total`);
      
      res.status(200).json({
        success: true,
        data: trucks,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      console.error('Error in getAllTrucks:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  // GET /api/trucks/stats - REMOVE DUPLICATE, keep only one
  getTruckStats = catchAsync(async (req, res) => {
    const stats = await TruckService.getTruckStats();
    res.status(200).json({
      success: true,
      stats
    });
  });

  // GET /api/trucks/active
  getActiveTrucks = catchAsync(async (req, res) => {
    const trucks = await Truck.find({ 
      status: { $in: ['available', 'in_mission'] } 
    }).populate('driver', 'name phone status');
    
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const activeTrucks = trucks.map(truck => ({
      ...truck.toObject(),
      isOnline: truck.lastTelemetryAt && truck.lastTelemetryAt > tenMinutesAgo
    }));
    
    res.status(200).json({
      success: true,
      count: activeTrucks.length,
      data: activeTrucks
    });
  });

  // GET /api/trucks/available
  getAvailableTrucks = catchAsync(async (req, res) => {
    const trucks = await TruckService.getAvailableTrucks();
    
    res.status(200).json({
      success: true,
      count: trucks.length,
      data: trucks
    });
  });

  // GET /api/trucks/:id
  getTruck = catchAsync(async (req, res) => {
    const truck = await TruckService.findById(req.params.id);
    
    res.status(200).json({
      success: true,
      data: truck
    });
  });

  // POST /api/trucks
  createTruck = catchAsync(async (req, res) => {
    const truck = await TruckService.create(req.body);
    
    res.status(201).json({
      success: true,
      message: 'Truck created successfully',
      data: truck
    });
  });

  // PUT /api/trucks/:id
  updateTruck = catchAsync(async (req, res) => {
    const truck = await TruckService.update(req.params.id, req.body);
    
    res.status(200).json({
      success: true,
      message: 'Truck updated successfully',
      data: truck
    });
  });

  // DELETE /api/trucks/:id
  deleteTruck = catchAsync(async (req, res) => {
    await TruckService.delete(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Truck deleted successfully'
    });
  });

  // POST /api/trucks/:id/location
  updateLocation = catchAsync(async (req, res) => {
    const { lat, lng, speed } = req.body;
    
    if (!lat || !lng) {
      throw new AppError('Latitude and longitude are required', 400);
    }
    
    const truck = await TruckService.updateLocation(req.params.id, lat, lng, speed || 0);
    
    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        truckId: truck._id,
        licensePlate: truck.licensePlate,
        location: { lat, lng },
        speed: speed || 0,
        updatedAt: new Date()
      }
    });
  });

  // PUT /api/trucks/:id/status
  updateTruckStatus = catchAsync(async (req, res) => {
    const { status } = req.body;
    const truck = await TruckService.updateStatus(req.params.id, status);
    
    res.status(200).json({
      success: true,
      message: `Truck status updated to ${status}`,
      data: truck
    });
  });

  // POST /api/trucks/:id/assign-driver
  assignDriver = catchAsync(async (req, res) => {
    const { driverId } = req.body;
    
    if (!driverId) {
      throw new AppError('Driver ID is required', 400);
    }
    
    const truck = await TruckService.assignDriver(req.params.id, driverId);
    
    res.status(200).json({
      success: true,
      message: 'Driver assigned successfully',
      data: truck
    });
  });

  // DELETE /api/trucks/:id/unassign-driver
  unassignDriver = catchAsync(async (req, res) => {
    const truck = await TruckService.unassignDriver(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Driver unassigned successfully',
      data: truck
    });
  });

  // POST /api/trucks/:id/assign-device
  assignDevice = catchAsync(async (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
      throw new AppError('Device ID is required', 400);
    }
    
    const truck = await TruckService.assignDevice(req.params.id, deviceId);
    
    res.status(200).json({
      success: true,
      message: 'Device assigned successfully',
      data: truck
    });
  });

  // DELETE /api/trucks/:id/unassign-device
  unassignDevice = catchAsync(async (req, res) => {
    const truck = await TruckService.unassignDevice(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Device unassigned successfully',
      data: truck
    });
  });

  // GET /api/trucks/:id/device
  getTruckDevice = catchAsync(async (req, res) => {
    const truck = await TruckService.findById(req.params.id);
    
    res.status(200).json({
      success: true,
      data: truck.device || null,
      message: truck.device ? 'Device found' : 'No device assigned to this truck'
    });
  });
}

module.exports = new TruckController();
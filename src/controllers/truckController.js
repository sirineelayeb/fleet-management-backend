const Truck = require('../models/Truck');
const TruckService = require('../services/TruckService');
const catchAsync = require('../utils/catchAsync');
const PaginatedResponse = require('../utils/pagination');
const AppError = require('../utils/AppError');

class TruckController {
  // GET /api/trucks
  getAllTrucks = catchAsync(async (req, res) => {
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

    const result = await PaginatedResponse.fromQuery(Truck, filters, page, limit, ['driver', 'devices']);
    res.status(200).json({ success: true, ...result });
  });

  // GET /api/trucks/stats
  getTruckStats = catchAsync(async (req, res) => {
    const stats = await TruckService.getTruckStats();
    res.status(200).json({ success: true, stats });
  });

  // GET /api/trucks/active
  getActiveTrucks = catchAsync(async (req, res) => {
    const trucks = await Truck.find({ status: { $in: ['available', 'in_mission'] } })
      .populate('driver', 'name phone status');

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const activeTrucks = trucks.map(truck => ({
      ...truck.toObject(),
      isOnline: truck.lastTelemetryAt && truck.lastTelemetryAt > tenMinutesAgo
    }));

    res.status(200).json({ success: true, count: activeTrucks.length, data: activeTrucks });
  });

  // GET /api/trucks/available
  getAvailableTrucks = catchAsync(async (req, res) => {
    const trucks = await TruckService.getAvailableTrucks();
    res.status(200).json({ success: true, count: trucks.length, data: trucks });
  });

  // GET /api/trucks/:id
  getTruck = catchAsync(async (req, res) => {
    const truck = await Truck.findById(req.params.id)
      .populate('driver', 'name phone status')
      .populate('devices', 'deviceId type status batteryLevel lastSeen');
    if (!truck) throw new AppError('Truck not found', 404);
    res.json({ success: true, data: truck });
  });

  // POST /api/trucks
  createTruck = catchAsync(async (req, res) => {
    const truck = await TruckService.create(req.body);
    res.status(201).json({ success: true, data: truck });
  });

  // PUT /api/trucks/:id
  updateTruck = catchAsync(async (req, res) => {
    const truck = await TruckService.update(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Truck updated successfully', data: truck });
  });

  // DELETE /api/trucks/:id
  deleteTruck = catchAsync(async (req, res) => {
    await TruckService.delete(req.params.id);
    res.status(200).json({ success: true, message: 'Truck deleted successfully' });
  });

  getDriverAssignmentHistory = catchAsync(async (req, res) => {
  const { id } = req.params;
  const history = await TruckService.getDriverAssignmentHistory(id);
  res.status(200).json({ success: true, data: history });
  });

  // POST /api/trucks/:id/location
  updateLocation = catchAsync(async (req, res) => {
    const { lat, lng, speed } = req.body;
    if (!lat || !lng) throw new AppError('Latitude and longitude are required', 400);

    const result = await TruckService.updateLocation(req.params.id, lat, lng, speed || 0);
    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        truckId: result.truck._id,
        licensePlate: result.truck.licensePlate,
        location: { lat, lng },
        speed: speed || 0,
        updatedAt: new Date()
      }
    });
  });

  // PUT /api/trucks/:id/status
  updateTruckStatus = catchAsync(async (req, res) => {
    const truck = await TruckService.updateStatus(req.params.id, req.body.status);
    res.status(200).json({ success: true, message: `Status updated to ${req.body.status}`, data: truck });
  });

  // POST /api/trucks/:id/assign-driver
  assignDriver = catchAsync(async (req, res) => {
    const { driverId } = req.body;
    if (!driverId) throw new AppError('Driver ID is required', 400);

    const truck = await TruckService.assignDriver(req.params.id, driverId);
    res.status(200).json({ success: true, message: 'Driver assigned successfully', data: truck });
  });

  // DELETE /api/trucks/:id/unassign-driver
  unassignDriver = catchAsync(async (req, res) => {
    const truck = await TruckService.unassignDriver(req.params.id);
    res.status(200).json({ success: true, message: 'Driver unassigned successfully', data: truck });
  });

  // POST /api/trucks/:id/assign-device
  assignDevice = catchAsync(async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) throw new AppError('Device ID is required', 400);

    const truck = await TruckService.assignDevice(req.params.id, deviceId);
    res.status(200).json({ success: true, message: 'Device assigned successfully', data: truck });
  });

  // DELETE /api/trucks/:id/unassign-device/:deviceId
  unassignDevice = catchAsync(async (req, res) => {
    const truck = await TruckService.unassignDevice(req.params.id, req.params.deviceId);
    res.status(200).json({ success: true, message: 'Device unassigned successfully', data: truck });
  });

  // GET /api/trucks/:id/device
  getTruckDevice = catchAsync(async (req, res) => {
    const truck = await TruckService.findById(req.params.id);
    res.status(200).json({
      success: true,
      data: truck.devices || [],
      message: truck.devices?.length ? 'Devices found' : 'No devices assigned'
    });
  });
    // GET /api/trucks/:id/recent-assignments?days=30
  getRecentAssignments = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { days = 30 } = req.query;
    
    const assignments = await TruckService.getRecentAssignments(id, parseInt(days));
    res.status(200).json({ success: true, data: assignments });
  });

  // GET /api/trucks/:id/assignments-by-date
  getAssignmentsByDateRange = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }
    
    const assignments = await TruckService.getAssignmentsByDateRange(
      id, 
      new Date(startDate), 
      new Date(endDate)
    );
    res.status(200).json({ success: true, data: assignments });
  });
}

module.exports = new TruckController();
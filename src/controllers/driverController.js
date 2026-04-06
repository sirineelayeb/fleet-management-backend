const driverService = require('../services/driverService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class DriverController {

  // GET /drivers
  getAllDrivers = catchAsync(async (req, res) => {
    const { status, search, limit = 100, page = 1 } = req.query;

    const result = await driverService.getAllDrivers({
      status,
      search,
      limit: parseInt(limit),
      skip: (page - 1) * parseInt(limit),
    });

    res.status(200).json({
      success: true,
      data: result.drivers,
      pagination: {
        total: result.total,
        page: parseInt(page),
        pages: result.pages,
        limit: parseInt(limit),
      },
    });
  });

  // GET /drivers/available
  getAvailableDrivers = catchAsync(async (req, res) => {
    const drivers = await driverService.getAvailableDrivers();
    res.status(200).json({ success: true, data: drivers });
  });

  // GET /drivers/stats
  getDriverStats = catchAsync(async (req, res) => {
    const stats = await driverService.getDriverStats();
    res.status(200).json({
      success: true,
      data: stats,
    });
  });

  // GET /drivers/:id
  getDriver = catchAsync(async (req, res) => {
    const driver = await driverService.getDriverById(req.params.id);
    res.status(200).json({ success: true, data: driver });
  });

  // GET /drivers/:id/history
  getDriverHistory = catchAsync(async (req, res) => {
    const driverWithHistory = await driverService.getDriverWithHistory(req.params.id);
    res.status(200).json({
      success: true,
      data: driverWithHistory,
    });
  });

  // GET /drivers/:id/truck-history
  getDriverTruckHistory = catchAsync(async (req, res) => {
    const truckHistory = await driverService.getDriverTruckAssignmentHistory(req.params.id);
    res.status(200).json({
      success: true,
      data: truckHistory,
    });
  });

  // GET /drivers/history/all
  getAllDriversWithHistory = catchAsync(async (req, res) => {
    const driversWithHistory = await driverService.getAllDriversWithLastTruck();
    res.status(200).json({
      success: true,
      count: driversWithHistory.length,
      data: driversWithHistory,
    });
  });

  // POST /drivers
  createDriver = catchAsync(async (req, res) => {
    const driver = await driverService.createDriver(req.body);
    res.status(201).json({
      success: true,
      data: driver,
      message: 'Driver created successfully',
    });
  });

  // PUT /drivers/:id
  updateDriver = catchAsync(async (req, res) => {
    const driver = await driverService.updateDriver(req.params.id, req.body);
    res.status(200).json({
      success: true,
      data: driver,
      message: 'Driver updated successfully',
    });
  });

  // DELETE /drivers/:id
  deleteDriver = catchAsync(async (req, res) => {
    await driverService.deleteDriver(req.params.id);
    res.status(200).json({ 
      success: true, 
      message: 'Driver deleted successfully' 
    });
  });

  // POST /drivers/:id/photo
  uploadPhoto = catchAsync(async (req, res) => {
    if (!req.file) throw new AppError('No file uploaded', 400);

    req.file.path = req.file.path.replace(/\\/g, '/');
    const driver = await driverService.uploadDriverPhoto(req.params.id, req.file);

    res.status(200).json({
      success: true,
      data: driver,
      message: 'Photo uploaded successfully',
    });
  });

  // DELETE /drivers/:id/photo
  deletePhoto = catchAsync(async (req, res) => {
    const driver = await driverService.deleteDriverPhoto(req.params.id);
    res.status(200).json({
      success: true,
      data: driver,
      message: 'Photo deleted successfully',
    });
  });

  // POST /drivers/:id/status
  updateDriverStatus = catchAsync(async (req, res) => {
    const { status } = req.body;
    const driver = await driverService.updateDriverStatus(req.params.id, status);
    res.status(200).json({
      success: true,
      data: driver,
      message: `Driver status updated to ${status}`,
    });
  });
}

module.exports = new DriverController();
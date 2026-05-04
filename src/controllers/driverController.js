const driverService = require('../services/driverService');
const catchAsync = require('../utils/catchAsync');
const PaginatedResponse = require('../utils/pagination');
const AppError = require('../utils/AppError');

class DriverController {

  // GET /drivers
  getAllDrivers = catchAsync(async (req, res) => {
    const { status, search, limit = 10, page = 1 } = req.query;
    
    const result = await driverService.getAllDrivers({
      status,
      search,
      limit: parseInt(limit),
      page: parseInt(page)
    });

    res.status(200).json({
      success: true,
      data: result.drivers,
      pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages,
        limit: result.limit
      }
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

    // Remove this line - no longer needed with Cloudinary:
    // req.file.path = req.file.path.replace(/\\/g, '/');

    const driver = await driverService.uploadDriverPhoto(req.params.id, req.file);

    res.status(200).json({
      success: true,
      data: driver,
      message: 'Photo uploaded successfully',
    });
  });

  // DELETE /drivers/:id/photo — no changes needed
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
  getScoreConfig = catchAsync(async (req, res) => {
    const config = await driverService.getScoreConfig();
    res.json({ success: true, data: config });
  });

  updateScoreConfig = catchAsync(async (req, res) => {
    const config = await driverService.updateScoreConfig(req.body);
    res.json({ success: true, message: 'Score config updated', data: config });
  });

  getDriverScoreLogs = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { limit = 50 } = req.query;
    const logs = await driverService.getDriverScoreLogs(id, parseInt(limit));
    res.json({ success: true, data: logs });
  });

  manualAdjustScore = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { points, remark } = req.body;
    if (points === undefined) throw new AppError('Points amount is required', 400);
    const adminId = req.user._id;
    const driver = await driverService.adjustDriverScoreManually(id, points, remark, adminId);
    res.json({ success: true, message: `Score adjusted by ${points} points`, data: driver });
  });
}

module.exports = new DriverController();
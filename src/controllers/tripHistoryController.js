const TripHistory = require('../models/TripHistory');
const TripHistoryService = require('../services/tripHistoryService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class TripHistoryController {
  
getAllTrips = catchAsync(async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user._id || req.user.id;
    const result = await TripHistoryService.getAllTrips(
      req.user.role,
      userId,
      {},
      parseInt(page),
      parseInt(limit)
    );
    res.status(200).json({
      success: true,
      count: result.trips.length,
      data: result.trips,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        pages: result.pages
      }
    });
  });
  // GET /api/trips/stats
  getTripStats = catchAsync(async (req, res) => {
    // Implement aggregate stats if needed
    res.status(200).json({ success: true, message: 'Stats endpoint ready' });
  });

  // GET /api/trips/live/:truckId
  getLiveTracking = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const activeTrip = await TripHistoryService.getActiveTripByTruck(truckId);
    const Truck = require('../models/Truck');
    const truck = await Truck.findById(truckId).select('currentLocation currentSpeed lastTelemetryAt');
    res.status(200).json({
      success: true,
      data: {
        isLive: true,
        currentLocation: truck?.currentLocation,
        currentSpeed: truck?.currentSpeed,
        lastUpdate: truck?.lastTelemetryAt,
        activeTrip
      }
    });
  });

  // GET /api/trips/truck/:truckId
  getTruckTrips = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    const result = await TripHistoryService.getTruckTrips(
      truckId, startDate, endDate, parseInt(page), parseInt(limit)
    );
    res.status(200).json({
      success: true,
      data: result.trips,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        pages: result.pages
      }
    });
  });

  // GET /api/trips/truck/:truckId/stats
  getTruckTripStats = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { startDate, endDate } = req.query;
    // Implement or call service method if needed
    const stats = await TripHistory.aggregate([
      { $match: { truck: truckId, status: 'completed' } },
      { $group: { _id: null, totalTrips: { $sum: 1 }, totalDistance: { $sum: '$actualDistanceKm' } } }
    ]);
    res.status(200).json({ success: true, data: stats[0] || {} });
  });

  // GET /api/trips/driver/:driverId
  getDriverTrips = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    const filter = { driver: driverId };
    if (startDate) filter.startTime = { $gte: new Date(startDate) };
    if (endDate) filter.endTime = { $lte: new Date(endDate) };
    const trips = await TripHistory.find(filter)
      .populate('truck', 'licensePlate')
      .populate('shipment', 'originAddress destinationAddress')
      .sort({ startTime: -1 })
      .skip((page-1)*limit)
      .limit(parseInt(limit));
    const total = await TripHistory.countDocuments(filter);
    res.status(200).json({
      success: true,
      data: trips,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total/limit) }
    });
  });

  // GET /api/trips/driver/:driverId/stats
  getDriverTripStats = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const { startDate, endDate } = req.query;
    const stats = await TripHistory.aggregate([
      { $match: { driver: driverId, status: 'completed' } },
      { $group: { _id: null, totalTrips: { $sum: 1 }, totalDistance: { $sum: '$actualDistanceKm' } } }
    ]);
    res.status(200).json({ success: true, data: stats[0] || {} });
  });

  // GET /api/trips/:id/map-data
  getTripMapData = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tripData = await TripHistoryService.getTripWithRoute(id);
    res.status(200).json({
      success: true,
      data: tripData
    });
  });

  // GET /api/trips/:id/route
  getTripRoute = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tripData = await TripHistoryService.getTripWithRoute(id);
    res.status(200).json({
      success: true,
      data: tripData
    });
  });

  // GET /api/trips/:id
  getTripWithRoute = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tripData = await TripHistoryService.getTripWithRoute(id);
    res.status(200).json({
      success: true,
      data: tripData
    });
  });
}

module.exports = new TripHistoryController();
const TripHistory = require('../models/TripHistory');
const TripHistoryService = require('../services/tripHistoryService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class TripHistoryController {
  
  // GET /api/trips/all
  getAllTrips = catchAsync(async (req, res) => {
    console.log('Getting all trips');
    
    const allTrips = await TripHistory.find()
      .populate('truck', 'licensePlate brand model')
      .populate('driver', 'name phone')
      .populate('shipment', 'description origin destination')
      .sort({ createdAt: -1 });
    
    console.log(`Found ${allTrips.length} trips`);
    
    res.status(200).json({
      success: true,
      count: allTrips.length,
      data: allTrips
    });
  });
  
  // GET /api/trips/truck/:truckId
  getTruckTrips = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    
    console.log(`Getting trips for truck: ${truckId}`);
    
    const result = await TripHistoryService.getTruckTrips(
      truckId, 
      startDate, 
      endDate, 
      parseInt(page), 
      parseInt(limit)
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
  
  // GET /api/trips/live/:truckId
  getLiveTracking = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    
    const activeTrip = await TripHistoryService.getActiveTripByTruck(truckId);
    const truck = await require('../models/Truck').findById(truckId).select('currentLocation currentSpeed lastTelemetryAt');
    
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
  
  // GET /api/trips/:id/map-data
  getTripMapData = catchAsync(async (req, res) => {
    const { id } = req.params;
    const trip = await TripHistoryService.getTripWithRoute(id);
    
    res.status(200).json({
      success: true,
      data: trip
    });
  });
  
  // GET /api/trips/:id/route
  getTripRoute = catchAsync(async (req, res) => {
    const { id } = req.params;
    const trip = await TripHistoryService.getTripRoute(id);
    
    res.status(200).json({
      success: true,
      data: trip
    });
  });
  
  // GET /api/trips/stats
  getTripStats = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    const stats = await TripHistoryService.getTripStats(startDate, endDate);
    
    res.status(200).json({
      success: true,
      data: stats
    });
  });
  
  // GET /api/trips/driver/:driverId/stats
  getDriverTripStats = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const { startDate, endDate } = req.query;
    const stats = await TripHistoryService.getDriverTripStats(driverId, startDate, endDate);
    
    res.status(200).json({
      success: true,
      data: stats
    });
  });
  
  // GET /api/trips/truck/:truckId/stats
  getTruckTripStats = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { startDate, endDate } = req.query;
    const stats = await TripHistoryService.getTruckTripStats(truckId, startDate, endDate);
    
    res.status(200).json({
      success: true,
      data: stats
    });
  });
  
  // GET /api/trips/driver/:driverId
  getDriverTrips = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    const result = await TripHistoryService.getDriverTrips(driverId, startDate, endDate, parseInt(page), parseInt(limit));
    
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
  
  // GET /api/trips/:id
  getTripWithRoute = catchAsync(async (req, res) => {
    const { id } = req.params;
    const trip = await TripHistoryService.getTripWithRoute(id);
    
    res.status(200).json({
      success: true,
      data: trip
    });
  });
}

module.exports = new TripHistoryController();
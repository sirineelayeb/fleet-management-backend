const LocationHistory = require('../models/LocationHistory');
const Truck = require('../models/Truck');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const Shipment = require('../models/Shipment');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class TrackingController {
  // Helper: Get truck IDs that a shipment manager can see
  async _getAllowedTruckIds(user) {
    if (user.role === 'admin') return null; // null means "all trucks"
    
    const shipments = await Shipment.find({
      createdBy: user._id,
      truck: { $ne: null }
    }).select('truck');
    
    const truckIds = [...new Set(shipments.map(s => s.truck.toString()))];
    return truckIds;
  }

  // Helper: Check if user can access a specific truck
  async _canAccessTruck(user, truckId) {
    if (user.role === 'admin') return true;
    
    const shipment = await Shipment.findOne({
      createdBy: user._id,
      truck: truckId
    });
    return !!shipment;
  }

  // GET /api/tracking/live
  getLiveTracking = catchAsync(async (req, res) => {
    const allowedTruckIds = await this._getAllowedTruckIds(req.user);
    
    // Build filter
    let truckFilter = {};
    if (allowedTruckIds !== null) {
      truckFilter._id = { $in: allowedTruckIds };
    }
    
    const trucks = await Truck.find(truckFilter)
      .select('licensePlate brand model status currentLocation currentSpeed lastTelemetryAt')
      .populate('driver', 'name phone');
    
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const trucksWithLiveLocation = await Promise.all(
      trucks.map(async (truck) => {
        const latestLocation = await LocationHistory.findOne({ truck: truck._id })
          .sort({ timestamp: -1 });

        const isOnline = truck.lastTelemetryAt && new Date(truck.lastTelemetryAt) > tenMinutesAgo;
        
        let currentLocation = null;
        if (latestLocation?.location?.coordinates) {
          currentLocation = {
            lat: latestLocation.location.coordinates[1],
            lng: latestLocation.location.coordinates[0]
          };
        } else if (truck.currentLocation?.lat && truck.currentLocation?.lng) {
          currentLocation = truck.currentLocation;
        }

        const mission = await Mission.findOne({
          truck: truck._id,
          status: { $in: ['not_started', 'in_progress'] }
        }).populate('shipment');

        let shipmentInfo = null;
        let loadingInfo = null;
        let tripInfo = null;

        if (mission) {
          const shipment = mission.shipment;
          if (shipment) {
            shipmentInfo = {
              id: shipment._id,
              shipmentId: shipment.shipmentId,
              description: shipment.description,
              origin: shipment.origin,
              destination: shipment.destination,
              weight: shipment.weightKg,
              type: shipment.shipmentType,
              priority: shipment.isPriority
            };
            
            loadingInfo = {
              startedAt: shipment.loadingStartedAt,
              completedAt: shipment.loadingCompletedAt,
              actualDurationMinutes: shipment.actualLoadingDurationMinutes,
              plannedDurationMinutes: shipment.plannedLoadingDurationMinutes
            };
          }
          
          const trip = await TripHistory.findOne({ mission: mission._id });
          if (trip) {
            tripInfo = {
              status: trip.status,
              distanceCovered: trip.actualDistanceKm,
              avgSpeed: trip.averageSpeed,
              maxSpeed: trip.maxSpeed,
              startTime: trip.actualStartTime || trip.startTime,
              estimatedArrival: null
            };
          }
        }

        return {
          id: truck._id,
          licensePlate: truck.licensePlate,
          brand: truck.brand,
          model: truck.model,
          status: truck.status,
          driver: truck.driver,
          currentLocation,
          currentSpeed: latestLocation?.speed || truck.currentSpeed || 0,
          lastUpdate: latestLocation?.timestamp || truck.lastTelemetryAt,
          isOnline: isOnline || false,
          missionStatus: mission?.status || null,
          shipment: shipmentInfo,
          loading: loadingInfo,
          trip: tripInfo
        };
      })
    );
    
    res.status(200).json({ success: true, count: trucksWithLiveLocation.length, data: trucksWithLiveLocation });
  });
  
  // GET /api/tracking/truck/:truckId
  getTruckLocations = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { limit = 50, startDate, endDate } = req.query;
    
    // Check access
    if (!(await this._canAccessTruck(req.user, truckId))) {
      throw new AppError('You do not have permission to view this truck', 403);
    }
    
    const filter = { truck: truckId };
    if (startDate) filter.timestamp = { $gte: new Date(startDate) };
    if (endDate) filter.timestamp = { ...filter.timestamp, $lte: new Date(endDate) };
    
    const locations = await LocationHistory.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    
    res.status(200).json({
      success: true,
      count: locations.length,
      data: locations
    });
  });
  
  // GET /api/tracking/live/truck/:truckId
  getTruckLiveLocation = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    
    if (!(await this._canAccessTruck(req.user, truckId))) {
      throw new AppError('You do not have permission to view this truck', 403);
    }
    
    const truck = await Truck.findById(truckId)
      .select('licensePlate brand model status currentLocation currentSpeed lastTelemetryAt')
      .populate('driver', 'name phone');
    
    if (!truck) throw new AppError('Truck not found', 404);
    
    const latestLocation = await LocationHistory.findOne({ truck: truckId })
      .sort({ timestamp: -1 });
    
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const isOnline = truck.lastTelemetryAt && 
      new Date(truck.lastTelemetryAt) > tenMinutesAgo;
    
    let currentLocation = null;
    if (latestLocation?.location?.coordinates) {
      currentLocation = {
        lat: latestLocation.location.coordinates[1],
        lng: latestLocation.location.coordinates[0]
      };
    } else if (truck.currentLocation?.lat && truck.currentLocation?.lng) {
      currentLocation = truck.currentLocation;
    }
    
    res.status(200).json({
      success: true,
      data: {
        truck: {
          id: truck._id,
          licensePlate: truck.licensePlate,
          brand: truck.brand,
          model: truck.model,
          status: truck.status,
          driver: truck.driver
        },
        location: {
          lat: currentLocation?.lat || null,
          lng: currentLocation?.lng || null,
          speed: latestLocation?.speed || truck.currentSpeed || 0,
          timestamp: latestLocation?.timestamp || truck.lastTelemetryAt
        },
        isOnline
      }
    });
  });
  
  // GET /api/tracking/history/truck/:truckId
  getTruckHistory = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { days = 7, page = 1, limit = 100 } = req.query;
    
    if (!(await this._canAccessTruck(req.user, truckId))) {
      throw new AppError('You do not have permission to view this truck', 403);
    }
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [locations, total] = await Promise.all([
      LocationHistory.find({
        truck: truckId,
        timestamp: { $gte: startDate }
      })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      LocationHistory.countDocuments({
        truck: truckId,
        timestamp: { $gte: startDate }
      })
    ]);
    
    res.status(200).json({
      success: true,
      count: locations.length,
      data: locations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  });
  
  // GET /api/tracking/summary/truck/:truckId
  getTruckTrackingSummary = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { days = 30 } = req.query;
    
    if (!(await this._canAccessTruck(req.user, truckId))) {
      throw new AppError('You do not have permission to view this truck', 403);
    }
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    const [totalPoints, lastLocation, stats, uniqueDaysResult] = await Promise.all([
      LocationHistory.countDocuments({
        truck: truckId,
        timestamp: { $gte: startDate }
      }),
      LocationHistory.findOne({ truck: truckId }).sort({ timestamp: -1 }),
      LocationHistory.aggregate([
        { $match: { truck: truckId, timestamp: { $gte: startDate } } },
        { $group: { _id: null, avgSpeed: { $avg: "$speed" }, maxSpeed: { $max: "$speed" } } }
      ]),
      LocationHistory.aggregate([
        { $match: { truck: truckId, timestamp: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } } } },
        { $group: { _id: null, count: { $sum: 1 } } }
      ])
    ]);
    
    const activeDays = uniqueDaysResult[0]?.count || 0;
    
    let lastKnownLocation = null;
    if (lastLocation?.location?.coordinates) {
      lastKnownLocation = {
        lat: lastLocation.location.coordinates[1],
        lng: lastLocation.location.coordinates[0]
      };
    }
    
    res.status(200).json({
      success: true,
      data: {
        truckId,
        period: `${days} days`,
        summary: {
          totalLocations: totalPoints,
          activeDays,
          averageSpeed: stats[0]?.avgSpeed?.toFixed(2) || 0,
          maxSpeed: stats[0]?.maxSpeed || 0,
          lastUpdate: lastLocation?.timestamp || null,
          lastKnownLocation
        }
      }
    });
  });
}

module.exports = new TrackingController();

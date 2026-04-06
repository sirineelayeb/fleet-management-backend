// backend/src/services/tripHistoryService.js
const TripHistory = require('../models/TripHistory');
const LocationHistory = require('../models/LocationHistory');
const Truck = require('../models/Truck');
const AppError = require('../utils/AppError');

class TripHistoryService {
  // Existing methods...
  
  async createTripFromMission(mission, shipment, truck, driver) {
    const trip = new TripHistory({
      mission: mission._id,
      shipment: shipment._id,
      truck: truck._id,
      driver: driver._id,
      origin: shipment.origin,
      destination: shipment.destination,
      startTime: mission.startTime || new Date(),
      plannedDistanceKm: mission.distanceKm || 0,
      plannedDurationHours: mission.estimatedDuration || 0,
      status: mission.status === 'in_progress' ? 'in_progress' : 'planned'
    });
    
    return await trip.save();
  }
  
  async getActiveTripByTruck(truckId) {
    const activeTrip = await TripHistory.findOne({
      truck: truckId,
      status: 'in_progress'
    }).populate('shipment', 'origin destination');
    
    if (!activeTrip) return null;
    
    // Calculate progress
    const progress = activeTrip.plannedDistanceKm > 0 
      ? (activeTrip.actualDistanceKm / activeTrip.plannedDistanceKm) * 100 
      : 0;
    
    return {
      id: activeTrip._id,
      origin: activeTrip.origin,
      destination: activeTrip.destination,
      progress: parseFloat(progress.toFixed(1))
    };
  }
  
  async getTripRoute(tripId) {
    const trip = await TripHistory.findById(tripId)
      .populate('truck', 'licensePlate displayPlate brand model')
      .populate('driver', 'name phone');
    
    if (!trip) throw new AppError('Trip not found', 404);
    
    // Get all GPS points for this trip
    const locations = await LocationHistory.find({
      truck: trip.truck._id,
      timestamp: { 
        $gte: trip.startTime, 
        $lte: trip.endTime || new Date() 
      }
    }).sort({ timestamp: 1 });
    
    // Format for map display
    const routePoints = locations.map(loc => ({
      lat: loc.location.coordinates[1],
      lng: loc.location.coordinates[0],
      timestamp: loc.timestamp,
      speed: loc.speed
    }));
    
    return {
      trip: {
        id: trip._id,
        tripNumber: trip.tripNumber,
        origin: trip.origin,
        destination: trip.destination,
        startTime: trip.startTime,
        endTime: trip.endTime,
        status: trip.status
      },
      truck: trip.truck,
      driver: trip.driver,
      route: {
        points: routePoints,
        startPoint: routePoints[0] || null,
        endPoint: routePoints[routePoints.length - 1] || null,
        totalDistance: trip.actualDistanceKm,
        totalDuration: trip.actualDurationHours,
        averageSpeed: trip.averageSpeed,
        maxSpeed: trip.maxSpeed
      }
    };
  }
  
  async getTripWithRoute(tripId) {
    return await this.getTripRoute(tripId);
  }
  
  async updateTripWithActualData(tripId, missionId) {
    const trip = await TripHistory.findById(tripId);
    if (!trip) throw new AppError('Trip not found', 404);
    
    const locations = await LocationHistory.find({ 
      truck: trip.truck,
      timestamp: { $gte: trip.startTime, $lte: new Date() }
    }).sort({ timestamp: 1 });
    
    if (locations.length > 0) {
      let totalDistance = 0;
      const routePoints = [];
      
      for (let i = 0; i < locations.length - 1; i++) {
        const point1 = locations[i].location.coordinates;
        const point2 = locations[i + 1].location.coordinates;
        totalDistance += this.calculateDistance(point1, point2);
        routePoints.push(point1);
      }
      routePoints.push(locations[locations.length - 1].location.coordinates);
      
      trip.actualDistanceKm = parseFloat(totalDistance.toFixed(2));
      trip.routePath = {
        type: 'LineString',
        coordinates: routePoints
      };
      
      const speeds = locations.map(l => l.speed || 0).filter(s => s > 0);
      if (speeds.length > 0) {
        trip.maxSpeed = Math.max(...speeds);
        trip.averageSpeed = parseFloat((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2));
      }
    }
    
    trip.calculateDuration();
    trip.calculateAverageSpeed();
    
    return await trip.save();
  }
  
  async completeTrip(tripId, endTime, fuelConsumption = null) {
    const trip = await TripHistory.findById(tripId);
    if (!trip) throw new AppError('Trip not found', 404);
    
    trip.status = 'completed';
    trip.actualEndTime = endTime || new Date();
    trip.endTime = endTime || new Date();
    
    if (fuelConsumption) {
      trip.fuelConsumption = fuelConsumption;
      trip.calculateFuelEfficiency();
    }
    
    trip.calculateDuration();
    trip.calculateAverageSpeed();
    
    return await trip.save();
  }
  
  async getTruckTrips(truckId, startDate, endDate, page = 1, limit = 50) {
  try {
    console.log(`🔍 Service: Looking for trips with truckId: ${truckId}`);
    
    const filter = { truck: truckId };
    
    if (startDate) filter.startTime = { $gte: new Date(startDate) };
    if (endDate) filter.endTime = { $lte: new Date(endDate) };
    
    const skip = (page - 1) * limit;
    
    const [trips, total] = await Promise.all([
      TripHistory.find(filter)
        .populate('driver', 'name')
        .populate('shipment', 'description destination')
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit),
      TripHistory.countDocuments(filter)
    ]);
    
    console.log(`✅ Service: Found ${trips.length} trips`);
    
    return { trips, total, page, pages: Math.ceil(total / limit), limit };
    
  } catch (error) {
    console.error('Error in getTruckTrips:', error);
    throw error;
  }
}
  
  async getDriverTrips(driverId, startDate, endDate, page = 1, limit = 50) {
    const filter = { driver: driverId };
    
    if (startDate) filter.startTime = { $gte: new Date(startDate) };
    if (endDate) filter.endTime = { $lte: new Date(endDate) };
    
    const skip = (page - 1) * limit;
    
    const [trips, total] = await Promise.all([
      TripHistory.find(filter)
        .populate('truck', 'licensePlate brand model')
        .populate('shipment', 'description origin destination')
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit),
      TripHistory.countDocuments(filter)
    ]);
    
    return { trips, total, page, pages: Math.ceil(total / limit), limit };
  }
  
  async getTripStats(startDate, endDate) {
    const filter = { status: 'completed' };
    
    if (startDate) filter.startTime = { $gte: new Date(startDate) };
    if (endDate) filter.endTime = { $lte: new Date(endDate) };
    
    const stats = await TripHistory.aggregate([
      { $match: filter },
      { $group: {
        _id: null,
        totalTrips: { $sum: 1 },
        totalDistance: { $sum: '$actualDistanceKm' },
        totalDuration: { $sum: '$actualDurationHours' },
        totalFuel: { $sum: '$fuelConsumption' },
        avgSpeed: { $avg: '$averageSpeed' },
        avgFuelEfficiency: { $avg: '$averageFuelEfficiency' }
      }}
    ]);
    
    const byTruck = await TripHistory.aggregate([
      { $match: filter },
      { $group: {
        _id: '$truck',
        tripCount: { $sum: 1 },
        totalDistance: { $sum: '$actualDistanceKm' }
      }},
      { $sort: { tripCount: -1 } },
      { $limit: 10 }
    ]);
    
    return {
      overall: stats[0] || {
        totalTrips: 0,
        totalDistance: 0,
        totalDuration: 0,
        totalFuel: 0,
        avgSpeed: 0,
        avgFuelEfficiency: 0
      },
      byTruck
    };
  }
  
  async getDriverTripStats(driverId, startDate, endDate) {
    const match = {
      driver: driverId,
      status: 'completed'
    };
    
    if (startDate) match.startTime = { $gte: new Date(startDate) };
    if (endDate) match.endTime = { $lte: new Date(endDate) };
    
    const stats = await TripHistory.aggregate([
      { $match: match },
      { $group: {
        _id: '$driver',
        totalTrips: { $sum: 1 },
        totalDistance: { $sum: '$actualDistanceKm' },
        totalDuration: { $sum: '$actualDurationHours' },
        avgSpeed: { $avg: '$averageSpeed' },
        totalFuel: { $sum: '$fuelConsumption' },
        totalStops: { $sum: '$stopsCount' }
      }}
    ]);
    
    return stats[0] || null;
  }
  
  async getTruckTripStats(truckId, startDate, endDate) {
    const match = {
      truck: truckId,
      status: 'completed'
    };
    
    if (startDate) match.startTime = { $gte: new Date(startDate) };
    if (endDate) match.endTime = { $lte: new Date(endDate) };
    
    const stats = await TripHistory.aggregate([
      { $match: match },
      { $group: {
        _id: '$truck',
        totalTrips: { $sum: 1 },
        totalDistance: { $sum: '$actualDistanceKm' },
        totalDuration: { $sum: '$actualDurationHours' },
        avgFuelEfficiency: { $avg: '$averageFuelEfficiency' }
      }}
    ]);
    
    return stats[0] || null;
  }
  
  calculateDistance(point1, point2) {
    const R = 6371;
    const lat1 = point1[1] * Math.PI / 180;
    const lat2 = point2[1] * Math.PI / 180;
    const deltaLat = (point2[1] - point1[1]) * Math.PI / 180;
    const deltaLon = (point2[0] - point1[0]) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }
  
  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }
}

module.exports = new TripHistoryService();
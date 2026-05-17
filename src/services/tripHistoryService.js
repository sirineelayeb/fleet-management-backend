const TripHistory = require('../models/TripHistory');
const LocationHistory = require('../models/LocationHistory');
const AppError = require('../utils/AppError');
const Shipment = require('../models/Shipment');

class TripHistoryService {
  async createTripFromMission(mission, shipment, truck, driver) {
    let plannedDurationHours = 0;
    if (shipment.plannedDepartureDate && shipment.plannedDeliveryDate) {
      const diffMs = new Date(shipment.plannedDeliveryDate) - new Date(shipment.plannedDepartureDate);
      plannedDurationHours = diffMs / (1000 * 60 * 60);
    }

    let plannedDistanceKm = 0;
    if (shipment.originCoordinates?.lat && shipment.originCoordinates?.lng &&
        shipment.destinationCoordinates?.lat && shipment.destinationCoordinates?.lng) {
      const origin = [shipment.originCoordinates.lng, shipment.originCoordinates.lat];
      const destination = [shipment.destinationCoordinates.lng, shipment.destinationCoordinates.lat];
      plannedDistanceKm = this.calculateDistance(origin, destination);
    }

    const trip = new TripHistory({
      mission: mission._id,
      shipment: shipment._id,
      truck: truck._id,
      driver: driver._id,
      origin: shipment.origin,
      destination: shipment.destination,
      plannedDistanceKm: parseFloat(plannedDistanceKm.toFixed(2)),
      plannedDurationHours: parseFloat(plannedDurationHours.toFixed(2)),
      startTime: mission.startTime || null,
      status: 'planned'
    });

    return await trip.save();
  }

  async getActiveTripByTruck(truckId) {
    const activeTrip = await TripHistory.findOne({
      truck: truckId,
      status: 'in_progress'
    }).populate('shipment', 'origin destination');

    if (!activeTrip) return null;

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

  async completeTrip(tripId, endTime, fuelConsumption = null) {
    const trip = await TripHistory.findById(tripId);
    if (!trip) throw new AppError('Trip not found', 404);

    const locations = await LocationHistory.find({ trip: trip._id }).sort({ timestamp: 1 });

    if (locations.length === 0) {
      throw new AppError('No location data found for this trip', 400);
    }

    let totalDistance = 0;
    for (let i = 0; i < locations.length - 1; i++) {
      totalDistance += this.calculateDistance(
        locations[i].location.coordinates,
        locations[i + 1].location.coordinates
      );
    }
    trip.actualDistanceKm = parseFloat(totalDistance.toFixed(2));

    const routeCoords = locations.map(loc => loc.location.coordinates);
    trip.routePath = { type: 'LineString', coordinates: routeCoords };

    const firstLoc = locations[0].location.coordinates;
    const lastLoc = locations[locations.length - 1].location.coordinates;
    trip.originCoordinates = { type: 'Point', coordinates: firstLoc };
    trip.destinationCoordinates = { type: 'Point', coordinates: lastLoc };

    trip.endTime = endTime || new Date();

    if (!trip.actualStartTime && locations.length > 0) {
      trip.actualStartTime = locations[0].timestamp;
    }

    const firstLocationTime = locations[0].timestamp;
    const lastLocationTime = locations[locations.length - 1].timestamp;
    const durationMs = lastLocationTime - firstLocationTime;
    trip.actualDurationHours = durationMs / (1000 * 60 * 60);

    console.log('📊 Duration calculation:', {
      firstLocationTime,
      lastLocationTime,
      durationMs,
      actualDurationHours: trip.actualDurationHours,
      minutes: trip.actualDurationHours * 60
    });

    if (trip.actualDurationHours > 0) {
      trip.averageSpeed = trip.actualDistanceKm / trip.actualDurationHours;
      if (trip.averageSpeed > 120) trip.averageSpeed = 120;
    }

    const maxSpeed = Math.max(...locations.map(l => l.speed || 0));
    trip.maxSpeed = maxSpeed;

    if (fuelConsumption) {
      trip.fuelConsumption = fuelConsumption;
      trip.averageFuelEfficiency = trip.actualDistanceKm / fuelConsumption;
    }

    trip.status = 'completed';
    await trip.save();

    return trip;
  }

  async getTripWithRoute(tripId) {
    const trip = await TripHistory.findById(tripId)
      .populate('truck', 'licensePlate')
      .populate('driver', 'name licenseNumber phone cin')
      .populate('shipment', 'description origin destination');

    if (!trip) throw new AppError('Trip not found', 404);

    let routePoints = [];
    if (trip.routePath && trip.routePath.coordinates && trip.routePath.coordinates.length) {
      routePoints = trip.routePath.coordinates.map(coord => ({
        lng: coord[0],
        lat: coord[1]
      }));
    }

    return {
      ...trip.toObject(),
      route: {
        points: routePoints,
        startPoint: routePoints[0] || null,
        endPoint: routePoints[routePoints.length - 1] || null
      }
    };
  }

  async getTruckTrips(truckId, startDate, endDate, page = 1, limit = 50) {
    const filter = { truck: truckId };
    if (startDate) filter.startTime = { $gte: new Date(startDate) };
    if (endDate) filter.endTime = { $lte: new Date(endDate) };

    const skip = (page - 1) * limit;
    const [trips, total] = await Promise.all([
      TripHistory.find(filter)
        .populate('driver', 'name')
        .populate('shipment', 'description origin destination')
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit),
      TripHistory.countDocuments(filter)
    ]);

    return { trips, total, page, pages: Math.ceil(total / limit), limit };
  }

  async getAllTrips(userRole, userId, filters = {}, page = 1, limit = 10) {
    try {
      const query = {};

      if (filters.status) query.status = filters.status;
      if (filters.search) {
        query.$or = [
          { tripNumber: { $regex: filters.search, $options: 'i' } },
          { origin: { $regex: filters.search, $options: 'i' } },
          { destination: { $regex: filters.search, $options: 'i' } }
        ];
      }

      if (userRole !== 'admin') {
        const shipments = await Shipment.find({ assignedTo: userId }).select('_id');
        const shipmentIds = shipments.map(s => s._id);
        query.shipment = { $in: shipmentIds };
      }

      const skip = (page - 1) * limit;
      const [trips, total] = await Promise.all([
        TripHistory.find(query)
          .populate('truck', 'licensePlate brand model')
          .populate('driver', 'name phone licenseNumber cin')
          .populate('shipment', 'origin destination description')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        TripHistory.countDocuments(query)
      ]);

      return {
        trips,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      };
    } catch (error) {
      console.error('Error in getAllTrips:', error);
      throw error;
    }
  }

  calculateDistance(coord1, coord2) {
    const R = 6371;
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;
    const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const deltaLon = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

module.exports = new TripHistoryService();
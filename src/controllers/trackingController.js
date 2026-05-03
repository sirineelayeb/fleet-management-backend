const LocationHistory = require('../models/LocationHistory');
const Truck = require('../models/Truck');
const Shipment = require('../models/Shipment');
const Mission = require('../models/Mission');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class TrackingController {

  getLiveTracking = catchAsync(async (req, res) => {
    let query = {};
    
    if (req.user.role === 'shipment_manager') {
      const activeShipments = await Shipment.find({ 
        status: { $in: ['in_progress', 'assigned', 'pending'] }
      }).select('truck');
      
      const truckIds = activeShipments.map(s => s.truck).filter(Boolean);
      if (truckIds.length > 0) {
        query._id = { $in: truckIds };
      } else {
        return res.json({ success: true, data: [] });
      }
    }
    
    const trucks = await Truck.find(query)
  .populate('driver', 'name phone email')
  .populate('devices', 'deviceId status lastSeen batteryLevel');

  // Get active shipments
  const shipments = await Shipment.find({
    truck: { $in: trucks.map(t => t._id) },
    status: { $in: ['assigned', 'in_progress'] }
  });

  const formattedTrucks = trucks.map(truck => {
    const truckObj = truck.toObject();

    // attach shipment
    const shipment = shipments.find(
      s => s.truck.toString() === truck._id.toString()
    );

    truckObj.shipment = shipment || null;

    truckObj.currentLocation = truck.currentLocation || null;
    truckObj.currentSpeed = truck.currentSpeed || 0;
    truckObj.lastUpdate = truck.lastTelemetryAt || truck.updatedAt;

    return truckObj;
  });

    res.json({
      success: true,
      data: formattedTrucks
    });
  });

  getTruckLocations = catchAsync(async (req, res) => {
    const { limit = 500, from, to } = req.query;
    const query = { truck: req.params.truckId };
    
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(from);
      if (to) query.timestamp.$lte = new Date(to);
    }
    
    const locations = await LocationHistory.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: locations.length,
      data: locations
    });
  });

  getTruckLiveLocation = catchAsync(async (req, res) => {
    const truck = await Truck.findById(req.params.truckId)
      .populate('driver', 'name phone email')
      .populate('devices', 'deviceId status lastSeen batteryLevel');

    if (!truck) throw new AppError('Truck not found', 404);

    // Find active mission separately
    const activeMission = await Mission.findOne({
      truck: truck._id,
      status: { $in: ['not_started', 'in_progress'] }
    }).populate('shipment', 'shipmentId origin destination status plannedDeliveryDate');

    const truckObj = truck.toObject();
    truckObj.currentLocation = truck.currentLocation || null;
    truckObj.currentSpeed = truck.currentSpeed || 0;
    truckObj.lastUpdate = truck.lastTelemetryAt || truck.updatedAt;
    
    if (activeMission?.shipment) {
      truckObj.currentMission = {
        missionId: activeMission._id,
        missionNumber: activeMission.missionNumber,
        status: activeMission.status,
        shipment: activeMission.shipment
      };
    }

    res.json({
      success: true,
      data: truckObj
    });
  });

  getShipmentLocation = catchAsync(async (req, res) => {
    const { shipmentId } = req.params;
    
    const shipment = await Shipment.findById(shipmentId).populate('truck');
    if (!shipment) throw new AppError('Shipment not found', 404);
    
    if (!shipment.truck) {
      return res.json({
        success: true,
        data: {
          hasLocation: false,
          message: 'No truck assigned to this shipment'
        }
      });
    }
    
    const truck = shipment.truck;
    const latestLocation = await LocationHistory.findOne({ truck: truck._id })
      .sort({ timestamp: -1 });
    
    res.json({
      success: true,
      data: {
        truckId: truck._id,
        licensePlate: truck.licensePlate,
        currentLocation: truck.currentLocation,
        currentSpeed: truck.currentSpeed,
        lastUpdate: truck.lastTelemetryAt,
        latestHistory: latestLocation,
        shipmentStatus: shipment.status
      }
    });
  });

  getTruckRoute = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const { from, to, limit = 1000 } = req.query;
    
    const query = { truck: truckId };
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(from);
      if (to) query.timestamp.$lte = new Date(to);
    }
    
    const locations = await LocationHistory.find(query)
      .sort({ timestamp: 1 })
      .limit(parseInt(limit));
    
    // Format for map display
    const route = locations.map(loc => ({
      lat: loc.location.coordinates[1],
      lng: loc.location.coordinates[0],
      timestamp: loc.timestamp,
      speed: loc.speed,
      heading: loc.heading
    }));
    
    res.json({
      success: true,
      count: route.length,
      data: route
    });
  });

  reverseGeocode = catchAsync(async (req, res) => {
    const { lat, lng } = req.query;
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'SmartFleet/1.0' } }
    );
    const data = await response.json();
    const name = data.display_name?.split(',').slice(0, 2).join(', ') || `${lat}, ${lng}`;
    res.json({ success: true, name });
  });
}

module.exports = new TrackingController();
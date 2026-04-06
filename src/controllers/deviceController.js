const Device = require('../models/Device');
const LocationHistory = require('../models/LocationHistory');
const Truck = require('../models/Truck');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const Shipment = require('../models/Shipment');
const Driver = require('../models/Driver');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notificationService');

class DeviceController {
  
  // POST /api/devices/tracking - ESP32 sends GPS data
  handleTrackingData = catchAsync(async (req, res) => {
    const { deviceId, location, speed, heading, temperature, batteryLevel } = req.body;
    const io = req.app.get('io');
    
    console.log(`📡 Received data from device: ${deviceId}`);
    console.log(`   Location: ${location?.lat}, ${location?.lng}`);
    console.log(`   Speed: ${speed} km/h`);
    if (batteryLevel) console.log(`   Battery: ${batteryLevel}%`);
    
    // ============================================================
    // 1. FIND DEVICE AND TRUCK
    // ============================================================
    
    const device = await Device.findOne({ deviceId });
    if (!device) {
      console.log(`❌ Device not found: ${deviceId}`);
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const truck = await Truck.findById(device.truck);
    if (!truck) {
      console.log(`❌ Truck not found for device: ${deviceId}`);
      return res.status(404).json({ error: 'Truck not found' });
    }
    
    // ============================================================
    // 2. CHECK DEVICE STATUS (Offline / Low Battery)
    // ============================================================
    
    // Check if device was offline (no data for 10+ minutes)
    const timeSinceLastSeen = Date.now() - (device.lastSeen || 0);
    if (timeSinceLastSeen > 10 * 60 * 1000 && device.status === 'active') {
      await notificationService.createNotification('device_offline', {
        deviceId: device.deviceId,
        minutes: Math.floor(timeSinceLastSeen / 60000),
        licensePlate: truck.licensePlate
      }, io);
      console.log(`📢 Device offline notification sent`);
    }
    
    // Check low battery
    if (batteryLevel && batteryLevel < 15) {
      await notificationService.createNotification('device_low_battery', {
        deviceId: device.deviceId,
        batteryLevel: batteryLevel,
        licensePlate: truck.licensePlate
      }, io);
      console.log(`📢 Low battery notification sent: ${batteryLevel}%`);
    }
    
    // ============================================================
    // 3. SAVE LOCATION HISTORY
    // ============================================================
    
    await LocationHistory.create({
      truck: truck._id,
      location: {
        type: 'Point',
        coordinates: [location.lng, location.lat]
      },
      speed: speed || 0,
      heading: heading || 0,
      timestamp: new Date(),
      source: 'device'
    });
    
    // ============================================================
    // 4. UPDATE TRUCK CURRENT LOCATION
    // ============================================================
    
    truck.currentLocation = { lat: location.lat, lng: location.lng };
    truck.currentSpeed = speed || 0;
    truck.lastTelemetryAt = new Date();
    await truck.save();
    
    // ============================================================
    // 5. CHECK SPEED VIOLATION
    // ============================================================
    
    if (speed > 80) {
      await notificationService.createNotification('speed_violation', {
        licensePlate: truck.licensePlate,
        speed: speed,
        location: `${location.lat}, ${location.lng}`
      }, io);
      console.log(`📢 Speed violation notification: ${speed} km/h`);
    }
    
    // ============================================================
    // 6. FIND ACTIVE MISSION
    // ============================================================
    
    let mission = await Mission.findOne({ 
      truck: truck._id, 
      status: { $in: ['not_started', 'in_progress'] }
    }).populate('shipment');
    
    if (!mission) {
      // No active mission - just update location and exit
      device.lastSeen = new Date();
      if (batteryLevel) device.batteryLevel = batteryLevel;
      await device.save();
      
      return res.json({ success: true, message: 'Location updated (no active mission)' });
    }
    
    // ============================================================
    // 7. AUTO-START MISSION (when speed > 5 km/h)
    // ============================================================
    
    if (mission.status === 'not_started' && speed > 5) {
      console.log(`🚀 Auto-starting mission ${mission._id} - speed: ${speed} km/h`);
      
      mission.status = 'in_progress';
      mission.startTime = new Date();
      await mission.save();
      
      const trip = await TripHistory.findOne({ mission: mission._id });
      if (trip) {
        trip.status = 'in_progress';
        trip.actualStartTime = new Date();
        await trip.save();
      }
      
      await Shipment.findByIdAndUpdate(mission.shipment._id, { status: 'in_progress' });
      
      // Update truck status
      truck.status = 'in_mission';
      await truck.save();
      
      // Update driver status
      const driver = await Driver.findById(mission.driver);
      if (driver) {
        driver.status = 'busy';
        await driver.save();
      }
      
      // ✅ NOTIFICATION: Mission auto-started
      await notificationService.createNotification('mission_started', {
        missionNumber: mission.missionNumber,
        origin: mission.shipment?.origin || 'Unknown',
        destination: mission.shipment?.destination || 'Unknown',
        truckPlate: truck.licensePlate,
        driverName: driver?.name || 'Unknown',
        trigger: 'auto-start (GPS detected movement)'
      }, io);
      
      console.log(`📢 Mission started notification sent`);
    }
    
    // ============================================================
    // 8. UPDATE TRIP PROGRESS (add route points)
    // ============================================================
    
    if (mission.status === 'in_progress') {
      const trip = await TripHistory.findOne({ mission: mission._id });
      
      if (trip) {
        // Initialize routePath if needed
        if (!trip.routePath) {
          trip.routePath = { type: 'LineString', coordinates: [] };
        }
        if (!trip.routePath.coordinates) {
          trip.routePath.coordinates = [];
        }
        
        // Add current point to route
        trip.routePath.coordinates.push([location.lng, location.lat]);
        
        // Update max speed
        if (speed > (trip.maxSpeed || 0)) {
          trip.maxSpeed = speed;
        }
        
        await trip.save();
      }
    }
    
    // ============================================================
    // 9. AUTO-COMPLETE MISSION (when stopped at destination)
    // ============================================================
    
    if (mission.status === 'in_progress' && mission.shipment) {
      // Check if stopped for at least 2 minutes (4 points at 30s interval)
      const recentStops = await LocationHistory.countDocuments({
        truck: truck._id,
        speed: 0,
        timestamp: { $gte: new Date(Date.now() - 2 * 60 * 1000) }
      });
      
      // Simple destination detection (in production, check distance to destination coordinates)
      const isAtDestination = recentStops >= 3 && speed === 0;
      
      if (isAtDestination) {
        console.log(`✅ Auto-completing mission ${mission._id}`);
        
        const completionTime = new Date();
        
        // Update mission
        mission.status = 'completed';
        mission.endTime = completionTime;
        await mission.save();
        
        // Update trip history with final data
        const trip = await TripHistory.findOne({ mission: mission._id });
        let totalDistance = 0;
        let actualDurationHours = 0;
        
        if (trip) {
          trip.status = 'completed';
          trip.endTime = completionTime;
          trip.actualEndTime = completionTime;
          
          // Calculate total distance from route path
          if (trip.routePath && trip.routePath.coordinates.length > 1) {
            const coords = trip.routePath.coordinates;
            for (let i = 0; i < coords.length - 1; i++) {
              totalDistance += this.calculateDistance(
                { lng: coords[i][0], lat: coords[i][1] },
                { lng: coords[i+1][0], lat: coords[i+1][1] }
              );
            }
            trip.actualDistanceKm = parseFloat(totalDistance.toFixed(2));
          }
          
          // Calculate duration
          const durationMs = completionTime - mission.startTime;
          actualDurationHours = parseFloat((durationMs / (1000 * 60 * 60)).toFixed(2));
          trip.actualDurationHours = actualDurationHours;
          
          // Calculate average speed
          if (trip.actualDistanceKm > 0 && actualDurationHours > 0) {
            trip.averageSpeed = parseFloat((trip.actualDistanceKm / actualDurationHours).toFixed(2));
          }
          
          await trip.save();
        }
        
        // Update shipment
        await Shipment.findByIdAndUpdate(mission.shipment._id, { 
          status: 'completed',
          actualEndTime: completionTime
        });
        
        // Free truck
        truck.status = 'available';
        truck.driver = null;
        await truck.save();
        
        // Free driver and increase score
        const driver = await Driver.findById(mission.driver);
        if (driver) {
          driver.status = 'available';
          driver.assignedTruck = null;
          driver.score = Math.min(100, driver.score + 2);
          await driver.save();
        }
        
        // ✅ NOTIFICATION: Mission auto-completed
        await notificationService.createNotification('mission_completed', {
          missionNumber: mission.missionNumber,
          distance: totalDistance.toFixed(2),
          duration: actualDurationHours.toFixed(2),
          avgSpeed: trip?.averageSpeed?.toFixed(2) || '0',
          trigger: 'auto-complete (GPS detected arrival)'
        }, io);
        
        console.log(`📢 Mission completed notification sent`);
        
        // ✅ NOTIFICATION: Check for delay
        const plannedDurationHours = mission.shipment?.estimatedDuration || 0;
        if (plannedDurationHours > 0 && actualDurationHours > plannedDurationHours) {
          const delayMinutes = ((actualDurationHours - plannedDurationHours) * 60).toFixed(0);
          
          await notificationService.createNotification('delivery_delayed', {
            shipmentId: mission.shipment._id,
            missionNumber: mission.missionNumber,
            plannedHours: plannedDurationHours,
            actualHours: actualDurationHours.toFixed(2),
            delayMinutes: delayMinutes,
            origin: mission.shipment?.origin,
            destination: mission.shipment?.destination
          }, io);
          
          console.log(`📢 Delivery delayed notification sent: ${delayMinutes} min delay`);
        }
      }
    }
    
    // ============================================================
    // 10. UPDATE DEVICE LAST SEEN
    // ============================================================
    
    device.lastSeen = new Date();
    if (batteryLevel) device.batteryLevel = batteryLevel;
    await device.save();
    
    res.json({ success: true, message: 'GPS data processed' });
  });
  
  // ============================================================
  // HELPER: Calculate distance between two points (Haversine formula)
  // ============================================================
  
  calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
    const deltaLon = (point2.lng - point1.lng) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
  }
  
  // ============================================================
  // DEVICE MANAGEMENT
  // ============================================================
  
  // GET /api/devices
  getAllDevices = catchAsync(async (req, res) => {
    const devices = await Device.find().populate('truck', 'licensePlate brand model');
    
    res.status(200).json({
      success: true,
      count: devices.length,
      data: devices
    });
  });
  
  // GET /api/devices/:id
  getDevice = catchAsync(async (req, res) => {
    const device = await Device.findById(req.params.id).populate('truck', 'licensePlate brand model');
    
    if (!device) {
      throw new AppError('Device not found', 404);
    }
    
    res.status(200).json({
      success: true,
      data: device
    });
  });
  
  // POST /api/devices/register
  registerDevice = catchAsync(async (req, res) => {
    const { deviceId, truckId, type } = req.body;
    
    // Check if device already exists
    const existingDevice = await Device.findOne({ deviceId });
    if (existingDevice) {
      throw new AppError('Device already registered', 400);
    }
    
    // Check if truck exists
    if (truckId) {
      const truck = await Truck.findById(truckId);
      if (!truck) {
        throw new AppError('Truck not found', 404);
      }
    }
    
    const device = await Device.create({
      deviceId,
      truck: truckId || null,
      type: type || 'esp32',
      status: 'active',
      batteryLevel: 100,
      lastSeen: new Date()
    });
    
    // Update truck with device
    if (truckId) {
      await Truck.findByIdAndUpdate(truckId, { device: device._id });
    }
    
    res.status(201).json({
      success: true,
      message: 'Device registered successfully',
      data: device
    });
  });
  
  // PUT /api/devices/:id
  updateDevice = catchAsync(async (req, res) => {
    const device = await Device.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!device) {
      throw new AppError('Device not found', 404);
    }
    
    res.status(200).json({
      success: true,
      message: 'Device updated successfully',
      data: device
    });
  });
  
  // DELETE /api/devices/:id
  deleteDevice = catchAsync(async (req, res) => {
    const device = await Device.findById(req.params.id);
    
    if (!device) {
      throw new AppError('Device not found', 404);
    }
    
    // Remove device reference from truck
    if (device.truck) {
      await Truck.findByIdAndUpdate(device.truck, { device: null });
    }
    
    await device.deleteOne();
    
    res.status(200).json({
      success: true,
      message: 'Device deleted successfully'
    });
  });
  
  // POST /api/devices/:id/assign-truck
  assignToTruck = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { truckId } = req.body;
    
    const device = await Device.findById(id);
    if (!device) {
      throw new AppError('Device not found', 404);
    }
    
    const truck = await Truck.findById(truckId);
    if (!truck) {
      throw new AppError('Truck not found', 404);
    }
    
    // Remove device from old truck if exists
    if (device.truck) {
      await Truck.findByIdAndUpdate(device.truck, { device: null });
    }
    
    // Assign device to new truck
    device.truck = truckId;
    await device.save();
    
    // Assign device to truck
    truck.device = device._id;
    await truck.save();
    
    res.status(200).json({
      success: true,
      message: 'Device assigned to truck successfully',
      data: device
    });
  });
}

module.exports = new DeviceController();
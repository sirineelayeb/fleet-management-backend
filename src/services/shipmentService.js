const Shipment = require('../models/Shipment');
const Truck = require('../models/Truck');
const Mission = require('../models/Mission');
const Driver = require('../models/Driver');
const TripHistory = require('../models/TripHistory');
const AppError = require('../utils/AppError');
const LocationHistory = require('../models/LocationHistory');
const notificationService = require('./notificationService'); 

class ShipmentService {
  
  async assignShipment(shipmentId, truckId, driverId = null, io = null) { 
    try {
      // Get shipment and truck
      const [shipment, truck] = await Promise.all([
        Shipment.findById(shipmentId),
        Truck.findById(truckId)
      ]);
      
      if (!shipment) throw new AppError('Shipment not found', 404);
      if (!truck) throw new AppError('Truck not found', 404);
      
      // Determine driver (either from parameter or from truck)
      let driver = null;
      if (driverId) {
        driver = await Driver.findById(driverId);
        if (!driver) throw new AppError('Driver not found', 404);
      } else if (truck.driver) {
        driver = await Driver.findById(truck.driver);
      }
      
      if (!driver) {
        throw new AppError('No driver specified and truck has no driver assigned', 400);
      }
      
      // Validate availability
      if (truck.status !== 'available') {
        throw new AppError(`Truck is not available (status: ${truck.status})`, 400);
      }
      
      if (driver.status !== 'available') {
        throw new AppError(`Driver is not available (status: ${driver.status})`, 400);
      }
      
      // Validate capacity
      if (shipment.weightKg > truck.capacity) {
        throw new AppError(
          `Shipment weight (${shipment.weightKg}kg) exceeds truck capacity (${truck.capacity}kg)`,
          400
        );
      }
      
      const compatibleTypes = {
        'normal': ['normal'],
        'refrigerated': ['normal', 'refrigerated'],
        'fragile': ['normal', 'fragile']
      };
      
      if (!compatibleTypes[shipment.shipmentType].includes(truck.type)) {
        throw new AppError(
          `Truck type '${truck.type}' cannot handle '${shipment.shipmentType}' shipments`,
          400
        );
      }
      
      // Check if shipment is already assigned
      if (shipment.status !== 'pending') {
        throw new AppError(`Shipment cannot be assigned (current status: ${shipment.status})`, 400);
      }
      
      // Use driver._id
      const driverObjectId = driver._id;
      
      // Assign shipment
      shipment.truck = truckId;
      shipment.driver = driverObjectId;
      shipment.status = 'assigned';
      await shipment.save();
      
      // Update truck status and driver reference
      truck.status = 'in_mission';
      truck.driver = driverObjectId;
      await truck.save();
      
      // Update driver status and truck reference
      driver.status = 'busy';
      driver.assignedTruck = truckId;
      await driver.save();
      
      // Create mission
      const mission = new Mission({
        shipment: shipmentId,
        truck: truckId,
        driver: driverObjectId,
        status: 'not_started'
      });
      await mission.save();
      
      // Create trip history record
      const trip = new TripHistory({
        mission: mission._id,
        shipment: shipmentId,
        truck: truckId,
        driver: driverObjectId,
        tripNumber: `TRIP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        origin: shipment.origin,
        destination: shipment.destination,
        startTime: new Date(),
        plannedDistanceKm: 0,
        plannedDurationHours: 0,
        status: 'planned'
      });
      const savedTrip = await trip.save();
      
      console.log(' TripHistory created:', savedTrip._id);
      console.log('Trip number:', savedTrip.tripNumber);
      
      //  NOTIFICATION: Shipment assigned
      await notificationService.createNotification('shipment_assigned', {
        shipmentId: shipment._id,
        shipmentNumber: shipment.shipmentId || shipment._id,
        truckPlate: truck.licensePlate,
        driverName: driver.name,
        origin: shipment.origin,
        destination: shipment.destination,
        weight: shipment.weightKg,
        type: shipment.shipmentType
      }, io);
      
      console.log(' Shipment assigned notification sent');
      
      // Return populated data
      const populatedShipment = await Shipment.findById(shipmentId)
        .populate('truck', 'licensePlate brand model capacity type')
        .populate('driver', 'name phone');
      
      return { 
        success: true, 
        shipment: populatedShipment, 
        mission,
        trip: savedTrip, 
        message: 'Shipment assigned successfully'
      };
      
    } catch (error) {
      console.error('Error in assignShipment:', error);
      throw error;
    }
  }
  
  
  async startMission(missionId) {
    try {
      console.log(' Starting mission:', missionId);
      
      const mission = await Mission.findById(missionId)
        .populate('shipment truck driver');
      
      if (!mission) throw new AppError('Mission not found', 404);
      
      if (mission.status !== 'not_started') {
        throw new AppError(`Mission cannot be started from status: ${mission.status}`, 400);
      }
      
      const startTime = new Date();
      
      mission.status = 'in_progress';
      mission.startTime = startTime;
      await mission.save();
      console.log(' Mission started');
      
      const trip = await TripHistory.findOne({ mission: missionId });
      if (trip) {
        trip.status = 'in_progress';
        trip.actualStartTime = startTime;
        await trip.save();
        console.log('TripHistory status updated to in_progress');
      }
      
      const shipment = await Shipment.findById(mission.shipment._id);
      if (shipment) {
        shipment.status = 'in_progress';
        await shipment.save();
        console.log('Shipment status updated to in_progress');
      }
      
      const truck = await Truck.findById(mission.truck._id);
      if (truck) {
        truck.status = 'in_mission';
        await truck.save();
        console.log('Truck status updated to in_mission');
      }
      
      const driver = await Driver.findById(mission.driver._id);
      if (driver) {
        driver.status = 'busy';
        await driver.save();
        console.log('Driver status updated to busy');
      }
      
      return { 
        success: true, 
        mission, 
        trip,
        message: 'Mission started successfully' 
      };
      
    } catch (error) {
      console.error(' Error in startMission:', error);
      throw error;
    }
  }
  
  async completeMission(missionId) {
    try {
      console.log(' Completing mission:', missionId);
      
      const mission = await Mission.findById(missionId)
        .populate('shipment truck driver');
      
      if (!mission) throw new AppError('Mission not found', 404);
      
      if (mission.status !== 'in_progress') {
        throw new AppError(`Mission cannot be completed from status: ${mission.status}`, 400);
      }
      
      const completionTime = new Date();
      
      mission.status = 'completed';
      mission.endTime = completionTime;
      await mission.save();
      console.log('Mission completed');
      
      const shipment = await Shipment.findById(mission.shipment._id);
      shipment.status = 'completed';
      shipment.actualEndTime = completionTime;
      await shipment.save();
      console.log('Shipment updated');
      
      const truck = await Truck.findById(mission.truck._id);
      truck.status = 'available';
      truck.driver = null;
      await truck.save();
      console.log('Truck status updated to available');
      
      const driver = await Driver.findById(mission.driver._id);
      driver.status = 'available';
      driver.assignedTruck = null;
      await driver.save();
      console.log('Driver status updated to available');
      
      const trip = await TripHistory.findOne({ mission: missionId });
      
      if (trip) {
        console.log('Found TripHistory:', trip._id);
        
        trip.status = 'completed';
        trip.endTime = completionTime;
        trip.actualEndTime = completionTime;
        
        const locations = await LocationHistory.find({
          truck: mission.truck._id,
          timestamp: { 
            $gte: mission.startTime, 
            $lte: completionTime 
          }
        }).sort({ timestamp: 1 });
        
        console.log(` Found ${locations.length} location points`);
        
        if (locations.length > 0) {
          let totalDistance = 0;
          let maxSpeed = 0;
          let speeds = [];
          
          for (let i = 0; i < locations.length; i++) {
            if (locations[i].speed > maxSpeed) maxSpeed = locations[i].speed;
            if (locations[i].speed > 0) speeds.push(locations[i].speed);
            
            if (i > 0) {
              const prev = locations[i - 1];
              const distance = this.calculateDistance(
                prev.location.coordinates,
                locations[i].location.coordinates
              );
              totalDistance += distance;
            }
          }
          
          const averageSpeed = speeds.length > 0 
            ? parseFloat((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2))
            : 0;
          
          trip.actualDistanceKm = parseFloat(totalDistance.toFixed(2));
          trip.averageSpeed = averageSpeed;
          trip.maxSpeed = maxSpeed;
          
          trip.routePath = {
            type: 'LineString',
            coordinates: locations.map(loc => loc.location.coordinates)
          };
          
          console.log(` Trip stats: ${totalDistance.toFixed(2)}km, ${averageSpeed}km/h avg, ${maxSpeed}km/h max`);
        }
        
        const durationMs = completionTime - mission.startTime;
        const actualDurationHours = parseFloat((durationMs / (1000 * 60 * 60)).toFixed(2));
        trip.actualDurationHours = actualDurationHours;
        
        if (trip.plannedDurationHours > 0) {
          const delayMinutes = Math.max(0, (actualDurationHours - trip.plannedDurationHours) * 60);
          trip.delayMinutes = delayMinutes;
        }
        
        await trip.save();
        console.log('TripHistory updated to completed');
      } else {
        console.log(' No TripHistory found for mission:', missionId);
      }
      
      return {
        success: true,
        message: 'Mission completed successfully',
        data: { mission, shipment, truck, driver, trip: trip || null }
      };
      
    } catch (error) {
      console.error(' Error in completeMission:', error);
      throw error;
    }
  }
  
  // Helper method to calculate distance between two points
  calculateDistance(point1, point2) {
    const [lng1, lat1] = point1;
    const [lng2, lat2] = point2;
    
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
  }
  
  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }
}

module.exports = new ShipmentService();
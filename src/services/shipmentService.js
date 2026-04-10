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
      
      //Check if shipment already has a mission
      const existingMission = await Mission.findOne({ shipment: shipmentId });
      if (existingMission) {
        throw new AppError('A mission already exists for this shipment', 400);
      }
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
      const truckCapacityKg = truck.capacity * 1000;
      if (shipment.weightKg > truckCapacityKg) {
        throw new AppError(
      `Shipment weight (${shipment.weightKg}kg) exceeds truck capacity (${truckCapacityKg}kg)`,
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
  async cancelShipment(shipmentId, reason = null, io = null) {
    try {
      const shipment = await Shipment.findById(shipmentId);
      
      if (!shipment) {
        throw new AppError('Shipment not found', 404);
      }
      
      if (shipment.status === 'completed') {
        throw new AppError('Cannot cancel completed shipment', 400);
      }
      
      // If already cancelled, just return
      if (shipment.status === 'cancelled') {
        return {
          success: true,
          message: 'Shipment is already cancelled',
          shipment
        };
      }
      
      // Find associated mission
      const mission = await Mission.findOne({ shipment: shipmentId });
      
      if (mission && mission.status !== 'cancelled') {
        // Get truck and driver
        const [truck, driver] = await Promise.all([
          Truck.findById(mission.truck),
          Driver.findById(mission.driver)
        ]);
        
        // Free up the truck
        if (truck) {
          truck.status = 'available';
          truck.driver = null;
          await truck.save();
          console.log(`✅ Truck ${truck.licensePlate} freed and set to available`);
        }
        
        // Free up the driver
        if (driver) {
          driver.status = 'available';
          driver.assignedTruck = null;
          await driver.save();
          console.log(`✅ Driver ${driver.name} freed and set to available`);
        }
        
        // Update mission status
        mission.status = 'cancelled';
        mission.endTime = new Date();
        await mission.save();
        
        // Update trip history
        const trip = await TripHistory.findOne({ mission: mission._id });
        if (trip) {
          trip.status = 'cancelled';
          trip.endTime = new Date();
          await trip.save();
          console.log(`✅ Trip ${trip.tripNumber} cancelled`);
        }
      }
      
      // Update shipment
      shipment.status = 'cancelled';
      shipment.truck = null;
      shipment.driver = null;
      if (reason) {
        shipment.cancellationReason = reason;
      }
      await shipment.save();
      
      // Send notification
      await notificationService.createNotification('shipment_cancelled', {
        shipmentId: shipment._id,
        shipmentNumber: shipment.shipmentId || shipment._id,
        reason: reason || 'Cancelled by user',
        origin: shipment.origin,
        destination: shipment.destination
      }, io);
      
      console.log(`✅ Shipment ${shipment._id} cancelled successfully`);
      
      return {
        success: true,
        message: 'Shipment cancelled successfully. Truck and driver have been freed.',
        shipment
      };
      
    } catch (error) {
      console.error('❌ Error in cancelShipment:', error);
      throw error;
    }
  }
  async getDelayedShipments(){
    
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
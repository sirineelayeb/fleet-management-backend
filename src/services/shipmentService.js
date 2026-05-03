const Shipment            = require('../models/Shipment');
const Truck               = require('../models/Truck');
const Mission             = require('../models/Mission');
const Driver              = require('../models/Driver');
const TripHistory         = require('../models/TripHistory');
const User                = require('../models/User');
const AppError            = require('../utils/AppError');
const notificationService = require('./notificationService');
const TripHistoryService  = require('./tripHistoryService');

class ShipmentService {

  // ─── Shared resource management ──────────────────────────────────────────

  async freeResources(source) {
    const ops = [];

    if (source.truck) {
      ops.push(
        Truck.findByIdAndUpdate(source.truck, {
          status:       'available',
          driver:       null,
          currentSpeed: 0
        })
      );
    }

    if (source.driver) {
      ops.push(
        Driver.findByIdAndUpdate(source.driver, {
          status:        'available',
          assignedTruck: null
        })
      );
    }

    await Promise.all(ops);
  }

  // ─── Cancel active mission + trip for a shipment ──────────────────────────

  async cancelActiveMission(shipmentId, reason = 'cancelled') {
    const mission = await Mission.findOne({
      shipment: shipmentId,
      status:   { $in: ['not_started', 'in_progress'] }
    });

    if (!mission) return null;

    await TripHistory.findOneAndUpdate(
      { mission: mission._id, status: { $in: ['planned', 'in_progress'] } },
      { status: 'cancelled', endTime: new Date(), cancellationReason: reason }
    );

    await this.freeResources(mission);

    mission.status  = 'cancelled';
    mission.endTime = new Date();
    await mission.save();

    return mission;
  }

  // ─── Assignment ───────────────────────────────────────────────────────────

  async assignShipment(shipmentId, truckId, driverId = null, assignedBy = null, io = null) {
    try {
      const [shipment, truck] = await Promise.all([
        Shipment.findById(shipmentId),
        Truck.findById(truckId)
      ]);

      if (!shipment) throw new AppError('Shipment not found', 404);
      if (!truck)    throw new AppError('Truck not found', 404);

      const existingMission = await Mission.findOne({ shipment: shipmentId });
      if (existingMission) {
        throw new AppError('A mission already exists for this shipment', 400);
      }

      const driver = await this.getDriverForAssignment(driverId, truck);
      if (!driver) {
        throw new AppError('No driver specified and truck has no driver assigned', 400);
      }

      await this.validateAssignment(shipment, truck, driver);
      await this.updateEntitiesForAssignment(shipment, truck, driver, assignedBy);

      let mission;
      try {
        mission = await this.createMissionAndTrip(shipmentId, truckId, driver, shipment);
      } catch (err) {
        if (err.code === 11000) {
          await Promise.all([
            Shipment.findByIdAndUpdate(shipmentId, { status: 'pending', truck: null, driver: null }),
            Truck.findByIdAndUpdate(truckId, { status: 'available', driver: null }),
            Driver.findByIdAndUpdate(driver._id, { status: 'available', assignedTruck: null })
          ]);
          throw new AppError('Shipment was just assigned by someone else — please refresh', 409);
        }
        throw err;
      }

      let assignedByName = 'System';
      if (assignedBy) {
        const assigner = await this.getUserById(assignedBy);
        assignedByName = assigner?.name || 'System';
      }

      await notificationService.createNotification('shipment_assigned', {
        shipmentId:     shipment._id,
        shipmentNumber: shipment.shipmentId,
        truckPlate:     truck.licensePlate,
        driverName:     driver.name,
        assignedBy,
        assignedByName,
        origin:         shipment.origin,
        destination:    shipment.destination
      }, io, assignedBy);

      const populatedShipment = await Shipment.findById(shipmentId)
        .populate('truck',       'licensePlate brand model capacity type')
        .populate('driver',      'name phone')
        .populate('customer',    'name phone')
        .populate('loadingZone', 'name');

      return {
        success:  true,
        shipment: populatedShipment,
        mission,
        message:  'Shipment assigned successfully'
      };

    } catch (error) {
      console.error('Error in assignShipment:', error);
      throw error;
    }
  }

  // ─── Reassignment ─────────────────────────────────────────────────────────

  async reassignShipment(shipmentId, newTruckId, newDriverId, assignedBy, io) {
    const [shipment, newTruck] = await Promise.all([
      Shipment.findById(shipmentId),
      Truck.findById(newTruckId)
    ]);

    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!newTruck) throw new AppError('Truck not found', 404);

    if (!['assigned', 'in_progress'].includes(shipment.status)) {
      throw new AppError(`Cannot reassign a shipment with status: ${shipment.status}`, 400);
    }

    const newDriver = await this.getDriverForAssignment(newDriverId, newTruck);
    if (!newDriver) throw new AppError('No driver found', 400);

    await this.validateReassignment(shipment, newTruck, newDriver);

    const oldTruckId   = shipment.truck?.toString();
    const oldDriverId  = shipment.driver?.toString();
    const isSameTruck  = oldTruckId  === newTruckId.toString();
    const isSameDriver = oldDriverId === newDriver._id.toString();

    const currentMission = await Mission.findOne({
      shipment: shipmentId,
      status:   { $in: ['not_started', 'in_progress'] }
    });

    if (currentMission) {
      await TripHistory.findOneAndUpdate(
        { mission: currentMission._id, status: { $in: ['planned', 'in_progress'] } },
        {
          status:             'cancelled',
          endTime:            new Date(),
          cancellationReason: `Reassigned to truck ${newTruckId}`
        }
      );
      currentMission.status  = 'cancelled';
      currentMission.endTime = new Date();
      await currentMission.save();
    }

    if (oldTruckId  && !isSameTruck)  await Truck.findByIdAndUpdate(shipment.truck,   { status: 'available', currentSpeed: 0 });
    if (oldDriverId && !isSameDriver) await Driver.findByIdAndUpdate(shipment.driver, { status: 'available', assignedTruck: null });

    shipment.truck               = newTruckId;
    shipment.driver              = newDriver._id;
    shipment.assignedBy          = assignedBy;
    shipment.status              = 'assigned';
    shipment.actualDepartureDate = null;
    await shipment.save();

    newTruck.status = 'in_mission';
    newTruck.driver = newDriver._id;
    if (shipment.originCoordinates?.lat != null) {
      newTruck.currentLocation = {
        lat: shipment.originCoordinates.lat,
        lng: shipment.originCoordinates.lng
      };
    }
    newTruck.currentSpeed = 0;
    await newTruck.save();

    newDriver.status        = 'busy';
    newDriver.assignedTruck = newTruckId;
    await newDriver.save();

    const newMission = await this.createMissionAndTrip(shipmentId, newTruckId, newDriver, shipment);

    await notificationService.createNotification('shipment_assigned', {
      shipmentId:     shipment._id,
      shipmentNumber: shipment.shipmentId,
      truckPlate:     newTruck.licensePlate,
      driverName:     newDriver.name,
      assignedBy,
      origin:         shipment.origin,
      destination:    shipment.destination
    }, io, assignedBy);

    return {
      success: true,
      message: 'Shipment reassigned successfully',
      mission: newMission
    };
  }

  // ─── Force complete ───────────────────────────────────────────────────────

  async forceCompleteShipment(shipmentId, adminId, io = null) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError('Shipment not found', 404);

    if (shipment.status === 'completed') {
      throw new AppError('Shipment is already completed', 400);
    }
    if (shipment.status === 'cancelled') {
      throw new AppError('Cannot complete a cancelled shipment', 400);
    }

    const mission = await Mission.findOne({
      shipment: shipmentId,
      status:   { $in: ['not_started', 'in_progress'] }
    });

    if (!mission) {
      throw new AppError('No active mission found for this shipment', 404);
    }

    const trip = await TripHistory.findOne({
      mission: mission._id,
      status:  { $in: ['planned', 'in_progress'] }
    });
    if (trip) {
      await TripHistoryService.completeTrip(trip._id, new Date());
    }

    mission.status  = 'completed';
    mission.endTime = new Date();
    await mission.save();

    await this.freeResources(mission);

    shipment.status             = 'completed';
    shipment.actualDeliveryDate = new Date();
    await shipment.save();

    // Use mission_completed — shipment_force_completed does not exist in the schema
    await notificationService.createNotification('mission_completed', {
      shipmentNumber: shipment.shipmentId,
      origin:         shipment.origin,
      destination:    shipment.destination,
      truckPlate:     mission.truck?.licensePlate,
      missionNumber:  mission.missionNumber,
    }, io);

    const populatedShipment = await Shipment.findById(shipmentId)
      .populate('truck',    'licensePlate brand model')
      .populate('driver',   'name phone')
      .populate('customer', 'name phone');

    return {
      success:  true,
      message:  'Shipment manually marked as completed',
      shipment: populatedShipment,
      mission
    };
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  async validateAssignment(shipment, truck, driver) {
    if (shipment.status !== 'pending') {
      throw new AppError(`Shipment cannot be assigned (current status: ${shipment.status})`, 400);
    }
    await this._validateTruckAndDriver(shipment, truck, driver);
  }

  async validateReassignment(shipment, newTruck, newDriver) {
    const isSameTruck  = shipment.truck?.toString()   === newTruck._id.toString();
    const isSameDriver = shipment.driver?.toString()  === newDriver._id.toString();

    if (!isSameTruck  && newTruck.status  !== 'available') throw new AppError(`Truck is not available (status: ${newTruck.status})`, 400);
    if (!isSameDriver && newDriver.status !== 'available') throw new AppError(`Driver is not available (status: ${newDriver.status})`, 400);

    const truckCapacityKg = newTruck.capacity * 1000;
    if (shipment.weightKg > truckCapacityKg) throw new AppError('Shipment weight exceeds truck capacity', 400);

    const compatibleTypes = {
      normal:       ['normal'],
      refrigerated: ['normal', 'refrigerated'],
      fragile:      ['normal', 'fragile']
    };
    if (!compatibleTypes[shipment.shipmentType].includes(newTruck.type)) {
      throw new AppError('Truck type cannot handle this shipment type', 400);
    }

    if (!shipment.destinationCoordinates?.lat || !shipment.destinationCoordinates?.lng) {
      throw new AppError('Shipment must have destination coordinates for auto-completion', 400);
    }
  }

  async _validateTruckAndDriver(shipment, truck, driver) {
    if (truck.status  !== 'available') throw new AppError(`Truck is not available (status: ${truck.status})`, 400);
    if (driver.status !== 'available') throw new AppError(`Driver is not available (status: ${driver.status})`, 400);

    const truckCapacityKg = truck.capacity * 1000;
    if (shipment.weightKg > truckCapacityKg) throw new AppError('Shipment weight exceeds truck capacity', 400);

    const compatibleTypes = {
      normal:       ['normal'],
      refrigerated: ['normal', 'refrigerated'],
      fragile:      ['normal', 'fragile']
    };
    if (!compatibleTypes[shipment.shipmentType].includes(truck.type)) {
      throw new AppError('Truck type cannot handle this shipment type', 400);
    }

    if (!shipment.destinationCoordinates?.lat || !shipment.destinationCoordinates?.lng) {
      throw new AppError('Shipment must have destination coordinates for auto-completion', 400);
    }
  }

  // ─── Entity helpers ───────────────────────────────────────────────────────

  async updateEntitiesForAssignment(shipment, truck, driver, assignedBy) {
    shipment.truck      = truck._id;
    shipment.driver     = driver._id;
    shipment.status     = 'assigned';
    shipment.assignedBy = assignedBy;
    await shipment.save();

    if (shipment.originCoordinates?.lat != null && shipment.originCoordinates?.lng != null) {
      truck.currentLocation = {
        lat: shipment.originCoordinates.lat,
        lng: shipment.originCoordinates.lng
      };
    }
    truck.status = 'in_mission';
    truck.driver = driver._id;
    await truck.save();

    driver.status        = 'busy';
    driver.assignedTruck = truck._id;
    await driver.save();
  }

  async createMissionAndTrip(shipmentId, truckId, driver, shipment) {
    const mission = new Mission({
      shipment: shipmentId,
      truck:    truckId,
      driver:   driver._id,
      status:   'not_started'
    });
    await mission.save();

    const truck = await Truck.findById(truckId);
    await TripHistoryService.createTripFromMission(mission, shipment, truck, driver);

    return mission;
  }

  async getDriverForAssignment(driverId, truck) {
    if (driverId) {
      const driver = await Driver.findById(driverId);
      if (!driver) throw new AppError('Driver not found', 404);
      return driver;
    }
    if (truck.driver) return Driver.findById(truck.driver);
    return null;
  }

  async getUserById(userId) {
    try {
      return await User.findById(userId).select('name email');
    } catch {
      return null;
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  async getShipmentsByCustomer(customerId) {
    return Shipment.find({ customer: customerId })
      .populate('truck',  'licensePlate')
      .populate('driver', 'name')
      .sort({ createdAt: -1 });
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  async sendCancellationNotification(shipment, reason, io) {
    await notificationService.createNotification('shipment_cancelled', {
      shipmentId:     shipment._id,
      shipmentNumber: shipment.shipmentId,
      reason:         reason || 'Cancelled by user',
      origin:         shipment.origin,
      destination:    shipment.destination,
      customerName:   shipment.customer?.name,
      cancelledBy:    'System'
    }, io);
  }
}

module.exports = new ShipmentService();
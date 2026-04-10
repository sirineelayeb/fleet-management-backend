const Shipment = require('../models/Shipment');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const ShipmentService = require('../services/shipmentService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class ShipmentController {
  // Helper to check if user can access a shipment
  _checkAccess(shipment, user) {
    if (user.role === 'admin') return true;
    if (!shipment.createdBy) return false;
    return shipment.createdBy.toString() === user._id.toString();
  }

  // Helper to build base query with role‑based filter
  _buildBaseQuery(user, extraFilter = {}) {
    const query = { ...extraFilter };
    if (user.role !== 'admin') {
      query.createdBy = user._id;
    }
    return query;
  }

  // GET /api/shipments
  getAllShipments = catchAsync(async (req, res) => {
    const { status, shipmentType, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (shipmentType) filter.shipmentType = shipmentType;

    const query = this._buildBaseQuery(req.user, filter);
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [shipments, total] = await Promise.all([
      Shipment.find(query)
        .populate('truck', 'licensePlate displayPlate brand model')
        .populate('driver', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Shipment.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: shipments.length,
      data: shipments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  });

  // GET /api/shipments/:id
  getShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id)
      .populate('truck', 'licensePlate displayPlate brand model capacity type status')
      .populate('driver', 'name phone licenseNumber score');

    if (!shipment) throw new AppError('Shipment not found', 404);

    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to view this shipment', 403);
    }

    res.status(200).json({ success: true, data: shipment });
  });

  // POST /api/shipments
  createShipment = catchAsync(async (req, res) => {
    const shipmentData = { ...req.body, createdBy: req.user._id };
    const shipment = await Shipment.create(shipmentData);

    res.status(201).json({
      success: true,
      message: 'Shipment created successfully',
      data: shipment
    });
  });

  // PUT /api/shipments/:id
  updateShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to update this shipment', 403);
    }

    const updatedShipment = await Shipment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('truck', 'licensePlate brand model')
    .populate('driver', 'name phone');

    res.status(200).json({
      success: true,
      message: 'Shipment updated successfully',
      data: updatedShipment
    });
  });

  // DELETE /api/shipments/:id
  deleteShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to delete this shipment', 403);
    }

    // Find associated mission
    const mission = await Mission.findOne({ shipment: shipment._id });

    // If there is a mission, clean up all related data
    if (mission) {
      // Free the truck if assigned
      if (mission.truck) {
        const truck = await Truck.findById(mission.truck);
        if (truck) {
          truck.status = 'available';
          truck.driver = null;
          await truck.save();
        }
      }
      // Free the driver if assigned
      if (mission.driver) {
        const driver = await Driver.findById(mission.driver);
        if (driver) {
          driver.status = 'available';
          driver.assignedTruck = null;
          await driver.save();
        }
      }
      // Delete trip history
      await TripHistory.deleteMany({ mission: mission._id });
      // Delete the mission
      await mission.deleteOne();
    }

    // Also delete any trip history directly linked to the shipment (if any)
    await TripHistory.deleteMany({ shipment: shipment._id });

    // Finally delete the shipment
    await shipment.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Shipment and all associated data deleted successfully'
    });
  });
  // POST /api/shipments/assign
  assignShipment = catchAsync(async (req, res) => {
    const { shipmentId, truckId, driverId } = req.body;
    if (!shipmentId || !truckId) throw new AppError('Shipment ID and Truck ID are required', 400);

    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError('Shipment not found', 404);

    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to assign this shipment', 403);
    }

    const result = await ShipmentService.assignShipment(shipmentId, truckId, driverId, req.io);
    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        shipment: result.shipment,
        mission: result.mission,
        trip: result.trip
      }
    });
  });

  // GET /api/shipments/status/:status
  getShipmentsByStatus = catchAsync(async (req, res) => {
    const { status } = req.params;
    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) throw new AppError(`Invalid status`, 400);

    const query = this._buildBaseQuery(req.user, { status });
    const shipments = await Shipment.find(query)
      .populate('truck', 'licensePlate brand model')
      .populate('driver', 'name phone')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: shipments.length,
      data: shipments
    });
  });

  // GET /api/shipments/truck/:truckId
  getShipmentsByTruck = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const query = this._buildBaseQuery(req.user, { truck: truckId });
    const shipments = await Shipment.find(query)
      .populate('driver', 'name phone')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: shipments.length,
      data: shipments
    });
  });

  // GET /api/shipments/driver/:driverId
  getShipmentsByDriver = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const query = this._buildBaseQuery(req.user, { driver: driverId });
    const shipments = await Shipment.find(query)
      .populate('truck', 'licensePlate brand model')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: shipments.length,
      data: shipments
    });
  });

  // GET /api/shipments/stats
  getShipmentStats = catchAsync(async (req, res) => {
    // For stats, we must also filter by user's shipments (non‑admin)
    const baseQuery = this._buildBaseQuery(req.user, {});
    const [total, pending, assigned, inProgress, completed, cancelled] = await Promise.all([
      Shipment.countDocuments(baseQuery),
      Shipment.countDocuments({ ...baseQuery, status: 'pending' }),
      Shipment.countDocuments({ ...baseQuery, status: 'assigned' }),
      Shipment.countDocuments({ ...baseQuery, status: 'in_progress' }),
      Shipment.countDocuments({ ...baseQuery, status: 'completed' }),
      Shipment.countDocuments({ ...baseQuery, status: 'cancelled' })
    ]);

    const weightStats = await Shipment.aggregate([
      { $match: baseQuery },
      { $group: {
        _id: null,
        totalWeight: { $sum: '$weightKg' },
        avgWeight: { $avg: '$weightKg' }
      }}
    ]);

    const byType = await Shipment.aggregate([
      { $match: baseQuery },
      { $group: {
        _id: '$shipmentType',
        count: { $sum: 1 },
        totalWeight: { $sum: '$weightKg' }
      }}
    ]);

    res.status(200).json({
      success: true,
      stats: {
        total,
        pending,
        assigned,
        inProgress,
        completed,
        cancelled,
        completionRate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0,
        totalWeight: weightStats[0]?.totalWeight || 0,
        averageWeight: weightStats[0]?.avgWeight?.toFixed(2) || 0,
        byType
      }
    });
  });

  // GET /api/shipments/:id/mission
  getShipmentMission = catchAsync(async (req, res) => {
    const { id } = req.params;
    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to view this mission', 403);
    }

    const mission = await Mission.findOne({ shipment: id })
      .populate('truck', 'licensePlate brand model')
      .populate('driver', 'name phone');

    if (!mission) throw new AppError('No mission found for this shipment', 404);

    res.status(200).json({ success: true, data: mission });
  });

  // PUT /api/shipments/:id/cancel
  cancelShipment = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to cancel this shipment', 403);
    }

    const result = await ShipmentService.cancelShipment(id, reason, req.io);
    res.status(200).json({
      success: true,
      message: result.message,
      data: result.shipment
    });
  });

  // PUT /api/shipments/:id/loading-duration
  updateLoadingDuration = catchAsync(async (req, res) => {
    const { durationMinutes } = req.body;
    if (!durationMinutes || durationMinutes < 0) {
      throw new AppError('Valid duration in minutes is required', 400);
    }

    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to modify this shipment', 403);
    }

    shipment.plannedLoadingDurationMinutes = durationMinutes;
    await shipment.save();

    res.json({ success: true, data: shipment });
  });
}

module.exports = new ShipmentController();
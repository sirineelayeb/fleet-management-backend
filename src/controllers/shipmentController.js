const ShipmentService = require('../services/shipmentService');
const Shipment = require('../models/Shipment');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class ShipmentController {
  // GET /api/shipments
  getAllShipments = catchAsync(async (req, res) => {
    const { status, shipmentType, page = 1, limit = 50 } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    if (shipmentType) filter.shipmentType = shipmentType;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [shipments, total] = await Promise.all([
      Shipment.find(filter)
        .populate('truck', 'licensePlate displayPlate brand model')
        .populate('driver', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Shipment.countDocuments(filter)
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
    
    if (!shipment) {
      throw new AppError('Shipment not found', 404);
    }
    
    res.status(200).json({
      success: true,
      data: shipment
    });
  });

  // POST /api/shipments
  createShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.create(req.body);
    
    res.status(201).json({
      success: true,
      message: 'Shipment created successfully',
      data: shipment
    });
  });

  // PUT /api/shipments/:id
  updateShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id);
    
    if (!shipment) {
      throw new AppError('Shipment not found', 404);
    }
    
    // Don't allow update if shipment is in progress or completed
    if (shipment.status === 'in_progress' || shipment.status === 'completed') {
      throw new AppError(`Cannot update shipment with status: ${shipment.status}`, 400);
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
    
    if (!shipment) {
      throw new AppError('Shipment not found', 404);
    }
    
    // Don't allow delete if shipment is assigned, in progress, or completed
    if (shipment.status !== 'pending') {
      throw new AppError(`Cannot delete shipment with status: ${shipment.status}`, 400);
    }
    
    await shipment.deleteOne();
    
    res.status(200).json({
      success: true,
      message: 'Shipment deleted successfully'
    });
  });

  // POST /api/shipments/assign
  assignShipment = catchAsync(async (req, res) => {
    const { shipmentId, truckId, driverId } = req.body;
    
    // Validate required fields
    if (!shipmentId || !truckId) {
      throw new AppError('Shipment ID and Truck ID are required', 400);
    }
    
    // driverId (can be null/undefined)
    const result = await ShipmentService.assignShipment(shipmentId, truckId, driverId);
    
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
  
  // POST /api/shipments/start-mission
  // startMission = catchAsync(async (req, res) => {
  //   const { missionId } = req.body;
    
  //   if (!missionId) {
  //     throw new AppError('Mission ID is required', 400);
  //   }
    
  //   const result = await ShipmentService.startMission(missionId);
    
  //   res.status(200).json({
  //     success: true,
  //     message: result.message,
  //     data: result.mission
  //   });
  // });

  // POST /api/shipments/:id/start-mission
  // startMission = catchAsync(async (req, res) => {
  //   const { missionId } = req.body;
    
  //   if (!missionId) {
  //     throw new AppError('Mission ID is required', 400);
  //   }
    
  //   const mission = await ShipmentService.startMission(missionId);
    
  //   res.status(200).json({
  //     success: true,
  //     message: 'Mission started successfully',
  //     data: mission
  //   });
  // });

  // // POST /api/shipments/:id/complete-mission
  // completeMission = catchAsync(async (req, res) => {
  //   const { missionId } = req.body;
    
  //   if (!missionId) {
  //     throw new AppError('Mission ID is required', 400);
  //   }
    
  //   const mission = await ShipmentService.completeMission(missionId);
    
  //   res.status(200).json({
  //     success: true,
  //     message: 'Mission completed successfully',
  //     data: mission
  //   });
  // });

  // GET /api/shipments/status/:status
  getShipmentsByStatus = catchAsync(async (req, res) => {
    const { status } = req.params;
    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }
    
    const shipments = await Shipment.find({ status })
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
    
    const shipments = await Shipment.find({ truck: truckId })
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
    
    const shipments = await Shipment.find({ driver: driverId })
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
    const [total, pending, assigned, inProgress, completed, cancelled] = await Promise.all([
      Shipment.countDocuments(),
      Shipment.countDocuments({ status: 'pending' }),
      Shipment.countDocuments({ status: 'assigned' }),
      Shipment.countDocuments({ status: 'in_progress' }),
      Shipment.countDocuments({ status: 'completed' }),
      Shipment.countDocuments({ status: 'cancelled' })
    ]);
    
    // Get total weight and average
    const weightStats = await Shipment.aggregate([
      { $group: {
        _id: null,
        totalWeight: { $sum: '$weightKg' },
        avgWeight: { $avg: '$weightKg' }
      }}
    ]);
    
    // Get shipments by type
    const byType = await Shipment.aggregate([
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
    
    const mission = await Mission.findOne({ shipment: id })
      .populate('truck', 'licensePlate brand model')
      .populate('driver', 'name phone');
    
    if (!mission) {
      throw new AppError('No mission found for this shipment', 404);
    }
    
    res.status(200).json({
      success: true,
      data: mission
    });
  });

  // PUT /api/shipments/:id/cancel
  cancelShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id);
    
    if (!shipment) {
      throw new AppError('Shipment not found', 404);
    }
    
    if (shipment.status === 'completed') {
      throw new AppError('Cannot cancel completed shipment', 400);
    }
    
    if (shipment.status === 'in_progress') {
      // If in progress, also cancel the mission
      await Mission.findOneAndUpdate(
        { shipment: shipment._id, status: 'in_progress' },
        { status: 'cancelled' }
      );
    }
    
    shipment.status = 'cancelled';
    await shipment.save();
    
    res.status(200).json({
      success: true,
      message: 'Shipment cancelled successfully',
      data: shipment
    });
  });
}

module.exports = new ShipmentController();
const Shipment = require('../models/Shipment');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const Truck = require('../models/Truck');
const Driver = require('../models/Driver');
const User = require('../models/User');
const shipmentService = require('../services/shipmentService');
const notificationService = require('../services/notificationService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class ShipmentController {

  // ============================================================
  // HELPER METHODS
  // ============================================================

  _checkAccess(shipment, user) {
    if (user.role === 'admin') return true;
    if (user.role === 'shipment_manager') {
      return shipment.assignedTo && shipment.assignedTo.toString() === user._id.toString();
    }
    if (!shipment.createdBy) return false;
    return shipment.createdBy.toString() === user._id.toString();
  }

  _buildBaseQuery(user, extraFilter = {}) {
    const query = { ...extraFilter };
    if (user.role === 'admin') return query;
    if (user.role === 'shipment_manager') {
      query.assignedTo = user._id;
      return query;
    }
    query.createdBy = user._id;
    return query;
  }

  // ============================================================
  // CRUD OPERATIONS
  // ============================================================

  getAllShipments = catchAsync(async (req, res) => {
    const { status, customer, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status)   filter.status   = status;
    if (customer) filter.customer = customer;

    const query = this._buildBaseQuery(req.user, filter);
    const skip  = (parseInt(page) - 1) * parseInt(limit);

    const [shipments, total] = await Promise.all([
      Shipment.find(query)
        .populate('truck',       'licensePlate displayPlate brand model')
        .populate('driver',      'name phone')
        .populate('customer',    'name phone')
        .populate('loadingZone', 'name')
        .populate('createdBy',   'name')
        .populate('assignedTo',  'name email')
        .select('+loadingStartedAt +loadingCompletedAt +actualLoadingDurationMinutes')
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
        page:  parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  });

  getShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id)
      .populate('truck',       'licensePlate displayPlate brand model capacity type status year')
      .populate('driver',      'name phone licenseNumber score')
      .populate('customer',    'name phone email address')
      .populate('loadingZone', 'name description')
      .populate('notes.createdBy', 'name email role')
      .populate('createdBy',   'name')
      .populate('assignedTo',  'name email')
      .select('+loadingStartedAt +loadingCompletedAt +actualLoadingDurationMinutes');

    if (!shipment) throw new AppError('Shipment not found', 404);

    const isAdmin          = req.user.role === 'admin';
    const isShipmentManager = req.user.role === 'shipment_manager';
    const isAssignedManager = shipment.assignedTo?._id?.toString() === req.user._id?.toString();
    const isCreator         = shipment.createdBy?._id?.toString()  === req.user._id?.toString();
    const isDriver          = shipment.driver?._id?.toString()      === req.user._id?.toString();

    if (isAdmin || isShipmentManager || isAssignedManager || isCreator || isDriver) {
      return res.status(200).json({ success: true, data: shipment });
    }

    throw new AppError('You do not have permission to view this shipment', 403);
  });

  createShipment = catchAsync(async (req, res) => {
    const shipmentData = { ...req.body, createdBy: req.user._id };
    const shipment = await Shipment.create(shipmentData);

    const populatedShipment = await Shipment.findById(shipment._id)
      .populate('customer',    'name phone')
      .populate('loadingZone', 'name');

    res.status(201).json({
      success: true,
      message: 'Shipment created successfully',
      data: populatedShipment
    });
  });

  updateShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to update this shipment', 403);
    }
    if (shipment.status === 'completed') {
      throw new AppError('Cannot update a completed shipment', 400);
    }

    const { status, truck, driver, ...safeUpdate } = req.body;

    const updatedShipment = await Shipment.findByIdAndUpdate(
      req.params.id,
      safeUpdate,
      { new: true, runValidators: true }
    )
      .populate('customer',    'name phone')
      .populate('loadingZone', 'name')
      .populate('truck',       'licensePlate brand model')
      .populate('driver',      'name phone');

    res.status(200).json({
      success: true,
      message: 'Shipment updated successfully',
      data: updatedShipment
    });
  });

  deleteShipment = catchAsync(async (req, res) => {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to delete this shipment', 403);
    }

    const mission = await Mission.findOne({ shipment: shipment._id });

    if (mission) {
      // FIX 2: use shared freeResources instead of inline duplication
      await shipmentService.freeResources(mission);
      await TripHistory.deleteMany({ mission: mission._id });
      await mission.deleteOne();
    }

    await TripHistory.deleteMany({ shipment: shipment._id });
    await shipment.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Shipment deleted successfully'
    });
  });

  // ============================================================
  // ASSIGNMENT (Truck & Driver)
  // ============================================================

  assignShipment = catchAsync(async (req, res) => {
    const { shipmentId, truckId, driverId } = req.body;
    if (!shipmentId || !truckId) {
      throw new AppError('Shipment ID and Truck ID are required', 400);
    }

    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to assign this shipment', 403);
    }

    const result = await shipmentService.assignShipment(
      shipmentId, truckId, driverId, req.user._id, req.io
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.shipment
    });
  });

  unassignShipment = catchAsync(async (req, res) => {
    const { id } = req.params;

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to unassign this shipment', 403);
    }
    if (shipment.status !== 'assigned') {
      throw new AppError('Shipment is not in assigned status', 400);
    }

    // FIX 2: cancelActiveMission handles freeResources + trip cancellation
    await shipmentService.cancelActiveMission(id, 'unassigned by user');

    shipment.truck   = null;
    shipment.driver  = null;
    shipment.status  = 'pending';
    await shipment.save();

    if (req.io) {
      await notificationService.createNotification('shipment_unassigned', {
        shipmentId:     shipment._id,
        shipmentNumber: shipment.shipmentId,
        origin:         shipment.origin,
        destination:    shipment.destination
      }, req.io);
    }

    res.status(200).json({
      success: true,
      message: 'Shipment unassigned successfully',
      data: shipment
    });
  });

  reassignShipment = catchAsync(async (req, res) => {
    const { truckId, driverId } = req.body;
    if (!truckId) throw new AppError('truckId is required', 400);

    const result = await shipmentService.reassignShipment(
      req.params.id,
      truckId,
      driverId || null,
      req.user._id,
      req.io
    );

    res.json({ success: true, ...result });
  });

  // ============================================================
  // FIX 4: Force-complete endpoint (admin only)
  // POST /api/shipments/:id/force-complete
  // ============================================================

  forceCompleteShipment = catchAsync(async (req, res) => {
    if (req.user.role !== 'admin') {
      throw new AppError('Only admins can force-complete a shipment', 403);
    }

    const result = await shipmentService.forceCompleteShipment(
      req.params.id,
      req.user._id,
      req.io
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.shipment
    });
  });

  // ============================================================
  // MANAGER ASSIGNMENT (Admin only)
  // ============================================================

  assignToShipmentManager = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { managerId } = req.body;

    if (!managerId) throw new AppError('Manager ID is required', 400);

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);

    if (req.user.role !== 'admin') {
      throw new AppError('Only admin can assign shipments to managers', 403);
    }

    const manager = await User.findById(managerId);
    if (!manager) throw new AppError('User not found', 404);
    if (manager.role !== 'shipment_manager') {
      throw new AppError('Selected user is not a shipment manager', 400);
    }

    shipment.assignedTo = managerId;
    await shipment.save();

    if (req.io) {
      await notificationService.createNotification('shipment_assigned_to_manager', {
        shipmentId:     shipment._id,
        shipmentNumber: shipment.shipmentId || shipment._id,
        managerId:      managerId.toString(),
        managerName:    manager.name,
        managerEmail:   manager.email,
        origin:         shipment.origin,
        destination:    shipment.destination,
        assignedBy:     req.user.name || req.user.email
      }, req.io);
    }

    const populatedShipment = await Shipment.findById(id)
      .populate('assignedTo', 'name email role');

    res.status(200).json({
      success: true,
      message: `Shipment successfully assigned to ${manager.name}`,
      data: {
        shipment: populatedShipment,
        manager: { id: manager._id, name: manager.name, email: manager.email }
      }
    });
  });

  unassignManager = catchAsync(async (req, res) => {
    const { id } = req.params;

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);

    if (req.user.role !== 'admin') {
      throw new AppError('Only admin can unassign managers', 403);
    }

    const previousManagerId = shipment.assignedTo;
    if (!previousManagerId) {
      throw new AppError('No manager assigned to this shipment', 400);
    }

    const previousManager = await User.findById(previousManagerId);

    shipment.assignedTo = null;
    await shipment.save();

    if (req.io && previousManagerId) {
      await notificationService.createNotification('shipment_unassigned_from_manager', {
        shipmentId:     shipment._id,
        shipmentNumber: shipment.shipmentId || shipment._id,
        managerId:      previousManagerId.toString(),
        managerName:    previousManager?.name,
        origin:         shipment.origin,
        destination:    shipment.destination,
        unassignedBy:   req.user.name || req.user.email
      }, req.io);
    }

    const populatedShipment = await Shipment.findById(id)
      .populate('assignedTo', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Manager unassigned successfully',
      data: populatedShipment
    });
  });

  getMyAssignedShipments = catchAsync(async (req, res) => {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = { assignedTo: req.user._id };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [shipments, total] = await Promise.all([
      Shipment.find(filter)
        .populate('truck',       'licensePlate brand model')
        .populate('driver',      'name phone')
        .populate('customer',    'name phone')
        .populate('loadingZone', 'name')
        .populate('createdBy',   'name')
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
        page:  parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  });

  getUnassignedShipments = catchAsync(async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const filter = { assignedTo: null, status: 'pending' };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [shipments, total] = await Promise.all([
      Shipment.find(filter)
        .populate('customer',    'name phone')
        .populate('loadingZone', 'name')
        .populate('createdBy',   'name')
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
        page:  parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  });

  // ============================================================
  // CANCELLATION
  // ============================================================

  cancelShipment = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to cancel this shipment', 403);
    }
    if (shipment.status === 'completed') {
      throw new AppError('Cannot cancel a completed shipment', 400);
    }
    if (shipment.status === 'cancelled') {
      throw new AppError('Shipment is already cancelled', 400);
    }

    // FIX 2: cancelActiveMission handles freeResources + trip
    await shipmentService.cancelActiveMission(id, reason || 'Cancelled by user');

    shipment.status = 'cancelled';
    shipment.truck  = null;
    shipment.driver = null;
    if (reason) shipment.cancellationReason = reason;
    await shipment.save();

    if (req.io) {
      await shipmentService.sendCancellationNotification(shipment, reason, req.io);
    }

    res.status(200).json({
      success: true,
      message: 'Shipment cancelled successfully',
      data: shipment
    });
  });

  // ============================================================
  // NOTES MANAGEMENT
  // ============================================================

  addNote = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) throw new AppError('Note content is required', 400);

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to add notes to this shipment', 403);
    }

    shipment.notes.push({
      content,
      createdBy:     req.user._id,
      createdByName: req.user.name || req.user.email,
      createdAt:     new Date()
    });
    await shipment.save();

    const populatedShipment = await Shipment.findById(id)
      .populate('notes.createdBy', 'name email role');

    const newNote = populatedShipment.notes[populatedShipment.notes.length - 1];

    res.status(201).json({
      success: true,
      message: 'Note added successfully',
      data: newNote
    });
  });

  getNotes = catchAsync(async (req, res) => {
    const { id } = req.params;

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to view notes for this shipment', 403);
    }

    const populatedShipment = await Shipment.findById(id)
      .select('notes')
      .populate('notes.createdBy', 'name email role');

    const transformedNotes = (populatedShipment.notes || []).map(note => {
      const noteObj = note.toObject ? note.toObject() : note;
      return {
        ...noteObj,
        createdBy: noteObj.createdBy || { _id: note.createdBy, name: 'Unknown', role: 'user' }
      };
    });

    res.status(200).json({
      success: true,
      data: transformedNotes.sort((a, b) => b.createdAt - a.createdAt)
    });
  });

  updateNote = catchAsync(async (req, res) => {
    const { id, noteId } = req.params;
    const { content } = req.body;

    if (!content) throw new AppError('Note content is required', 400);

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to update notes for this shipment', 403);
    }

    const noteIndex = shipment.notes.findIndex(n => n._id.toString() === noteId);
    if (noteIndex === -1) throw new AppError('Note not found', 404);

    const note      = shipment.notes[noteIndex];
    const isCreator = note.createdBy.toString() === req.user._id.toString();
    const isAdmin   = req.user.role === 'admin';

    if (!isCreator && !isAdmin) {
      throw new AppError('You can only edit your own notes', 403);
    }

    shipment.notes[noteIndex].content = content;
    await shipment.save();

    const populatedShipment = await Shipment.findById(id)
      .populate('notes.createdBy', 'name email role');

    const updatedNote = populatedShipment.notes.find(n => n._id.toString() === noteId);

    res.status(200).json({
      success: true,
      message: 'Note updated successfully',
      data: updatedNote
    });
  });

  deleteNote = catchAsync(async (req, res) => {
    const { id, noteId } = req.params;

    const shipment = await Shipment.findById(id);
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (!this._checkAccess(shipment, req.user)) {
      throw new AppError('You do not have permission to delete notes for this shipment', 403);
    }

    const noteIndex = shipment.notes.findIndex(n => n._id.toString() === noteId);
    if (noteIndex === -1) throw new AppError('Note not found', 404);

    const note      = shipment.notes[noteIndex];
    const isCreator = note.createdBy.toString() === req.user._id.toString();
    const isAdmin   = req.user.role === 'admin';

    if (!isCreator && !isAdmin) {
      throw new AppError('You can only delete your own notes', 403);
    }

    shipment.notes.splice(noteIndex, 1);
    await shipment.save();

    res.status(200).json({
      success: true,
      message: 'Note deleted successfully'
    });
  });

  // ============================================================
  // FILTERS & QUERIES
  // ============================================================

  getShipmentsByCustomer = catchAsync(async (req, res) => {
    const { customerId } = req.params;
    const shipments = await Shipment.find({ customer: customerId })
      .populate('truck',  'licensePlate')
      .populate('driver', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: shipments.length, data: shipments });
  });

  getShipmentsByStatus = catchAsync(async (req, res) => {
    const { status } = req.params;
    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status', 400);
    }

    const query = this._buildBaseQuery(req.user, { status });
    const shipments = await Shipment.find(query)
      .populate('truck',  'licensePlate brand model')
      .populate('driver', 'name phone')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: shipments.length, data: shipments });
  });

  getShipmentsByTruck = catchAsync(async (req, res) => {
    const { truckId } = req.params;
    const query = this._buildBaseQuery(req.user, { truck: truckId });
    const shipments = await Shipment.find(query)
      .populate('driver', 'name phone')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: shipments.length, data: shipments });
  });

  getShipmentsByDriver = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const query = this._buildBaseQuery(req.user, { driver: driverId });
    const shipments = await Shipment.find(query)
      .populate('truck', 'licensePlate brand model')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: shipments.length, data: shipments });
  });

  getShipmentMission = catchAsync(async (req, res) => {
    const { id } = req.params;
    const mission = await Mission.findOne({ shipment: id })
      .populate('truck',  'licensePlate brand model')
      .populate('driver', 'name phone');

    if (!mission) throw new AppError('No mission found for this shipment', 404);

    res.status(200).json({ success: true, data: mission });
  });

  // ============================================================
  // STATISTICS
  // ============================================================

  getShipmentStats = catchAsync(async (req, res) => {
    const baseQuery = this._buildBaseQuery(req.user, {});

    const [total, pending, assigned, inProgress, completed, cancelled] = await Promise.all([
      Shipment.countDocuments(baseQuery),
      Shipment.countDocuments({ ...baseQuery, status: 'pending' }),
      Shipment.countDocuments({ ...baseQuery, status: 'assigned' }),
      Shipment.countDocuments({ ...baseQuery, status: 'in_progress' }),
      Shipment.countDocuments({ ...baseQuery, status: 'completed' }),
      Shipment.countDocuments({ ...baseQuery, status: 'cancelled' })
    ]);

    res.status(200).json({
      success: true,
      stats: { total, pending, assigned, inProgress, completed, cancelled }
    });
  });
}

module.exports = new ShipmentController();
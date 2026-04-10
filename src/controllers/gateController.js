const Gate = require('../models/Gate');
const AccessLog = require('../models/AccessLog');
const Truck = require('../models/Truck');
const Shipment = require('../models/Shipment');
const Mission = require('../models/Mission');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notificationService');

class GateController {
  
  // ============================================================
  // GATE MANAGEMENT (unchanged)
  // ============================================================
  
  getAllGates = catchAsync(async (req, res) => {
    const { type, zone, isActive } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (zone) filter.zone = zone;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    const gates = await Gate.find(filter)
      .populate('authorizedTrucks', 'licensePlate displayPlate brand model')
      .sort({ zone: 1, type: 1 });
    res.status(200).json({ success: true, count: gates.length, data: gates });
  });
  
  getActiveGates = catchAsync(async (req, res) => {
    const gates = await Gate.find({ isActive: true })
      .select('name type zone currentQueue queueCapacity');
    res.status(200).json({ success: true, count: gates.length, data: gates });
  });
  
  getGate = catchAsync(async (req, res) => {
    const gate = await Gate.findById(req.params.id)
      .populate('authorizedTrucks', 'licensePlate displayPlate brand model status');
    if (!gate) throw new AppError('Gate not found', 404);
    res.status(200).json({ success: true, data: gate });
  });
  
  createGate = catchAsync(async (req, res) => {
    const { name, type, zone, location, queueCapacity, authorizedTrucks, isLoadingZone } = req.body;
    const existingGate = await Gate.findOne({ name });
    if (existingGate) throw new AppError('Gate with this name already exists', 400);
    const gate = await Gate.create({
      name,
      type: type || 'entry',
      zone,
      location,
      queueCapacity: queueCapacity || 30,
      authorizedTrucks: authorizedTrucks || [],
      isActive: true,
      isLoadingZone: isLoadingZone || false   // allow setting loading zone flag
    });
    res.status(201).json({ success: true, message: 'Gate created successfully', data: gate });
  });
  
  updateGate = catchAsync(async (req, res) => {
    const gate = await Gate.findById(req.params.id);
    if (!gate) throw new AppError('Gate not found', 404);
    const updatedGate = await Gate.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('authorizedTrucks', 'licensePlate displayPlate brand model');
    res.status(200).json({ success: true, message: 'Gate updated successfully', data: updatedGate });
  });
  
  deleteGate = catchAsync(async (req, res) => {
    const gate = await Gate.findById(req.params.id);
    if (!gate) throw new AppError('Gate not found', 404);
    const hasLogs = await AccessLog.countDocuments({ gate: gate._id });
    if (hasLogs > 0) throw new AppError('Cannot delete gate with access history', 400);
    await gate.deleteOne();
    res.status(200).json({ success: true, message: 'Gate deleted successfully' });
  });
  
  // ============================================================
  // AUTHORIZED TRUCKS MANAGEMENT (unchanged)
  // ============================================================
  
  getAuthorizedTrucks = catchAsync(async (req, res) => {
    const gate = await Gate.findById(req.params.id)
      .populate('authorizedTrucks', 'licensePlate displayPlate brand model status');
    if (!gate) throw new AppError('Gate not found', 404);
    res.status(200).json({ success: true, count: gate.authorizedTrucks.length, data: gate.authorizedTrucks });
  });
  
  addAuthorizedTruck = catchAsync(async (req, res) => {
    const { truckId } = req.body;
    const [gate, truck] = await Promise.all([Gate.findById(req.params.id), Truck.findById(truckId)]);
    if (!gate) throw new AppError('Gate not found', 404);
    if (!truck) throw new AppError('Truck not found', 404);
    if (gate.authorizedTrucks.includes(truckId)) throw new AppError('Truck is already authorized for this gate', 400);
    gate.authorizedTrucks.push(truckId);
    await gate.save();
    const updatedGate = await Gate.findById(gate._id).populate('authorizedTrucks', 'licensePlate displayPlate brand model');
    res.status(200).json({ success: true, message: 'Truck authorized successfully', data: updatedGate });
  });
  
  removeAuthorizedTruck = catchAsync(async (req, res) => {
    const { id, truckId } = req.params;
    const gate = await Gate.findById(id);
    if (!gate) throw new AppError('Gate not found', 404);
    if (!gate.authorizedTrucks.includes(truckId)) throw new AppError('Truck is not authorized for this gate', 400);
    gate.authorizedTrucks = gate.authorizedTrucks.filter(t => t.toString() !== truckId);
    await gate.save();
    const updatedGate = await Gate.findById(gate._id).populate('authorizedTrucks', 'licensePlate displayPlate brand model');
    res.status(200).json({ success: true, message: 'Truck unauthorized successfully', data: updatedGate });
  });
  
  // ============================================================
  // GATE ACCESS CONTROL (with direct shipment loading tracking)
  // ============================================================
  
requestAccess = catchAsync(async (req, res) => {
  const { licensePlate, gateId, accessType } = req.body;

  if (!licensePlate || !gateId || !accessType) {
    throw new AppError('License plate, gate ID, and access type are required', 400);
  }
  if (!['entry', 'exit'].includes(accessType)) {
    throw new AppError('Access type must be "entry" or "exit"', 400);
  }

  const truck = await Truck.findOne({ licensePlate: licensePlate.toUpperCase() });
  if (!truck) {
    await AccessLog.create({
      gate: gateId,
      truck: null,
      licensePlate,
      accessType,
      status: 'denied',
      reason: 'Truck not found'
    });
    await notificationService.createNotification('access_denied', {
      licensePlate,
      accessType,
      gateName: 'Unknown Gate',
      reason: 'Truck not found in system'
    }, req.app.get('io'));
    throw new AppError('Truck not found', 404);
  }

  const gate = await Gate.findById(gateId);
  if (!gate) throw new AppError('Gate not found', 404);

  // Queue capacity check (only for entry)
  if (accessType === 'entry' && gate.currentQueue >= gate.queueCapacity) {
    await notificationService.createNotification('gate_full', {
      gateName: gate.name,
      currentQueue: gate.currentQueue,
      queueCapacity: gate.queueCapacity
    }, req.app.get('io'));
    throw new AppError('Gate queue is full, please wait', 400);
  }

  // Authorization check
  const isAuthorized = gate.authorizedTrucks.some(t => t.toString() === truck._id.toString());
  const status = isAuthorized ? 'authorized' : 'denied';
  const reason = isAuthorized ? null : 'Truck not authorized for this gate';

  // Create access log
  const accessLog = await AccessLog.create({
    gate: gateId,
    truck: truck._id,
    licensePlate,
    accessType,
    status,
    reason,
    timestamp: new Date()
  });

  if (!isAuthorized) {
    await notificationService.createNotification('access_denied', {
      licensePlate,
      accessType,
      gateName: gate.name,
      reason
    }, req.app.get('io'));
    throw new AppError('Access denied: Truck not authorized for this gate', 403);
  }

  // Update queue counter
  if (accessType === 'entry') {
    gate.currentQueue += 1;
  } else {
    gate.currentQueue = Math.max(0, gate.currentQueue - 1);
  }
  await gate.save();

  // ============================================================
  // LOADING DURATION TRACKING (FIXED)
  // ============================================================
  if (gate.isLoadingZone) {
    if (accessType === 'entry') {
      const mission = await Mission.findOne({ truck: truck._id, status: 'in_progress' });
      if (mission) {
        const shipment = await Shipment.findById(mission.shipment);
        if (shipment && !shipment.loadingStartedAt) {
          await Shipment.findByIdAndUpdate(shipment._id, {
            loadingStartedAt: new Date()
          });
        }
      }
    } else if (accessType === 'exit') {
      const mission = await Mission.findOne({ truck: truck._id, status: 'in_progress' });
      if (mission) {
        const shipment = await Shipment.findById(mission.shipment);
        if (shipment && shipment.loadingStartedAt && !shipment.loadingCompletedAt) {
          const completedAt = new Date();
          const actualMinutes = (completedAt - shipment.loadingStartedAt) / (1000 * 60);
          
          // ✅ Convert planned duration to number (safely)
          const plannedMinutes = Number(shipment.plannedLoadingDurationMinutes);
          
          await Shipment.findByIdAndUpdate(shipment._id, {
            loadingCompletedAt: completedAt,
            actualLoadingDurationMinutes: actualMinutes
          });

          // ✅ Overtime notification (only if plannedMinutes is valid and actual > planned)
          if (!isNaN(plannedMinutes) && actualMinutes > plannedMinutes) {
            await notificationService.createNotification('loading_overtime', {
              truckLicense: truck.licensePlate,
              gateName: gate.name,
              plannedMinutes: plannedMinutes,
              actualMinutes: actualMinutes,
              overtimeMinutes: actualMinutes - plannedMinutes
            }, req.app.get('io'));
          }
        }
      }
    }
  }

  res.status(200).json({
    success: true,
    message: `${accessType} ${status}`,
    data: {
      authorized: true,
      gate: {
        id: gate._id,
        name: gate.name,
        type: gate.type,
        currentQueue: gate.currentQueue,
        queueCapacity: gate.queueCapacity
      },
      truck: {
        id: truck._id,
        licensePlate: truck.licensePlate,
        brand: truck.brand,
        model: truck.model
      },
      accessLog
    }
  });
});
  // ============================================================
  // ACCESS LOGS & QUEUE (unchanged)
  // ============================================================
  
  getAccessLogs = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 50, status, accessType, startDate, endDate } = req.query;
    const gate = await Gate.findById(id);
    if (!gate) throw new AppError('Gate not found', 404);
    const filter = { gate: id };
    if (status) filter.status = status;
    if (accessType) filter.accessType = accessType;
    if (startDate) filter.timestamp = { $gte: new Date(startDate) };
    if (endDate) filter.timestamp = { ...filter.timestamp, $lte: new Date(endDate) };
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      AccessLog.find(filter)
        .populate('truck', 'licensePlate displayPlate brand model')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AccessLog.countDocuments(filter)
    ]);
    res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }
    });
  });
  
  getGateQueue = catchAsync(async (req, res) => {
    const gate = await Gate.findById(req.params.id).select('name type currentQueue queueCapacity');
    if (!gate) throw new AppError('Gate not found', 404);
    const occupancyPercent = (gate.currentQueue / gate.queueCapacity) * 100;
    res.status(200).json({
      success: true,
      data: {
        gateId: gate._id,
        gateName: gate.name,
        gateType: gate.type,
        currentQueue: gate.currentQueue,
        queueCapacity: gate.queueCapacity,
        availableSpots: gate.queueCapacity - gate.currentQueue,
        occupancyPercent: occupancyPercent.toFixed(1),
        status: occupancyPercent > 80 ? 'busy' : occupancyPercent > 50 ? 'moderate' : 'free'
      }
    });
  });
  
  // ============================================================
  // STATISTICS
  // ============================================================
  
  getGateStats = catchAsync(async (req, res) => {
    const [total, active, entryGates, exitGates] = await Promise.all([
      Gate.countDocuments(),
      Gate.countDocuments({ isActive: true }),
      Gate.countDocuments({ type: 'entry' }),
      Gate.countDocuments({ type: 'exit' })
    ]);
    const queueStats = await Gate.aggregate([
      { $group: { _id: null, totalQueue: { $sum: '$currentQueue' }, totalCapacity: { $sum: '$queueCapacity' } } }
    ]);
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const [todayEntries, todayExits, todayAuthorized, todayDenied] = await Promise.all([
      AccessLog.countDocuments({ accessType: 'entry', timestamp: { $gte: today, $lt: tomorrow } }),
      AccessLog.countDocuments({ accessType: 'exit', timestamp: { $gte: today, $lt: tomorrow } }),
      AccessLog.countDocuments({ status: 'authorized', timestamp: { $gte: today, $lt: tomorrow } }),
      AccessLog.countDocuments({ status: 'denied', timestamp: { $gte: today, $lt: tomorrow } })
    ]);
    res.status(200).json({
      success: true,
      data: {
        gates: { total, active, entryGates, exitGates },
        queue: {
          totalCurrent: queueStats[0]?.totalQueue || 0,
          totalCapacity: queueStats[0]?.totalCapacity || 0,
          utilizationRate: queueStats[0]?.totalCapacity > 0 ? ((queueStats[0].totalQueue / queueStats[0].totalCapacity) * 100).toFixed(1) : 0
        },
        today: { entries: todayEntries, exits: todayExits, authorized: todayAuthorized, denied: todayDenied, totalAccess: todayEntries + todayExits }
      }
    });
  });
}

module.exports = new GateController();
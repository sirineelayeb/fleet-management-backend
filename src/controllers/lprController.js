const LprService = require('../services/lprService');
const AppError   = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const LprEvent = require('../models/LprEvent');
class LprController {

  // POST /api/lpr/detect
  detect = catchAsync(async (req, res) => {
    const { plateNumber, direction, cameraId, loadingZone, confidence, source } = req.body;

    if (!plateNumber) throw new AppError('plateNumber is required', 400);
    if (!direction)   throw new AppError('direction is required (entry | exit)', 400);
    if (!['entry', 'exit'].includes(direction)) throw new AppError('direction must be entry or exit', 400);

    // Get io from app — same pattern as TruckService
    const io = req.app.get('io');

    const event = await LprService.detect(
      { plateNumber, direction, cameraId, loadingZone, confidence, source },
      io   // ← pass io here
    );

    res.status(201).json({
      success: true,
      message: `Plate ${plateNumber} logged as ${direction}`,
      data: event
    });
  });

  // GET /api/lpr/validate/:plate
  validate = catchAsync(async (req, res) => {
    const result = await LprService.validate(req.params.plate);
    res.status(200).json({ success: true, data: result });
  });

  // GET /api/lpr/events
  getEvents = catchAsync(async (req, res) => {
    const { plate, direction, from, to, page, limit } = req.query;
    const result = await LprService.getEvents({ plate, direction, from, to, page, limit });
    res.status(200).json({ success: true, ...result });
  });

  // GET /api/lpr/stats
  getStats = catchAsync(async (req, res) => {
    const stats = await LprService.getStats();
    res.status(200).json({ success: true, stats });
  });

  // GET /api/lpr/shipment/:shipmentId/events
  getEventsByShipment = catchAsync(async (req, res) => {
    const result = await LprService.getEventsByShipment(req.params.shipmentId);
    res.status(200).json({ success: true, data: result });
  });

  // DELETE /api/lpr/events/:id
  deleteEvent = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const result = await LprService.deleteEvent(
      id, 
      req.user._id, 
      req.user.role
    );
    
    res.status(200).json({
      success: true,
      message: result.message
    });
  });

  // DELETE /api/lpr/events
  // Body: { filter: { plateNumber: "123 TN 4567", direction: "entry", etc. } }
  deleteEventsBulk = catchAsync(async (req, res) => {
    const { filter } = req.body;
    
    if (!filter || Object.keys(filter).length === 0) {
      throw new AppError('Filter is required for bulk delete', 400);
    }
    
    const result = await LprService.deleteEventsByFilter(
      filter,
      req.user._id,
      req.user.role
    );
    
    res.status(200).json({
      success: true,
      deletedCount: result.deletedCount,
      message: result.message
    });
  });

  // DELETE /api/lpr/events/clear-old
  // Clear events older than specified days
  clearOldEvents = catchAsync(async (req, res) => {
    const days       = parseInt(req.query.days) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await LprEvent.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    res.status(200).json({
      success:      true,
      deletedCount: result.deletedCount,
      message:      `Deleted ${result.deletedCount} events older than ${days} days`
    });
  });
  
}
module.exports = new LprController();
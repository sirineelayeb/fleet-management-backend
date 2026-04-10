const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class NotificationController {
  
  // GET /api/notifications
  getAll = catchAsync(async (req, res) => {
    const { page = 1, limit = 50, read, severity, type, startDate, endDate } = req.query;
    
    const filters = {};
    
    if (read !== undefined) filters.read = read === 'true';
    if (severity) filters.severity = severity;
    if (type) filters.type = type;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    // ✅ Pass user role to service for filtering
    const result = await notificationService.getNotifications(
      filters, 
      parseInt(page), 
      parseInt(limit),
      req.user.role
    );
    
    res.status(200).json({
      success: true,
      count: result.notifications.length,
      data: result.notifications,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        pages: result.pages
      }
    });
  });
  
  // GET /api/notifications/unread/count
  getUnreadCount = catchAsync(async (req, res) => {
    const count = await notificationService.getUnreadCount(req.user.role);
    
    res.status(200).json({
      success: true,
      data: {
        unread: count
      }
    });
  });
  
  // PUT /api/notifications/:id/read
  markAsRead = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const notification = await notificationService.markAsRead(id, req.user._id);
    
    if (!notification) {
      throw new AppError('Notification not found', 404);
    }
    
    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  });
  
  // PUT /api/notifications/read-all
  markAllAsRead = catchAsync(async (req, res) => {
    // ✅ Pass user role to only mark notifications visible to this user
    await notificationService.markAllAsRead(req.user.role);
    
    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  });
  
  // PUT /api/notifications/:id/resolve
  resolve = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const notification = await notificationService.resolveNotification(id, req.user._id);
    
    if (!notification) {
      throw new AppError('Notification not found', 404);
    }
    
    res.status(200).json({
      success: true,
      message: 'Notification resolved',
      data: notification
    });
  });
  
  // DELETE /api/notifications/:id
  delete = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const notification = await notificationService.deleteNotification(id);
    
    if (!notification) {
      throw new AppError('Notification not found', 404);
    }
    
    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  });
}

module.exports = new NotificationController();
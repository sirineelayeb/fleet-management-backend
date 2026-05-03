const Notification       = require('../models/Notification');
const notificationService = require('../services/notificationService');
const catchAsync          = require('../utils/catchAsync');
const AppError            = require('../utils/AppError');

class NotificationController {

  // GET /api/notifications
  getAll = catchAsync(async (req, res) => {
    const { page = 1, limit = 50, read, severity, type, startDate, endDate } = req.query;

    const filters = {};
    if (read      !== undefined) filters.read      = read;
    if (severity)                filters.severity  = severity;
    if (type)                    filters.type      = type;
    if (startDate)               filters.startDate = startDate;
    if (endDate)                 filters.endDate   = endDate;

    const result = await notificationService.getNotifications(
      filters,
      Number(page),
      Number(limit),
      req.user.role,
      req.user._id,
    );

    res.status(200).json({
      success: true,
      count:   result.notifications.length,
      data:    result.notifications,
      pagination: {
        page:  result.page,
        limit: result.limit,
        total: result.total,
        pages: result.pages,
      },
    });
  });

  // GET /api/notifications/unread/count
  getUnreadCount = catchAsync(async (req, res) => {
    const count = await notificationService.getUnreadCount(req.user.role, req.user._id);

    res.status(200).json({
      success: true,
      data: { unread: count },
    });
  });

  // PUT /api/notifications/:id/read
  markAsRead = catchAsync(async (req, res) => {
    const notification = await notificationService.markAsRead(req.params.id, req.user._id);
    if (!notification) throw new AppError('Notification not found', 404);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data:    notification,
    });
  });

  // PUT /api/notifications/read-all
  // Available to both admins and managers — each sees only their own scope.
  markAllAsRead = catchAsync(async (req, res) => {
    const result = await notificationService.markAllAsRead(req.user.role, req.user._id);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      data:    result,
    });
  });

  // PUT /api/notifications/:id/resolve
  resolve = catchAsync(async (req, res) => {
    const notification = await notificationService.resolveNotification(req.params.id, req.user._id);
    if (!notification) throw new AppError('Notification not found', 404);

    res.status(200).json({
      success: true,
      message: 'Notification resolved',
      data:    notification,
    });
  });

  // DELETE /api/notifications/:id  (admin only)
  delete = catchAsync(async (req, res) => {
    const notification = await Notification.findByIdAndDelete(req.params.id);
    if (!notification) throw new AppError('Notification not found', 404);

    res.status(200).json({ success: true, message: 'Notification deleted successfully' });
  });

  // DELETE /api/notifications  (admin only — bulk)
  deleteAll = catchAsync(async (req, res) => {
    const result = await notificationService.deleteAllNotifications(req.user.role);

    res.status(200).json({
      success:      result.success,
      message:      `${result.deletedCount} notification(s) deleted`,
      deletedCount: result.deletedCount,
    });
  });
}

module.exports = new NotificationController();
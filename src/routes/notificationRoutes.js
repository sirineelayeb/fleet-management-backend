// backend/src/routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect, restrictTo } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// ============================================================
// STATIC ROUTES (must come before :id routes)
// ============================================================

// Get unread count (most specific first)
router.get('/unread/count', protect, notificationController.getUnreadCount);

// Mark all as read
router.put('/read-all', restrictTo('admin'), notificationController.markAllAsRead);

// ============================================================
// COLLECTION ROUTES
// ============================================================

// Get all notifications (with filters)
router.get('/', protect, restrictTo('admin', 'shipment_manager'), notificationController.getAll);

// ============================================================
// DYNAMIC ROUTES (with :id) - MUST BE LAST
// ============================================================

// Mark single notification as read
router.put('/:id/read', restrictTo('admin', 'shipment_manager'), notificationController.markAsRead);

// Resolve notification (for critical alerts)
router.put('/:id/resolve', restrictTo('admin'), notificationController.resolve);

// Delete notification (admin only)
router.delete('/:id', restrictTo('admin'), notificationController.delete);

module.exports = router;
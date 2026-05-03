const express    = require('express');
const router     = express.Router();
const notificationController       = require('../controllers/notificationController');
const { protect, restrictTo } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// ── Static routes (must be declared before /:id) ──────────────────────────

// Both admins and managers can fetch their notifications
router.get('/',                restrictTo('admin', 'shipment_manager'), notificationController.getAll);

// Both can see their own unread count
router.get('/unread/count',    restrictTo('admin', 'shipment_manager'), notificationController.getUnreadCount);

// Both can mark all of their notifications as read
router.put('/read-all',        restrictTo('admin', 'shipment_manager'), notificationController.markAllAsRead);

// Admin bulk-delete
router.delete('/',             restrictTo('admin'), notificationController.deleteAll);

// ── Dynamic /:id routes ───────────────────────────────────────────────────

// Both can mark a single notification as read
router.put('/:id/read',        restrictTo('admin', 'shipment_manager'), notificationController.markAsRead);

// Only admins can resolve or delete individual notifications
router.put('/:id/resolve',     restrictTo('admin'), notificationController.resolve);
router.delete('/:id',          restrictTo('admin'), notificationController.delete);

module.exports = router;
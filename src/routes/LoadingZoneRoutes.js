const express = require('express');
const router = express.Router();
const loadingZoneController = require('../controllers/loadingZoneController');
const { protect, restrictTo } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// ============================================================
// PUBLIC ROUTES (for all authenticated users)
// ============================================================
router.get('/', loadingZoneController.getAllLoadingZones);
router.get('/active', loadingZoneController.getActiveLoadingZones);
router.get('/stats', loadingZoneController.getStats);
router.get('/:id', loadingZoneController.getLoadingZone);

// ============================================================
// ADMIN ONLY ROUTES
// ============================================================
router.post('/', restrictTo('admin'), loadingZoneController.createLoadingZone);
router.put('/:id', restrictTo('admin'), loadingZoneController.updateLoadingZone);
router.delete('/:id', restrictTo('admin'), loadingZoneController.deleteLoadingZone);
router.post('/bulk-update-status', restrictTo('admin'), loadingZoneController.bulkUpdateStatus);

module.exports = router;
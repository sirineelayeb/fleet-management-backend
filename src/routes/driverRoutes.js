// backend/src/routes/driverRoutes.js
const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');
const { protect, restrictTo } = require('../middlewares/auth');
const upload = require('../config/upload');

// All routes require authentication
router.use(protect);

// ============================================================
// STATIC ROUTES (must come before :id routes)
// ============================================================
router.get('/available', driverController.getAvailableDrivers);
router.get('/stats', restrictTo('admin'), driverController.getDriverStats);
router.get('/history/all', restrictTo('admin'), driverController.getAllDriversWithHistory);
router.get('/score-config', restrictTo('admin'), driverController.getScoreConfig);
router.put('/score-config', restrictTo('admin'), driverController.updateScoreConfig);

// ============================================================
// COLLECTION ROUTES
// ============================================================
router
  .route('/')
  .get(driverController.getAllDrivers)
  .post(restrictTo('admin'), driverController.createDriver);

// ============================================================
// DYNAMIC ROUTES (with :id parameter)
// ============================================================
router.get('/:id/history', restrictTo('admin'), driverController.getDriverHistory);
router.get('/:id/truck-history', restrictTo('admin'), driverController.getDriverTruckHistory);
router.patch('/:id/status', restrictTo('admin', 'shipment_manager'), driverController.updateDriverStatus);
router.get('/:id/score-logs', restrictTo('admin'), driverController.getDriverScoreLogs);
router.post('/:id/adjust-score', restrictTo('admin'), driverController.manualAdjustScore);
router
  .route('/:id')
  .get(driverController.getDriver)
  .put(restrictTo('admin'), driverController.updateDriver)
  .delete(restrictTo('admin'), driverController.deleteDriver);

// ============================================================
// PHOTO ROUTES
// ============================================================
router
  .route('/:id/photo')
  .post(restrictTo('admin'), upload.single('photo'), driverController.uploadPhoto)
  .delete(restrictTo('admin'), driverController.deletePhoto);

module.exports = router;
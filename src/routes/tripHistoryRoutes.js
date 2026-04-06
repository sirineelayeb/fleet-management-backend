// backend/src/routes/tripHistoryRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const tripHistoryController = require('../controllers/tripHistoryController');

router.use(protect);

// ============================================================
// ALL STATIC ROUTES (no :id parameters)
// ============================================================
router.get('/all', tripHistoryController.getAllTrips);
router.get('/stats', restrictTo('admin'), tripHistoryController.getTripStats);
router.get('/live/:truckId', tripHistoryController.getLiveTracking);
router.get('/driver/:driverId/stats', tripHistoryController.getDriverTripStats);
router.get('/truck/:truckId/stats', tripHistoryController.getTruckTripStats);
router.get('/truck/:truckId', tripHistoryController.getTruckTrips);
router.get('/driver/:driverId', tripHistoryController.getDriverTrips);

// ============================================================
// ROUTES WITH :id (but different paths)
// ============================================================
router.get('/trip/:id/map-data', tripHistoryController.getTripMapData);
router.get('/trip/:id/route', tripHistoryController.getTripRoute);
router.get('/trip/:id', tripHistoryController.getTripWithRoute);

module.exports = router;
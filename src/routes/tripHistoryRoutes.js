const express = require('express');
const router = express.Router();
const tripHistoryController = require('../controllers/tripHistoryController');
const { protect } = require('../middlewares/auth');

// Public / summary routes
router.get('/all', protect, tripHistoryController.getAllTrips);
router.get('/stats', tripHistoryController.getTripStats);

// Live tracking
router.get('/live/:truckId', tripHistoryController.getLiveTracking);

// Truck-specific
router.get('/truck/:truckId', tripHistoryController.getTruckTrips);
router.get('/truck/:truckId/stats', tripHistoryController.getTruckTripStats);

// Driver-specific
router.get('/driver/:driverId', tripHistoryController.getDriverTrips);
router.get('/driver/:driverId/stats', tripHistoryController.getDriverTripStats);

// Individual trip routes (order matters: /:id/route before /:id)
router.get('/:id/map-data', tripHistoryController.getTripMapData);
router.get('/:id/route', tripHistoryController.getTripRoute);
router.get('/:id', tripHistoryController.getTripWithRoute);

module.exports = router;
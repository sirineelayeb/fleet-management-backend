// backend/src/routes/trackingRoutes.js
const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');
const { protect } = require('../middlewares/auth');

// ============================================================
// ALL ROUTES REQUIRE AUTHENTICATION
// ============================================================
router.use(protect);

// ============================================================
// LIVE TRACKING (For dashboard map)
// ============================================================
router.get('/live', trackingController.getLiveTracking);
router.get('/live/truck/:truckId', trackingController.getTruckLiveLocation);

// ============================================================
// LOCATION HISTORY (For reports and playback)
// ============================================================
router.get('/truck/:truckId', trackingController.getTruckLocations);
router.get('/history/truck/:truckId', trackingController.getTruckHistory);
router.get('/summary/truck/:truckId', trackingController.getTruckTrackingSummary);

module.exports = router;
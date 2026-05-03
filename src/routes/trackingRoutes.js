const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');
const { protect, restrictTo } = require('../middlewares/auth');

// =====================
// LIVE TRACKING
// =====================
// Get all live truck locations
router.get('/live', protect, restrictTo('admin', 'shipment_manager'), trackingController.getLiveTracking);

// Get live location for a specific truck
router.get('/live/truck/:truckId', protect, restrictTo('admin', 'shipment_manager'), trackingController.getTruckLiveLocation);

// =====================
// TRACKING HISTORY
// =====================
// Get location history for a specific truck
router.get('/truck/:truckId/history', protect, restrictTo('admin', 'shipment_manager'), trackingController.getTruckLocations);

// Get route/path for a specific truck (for map display)
router.get('/truck/:truckId/route', protect, restrictTo('admin', 'shipment_manager'), trackingController.getTruckRoute);

// =====================
// SHIPMENT TRACKING
// =====================
// Get current location for a shipment (via its assigned truck)
router.get('/shipment/:shipmentId/location', protect, restrictTo('admin', 'shipment_manager'), trackingController.getShipmentLocation);

// =====================
// UTILITIES
// =====================
// Reverse geocoding (convert lat/lng to address)
router.get('/reverse-geocode', protect, restrictTo('admin', 'shipment_manager'), trackingController.reverseGeocode);

module.exports = router;
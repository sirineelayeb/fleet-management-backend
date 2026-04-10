// backend/src/routes/truckRoutes.js
const express = require('express');
const router = express.Router();
const truckController = require('../controllers/truckController');
const { protect, restrictTo } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// ============================================================
//  STATIC ROUTES (NO :id parameters) - MUST BE FIRST
// ============================================================
router.get('/stats', truckController.getTruckStats);
router.get('/active', truckController.getActiveTrucks);
router.get('/available', truckController.getAvailableTrucks);

// ============================================================
//  COLLECTION ROUTE
// ============================================================
router.route('/')
  .get(truckController.getAllTrucks)
  .post(restrictTo('admin'), truckController.createTruck);

// ============================================================
//  TRUCK ACTIONS (with :id but specific paths)
// ============================================================
router.get('/:id/device', truckController.getTruckDevice);
router.post('/:id/location', truckController.updateLocation);
router.put('/:id/status', restrictTo('shipment_manager', 'admin'), truckController.updateTruckStatus);
router.post('/:id/assign-driver', restrictTo('shipment_manager', 'admin'), truckController.assignDriver);
router.delete('/:id/unassign-driver', restrictTo('shipment_manager', 'admin'), truckController.unassignDriver);
router.post('/:id/assign-device', restrictTo('shipment_manager', 'admin'), truckController.assignDevice);
router.delete('/:id/unassign-device/:deviceId', restrictTo('shipment_manager', 'admin'), truckController.unassignDevice);

// ============================================================
//  DYNAMIC ROUTES (with :id) - MUST BE LAST
// ============================================================
router.get('/:id', truckController.getTruck);
router.put('/:id', restrictTo('admin'), truckController.updateTruck);
router.delete('/:id', restrictTo('admin'), truckController.deleteTruck);

module.exports = router;
const express = require('express');
const router = express.Router();
const shipmentController = require('../controllers/shipmentController');
const { protect, restrictTo } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// ============================================================
// STATIC ROUTES (must come before :id routes)
// ============================================================
router.get('/stats', shipmentController.getShipmentStats);
router.get('/status/:status', shipmentController.getShipmentsByStatus);
router.get('/truck/:truckId', shipmentController.getShipmentsByTruck);
router.get('/driver/:driverId', shipmentController.getShipmentsByDriver);

// ============================================================
// ASSIGNMENT ROUTES
// ============================================================
router.post('/assign', 
  restrictTo('shipment_manager', 'admin'), 
  shipmentController.assignShipment
);

// ============================================================
// MISSION ROUTES
// ============================================================
// router.post('/start-mission', 
//   restrictTo('shipment_manager', 'admin'), 
//   shipmentController.startMission
// );

// router.post('/complete-mission', 
//   restrictTo('shipment_manager', 'admin'), 
//   shipmentController.completeMission
// );

// ============================================================
// COLLECTION ROUTES
// ============================================================
router
  .route('/')
  .get(shipmentController.getAllShipments)
  .post(restrictTo('shipment_manager', 'admin'), shipmentController.createShipment);

// ============================================================
// DYNAMIC ROUTES (with :id parameter)
// ============================================================
router.get('/:id/mission', shipmentController.getShipmentMission);
router.put('/:id/cancel', restrictTo('shipment_manager', 'admin'), shipmentController.cancelShipment);
router
  .route('/:id')
  .get(shipmentController.getShipment)
  .put(restrictTo('shipment_manager', 'admin'), shipmentController.updateShipment)
  .delete(restrictTo('admin'), shipmentController.deleteShipment);
  
  router.put('/:id/loading-duration', restrictTo('shipment_manager', 'admin'), shipmentController.updateLoadingDuration);

module.exports = router;
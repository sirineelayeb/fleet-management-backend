const express = require('express');
const router = express.Router();
const shipmentController = require('../controllers/shipmentController');
const { protect, restrictTo } = require('../middlewares/auth');

router.use(protect);

// ============================================================
// STATIC ROUTES (must come before :id routes)
// ============================================================
router.get('/stats', shipmentController.getShipmentStats);
router.get('/status/:status', shipmentController.getShipmentsByStatus);
router.get('/truck/:truckId', shipmentController.getShipmentsByTruck);
router.get('/driver/:driverId', shipmentController.getShipmentsByDriver);
router.get('/customer/:customerId', shipmentController.getShipmentsByCustomer);

// ============================================================
// MANAGER ASSIGNMENT ROUTES (Admin only)
// ============================================================
router.get('/unassigned', 
  restrictTo('admin'), 
  shipmentController.getUnassignedShipments
);
router.get('/my-assigned', 
  restrictTo('shipment_manager'), 
  shipmentController.getMyAssignedShipments
);
router.put('/:id/assign-manager', 
  restrictTo('admin'), 
  shipmentController.assignToShipmentManager
);
router.delete('/:id/unassign-manager', 
  restrictTo('admin'), 
  shipmentController.unassignManager
);
router.patch('/:id/reassign',
  protect,
  restrictTo('admin', 'shipment_manager'),
  shipmentController.reassignShipment
);
// ============================================================
// TRUCK & DRIVER ASSIGNMENT ROUTES
// ============================================================
router.post('/assign', 
  restrictTo('shipment_manager', 'admin'), 
  shipmentController.assignShipment
);
router.post('/:id/unassign', 
  restrictTo('shipment_manager', 'admin'), 
  shipmentController.unassignShipment
);

// ============================================================
// NOTES ROUTES
// ============================================================
router.post('/:id/notes', 
  restrictTo('shipment_manager', 'admin'), 
  shipmentController.addNote
);
router.get('/:id/notes', shipmentController.getNotes);
router.put('/:id/notes/:noteId', 
  restrictTo('shipment_manager', 'admin'), 
  shipmentController.updateNote);
router.delete('/:id/notes/:noteId', 
  restrictTo('shipment_manager', 'admin'), 
  shipmentController.deleteNote
);

// ============================================================
// MISSION ROUTES
// ============================================================
router.get('/:id/mission', shipmentController.getShipmentMission);

// ============================================================
// CANCEL ROUTE
// ============================================================
router.put('/:id/cancel', 
  restrictTo('shipment_manager', 'admin'), 
  shipmentController.cancelShipment
);

// ============================================================
// MAIN CRUD ROUTES
// ============================================================
router.route('/')
  .get(shipmentController.getAllShipments)
  .post(restrictTo('shipment_manager', 'admin'), shipmentController.createShipment);

// ============================================================
// DYNAMIC ROUTES (with :id parameter) - MUST BE LAST
// ============================================================
router.route('/:id')
  .get(shipmentController.getShipment)
  .put(restrictTo('shipment_manager', 'admin'), shipmentController.updateShipment)
  .delete(restrictTo('admin'), shipmentController.deleteShipment);

module.exports = router;
const express = require('express');
const router = express.Router();
const truckController = require('../controllers/truckController');
const { protect, restrictTo } = require('../middlewares/auth');

router.use(protect);

// Static routes (no :id)
router.get('/stats', truckController.getTruckStats);
router.get('/active', truckController.getActiveTrucks);
router.get('/available', truckController.getAvailableTrucks);

// Collection routes
router.route('/')
  .get(truckController.getAllTrucks)
  .post(restrictTo('admin'), truckController.createTruck);

// Action routes (specific paths)
router.get('/:id/device', truckController.getTruckDevice);
router.post('/:id/location', truckController.updateLocation);
router.put('/:id/status', restrictTo('shipment_manager', 'admin'), truckController.updateTruckStatus);
router.post('/:id/assign-driver', restrictTo('shipment_manager', 'admin'), truckController.assignDriver);
router.delete('/:id/unassign-driver', restrictTo('shipment_manager', 'admin'), truckController.unassignDriver);
router.post('/:id/assign-device', restrictTo('shipment_manager', 'admin'), truckController.assignDevice);
router.delete('/:id/unassign-device/:deviceId', restrictTo('shipment_manager', 'admin'), truckController.unassignDevice);
router.get('/:id/driver-history', protect, truckController.getDriverAssignmentHistory);


// Dynamic routes (with :id) - MUST BE LAST
router.get('/:id', truckController.getTruck);
router.put('/:id', restrictTo('admin'), truckController.updateTruck);
router.delete('/:id', restrictTo('admin'), truckController.deleteTruck);

module.exports = router;
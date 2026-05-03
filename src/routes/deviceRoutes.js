// backend/src/routes/deviceRoutes.js

const express = require('express');
const router = express.Router();

const deviceController = require('../controllers/deviceController');
const { protect, restrictTo } = require('../middlewares/auth');

// ============================================================
// PUBLIC ROUTES (IoT devices)
// ============================================================
router.post('/tracking', deviceController.handleTrackingData);

// ============================================================
// PROTECTED ROUTES (ADMIN ONLY)
// ============================================================
router.use(protect);

// Device management
router.get('/', restrictTo('admin'), deviceController.getAllDevices);
router.get('/:id', restrictTo('admin'), deviceController.getDevice);

router.post('/register', restrictTo('admin'), deviceController.registerDevice);

router.put('/:id', restrictTo('admin'), deviceController.updateDevice);
router.delete('/:id', restrictTo('admin'), deviceController.deleteDevice);

// 🚛 Truck assignment
router.post(
  '/:id/assign-truck',
  restrictTo('admin'),
  deviceController.assignToTruck
);

router.patch(
  '/:id/unassign',
  restrictTo('admin'),
  deviceController.unassignFromTruck
);

module.exports = router;
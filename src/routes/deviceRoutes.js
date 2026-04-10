// backend/src/routes/deviceRoutes.js
const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { protect, restrictTo } = require('../middlewares/auth');

// ============================================================
// PUBLIC ROUTES (No authentication - for ESP32 hardware)
// ============================================================
router.post('/tracking', deviceController.handleTrackingData);

// ============================================================
// PROTECTED ROUTES (Admin only)
// ============================================================
router.use(protect);

router.get('/', restrictTo('admin'), deviceController.getAllDevices);
router.get('/:id', restrictTo('admin'), deviceController.getDevice);
router.post('/register', restrictTo('admin'), deviceController.registerDevice);
router.put('/:id', restrictTo('admin'), deviceController.updateDevice);
router.delete('/:id', restrictTo('admin'), deviceController.deleteDevice);
router.post('/:id/assign-truck', restrictTo('admin'), deviceController.assignToTruck);
router.patch('/:id/unassign', deviceController.unassignFromTruck);
module.exports = router;
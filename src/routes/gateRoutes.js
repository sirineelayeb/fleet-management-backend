const express = require('express');
const router = express.Router();
const gateController = require('../controllers/gateController');
const { protect, restrictTo } = require('../middlewares/auth');

router.use(protect);

// ============================================================
// STATIC ROUTES (must come before :id)
// ============================================================
router.get('/stats', restrictTo('admin'), gateController.getGateStats);
router.get('/active', gateController.getActiveGates);

// ============================================================
// GATE ACCESS (only POST)
// ============================================================
router.post('/access', gateController.requestAccess); 

// ============================================================
// GATE MANAGEMENT
// ============================================================
router.route('/')
  .get(gateController.getAllGates)
  .post(restrictTo('admin'), gateController.createGate);

// ============================================================
// GATE QUEUE & LOGS
// ============================================================
router.get('/:id/queue', gateController.getGateQueue);
router.get('/:id/access-logs', restrictTo('admin'), gateController.getAccessLogs);
router.get('/:id/authorized-trucks', gateController.getAuthorizedTrucks);

// ============================================================
// AUTHORIZED TRUCKS MANAGEMENT
// ============================================================
router.post('/:id/authorize-truck', restrictTo('admin'), gateController.addAuthorizedTruck);
router.delete('/:id/authorize-truck/:truckId', restrictTo('admin'), gateController.removeAuthorizedTruck);

// ============================================================
// DYNAMIC ROUTES (must be last)
// ============================================================
router.route('/:id')
  .get(gateController.getGate)
  .put(restrictTo('admin'), gateController.updateGate)
  .delete(restrictTo('admin'), gateController.deleteGate);

module.exports = router;
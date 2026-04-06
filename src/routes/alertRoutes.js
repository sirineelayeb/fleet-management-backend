const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const { protect, restrictTo } = require('../middlewares/auth');

router.use(protect);

router.get('/', alertController.getAllAlerts);
router.get('/stats', alertController.getAlertStats);
router.get('/:id', alertController.getAlert);
router.post('/', restrictTo('admin'), alertController.createAlert);
router.post('/check-speed', alertController.checkForSpeedAlert);
router.put('/:id/acknowledge', alertController.acknowledgeAlert);
router.put('/:id/resolve', alertController.resolveAlert);

module.exports = router;
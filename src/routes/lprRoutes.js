const router = require('express').Router();
const lprController = require('../controllers/lprController');
const { protect, restrictTo } = require('../middlewares/auth');
const lprAuth = require('../middlewares/lprAuth'); 


router.post('/detect', lprAuth, lprController.detect);

router.get('/validate/:plate', protect, lprController.validate);
router.get('/events', protect, lprController.getEvents);
router.get('/stats', protect, lprController.getStats);
router.get('/shipment/:shipmentId/events', protect, lprController.getEventsByShipment);

router.delete('/events/:id', protect, restrictTo('admin'), lprController.deleteEvent);
router.delete('/events', protect, restrictTo('admin'), lprController.deleteEventsBulk);
router.delete('/events/clear-old', protect, restrictTo('admin'), lprController.clearOldEvents);

module.exports = router;
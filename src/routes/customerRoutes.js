const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { protect, restrictTo } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// ============================================================
// STATIC ROUTES (must come before :id routes)
// ============================================================
router.get('/stats', restrictTo('admin', 'shipment_manager'), customerController.getCustomerStats);
router.get('/search', customerController.searchCustomers);
router.post('/bulk-import', restrictTo('admin'), customerController.bulkImportCustomers);

// ============================================================
// MAIN CRUD ROUTES
// ============================================================
router.route('/')
  .get(restrictTo('admin', 'shipment_manager'), customerController.getAllCustomers)
  .post(restrictTo('admin', 'shipment_manager'), customerController.createCustomer);

// ============================================================
// ARCHIVE/RESTORE ROUTES
// ============================================================
router.patch('/:id/archive', restrictTo('admin', 'shipment_manager'), customerController.archiveCustomer);
router.patch('/:id/restore', restrictTo('admin', 'shipment_manager'), customerController.restoreCustomer);

// ============================================================
// DYNAMIC ROUTES (with :id parameter)
// ============================================================
router.route('/:id')
  .get(restrictTo('admin', 'shipment_manager'), customerController.getCustomer)
  .put(restrictTo('admin', 'shipment_manager'), customerController.updateCustomer)
  .delete(restrictTo('admin'), customerController.deleteCustomer);

module.exports = router;
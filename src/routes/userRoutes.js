const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, restrictTo, checkUserAccess } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// Debug middleware - remove after testing
router.use((req, res, next) => {
  console.log('User role:', req.user?.role);
  console.log('User ID:', req.user?._id);
  next();
});

// Admin only
router.get('/', restrictTo('admin'), userController.getAllUsers);
router.get('/stats', restrictTo('admin'), userController.getUserStats);
router.get('/shipment-managers', restrictTo('admin'), userController.getShipmentManagers); 
router.post('/', restrictTo('admin'), userController.createUser);
router.put('/:id/role', restrictTo('admin'), userController.updateUserRole);
router.delete('/:id', restrictTo('admin'), userController.deleteUser);

// Admin or self
router.get('/:id', checkUserAccess, userController.getUserById);
router.put('/:id', checkUserAccess, userController.updateUser);

module.exports = router;
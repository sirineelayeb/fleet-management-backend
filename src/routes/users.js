const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, restrictTo, checkUserAccess } = require('../middlewares/auth');

// All user routes require authentication
router.use(protect);

// Admin only routes
router.get('/', restrictTo('admin'), userController.getAllUsers);
router.post('/', restrictTo('admin'), userController.createUser);
router.get('/stats', restrictTo('admin'), userController.getUserStats);
router.put('/:id/role', restrictTo('admin'), userController.updateUserRole);
router.delete('/:id', restrictTo('admin'), userController.deleteUser);

// User management - with access control
router.get('/:id', checkUserAccess, userController.getUserById);
router.put('/:id', checkUserAccess, userController.updateUser);

module.exports = router;
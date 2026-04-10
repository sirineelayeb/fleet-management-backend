// backend/src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const { protect, restrictTo, checkUserAccess } = require('../middlewares/auth');

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/google', authController.googleAuth);
router.post('/forgot-password', authController.forgotPassword);
router.get('/verify-reset-token/:token', authController.verifyResetToken);
router.post('/reset-password', authController.resetPassword);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================
router.use(protect);
router.put('/me', protect, userController.updateMe);

// User profile routes
router.get('/me', authController.getMe);
router.post('/logout', authController.logout);

// User management routes
// Admin only
router.route('/users')
  .get(restrictTo('admin'), userController.getAllUsers)
  .post(restrictTo('admin'), userController.createUser);

router.get('/users/stats', restrictTo('admin'), userController.getUserStats);
router.put('/users/:id/role', restrictTo('admin'), userController.updateUserRole);
router.delete('/users/:id', restrictTo('admin'), userController.deleteUser);

// User access control (admin or self)
router.route('/users/:id')
  .get(checkUserAccess, userController.getUserById)
  .put(checkUserAccess, userController.updateUser);

module.exports = router;
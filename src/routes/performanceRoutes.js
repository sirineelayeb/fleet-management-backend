// backend/src/routes/performanceRoutes.js
const express = require('express');
const router = express.Router();
const performanceController = require('../controllers/performanceController');
const { protect, restrictTo } = require('../middlewares/auth');

// All routes require authentication
router.use(protect);

// ============================================================
// PERFORMANCE ROUTES
// ============================================================

// Get driver leaderboard (top performers)
router.get('/leaderboard', performanceController.getLeaderboard);

// Get driver performance metrics
router.get('/driver/:driverId', performanceController.getDriverPerformance);

// Get driver performance trends
router.get('/driver/:driverId/trends', performanceController.getDriverTrends);

module.exports = router;
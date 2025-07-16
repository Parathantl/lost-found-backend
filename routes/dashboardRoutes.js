// routes/dashboardRoutes.js
const express = require('express');
const {
  getDashboardStats,
  getRecentActivity,
  getUserDashboardStats,
  getLocationStats
} = require('../controllers/dashboardController');
const { protect, staffOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin/Staff dashboard routes
router.get('/stats', protect, staffOrAdmin, getDashboardStats);
router.get('/activity', protect, staffOrAdmin, getRecentActivity);
router.get('/location-stats', protect, staffOrAdmin, getLocationStats);

// User dashboard routes
router.get('/user-stats', protect, getUserDashboardStats);

module.exports = router;
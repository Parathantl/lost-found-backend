// routes/staffRoutes.js
const express = require('express');
const {
  getStaffDashboardStats,
  getStaffRecentActivity,
  getItemsRequiringAttention,
  getStaffLocationAnalytics
} = require('../controllers/staffController');
const { protect, staffOrAdmin } = require('../middleware/auth');

const router = express.Router();

// All routes require staff or admin access
router.use(protect, staffOrAdmin);

// Staff dashboard routes
router.get('/dashboard/stats', getStaffDashboardStats);
router.get('/dashboard/activity', getStaffRecentActivity);
router.get('/dashboard/attention', getItemsRequiringAttention);
router.get('/dashboard/analytics', getStaffLocationAnalytics);

module.exports = router;
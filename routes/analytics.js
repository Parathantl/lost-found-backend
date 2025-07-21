// routes/analytics.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getAnalytics, getAvailableBranches } = require('../controllers/analyticsController');

// Routes
router.get('/', protect, getAnalytics);
router.get('/branches', protect, getAvailableBranches);

module.exports = router;
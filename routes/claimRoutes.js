// routes/claimRoutes.js
const express = require('express');
const { getMyClaims } = require('../controllers/claimController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Get user's claims
router.get('/my-claims', protect, getMyClaims);

module.exports = router;
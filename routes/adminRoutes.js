// routes/adminRoutes.js
const express = require('express');
const {
  getAllUsers,
  updateUser,
  deleteUser,
  getSystemOverview,
  bulkUpdateItems,
  exportData
} = require('../controllers/adminController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

// All routes require admin access
router.use(protect, admin);

// User management
router.get('/users', getAllUsers);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// System overview
router.get('/overview', getSystemOverview);

// Bulk operations
router.put('/items/bulk-update', bulkUpdateItems);

// Data export
router.get('/export', exportData);

module.exports = router;
// routes/notificationRoutes.js
const express = require('express');
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createSystemNotification,
  sendDeadlineReminders
} = require('../controllers/notificationController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

// User notification routes
router.get('/', protect, getNotifications);
router.put('/:notificationId/read', protect, markNotificationRead);
router.put('/mark-all-read', protect, markAllNotificationsRead);

// Admin notification routes
router.post('/system', protect, admin, createSystemNotification);
router.post('/deadline-reminders', protect, admin, sendDeadlineReminders);

module.exports = router;
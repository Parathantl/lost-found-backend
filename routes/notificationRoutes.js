const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notificationsController');
const auth = require('../middleware/auth'); 

// GET /api/notifications - Get user's notifications
router.get('/', auth.protect, notificationsController.getNotifications);

// GET /api/notifications/unread-count - Get unread count
router.get('/unread-count', auth.protect, notificationsController.getUnreadCount);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read',auth.protect, notificationsController.markAsRead);

// PUT /api/notifications/mark-all-read - Mark all notifications as read
router.put('/mark-all-read', auth.protect, notificationsController.markAllAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', auth.protect, notificationsController.deleteNotification);

module.exports = router;

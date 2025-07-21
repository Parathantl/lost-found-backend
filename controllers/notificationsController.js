// controllers/notificationsController.js
const NotificationService = require('../services/notificationService');

const notificationsController = {
  // Get user's notifications
  getNotifications: async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        page = 1,
        limit = 20,
        unreadOnly = false,
        type = null
      } = req.query;

      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        unreadOnly: unreadOnly === 'true',
        type: type
      };

      const result = await NotificationService.getUserNotifications(userId, options);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch notifications'
      });
    }
  },

  // Mark notification as read
  markAsRead: async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const notification = await NotificationService.markAsRead(id, userId);

      res.json({
        success: true,
        data: notification,
        message: 'Notification marked as read'
      });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to mark notification as read'
      });
    }
  },

  // Mark all notifications as read
  markAllAsRead: async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await NotificationService.markAllAsRead(userId);

      res.json({
        success: true,
        data: result,
        message: `${result.modifiedCount} notifications marked as read`
      });
    } catch (error) {
      console.error('Mark all as read error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark all notifications as read'
      });
    }
  },

  // Get unread count
  getUnreadCount: async (req, res) => {
    try {
      const userId = req.user.id;
      const count = await NotificationService.getUnreadCount(userId);

      res.json({
        success: true,
        data: { count }
      });
    } catch (error) {
      console.error('Get unread count error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get unread count'
      });
    }
  },

  // Delete notification
  deleteNotification: async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const notification = await Notification.findOneAndDelete({
        _id: id,
        recipient: userId
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      res.json({
        success: true,
        message: 'Notification deleted'
      });
    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete notification'
      });
    }
  }
};

module.exports = notificationsController;
// controllers/notificationController.js
const Item = require('../models/Item');

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (page - 1) * limit;

    // Find items where user is involved
    const query = {
      $or: [
        { reportedBy: req.user.id },
        { 'claims.claimedBy': req.user.id }
      ]
    };

    if (unreadOnly === 'true') {
      query['notifications.read'] = false;
    }

    const items = await Item.find(query)
      .populate('reportedBy', 'name')
      .populate('claims.claimedBy', 'name')
      .select('title type notifications reportedBy claims')
      .sort({ 'notifications.date': -1 });

    // Flatten notifications and add context
    const allNotifications = [];
    
    items.forEach(item => {
      item.notifications.forEach(notification => {
        // Determine if this notification is relevant to the user
        const isReporter = item.reportedBy._id.toString() === req.user.id;
        const isClaimer = item.claims.some(claim => 
          claim.claimedBy && claim.claimedBy._id.toString() === req.user.id
        );

        if (isReporter || isClaimer) {
          allNotifications.push({
            _id: notification._id,
            type: notification.type,
            message: notification.message,
            date: notification.date,
            read: notification.read,
            item: {
              _id: item._id,
              title: item.title,
              type: item.type
            },
            context: {
              isReporter,
              isClaimer
            }
          });
        }
      });
    });

    // Sort and paginate
    allNotifications.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    const filteredNotifications = unreadOnly === 'true' 
      ? allNotifications.filter(notif => !notif.read)
      : allNotifications;

    const paginatedNotifications = filteredNotifications.slice(skip, skip + parseInt(limit));
    const total = filteredNotifications.length;

    res.json({
      success: true,
      data: paginatedNotifications,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        unread: allNotifications.filter(notif => !notif.read).length
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:notificationId/read
// @access  Private
const markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    // Find the item containing this notification
    const item = await Item.findOne({
      'notifications._id': notificationId,
      $or: [
        { reportedBy: req.user.id },
        { 'claims.claimedBy': req.user.id }
      ]
    });

    if (!item) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Find and update the notification
    const notification = item.notifications.id(notificationId);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    notification.read = true;
    await item.save();

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/mark-all-read
// @access  Private
const markAllNotificationsRead = async (req, res) => {
  try {
    await Item.updateMany(
      {
        $or: [
          { reportedBy: req.user.id },
          { 'claims.claimedBy': req.user.id }
        ]
      },
      {
        $set: { 'notifications.$[].read': true }
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create system notification (Admin only)
// @route   POST /api/notifications/system
// @access  Private (Admin)
const createSystemNotification = async (req, res) => {
  try {
    const { message, type = 'system', targetUsers } = req.body;

    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    let query = {};
    
    // If targetUsers specified, target specific users
    if (targetUsers && targetUsers.length > 0) {
      query = {
        $or: [
          { reportedBy: { $in: targetUsers } },
          { 'claims.claimedBy': { $in: targetUsers } }
        ]
      };
    }

    // Add notification to all relevant items
    await Item.updateMany(query, {
      $push: {
        notifications: {
          type,
          message,
          date: new Date(),
          read: false
        }
      }
    });

    res.json({
      success: true,
      message: 'System notification sent successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send deadline reminders (System job)
// @route   POST /api/notifications/deadline-reminders
// @access  Private (Admin)
const sendDeadlineReminders = async (req, res) => {
  try {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const oneDayFromNow = new Date();
    oneDayFromNow.setDate(oneDayFromNow.getDate() + 1);

    // Find items expiring in 3 days
    const itemsExpiringSoon = await Item.find({
      status: 'active',
      expiryDate: {
        $gte: new Date(),
        $lte: threeDaysFromNow
      }
    });

    // Find items expiring tomorrow
    const itemsExpiringTomorrow = await Item.find({
      status: 'active',
      expiryDate: {
        $gte: new Date(),
        $lte: oneDayFromNow
      }
    });

    let remindersSent = 0;

    // Send 3-day reminders
    for (const item of itemsExpiringSoon) {
      const daysLeft = Math.ceil((item.expiryDate - new Date()) / (1000 * 60 * 60 * 24));
      
      // Check if reminder already sent for this timeframe
      const existingReminder = item.notifications.find(notif => 
        notif.type === 'deadline_reminder' && 
        notif.message.includes(`${daysLeft} days`)
      );

      if (!existingReminder) {
        item.notifications.push({
          type: 'deadline_reminder',
          message: `Your ${item.type} item "${item.title}" will expire in ${daysLeft} days`,
          date: new Date(),
          read: false
        });
        await item.save();
        remindersSent++;
      }
    }

    res.json({
      success: true,
      message: `${remindersSent} deadline reminders sent`,
      data: {
        itemsExpiringSoon: itemsExpiringSoon.length,
        itemsExpiringTomorrow: itemsExpiringTomorrow.length,
        remindersSent
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createSystemNotification,
  sendDeadlineReminders
};
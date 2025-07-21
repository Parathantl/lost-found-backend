// models/Notification.js
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'claim_submitted',
      'claim_approved', 
      'claim_rejected',
      'item_returned',
      'match_found',
      'deadline_reminder',
      'item_expired'
    ]
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  relatedItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: false
  },
  relatedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
NotificationSchema.index({ recipient: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, read: 1 });
NotificationSchema.index({ type: 1 });
NotificationSchema.index({ relatedItem: 1 });

// Method to mark as read
NotificationSchema.methods.markAsRead = function() {
  this.read = true;
  this.readAt = new Date();
  return this.save();
};

// Static method to create notification
NotificationSchema.statics.createNotification = async function(notificationData) {
  try {
    const notification = new this(notificationData);
    return await notification.save();
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Static method to get user's notifications
NotificationSchema.statics.getUserNotifications = async function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    unreadOnly = false,
    type = null
  } = options;

  const query = { recipient: userId };
  
  if (unreadOnly) {
    query.read = false;
  }
  
  if (type) {
    query.type = type;
  }

  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    this.find(query)
      .populate('relatedItem', 'title type status location')
      .populate('relatedUser', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    this.countDocuments(query),
    this.countDocuments({ recipient: userId, read: false })
  ]);

  return {
    notifications,
    pagination: {
      current: page,
      total,
      pages: Math.ceil(total / limit),
      limit,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
      unread: unreadCount
    }
  };
};

module.exports = mongoose.model('Notification', NotificationSchema);
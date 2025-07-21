// services/notificationService.js
const Notification = require('../models/Notification');
const User = require('../models/User');

class NotificationService {
  
  /**
   * Create a notification for a specific user
   */
  static async createNotification(recipientId, notificationData) {
    try {
      const notification = await Notification.createNotification({
        recipient: recipientId,
        ...notificationData
      });
      
      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create notifications for multiple users
   */
  static async createBulkNotifications(recipientIds, notificationData) {
    try {
      const notifications = await Promise.all(
        recipientIds.map(recipientId => 
          this.createNotification(recipientId, notificationData)
        )
      );
      
      return notifications;
    } catch (error) {
      console.error('Error creating bulk notifications:', error);
      throw error;
    }
  }

  /**
   * Get all admin and staff user IDs
   */
  static async getAdminStaffIds() {
    try {
      const adminStaff = await User.find({ 
        role: { $in: ['admin', 'staff'] },
        isActive: true 
      }).select('_id');
      
      return adminStaff.map(user => user._id);
    } catch (error) {
      console.error('Error getting admin/staff IDs:', error);
      return [];
    }
  }

  /**
   * Handle claim submitted notifications
   */
  static async handleClaimSubmitted(item, claimant) {
    try {
      // 1. Notify item owner
      await this.createNotification(item.reportedBy, {
        type: 'claim_submitted',
        title: 'New Claim Submitted',
        message: `${claimant.name} has submitted a claim for your ${item.type} item "${item.title}"`,
        relatedItem: item._id,
        relatedUser: claimant._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          claimantName: claimant.name
        }
      });

      // 2. Notify all admins and staff
      const adminStaffIds = await this.getAdminStaffIds();
      
      if (adminStaffIds.length > 0) {
        await this.createBulkNotifications(adminStaffIds, {
          type: 'claim_submitted',
          title: 'New Claim Requires Review',
          message: `${claimant.name} submitted a claim for ${item.type} item "${item.title}". Please review and approve/reject.`,
          relatedItem: item._id,
          relatedUser: claimant._id,
          data: {
            itemTitle: item.title,
            itemType: item.type,
            claimantName: claimant.name,
            requiresAction: true
          }
        });
      }

    } catch (error) {
      console.error('Error handling claim submitted notifications:', error);
      // Don't throw to avoid breaking main flow
    }
  }

  /**
   * Handle claim approved notifications
   */
  static async handleClaimApproved(item, claimant, approvedBy) {
    try {
      // Notify the claimant
      await this.createNotification(claimant._id, {
        type: 'claim_approved',
        title: 'Claim Approved!',
        message: `Great news! Your claim for "${item.title}" has been approved. Please contact the item owner to arrange pickup.`,
        relatedItem: item._id,
        relatedUser: approvedBy._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          approvedBy: approvedBy.name,
          contactInfo: item.contactInfo
        }
      });

      // Notify the item owner
      await this.createNotification(item.reportedBy, {
        type: 'claim_approved',
        title: 'Claim Approved for Your Item',
        message: `A claim for your ${item.type} item "${item.title}" has been approved. The claimant may contact you soon.`,
        relatedItem: item._id,
        relatedUser: claimant._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          claimantName: claimant.name
        }
      });

    } catch (error) {
      console.error('Error handling claim approved notifications:', error);
    }
  }

  /**
   * Handle claim rejected notifications
   */
  static async handleClaimRejected(item, claimant, rejectedBy, reason) {
    try {
      await this.createNotification(claimant._id, {
        type: 'claim_rejected',
        title: 'Claim Not Approved',
        message: `Your claim for "${item.title}" was not approved. ${reason ? `Reason: ${reason}` : ''}`,
        relatedItem: item._id,
        relatedUser: rejectedBy._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          rejectedBy: rejectedBy.name,
          reason: reason
        }
      });

    } catch (error) {
      console.error('Error handling claim rejected notifications:', error);
    }
  }

  /**
   * Handle item returned notifications
   */
  static async handleItemReturned(item, returnedBy) {
    try {
      await this.createNotification(item.reportedBy, {
        type: 'item_returned',
        title: 'Item Successfully Returned!',
        message: `Excellent! Your ${item.type} item "${item.title}" has been successfully returned to you.`,
        relatedItem: item._id,
        relatedUser: returnedBy._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          returnedBy: returnedBy.name
        }
      });

    } catch (error) {
      console.error('Error handling item returned notifications:', error);
    }
  }

  /**
   * Handle deadline reminder notifications
   */
  static async handleDeadlineReminder(item, daysUntilExpiry) {
    try {
      await this.createNotification(item.reportedBy, {
        type: 'deadline_reminder',
        title: 'Item Expiring Soon',
        message: `Your ${item.type} item "${item.title}" will expire in ${daysUntilExpiry} day(s). Please take action if needed.`,
        relatedItem: item._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          daysUntilExpiry: daysUntilExpiry,
          expiryDate: item.expiryDate
        }
      });

    } catch (error) {
      console.error('Error handling deadline reminder notifications:', error);
    }
  }

  /**
   * Handle match found notifications
   */
  static async handleMatchFound(item, matchedItem, matchScore) {
    try {
      await this.createNotification(item.reportedBy, {
        type: 'match_found',
        title: 'Potential Match Found!',
        message: `We found a potential match for your ${item.type} item "${item.title}". Check it out!`,
        relatedItem: matchedItem._id,
        data: {
          originalItemTitle: item.title,
          originalItemType: item.type,
          matchedItemTitle: matchedItem.title,
          matchedItemType: matchedItem.type,
          matchScore: matchScore
        }
      });

    } catch (error) {
      console.error('Error handling match found notifications:', error);
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOne({
        _id: notificationId,
        recipient: userId
      });

      if (!notification) {
        throw new Error('Notification not found');
      }

      await notification.markAsRead();
      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId) {
    try {
      const result = await Notification.updateMany(
        { recipient: userId, read: false },
        { 
          read: true, 
          readAt: new Date() 
        }
      );

      return result;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Get user notifications with pagination
   */
  static async getUserNotifications(userId, options = {}) {
    try {
      return await Notification.getUserNotifications(userId, options);
    } catch (error) {
      console.error('Error getting user notifications:', error);
      throw error;
    }
  }

  /**
   * Get unread count for a user
   */
  static async getUnreadCount(userId) {
    try {
      return await Notification.countDocuments({
        recipient: userId,
        read: false
      });
    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  static async handleMultipleClaimRejections(item, approvedClaimant, approver, rejectedClaims) {
    try {
      const rejectionPromises = rejectedClaims.map(async (claim) => {
        await this.createNotification(claim.claimedBy._id, {
          type: 'claim_rejected',
          title: 'Claim Not Approved',
          message: `Your claim for "${item.title}" was not approved. Another claim was accepted first.`,
          relatedItem: item._id,
          relatedUser: approver._id,
          data: {
            itemTitle: item.title,
            itemType: item.type,
            rejectedBy: approver.name,
            reason: 'Another claim was approved first',
            approvedClaimantName: approvedClaimant.name
          }
        });
      });

      await Promise.all(rejectionPromises);
    } catch (error) {
      console.error('Error sending multiple claim rejections:', error);
      throw error;
    }
  }

  /**
   * Handle claim status updates (for status changes back to pending, etc.)
   */
  static async handleClaimStatusUpdate(item, claimant, updatedBy, oldStatus, newStatus, notes) {
    try {
      let notificationType = 'claim_submitted';
      let title = 'Claim Status Updated';
      let message = `Your claim for "${item.title}" status has been updated from ${oldStatus} to ${newStatus}.`;

      // Customize message based on status change
      if (oldStatus === 'rejected' && newStatus === 'pending') {
        title = 'Claim Reconsidered';
        message = `Your claim for "${item.title}" is being reconsidered and is now pending review.`;
      } else if (oldStatus === 'approved' && newStatus === 'pending') {
        title = 'Claim Under Review';
        message = `Your claim for "${item.title}" is being reviewed again and is now pending.`;
      }

      await this.createNotification(claimant._id, {
        type: notificationType,
        title: title,
        message: message,
        relatedItem: item._id,
        relatedUser: updatedBy._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          oldStatus: oldStatus,
          newStatus: newStatus,
          updatedBy: updatedBy.name,
          notes: notes
        }
      });

    } catch (error) {
      console.error('Error sending claim status update notification:', error);
      throw error;
    }
  }

  /**
   * Notify item reporter about claim status changes
   */
  static async notifyReporterOfClaimUpdate(item, claimant, updatedBy, status, notes) {
    try {
      let title, message, type;

      switch (status) {
        case 'approved':
          type = 'claim_approved';
          title = 'Claim Approved for Your Item';
          message = `A claim for your ${item.type} item "${item.title}" has been approved. The claimant (${claimant.name}) may contact you to arrange pickup.`;
          break;
        case 'rejected':
          type = 'claim_rejected';
          title = 'Claim Rejected for Your Item';
          message = `A claim for your ${item.type} item "${item.title}" has been reviewed and not approved.`;
          break;
        case 'pending':
          type = 'claim_submitted';
          title = 'Claim Status Updated';
          message = `The status of a claim for your ${item.type} item "${item.title}" has been updated to pending review.`;
          break;
        default:
          return; // Don't send notification for unknown status
      }

      await this.createNotification(item.reportedBy._id, {
        type: type,
        title: title,
        message: message,
        relatedItem: item._id,
        relatedUser: claimant._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          claimantName: claimant.name,
          status: status,
          updatedBy: updatedBy.name,
          notes: notes,
          contactInfo: status === 'approved' ? {
            claimantEmail: claimant.email,
            claimantName: claimant.name
          } : null
        }
      });

    } catch (error) {
      console.error('Error sending reporter notification:', error);
      throw error;
    }
  }

  /**
   * Send notification when item is marked as returned
   */
  static async handleItemReturned(item, returnedBy, recipient) {
    try {
      await this.createNotification(item.reportedBy._id, {
        type: 'item_returned',
        title: 'Item Successfully Returned!',
        message: `Excellent! Your ${item.type} item "${item.title}" has been successfully returned to you.`,
        relatedItem: item._id,
        relatedUser: returnedBy._id,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          returnedBy: returnedBy.name,
          returnedDate: new Date(),
          handedOverBy: recipient ? recipient.name : 'Staff'
        }
      });

    } catch (error) {
      console.error('Error sending item returned notification:', error);
      throw error;
    }
  }

}

module.exports = NotificationService;
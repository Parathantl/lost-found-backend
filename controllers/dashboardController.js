// controllers/dashboardController.js
const Item = require('../models/Item');
const User = require('../models/User');

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private (Staff/Admin)
const getDashboardStats = async (req, res) => {
  try {
    const { timeRange = '30' } = req.query; // days
    const daysAgo = parseInt(timeRange);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    // Basic counts
    const [
      totalItems,
      totalUsers,
      activeItems,
      claimedItems,
      returnedItems,
      recentItems,
      pendingClaims,
      lostItems,
      foundItems
    ] = await Promise.all([
      Item.countDocuments(),
      User.countDocuments(),
      Item.countDocuments({ status: 'active' }),
      Item.countDocuments({ status: 'claimed' }),
      Item.countDocuments({ status: 'returned' }),
      Item.countDocuments({ createdAt: { $gte: startDate } }),
      Item.countDocuments({ 'claims.status': 'pending' }),
      Item.countDocuments({ type: 'lost' }),
      Item.countDocuments({ type: 'found' })
    ]);

    // Category breakdown
    const categoryStats = await Item.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          claimed: {
            $sum: { $cond: [{ $eq: ['$status', 'claimed'] }, 1, 0] }
          },
          returned: {
            $sum: { $cond: [{ $eq: ['$status', 'returned'] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Daily statistics for the last 30 days
    const dailyStats = await Item.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            type: '$type'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Success rate (items returned vs total found items)
    const successRate = foundItems > 0 ? ((returnedItems / foundItems) * 100).toFixed(1) : 0;

    // Response time analysis (average time from found to claimed)
    const responseTimeStats = await Item.aggregate([
      {
        $match: {
          type: 'found',
          status: { $in: ['claimed', 'returned'] },
          'claims.0': { $exists: true }
        }
      },
      {
        $addFields: {
          firstClaimDate: { $arrayElemAt: ['$claims.claimDate', 0] },
          daysDiff: {
            $divide: [
              { $subtract: [{ $arrayElemAt: ['$claims.claimDate', 0] }, '$createdAt'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: '$daysDiff' },
          minResponseTime: { $min: '$daysDiff' },
          maxResponseTime: { $max: '$daysDiff' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalItems,
          totalUsers,
          activeItems,
          claimedItems,
          returnedItems,
          recentItems,
          pendingClaims,
          successRate: parseFloat(successRate)
        },
        breakdown: {
          lostItems,
          foundItems,
          categories: categoryStats
        },
        trends: {
          daily: dailyStats,
          timeRange: daysAgo
        },
        performance: {
          avgResponseTime: responseTimeStats[0]?.avgResponseTime?.toFixed(1) || 0,
          minResponseTime: responseTimeStats[0]?.minResponseTime?.toFixed(1) || 0,
          maxResponseTime: responseTimeStats[0]?.maxResponseTime?.toFixed(1) || 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get recent activity
// @route   GET /api/dashboard/activity
// @access  Private (Staff/Admin)
const getRecentActivity = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    // Get recent items
    const recentItems = await Item.find()
      .populate('reportedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('title type category status createdAt reportedBy location');

    // Get recent claims
    const recentClaims = await Item.find({ 'claims.0': { $exists: true } })
      .populate('claims.claimedBy', 'name email')
      .populate('reportedBy', 'name email')
      .sort({ 'claims.claimDate': -1 })
      .limit(10)
      .select('title type claims');

    // Format activity feed
    const activityFeed = [];

    // Add items to feed
    recentItems.forEach(item => {
      activityFeed.push({
        type: 'item_reported',
        timestamp: item.createdAt,
        data: {
          itemTitle: item.title,
          itemType: item.type,
          category: item.category,
          location: item.location,
          reportedBy: item.reportedBy,
          status: item.status
        }
      });
    });

    // Add claims to feed
    recentClaims.forEach(item => {
      item.claims.forEach(claim => {
        activityFeed.push({
          type: 'claim_submitted',
          timestamp: claim.claimDate,
          data: {
            itemTitle: item.title,
            itemType: item.type,
            claimedBy: claim.claimedBy,
            claimStatus: claim.status,
            reportedBy: item.reportedBy
          }
        });
      });
    });

    // Sort by timestamp and limit
    activityFeed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedFeed = activityFeed.slice(0, parseInt(limit));

    res.json({
      success: true,
      data: limitedFeed
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user dashboard stats
// @route   GET /api/dashboard/user-stats
// @access  Private
const getUserDashboardStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const [
      myTotalItems,
      myLostItems,
      myFoundItems,
      myActiveItems,
      myClaimedItems,
      myReturnedItems,
      myClaims
    ] = await Promise.all([
      Item.countDocuments({ reportedBy: userId }),
      Item.countDocuments({ reportedBy: userId, type: 'lost' }),
      Item.countDocuments({ reportedBy: userId, type: 'found' }),
      Item.countDocuments({ reportedBy: userId, status: 'active' }),
      Item.countDocuments({ reportedBy: userId, status: 'claimed' }),
      Item.countDocuments({ reportedBy: userId, status: 'returned' }),
      Item.countDocuments({ 'claims.claimedBy': userId })
    ]);

    const myRecentItems = await Item.find({ reportedBy: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title type category status createdAt location');

    const myRecentClaims = await Item.find({ 
      'claims.claimedBy': userId 
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('title type category status claims createdAt location')
      .populate('reportedBy', 'name email')
      .populate('claims.claimedBy', 'name email'); 

    const formattedClaims = [];
    
    myRecentClaims.forEach(item => {
      // Find all claims by this user on this item
      const userClaims = item.claims.filter(claim => 
        claim.claimedBy._id.toString() === userId
      );
      
      // Add each claim to the formatted array
      userClaims.forEach(claim => {
        formattedClaims.push({
          item: {
            _id: item._id,
            title: item.title,
            type: item.type,
            category: item.category,
            status: item.status,
            location: item.location,
            reportedBy: item.reportedBy
          },
          claim: claim
        });
      });
    });

    // Sort by claim creation date and limit to 5 most recent
    formattedClaims.sort((a, b) => new Date(b.claim.createdAt) - new Date(a.claim.createdAt));
    const recentClaims = formattedClaims.slice(0, 5);

    let myNotifications = [];
    let unreadNotifications = 0;
    
    try {
      myNotifications = await Item.find({
        $or: [
          { reportedBy: userId },
          { 'claims.claimedBy': userId }
        ],
        'notifications.read': false
      })
      .select('title notifications')
      .sort({ 'notifications.date': -1 });

      unreadNotifications = myNotifications.reduce((total, item) => {
        return total + (item.notifications?.filter(notif => !notif.read)?.length || 0);
      }, 0);
    } catch (notifError) {
      console.error('Error fetching notifications:', notifError);
    }

    res.json({
      success: true,
      data: {
        overview: {
          myTotalItems,
          myLostItems,
          myFoundItems,
          myActiveItems,
          myClaimedItems,
          myReturnedItems,
          myClaims,
          unreadNotifications
        },
        recentActivity: {
          items: myRecentItems,
          claims: recentClaims
        },
        notifications: myNotifications.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
};

// @desc    Get location-based analytics
// @route   GET /api/dashboard/location-stats
// @access  Private (Staff/Admin)
const getLocationStats = async (req, res) => {
  try {
    // Location hotspots
    const locationStats = await Item.aggregate([
      {
        $group: {
          _id: '$location',
          total: { $sum: 1 },
          lost: {
            $sum: { $cond: [{ $eq: ['$type', 'lost'] }, 1, 0] }
          },
          found: {
            $sum: { $cond: [{ $eq: ['$type', 'found'] }, 1, 0] }
          },
          active: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          returned: {
            $sum: { $cond: [{ $eq: ['$status', 'returned'] }, 1, 0] }
          }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 20 }
    ]);

    res.json({
      success: true,
      data: locationStats
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getRecentActivity,
  getUserDashboardStats,
  getLocationStats
};
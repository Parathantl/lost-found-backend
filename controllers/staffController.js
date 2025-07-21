// controllers/staffController.js
const Item = require('../models/Item');
const User = require('../models/User');

// @desc    Get staff dashboard statistics (location-based)
// @route   GET /api/staff/dashboard/stats
// @access  Private (Staff/Admin)
const getStaffDashboardStats = async (req, res) => {
  try {
    const staffLocation = req.user.branch;
    let { timeRange = '30' } = req.query;

    const daysAgo = parseInt(timeRange) || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);
    
    if (isNaN(startDate.getTime())) {
      throw new Error('Invalid date range provided');
    }

    const locationFilter = {
      location: { $regex: staffLocation, $options: 'i' }
    };

    const validStartDate = new Date(startDate);
    if (isNaN(validStartDate.getTime())) {
      throw new Error('Invalid start date for aggregation');
    }

    const [
      totalItems,
      activeItems,
      claimedItems,
      returnedItems,
      expiredItems,
      recentItems,
      pendingClaims,
      lostItems,
      foundItems,
      handedOverToPolice,
      policeHandoverRecentItems,
      itemsAwaitingHandover
    ] = await Promise.all([
      Item.countDocuments(locationFilter),
      Item.countDocuments({ ...locationFilter, status: 'active' }),
      Item.countDocuments({ ...locationFilter, status: 'claimed' }),
      Item.countDocuments({ ...locationFilter, status: 'returned' }),
      Item.countDocuments({ ...locationFilter, status: 'expired' }),
      Item.countDocuments({ 
        ...locationFilter, 
        createdAt: { $gte: validStartDate }
      }),
      Item.countDocuments({ 
        ...locationFilter, 
        'claims.status': 'pending' 
      }),
      Item.countDocuments({ ...locationFilter, type: 'lost' }),
      Item.countDocuments({ ...locationFilter, type: 'found' }),
      Item.countDocuments({ 
        ...locationFilter, 
        handedOverToPolice: true 
      }),
      Item.countDocuments({ 
        ...locationFilter, 
        handedOverToPolice: true,
        policeHandoverDate: { $gte: validStartDate }
      }),
      Item.countDocuments({ 
        ...locationFilter, 
        type: 'found',
        status: 'expired',
        handedOverToPolice: { $ne: true }
      })
    ]);

    const dailyStats = await Item.aggregate([
      {
        $match: {
          ...locationFilter,
          createdAt: { 
            $gte: validStartDate,
            $lte: new Date()
          }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            type: '$type'
          },
          count: { $sum: 1 },
          handedOverToPolice: {
            $sum: { $cond: [{ $eq: ['$handedOverToPolice', true] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // ✅ FIX: Police handover trends with proper date handling
    const policeHandoverTrends = await Item.aggregate([
      {
        $match: {
          ...locationFilter,
          handedOverToPolice: true,
          policeHandoverDate: { 
            $gte: validStartDate,
            $lte: new Date()
          }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$policeHandoverDate' } }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);
    
    // Category breakdown, response time stats, etc.
    const categoryStats = await Item.aggregate([
      { $match: locationFilter },
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
          },
          expired: {
            $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] }
          },
          handedOverToPolice: {
            $sum: { $cond: [{ $eq: ['$handedOverToPolice', true] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Success rate calculations
    const successRate = foundItems > 0 ? ((returnedItems / foundItems) * 100).toFixed(1) : 0;
    
    const policeHandoverRate = expiredItems > 0 ? 
      ((handedOverToPolice / (expiredItems + handedOverToPolice)) * 100).toFixed(1) : 0;

    const responseTimeStats = await Item.aggregate([
      {
        $match: {
          ...locationFilter,
          type: 'found',
          status: { $in: ['claimed', 'returned'] },
          'claims.0': { $exists: true }
        }
      },
      {
        $addFields: {
          firstClaimDate: { $arrayElemAt: ['$claims.createdAt', 0] },
          daysDiff: {
            $divide: [
              { $subtract: [{ $arrayElemAt: ['$claims.createdAt', 0] }, '$createdAt'] },
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

    // Police handover efficiency stats
    const policeHandoverStats = await Item.aggregate([
      {
        $match: {
          ...locationFilter,
          handedOverToPolice: true,
          policeHandoverDate: { $exists: true },
          createdAt: { $exists: true }
        }
      },
      {
        $addFields: {
          daysToHandover: {
            $divide: [
              { $subtract: ['$policeHandoverDate', '$createdAt'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgDaysToHandover: { $avg: '$daysToHandover' },
          minDaysToHandover: { $min: '$daysToHandover' },
          maxDaysToHandover: { $max: '$daysToHandover' }
        }
      }
    ]);

    // Top police stations
    const topPoliceStations = await Item.aggregate([
      {
        $match: {
          ...locationFilter,
          handedOverToPolice: true,
          policeStation: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$policeStation',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.json({
      success: true,
      data: {
        location: staffLocation,
        overview: {
          totalItems,
          activeItems,
          claimedItems,
          returnedItems,
          expiredItems,
          recentItems,
          pendingClaims,
          handedOverToPolice,
          policeHandoverRecentItems,
          itemsAwaitingHandover,
          successRate: parseFloat(successRate),
          policeHandoverRate: parseFloat(policeHandoverRate)
        },
        breakdown: {
          lostItems,
          foundItems,
          categories: categoryStats
        },
        trends: {
          daily: dailyStats,
          policeHandover: policeHandoverTrends,
          timeRange: daysAgo
        },
        performance: {
          avgResponseTime: responseTimeStats[0]?.avgResponseTime?.toFixed(1) || 0,
          minResponseTime: responseTimeStats[0]?.minResponseTime?.toFixed(1) || 0,
          maxResponseTime: responseTimeStats[0]?.maxResponseTime?.toFixed(1) || 0,
          avgDaysToHandover: policeHandoverStats[0]?.avgDaysToHandover?.toFixed(1) || 0,
          minDaysToHandover: policeHandoverStats[0]?.minDaysToHandover?.toFixed(1) || 0,
          maxDaysToHandover: policeHandoverStats[0]?.maxDaysToHandover?.toFixed(1) || 0
        },
        policeHandover: {
          totalHandedOver: handedOverToPolice,
          recentHandovers: policeHandoverRecentItems,
          awaitingHandover: itemsAwaitingHandover,
          handoverRate: parseFloat(policeHandoverRate),
          topPoliceStations: topPoliceStations,
          trends: policeHandoverTrends
        }
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Failed to get dashboard stats'
    });
  }
};

// @desc    Get staff recent activity (location-based)
// @route   GET /api/staff/dashboard/activity
// @access  Private (Staff/Admin)
const getStaffRecentActivity = async (req, res) => {
  try {
    const staffLocation = req.user.branch;
    const { limit = 20 } = req.query;

    const locationFilter = {
      location: { $regex: staffLocation, $options: 'i' }
    };

    // Get recent items in staff's location
    const recentItems = await Item.find(locationFilter)
      .populate('reportedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('title type category status createdAt reportedBy location');

    // Get recent claims in staff's location
    const recentClaims = await Item.find({ 
      ...locationFilter,
      'claims.0': { $exists: true } 
    })
      .populate('claims.claimedBy', 'name email')
      .populate('reportedBy', 'name email')
      .sort({ 'claims.claimDate': -1 })
      .limit(10)
      .select('title type claims reportedBy');

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

// @desc    Get items requiring staff attention (pending claims, expired items)
// @route   GET /api/staff/dashboard/attention
// @access  Private (Staff/Admin)
const getItemsRequiringAttention = async (req, res) => {
  try {
    const staffLocation = req.user.branch;
    const locationFilter = {
      location: { $regex: staffLocation, $options: 'i' }
    };

    // Items with pending claims
    const pendingClaimsItems = await Item.find({
      ...locationFilter,
      'claims.status': 'pending'
    })
      .populate('reportedBy', 'name email')
      .populate('claims.claimedBy', 'name email')
      .sort({ 'claims.claimDate': 1 })
      .limit(10);

    // Expired active items
    const expiredItems = await Item.find({
      ...locationFilter,
      status: 'active',
      expiryDate: { $lt: new Date() }
    })
      .populate('reportedBy', 'name email')
      .sort({ expiryDate: 1 })
      .limit(10);

    // Items expiring soon (within 3 days)
    const expiringSoonItems = await Item.find({
      ...locationFilter,
      status: 'active',
      expiryDate: {
        $gte: new Date(),
        $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      }
    })
      .populate('reportedBy', 'name email')
      .sort({ expiryDate: 1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        pendingClaims: pendingClaimsItems,
        expiredItems,
        expiringSoon: expiringSoonItems,
        counts: {
          pendingClaims: pendingClaimsItems.length,
          expired: expiredItems.length,
          expiringSoon: expiringSoonItems.length
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get staff location analytics
// @route   GET /api/staff/dashboard/analytics
// @access  Private (Staff/Admin)
const getStaffLocationAnalytics = async (req, res) => {
  try {
    const staffLocation = req.user.branch;
    const { timeRange = '30' } = req.query;
    const daysAgo = parseInt(timeRange);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    const locationFilter = {
      location: { $regex: staffLocation, $options: 'i' },
      createdAt: { $gte: startDate }
    };

    // Detailed location analytics
    const locationAnalytics = await Item.aggregate([
      { $match: locationFilter },
      {
        $group: {
          _id: {
            week: { $week: '$createdAt' },
            type: '$type'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.week': 1 } }
    ]);

    // Peak hours analysis
    const peakHours = await Item.aggregate([
      { $match: locationFilter },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Most common categories in location
    const topCategories = await Item.aggregate([
      { $match: { location: { $regex: staffLocation, $options: 'i' } } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          recent: {
            $sum: { 
              $cond: [
                { $gte: ['$createdAt', startDate] }, 
                1, 
                0
              ] 
            }
          }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]);

    res.json({
      success: true,
      data: {
        location: staffLocation,
        timeRange: daysAgo,
        weeklyTrends: locationAnalytics,
        peakHours,
        topCategories
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getStaffDashboardStats,
  getStaffRecentActivity,
  getItemsRequiringAttention,
  getStaffLocationAnalytics
};
// controllers/analyticsController.js - CORRECTED VERSION
const Item = require('../models/Item');
const User = require('../models/User');

const analyticsController = {
  getAnalytics: async (req, res) => {
    try {
      const { startDate, endDate, format, branch } = req.query; // ← FIXED: Extract branch from req.query
      const user = req.user;
      
      // Date range setup
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();
      
      // Role-based filtering
      let locationFilter = {};
      let userBranchFilter = {};
      let reportScope = 'All Locations';
      
      if (user.role === 'staff') {
        // Staff can only see data from their branch/location
        if (!user.branch) {
          return res.status(400).json({
            success: false,
            message: 'Staff user must have a branch assigned'
          });
        }
        locationFilter.location = { $regex: user.branch, $options: 'i' };
        userBranchFilter.branch = user.branch;
        reportScope = `${user.branch} Branch`;
      } else if (user.role === 'admin') {
        // Admin can see all data, but can filter by branch if requested
        if (branch && branch !== 'all') {
          locationFilter.location = { $regex: branch, $options: 'i' };
          userBranchFilter.branch = branch;
          reportScope = `${branch} Branch`;
        }
        // If no branch specified, show all data (locationFilter remains empty)
      } else {
        // Regular users shouldn't have access to analytics
        return res.status(403).json({
          success: false,
          message: 'Access denied. Insufficient permissions.'
        });
      }
            
      // Basic statistics with location filtering
      const totalItems = await Item.countDocuments(locationFilter);
      const activeItems = await Item.countDocuments({ ...locationFilter, status: 'active' });
      const claimedItems = await Item.countDocuments({ ...locationFilter, status: 'claimed' });
      const returnedItems = await Item.countDocuments({ ...locationFilter, status: 'returned' });
      const expiredItems = await Item.countDocuments({ ...locationFilter, status: 'expired' });
            
      // Pending claims across filtered items
      const pendingClaimsResult = await Item.aggregate([
        { $match: locationFilter },
        { $unwind: { path: '$claims', preserveNullAndEmptyArrays: true } },
        { $match: { 'claims.status': 'pending' } },
        { $count: 'total' }
      ]);
      const pendingClaims = pendingClaimsResult[0]?.total || 0;
      
      // Daily activity trends with location filtering
      const dailyTrends = await Item.aggregate([
        {
          $match: {
            ...locationFilter,
            createdAt: { $gte: start, $lte: end }
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
        {
          $group: {
            _id: '$_id.date',
            lost: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'lost'] }, '$count', 0] }
            },
            found: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'found'] }, '$count', 0] }
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      
      // Category breakdown with location filtering
      const categoryStats = await Item.aggregate([
        { $match: locationFilter },
        {
          $group: {
            _id: {
              category: '$category',
              type: '$type'
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.category',
            lost: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'lost'] }, '$count', 0] }
            },
            found: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'found'] }, '$count', 0] }
            },
            total: { $sum: '$count' }
          }
        },
        { $sort: { total: -1 } }
      ]);
      
      // Location breakdown (more detailed for admins, limited for staff)
      const locationStats = await Item.aggregate([
        { $match: locationFilter },
        {
          $group: {
            _id: '$location',
            count: { $sum: 1 },
            lost: {
              $sum: { $cond: [{ $eq: ['$type', 'lost'] }, 1, 0] }
            },
            found: {
              $sum: { $cond: [{ $eq: ['$type', 'found'] }, 1, 0] }
            }
          }
        },
        { $sort: { count: -1 } },
        { $limit: user.role === 'staff' ? 5 : 15 }
      ]);
      
      // User activity stats with branch filtering
      const userStatsMatch = Object.keys(userBranchFilter).length > 0 ? userBranchFilter : {};
      const userStatsResult = await User.aggregate([
        { $match: userStatsMatch },
        {
          $lookup: {
            from: 'items',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$reportedBy', '$$userId'] },
                  ...locationFilter
                }
              }
            ],
            as: 'reportedItems'
          }
        },
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            activeUsers: { 
              $sum: { 
                $cond: [{ $gt: [{ $size: '$reportedItems' }, 0] }, 1, 0] 
              } 
            },
            verifiedUsers: {
              $sum: { $cond: ['$isVerified', 1, 0] }
            },
            staffUsers: {
              $sum: { $cond: [{ $eq: ['$role', 'staff'] }, 1, 0] }
            }
          }
        }
      ]);
      const userStats = userStatsResult[0] || { totalUsers: 0, activeUsers: 0, verifiedUsers: 0, staffUsers: 0 };
      
      // Response time analysis with location filtering
      const responseTimeResult = await Item.aggregate([
        {
          $match: { 
            ...locationFilter,
            status: { $in: ['claimed', 'returned'] }
          }
        },
        { $unwind: { path: '$claims', preserveNullAndEmptyArrays: true } },
        { $match: { 'claims.status': 'approved' } },
        {
          $group: {
            _id: null,
            avgResponseTime: {
              $avg: {
                $divide: [
                  { $subtract: ['$claims.createdAt', '$createdAt'] },
                  1000 * 60 * 60 * 24 // Convert to days
                ]
              }
            },
            totalProcessed: { $sum: 1 }
          }
        }
      ]);
      const responseTime = responseTimeResult[0] || { avgResponseTime: 0, totalProcessed: 0 };
      
      // Branch performance comparison (admin only)
      let branchComparison = [];
      if (user.role === 'admin') {
        branchComparison = await Item.aggregate([
          {
            $addFields: {
              extractedBranch: {
                $trim: {
                  input: {
                    $arrayElemAt: [
                      { $split: [{ $toLower: '$location' }, ' '] },
                      0
                    ]
                  }
                }
              }
            }
          },
          {
            $group: {
              _id: '$extractedBranch',
              totalItems: { $sum: 1 },
              activeItems: {
                $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
              },
              returnedItems: {
                $sum: { $cond: [{ $eq: ['$status', 'returned'] }, 1, 0] }
              }
            }
          },
          {
            $addFields: {
              successRate: {
                $cond: [
                  { $gt: ['$totalItems', 0] },
                  { $multiply: [{ $divide: ['$returnedItems', '$totalItems'] }, 100] },
                  0
                ]
              }
            }
          },
          { $sort: { totalItems: -1 } },
          { $limit: 10 }
        ]);
      }
      
      const analytics = {
        summary: {
          totalItems,
          activeItems,
          claimedItems,
          returnedItems,
          expiredItems,
          pendingClaims,
          ...userStats,
          reportScope,
          userRole: user.role,
          userBranch: user.branch || 'N/A'
        },
        dailyTrends,
        categoryStats,
        locationStats,
        branchComparison,
        responseTime,
        dateRange: { start, end }
      };
            
      // If CSV format requested
      if (format === 'csv') {
        const csv = generateCSV(analytics, user);
        
        const fileName = `lost-found-analytics-${reportScope.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Pragma', 'no-cache');
        
        return res.send(csv);
      }
      
      res.json({
        success: true,
        data: analytics
      });
      
    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate analytics',
        error: error.message
      });
    }
  },

  // Get available branches for admin dropdown
  getAvailableBranches: async (req, res) => {
    try {
      const branches = await Item.distinct('location');
      const cleanedBranches = branches
        .map(location => {
          // Extract first word as branch name
          const match = location.toLowerCase().match(/^(\w+)/);
          return match ? match[1] : location;
        })
        .filter((branch, index, arr) => arr.indexOf(branch) === index) // Remove duplicates
        .filter(Boolean) // Remove empty values
        .sort();
      
      res.json({
        success: true,
        data: cleanedBranches
      });
      
    } catch (error) {
      console.error('Get branches error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch branches',
        error: error.message
      });
    }
  }
};

// Enhanced CSV generator with better formatting and error handling
function generateCSV(analytics, user) {
  try {
    let csv = '';
    
    // Add BOM for UTF-8 support in Excel
    csv += '\uFEFF';
    
    // Header section
    csv += 'LOST & FOUND ANALYTICS REPORT\r\n';
    csv += `Report Scope,"${analytics.summary.reportScope}"\r\n`;
    csv += `Generated By,"${user.role.toUpperCase()} - ${user.name || 'N/A'}"\r\n`;
    csv += `User Branch,"${user.branch || 'N/A'}"\r\n`;
    csv += `Generated On,"${new Date().toISOString()}"\r\n`;
    csv += `Date Range,"${analytics.dateRange.start.toISOString().split('T')[0]} to ${analytics.dateRange.end.toISOString().split('T')[0]}"\r\n`;
    csv += '\r\n';
    
    // Summary statistics
    csv += 'SUMMARY STATISTICS\r\n';
    csv += 'Metric,Value\r\n';
    csv += `Total Items,${analytics.summary.totalItems}\r\n`;
    csv += `Active Items,${analytics.summary.activeItems}\r\n`;
    csv += `Claimed Items,${analytics.summary.claimedItems}\r\n`;
    csv += `Returned Items,${analytics.summary.returnedItems}\r\n`;
    csv += `Expired Items,${analytics.summary.expiredItems}\r\n`;
    csv += `Pending Claims,${analytics.summary.pendingClaims}\r\n`;
    csv += `Total Users,${analytics.summary.totalUsers || 0}\r\n`;
    csv += `Active Users,${analytics.summary.activeUsers || 0}\r\n`;
    csv += `Verified Users,${analytics.summary.verifiedUsers || 0}\r\n`;
    csv += `Staff Users,${analytics.summary.staffUsers || 0}\r\n`;
    csv += `Average Response Time (days),${(analytics.responseTime.avgResponseTime || 0).toFixed(2)}\r\n`;
    csv += '\r\n';
    
    // Daily activity trends
    csv += 'DAILY ACTIVITY TRENDS\r\n';
    csv += 'Date,Lost Items,Found Items,Total\r\n';
    if (analytics.dailyTrends && analytics.dailyTrends.length > 0) {
      analytics.dailyTrends.forEach(day => {
        csv += `${day._id},${day.lost || 0},${day.found || 0},${(day.lost || 0) + (day.found || 0)}\r\n`;
      });
    } else {
      csv += 'No data available for the selected period\r\n';
    }
    csv += '\r\n';
    
    // Category breakdown
    csv += 'CATEGORY BREAKDOWN\r\n';
    csv += 'Category,Lost Items,Found Items,Total\r\n';
    if (analytics.categoryStats && analytics.categoryStats.length > 0) {
      analytics.categoryStats.forEach(cat => {
        csv += `"${cat._id}",${cat.lost || 0},${cat.found || 0},${cat.total || 0}\r\n`;
      });
    } else {
      csv += 'No category data available\r\n';
    }
    csv += '\r\n';
    
    // Location breakdown
    csv += `${user.role === 'staff' ? 'BRANCH LOCATIONS' : 'TOP LOCATIONS'}\r\n`;
    csv += 'Location,Lost Items,Found Items,Total\r\n';
    if (analytics.locationStats && analytics.locationStats.length > 0) {
      analytics.locationStats.forEach(loc => {
        csv += `"${loc._id}",${loc.lost || 0},${loc.found || 0},${loc.count || 0}\r\n`;
      });
    } else {
      csv += 'No location data available\r\n';
    }
    csv += '\r\n';
    
    // Branch comparison for admin
    if (user.role === 'admin' && analytics.branchComparison && analytics.branchComparison.length > 0) {
      csv += 'BRANCH PERFORMANCE COMPARISON\r\n';
      csv += 'Branch,Total Items,Active Items,Returned Items,Success Rate (%)\r\n';
      analytics.branchComparison.forEach(branch => {
        csv += `"${branch._id}",${branch.totalItems || 0},${branch.activeItems || 0},${branch.returnedItems || 0},${(branch.successRate || 0).toFixed(1)}\r\n`;
      });
      csv += '\r\n';
    }
    
    // Footer
    csv += 'END OF REPORT\r\n';
    
    return csv;
    
  } catch (error) {
    return `Error generating CSV: ${error.message}\r\n`;
  }
}

module.exports = analyticsController;
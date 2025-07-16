// controllers/adminController.js
const User = require('../models/User');
const Item = require('../models/Item');

// @desc    Get all users (Admin only)
// @route   GET /api/admin/users
// @access  Private (Admin)
// controllers/adminController.js - Update the getAllUsers function
// controllers/adminController.js - Better filter handling
const getAllUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      role, 
      branch, 
      isActive, 
      search 
    } = req.query;

    const filter = {};
    
    // Only add to filter if value exists and is not empty string
    if (role && role.trim() !== '') filter.role = role;
    if (branch && branch.trim() !== '') filter.branch = branch;
    if (isActive && isActive.trim() !== '') filter.isActive = isActive === 'true';
    
    if (search && search.trim() !== '') {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    // Get user statistics (simplified version)
    const userStats = await Promise.all(
      users.map(async (user) => {
        try {
          const [itemsReported, claimsSubmitted] = await Promise.all([
            Item.countDocuments({ reportedBy: user._id }),
            Item.countDocuments({ 'claims.claimedBy': user._id })
          ]);

          return {
            ...user.toObject(),
            stats: {
              itemsReported,
              claimsSubmitted
            }
          };
        } catch (statsError) {
          console.error('Error getting stats for user:', user._id, statsError);
          return {
            ...user.toObject(),
            stats: {
              itemsReported: 0,
              claimsSubmitted: 0
            }
          };
        }
      })
    );

    res.json({
      success: true,
      data: userStats,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error in getAllUsers:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user role/status (Admin only)
// @route   PUT /api/admin/users/:id
// @access  Private (Admin)
const updateUser = async (req, res) => {
  try {
    const { role, isActive, branch } = req.body;
    const userId = req.params.id;

    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user.id && isActive === false) {
      return res.status(400).json({ message: 'Cannot deactivate your own account' });
    }

    // Update fields
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (branch) user.branch = branch;

    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete user (Admin only)
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has active items or claims
    const [activeItems, activeClaims] = await Promise.all([
      Item.countDocuments({ reportedBy: userId, status: 'active' }),
      Item.countDocuments({ 'claims.claimedBy': userId, 'claims.status': 'pending' })
    ]);

    if (activeItems > 0 || activeClaims > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete user with active items or pending claims' 
      });
    }

    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get system overview (Admin only)
// @route   GET /api/admin/overview
// @access  Private (Admin)
const getSystemOverview = async (req, res) => {
  try {
    const [
      totalUsers,
      totalStaff,
      totalAdmins,
      activeUsers,
      totalItems,
      pendingClaims,
      expiredItems,
      recentRegistrations
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'staff' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ isActive: true }),
      Item.countDocuments(),
      Item.countDocuments({ 'claims.status': 'pending' }),
      Item.countDocuments({ 
        expiryDate: { $lt: new Date() }, 
        status: 'active' 
      }),
      User.countDocuments({ 
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
      })
    ]);

    // Get branch distribution
    const branchStats = await User.aggregate([
      { $match: { role: { $in: ['staff', 'admin'] } } },
      {
        $group: {
          _id: '$branch',
          count: { $sum: 1 },
          staff: {
            $sum: { $cond: [{ $eq: ['$role', 'staff'] }, 1, 0] }
          },
          admins: {
            $sum: { $cond: [{ $eq: ['$role', 'admin'] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // System health checks
    const healthChecks = {
      userRegistrations: recentRegistrations > 0,
      itemActivity: totalItems > 0,
      claimProcessing: true, // Could add more complex checks
      expiredItemsNeedAttention: expiredItems > 0
    };

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          staff: totalStaff,
          admins: totalAdmins,
          active: activeUsers,
          recentRegistrations
        },
        items: {
          total: totalItems,
          pendingClaims,
          expiredItems
        },
        branches: branchStats,
        health: healthChecks,
        systemStatus: 'operational'
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Bulk update items (Admin only)
// @route   PUT /api/admin/items/bulk-update
// @access  Private (Admin)
const bulkUpdateItems = async (req, res) => {
  try {
    const { itemIds, updateData } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ message: 'Item IDs array is required' });
    }

    const result = await Item.updateMany(
      { _id: { $in: itemIds } },
      updateData,
      { runValidators: true }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} items updated successfully`,
      data: {
        matched: result.matchedCount,
        modified: result.modifiedCount
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Export data (Admin only)
// @route   GET /api/admin/export
// @access  Private (Admin)
const exportData = async (req, res) => {
  try {
    const { type, format = 'json', startDate, endDate } = req.query;

    let data = [];
    let filename = '';

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    switch (type) {
      case 'users':
        data = await User.find(
          Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}
        ).select('-password');
        filename = `users_export_${Date.now()}`;
        break;
        
      case 'items':
        data = await Item.find(
          Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}
        ).populate('reportedBy', 'name email');
        filename = `items_export_${Date.now()}`;
        break;
        
      case 'claims':
        const itemsWithClaims = await Item.find({ 
          'claims.0': { $exists: true },
          ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {})
        })
        .populate('reportedBy', 'name email')
        .populate('claims.claimedBy', 'name email');
        
        data = itemsWithClaims.flatMap(item => 
          item.claims.map(claim => ({
            itemId: item._id,
            itemTitle: item.title,
            itemType: item.type,
            itemCategory: item.category,
            reportedBy: item.reportedBy,
            claimedBy: claim.claimedBy,
            claimDate: claim.claimDate,
            claimStatus: claim.status,
            notes: claim.notes
          }))
        );
        filename = `claims_export_${Date.now()}`;
        break;
        
      default:
        return res.status(400).json({ message: 'Invalid export type' });
    }

    if (format === 'csv') {
      // Convert to CSV format
      if (data.length === 0) {
        return res.status(404).json({ message: 'No data found for export' });
      }

      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(','),
        ...data.map(row => 
          headers.map(header => {
            const value = row[header];
            const stringValue = typeof value === 'object' && value !== null 
              ? JSON.stringify(value).replace(/"/g, '""')
              : String(value || '').replace(/"/g, '""');
            return `"${stringValue}"`;
          }).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        success: true,
        exportDate: new Date().toISOString(),
        recordCount: data.length,
        data
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAllUsers,
  updateUser,
  deleteUser,
  getSystemOverview,
  bulkUpdateItems,
  exportData
};
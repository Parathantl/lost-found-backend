// controllers/itemController.js
const Item = require('../models/Item');
const { validationResult } = require('express-validator');

// @desc    Create new item (lost or found)
// @route   POST /api/items
// @access  Private
const createItem = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      category,
      type,
      location,
      date,
      images,
      contactInfo,
      additionalDetails
    } = req.body;

    const item = await Item.create({
      title,
      description,
      category,
      type,
      location,
      date,
      images: images || [],
      contactInfo,
      additionalDetails,
      reportedBy: req.user.id
    });

    const populatedItem = await Item.findById(item._id).populate('reportedBy', 'name email');
    
    res.status(201).json({
      success: true,
      data: populatedItem
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all items with filtering and search
// @route   GET /api/items
// @access  Public
const getItems = async (req, res) => {
  try {
    const {
      type,
      category,
      status,
      location,
      search,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (status) filter.status = status;
    if (location) filter.location = { $regex: location, $options: 'i' };
    
    // Text search
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (page - 1) * limit;
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const items = await Item.find(filter)
      .populate('reportedBy', 'name email')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Item.countDocuments(filter);

    res.json({
      success: true,
      data: items,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single item
// @route   GET /api/items/:id
// @access  Public
const getItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id)
      .populate('reportedBy', 'name email')
      .populate('claims.claimedBy', 'name email');

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update item
// @route   PUT /api/items/:id
// @access  Private (Owner, Staff, Admin)
const updateItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Check ownership or staff/admin role
    if (item.reportedBy.toString() !== req.user.id && 
        req.user.role !== 'staff' && 
        req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update this item' });
    }

    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('reportedBy', 'name email');

    res.json({
      success: true,
      data: updatedItem
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete item
// @route   DELETE /api/items/:id
// @access  Private (Owner, Staff, Admin)
const deleteItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Check ownership or staff/admin role
    if (item.reportedBy.toString() !== req.user.id && 
        req.user.role !== 'staff' && 
        req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this item' });
    }

    await Item.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Item deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's items
// @route   GET /api/items/my-items
// @access  Private
const getMyItems = async (req, res) => {
  try {
    const { type, status, page = 1, limit = 10 } = req.query;
    
    const filter = { reportedBy: req.user.id };
    if (type) filter.type = type;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const items = await Item.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Item.countDocuments(filter);

    res.json({
      success: true,
      data: items,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Search for potential matches
// @route   POST /api/items/search-matches
// @access  Private
const searchMatches = async (req, res) => {
  try {
    const { itemId } = req.body;
    
    const sourceItem = await Item.findById(itemId);
    if (!sourceItem) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Find potential matches (opposite type, similar category/location/date)
    const oppositeType = sourceItem.type === 'lost' ? 'found' : 'lost';
    const dateRange = 7; // Within 7 days
    
    const matches = await Item.find({
      type: oppositeType,
      category: sourceItem.category,
      status: 'active',
      date: {
        $gte: new Date(sourceItem.date.getTime() - dateRange * 24 * 60 * 60 * 1000),
        $lte: new Date(sourceItem.date.getTime() + dateRange * 24 * 60 * 60 * 1000)
      },
      $or: [
        { location: { $regex: sourceItem.location, $options: 'i' } },
        { title: { $regex: sourceItem.title.split(' ')[0], $options: 'i' } }
      ]
    }).populate('reportedBy', 'name email');

    res.json({
      success: true,
      data: matches,
      sourceItem: sourceItem.title
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createItem,
  getItems,
  getItem,
  updateItem,
  deleteItem,
  getMyItems,
  searchMatches
};
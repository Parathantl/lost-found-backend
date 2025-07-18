// controllers/claimController.js
const Item = require('../models/Item');
const User = require('../models/User');
const { validationResult } = require('express-validator');

// @desc    Submit claim for an item
// @route   POST /api/items/:id/claim
// @access  Private
const submitClaim = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { verificationDocuments, notes } = req.body;
    const itemId = req.params.id;

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Check if item is still active
    if (item.status !== 'active') {
      return res.status(400).json({ message: 'This item is no longer available for claims' });
    }

    // Check if user has already claimed this item
    const existingClaim = item.claims.find(
      claim => claim.claimedBy.toString() === req.user.id
    );

    if (existingClaim) {
      return res.status(400).json({ message: 'You have already submitted a claim for this item' });
    }

    // Add new claim
    const newClaim = {
      claimedBy: req.user.id,
      verificationDocuments: verificationDocuments || [],
      notes: notes || '',
      status: 'pending'
    };

    item.claims.push(newClaim);
    await item.save();

    // Populate the claim data for response
    const populatedItem = await Item.findById(itemId)
      .populate('claims.claimedBy', 'name email phone role');

    const submittedClaim = populatedItem.claims[populatedItem.claims.length - 1];

    res.status(201).json({
      success: true,
      message: 'Claim submitted successfully',
      data: submittedClaim
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get claims for an item
// @route   GET /api/items/:id/claims
// @access  Private (Staff/Admin)
const getItemClaims = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id)
      .populate('claims.claimedBy', 'name email phone role branch');

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    res.json({
      success: true,
      data: {
        item: {
          _id: item._id,
          title: item.title,
          status: item.status,
          type: item.type
        },
        claims: item.claims
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update claim status
// @route   PUT /api/items/:itemId/claims/:claimId
// @access  Private (Staff/Admin)
const updateClaimStatus = async (req, res) => {
  try {
    const { itemId, claimId } = req.params;
    const { status, notes } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const claim = item.claims.id(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Update claim status
    claim.status = status;
    if (notes) {
      claim.notes = notes;
    }

    // If claim is approved, update item status and reject other pending claims
    if (status === 'approved') {
      item.status = 'claimed';
      
      // Reject all other pending claims for this item
      item.claims.forEach(otherClaim => {
        if (otherClaim._id.toString() !== claimId && otherClaim.status === 'pending') {
          otherClaim.status = 'rejected';
          otherClaim.notes = 'Automatically rejected - another claim was approved';
        }
      });
    }

    await item.save();

    // Populate and return updated item
    const populatedItem = await Item.findById(itemId)
      .populate('claims.claimedBy', 'name email phone role branch')
      .populate('reportedBy', 'name email');

    res.json({
      success: true,
      message: `Claim ${status} successfully`,
      data: populatedItem
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark item as returned
// @route   PUT /api/items/:id/return
// @access  Private (Staff/Admin)
const markItemReturned = async (req, res) => {
  try {
    const { claimId, returnNotes } = req.body;
    const itemId = req.params.id;

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Check if item has been claimed
    if (item.status !== 'claimed') {
      return res.status(400).json({ message: 'Item must be claimed before it can be marked as returned' });
    }

    // If claimId is provided, verify the claim exists and is approved
    if (claimId) {
      const claim = item.claims.id(claimId);
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }
      if (claim.status !== 'approved') {
        return res.status(400).json({ message: 'Only approved claims can be marked as returned' });
      }
    }

    // Update item status
    item.status = 'returned';
    
    // Add return notes if provided
    if (returnNotes) {
      item.returnNotes = returnNotes;
      item.returnDate = new Date();
    }

    await item.save();

    const populatedItem = await Item.findById(itemId)
      .populate('claims.claimedBy', 'name email phone role')
      .populate('reportedBy', 'name email');

    res.json({
      success: true,
      message: 'Item marked as returned successfully',
      data: populatedItem
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's claims
// @route   GET /api/claims/my-claims
// @access  Private
const getMyClaims = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    // Build aggregation pipeline to find items with user's claims
    const pipeline = [
      { $unwind: '$claims' },
      { $match: { 'claims.claimedBy': req.user._id } },
      ...(status ? [{ $match: { 'claims.status': status } }] : []),
      {
        $lookup: {
          from: 'users',
          localField: 'reportedBy',
          foreignField: '_id',
          as: 'reportedBy'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'claims.claimedBy',
          foreignField: '_id',
          as: 'claims.claimedBy'
        }
      },
      { $unwind: '$reportedBy' },
      { $unwind: '$claims.claimedBy' },
      {
        $project: {
          title: 1,
          description: 1,
          category: 1,
          type: 1,
          status: 1,
          location: 1,
          date: 1,
          images: 1,
          createdAt: 1,
          'reportedBy.name': 1,
          'reportedBy.email': 1,
          claim: '$claims'
        }
      },
      { $sort: { 'claim.createdAt': -1 } },
      { $skip: (parseInt(page) - 1) * parseInt(limit) },
      { $limit: parseInt(limit) }
    ];

    const claims = await Item.aggregate(pipeline);

    // Count total for pagination
    const countPipeline = [
      { $unwind: '$claims' },
      { $match: { 'claims.claimedBy': req.user._id } },
      ...(status ? [{ $match: { 'claims.status': status } }] : []),
      { $count: 'total' }
    ];

    const countResult = await Item.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    res.json({
      success: true,
      data: claims,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: (parseInt(page) * parseInt(limit)) < total,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  submitClaim,
  getItemClaims,
  updateClaimStatus,
  markItemReturned,
  getMyClaims
};
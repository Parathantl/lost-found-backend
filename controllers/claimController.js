// controllers/claimController.js
const Item = require('../models/Item');
const { validationResult } = require('express-validator');

// @desc    Submit claim for found item
// @route   POST /api/items/:id/claim
// @access  Private
const submitClaim = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { verificationDocuments, notes } = req.body;
    
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    if (item.type !== 'found') {
      return res.status(400).json({ message: 'Can only claim found items' });
    }

    if (item.status !== 'active') {
      return res.status(400).json({ message: 'Item is not available for claiming' });
    }

    // Check if user already submitted a claim
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
      notes,
      status: 'pending'
    };

    item.claims.push(newClaim);

    // Add notification
    item.notifications.push({
      type: 'claim_submitted',
      message: `New claim submitted for ${item.title}`,
      date: new Date()
    });

    await item.save();

    const populatedItem = await Item.findById(item._id)
      .populate('claims.claimedBy', 'name email')
      .populate('reportedBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Claim submitted successfully',
      data: populatedItem
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all claims for an item (Staff/Admin only)
// @route   GET /api/items/:id/claims
// @access  Private (Staff/Admin)
const getItemClaims = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id)
      .populate('claims.claimedBy', 'name email phone')
      .populate('reportedBy', 'name email');

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    res.json({
      success: true,
      data: {
        item: {
          _id: item._id,
          title: item.title,
          description: item.description,
          reportedBy: item.reportedBy
        },
        claims: item.claims
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update claim status (Staff/Admin only)
// @route   PUT /api/items/:itemId/claims/:claimId
// @access  Private (Staff/Admin)
const updateClaimStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const { itemId, claimId } = req.params;

    if (!['pending', 'verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid claim status' });
    }

    const item = await Item.findById(itemId);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const claim = item.claims.id(claimId);
    
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Update claim
    claim.status = status;
    if (notes) claim.notes = notes;

    // If claim is verified, update item status
    if (status === 'verified') {
      item.status = 'claimed';
      
      // Add notification
      item.notifications.push({
        type: 'claim_verified',
        message: `Your claim for ${item.title} has been verified`,
        date: new Date()
      });
    }

    await item.save();

    const populatedItem = await Item.findById(itemId)
      .populate('claims.claimedBy', 'name email')
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

// @desc    Mark item as returned (Staff/Admin only)
// @route   PUT /api/items/:id/return
// @access  Private (Staff/Admin)
const markItemReturned = async (req, res) => {
  try {
    const { claimId, returnNotes } = req.body;
    
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    if (item.status !== 'claimed') {
      return res.status(400).json({ message: 'Item must be claimed before it can be returned' });
    }

    // Update item status
    item.status = 'returned';

    // Add notification
    item.notifications.push({
      type: 'item_returned',
      message: `${item.title} has been successfully returned`,
      date: new Date()
    });

    // Add return notes to the verified claim
    if (claimId) {
      const claim = item.claims.id(claimId);
      if (claim) {
        claim.notes = claim.notes ? `${claim.notes}\n\nReturn Notes: ${returnNotes}` : `Return Notes: ${returnNotes}`;
      }
    }

    await item.save();

    const populatedItem = await Item.findById(item._id)
      .populate('claims.claimedBy', 'name email')
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
    const items = await Item.find({
      'claims.claimedBy': req.user.id
    })
    .populate('reportedBy', 'name email')
    .select('title description type category location date status claims');

    // Filter to only show user's claims
    const userClaims = items.map(item => {
      const userClaim = item.claims.find(
        claim => claim.claimedBy.toString() === req.user.id
      );
      
      return {
        item: {
          _id: item._id,
          title: item.title,
          description: item.description,
          type: item.type,
          category: item.category,
          location: item.location,
          date: item.date,
          status: item.status,
          reportedBy: item.reportedBy
        },
        claim: userClaim
      };
    });

    res.json({
      success: true,
      data: userClaims
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
// controllers/claimController.js
const Item = require('../models/Item');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const NotificationService = require('../services/notificationService');

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

    // IMPORTANT: Explicitly map the verification documents to ensure all fields are preserved
    const processedDocuments = (verificationDocuments || []).map(doc => {
      return {
        url: doc.url,
        name: doc.name,
        type: doc.type,
        size: doc.size,
        publicId: doc.publicId
      };
    });

    // Create new claim with explicit structure
    const newClaim = {
      claimedBy: req.user.id,
      verificationDocuments: processedDocuments,
      notes: notes || '',
      status: 'pending'
    };

    // Add claim to item
    item.claims.push(newClaim);
    await item.save();

    try {
      await NotificationService.handleClaimSubmitted(item, req.user);
    } catch (notificationError) {
      console.error('Notification error (non-blocking):', notificationError);
    }

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
    console.error('Submit claim error:', error);
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

    const item = await Item.findById(itemId)
      .populate('reportedBy', 'name email')
      .populate('claims.claimedBy', 'name email');
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const claim = item.claims.id(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    // Store original status for comparison
    const originalStatus = claim.status;
    
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

    try {
      if (originalStatus !== status) {
        const claimant = claim.claimedBy;
        const reporter = item.reportedBy;
        const approver = req.user;

        switch (status) {
          case 'approved':
            // Notify the claimant that their claim was approved
            await NotificationService.handleClaimApproved(item, claimant, approver);
            
            // Notify the item reporter that a claim was approved
            if (reporter && reporter._id.toString() !== claimant._id.toString()) {
              await NotificationService.createNotification(reporter._id, {
                type: 'claim_approved',
                title: 'Claim Approved for Your Item',
                message: `A claim for your ${item.type} item "${item.title}" has been approved. The claimant may contact you soon.`,
                relatedItem: item._id,
                relatedUser: claimant._id,
                data: {
                  itemTitle: item.title,
                  itemType: item.type,
                  claimantName: claimant.name,
                  approvedBy: approver.name,
                  contactInfo: item.contactInfo
                }
              });
            }

            const rejectedClaims = item.claims.filter(c => 
              c._id.toString() !== claimId && 
              c.status === 'rejected' && 
              c.notes && c.notes.includes('Automatically rejected')
            );

            for (const rejectedClaim of rejectedClaims) {
              await NotificationService.createNotification(rejectedClaim.claimedBy._id, {
                type: 'claim_rejected',
                title: 'Claim Not Approved',
                message: `Your claim for "${item.title}" was not approved. Another claim was accepted first.`,
                relatedItem: item._id,
                relatedUser: approver._id,
                data: {
                  itemTitle: item.title,
                  itemType: item.type,
                  rejectedBy: approver.name,
                  reason: 'Another claim was approved first'
                }
              });
            }
            break;

          case 'rejected':
            // Notify the claimant that their claim was rejected
            const rejectionReason = notes || 'Claim verification failed';
            await NotificationService.handleClaimRejected(item, claimant, approver, rejectionReason);
            
            // Notify the item reporter about the rejection (optional - you might not want this)
            if (reporter && reporter._id.toString() !== claimant._id.toString()) {
              await NotificationService.createNotification(reporter._id, {
                type: 'claim_rejected',
                title: 'Claim Rejected for Your Item',
                message: `A claim for your ${item.type} item "${item.title}" has been reviewed and not approved.`,
                relatedItem: item._id,
                relatedUser: claimant._id,
                data: {
                  itemTitle: item.title,
                  itemType: item.type,
                  claimantName: claimant.name,
                  rejectedBy: approver.name,
                  reason: rejectionReason
                }
              });
            }
            break;

          case 'pending':
            // If status is changed back to pending (rare case)
            if (originalStatus !== 'pending') {
              await NotificationService.createNotification(claimant._id, {
                type: 'claim_submitted',
                title: 'Claim Status Updated',
                message: `Your claim for "${item.title}" status has been updated to pending review.`,
                relatedItem: item._id,
                relatedUser: approver._id,
                data: {
                  itemTitle: item.title,
                  itemType: item.type,
                  updatedBy: approver.name
                }
              });
            }
            break;
        }
      }
    } catch (notificationError) {
      console.error('❌ Error sending notifications (non-blocking):', notificationError);
    }

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
    console.error('Update claim status error:', error);
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
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const itemsWithMyClaims = await Item.find({
      'claims.claimedBy': userId
    })
    .populate('reportedBy', 'name email phone')
    .populate('claims.claimedBy', 'name email phone')
    .sort({ createdAt: -1 });

    const userClaims = [];
    
    itemsWithMyClaims.forEach(item => {
      const userClaimsOnItem = item.claims.filter(claim => 
        claim.claimedBy._id.toString() === userId
      );
      
      // For each claim by this user, create a result object
      userClaimsOnItem.forEach(claim => {
        userClaims.push({
          // The item data (what was lost/found)
          _id: item._id,
          title: item.title,
          description: item.description,
          category: item.category,
          type: item.type,
          status: item.status,
          location: item.location,
          date: item.date,
          images: item.images,
          reportedBy: item.reportedBy,
          createdAt: item.createdAt,
          
          // The user's claim data (nested under 'claim')
          claim: {
            _id: claim._id,
            claimedBy: claim.claimedBy,
            verificationDocuments: claim.verificationDocuments,
            notes: claim.notes,
            status: claim.status,
            createdAt: claim.createdAt,
            updatedAt: claim.updatedAt
          }
        });
      });
    });

    userClaims.sort((a, b) => new Date(b.claim.createdAt) - new Date(a.claim.createdAt));

    const paginatedClaims = userClaims.slice(skip, skip + limit);

    const pagination = {
      current: page,
      pages: Math.ceil(userClaims.length / limit),
      total: userClaims.length,
      hasNext: page < Math.ceil(userClaims.length / limit),
      hasPrev: page > 1
    };

    res.json({
      success: true,
      data: paginatedClaims,
      pagination
    });

  } catch (error) {
    console.error('Error getting user claims:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve claims',
      error: error.message
    });
  }
};

module.exports = {
  submitClaim,
  getItemClaims,
  updateClaimStatus,
  markItemReturned,
  getMyClaims
};
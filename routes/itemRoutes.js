// routes/itemRoutes.js
const express = require('express');
const { body } = require('express-validator');
const {
  createItem,
  getItems,
  getItem,
  updateItem,
  deleteItem,
  getMyItems,
  searchMatches,
  handoverToPolice
} = require('../controllers/itemController');
const {
  submitClaim,
  getItemClaims,
  updateClaimStatus,
  markItemReturned,
} = require('../controllers/claimController');
const { protect, staffOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Item validation rules
const itemValidation = [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('category').isIn(['electronics', 'clothing', 'accessories', 'documents', 'keys', 'bags', 'books', 'other'])
    .withMessage('Invalid category'),
  body('type').isIn(['lost', 'found']).withMessage('Type must be either lost or found'),
  body('location').notEmpty().withMessage('Location is required'),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('contactInfo.name').notEmpty().withMessage('Contact name is required'),
  body('contactInfo.email').isEmail().withMessage('Valid contact email is required'),
  body('contactInfo.phone').notEmpty().withMessage('Contact phone is required')
];

const claimValidation = [
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes must be less than 500 characters')
];

// Item routes
router.route('/')
  .get(getItems)                           // Public - Get all items with filters
  .post(protect, itemValidation, createItem); // Private - Create new item

router.get('/my-items', protect, getMyItems);    // Private - Get user's items
router.post('/search-matches', protect, searchMatches); // Private - Search for matches

router.route('/:id')
  .get(getItem)                            // Public - Get single item
  .put(protect, updateItem)                // Private - Update item (owner/staff/admin)
  .delete(protect, deleteItem);            // Private - Delete item (owner/staff/admin)

// Claim routes
router.post('/:id/claim', protect, claimValidation, submitClaim); // Private - Submit claim
router.get('/:id/claims', protect, staffOrAdmin, getItemClaims);  // Staff/Admin - Get item claims
router.put('/:itemId/claims/:claimId', protect, staffOrAdmin, updateClaimStatus); // Staff/Admin - Update claim status
router.put('/:id/return', protect, staffOrAdmin, markItemReturned); // Staff/Admin - Mark as returned
router.put(
  '/handover/:id',
  protect,
  staffOrAdmin,
  handoverToPolice
);

module.exports = router;
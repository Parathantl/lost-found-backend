// models/Item.js

const mongoose = require('mongoose');

const VerificationDocumentSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  size: {
    type: Number
  },
  publicId: {
    type: String
  }
}, { 
  _id: false,  // Don't create _id for subdocuments
  strict: false // Allow additional fields if needed
});

const ClaimSchema = new mongoose.Schema({
  claimedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  verificationDocuments: [VerificationDocumentSchema],
  notes: {
    type: String,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  }
}, { timestamps: true });

const ItemSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['electronics', 'clothing', 'accessories', 'documents', 'keys', 'bags', 'books', 'other']
  },
  type: {
    type: String,
    required: true,
    enum: ['lost', 'found']
  },
  status: {
    type: String,
    enum: ['active', 'claimed', 'returned', 'expired'],
    default: 'active'
  },
  location: {
    type: String,
    required: true
  },
  district: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  images: [{
    type: String // e.g., image URLs or base64 strings
  }],
  contactInfo: {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    }
  },
  additionalDetails: {
    color: String,
    brand: String,
    size: String,
    identifiers: String
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  handedOverToPolice: {
    type: Boolean,
    default: false
  },
  policeReportNumber: {
    type: String,
    trim: true
  },  
  claims: [ClaimSchema],
  expiryDate: {
    type: Date,
    default: function () {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    }
  }
}, {
  timestamps: true
});

// Indexes for efficient search
ItemSchema.index({ title: 'text', description: 'text', category: 1, type: 1, status: 1 });
ItemSchema.index({ location: 1, date: -1 });
ItemSchema.index({ 'claims.claimedBy': 1 });
ItemSchema.index({ 'claims.status': 1 });

// Pre-save middleware to automatically expire items
ItemSchema.pre('save', function(next) {
  if (this.status === 'active' && this.expiryDate < new Date()) {
    this.status = 'expired';
  }
  next();
});

// Method to get approved claim
ItemSchema.methods.getApprovedClaim = function() {
  return this.claims.find(claim => claim.status === 'approved');
};

// Method to check if item can accept new claims
ItemSchema.methods.canAcceptClaims = function() {
  return this.status === 'active' && this.expiryDate > new Date();
};

module.exports = mongoose.model('Item', ItemSchema);

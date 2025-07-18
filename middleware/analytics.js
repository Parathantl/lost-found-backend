// middleware/analytics.js
const Item = require('../models/Item');

// Middleware to check for expired items and send notifications
const checkExpiredItems = async (req, res, next) => {
  try {
    // Only run this check occasionally to avoid performance impact
    const shouldCheck = Math.random() < 0.1; // 10% chance
    
    if (shouldCheck) {
      const expiredItems = await Item.find({
        status: 'active',
        expiryDate: { $lt: new Date() }
      });

      // Update expired items
      if (expiredItems.length > 0) {
        await Item.updateMany(
          {
            status: 'active',
            expiryDate: { $lt: new Date() }
          },
          {
            $set: { status: 'expired' },
            $push: {
              notifications: {
                type: 'item_expired',
                message: 'Your item listing has expired',
                date: new Date(),
                read: false
              }
            }
          }
        );
      }
    }
    
    next();
  } catch (error) {
    // Don't fail the request if analytics fails
    console.error('Analytics middleware error:', error);
    next();
  }
};

// Middleware to log API usage
const logApiUsage = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user ? req.user.id : null,
      timestamp: new Date()
    };
    
  });
  
  next();
};

module.exports = {
  checkExpiredItems,
  logApiUsage
};
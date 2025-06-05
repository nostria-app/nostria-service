const express = require('express');
const router = express.Router();
const os = require('os');
const { adminAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const { accountsService } = require('../utils/AccountsTableService');
const { subscriptionsService } = require('../utils/SubscriptionsTableService');
const { paymentsService } = require('../utils/PaymentsTableService');

/**
 * Get service status
 * @route GET /api/status
 */
router.get('/', async (req, res) => {
  try {
    const status = {
      service: 'Nostria Service',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(status);
  } catch (error) {
    logger.error(`Error getting service status: ${error.message}`);
    res.status(500).json({ error: 'Failed to get service status' });
  }
});

/**
 * Get signup statistics (public endpoint)
 * @route GET /api/status/stats
 */
router.get('/stats', async (req, res) => {
  try {
    // This is a simplified version - in production you might want to cache these stats
    // and update them periodically rather than querying in real-time
    
    const stats = {
      totalUsers: 'Coming soon', // Would require scanning all entities or maintaining counters
      freeUsers: 'Coming soon',
      premiumUsers: 'Coming soon',
      premiumPlusUsers: 'Coming soon',
      signupsToday: 'Coming soon',
      message: 'Detailed statistics will be available in a future update'
    };

    res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error(`Error getting signup stats: ${error.message}`);
    res.status(500).json({ error: 'Failed to get signup statistics' });
  }
});

module.exports = router;

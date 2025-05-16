const express = require('express');
const router = express.Router();
const os = require('os');
const logger = require('../utils/logger');

/**
 * Get service status
 * @route GET /api/status
 */
router.get('/', async (req, res) => {
  try {
    const status = {
      service: 'Nostria Notification Service',
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      key: process.env.PUBLIC_VAPID_KEY,
      timestamp: new Date().toISOString(),

      // TODO: This information will not be provided in the future. This can be abused to validate if potential
      // attacks is successful (increased memory usage, etc.).
      system: {
        platform: os.platform(),
        arch: os.arch(),
        memory: {
          total: Math.round(os.totalmem() / (1024 * 1024)) + ' MB',
          free: Math.round(os.freemem() / (1024 * 1024)) + ' MB',
        }
      }
    };
    
    res.status(200).json(status);
  } catch (error) {
    logger.error(`Error getting service status: ${error.message}`);
    res.status(500).json({ error: 'Failed to get service status' });
  }
});

/**
 * Health check endpoint
 * @route GET /api/status/health
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

module.exports = router;

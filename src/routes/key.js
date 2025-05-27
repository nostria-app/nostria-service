const express = require('express');
const router = express.Router();
const os = require('os');
const logger = require('../utils/logger');

/**
 * Get service public key
 * @route GET /api/key
 */
router.get('/', async (req, res) => {
  try {
    const status = {
      key: process.env.PUBLIC_VAPID_KEY,
    };

    res.status(200).json(status);
  } catch (error) {
    logger.error(`Error getting service key: ${error.message}`);
    res.status(500).json({ error: 'Failed to get key' });
  }
});

module.exports = router;

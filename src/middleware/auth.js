const logger = require('../utils/logger');

/**
 * Middleware to authenticate API requests using API key
 */
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.NOTIFICATION_API_KEY) {
    logger.warn(`Unauthorized API access attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  
  next();
};

module.exports = {
  apiKeyAuth
};

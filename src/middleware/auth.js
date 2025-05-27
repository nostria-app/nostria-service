const logger = require('../utils/logger');
const { nip98 } = require('nostr-tools');

/**
 * Middleware to authenticate API requests using API key
 */
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
    logger.warn(`Unauthorized API access attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  
  next();
};

/**
 * Middleware to authenticate using NIP-98 token
 * Validates the authorization header and extracts the pubkey
 */
const nip98Auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    
    let valid = false;
    let pubkey = null;
    
    try {
      const result = await nip98.validateToken(authHeader, url, req.method);
      valid = result === true || (typeof result === 'object' && result.valid);
      
      // Extract pubkey from the token
      if (valid && authHeader.startsWith('Nostr ')) {
        const token = authHeader.substring(6);
        const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        pubkey = decoded.iss || decoded.pubkey;
      }
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${validationError.message}`);
      return res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
    }

    if (!valid || !pubkey) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    // Add the authenticated pubkey to the request object
    req.authenticatedPubkey = pubkey;
    req.authMethod = 'nip98';
    
    logger.debug(`NIP-98 authentication successful for pubkey: ${pubkey.substring(0, 16)}...`);
    next();
  } catch (error) {
    logger.error(`NIP-98 authentication error: ${error.message}`);
    res.status(500).json({ error: 'Authentication service error' });
  }
};

/**
 * Middleware to check if the authenticated user is an admin
 * Must be used after nip98Auth middleware
 */
const adminAuth = (req, res, next) => {
  if (!req.authenticatedPubkey) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const adminPubkeys = (process.env.ADMIN_PUBKEYS || '').split(',').map(key => key.trim()).filter(Boolean);
  
  if (!adminPubkeys.includes(req.authenticatedPubkey)) {
    logger.warn(`Admin access denied for pubkey: ${req.authenticatedPubkey.substring(0, 16)}... from IP: ${req.ip}`);
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.isAdmin = true;
  logger.info(`Admin access granted for pubkey: ${req.authenticatedPubkey.substring(0, 16)}...`);
  next();
};

/**
 * Middleware to optionally authenticate using NIP-98 token
 * If token is present, validates it and sets req.authenticatedPubkey
 * If no token, continues without authentication
 */
const optionalNip98Auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      // No auth header, continue without authentication
      return next();
    }

    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    
    try {
      const valid = await nip98.validateToken(authHeader, url, req.method);
      
      if (valid && authHeader.startsWith('Nostr ')) {
        const token = authHeader.substring(6);
        const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const pubkey = decoded.iss || decoded.pubkey;
        
        if (pubkey) {
          req.authenticatedPubkey = pubkey;
          req.authMethod = 'nip98';
          logger.debug(`Optional NIP-98 authentication successful for pubkey: ${pubkey.substring(0, 16)}...`);
        }
      }
    } catch (validationError) {
      // If validation fails, log but continue without auth
      logger.debug(`Optional NIP-98 validation failed: ${validationError.message}`);
    }

    next();
  } catch (error) {
    logger.error(`Optional NIP-98 authentication error: ${error.message}`);
    // Continue without authentication on error
    next();
  }
};

/**
 * Helper function to extract pubkey from request params or authenticated user
 * Used for routes that can access own data or admin accessing others' data
 */
const extractTargetPubkey = (req) => {
  const paramPubkey = req.params.pubkey;
  const authenticatedPubkey = req.authenticatedPubkey;
  const isAdmin = req.isAdmin;

  // If admin, they can access any pubkey specified in params
  if (isAdmin && paramPubkey) {
    return paramPubkey;
  }

  // If not admin, they can only access their own data
  if (authenticatedPubkey && paramPubkey === authenticatedPubkey) {
    return paramPubkey;
  }

  // If no specific pubkey in params, use authenticated user's pubkey
  if (authenticatedPubkey && !paramPubkey) {
    return authenticatedPubkey;
  }

  return null;
};

module.exports = {
  apiKeyAuth,
  nip98Auth,
  adminAuth,
  optionalNip98Auth,
  extractTargetPubkey
};

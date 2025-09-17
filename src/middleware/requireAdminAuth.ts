import { Response, NextFunction } from 'express';
import { NIP98AuthenticatedRequest } from '../routes/types';
import requireNIP98Auth from './requireNIP98Auth';
import config from '../config';
import logger from '../utils/logger';

/**
 * Middleware that requires admin authentication.
 * This middleware combines NIP98 authentication with admin public key verification.
 * Only users whose public keys are in the ADMIN_PUBKEYS environment variable can access protected routes.
 */
const requireAdminAuth = async (req: NIP98AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  // First, require standard NIP98 authentication
  await new Promise<void>((resolve, reject) => {
    requireNIP98Auth(req, res, (error?: any) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  }).catch(() => {
    // If NIP98 auth failed, the response was already sent by requireNIP98Auth
    return;
  });

  // If we reach here, NIP98 auth succeeded and authenticatedPubkey should be set
  const userPubkey = req.authenticatedPubkey;
  
  if (!userPubkey) {
    logger.warn('Admin auth check: No authenticated pubkey found after NIP98 auth');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Check if the authenticated user is an admin
  const adminPubkeys = config.admin.pubkeys;
  
  if (!adminPubkeys || adminPubkeys.length === 0) {
    logger.warn('Admin auth check: No admin pubkeys configured in environment');
    res.status(403).json({ error: 'Admin access not configured' });
    return;
  }

  if (!adminPubkeys.includes(userPubkey)) {
    logger.warn(`Admin auth check: User ${userPubkey.substring(0, 16)}... is not authorized for admin access`);
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  logger.info(`Admin auth check: Admin access granted to ${userPubkey.substring(0, 16)}...`);
  next();
};

export default requireAdminAuth;
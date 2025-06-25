import { NextFunction, Request, Response } from 'express';
import { nip98 } from 'nostr-tools';
import logger from '../utils/logger';
import { NIP98AuthenticatedRequest } from '../routes/types';

const requireNIP98Auth = async (req: Request, res: Response, next?: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'NIP98 Authorization header required' });
      return;
    }

    const host = process.env.NODE_ENV === 'test' ? 'localhost:3000' : req.get('host');
    const url = `${req.protocol}://${host}${req.originalUrl}`;

    let valid = false;
    let pubkey: string | null = null;

    try {
      const token = authHeader.replace('Nostr ', '');

      valid = await nip98.validateToken(token, url, req.method);

      // Extract pubkey from the token
      if (valid) {
        const unpackedEvent = await nip98.unpackEventFromToken(token)
        pubkey = unpackedEvent.pubkey
      }
    } catch (validationError: any) {
      logger.warn(`NIP-98 validation error: ${validationError.message}`);
      res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
      return;
    }

    if (!valid || !pubkey) {
      res.status(401).json({ error: 'Invalid NIP98 authorization token' });
      return;
    }

    // Add the authenticated pubkey to the request object
    (req as NIP98AuthenticatedRequest).authenticatedPubkey = pubkey;

    logger.debug(`NIP-98 authentication successful for pubkey: ${pubkey.substring(0, 16)}...`);
    next?.();
  } catch (error: any) {
    logger.error(`NIP-98 authentication error: ${error.message}`);
    res.status(500).json({ error: 'Authentication service error' });
  }
};

export default requireNIP98Auth;
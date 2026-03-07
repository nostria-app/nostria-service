import express, { Request, Response } from 'express';

import requireNIP98Auth from '../middleware/requireNIP98Auth';
import { NIP98AuthenticatedRequest } from './types';
import XService from '../services/XService';
import logger from '../utils/logger';

const router = express.Router();
const xService = new XService();

function ensureOwnPubkey(req: Request, res: Response): string | null {
  const authenticatedPubkey = (req as NIP98AuthenticatedRequest).authenticatedPubkey;
  const { pubkey } = req.params;

  if (!authenticatedPubkey || authenticatedPubkey !== pubkey) {
    res.status(403).json({ error: 'You may only manage your own X connection' });
    return null;
  }

  return pubkey;
}

router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const oauthToken = typeof req.query.oauth_token === 'string' ? req.query.oauth_token : undefined;
  const oauthVerifier = typeof req.query.oauth_verifier === 'string' ? req.query.oauth_verifier : undefined;
  const denied = typeof req.query.denied === 'string' ? req.query.denied : undefined;

  const redirectUrl = await xService.handleCallback(oauthToken, oauthVerifier, denied);
  res.redirect(302, redirectUrl);
});

router.get('/status/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  try {
    const status = await xService.getStatus(pubkey);
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Failed to get X status', error);
    res.status(500).json({ error: 'Failed to get X connection status' });
  }
});

router.post('/connect/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  try {
    const authorizeUrl = await xService.startAuthorization(pubkey);
    res.json({ success: true, data: { authorizeUrl } });
  } catch (error) {
    logger.error('Failed to start X authorization', error);
    res.status(500).json({ error: 'Failed to start X authorization', message: (error as Error).message });
  }
});

router.delete('/connection/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  try {
    const status = await xService.disconnect(pubkey);
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Failed to disconnect X account', error);
    res.status(500).json({ error: 'Failed to disconnect X account' });
  }
});

router.post('/post/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'Post text is required' });
    return;
  }

  try {
    const post = await xService.createPost(pubkey, text);
    res.status(201).json({ success: true, data: post });
  } catch (error) {
    logger.error('Failed to create X post', error);
    res.status(500).json({ error: 'Failed to create X post', message: (error as Error).message });
  }
});

export default router;
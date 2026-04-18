import express, { Request, Response } from 'express';

import requireAdminAuth from '../middleware/requireAdminAuth';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import logger from '../utils/logger';
import { GrokConfig } from '../models/grokConfig';
import GrokConfigService from '../services/GrokConfigService';
import GrokService, {
  GrokBalanceRequiredError,
  GrokPremiumRequiredError,
  GrokQuotaExceededError,
  GrokUnsupportedRequestError,
  GrokUpstreamError,
} from '../services/GrokService';
import { NIP98AuthenticatedRequest } from './types';

const router = express.Router();
const grokService = new GrokService();
const grokConfigService = new GrokConfigService();

function ensureOwnPubkey(req: Request, res: Response): string | null {
  const authenticatedPubkey = (req as NIP98AuthenticatedRequest).authenticatedPubkey;
  const { pubkey } = req.params;

  if (!authenticatedPubkey || authenticatedPubkey !== pubkey) {
    res.status(403).json({ error: 'You may only manage your own Grok usage' });
    return null;
  }

  return pubkey;
}

function handleGrokError(res: Response, error: unknown, fallbackMessage: string): void {
  if (error instanceof GrokPremiumRequiredError) {
    res.status(403).json({ error: error.message });
    return;
  }

  if (error instanceof GrokBalanceRequiredError || error instanceof GrokQuotaExceededError) {
    res.status(402).json({ error: error.message, message: 'Increase your Grok credits to continue.' });
    return;
  }

  if (error instanceof GrokUnsupportedRequestError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof GrokUpstreamError) {
    res.status(error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 502).json({
      error: error.message,
      message: typeof error.body === 'object' ? JSON.stringify(error.body) : undefined,
    });
    return;
  }

  res.status(500).json({ error: fallbackMessage });
}

router.get('/status/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  try {
    const status = await grokService.getStatus(pubkey);
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Failed to get Grok status', error);
    handleGrokError(res, error, 'Failed to get Grok status');
  }
});

router.get('/config', async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await grokConfigService.getPublicConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    logger.error('Failed to get Grok public config', error);
    res.status(500).json({ error: 'Failed to get Grok config' });
  }
});

router.get('/admin/config', requireAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await grokConfigService.getConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    logger.error('Failed to get Grok admin config', error);
    res.status(500).json({ error: 'Failed to get Grok admin config' });
  }
});

router.put('/admin/config', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await grokConfigService.updateConfig((req.body || {}) as Partial<GrokConfig>);
    res.json({ success: true, data: config });
  } catch (error) {
    logger.error('Failed to update Grok admin config', error);
    res.status(500).json({ error: 'Failed to update Grok admin config' });
  }
});

router.post('/topup/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  try {
    const amountCents = typeof req.body?.amountCents === 'number' ? req.body.amountCents : parseInt(String(req.body?.amountCents || ''), 10);
    const payment = await grokService.createTopUpPayment(pubkey, amountCents);
    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    logger.error('Failed to create Grok top-up payment', error);
    handleGrokError(res, error, 'Failed to create Grok top-up payment');
  }
});

router.post('/responses/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  try {
    const result = await grokService.createResponse(pubkey, req.body || {});
    res.status(201).json({ success: true, data: result.response, billing: result.charge });
  } catch (error) {
    logger.error('Failed to create Grok response', error);
    handleGrokError(res, error, 'Failed to create Grok response');
  }
});

router.post('/images/:pubkey', requireNIP98Auth, async (req: Request, res: Response): Promise<void> => {
  const pubkey = ensureOwnPubkey(req, res);
  if (!pubkey) {
    return;
  }

  try {
    const result = await grokService.createImages(pubkey, req.body || {});
    res.status(201).json({ success: true, data: result.response, billing: result.charge });
  } catch (error) {
    logger.error('Failed to create Grok images', error);
    handleGrokError(res, error, 'Failed to create Grok images');
  }
});

export default router;
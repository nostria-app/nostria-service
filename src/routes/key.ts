import express, { Request, Response } from 'express';
import logger from '../utils/logger';

const router = express.Router();

/**
 * Get service public key
 * @route GET /api/key
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = {
      key: process.env.PUBLIC_VAPID_KEY,
    };

    res.status(200).json(status);
  } catch (error) {
    logger.error(`Error getting service key: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to get key' });
  }
});

export default router;

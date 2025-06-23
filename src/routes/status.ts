import express, { Request, Response } from 'express';
import os from 'os';
import logger from '../utils/logger';

const router = express.Router();

/**
 * Get service status
 * @route GET /api/status
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = {
      service: 'Nostria Service',
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
    logger.error(`Error getting service status: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to get service status' });
  }
});

/**
 * Health check endpoint
 * @route GET /api/status/health
 */
router.get('/health', (req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
});

export default router;

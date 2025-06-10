import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Middleware to authenticate API requests using API key
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey || apiKey !== process.env.NOTIFICATION_API_KEY) {
    logger.warn(`Unauthorized API access attempt from ${req.ip}`);
    res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    return;
  }
  
  next();
};

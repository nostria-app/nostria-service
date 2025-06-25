import rateLimit from "express-rate-limit";
import { Request, Response } from 'express';

interface RateLimitMessage {
  error: string;
  retryAfter: number;
}

// General API rate limiting
export const createRateLimit = (
  windowMs: number,
  max: number,
  message: string,
) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    } as RateLimitMessage,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    },
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress || '';
      return ip.split(':').slice(-1)[0]; // strips port if present
    }
  });
};
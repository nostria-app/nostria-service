import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

interface CustomError extends Error {
  statusCode?: number;
}

/**
 * Error handler middleware
 */
export const errorHandler = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  const statusCode = err.statusCode || 500;
  
  // Log error details
  logger.error(`${statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  logger.error(err.stack || '');

  // Send error response
  res.status(statusCode).json({
    error: {
      message: process.env.NODE_ENV === 'production' ? 'Server error' : err.message,
      status: statusCode,
    }
  });
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const err: CustomError = new Error(`Not Found - ${req.originalUrl}`);
  err.statusCode = 404;
  logger.warn(`404 - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  next(err);
};

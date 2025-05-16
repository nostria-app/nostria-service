const logger = require('../utils/logger');

/**
 * Error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  
  // Log error details
  logger.error(`${statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  logger.error(err.stack);

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
const notFoundHandler = (req, res, next) => {
  const err = new Error(`Not Found - ${req.originalUrl}`);
  err.statusCode = 404;
  logger.warn(`404 - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  next(err);
};

module.exports = {
  errorHandler,
  notFoundHandler
};

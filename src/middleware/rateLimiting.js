const rateLimit = require('express-rate-limit');

// General API rate limiting
const createRateLimit = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

// Public endpoints - more restrictive
const publicApiLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // limit each IP to 100 requests per windowMs
  'Too many requests from this IP, please try again later.'
);

// Signup endpoints - very restrictive to prevent abuse
const signupLimiter = createRateLimit(
  60 * 60 * 1000, // 1 hour
  5, // limit each IP to 5 signup attempts per hour
  'Too many signup attempts from this IP, please try again later.'
);

// Authenticated endpoints - less restrictive
const authenticatedLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  500, // limit each IP to 500 requests per windowMs
  'Too many authenticated requests from this IP, please try again later.'
);

// Admin endpoints - moderate restriction
const adminLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  200, // limit each IP to 200 admin requests per windowMs
  'Too many admin requests from this IP, please try again later.'
);

// Payment/subscription operations - more restrictive
const paymentLimiter = createRateLimit(
  5 * 60 * 1000, // 5 minutes
  10, // limit each IP to 10 payment operations per 5 minutes
  'Too many payment requests from this IP, please try again later.'
);

module.exports = {
  publicApiLimiter,
  signupLimiter,
  authenticatedLimiter,
  adminLimiter,
  paymentLimiter
};

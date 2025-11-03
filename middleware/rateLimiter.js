const rateLimit = require('express-rate-limit');

// General API rate limiter - 100 requests per 15 minutes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Rate limiter for login endpoints - tracks by email+IP to prevent one user blocking others from same IP
// Note: Account lockout (5 failed attempts per email+IP) is the primary protection
// This rate limiter is a secondary protection that tracks per email+IP combination
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each email+IP combination to 10 login requests per windowMs
  message: {
    success: false,
    message: 'Too many login attempts for this account, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful login requests
  // Use a custom key generator to track by email+IP combination (not just IP)
  keyGenerator: (req) => {
    const email = req.body?.email || req.body?.username || 'unknown';
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    // Track by email+IP combination so one user doesn't block others from same IP
    return `login_${email}_${ip}`;
  },
});

// Moderate rate limiter for password reset - 3 requests per hour per email+IP
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each email+IP combination to 3 password reset requests per hour
  message: {
    success: false,
    message: 'Too many password reset attempts for this account, please try again after 1 hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Track by email+IP combination so one user doesn't block others from same IP
  keyGenerator: (req) => {
    const email = req.body?.email || 'unknown';
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    return `password_reset_${email}_${ip}`;
  },
});

// Strict rate limiter for registration - 3 requests per hour
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 registration attempts per hour
  message: {
    success: false,
    message: 'Too many registration attempts, please try again after 1 hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// API endpoint rate limiter - 200 requests per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  message: {
    success: false,
    message: 'Too many API requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  generalLimiter,
  loginLimiter,
  passwordResetLimiter,
  registrationLimiter,
  apiLimiter
};


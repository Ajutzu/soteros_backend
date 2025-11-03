const pool = require('../config/conn');
const NodeCache = require('node-cache');

// Cache for tracking login attempts (in-memory for quick access)
// This could also be stored in database for distributed systems
const loginAttemptsCache = new NodeCache({ stdTTL: 900 }); // 15 minutes TTL

// Maximum failed login attempts before lockout
const MAX_FAILED_ATTEMPTS = 5;
// Lockout duration in milliseconds (30 minutes)
const LOCKOUT_DURATION = 30 * 60 * 1000;

/**
 * Get login attempt key for tracking
 * @param {string} identifier - Email or username
 * @param {string} ip - IP address
 * @returns {string} - Cache key
 */
function getAttemptKey(identifier, ip) {
  return `login_attempt_${identifier}_${ip}`;
}

/**
 * Record a failed login attempt
 * @param {string} identifier - Email or username
 * @param {string} ip - IP address
 * @returns {object} - { locked: boolean, remainingAttempts: number }
 */
async function recordFailedAttempt(identifier, ip) {
  const key = getAttemptKey(identifier, ip);
  
  // Get current attempt count
  let attempts = loginAttemptsCache.get(key) || { count: 0, firstAttempt: Date.now() };
  
  attempts.count += 1;
  const remainingAttempts = MAX_FAILED_ATTEMPTS - attempts.count;
  
  // Store in cache
  loginAttemptsCache.set(key, attempts, 900); // 15 minutes
  
  // Store in database for persistence (table might not exist in all environments)
  try {
    await pool.execute(
      `INSERT INTO login_attempts (identifier, ip_address, attempt_count, created_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
       attempt_count = attempt_count + 1,
       last_attempt = NOW()`,
      [identifier, ip, attempts.count]
    );
  } catch (error) {
    // Table might not exist yet - that's okay, we'll use cache only
    // Only log error if it's not a table doesn't exist error
    if (!error.message.includes("doesn't exist") && !error.message.includes('ER_NO_SUCH_TABLE')) {
      console.error('Error recording login attempt in database:', error.message);
    }
    // Don't fail the operation if database logging fails
  }

  return {
    locked: attempts.count >= MAX_FAILED_ATTEMPTS,
    remainingAttempts: Math.max(0, remainingAttempts),
    lockoutUntil: attempts.count >= MAX_FAILED_ATTEMPTS 
      ? Date.now() + LOCKOUT_DURATION 
      : null
  };
}

/**
 * Clear failed login attempts after successful login
 * @param {string} identifier - Email or username
 * @param {string} ip - IP address
 */
async function clearFailedAttempts(identifier, ip) {
  const key = getAttemptKey(identifier, ip);
  loginAttemptsCache.del(key);
  
  try {
    await pool.execute(
      'DELETE FROM login_attempts WHERE identifier = ? AND ip_address = ?',
      [identifier, ip]
    );
  } catch (error) {
    // Table might not exist yet - that's okay
    if (!error.message.includes("doesn't exist") && !error.message.includes('ER_NO_SUCH_TABLE')) {
      console.error('Error clearing login attempts from database:', error.message);
    }
  }
}

/**
 * Check if account is locked
 * @param {string} identifier - Email or username
 * @param {string} ip - IP address
 * @returns {object} - { locked: boolean, lockoutUntil: Date | null, remainingAttempts: number }
 */
async function checkAccountLockout(identifier, ip) {
  const key = getAttemptKey(identifier, ip);
  const attempts = loginAttemptsCache.get(key);
  
  if (!attempts || attempts.count < MAX_FAILED_ATTEMPTS) {
    // Check database as well (if table exists)
    try {
      const [dbAttempts] = await pool.execute(
        'SELECT attempt_count, last_attempt FROM login_attempts WHERE identifier = ? AND ip_address = ?',
        [identifier, ip]
      );
      
      if (dbAttempts.length > 0 && dbAttempts[0].attempt_count >= MAX_FAILED_ATTEMPTS) {
        const lastAttempt = new Date(dbAttempts[0].last_attempt).getTime();
        const lockoutUntil = lastAttempt + LOCKOUT_DURATION;
        
        if (Date.now() < lockoutUntil) {
          return {
            locked: true,
            lockoutUntil: new Date(lockoutUntil),
            remainingAttempts: 0
          };
        } else {
          // Lockout expired, clear attempts
          await clearFailedAttempts(identifier, ip);
          return { locked: false, lockoutUntil: null, remainingAttempts: MAX_FAILED_ATTEMPTS };
        }
      }
    } catch (error) {
      // Table might not exist yet - that's okay, we'll use cache only
      if (!error.message.includes("doesn't exist") && !error.message.includes('ER_NO_SUCH_TABLE')) {
        console.error('Error checking account lockout in database:', error.message);
      }
    }
    
    return { 
      locked: false, 
      lockoutUntil: null, 
      remainingAttempts: attempts ? MAX_FAILED_ATTEMPTS - attempts.count : MAX_FAILED_ATTEMPTS 
    };
  }
  
  // Check if lockout period has expired
  const lockoutUntil = attempts.firstAttempt + LOCKOUT_DURATION;
  if (Date.now() < lockoutUntil) {
    return {
      locked: true,
      lockoutUntil: new Date(lockoutUntil),
      remainingAttempts: 0
    };
  } else {
    // Lockout expired, clear attempts
    await clearFailedAttempts(identifier, ip);
    return { locked: false, lockoutUntil: null, remainingAttempts: MAX_FAILED_ATTEMPTS };
  }
}

/**
 * Get client IP address from request
 * @param {object} req - Express request object
 * @returns {string} - IP address
 */
function getClientIP(req) {
  return req.ip || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         'unknown';
}

module.exports = {
  recordFailedAttempt,
  clearFailedAttempts,
  checkAccountLockout,
  getClientIP,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION
};


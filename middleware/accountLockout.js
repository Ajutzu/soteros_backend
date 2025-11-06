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
  
  // First, check database for existing attempts and sync with cache
  let attempts = loginAttemptsCache.get(key);
  let shouldReset = false;
  
  try {
    const [dbAttempts] = await pool.execute(
      'SELECT attempt_count, last_attempt, created_at FROM login_attempts WHERE identifier = ? AND ip_address = ?',
      [identifier, ip]
    );
    
    if (dbAttempts.length > 0) {
      const dbRecord = dbAttempts[0];
      const lastAttempt = new Date(dbRecord.last_attempt).getTime();
      const firstAttempt = new Date(dbRecord.created_at).getTime();
      const lockoutUntil = lastAttempt + LOCKOUT_DURATION;
      
      // Check if lockout period has expired (more than 30 minutes since last attempt)
      if (Date.now() >= lockoutUntil) {
        // Lockout expired, clear the record and start fresh
        await clearFailedAttempts(identifier, ip);
        attempts = { count: 0, firstAttempt: Date.now() };
        shouldReset = true;
      } else {
        // Sync cache with database - use database count if higher
        if (!attempts || attempts.count < dbRecord.attempt_count) {
          attempts = {
            count: dbRecord.attempt_count,
            firstAttempt: firstAttempt
          };
        }
      }
    }
  } catch (error) {
    // Table might not exist yet - that's okay, we'll use cache only
    if (!error.message.includes("doesn't exist") && !error.message.includes('ER_NO_SUCH_TABLE')) {
      console.error('Error checking database for login attempts:', error.message);
    }
  }
  
  // If no attempts found in cache or database, initialize
  if (!attempts) {
    attempts = { count: 0, firstAttempt: Date.now() };
  }
  
  // Increment attempt count
  attempts.count += 1;
  const remainingAttempts = MAX_FAILED_ATTEMPTS - attempts.count;
  
  // Store in cache
  loginAttemptsCache.set(key, attempts, 900); // 15 minutes
  
  // Store in database for persistence
  try {
    if (shouldReset) {
      // Insert new record after clearing
      await pool.execute(
        `INSERT INTO login_attempts (identifier, ip_address, attempt_count, created_at, last_attempt)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [identifier, ip, attempts.count]
      );
    } else {
      // Update existing record or insert new one
      await pool.execute(
        `INSERT INTO login_attempts (identifier, ip_address, attempt_count, created_at, last_attempt)
         VALUES (?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
         attempt_count = ?,
         last_attempt = NOW()`,
        [identifier, ip, attempts.count, attempts.count]
      );
    }
  } catch (error) {
    // Table might not exist yet - that's okay, we'll use cache only
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
  let attempts = loginAttemptsCache.get(key);
  
  // Check database first to sync with cache
  try {
    const [dbAttempts] = await pool.execute(
      'SELECT attempt_count, last_attempt, created_at FROM login_attempts WHERE identifier = ? AND ip_address = ?',
      [identifier, ip]
    );
    
    if (dbAttempts.length > 0) {
      const dbRecord = dbAttempts[0];
      const lastAttempt = new Date(dbRecord.last_attempt).getTime();
      const firstAttempt = new Date(dbRecord.created_at).getTime();
      const lockoutUntil = lastAttempt + LOCKOUT_DURATION;
      
      // Check if lockout period has expired
      if (Date.now() >= lockoutUntil) {
        // Lockout expired, clear attempts
        await clearFailedAttempts(identifier, ip);
        return { locked: false, lockoutUntil: null, remainingAttempts: MAX_FAILED_ATTEMPTS };
      }
      
      // Sync cache with database
      if (!attempts || attempts.count < dbRecord.attempt_count) {
        attempts = {
          count: dbRecord.attempt_count,
          firstAttempt: firstAttempt
        };
        // Update cache
        loginAttemptsCache.set(key, attempts, 900);
      }
      
      // Check if account is locked based on database record
      if (dbRecord.attempt_count >= MAX_FAILED_ATTEMPTS) {
        return {
          locked: true,
          lockoutUntil: new Date(lockoutUntil),
          remainingAttempts: 0
        };
      }
    }
  } catch (error) {
    // Table might not exist yet - that's okay, we'll use cache only
    if (!error.message.includes("doesn't exist") && !error.message.includes('ER_NO_SUCH_TABLE')) {
      console.error('Error checking account lockout in database:', error.message);
    }
  }
  
  // If no attempts found in cache or database
  if (!attempts || attempts.count < MAX_FAILED_ATTEMPTS) {
    return { 
      locked: false, 
      lockoutUntil: null, 
      remainingAttempts: attempts ? MAX_FAILED_ATTEMPTS - attempts.count : MAX_FAILED_ATTEMPTS 
    };
  }
  
  // Check if lockout period has expired based on cache
  // Use firstAttempt + LOCKOUT_DURATION as fallback (since cache doesn't have lastAttempt)
  // But this should be rare since we sync with database first
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
 * Clean up expired login attempts from database (run periodically)
 * This helps keep the database clean by removing old records
 */
async function cleanupExpiredAttempts() {
  try {
    const result = await pool.execute(
      `DELETE FROM login_attempts 
       WHERE last_attempt < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [LOCKOUT_DURATION / (60 * 1000)] // Convert to minutes
    );
    
    if (result[0].affectedRows > 0) {
      console.log(`Cleaned up ${result[0].affectedRows} expired login attempt records`);
    }
  } catch (error) {
    // Table might not exist yet - that's okay
    if (!error.message.includes("doesn't exist") && !error.message.includes('ER_NO_SUCH_TABLE')) {
      console.error('Error cleaning up expired login attempts:', error.message);
    }
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

// Run cleanup every hour to remove expired records
setInterval(() => {
  cleanupExpiredAttempts().catch(err => {
    console.error('Error in scheduled cleanup of login attempts:', err);
  });
}, 60 * 60 * 1000); // Every hour

module.exports = {
  recordFailedAttempt,
  clearFailedAttempts,
  checkAccountLockout,
  getClientIP,
  cleanupExpiredAttempts,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION
};


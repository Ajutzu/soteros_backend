const pool = require('../config/conn');
const NodeCache = require('node-cache');
const { getClientIP: getNormalizedIP } = require('../utils/ipUtils');

// Cache for tracking login attempts (in-memory for quick access)
// This could also be stored in database for distributed systems
const loginAttemptsCache = new NodeCache({ stdTTL: 900 }); // 15 minutes TTL

// Cache to track recent attempts to prevent duplicate increments from rapid sequential calls
// (e.g., frontend trying user/staff/admin endpoints in quick succession)
const recentAttemptsCache = new NodeCache({ stdTTL: 3 }); // 3 seconds TTL

// Maximum failed login attempts before lockout
const MAX_FAILED_ATTEMPTS = 5;
// Progressive lockout durations
const FIRST_LOCKOUT_THRESHOLD = 3; // After 3 failed attempts
const FIRST_LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes
const FINAL_LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes (after 5 failed attempts)

/**
 * Get lockout duration based on attempt count
 * @param {number} attemptCount - Number of failed attempts
 * @returns {number} - Lockout duration in milliseconds
 */
function getLockoutDuration(attemptCount) {
  if (attemptCount >= MAX_FAILED_ATTEMPTS) {
    return FINAL_LOCKOUT_DURATION; // 30 minutes for 5+ attempts
  } else if (attemptCount >= FIRST_LOCKOUT_THRESHOLD) {
    return FIRST_LOCKOUT_DURATION; // 5 minutes for 3-4 attempts
  }
  return 0; // No lockout for less than 3 attempts
}

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
  const recentKey = `recent_${key}`;
  
  // Check if we recently recorded an attempt for this identifier+IP (within 3 seconds)
  // This prevents multiple increments when frontend tries multiple login endpoints rapidly
  const recentAttempt = recentAttemptsCache.get(recentKey);
  const now = Date.now();
  
  if (recentAttempt && (now - recentAttempt) < 3000) {
    // Recent attempt recorded within last 3 seconds, just return current status without incrementing
    const lockoutCheck = await checkAccountLockout(identifier, ip);
    return {
      locked: lockoutCheck.locked,
      remainingAttempts: lockoutCheck.remainingAttempts,
      lockoutUntil: lockoutCheck.lockoutUntil
    };
  }
  
  // Mark that we're recording an attempt now
  recentAttemptsCache.set(recentKey, now, 3);
  
  // First, check if account is already locked (to avoid unnecessary increments)
  const lockoutCheck = await checkAccountLockout(identifier, ip);
  if (lockoutCheck.locked) {
    return {
      locked: true,
      remainingAttempts: 0,
      lockoutUntil: lockoutCheck.lockoutUntil
    };
  }
  
  // Use atomic increment in database to prevent race conditions
  // This ensures that even with concurrent requests, the count is accurate
  let newCount = 1;
  let firstAttempt = Date.now();
  
  try {
    // First, try to atomically increment the count in the database
    // This prevents race conditions where multiple requests read the same count
    await pool.execute(
      `INSERT INTO login_attempts (identifier, ip_address, attempt_count, created_at, last_attempt)
       VALUES (?, ?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
       attempt_count = attempt_count + 1,
       last_attempt = NOW()`,
      [identifier, ip]
    );
    
    // Now read back the actual count from database (after atomic increment)
    const [dbAttempts] = await pool.execute(
      'SELECT attempt_count, last_attempt, created_at FROM login_attempts WHERE identifier = ? AND ip_address = ?',
      [identifier, ip]
    );
    
    if (dbAttempts.length > 0) {
      const dbRecord = dbAttempts[0];
      newCount = dbRecord.attempt_count;
      firstAttempt = new Date(dbRecord.created_at).getTime();
      
      // Check if lockout should be applied after this increment
      const lastAttempt = new Date(dbRecord.last_attempt).getTime();
      const lockoutDuration = getLockoutDuration(newCount);
      const lockoutUntil = lockoutDuration > 0 ? lastAttempt + lockoutDuration : null;
      
      // Update cache with the new count
      loginAttemptsCache.set(key, {
        count: newCount,
        firstAttempt: firstAttempt
      }, 900); // 15 minutes
      
      const isLocked = lockoutDuration > 0;
      const remainingAttempts = isLocked ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - newCount);
      
      return {
        locked: isLocked,
        remainingAttempts: remainingAttempts,
        lockoutUntil: lockoutUntil ? new Date(lockoutUntil) : null
      };
    }
  } catch (error) {
    // Table might not exist yet - that's okay, we'll use cache only
    if (!error.message.includes("doesn't exist") && !error.message.includes('ER_NO_SUCH_TABLE')) {
      console.error('Error recording login attempt in database:', error.message);
    }
    
    // Fallback to cache-based tracking if database fails
    let attempts = loginAttemptsCache.get(key);
    if (!attempts) {
      attempts = { count: 0, firstAttempt: Date.now() };
    }
    newCount = attempts.count + 1;
    attempts.count = newCount;
    firstAttempt = attempts.firstAttempt;
    
    loginAttemptsCache.set(key, attempts, 900);
  }
  
  // Calculate lockout status
  const lockoutDuration = getLockoutDuration(newCount);
  const isLocked = lockoutDuration > 0;
  const remainingAttempts = isLocked ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - newCount);
  const lockoutUntil = isLocked ? Date.now() + lockoutDuration : null;
  
  // Update cache
  loginAttemptsCache.set(key, {
    count: newCount,
    firstAttempt: firstAttempt
  }, 900);

  return {
    locked: isLocked,
    remainingAttempts: remainingAttempts,
    lockoutUntil: lockoutUntil ? new Date(lockoutUntil) : null
  };
}

/**
 * Clear failed login attempts after successful login
 * @param {string} identifier - Email or username
 * @param {string} ip - IP address
 */
async function clearFailedAttempts(identifier, ip) {
  const key = getAttemptKey(identifier, ip);
  const recentKey = `recent_${key}`;
  
  // Clear both caches
  loginAttemptsCache.del(key);
  recentAttemptsCache.del(recentKey);
  
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
      const lockoutDuration = getLockoutDuration(dbRecord.attempt_count);
      const lockoutUntil = lockoutDuration > 0 ? lastAttempt + lockoutDuration : null;
      
      // Check if lockout period has expired
      if (lockoutUntil && Date.now() >= lockoutUntil) {
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
      if (lockoutUntil && Date.now() < lockoutUntil) {
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
  // This should be rare since we sync with database first
  const lockoutDuration = getLockoutDuration(attempts.count);
  if (lockoutDuration > 0) {
    // Cache doesn't have lastAttempt, so we use firstAttempt + lockoutDuration as fallback
    // This is not ideal but should be rare
    const lockoutUntil = attempts.firstAttempt + lockoutDuration;
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
  
  // No lockout, return unlocked
  return { 
    locked: false, 
    lockoutUntil: null, 
    remainingAttempts: MAX_FAILED_ATTEMPTS - attempts.count 
  };
}

/**
 * Clean up expired login attempts from database (run periodically)
 * This helps keep the database clean by removing old records
 */
async function cleanupExpiredAttempts() {
  try {
    // Clean up records that are older than the maximum lockout duration (30 minutes)
    const result = await pool.execute(
      `DELETE FROM login_attempts 
       WHERE last_attempt < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [FINAL_LOCKOUT_DURATION / (60 * 1000)] // Convert to minutes (30 minutes)
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
 * Get client IP address from request (uses shared utility)
 * @param {object} req - Express request object
 * @returns {string} - Normalized IP address
 */
function getClientIP(req) {
  return getNormalizedIP(req);
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
  FIRST_LOCKOUT_THRESHOLD,
  FIRST_LOCKOUT_DURATION,
  FINAL_LOCKOUT_DURATION,
  getLockoutDuration
};


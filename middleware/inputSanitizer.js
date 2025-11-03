/**
 * Input Sanitization Middleware
 * Removes potential XSS and injection attack vectors from user input
 */

// List of dangerous patterns to remove/escape
const dangerousPatterns = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi, // Event handlers like onclick=
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
  /vbscript:/gi,
  /data:text\/html/gi,
];

/**
 * Sanitize a string by removing dangerous patterns
 * @param {string} input - The input string to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(input) {
  if (typeof input !== 'string') {
    return input;
  }

  let sanitized = input;
  
  // Remove dangerous patterns
  dangerousPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });

  // Escape HTML entities (optional - use when you need to display user input)
  // sanitized = sanitized
  //   .replace(/&/g, '&amp;')
  //   .replace(/</g, '&lt;')
  //   .replace(/>/g, '&gt;')
  //   .replace(/"/g, '&quot;')
  //   .replace(/'/g, '&#x27;');

  return sanitized.trim();
}

/**
 * Sanitize an object recursively
 * @param {any} obj - Object to sanitize
 * @returns {any} - Sanitized object
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Middleware to sanitize request body, query, and params
 */
const sanitizeInput = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} - { valid: boolean, errors: string[] }
 */
function validatePasswordStrength(password) {
  const errors = [];
  
  if (typeof password !== 'string') {
    return { valid: false, errors: ['Password must be a string'] };
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Check for common weak passwords
  const commonPasswords = ['password', '12345678', 'qwerty', 'abc123', 'letmein', 'welcome'];
  if (commonPasswords.some(weak => password.toLowerCase().includes(weak))) {
    errors.push('Password is too common and easily guessable');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  sanitizeInput,
  sanitizeString,
  sanitizeObject,
  validateEmail,
  validatePasswordStrength
};


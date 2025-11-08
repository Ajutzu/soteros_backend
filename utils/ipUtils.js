/**
 * Utility functions for IP address handling
 */

/**
 * Normalize IPv6-mapped IPv4 address to IPv4 format
 * Converts ::ffff:192.168.1.1 to 192.168.1.1
 * @param {string} ip - IP address (can be IPv4, IPv6, or IPv6-mapped IPv4)
 * @returns {string} - Normalized IP address
 */
function normalizeIP(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  
  // Handle IPv6-mapped IPv4 addresses (::ffff:xxx.xxx.xxx.xxx)
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7); // Remove ::ffff: prefix
  }
  
  // Handle IPv6-mapped IPv4 in different format
  if (ip.includes('::ffff:')) {
    return ip.split('::ffff:')[1] || ip;
  }
  
  // Handle x-forwarded-for header (may contain multiple IPs)
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
    // Recursively normalize the first IP
    return normalizeIP(ip);
  }
  
  return ip;
}

/**
 * Get client IP address from request and normalize it
 * Priority order (when behind proxy):
 * 1. x-forwarded-for header (first IP in chain) - most reliable when behind proxy
 * 2. x-real-ip header - alternative proxy header
 * 3. req.ip - Express's IP (works when trust proxy is enabled)
 * 4. Direct connection IPs - fallback for direct connections
 * 
 * @param {object} req - Express request object
 * @param {boolean} debug - Optional: Enable debug logging to see IP extraction process
 * @returns {string} - Normalized IP address
 */
function getClientIP(req, debug = false) {
  let extractedIP = null;
  let source = '';
  
  // Priority 1: x-forwarded-for header (most reliable when behind proxy/load balancer)
  // Format: "client-ip, proxy1-ip, proxy2-ip" - we want the first one (original client)
  if (req.headers['x-forwarded-for']) {
    const forwardedIPs = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim());
    if (forwardedIPs.length > 0 && forwardedIPs[0]) {
      extractedIP = normalizeIP(forwardedIPs[0]);
      source = 'x-forwarded-for';
      if (debug) {
        console.log(`🌐 [IP DEBUG] Source: ${source}, Raw: ${req.headers['x-forwarded-for']}, Extracted: ${extractedIP}`);
      }
      return extractedIP;
    }
  }
  
  // Priority 2: x-real-ip header (alternative proxy header)
  if (req.headers['x-real-ip']) {
    extractedIP = normalizeIP(req.headers['x-real-ip']);
    source = 'x-real-ip';
    if (debug) {
      console.log(`🌐 [IP DEBUG] Source: ${source}, Raw: ${req.headers['x-real-ip']}, Extracted: ${extractedIP}`);
    }
    return extractedIP;
  }
  
  // Priority 3: req.ip (Express's IP - works when trust proxy is enabled)
  if (req.ip) {
    extractedIP = normalizeIP(req.ip);
    source = 'req.ip';
    if (debug) {
      console.log(`🌐 [IP DEBUG] Source: ${source}, Raw: ${req.ip}, Extracted: ${extractedIP}`);
    }
    return extractedIP;
  }
  
  // Priority 4: Direct connection IPs (fallback for direct connections)
  let ip = req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           'unknown';
  
  extractedIP = normalizeIP(ip);
  source = 'direct-connection';
  if (debug) {
    console.log(`🌐 [IP DEBUG] Source: ${source}, Raw: ${ip}, Extracted: ${extractedIP}`);
  }
  
  return extractedIP;
}

module.exports = {
  normalizeIP,
  getClientIP
};


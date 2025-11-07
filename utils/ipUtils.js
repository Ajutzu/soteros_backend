/**
 * Utility functions for IP address handling
 */

/**
 * Check if an IP address is IPv4 format
 * @param {string} ip - IP address to check
 * @returns {boolean} - True if IPv4, false otherwise
 */
function isIPv4(ip) {
  if (!ip || ip === 'unknown') return false;
  
  // IPv4 pattern: xxx.xxx.xxx.xxx (4 groups of 1-3 digits)
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Pattern.test(ip.trim());
}

/**
 * Normalize a single IP address
 * Converts ::ffff:192.168.1.1 to 192.168.1.1
 * Filters out pure IPv6 addresses (only returns IPv4)
 * @param {string} ip - Single IP address (can be IPv4, IPv6, or IPv6-mapped IPv4)
 * @returns {string} - Normalized IP address or 'unknown' if IPv6
 */
function normalizeSingleIP(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  
  // Handle IPv6-mapped IPv4 addresses (::ffff:xxx.xxx.xxx.xxx)
  if (ip.startsWith('::ffff:')) {
    const ipv4 = ip.substring(7); // Remove ::ffff: prefix
    return isIPv4(ipv4) ? ipv4 : 'unknown';
  }
  
  // Handle IPv6-mapped IPv4 in different format
  if (ip.includes('::ffff:')) {
    const ipv4 = ip.split('::ffff:')[1];
    return (ipv4 && isIPv4(ipv4)) ? ipv4 : 'unknown';
  }
  
  const trimmedIP = ip.trim();
  
  // Only return IPv4 addresses, filter out pure IPv6
  return isIPv4(trimmedIP) ? trimmedIP : 'unknown';
}

/**
 * Normalize IPv6-mapped IPv4 address to IPv4 format
 * Converts ::ffff:192.168.1.1 to 192.168.1.1
 * Handles comma-separated IPs: "49.149.137.139, 172.68.175.48, 10.17.212.210"
 * Filters out IPv6 addresses (only returns IPv4)
 * @param {string} ip - IP address (can be IPv4, IPv6, IPv6-mapped IPv4, or comma-separated list)
 * @returns {string} - Normalized IP address(es) - comma-separated if multiple, or 'unknown' if no IPv4 found
 */
function normalizeIP(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  
  // Handle comma-separated IPs (e.g., "49.149.137.139, 172.68.175.48, 10.17.212.210")
  if (ip.includes(',')) {
    const ips = ip.split(',').map(ip => normalizeSingleIP(ip.trim())).filter(ip => ip && ip !== 'unknown');
    return ips.length > 0 ? ips.join(', ') : 'unknown';
  }
  
  return normalizeSingleIP(ip);
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
  // Format: "client-ip, proxy1-ip, proxy2-ip" - we want the first IPv4 (original client)
  if (req.headers['x-forwarded-for']) {
    const forwardedIPs = req.headers['x-forwarded-for'].split(',').map(ip => ip.trim());
    // Try each IP until we find an IPv4 address
    for (const ip of forwardedIPs) {
      if (ip) {
        extractedIP = normalizeIP(ip);
        if (extractedIP !== 'unknown') {
          source = 'x-forwarded-for';
          if (debug) {
            const allIPs = normalizeIP(req.headers['x-forwarded-for']);
            console.log(`🌐 [IP DEBUG] Source: ${source}, Raw: ${req.headers['x-forwarded-for']}, All IPv4 IPs: ${allIPs}, Client IP: ${extractedIP}`);
          }
          return extractedIP;
        }
      }
    }
  }
  
  // Priority 2: x-real-ip header (alternative proxy header)
  if (req.headers['x-real-ip']) {
    extractedIP = normalizeIP(req.headers['x-real-ip']);
    if (extractedIP !== 'unknown') {
      source = 'x-real-ip';
      if (debug) {
        console.log(`🌐 [IP DEBUG] Source: ${source}, Raw: ${req.headers['x-real-ip']}, Extracted: ${extractedIP}`);
      }
      return extractedIP;
    }
  }
  
  // Priority 3: req.ip (Express's IP - works when trust proxy is enabled)
  if (req.ip) {
    extractedIP = normalizeIP(req.ip);
    if (extractedIP !== 'unknown') {
      source = 'req.ip';
      if (debug) {
        console.log(`🌐 [IP DEBUG] Source: ${source}, Raw: ${req.ip}, Extracted: ${extractedIP}`);
      }
      return extractedIP;
    }
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
  normalizeSingleIP,
  isIPv4,
  getClientIP
};


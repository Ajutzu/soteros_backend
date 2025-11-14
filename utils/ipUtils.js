/**
 * Utility functions for IP address handling and geolocation
 */

/**
 * Normalize IPv6-mapped IPv4 address to IPv4 format
 * Converts ::ffff:192.168.1.1 to 192.168.1.1
 * @param {string} ip - IP address (can be IPv4, IPv6, or IPv6-mapped IPv4)
 * @returns {string} - Normalized IP address
 */
function normalizeIP(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  
  // Skip localhost and private IP addresses for geolocation
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
    return 'unknown';
  }
  
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
 * Check if IP is a private/local IP address
 * @param {string} ip - IP address
 * @returns {boolean} - True if IP is private/local
 */
function isPrivateIP(ip) {
  if (!ip || ip === 'unknown') return true;
  
  // Localhost
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  
  // Private IPv4 ranges
  const privateRanges = [
    /^10\./,                    // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
    /^192\.168\./,              // 192.168.0.0/16
    /^169\.254\./,              // Link-local 169.254.0.0/16
  ];
  
  return privateRanges.some(range => range.test(ip));
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

/**
 * Get physical address (geolocation) from IP address
 * Uses ip-api.com free service (no API key required, 45 requests/minute limit)
 * Returns location information for tracking false reports and spam
 * 
 * @param {string} ip - IP address to geolocate
 * @returns {Promise<Object>} - Geolocation data with physical address
 * @example
 * {
 *   success: true,
 *   ip: '8.8.8.8',
 *   city: 'Mountain View',
 *   region: 'California',
 *   country: 'United States',
 *   countryCode: 'US',
 *   zip: '94043',
 *   lat: 37.386,
 *   lon: -122.0838,
 *   isp: 'Google LLC',
 *   physicalAddress: 'Mountain View, California, United States'
 * }
 */
async function getIPGeolocation(ip) {
  try {
    // Normalize IP first
    const normalizedIP = normalizeIP(ip);
    
    // Skip geolocation for private/local IPs
    if (isPrivateIP(normalizedIP) || normalizedIP === 'unknown') {
      return {
        success: false,
        ip: normalizedIP,
        physicalAddress: 'Local/Private IP',
        error: 'Cannot geolocate private or local IP addresses'
      };
    }
    
    // Use ip-api.com free service (no API key required)
    // Format: http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,query
    const url = `http://ip-api.com/json/${normalizedIP}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,query`;
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'PROTEQ-MDRRMO/1.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Geolocation API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check if API returned an error
    if (data.status === 'fail') {
      return {
        success: false,
        ip: normalizedIP,
        physicalAddress: 'Unknown',
        error: data.message || 'Geolocation failed'
      };
    }
    
    // Build physical address string
    const addressParts = [];
    if (data.city) addressParts.push(data.city);
    if (data.regionName) addressParts.push(data.regionName);
    if (data.country) addressParts.push(data.country);
    
    const physicalAddress = addressParts.length > 0 
      ? addressParts.join(', ')
      : data.country || 'Unknown Location';
    
    return {
      success: true,
      ip: data.query || normalizedIP,
      city: data.city || null,
      region: data.regionName || data.region || null,
      country: data.country || null,
      countryCode: data.countryCode || null,
      zip: data.zip || null,
      lat: data.lat || null,
      lon: data.lon || null,
      timezone: data.timezone || null,
      isp: data.isp || null,
      physicalAddress: physicalAddress
    };
    
  } catch (error) {
    console.error('Error getting IP geolocation:', error.message);
    return {
      success: false,
      ip: normalizeIP(ip),
      physicalAddress: 'Unknown',
      error: error.message || 'Geolocation request failed'
    };
  }
}

module.exports = {
  normalizeIP,
  getClientIP,
  getIPGeolocation,
  isPrivateIP
};


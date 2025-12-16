/**
 * Vercel API route handler for /message endpoint
 */
const handler = require('../src/httpServer.js');

module.exports = async function(req, res) {
  // Normalize the URL - Vercel may pass /api/message or /message
  const originalUrl = req.url;
  
  // Remove /api prefix if present and ensure it's /message
  let normalizedUrl = originalUrl;
  if (normalizedUrl && normalizedUrl.startsWith('/api/message')) {
    normalizedUrl = '/message';
  } else if (normalizedUrl && normalizedUrl.includes('message')) {
    // Extract just the message part, handling query strings
    const urlWithoutQuery = normalizedUrl.split('?')[0];
    if (urlWithoutQuery.endsWith('/message') || urlWithoutQuery.endsWith('message')) {
      normalizedUrl = '/message' + (normalizedUrl.includes('?') ? normalizedUrl.substring(normalizedUrl.indexOf('?')) : '');
    } else {
      normalizedUrl = '/message';
    }
  } else {
    normalizedUrl = '/message';
  }
  
  req.url = normalizedUrl;
  
  // Log for debugging
  console.log(`[VERCEL message.js] Original URL: ${originalUrl}, Normalized: ${normalizedUrl}`);
  
  try {
    return await handler(req, res);
  } finally {
    req.url = originalUrl; // Restore original URL
  }
};


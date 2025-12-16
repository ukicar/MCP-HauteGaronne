/**
 * Vercel API route handler for /message endpoint
 */
const handler = require('../src/httpServer.js');

module.exports = async function(req, res) {
  // Override the URL to /message for this specific route
  const originalUrl = req.url;
  req.url = '/message';
  try {
    return await handler(req, res);
  } finally {
    req.url = originalUrl; // Restore original URL
  }
};


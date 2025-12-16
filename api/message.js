/**
 * Vercel API route handler for /message endpoint
 */
const handler = require('../src/httpServer.js');

module.exports = async function(req, res) {
  // Set the URL to /message
  req.url = '/message';
  return handler(req, res);
};


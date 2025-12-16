/**
 * Vercel API route handler - main entry point
 */
const handler = require('../src/httpServer.js');

module.exports = async function(req, res) {
  // Set the URL to / for root API calls
  req.url = req.url || '/';
  return handler(req, res);
};


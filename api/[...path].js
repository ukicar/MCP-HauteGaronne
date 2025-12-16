/**
 * Vercel API route handler - catch-all route for MCP server
 * Vercel passes the path segments as req.query.path (array or string)
 */
const handler = require('../src/httpServer.js');

module.exports = async function(req, res) {
  // Reconstruct the URL path from Vercel's path parameter
  // The [...path] catch-all receives path segments as req.query.path
  const pathSegments = req.query.path;
  let url = '/';

  // If path segments exist, reconstruct the URL
  if (pathSegments) {
    if (Array.isArray(pathSegments)) {
      // Multiple path segments: ['message'] 
      // Remove 'api' if it's the first segment (from rewrite)
      const segments = pathSegments.filter(s => s !== 'api');
      url = '/' + segments.join('/');
    } else if (typeof pathSegments === 'string') {
      // Single path segment: 'message'
      url = '/' + pathSegments;
    }
  }

  // Also check req.url - Vercel might set it directly
  if (req.url) {
    const urlWithoutQuery = req.url.split('?')[0];
    // Remove /api prefix if present (from rewrite)
    if (urlWithoutQuery.startsWith('/api/')) {
      url = urlWithoutQuery.replace('/api', '');
    } else if (urlWithoutQuery !== '/api' && urlWithoutQuery !== '/api/') {
      url = urlWithoutQuery;
    }
  }

  // Ensure URL starts with /
  if (!url.startsWith('/')) {
    url = '/' + url;
  }

  // Set the URL on the request object
  req.url = url;

  // Log for debugging
  console.log(`[VERCEL] Reconstructed URL: ${url} from path segments:`, pathSegments, `req.url:`, req.url);

  // Call the original handler
  return handler(req, res);
};


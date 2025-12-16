/**
 * Vercel API route handler - catch-all route for MCP server
 * Vercel passes the path segments as req.query.path (array or string)
 */
const handler = require('../src/httpServer.js');

module.exports = async function vercelHandler(req, res) {
  // Reconstruct the URL path from Vercel's path parameter
  // The [...path] catch-all receives path segments as req.query.path
  const pathSegments = req.query.path;
  let url = '/';

  // If path segments exist, reconstruct the URL
  if (pathSegments) {
    if (Array.isArray(pathSegments)) {
      // Multiple path segments: ['message'] or ['api', 'message']
      url = '/' + pathSegments.join('/');
    } else if (typeof pathSegments === 'string') {
      // Single path segment: 'message'
      url = '/' + pathSegments;
    }
  } else {
    // No path segments means root path
    url = '/';
  }

  // Remove any query string that might be in the original req.url
  // Vercel sometimes includes ?path=... in req.url
  if (req.url) {
    const urlWithoutQuery = req.url.split('?')[0];
    // If req.url already has a path, use it (but clean it)
    if (urlWithoutQuery && urlWithoutQuery !== '/api' && urlWithoutQuery !== '/api/') {
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
  console.log(`[VERCEL] Reconstructed URL: ${url} from path segments:`, pathSegments);

  // Call the original handler
  return handler(req, res);
};


/**
 * Local development server for MCP over HTTP
 * Run with: node server.js
 */

const http = require('http');
const handler = require('./src/httpServer.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Handle the request
  try {
    await handler(req, res);
  } catch (error) {
    console.error('[SERVER] Unhandled error:', error);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`🚀 MCP Server running on http://localhost:${PORT}`);
  console.log(`📡 SSE endpoint: http://localhost:${PORT}/message`);
  console.log(`📨 POST endpoint: http://localhost:${PORT}/message`);
  console.log(`🏥 Health check: http://localhost:${PORT}/ping`);
  console.log('\nPress Ctrl+C to stop the server\n');
});

server.on('error', (error) => {
  console.error('[SERVER] Server error:', error);
  process.exit(1);
});


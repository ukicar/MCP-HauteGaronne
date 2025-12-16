/**
 * HTTP server for MCP over HTTP (Vercel deployment)
 */

// Dynamic imports for ES modules
let Server, SSEServerTransport;
let mcpServerModule = null;

async function loadMCPModules() {
  if (!Server) {
    const sdkServer = await import('@modelcontextprotocol/sdk/server/index.js');
    const sdkSSE = await import('@modelcontextprotocol/sdk/server/sse.js');
    Server = sdkServer.Server;
    SSEServerTransport = sdkSSE.SSEServerTransport;
  }
  if (!mcpServerModule) {
    mcpServerModule = require('./mcpServer.js');
  }
  return { Server, SSEServerTransport, mcpServerModule };
}

let serverInstance = null;

// Track active SSE transports by session ID
const activeTransports = new Map();

/**
 * Initialize server instance (singleton)
 */
async function getServer() {
  if (!serverInstance) {
    const { mcpServerModule } = await loadMCPModules();
    serverInstance = await mcpServerModule.createMCPServer();
  }
  return serverInstance;
}

/**
 * HTTP handler for Vercel and standalone server
 */
async function handler(req, res) {
  // Log all incoming requests
  console.log(`[HTTP] ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`);

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log('[HTTP] Handling OPTIONS preflight request');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(200);
    res.end();
    console.log('[HTTP] OPTIONS request completed');
    return;
  }

  try {
    // Load MCP modules
    const { SSEServerTransport, mcpServerModule } = await loadMCPModules();
    
    console.log('[HTTP] Getting MCP server instance...');
    const server = await getServer();
    console.log('[HTTP] MCP server instance ready');

    // Handle SSE connection (GET request)
    if (req.method === 'GET' && req.url === '/message') {
      console.log('[HTTP] Handling GET request for SSE connection');
      // Set CORS headers BEFORE creating transport
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      console.log('[HTTP] Creating SSEServerTransport...');
      const transport = new SSEServerTransport('/message', res);
      console.log('[HTTP] Connecting server to transport...');
      // Note: server.connect() automatically calls transport.start()
      await server.connect(transport);

      // Store transport by session ID for POST requests
      const sessionId = transport.sessionId;
      activeTransports.set(sessionId, transport);
      console.log(
        `[HTTP] Stored transport with sessionId: ${sessionId}, total active sessions: ${activeTransports.size}`
      );

      // Clean up when transport closes
      transport.onclose = () => {
        activeTransports.delete(sessionId);
        console.log(
          `[HTTP] Removed transport session: ${sessionId}, remaining sessions: ${activeTransports.size}`
        );
      };

      transport.onerror = (error) => {
        console.error(`[HTTP] Transport error for session ${sessionId}:`, error);
      };

      console.log(`[HTTP] MCP Server connected via HTTP/SSE (GET), session: ${sessionId}`);
      return;
    }

    // Handle POST messages
    if (req.method === 'POST' && req.url?.startsWith('/message')) {
      console.log('[HTTP] Handling POST request for message');
      console.log(`[HTTP] Full URL: ${req.url}`);
      console.log(`[HTTP] Content-Type: ${req.headers['content-type']}`);
      console.log(`[HTTP] Content-Length: ${req.headers['content-length']}`);

      // Extract session ID from query string OR try to get from first available transport
      const url = new URL(req.url || '/message', `http://${req.headers.host || 'localhost'}`);
      let sessionId = url.searchParams.get('sessionId');

      // If no sessionId in query, try to use the first (or only) active transport
      // This handles cases where the MCP bridge doesn't send sessionId in query string
      if (!sessionId && activeTransports.size === 1) {
        const firstSessionId = Array.from(activeTransports.keys())[0];
        if (firstSessionId) {
          sessionId = firstSessionId;
          console.log(`[HTTP] No sessionId in query, using single active session: ${sessionId}`);
        }
      } else if (!sessionId && activeTransports.size > 1) {
        console.warn(
          `[HTTP] Multiple active sessions but no sessionId provided: ${Array.from(activeTransports.keys()).join(', ')}`
        );
      }

      console.log(`[HTTP] SessionId: ${sessionId || 'none'}`);
      console.log(`[HTTP] Active sessions: ${Array.from(activeTransports.keys()).join(', ') || 'none'}`);

      // Handle stateless POST requests (no sessionId)
      // For stateless requests, we parse JSON-RPC manually and call server handlers directly
      // This avoids the SSE transport which requires connection/start()
      if (!sessionId) {
        console.log('[HTTP] No sessionId provided - handling as stateless POST request');

        try {
          // Read request body
          const bodyChunks = [];
          for await (const chunk of req) {
            bodyChunks.push(chunk);
          }
          const body = Buffer.concat(bodyChunks).toString('utf-8');

          console.log(`[HTTP] Request body: ${body.substring(0, 500)}`);

          // Parse JSON-RPC request
          let request;
          try {
            request = JSON.parse(body);
          } catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(400);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
              })
            );
            return;
          }

          // Validate JSON-RPC format
          if (request.jsonrpc !== '2.0' || !request.method) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(400);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id ?? null,
                error: { code: -32600, message: 'Invalid Request' },
              })
            );
            return;
          }

          console.log(`[HTTP] JSON-RPC method: ${request.method}, id: ${request.id}`);

          // Check if this is a notification (no id field)
          const isNotification = request.id === undefined || request.id === null;
          
          // Call the handler directly (bypassing transport)
          let response;
          try {
            const { mcpServerModule } = await loadMCPModules();
            response = await Promise.resolve(
              mcpServerModule.handleRequestDirectly(server, request.method, request.params)
            ).catch((error) => {
              // For notifications, ignore errors (they don't need responses anyway)
              if (isNotification) {
                console.log(`[HTTP] Ignoring error for notification ${request.method}:`, error.message);
                return null;
              }
              console.error(
                `[HTTP] Promise rejection in handleRequestDirectly:`,
                error instanceof Error ? error.message : String(error)
              );
              console.error(
                `[HTTP] Error stack:`,
                error instanceof Error ? error.stack : 'No stack trace'
              );
              throw error;
            });
          } catch (error) {
            // For notifications, ignore errors (they don't need responses)
            if (isNotification) {
              console.log(`[HTTP] Ignoring error for notification ${request.method}:`, error.message);
              if (!res.headersSent) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.writeHead(204); // No Content
                res.end();
              }
              return;
            }
            
            console.error(
              `[HTTP] Error in handleRequestDirectly:`,
              error instanceof Error ? error.message : String(error)
            );
            console.error(
              `[HTTP] Error stack:`,
              error instanceof Error ? error.stack : 'No stack trace'
            );

            // Send error response
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.writeHead(500);
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: request.id ?? null,
                  error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : String(error),
                  },
                })
              );
            }
            return;
          }

          // Notifications don't need a response
          if (response === null) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(204); // No Content
            res.end();
            console.log('[HTTP] Sent 204 No Content for notification');
            return;
          }

          // Format JSON-RPC response
          const jsonrpcResponse = {
            jsonrpc: '2.0',
            id: request.id ?? null,
            result: response,
          };

          // Send response
          try {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(200);
            res.end(JSON.stringify(jsonrpcResponse));
          } catch (error) {
            console.error(`[HTTP] Error sending response:`, error instanceof Error ? error.message : String(error));
            // Response already sent or connection closed
          }

          console.log('[HTTP] Successfully handled stateless POST request');
          return;
        } catch (error) {
          console.error(
            `[HTTP] Error handling stateless POST:`,
            error instanceof Error ? error.message : String(error)
          );
          console.error('[HTTP] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(500);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: -32603,
                  message: 'Internal error',
                  data: error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }
      }

      // Handle stateful POST requests (with sessionId)
      const transport = activeTransports.get(sessionId);
      if (!transport) {
        console.warn(`[HTTP] No transport found for sessionId: ${sessionId}`);
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.writeHead(404);
          res.end(
            JSON.stringify({
              error: 'SSE connection not found for session',
              sessionId,
              activeSessions: Array.from(activeTransports.keys()),
            })
          );
        }
        return;
      }

      console.log(`[HTTP] Found transport for sessionId: ${sessionId}, calling handlePostMessage...`);
      try {
        const handlePromise = transport.handlePostMessage(req, res);

        req.on('error', (error) => {
          console.error(`[HTTP] Request stream error:`, error);
        });

        await handlePromise;
        console.log(`[HTTP] Successfully handled POST message for session: ${sessionId}`);
        return;
      } catch (error) {
        console.error(
          `[HTTP] Error handling POST message for session ${sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
        console.error('[HTTP] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.writeHead(500);
          res.end(
            JSON.stringify({
              error: 'Internal server error',
              message: error instanceof Error ? error.message : String(error),
            })
          );
        }
        return;
      }
    }

    // Test endpoint for debugging
    if (req.method === 'GET' && req.url === '/ping') {
      console.log('[HTTP] Ping endpoint called');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          activeSessions: Array.from(activeTransports.keys()),
          sessionCount: activeTransports.size,
        })
      );
      return;
    }

    // Default response
    console.warn(`[HTTP] Unhandled request: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found', availableEndpoints: ['/message', '/ping'] }));
    }
  } catch (error) {
    console.error('[HTTP] Server error:', error instanceof Error ? error.message : String(error));
    console.error('[HTTP] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(500);
      res.end(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }));
    }
  }
}

module.exports = handler;


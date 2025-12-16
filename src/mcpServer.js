/**
 * MCP Server initialization and tool registration
 */

// Dynamic imports for ES modules
let Server, ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, 
    ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema;

async function loadSDKModules() {
  if (!Server) {
    const sdkServer = await import('@modelcontextprotocol/sdk/server/index.js');
    const sdkTypes = await import('@modelcontextprotocol/sdk/types.js');
    Server = sdkServer.Server;
    ListToolsRequestSchema = sdkTypes.ListToolsRequestSchema;
    CallToolRequestSchema = sdkTypes.CallToolRequestSchema;
    ListResourcesRequestSchema = sdkTypes.ListResourcesRequestSchema;
    ReadResourceRequestSchema = sdkTypes.ReadResourceRequestSchema;
    ListPromptsRequestSchema = sdkTypes.ListPromptsRequestSchema;
    GetPromptRequestSchema = sdkTypes.GetPromptRequestSchema;
  }
  return { Server, ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, 
           ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema };
}

const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'https://data.haute-garonne.fr/api/explore/v2.1';

// Cache for dataset catalog
let datasetCatalogCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper function to fetch dataset catalog
async function getDatasetCatalog() {
  const now = Date.now();
  if (datasetCatalogCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
    return datasetCatalogCache;
  }

  try {
    const response = await axios.get(`${API_BASE_URL}/catalog/datasets`, {
      params: { limit: 1000 },
    });
    datasetCatalogCache = response.data;
    cacheTimestamp = now;
    return datasetCatalogCache;
  } catch (error) {
    console.error('Error fetching dataset catalog:', error.message);
    throw new Error(`Failed to fetch dataset catalog: ${error.message}`);
  }
}

/**
 * Initialize and configure MCP server
 */
async function createMCPServer() {
  const { Server: ServerClass } = await loadSDKModules();
  const server = new ServerClass(
    {
      name: 'haute-garonne-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Load SDK modules
  const schemas = await loadSDKModules();
  
  // Register tools/list handler
  server.setRequestHandler(
    schemas.ListToolsRequestSchema,
    async () => {
      console.log('[TOOL] tools/list requested');
      return {
        tools: [
          {
            name: 'list_datasets',
            description: 'List all available datasets from the Haute Garonne Open Data API',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of datasets to return',
                  default: 100,
                },
                offset: {
                  type: 'number',
                  description: 'Offset for pagination',
                  default: 0,
                },
              },
            },
          },
          {
            name: 'query_dataset',
            description: 'Query records from a specific dataset with optional filters',
            inputSchema: {
              type: 'object',
              properties: {
                dataset_id: {
                  type: 'string',
                  description: 'The identifier of the dataset to query',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of records to return',
                  default: 100,
                },
                offset: {
                  type: 'number',
                  description: 'Offset for pagination',
                  default: 0,
                },
                where: {
                  type: 'string',
                  description: 'Filter expression (SQL-like WHERE clause)',
                },
                select: {
                  type: 'string',
                  description: 'Comma-separated list of fields to select',
                },
              },
              required: ['dataset_id'],
            },
          },
          {
            name: 'search_datasets',
            description: 'Search datasets by name or keywords',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query to find datasets by name or keywords',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 50,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_dataset_info',
            description: 'Get detailed metadata about a specific dataset',
            inputSchema: {
              type: 'object',
              properties: {
                dataset_id: {
                  type: 'string',
                  description: 'The identifier of the dataset',
                },
              },
              required: ['dataset_id'],
            },
          },
        ],
      };
    }
  );

  // Register tools/call handler
  server.setRequestHandler(
    schemas.CallToolRequestSchema,
    async (request) => {
      console.log(`[TOOL] Tool call requested: ${request.params.name}`);
      console.log(`[TOOL] Tool arguments: ${JSON.stringify(request.params.arguments, null, 2)}`);

      const toolName = request.params.name;
      const args = request.params.arguments || {};

      try {
        let result;
        switch (toolName) {
          case 'list_datasets': {
            const limit = args.limit || 100;
            const offset = args.offset || 0;
            const catalog = await getDatasetCatalog();
            const datasets = catalog.datasets || [];
            const paginated = datasets.slice(offset, offset + limit);

            result = {
              content: [
                {
                  type: 'text',
                  text: `Found ${datasets.length} total datasets. Showing ${paginated.length} datasets (offset: ${offset}):\n\n${JSON.stringify(paginated, null, 2)}`,
                },
              ],
            };
            break;
          }

          case 'query_dataset': {
            const { dataset_id, limit = 100, offset = 0, where, select } = args;
            if (!dataset_id) {
              throw new Error('dataset_id is required');
            }

            const requestParams = {
              limit,
              offset,
            };
            if (where) requestParams.where = where;
            if (select) requestParams.select = select;

            const response = await axios.get(
              `${API_BASE_URL}/catalog/datasets/${dataset_id}/records`,
              { params: requestParams }
            );

            const records = response.data.results || [];
            const totalCount = response.data.total_count || records.length;

            result = {
              content: [
                {
                  type: 'text',
                  text: `Found ${totalCount} records in dataset "${dataset_id}". Showing ${records.length} records:\n\n${JSON.stringify(records, null, 2)}`,
                },
              ],
            };
            break;
          }

          case 'search_datasets': {
            const { query, limit = 50 } = args;
            if (!query) {
              throw new Error('query is required');
            }

            const catalog = await getDatasetCatalog();
            const datasets = catalog.datasets || [];
            const searchLower = query.toLowerCase();
            const filtered = datasets
              .filter((ds) => {
                const name = (ds.metas?.default?.title || '').toLowerCase();
                const description = (ds.metas?.default?.description || '').toLowerCase();
                const keywords = (ds.metas?.default?.keyword || []).join(' ').toLowerCase();
                return (
                  name.includes(searchLower) ||
                  description.includes(searchLower) ||
                  keywords.includes(searchLower)
                );
              })
              .slice(0, limit);

            result = {
              content: [
                {
                  type: 'text',
                  text: `Found ${filtered.length} datasets matching "${query}":\n\n${JSON.stringify(filtered, null, 2)}`,
                },
              ],
            };
            break;
          }

          case 'get_dataset_info': {
            const { dataset_id } = args;
            if (!dataset_id) {
              throw new Error('dataset_id is required');
            }

            const response = await axios.get(
              `${API_BASE_URL}/catalog/datasets/${dataset_id}`
            );

            result = {
              content: [
                {
                  type: 'text',
                  text: `Dataset information for "${dataset_id}":\n\n${JSON.stringify(response.data, null, 2)}`,
                },
              ],
            };
            break;
          }

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }

        console.log(`[TOOL] Tool ${toolName} completed successfully`);
        return result;
      } catch (error) {
        console.error(`[TOOL] Error in tool ${toolName}:`, error.message);
        throw error;
      }
    }
  );

  // Register resources/list handler
  server.setRequestHandler(schemas.ListResourcesRequestSchema, async () => {
    try {
      const catalog = await getDatasetCatalog();
      const datasets = catalog.datasets || [];

      const resources = [
        {
          uri: 'haute-garonne://catalog',
          name: 'Dataset Catalog',
          description: 'Complete catalog of all available datasets',
          mimeType: 'application/json',
        },
        ...datasets.slice(0, 100).map((ds) => ({
          uri: `haute-garonne://dataset/${ds.datasetid}`,
          name: ds.metas?.default?.title || ds.datasetid,
          description: ds.metas?.default?.description || 'No description available',
          mimeType: 'application/json',
        })),
      ];

      return { resources };
    } catch (error) {
      console.error('Error listing resources:', error);
      return { resources: [] };
    }
  });

  // Register resources/read handler
  server.setRequestHandler(schemas.ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      if (uri === 'haute-garonne://catalog') {
        const catalog = await getDatasetCatalog();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(catalog, null, 2),
            },
          ],
        };
      }

      if (uri.startsWith('haute-garonne://dataset/')) {
        const datasetId = uri.replace('haute-garonne://dataset/', '');
        const response = await axios.get(
          `${API_BASE_URL}/catalog/datasets/${datasetId}`
        );
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource URI: ${uri}`);
    } catch (error) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Error reading resource: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Register prompts/list handler
  server.setRequestHandler(schemas.ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'find_cultural_sites',
          description: 'Find cultural sites and equipment in Haute Garonne',
          arguments: [
            {
              name: 'location',
              description: 'Optional location filter',
              required: false,
            },
          ],
        },
        {
          name: 'search_transportation_data',
          description: 'Search for transportation-related datasets',
          arguments: [
            {
              name: 'transport_type',
              description: 'Type of transportation (bus, train, bike, etc.)',
              required: false,
            },
          ],
        },
      ],
    };
  });

  // Register prompts/get handler
  server.setRequestHandler(schemas.GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'find_cultural_sites': {
          const location = args?.location || '';
          const catalog = await getDatasetCatalog();
          const datasets = catalog.datasets || [];
          const culturalDatasets = datasets.filter((ds) => {
            const title = (ds.metas?.default?.title || '').toLowerCase();
            const desc = (ds.metas?.default?.description || '').toLowerCase();
            return (
              title.includes('culturel') ||
              title.includes('culture') ||
              desc.includes('culturel') ||
              desc.includes('culture')
            );
          });

          const messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Find cultural sites${location ? ` in ${location}` : ''} in Haute Garonne.`,
              },
            },
          ];

          if (culturalDatasets.length > 0) {
            const datasetId = culturalDatasets[0].datasetid;
            messages.push({
              role: 'assistant',
              content: {
                type: 'text',
                text: `I found ${culturalDatasets.length} cultural-related datasets. Let me query the most relevant one: "${culturalDatasets[0].metas?.default?.title || datasetId}".`,
              },
            });
            messages.push({
              role: 'user',
              content: {
                type: 'tool-call',
                toolCallId: 'call-1',
                name: 'query_dataset',
                arguments: {
                  dataset_id: datasetId,
                  limit: 50,
                },
              },
            });
          }

          return { messages };
        }

        case 'search_transportation_data': {
          const transportType = args?.transport_type || '';
          const catalog = await getDatasetCatalog();
          const datasets = catalog.datasets || [];
          const transportDatasets = datasets.filter((ds) => {
            const title = (ds.metas?.default?.title || '').toLowerCase();
            const desc = (ds.metas?.default?.description || '').toLowerCase();
            const keywords = (ds.metas?.default?.keyword || []).join(' ').toLowerCase();
            const searchLower = transportType ? `transport ${transportType}`.toLowerCase() : 'transport';
            return (
              title.includes(searchLower) ||
              desc.includes(searchLower) ||
              keywords.includes(searchLower) ||
              title.includes('transport') ||
              desc.includes('transport')
            );
          });

          const messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Search for transportation data${transportType ? ` related to ${transportType}` : ''} in Haute Garonne.`,
              },
            },
          ];

          if (transportDatasets.length > 0) {
            messages.push({
              role: 'assistant',
              content: {
                type: 'text',
                text: `I found ${transportDatasets.length} transportation-related datasets. Here are the most relevant ones:\n\n${transportDatasets.slice(0, 5).map((ds, i) => `${i + 1}. ${ds.metas?.default?.title || ds.datasetid}`).join('\n')}`,
              },
            });
          }

          return { messages };
        }

        default:
          throw new Error(`Unknown prompt: ${name}`);
      }
    } catch (error) {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          },
        ],
      };
    }
  });

  // Handle errors
  server.onerror = (error) => {
    console.error('MCP Server error:', error);
  };

  console.log('MCP Server initialized');
  return server;
}

/**
 * Handle a JSON-RPC request directly (for stateless HTTP requests)
 */
async function handleRequestDirectly(server, method, params) {
  // Handle MCP protocol methods
  if (method === 'initialize') {
    const handler = server._requestHandlers?.get('initialize');
    if (handler) {
      const result = await handler(
        { method: 'initialize', params: params || {} },
        { signal: new AbortController().signal }
      );
      return result;
    }
    // Fallback: return basic initialize response
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: 'haute-garonne-mcp-server',
        version: '1.0.0',
      },
    };
  } else if (method === 'notifications/initialized') {
    // Notification - no response needed (return null)
    console.log('[MCP] Received initialized notification');
    return null;
  } else if (method === 'notifications/cancelled') {
    // Notification - no response needed (return null)
    console.log('[MCP] Received cancelled notification');
    return null;
  } else if (method.startsWith('notifications/')) {
    // Handle any other notifications gracefully
    console.log(`[MCP] Received notification: ${method}`);
    return null;
  } else if (method === 'tools/list') {
    const handler = server._requestHandlers?.get('tools/list');
    if (handler) {
      const abortController = new AbortController();
      const result = await handler(
        { method: 'tools/list', params: params || {} },
        { signal: abortController.signal }
      );
      return result;
    }
    throw new Error('tools/list handler not found');
  } else if (method === 'tools/call') {
    const handler = server._requestHandlers?.get('tools/call');
    if (handler) {
      const abortController = new AbortController();
      const result = await handler(
        { method: 'tools/call', params: params || {} },
        { signal: abortController.signal }
      );
      return result;
    }
    throw new Error('tools/call handler not found');
  } else if (method === 'resources/list') {
    const handler = server._requestHandlers?.get('resources/list');
    if (handler) {
      const abortController = new AbortController();
      const result = await handler(
        { method: 'resources/list', params: params || {} },
        { signal: abortController.signal }
      );
      return result;
    }
    throw new Error('resources/list handler not found');
  } else if (method === 'resources/read') {
    const handler = server._requestHandlers?.get('resources/read');
    if (handler) {
      const abortController = new AbortController();
      const result = await handler(
        { method: 'resources/read', params: params || {} },
        { signal: abortController.signal }
      );
      return result;
    }
    throw new Error('resources/read handler not found');
  } else if (method === 'prompts/list') {
    const handler = server._requestHandlers?.get('prompts/list');
    if (handler) {
      const abortController = new AbortController();
      const result = await handler(
        { method: 'prompts/list', params: params || {} },
        { signal: abortController.signal }
      );
      return result;
    }
    throw new Error('prompts/list handler not found');
  } else if (method === 'prompts/get') {
    const handler = server._requestHandlers?.get('prompts/get');
    if (handler) {
      const abortController = new AbortController();
      const result = await handler(
        { method: 'prompts/get', params: params || {} },
        { signal: abortController.signal }
      );
      return result;
    }
    throw new Error('prompts/get handler not found');
  } else {
    throw new Error(`Unknown method: ${method}`);
  }
}

module.exports = {
  createMCPServer,
  handleRequestDirectly,
};


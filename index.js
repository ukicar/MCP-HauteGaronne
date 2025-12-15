const express = require('express');
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'https://data.haute-garonne.fr/api/explore/v2.1';

// Create Express app
const app = express();
app.use(express.json());

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

// MCP Protocol Handlers

// Initialize handler
async function handleInitialize(params) {
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
}

// Tools: list handler
async function handleToolsList() {
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

// Tools: call handler
async function handleToolsCall(params) {
  const { name, arguments: args } = params;

  try {
    switch (name) {
      case 'list_datasets': {
        const limit = args?.limit || 100;
        const offset = args?.offset || 0;
        const catalog = await getDatasetCatalog();
        const datasets = catalog.datasets || [];
        const paginated = datasets.slice(offset, offset + limit);

        return {
          content: [
            {
              type: 'text',
              text: `Found ${datasets.length} total datasets. Showing ${paginated.length} datasets (offset: ${offset}):\n\n${JSON.stringify(paginated, null, 2)}`,
            },
          ],
        };
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

        return {
          content: [
            {
              type: 'text',
              text: `Found ${totalCount} records in dataset "${dataset_id}". Showing ${records.length} records:\n\n${JSON.stringify(records, null, 2)}`,
            },
          ],
        };
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

        return {
          content: [
            {
              type: 'text',
              text: `Found ${filtered.length} datasets matching "${query}":\n\n${JSON.stringify(filtered, null, 2)}`,
            },
          ],
        };
      }

      case 'get_dataset_info': {
        const { dataset_id } = args;
        if (!dataset_id) {
          throw new Error('dataset_id is required');
        }

        const response = await axios.get(
          `${API_BASE_URL}/catalog/datasets/${dataset_id}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Dataset information for "${dataset_id}":\n\n${JSON.stringify(response.data, null, 2)}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

// Resources: list handler
async function handleResourcesList() {
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
}

// Resources: read handler
async function handleResourcesRead(params) {
  const { uri } = params;

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
}

// Prompts: list handler
async function handlePromptsList() {
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
}

// Prompts: get handler
async function handlePromptsGet(params) {
  const { name, arguments: args } = params;

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

        return {
          messages,
        };
      }

      case 'search_transportation_data': {
        const transportType = args?.transport_type || '';
        const searchQuery = transportType
          ? `transport ${transportType}`
          : 'transport';
        const catalog = await getDatasetCatalog();
        const datasets = catalog.datasets || [];
        const transportDatasets = datasets.filter((ds) => {
          const title = (ds.metas?.default?.title || '').toLowerCase();
          const desc = (ds.metas?.default?.description || '').toLowerCase();
          const keywords = (ds.metas?.default?.keyword || []).join(' ').toLowerCase();
          const searchLower = searchQuery.toLowerCase();
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

        return {
          messages,
        };
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
}

// HTTP endpoint handler for MCP requests (JSON-RPC format)
async function handleMcpRequest(req, res) {
  try {
    const { method, params, id } = req.body;

    if (!method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      });
      return;
    }

    let result;
    switch (method) {
      case 'initialize':
        result = await handleInitialize(params || {});
        break;
      case 'tools/list':
        result = await handleToolsList();
        break;
      case 'tools/call':
        result = await handleToolsCall(params || {});
        break;
      case 'resources/list':
        result = await handleResourcesList();
        break;
      case 'resources/read':
        result = await handleResourcesRead(params || {});
        break;
      case 'prompts/list':
        result = await handlePromptsList();
        break;
      case 'prompts/get':
        result = await handlePromptsGet(params || {});
        break;
      default:
        res.status(400).json({
          jsonrpc: '2.0',
          id: id || null,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
        return;
    }

    res.json({
      jsonrpc: '2.0',
      id: id || null,
      result,
    });
  } catch (error) {
    console.error('MCP request error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: error.message || 'Internal error',
      },
    });
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'haute-garonne-mcp-server' });
});

// MCP endpoint
app.post('/mcp', handleMcpRequest);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Haute Garonne MCP Server',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      mcp: '/mcp',
    },
    documentation: 'https://github.com/modelcontextprotocol/specification',
  });
});

// Start server
const port = process.env.PORT || 3000;

// For Vercel, export the app
if (process.env.VERCEL) {
  module.exports = app;
} else {
  // For local development
  const server = app.listen(port, () => {
    console.log(`Haute Garonne MCP Server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Please either:`);
      console.error(`   1. Stop the process using port ${port}`);
      console.error(`   2. Use a different port: PORT=3001 npm start\n`);
      process.exit(1);
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });
}

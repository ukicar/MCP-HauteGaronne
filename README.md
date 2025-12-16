# Haute Garonne MCP Server

A Model Context Protocol (MCP) server that provides access to the Haute Garonne Open Data API. This server can be deployed directly on Vercel and provides tools, resources, and prompts for querying the Haute Garonne open data portal.

## Features

- **Tools**: Query datasets, search, and retrieve information
- **Resources**: Access dataset catalog and individual datasets
- **Prompts**: Pre-built queries for common use cases (cultural sites, transportation data)

## Installation

```bash
npm install
```

## Local Development

```bash
npm start
```

The server will start on `http://localhost:3000`

## Deployment on Vercel

1. Install Vercel CLI (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

3. Follow the prompts to link your project and deploy.

The server will be automatically configured for Vercel deployment via `vercel.json`.

## API Endpoints

- `GET /` - Server information
- `GET /health` - Health check endpoint
- `POST /mcp` - MCP protocol endpoint (JSON-RPC over HTTP)
- `GET /sse` - MCP protocol endpoint (Server-Sent Events) - for LM Studio and other SSE clients
- `POST /sse` - Send messages to SSE endpoint

## MCP Tools

### `list_datasets`
List all available datasets from the Haute Garonne Open Data API.

**Parameters:**
- `limit` (number, optional): Maximum number of datasets to return (default: 100)
- `offset` (number, optional): Offset for pagination (default: 0)

### `query_dataset`
Query records from a specific dataset with optional filters.

**Parameters:**
- `dataset_id` (string, required): The identifier of the dataset to query
- `limit` (number, optional): Maximum number of records to return (default: 100)
- `offset` (number, optional): Offset for pagination (default: 0)
- `where` (string, optional): Filter expression (SQL-like WHERE clause)
- `select` (string, optional): Comma-separated list of fields to select

### `search_datasets`
Search datasets by name or keywords.

**Parameters:**
- `query` (string, required): Search query to find datasets by name or keywords
- `limit` (number, optional): Maximum number of results to return (default: 50)

### `get_dataset_info`
Get detailed metadata about a specific dataset.

**Parameters:**
- `dataset_id` (string, required): The identifier of the dataset

## MCP Resources

- `haute-garonne://catalog` - Complete catalog of all available datasets
- `haute-garonne://dataset/{dataset_id}` - Individual dataset information

## MCP Prompts

### `find_cultural_sites`
Find cultural sites and equipment in Haute Garonne.

**Arguments:**
- `location` (string, optional): Optional location filter

### `search_transportation_data`
Search for transportation-related datasets.

**Arguments:**
- `transport_type` (string, optional): Type of transportation (bus, train, bike, etc.)

## Environment Variables

- `API_BASE_URL` (optional): Base URL for the Haute Garonne API (defaults to `https://data.haute-garonne.fr/api/explore/v2.1`)
- `PORT` (optional): Port for local development (defaults to 3000)

## API Reference

The server integrates with the Haute Garonne Open Data API:
- Documentation: https://data.haute-garonne.fr/api/explore/v2.1/console

## License

MIT


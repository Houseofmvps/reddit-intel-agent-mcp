/**
 * Reddit Intelligence Agent — REST API layer
 *
 * Provides a /api/* REST interface alongside the MCP /mcp endpoint.
 * This enables integration with ChatGPT Actions, Gemini Extensions,
 * and any HTTP client that doesn't speak MCP.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { ToolRegistry } from '../tools/registry.js';
import type { ProductTier } from '../types/index.js';
import { PROMPT_PACKS } from '../prompts/index.js';

const MAX_BODY = 2 * 1024 * 1024; // 2MB

export function handleRestRequest(
  req: IncomingMessage,
  res: ServerResponse,
  registry: ToolRegistry,
  tier: ProductTier,
): boolean {
  const url = req.url ?? '';

  if (!url.startsWith('/api/')) return false;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return true;
  }

  // GET /api/tools — list available tools
  if (url === '/api/tools' && req.method === 'GET') {
    const tools = registry.listTools().map(t => ({
      name: t.name,
      description: t.description,
    }));
    jsonResponse(res, 200, { tools });
    return true;
  }

  // GET /api/prompts — list prompt packs
  if (url === '/api/prompts' && req.method === 'GET') {
    jsonResponse(res, 200, { prompts: PROMPT_PACKS });
    return true;
  }

  // POST /api/tools/:name — call a tool
  const toolMatch = url.match(/^\/api\/tools\/([a-z_]+)$/);
  if (toolMatch && req.method === 'POST') {
    const toolName = toolMatch[1];
    readBody(req, (err, body) => {
      if (err) {
        jsonResponse(res, 400, { error: err });
        return;
      }
      registry.callTool(toolName, body, tier).then(result => {
        jsonResponse(res, result.isError ? 400 : 200, result.isError ? { error: result.result } : JSON.parse(result.result));
      }).catch(e => {
        jsonResponse(res, 500, { error: e instanceof Error ? e.message : String(e) });
      });
    });
    return true;
  }

  // GET /api/openapi.json — OpenAPI spec for ChatGPT Actions
  if (url === '/api/openapi.json' && req.method === 'GET') {
    const tools = registry.listTools();
    const spec = generateOpenAPISpec(tools);
    jsonResponse(res, 200, spec);
    return true;
  }

  // 404 for unknown /api/* routes
  jsonResponse(res, 404, { error: 'Not found' });
  return true;
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, cb: (err: string | null, body: unknown) => void): void {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > MAX_BODY) {
      cb('Request body too large (max 2MB)', null);
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      cb(null, raw ? JSON.parse(raw) : {});
    } catch {
      cb('Invalid JSON', null);
    }
  });
  req.on('error', () => cb('Request error', null));
}

function generateOpenAPISpec(tools: Array<{ name: string; description?: string; inputSchema: unknown }>) {
  const paths: Record<string, unknown> = {};

  for (const tool of tools) {
    paths[`/api/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: tool.inputSchema,
            },
          },
        },
        responses: {
          '200': { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } },
          '400': { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Reddit Intelligence Agent',
      version: '0.1.0',
      description: 'Reddit Opportunity Intelligence — scored startup ideas, market signals, and buyer intent from Reddit.',
    },
    servers: [{ url: 'http://localhost:3000' }],
    paths,
  };
}

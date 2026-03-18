/**
 * Reddit Intelligence Agent — MCP + HTTP Server
 *
 * Dual-protocol: MCP (stdio or StreamableHTTP) + REST API
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';

import { RedditAuth } from './core/auth.js';
import { IntelCache } from './core/cache.js';
import { RateLimiter } from './core/rate-limiter.js';
import { resolveCurrentTier } from './core/tiers.js';
import { RedditClient } from './reddit/client.js';
import { RetrievalTools } from './tools/retrieval.js';
import { IntelligenceTools } from './tools/intelligence.js';
import { ExportTools } from './tools/export.js';
import { ToolRegistry } from './tools/registry.js';
import { handleRestRequest } from './api/rest.js';
// Prompt packs available for future MCP prompt support
// import { PROMPT_PACKS } from './prompts/index.js';

export const SERVER_NAME = 'reddit-intelligence-agent';
export const SERVER_VERSION = '0.1.0';

// ─── Response validation ────────────────────────────────────────

const ContentBlockSchema = z.object({
  type: z.enum(['text', 'image']),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
}).refine(
  obj => obj.type === 'text' ? !!obj.text : (!!obj.data && !!obj.mimeType),
  'text type requires text field; image type requires data + mimeType',
);

const ToolResultSchema = z.object({
  content: z.array(ContentBlockSchema).min(1),
  isError: z.boolean().optional(),
}).strict();

type ToolResult = z.infer<typeof ToolResultSchema>;

function makeResponse(text: string, isError = false): ToolResult {
  const resp = { content: [{ type: 'text' as const, text }], ...(isError && { isError }) };
  try { return ToolResultSchema.parse(resp); } catch {
    return { content: [{ type: 'text', text: 'Internal error: invalid response format' }], isError: true };
  }
}

// ─── Server factory ─────────────────────────────────────────────

export async function createIntelServer() {
  const auth = new RedditAuth();
  await auth.initialize();

  const tier = resolveCurrentTier();
  const rateLimit = auth.getRateLimit();
  const cacheTTL = auth.getCacheTTL();
  const disableCache = ['true', '1', 'yes', 'on'].includes(
    (process.env.REDDIT_INTEL_NO_CACHE ?? '').toLowerCase().trim(),
  );

  console.error(`\x1b[36m[reddit-intel]\x1b[0m v${SERVER_VERSION}`);
  console.error(`\x1b[36m[reddit-intel]\x1b[0m Auth: ${auth.getMode()} | Rate: ${rateLimit}/min | Tier: ${tier} | Cache: ${disableCache ? 'off' : `${cacheTTL / 60_000}min`}`);

  const cache = new IntelCache({
    defaultTTL: disableCache ? 0 : cacheTTL,
    maxSizeBytes: disableCache ? 0 : 50 * 1024 * 1024,
  });

  const limiter = new RateLimiter({ limit: rateLimit, windowMs: 60_000, label: 'Reddit API' });
  const reddit = new RedditClient({ auth, rateLimiter: limiter, cache });
  const retrieval = new RetrievalTools(reddit);
  const intel = new IntelligenceTools(reddit, tier);
  const exporter = new ExportTools();
  const registry = new ToolRegistry(retrieval, intel, exporter);

  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: `Reddit Opportunity Intelligence — scored startup ideas, market signals, and buyer intent from Reddit.

TOOLS OVERVIEW:
• Retrieval: browse_subreddit, search_reddit, post_details, user_profile
• Intelligence: find_pain_points, detect_workarounds, score_opportunity, monitor_competitors, extract_feature_gaps, track_pricing_objections, find_buyer_intent, build_icp
• Export: export_evidence_pack

Current tier: ${tier} | Rate: ${rateLimit}/min`,
    },
    { capabilities: { tools: {}, prompts: {} } },
  );

  // ─── MCP handlers ───────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const { result, isError } = await registry.callTool(name, args, tier);
    return makeResponse(result, isError);
  });

  return { server, cache, registry, tier };
}

// ─── Stdio transport ────────────────────────────────────────────

export async function startStdio() {
  const { server, cache } = await createIntelServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`\x1b[32m[reddit-intel]\x1b[0m Running (stdio mode)`);

  let exiting = false;
  const cleanup = () => { if (exiting) return; exiting = true; cache.destroy(); process.exit(0); };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// ─── HTTP transport (MCP + REST dual-protocol) ──────────────────

export async function startHttp(port: number) {
  const { server, cache, registry, tier } = await createIntelServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
  });
  await server.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Session-Id, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // ─── REST API routes (/api/*) ─────────────────────────────
    if (handleRestRequest(req, res, registry, tier)) return;

    // ─── Health check ─────────────────────────────────────────
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: SERVER_NAME,
        version: SERVER_VERSION,
        tier,
        protocol: ['mcp', 'rest'],
      }));
      return;
    }

    // ─── Root ─────────────────────────────────────────────────
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Reddit Intelligence Agent v${SERVER_VERSION}\nMCP: POST /mcp\nREST: /api/tools\nHealth: /health\n`);
      return;
    }

    // ─── MCP endpoint ─────────────────────────────────────────
    if (req.url === '/mcp') {
      if (req.method === 'POST') {
        let body = '';
        const bodyTimer = setTimeout(() => {
          res.writeHead(408, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Request timeout' }, id: null }));
          req.destroy();
        }, 30_000);

        req.on('data', chunk => {
          body += chunk;
          if (body.length > 10 * 1024 * 1024) {
            clearTimeout(bodyTimer);
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Payload too large' }, id: null }));
            req.destroy();
          }
        });

        req.on('end', async () => {
          clearTimeout(bodyTimer);
          try {
            const parsed = JSON.parse(body);
            await transport.handleRequest(req, res, parsed);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
          }
        });

        req.on('error', () => clearTimeout(bodyTimer));
      } else {
        await transport.handleRequest(req, res);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  });

  let exiting = false;
  const cleanup = () => {
    if (exiting) return;
    exiting = true;
    httpServer.close(() => { cache.destroy(); process.exit(0); });
    setTimeout(() => { cache.destroy(); process.exit(1); }, 10_000);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Try: REDDIT_INTEL_PORT=${port + 1}`);
    } else if (err.code === 'EACCES') {
      console.error(`Permission denied for port ${port}. Try a port > 1024.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  httpServer.listen(port, () => {
    console.error(`\x1b[32m[reddit-intel]\x1b[0m Running (HTTP mode)`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m MCP:  http://localhost:${port}/mcp`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m REST: http://localhost:${port}/api/tools`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m Spec: http://localhost:${port}/api/openapi.json`);
  });
}

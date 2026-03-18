/**
 * Reddit Intelligence Agent — MCP + HTTP Server
 *
 * Dual-protocol: MCP (stdio or StreamableHTTP) + REST API
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
export const SERVER_VERSION = '1.4.0';

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

  // ─── HTTP security ─────────────────────────────────────────
  const apiKey = process.env.REDDIT_INTEL_API_KEY?.trim() || null;
  const IP_RATE_LIMIT = 120; // requests per window
  const IP_RATE_WINDOW_MS = 60_000; // 1 minute
  const ipRateMap = new Map<string, { count: number; windowStart: number }>();

  // Cleanup stale IP entries every 5 minutes
  const ipCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - IP_RATE_WINDOW_MS;
    for (const [ip, entry] of ipRateMap) {
      if (entry.windowStart < cutoff) ipRateMap.delete(ip);
    }
  }, 5 * 60_000);
  ipCleanupInterval.unref();

  if (apiKey) {
    console.error(`\x1b[33m[reddit-intel]\x1b[0m API key auth enabled (set via REDDIT_INTEL_API_KEY)`);
  }

  // ─── Streamable HTTP transport (modern MCP) ────────────────
  const streamableTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
  });
  await server.connect(streamableTransport);

  // ─── SSE transport sessions (legacy MCP clients) ───────────
  const sseSessions = new Map<string, SSEServerTransport>();

  // Helper: create a new MCP server instance for SSE sessions
  async function createSSESession() {
    const sseServer = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {}, prompts: {} } },
    );
    sseServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listTools() }));
    sseServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const { result, isError } = await registry.callTool(name, args, tier);
      return makeResponse(result, isError);
    });
    return sseServer;
  }

  // ─── Base URL for manifests ─────────────────────────────────
  const rawBaseUrl = process.env.REDDIT_INTEL_BASE_URL?.trim();
  const baseUrl = rawBaseUrl && rawBaseUrl.length > 0 ? rawBaseUrl.replace(/\/+$/, '') : `http://localhost:${port}`;
  console.error(`\x1b[36m[reddit-intel]\x1b[0m Base URL: ${baseUrl} (env: ${process.env.REDDIT_INTEL_BASE_URL ?? 'not set'})`);

  // ─── OpenAI plugin manifest ────────────────────────────────
  const aiPluginManifest = {
    schema_version: 'v1',
    name_for_human: 'BuildRadar — Reddit Intelligence',
    name_for_model: 'buildradar_reddit_intelligence',
    description_for_human: 'Get scored startup ideas, market signals, and buyer intent from Reddit.',
    description_for_model: 'Search and analyze Reddit for startup opportunities, pain points, competitor intelligence, buyer intent signals, and market gaps. Returns scored, structured data with source URLs.',
    auth: { type: 'none' },
    api: {
      type: 'openapi',
      url: `${baseUrl}/api/openapi.json`,
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: 'support@buildradar.xyz',
    legal_info_url: 'https://github.com/Houseofmvps/reddit-intel-agent-mcp/blob/main/LICENSE',
  };

  // ─── Smithery manifest ────────────────────────────────────
  const smitheryManifest = {
    name: 'reddit-intel-agent-mcp',
    display_name: 'Reddit Intelligence Agent',
    description: 'Reddit Opportunity Intelligence — scored startup ideas, market signals, and buyer intent from Reddit.',
    icon: 'https://raw.githubusercontent.com/Houseofmvps/reddit-intel-agent-mcp/main/logo.png',
    publisher: 'houseofmvps',
    homepage: 'https://buildradar.xyz',
    license: 'MIT',
    runtime: 'node',
    transport: ['stdio', 'streamable-http', 'sse'],
    tools: registry.listTools().map(t => ({
      name: t.name,
      description: t.description,
    })),
  };

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // ─── CORS (all routes) ──────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Session-Id, Authorization, Cache-Control');
    res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url = (req.url ?? '').split('?')[0];

    // ─── Per-IP rate limiting (HTTP) ────────────────────────
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const ipEntry = ipRateMap.get(clientIp);
    if (ipEntry && now - ipEntry.windowStart < IP_RATE_WINDOW_MS) {
      ipEntry.count++;
      if (ipEntry.count > IP_RATE_LIMIT) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Too many requests. Max 120 requests per minute.' }));
        return;
      }
    } else {
      ipRateMap.set(clientIp, { count: 1, windowStart: now });
    }

    // ─── Security headers ─────────────────────────────────
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // ─── API key auth (if REDDIT_INTEL_API_KEY is set) ──────
    const apiKeyRequired = !!apiKey;
    const publicPaths = ['/health', '/', '/.well-known/ai-plugin.json', '/.well-known/smithery.json', '/.well-known/mcp.json', '/api/openapi.json'];
    const isPublicPath = publicPaths.includes(url);

    if (apiKeyRequired && !isPublicPath) {
      // Only accept API key via Authorization header — never query params (prevents log exposure)
      const authHeader = req.headers['authorization'] ?? '';
      const providedKey = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!providedKey || providedKey !== apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized. Provide API key via Authorization: Bearer <key> header.' }));
        return;
      }
    }

    // ─── REST API routes (/api/*) ───────────────────────────
    if (handleRestRequest(req, res, registry, tier)) return;

    // ─── Health check ───────────────────────────────────────
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: SERVER_NAME,
        version: SERVER_VERSION,
        tier,
        baseUrl,
        protocol: ['mcp-stdio', 'mcp-streamable-http', 'mcp-sse', 'rest'],
        endpoints: {
          mcp_streamable: `${baseUrl}/mcp`,
          mcp_sse: `${baseUrl}/sse`,
          mcp_sse_messages: `${baseUrl}/messages`,
          rest_tools: `${baseUrl}/api/tools`,
          rest_prompts: `${baseUrl}/api/prompts`,
          openapi_spec: `${baseUrl}/api/openapi.json`,
          openai_plugin: `${baseUrl}/.well-known/ai-plugin.json`,
          mcp_discovery: `${baseUrl}/.well-known/mcp.json`,
        },
      }));
      return;
    }

    // ─── OpenAI Plugin Manifest ─────────────────────────────
    if (url === '/.well-known/ai-plugin.json' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(aiPluginManifest, null, 2));
      return;
    }

    // ─── Smithery Manifest ──────────────────────────────────
    if (url === '/.well-known/smithery.json' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(smitheryManifest, null, 2));
      return;
    }

    // ─── MCP Server Metadata (for auto-discovery) ───────────
    if (url === '/.well-known/mcp.json' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        description: 'Reddit Opportunity Intelligence — scored startup ideas, market signals, and buyer intent.',
        transports: {
          'streamable-http': { url: '/mcp' },
          'sse': { url: '/sse', messages_url: '/messages' },
        },
        tools_count: registry.listTools().length,
        documentation: 'https://github.com/Houseofmvps/reddit-intel-agent-mcp',
      }));
      return;
    }

    // ─── Root ───────────────────────────────────────────────
    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'Reddit Intelligence Agent',
        version: SERVER_VERSION,
        description: 'Reddit Opportunity Intelligence — MCP + REST dual-protocol server.',
        endpoints: {
          mcp_streamable_http: 'POST /mcp',
          mcp_sse: 'GET /sse (stream) + POST /messages (send)',
          rest_api: '/api/tools, /api/tools/:name, /api/prompts',
          openapi_spec: '/api/openapi.json',
          openai_plugin: '/.well-known/ai-plugin.json',
          smithery: '/.well-known/smithery.json',
          mcp_discovery: '/.well-known/mcp.json',
          health: '/health',
        },
        integration: {
          claude_desktop: 'npx reddit-intel-agent-mcp',
          claude_code: 'claude mcp add --transport stdio reddit-intel -s user -- npx -y reddit-intel-agent-mcp',
          chatgpt: 'Import /.well-known/ai-plugin.json as Custom GPT Action',
          gemini: 'Use /api/tools/* REST endpoints',
          cursor: 'Add MCP server in settings → MCP',
          windsurf: 'Add MCP server in settings',
          smithery: 'npx -y @smithery/cli install reddit-intel-agent-mcp',
          any_mcp_client: 'POST /mcp (StreamableHTTP) or GET /sse + POST /messages (SSE)',
          any_http_client: 'POST /api/tools/:name with JSON body',
        },
      }));
      return;
    }

    // ─── MCP Streamable HTTP endpoint ───────────────────────
    if (url === '/mcp') {
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
            await streamableTransport.handleRequest(req, res, parsed);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
          }
        });

        req.on('error', () => clearTimeout(bodyTimer));
      } else {
        await streamableTransport.handleRequest(req, res);
      }
      return;
    }

    // ─── MCP SSE endpoint (legacy transport) ────────────────
    // GET /sse — establish SSE stream (for Cursor, Cline, older MCP clients)
    if (url === '/sse' && req.method === 'GET') {
      const sseTransport = new SSEServerTransport('/messages', res);
      const sessionId = sseTransport.sessionId;
      sseSessions.set(sessionId, sseTransport);

      const sseServer = await createSSESession();
      await sseServer.connect(sseTransport);

      sseTransport.onclose = () => {
        sseSessions.delete(sessionId);
      };
      await sseTransport.start();
      return;
    }

    // POST /messages?sessionId=xxx — send message to SSE session
    if (url === '/messages' && req.method === 'POST') {
      const fullUrl = req.url ?? '';
      const queryStr = fullUrl.includes('?') ? fullUrl.split('?')[1] : '';
      const params = new URLSearchParams(queryStr);
      const sessionId = params.get('sessionId');

      if (!sessionId || !sseSessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
        return;
      }

      const sseTransport = sseSessions.get(sessionId)!;
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
        }
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          await sseTransport.handlePostMessage(req, res, parsed);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  });

  let exiting = false;
  const cleanup = () => {
    if (exiting) return;
    exiting = true;
    // Close all SSE sessions
    for (const [, transport] of sseSessions) {
      transport.close().catch(() => {});
    }
    sseSessions.clear();
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
    console.error(`\x1b[32m[reddit-intel]\x1b[0m MCP Streamable: http://localhost:${port}/mcp`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m MCP SSE:        http://localhost:${port}/sse`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m REST API:       http://localhost:${port}/api/tools`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m OpenAPI Spec:   http://localhost:${port}/api/openapi.json`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m OpenAI Plugin:  http://localhost:${port}/.well-known/ai-plugin.json`);
    console.error(`\x1b[32m[reddit-intel]\x1b[0m MCP Discovery:  http://localhost:${port}/.well-known/mcp.json`);
  });
}

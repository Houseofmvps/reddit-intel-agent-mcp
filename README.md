# Reddit Intelligence Agent MCP

Turn Reddit into scored startup ideas, market signals, and buyer intent — right inside your AI assistant.

**All 14 tools are FREE.** Works with Claude, ChatGPT, Gemini, Cursor, Windsurf, and any MCP client.

## Quick Start (2 minutes)

### Claude Desktop

1. Open Claude Desktop
2. Go to **Settings** (gear icon) > **Developer** > **Edit Config**
3. Paste this into the file:

```json
{
  "mcpServers": {
    "reddit-intel": {
      "command": "npx",
      "args": ["-y", "reddit-intel-agent-mcp"]
    }
  }
}
```

4. Restart Claude Desktop
5. You'll see "reddit-intel" in the tools menu. Try asking: *"Search Reddit for pain points about project management tools"*

### Claude Code

Run this one command in your terminal:

```bash
claude mcp add --transport stdio reddit-intel -s user -- npx -y reddit-intel-agent-mcp
```

Done. Now ask Claude Code: *"Find buyer intent for CRM tools on Reddit"*

### Cursor

1. Open Cursor
2. Go to **Settings** > **MCP**
3. Click **Add MCP Server**
4. Name: `reddit-intel`
5. Command: `npx -y reddit-intel-agent-mcp`
6. Restart Cursor

### Windsurf

1. Open Windsurf
2. Go to **Settings** > **MCP Servers**
3. Add server with command: `npx -y reddit-intel-agent-mcp`

### ChatGPT (Custom GPT)

1. Go to [chat.openai.com](https://chat.openai.com) > **Explore GPTs** > **Create**
2. Click **Configure** > **Actions** > **Import from URL**
3. Enter: `https://api.buildradar.xyz/.well-known/ai-plugin.json`
4. Save and use your custom GPT

Or self-host: `npx reddit-intel-agent-mcp --http` and use `http://localhost:3000/.well-known/ai-plugin.json`

### Gemini

Use the hosted REST endpoints:
```bash
# List all tools
curl https://api.buildradar.xyz/api/tools

# Call a tool
curl -X POST https://api.buildradar.xyz/api/tools/search_reddit \
  -H "Content-Type: application/json" \
  -d '{"query": "best CRM for startups", "subreddits": ["startups", "SaaS"]}'
```

Or self-host: `npx reddit-intel-agent-mcp --http` and use `http://localhost:3000/api/tools`

### Any MCP Client

```bash
# Option 1: stdio (most common)
npx reddit-intel-agent-mcp

# Option 2: Hosted StreamableHTTP
# Connect to: https://api.buildradar.xyz/mcp

# Option 3: Hosted SSE (legacy)
# SSE stream: GET https://api.buildradar.xyz/sse
# Send messages: POST https://api.buildradar.xyz/messages?sessionId=xxx

# Option 4: Self-host
npx reddit-intel-agent-mcp --http
# StreamableHTTP: http://localhost:3000/mcp
# SSE: http://localhost:3000/sse
```

### Any HTTP Client (Perplexity, Grok, custom apps)

```bash
# Use the hosted API
curl -X POST https://api.buildradar.xyz/api/tools/find_pain_points \
  -H "Content-Type: application/json" \
  -d '{"query": "email marketing", "subreddits": ["startups", "Entrepreneur"]}'

# Or self-host
npx reddit-intel-agent-mcp --http
curl -X POST http://localhost:3000/api/tools/find_pain_points \
  -H "Content-Type: application/json" \
  -d '{"query": "email marketing", "subreddits": ["startups", "Entrepreneur"]}'
```

## What You Can Do

### Ask your AI assistant things like:

**Idea Validation**
- *"Score the opportunity for an AI writing tool based on Reddit data"*
- *"Find pain points about project management in r/startups and r/SaaS"*
- *"What workarounds are people building for expense tracking?"*

**Market Research**
- *"Monitor how people talk about Notion vs Coda on Reddit"*
- *"What features are missing from Figma according to Reddit users?"*
- *"Track pricing objections for Slack"*

**Lead Generation**
- *"Find people on Reddit looking to buy a CRM tool"*
- *"Build an ideal customer profile for developer tools from Reddit"*
- *"Export an evidence pack of all the data you found"*

## All 14 Tools

Every tool is free. No signup required. No API key needed.

| # | Tool | What it does |
|---|------|-------------|
| 1 | `browse_subreddit` | Browse posts from any subreddit with sorting |
| 2 | `search_reddit` | Search across multiple subreddits at once |
| 3 | `post_details` | Get full post + comments + extracted links |
| 4 | `user_profile` | Analyze a Reddit user's activity and expertise |
| 5 | `reddit_explain` | Explain Reddit terms and jargon (40+ terms) |
| 6 | `find_pain_points` | Detect user frustrations with severity scoring |
| 7 | `detect_workarounds` | Find DIY solutions = market gaps |
| 8 | `score_opportunity` | 0-100 score for any startup idea |
| 9 | `monitor_competitors` | Track competitor sentiment and switching intent |
| 10 | `extract_feature_gaps` | Find features users want but don't have |
| 11 | `track_pricing_objections` | Find pricing complaints and alternatives sought |
| 12 | `find_buyer_intent` | Detect people actively looking to buy |
| 13 | `build_icp` | Build Ideal Customer Profile from Reddit data |
| 14 | `export_evidence_pack` | Export structured reports (JSON/Markdown) |

## Pricing (Founder-Friendly)

We built this for indie hackers, founders, and small teams. Everyone gets access to everything.

| | Free | Pro ($7.99/mo) |
|---|---|---|
| **All 14 tools** | Yes | Yes |
| **Results per query** | 10 | Unlimited |
| **Scoring & signals** | Basic | Full breakdowns |
| **Clustering analysis** | - | Yes |
| **Opportunity hints** | - | Yes |
| **Evidence packs** | Yes | Yes |
| **Support** | GitHub Issues | Email |

**Pro costs less than two coffees per month.** Get it at [buildradar.xyz](https://buildradar.xyz). Set it up in 30 seconds:

```bash
export REDDIT_INTEL_TIER=pro
export REDDIT_INTEL_LICENSE_KEY=your-key-here
```

## Higher Rate Limits (Optional)

By default you get 10 Reddit requests/minute (no signup needed). Want faster?

```bash
npx reddit-intel-agent-mcp --auth
```

Follow the prompts to add Reddit API credentials:
- **App-Only** (just Client ID + Secret): 60 req/min
- **Authenticated** (add username + password): 100 req/min

Get credentials at: https://www.reddit.com/prefs/apps (click "Create App" > type "script")

## Production Deployment

### Deploy to Railway (recommended)

The hosted version is already live at `https://api.buildradar.xyz`. To self-host:

1. Fork this repo
2. Go to [railway.app](https://railway.app) > New Project > Deploy from GitHub
3. Add environment variables:
```
REDDIT_INTEL_HTTP=true
REDDIT_INTEL_API_KEY=your-secret-api-key
REDDIT_INTEL_BASE_URL=https://your-domain.com
```

### Deploy with Docker

```bash
docker build -t reddit-intel .
docker run -p 3000:3000 \
  -e REDDIT_INTEL_HTTP=true \
  -e REDDIT_INTEL_API_KEY=your-secret-api-key \
  reddit-intel
```

### Security

When running in HTTP mode with `--http`:
- Set `REDDIT_INTEL_API_KEY` to require authentication on all endpoints
- Clients authenticate via `Authorization: Bearer <key>` header
- Per-IP rate limiting (120 req/min) is built in
- Public endpoints (health, OpenAPI spec, discovery) don't require auth

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `REDDIT_INTEL_HTTP` | Enable HTTP server | No (default: false) |
| `REDDIT_INTEL_PORT` | HTTP port | No (default: 3000) |
| `REDDIT_INTEL_API_KEY` | API key for HTTP auth | No (recommended for production) |
| `REDDIT_INTEL_BASE_URL` | Public URL for OpenAPI spec | No |
| `REDDIT_INTEL_CLIENT_ID` | Reddit app client ID | No (for higher rate limits) |
| `REDDIT_INTEL_CLIENT_SECRET` | Reddit app client secret | No |
| `REDDIT_INTEL_USERNAME` | Reddit username | No (for 100 req/min) |
| `REDDIT_INTEL_PASSWORD` | Reddit password | No |
| `REDDIT_INTEL_TIER` | Product tier (free/pro) | No (default: free) |
| `REDDIT_INTEL_LICENSE_KEY` | License key for Pro/Team | No |

## Protocols Supported

| Protocol | Endpoint | Use case |
|----------|----------|----------|
| MCP Stdio | `npx reddit-intel-agent-mcp` | Claude Desktop, Claude Code, Cursor, Windsurf, Cline |
| MCP StreamableHTTP | `https://api.buildradar.xyz/mcp` | Remote MCP clients, modern MCP spec |
| MCP SSE | `https://api.buildradar.xyz/sse` | Cursor, Cline, older MCP clients |
| REST API | `https://api.buildradar.xyz/api/tools/:name` | ChatGPT, Gemini, Perplexity, any HTTP client |
| OpenAI Plugin | `https://api.buildradar.xyz/.well-known/ai-plugin.json` | ChatGPT GPT Store |
| MCP Discovery | `https://api.buildradar.xyz/.well-known/mcp.json` | MCP registries, auto-detection |

## Development

```bash
git clone https://github.com/Houseofmvps/reddit-intel-agent-mcp.git
cd reddit-intel-agent-mcp
npm install
npm run build
npm test
```

## License

MIT — use it however you want.

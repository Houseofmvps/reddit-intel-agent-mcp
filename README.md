# Reddit Intelligence Agent MCP

Reddit Opportunity Intelligence — scored startup ideas, market signals, and buyer intent from Reddit.

A dual-protocol server (MCP + REST API) that turns Reddit into an actionable intelligence source. Works with **Claude Desktop**, **Claude Code**, **ChatGPT**, and **Gemini**.

## What It Does

| Pillar | Free Tools | Pro Tools |
|--------|-----------|-----------|
| **Idea Mining** | Browse, Search | Pain Points, Workarounds, Feature Gaps, Opportunity Scoring |
| **Market Intelligence** | Post Details | Competitor Monitoring, Pricing Objections |
| **Lead Generation** | User Profile | Buyer Intent, ICP Builder, Evidence Pack Export |

### Intelligence Features
- **Pattern Detection** — 60+ regex rules across 9 signal categories (pain, workaround, buyer intent, switching, feature requests, pricing objections)
- **Scoring Engine** — Three 0-100 scoring systems: Opportunity Score, Signal Score, Lead Score
- **Clustering** — Automatic topic clustering via keyword extraction and Jaccard similarity
- **Evidence Packs** — Export structured JSON/Markdown reports with source URLs

## Quick Start

```bash
npx reddit-intelligence-agent-mcp
```

No API key required. Works immediately with anonymous Reddit access (10 req/min).

### Higher Rate Limits (Optional)

```bash
npx reddit-intelligence-agent-mcp --auth
```

Follow the prompts to add Reddit API credentials:
- **App-Only**: 60 req/min (just Client ID + Secret)
- **Authenticated**: 100 req/min (add username + password)

## Integration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reddit-intel": {
      "command": "npx",
      "args": ["-y", "reddit-intelligence-agent-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport stdio reddit-intel -s user -- npx -y reddit-intelligence-agent-mcp
```

### ChatGPT (Custom GPT Actions)

```bash
npx reddit-intelligence-agent-mcp --http
# Server starts on http://localhost:3000
# Import OpenAPI spec from http://localhost:3000/api/openapi.json
```

### Gemini Extensions

```bash
npx reddit-intelligence-agent-mcp --http
# Use REST endpoints at http://localhost:3000/api/tools/*
```

## REST API

When running with `--http`, the server exposes:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tools` | GET | List all available tools |
| `/api/prompts` | GET | List prompt packs |
| `/api/tools/:name` | POST | Execute a tool |
| `/api/openapi.json` | GET | OpenAPI 3.1 spec |
| `/health` | GET | Health check |
| `/mcp` | POST | MCP protocol endpoint |

## Tools

### Free (4 tools)
- **browse_subreddit** — Browse posts from any subreddit with sorting/filtering
- **search_reddit** — Search across multiple subreddits simultaneously
- **post_details** — Get full post content with comments and extracted links
- **user_profile** — Analyze a Reddit user's activity and expertise

### Pro (8 tools)
- **find_pain_points** — Detect and score user frustrations and unmet needs
- **detect_workarounds** — Find DIY solutions indicating market gaps
- **score_opportunity** — Calculate 0-100 opportunity score with breakdown
- **monitor_competitors** — Track competitor mentions, sentiment, and switching intent
- **extract_feature_gaps** — Identify missing features users want
- **track_pricing_objections** — Find pricing complaints and willingness to pay
- **find_buyer_intent** — Detect users actively looking to buy
- **build_icp** — Build Ideal Customer Profile from Reddit data

### Export (1 tool)
- **export_evidence_pack** — Generate structured reports (JSON/Markdown)

## Prompt Packs

Pre-built workflows that chain multiple tools:

**Free**: validate_startup_idea, quick_market_scan, subreddit_deep_dive, user_research, find_underserved_niches

**Pro**: full_opportunity_assessment, competitor_intelligence_report, lead_discovery_workflow, pricing_strategy_research, icp_builder

## Product Tiers

| Feature | Free | Pro ($49/mo) | Team ($199/mo) |
|---------|------|-------------|----------------|
| Retrieval tools | 4 | 4 | 4 |
| Intelligence tools | 2 (limited) | 8 (full) | 8 (full) |
| Results per query | 5 | Unlimited | Unlimited |
| Scoring | - | Full | Full |
| Evidence packs | - | JSON + Markdown | JSON + Markdown |
| Prompt packs | 5 | 10 | 10 |

Configure tier via environment:
```bash
export REDDIT_INTEL_TIER=pro
export REDDIT_INTEL_LICENSE_KEY=your-key
```

## Docker

```bash
docker build -t reddit-intel .
docker run -p 3000:3000 -e REDDIT_INTEL_HTTP=true reddit-intel
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDDIT_INTEL_CLIENT_ID` | Reddit app client ID | - |
| `REDDIT_INTEL_CLIENT_SECRET` | Reddit app client secret | - |
| `REDDIT_INTEL_USERNAME` | Reddit username | - |
| `REDDIT_INTEL_PASSWORD` | Reddit password | - |
| `REDDIT_INTEL_HTTP` | Enable HTTP server | `false` |
| `REDDIT_INTEL_PORT` | HTTP port | `3000` |
| `REDDIT_INTEL_TIER` | Product tier (free/pro/team) | `free` |
| `REDDIT_INTEL_LICENSE_KEY` | License key for Pro/Team | - |

## Development

```bash
git clone https://github.com/your-org/reddit-intelligence-agent-mcp.git
cd reddit-intelligence-agent-mcp
npm install
npm run build
npm test
```

## License

MIT

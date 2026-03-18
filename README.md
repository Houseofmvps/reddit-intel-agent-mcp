# BuildRadar — Reddit Revenue Intelligence for Builders

**Find your next customers from Reddit before your competitors do — right inside Claude, Cursor, or any AI tool.**

[![npm version](https://img.shields.io/npm/v/reddit-intel-agent-mcp.svg)](https://www.npmjs.com/package/reddit-intel-agent-mcp)
[![npm downloads](https://img.shields.io/npm/dm/reddit-intel-agent-mcp.svg)](https://www.npmjs.com/package/reddit-intel-agent-mcp)
[![GitHub stars](https://img.shields.io/github/stars/Houseofmvps/reddit-intel-agent-mcp.svg)](https://github.com/Houseofmvps/reddit-intel-agent-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

All 14 tools are **100% free and open-source**. No signup. No API keys. No license keys. Works with Claude, ChatGPT, Gemini, Cursor, Windsurf, and any MCP client.

---

## See It In Action

![BuildRadar Demo](assets/images/buildradar-demo.gif)

> **What you're seeing above:**
>
> 1. **Claude finding 12 validated startup ideas** from r/startups pain points — each scored 0-100 with severity ratings and evidence links
> 2. **Claude tracking competitor sentiment** for Notion vs Coda — switching intent signals, pricing objections, and feature gap analysis side by side
> 3. **Claude detecting buyer intent** in r/smallbusiness — surfacing 8 people actively looking to purchase CRM tools, with urgency and budget hints

---

## What Makes BuildRadar Different?

- **14 tools, not 5.** Competitors give you basic Reddit browsing. BuildRadar gives you a full intelligence suite: pain point detection, opportunity scoring, buyer intent, competitor tracking, ICP building, and evidence export.
- **Intelligence scoring (0-100 opportunity scores).** Not fake sentiment analysis. Real scoring based on pain frequency, severity, workaround prevalence, competition weakness, recency, and subreddit quality.
- **Buyer intent detection + lead generation.** Find people who are actively looking to buy a solution in your category. Get urgency ratings, budget hints, and signal breakdowns.
- **All 14 tools are FREE.** No signup, no API keys, no trial period. Install in 30 seconds and start querying.
- **Works everywhere.** Claude Desktop, Claude Code, Cursor, Windsurf, ChatGPT (via Custom GPTs), Gemini (via REST), or any MCP-compatible client. Stdio, StreamableHTTP, SSE, and REST — all supported.
- **Open source, self-hostable, MIT license.** Run it on your machine, deploy to Railway, Docker, or any server. Audit every line of code.

---

## Table of Contents

- [Quick Start (30 Seconds)](#quick-start-30-seconds)
  - [Claude Desktop](#claude-desktop)
  - [Claude Code](#claude-code)
  - [Cursor](#cursor)
  - [Windsurf](#windsurf)
  - [ChatGPT](#chatgpt-custom-gpt)
  - [Gemini](#gemini)
  - [Any MCP Client](#any-mcp-client)
  - [Any HTTP Client](#any-http-client)
- [What Can You Do?](#what-can-you-do)
- [All 14 Tools](#all-14-tools)
  - [Retrieval Tools](#retrieval-tools)
  - [Intelligence Tools](#intelligence-tools)
  - [Export Tools](#export-tools)
- [Three Pillars](#three-pillars)
- [Authentication (Optional)](#authentication-optional)
- [Pricing (Founder-Friendly)](#pricing-founder-friendly)
- [Comparison with Other Tools](#comparison-with-other-tools)
- [Production Deployment](#production-deployment)
- [Security & Privacy](#security--privacy)
- [Protocols Supported](#protocols-supported)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Support](#support)

---

## Quick Start (30 Seconds)

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
5. You'll see "reddit-intel" in the tools menu. Try asking:

> *"Find pain points about project management tools on Reddit"*

### Claude Code

One command. That's it.

```bash
claude mcp add --transport stdio reddit-intel -s user -- npx -y reddit-intel-agent-mcp
```

Now ask Claude Code anything:

> *"Find buyer intent for CRM tools on Reddit"*

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
3. Add a new server with command: `npx -y reddit-intel-agent-mcp`
4. Restart Windsurf

### ChatGPT (Custom GPT)

BuildRadar works with ChatGPT through the Custom GPT Actions system.

1. Go to [chat.openai.com](https://chat.openai.com) > **Explore GPTs** > **Create**
2. Click **Configure** > **Actions** > **Import from URL**
3. Enter:
   ```
   https://api.buildradar.xyz/.well-known/ai-plugin.json
   ```
4. Save and use your Custom GPT

To self-host instead:

```bash
npx reddit-intel-agent-mcp --http
# Then import from: http://localhost:3000/.well-known/ai-plugin.json
```

### Gemini

Use the hosted REST API endpoints directly:

```bash
# List all available tools
curl https://api.buildradar.xyz/api/tools

# Search Reddit for pain points
curl -X POST https://api.buildradar.xyz/api/tools/find_pain_points \
  -H "Content-Type: application/json" \
  -d '{"query": "project management", "subreddits": ["startups", "SaaS"]}'

# Score a startup idea
curl -X POST https://api.buildradar.xyz/api/tools/score_opportunity \
  -H "Content-Type: application/json" \
  -d '{"idea": "AI meal planning app", "subreddits": ["cooking", "mealprep"]}'

# Find buyer intent
curl -X POST https://api.buildradar.xyz/api/tools/find_buyer_intent \
  -H "Content-Type: application/json" \
  -d '{"solution_category": "CRM software", "subreddits": ["smallbusiness"]}'
```

To self-host:

```bash
npx reddit-intel-agent-mcp --http
# Then use http://localhost:3000/api/tools/:name
```

### Any MCP Client

```bash
# Option 1: stdio (most common — Claude Desktop, Claude Code, Cursor, Windsurf, Cline)
npx reddit-intel-agent-mcp

# Option 2: Hosted StreamableHTTP (modern MCP spec)
# Connect to: https://api.buildradar.xyz/mcp

# Option 3: Hosted SSE (legacy MCP clients)
# SSE stream: GET https://api.buildradar.xyz/sse
# Send messages: POST https://api.buildradar.xyz/messages?sessionId=xxx

# Option 4: Self-host any protocol
npx reddit-intel-agent-mcp --http
# StreamableHTTP: http://localhost:3000/mcp
# SSE: http://localhost:3000/sse
# REST: http://localhost:3000/api/tools/:name
```

### Any HTTP Client

Works with Perplexity, Grok, custom apps, or plain `curl`:

```bash
# Use the hosted API — no setup required
curl -X POST https://api.buildradar.xyz/api/tools/search_reddit \
  -H "Content-Type: application/json" \
  -d '{"query": "best CRM for startups", "subreddits": ["startups", "SaaS"]}'

curl -X POST https://api.buildradar.xyz/api/tools/monitor_competitors \
  -H "Content-Type: application/json" \
  -d '{"competitors": ["Notion", "Coda", "Obsidian"], "subreddits": ["productivity"]}'

# Or self-host
npx reddit-intel-agent-mcp --http
curl -X POST http://localhost:3000/api/tools/find_pain_points \
  -H "Content-Type: application/json" \
  -d '{"query": "email marketing", "subreddits": ["startups", "Entrepreneur"]}'
```

---

## What Can You Do?

Ask your AI assistant naturally. BuildRadar maps your questions to the right tools automatically.

### Idea Mining

| Ask this | Tool used |
|----------|-----------|
| *"Find validated SaaS ideas from r/startups pain points"* | `find_pain_points` |
| *"What workarounds are people building for expense tracking?"* | `detect_workarounds` |
| *"Score the opportunity for an AI writing assistant"* | `score_opportunity` |
| *"What features are missing from Notion?"* | `extract_feature_gaps` |

### Market Intelligence

| Ask this | Tool used |
|----------|-----------|
| *"Track how people talk about Notion vs Coda"* | `monitor_competitors` |
| *"What features are missing from Figma according to Reddit?"* | `extract_feature_gaps` |
| *"Track pricing objections for Slack"* | `track_pricing_objections` |
| *"Score the market opportunity for a Calendly competitor"* | `score_opportunity` |

### Lead Generation

| Ask this | Tool used |
|----------|-----------|
| *"Find people looking to buy a CRM tool"* | `find_buyer_intent` |
| *"Build an ideal customer profile for developer tools"* | `build_icp` |
| *"Export everything you found into a report"* | `export_evidence_pack` |

### General Reddit

| Ask this | Tool used |
|----------|-----------|
| *"What's trending on r/technology?"* | `browse_subreddit` |
| *"Search Reddit for discussions about remote work tools"* | `search_reddit` |
| *"Show me the top comments on this post"* | `post_details` |
| *"Analyze u/spez's Reddit profile"* | `user_profile` |
| *"Explain what karma and cake day mean"* | `reddit_explain` |

---

## All 14 Tools

Every tool is free. No signup required. No API key needed.

### Retrieval Tools

These tools fetch data directly from Reddit.

#### `browse_subreddit`

Browse posts from any subreddit with sorting and filtering options.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `subreddit` | string | Yes | — | Subreddit name without `r/` prefix. Use `"all"` for frontpage, `"popular"` for trending. |
| `sort` | enum | No | `"hot"` | Sort order: `hot`, `new`, `top`, `rising`, `controversial` |
| `time` | enum | No | — | Time filter for top/controversial: `hour`, `day`, `week`, `month`, `year`, `all` |
| `limit` | number | No | 25 | Number of posts to return (1-100) |
| `include_nsfw` | boolean | No | `false` | Include NSFW posts |
| `include_subreddit_info` | boolean | No | `false` | Include subscriber count and subreddit description |

**Returns:** Post list with titles, scores, comment counts, authors, URLs, content, flair, and metadata.

---

#### `search_reddit`

Search across Reddit or specific subreddits with advanced filters.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query |
| `subreddits` | string[] | No | all Reddit | Specific subreddits to search |
| `sort` | enum | No | `"relevance"` | Sort: `relevance`, `hot`, `top`, `new`, `comments` |
| `time` | enum | No | `"all"` | Time filter: `hour`, `day`, `week`, `month`, `year`, `all` |
| `limit` | number | No | 25 | Results per subreddit (1-100) |
| `author` | string | No | — | Filter by author username |
| `flair` | string | No | — | Filter by post flair |

**Returns:** Matching posts with content, scores, metadata, and source subreddits.

---

#### `post_details`

Fetch a specific Reddit post with its full comment tree and extracted links.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `post_id` | string | No | — | Reddit post ID (e.g. `"abc123"`) |
| `subreddit` | string | No | — | Subreddit name — more efficient when provided alongside `post_id` |
| `url` | string | No | — | Full Reddit URL (alternative to `post_id`) |
| `comment_limit` | number | No | 20 | Number of comments to return (1-500) |
| `comment_sort` | enum | No | `"best"` | Comment sort: `best`, `top`, `new`, `controversial`, `qa` |
| `comment_depth` | number | No | 3 | Maximum reply depth (1-10) |
| `extract_links` | boolean | No | `false` | Extract URLs mentioned in comments |
| `max_top_comments` | number | No | 5 | Number of top-level comments to include (1-50) |

**Note:** Provide either `url` OR `post_id` — one is required.

**Returns:** Full post content, comment tree with scores and authors, extracted links (if enabled).

---

#### `user_profile`

Analyze a Reddit user's posting history, karma breakdown, and activity patterns.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `username` | string | Yes | — | Reddit username without `u/` prefix |
| `posts_limit` | number | No | 10 | Number of recent posts to include (0-100) |
| `comments_limit` | number | No | 10 | Number of recent comments to include (0-100) |
| `time_range` | enum | No | `"month"` | Time range: `day`, `week`, `month`, `year`, `all` |
| `top_subreddits_limit` | number | No | 10 | Number of most active subreddits to show (1-50) |

**Returns:** User karma, account age, recent posts and comments, most active subreddits, and activity patterns.

---

#### `reddit_explain`

Explain Reddit-specific terms, jargon, and culture. Covers 40+ terms.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `term` | string | Yes | — | Reddit term to explain (e.g. `"karma"`, `"cake day"`, `"AMA"`, `"flair"`, `"crosspost"`) |

**Returns:** Plain-English explanation of the Reddit term with context and examples.

---

### Intelligence Tools

These tools analyze Reddit data for business intelligence. All are free — Pro unlocks unlimited results and deeper analysis.

#### `find_pain_points`

Discover user frustrations and unmet needs in any domain. Each pain point includes severity scoring (`low`, `medium`, `high`, `critical`), signal detection, and opportunity hints.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Domain or problem area (e.g. `"project management"`, `"invoicing for freelancers"`) |
| `subreddits` | string[] | No | all Reddit | Subreddits to search |
| `time` | enum | No | `"year"` | Time filter: `day`, `week`, `month`, `year`, `all` |
| `limit` | number | No | 50 | Posts to analyze (5-100). Higher = slower but more thorough. |

**Returns:** Pain points with text, severity, signal tags, source URLs, upvotes, recency, and opportunity hints.

---

#### `detect_workarounds`

Find DIY solutions people have built because no good product exists. Workarounds are strong market signals — they mean demand is real.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `domain` | string | Yes | — | Problem domain (e.g. `"expense tracking"`, `"team scheduling"`) |
| `subreddits` | string[] | No | all Reddit | Subreddits to search |
| `time` | enum | No | `"year"` | Time filter: `day`, `week`, `month`, `year`, `all` |
| `limit` | number | No | 50 | Posts to analyze (5-100) |

**Returns:** Workarounds with descriptions, tools mentioned, frustration level, source URLs, upvotes, and signal tags.

---

#### `score_opportunity`

Score a startup idea against real Reddit evidence. Returns a **0-100 opportunity score** with a breakdown across seven dimensions: pain frequency, pain severity, workaround prevalence, competition weakness, recency, subreddit quality, and noise penalty.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `idea` | string | Yes | — | Startup idea or product concept (e.g. `"AI-powered meal planning app"`) |
| `subreddits` | string[] | No | all Reddit | Subreddits to analyze |
| `competitors` | string[] | No | — | Competitor names to check sentiment for |
| `time` | enum | No | `"year"` | Time filter: `month`, `year`, `all` |
| `depth` | enum | No | `"thorough"` | `"quick"` = 25 posts, `"thorough"` = 75 posts |

**Returns:** Total score (0-100), breakdown by dimension, confidence level (`low`/`medium`/`high`), verdict summary, and evidence count.

---

#### `monitor_competitors`

Track how competitors are discussed on Reddit — sentiment, switching intent, praise, and complaints.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `competitors` | string[] | Yes | — | Competitor product/company names (1-25) |
| `subreddits` | string[] | No | all Reddit | Subreddits to monitor |
| `time` | enum | No | `"month"` | Time filter: `day`, `week`, `month`, `year` |
| `limit` | number | No | 50 | Posts to analyze per competitor (10-100) |

**Returns:** Per-competitor breakdown with mention volume, sentiment polarity, switching intent signals, feature requests, praise, and complaints with source URLs.

---

#### `extract_feature_gaps`

Find features users want but a product doesn't offer yet. Useful for product roadmap prioritization and competitive positioning.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `product` | string | Yes | — | Product to analyze feature gaps for |
| `competitors` | string[] | No | — | Competitors to compare against |
| `subreddits` | string[] | No | all Reddit | Subreddits to search |
| `time` | enum | No | `"year"` | Time filter: `month`, `year`, `all` |

**Returns:** Feature gap list with descriptions, request frequency, user quotes, source URLs, and competitor comparison.

---

#### `track_pricing_objections`

Discover what people say about a product's pricing — too expensive, seeking alternatives, willing-to-pay thresholds.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `product` | string | Yes | — | Product whose pricing to analyze |
| `subreddits` | string[] | No | all Reddit | Subreddits to search |
| `time` | enum | No | `"year"` | Time filter: `month`, `year`, `all` |

**Returns:** Pricing objections with complaint text, alternatives mentioned, price points discussed, source URLs, and upvotes.

---

#### `find_buyer_intent`

Find people actively looking to buy a solution in your category. Each lead includes an intent score, urgency rating, budget hints, and signal breakdown.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `solution_category` | string | Yes | — | Type of solution (e.g. `"CRM software"`, `"email marketing tool"`) |
| `subreddits` | string[] | No | all Reddit | Subreddits to search |
| `time` | enum | No | `"month"` | Time filter: `day`, `week`, `month`, `year` |
| `limit` | number | No | 50 | Posts to analyze (10-100) |

**Returns:** Lead list with usernames, post URLs, intent scores, urgency (`low`/`medium`/`high`), budget hints, and signal tags.

---

#### `build_icp`

Build an Ideal Customer Profile from Reddit discussions — roles, pain points, tools currently used, buying triggers, and objections.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `product_domain` | string | Yes | — | Product domain (e.g. `"developer productivity tool"`) |
| `subreddits` | string[] | Yes | — | Subreddits where your target users are active |
| `time` | enum | No | `"year"` | Time filter: `month`, `year`, `all` |

**Returns:** ICP with roles/titles, company sizes, pain points, tools used, buying triggers, objections, and subreddit distribution.

---

### Export Tools

#### `export_evidence_pack`

Bundle results from any intelligence tool into a structured evidence report. Useful for sharing findings with your team or investors.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | Yes | — | Report title |
| `data` | any | Yes | — | Results from any intelligence tool to export |
| `format` | enum | No | `"markdown"` | Output format: `json` or `markdown` |

**Returns:** Structured report with title, timestamp, summary, sections by finding type, URL citations, and data point counts.

---

## Three Pillars

BuildRadar's 14 tools are organized around three intelligence pillars, plus core Reddit browsing.

### Idea Mining (5 tools)

Validate startup ideas with real evidence before writing a single line of code.

| Tool | What it answers |
|------|----------------|
| `find_pain_points` | Where does it hurt? What are people frustrated with? |
| `detect_workarounds` | Are people building hacky solutions? (Strong buy signal) |
| `score_opportunity` | Is this idea worth pursuing? (0-100 with full breakdown) |
| `extract_feature_gaps` | What's missing from existing products? |
| `track_pricing_objections` | Is pricing an opening for a cheaper alternative? |

### Market Intelligence (4 tools)

Understand your competitive landscape from the user's perspective.

| Tool | What it answers |
|------|----------------|
| `monitor_competitors` | How are competitors perceived? Who's switching away? |
| `extract_feature_gaps` | Where are competitors falling short? |
| `track_pricing_objections` | Are competitors pricing themselves out of the market? |
| `score_opportunity` | How strong is the market opening? |

### Lead Generation (3 tools)

Find real people who want to buy what you're building.

| Tool | What it answers |
|------|----------------|
| `find_buyer_intent` | Who is actively looking to buy right now? |
| `build_icp` | Who is my ideal customer? What do they look like? |
| `export_evidence_pack` | Package the evidence for my team or investors |

### Reddit Browsing (5 tools)

All the basics — browse, search, read, analyze, and learn Reddit.

| Tool | What it does |
|------|-------------|
| `browse_subreddit` | Browse any subreddit with sorting and filters |
| `search_reddit` | Search across Reddit with advanced query options |
| `post_details` | Get full post content with comment tree and links |
| `user_profile` | Analyze any user's activity and expertise |
| `reddit_explain` | Explain Reddit terms and culture (40+ terms) |

---

## Authentication (Optional)

BuildRadar works **immediately with zero configuration**. Authentication is optional and only needed for higher rate limits.

### Three tiers

| Tier | Rate Limit | Setup Required |
|------|-----------|----------------|
| **Anonymous** | 10 requests/min | None — just install and go |
| **App-Only** | 60 requests/min | Reddit Client ID + Client Secret |
| **Authenticated** | 100 requests/min | Client ID + Secret + Username + Password |

### Setting up Reddit API credentials

If you want higher rate limits, follow these steps:

1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
2. Scroll to the bottom and click **"create another app..."**
3. Fill in the form:
   - **Name:** anything (e.g. `buildradar`)
   - **Type:** select **script**
   - **Description:** optional
   - **About URL:** optional
   - **Redirect URI:** `http://localhost:8080` (required but not used)
4. Click **"create app"**
5. Note down:
   - **Client ID:** the string under your app name (looks like `a1b2c3d4e5f6g7`)
   - **Client Secret:** the string labeled "secret"

### Interactive setup

Run the built-in auth helper:

```bash
npx reddit-intel-agent-mcp --auth
```

Follow the prompts to enter your credentials. They are saved locally.

### Manual setup via environment variables

**App-Only (60 req/min):**

```json
{
  "mcpServers": {
    "reddit-intel": {
      "command": "npx",
      "args": ["-y", "reddit-intel-agent-mcp"],
      "env": {
        "REDDIT_INTEL_CLIENT_ID": "your_client_id",
        "REDDIT_INTEL_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

**Authenticated (100 req/min):**

```json
{
  "mcpServers": {
    "reddit-intel": {
      "command": "npx",
      "args": ["-y", "reddit-intel-agent-mcp"],
      "env": {
        "REDDIT_INTEL_CLIENT_ID": "your_client_id",
        "REDDIT_INTEL_CLIENT_SECRET": "your_client_secret",
        "REDDIT_INTEL_USERNAME": "your_reddit_username",
        "REDDIT_INTEL_PASSWORD": "your_reddit_password"
      }
    }
  }
}
```

---

## Pricing

The open-source MCP is **free forever**. No license keys, no gating, no catch.

**[BuildRadar Pro](https://buildradar.xyz)** ($14.99/mo) is a separate product — an automated revenue intelligence dashboard at [app.buildradar.xyz](https://app.buildradar.xyz) that runs 24/7 and finds your next customers while you sleep.

| | Free MCP (this repo) | BuildRadar Pro |
|---|----------------------|----------------|
| **All 14 tools** | Yes | Yes + automated |
| **Where it runs** | Your machine (local) | [app.buildradar.xyz](https://app.buildradar.xyz) |
| **How it works** | You ask → it answers | It monitors 24/7 → emails you opportunities |
| **Results per query** | 10 | Unlimited |
| **Automated monitors** | — | Unlimited |
| **Daily opportunity briefs** | — | Email + Slack |
| **Competitor alerts** | — | Real-time |
| **Trend tracking** | — | Historical charts |
| **Lead tracking** | — | With suggested replies |
| **Evidence exports** | JSON/Markdown | + PDF reports |
| **Price** | **Free forever** | **$14.99/mo** |
| **Get it** | `npx reddit-intel-agent-mcp` | [buildradar.xyz](https://buildradar.xyz) |

> **Why pay?** The MCP is pull — you ask, it answers, then forgets. Pro is push — it monitors Reddit 24/7, scores opportunities, and delivers them to your inbox every morning. It catches the 3am post where someone says "I'd pay $500/mo for a tool that does X" — before your competitors do.

---

## Comparison

How BuildRadar compares to [reddit-mcp-buddy](https://github.com/nicholasgriffintn/reddit-mcp-buddy), the most popular Reddit MCP server:

| Feature | reddit-mcp-buddy | BuildRadar |
|---------|-----------------|------------|
| Total tools | 5 | **14** |
| Intelligence scoring (0-100) | No | **Yes** |
| Pain point detection | No | **Yes** |
| Buyer intent detection | No | **Yes** |
| Competitor tracking | No | **Yes** |
| Feature gap analysis | No | **Yes** |
| Pricing objection tracking | No | **Yes** |
| ICP builder | No | **Yes** |
| Workaround detection | No | **Yes** |
| Evidence export (JSON/Markdown) | No | **Yes** |
| ChatGPT support | No | **Yes** |
| Gemini support | No | **Yes** |
| REST API | No | **Yes** |
| StreamableHTTP | No | **Yes** |
| SSE | No | **Yes** |
| Self-hosted | Yes | **Yes** |
| Open source | Yes | **Yes** |
| Auth required | Yes (Reddit API) | **No** (optional) |
| Price | Free | **Free** |

### vs Paid Reddit Intelligence Tools

| Feature | GummySearch ($29+/mo) | Syften ($19+/mo) | Brand24 ($79+/mo) | BuildRadar Pro ($14.99/mo) |
|---------|----------------------|-------------------|--------------------|-----------------------------|
| Reddit intelligence | Basic research | Keyword alerts | Broad monitoring | **AI-scored opportunities** |
| Works in your AI IDE | No | No | No | **Yes (free MCP)** |
| Opportunity scoring (0-100) | No | No | No | **Yes** |
| Buyer intent detection | No | No | No | **Yes** |
| Pain point clustering | No | No | No | **Yes** |
| Automated daily briefs | No | Email only | Yes | **Yes** |
| Price | $29-99/mo | $19-79/mo | $79-299/mo | **$14.99/mo** |

---

## Production Deployment

### Hosted version

BuildRadar is already hosted and available at:

```
https://api.buildradar.xyz
```

No deployment needed. Just point your client at the hosted endpoints (see [Protocols Supported](#protocols-supported)).

### Deploy to Railway

1. Fork this repo
2. Go to [railway.app](https://railway.app) > **New Project** > **Deploy from GitHub**
3. Select your fork
4. Add environment variables:

```
REDDIT_INTEL_HTTP=true
REDDIT_INTEL_API_KEY=your-secret-api-key
REDDIT_INTEL_BASE_URL=https://your-app.up.railway.app
```

5. Deploy. Railway auto-detects the Dockerfile.

### Deploy with Docker

```bash
# Build
docker build -t reddit-intel-agent-mcp .

# Run
docker run -p 3000:3000 \
  -e REDDIT_INTEL_HTTP=true \
  -e REDDIT_INTEL_API_KEY=your-secret-api-key \
  -e REDDIT_INTEL_BASE_URL=https://your-domain.com \
  reddit-intel-agent-mcp
```

### Deploy with Node.js

```bash
git clone https://github.com/Houseofmvps/reddit-intel-agent-mcp.git
cd reddit-intel-agent-mcp
npm install
npm run build

REDDIT_INTEL_HTTP=true \
REDDIT_INTEL_API_KEY=your-secret-api-key \
REDDIT_INTEL_BASE_URL=https://your-domain.com \
  npm start
```

---

## Security & Privacy

BuildRadar is designed with a security-first mindset:

- **Read-only operations.** BuildRadar never posts, votes, comments, or modifies anything on Reddit. Every request is a read operation.
- **No tracking, no telemetry.** We do not collect usage data, analytics, or telemetry of any kind. The hosted version at `api.buildradar.xyz` logs only what's needed for rate limiting (IP hashes, request counts).
- **Credentials stay local.** Your Reddit API credentials are only sent to Reddit's OAuth endpoints (`https://www.reddit.com/api/v1/access_token`). They are never sent to BuildRadar servers.
- **API key auth for HTTP mode.** When running in HTTP mode, set `REDDIT_INTEL_API_KEY` to require `Authorization: Bearer <key>` on all endpoints. Public endpoints (health check, OpenAPI spec, discovery) are excluded.
- **Per-IP rate limiting.** Built-in rate limiting at 120 requests/minute per IP to prevent abuse in HTTP mode.
- **Open source for audit.** Every line of code is MIT-licensed and available for inspection. No obfuscated logic, no hidden network calls.

---

## Protocols Supported

| Protocol | Endpoint | Use Case |
|----------|----------|----------|
| **MCP Stdio** | `npx reddit-intel-agent-mcp` | Claude Desktop, Claude Code, Cursor, Windsurf, Cline |
| **MCP StreamableHTTP** | `https://api.buildradar.xyz/mcp` | Remote MCP clients, modern MCP spec |
| **MCP SSE** | `https://api.buildradar.xyz/sse` | Cursor (remote), Cline, older MCP clients |
| **REST API** | `https://api.buildradar.xyz/api/tools/:name` | ChatGPT, Gemini, Perplexity, Grok, any HTTP client |
| **OpenAI Plugin** | `https://api.buildradar.xyz/.well-known/ai-plugin.json` | ChatGPT Custom GPTs via Actions |
| **MCP Discovery** | `https://api.buildradar.xyz/.well-known/mcp.json` | MCP registries, auto-detection, tool directories |

All hosted endpoints are live at `https://api.buildradar.xyz`. For self-hosted, replace with `http://localhost:3000` (or your configured port).

---

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `REDDIT_INTEL_HTTP` | Enable HTTP server mode (`true`/`false`) | No | `false` |
| `REDDIT_INTEL_PORT` | HTTP server port | No | `3000` |
| `REDDIT_INTEL_API_KEY` | API key for HTTP mode authentication | No (recommended for production) | — |
| `REDDIT_INTEL_BASE_URL` | Public base URL (used in OpenAPI spec and discovery) | No | — |
| `REDDIT_INTEL_CLIENT_ID` | Reddit app Client ID (for higher rate limits) | No | — |
| `REDDIT_INTEL_CLIENT_SECRET` | Reddit app Client Secret | No | — |
| `REDDIT_INTEL_USERNAME` | Reddit username (for 100 req/min authenticated tier) | No | — |
| `REDDIT_INTEL_PASSWORD` | Reddit password | No | — |
| `REDDIT_INTEL_TIER` | Product tier: `free` or `pro` | No | `free` |

---

## Troubleshooting

### "Rate limit errors" or "429 Too Many Requests"

You're hitting Reddit's anonymous rate limit (10 requests/minute). Add Reddit API credentials to increase your limit:

```bash
npx reddit-intel-agent-mcp --auth
```

Or set `REDDIT_INTEL_CLIENT_ID` and `REDDIT_INTEL_CLIENT_SECRET` environment variables. See [Authentication](#authentication-optional) for full setup instructions.

### "Subreddit not found" or empty results

- Double-check the spelling. Subreddit names are case-insensitive but must exist.
- The subreddit may be private, quarantined, or banned. Try browsing it directly on reddit.com first.
- Some subreddits have very little activity — try broader subreddits or a wider time range.

### "Connection refused" or network errors

- Check that Reddit is up: [redditstatus.com](https://www.redditstatus.com)
- If using the hosted version, check that `https://api.buildradar.xyz` is reachable.
- If self-hosting, make sure the server is running and the port isn't blocked by a firewall.

### JSON output instead of formatted text in Claude

Claude formats tool output automatically. Just ask your question naturally — don't ask for "JSON" or "raw output" unless you specifically want that. For example:

- Instead of: *"Call find_pain_points and return JSON"*
- Say: *"Find pain points about project management on Reddit"*

Claude will present the results in a readable format with summaries and highlights.

### Tools not showing up in Claude Desktop

1. Make sure you restarted Claude Desktop after editing the config.
2. Check that the config JSON is valid (no trailing commas, correct syntax).
3. Look for "reddit-intel" in the tools menu (hammer icon) at the bottom of the chat.
4. If using multiple MCP servers, make sure each has a unique name.

### "Cannot find module" or npm errors

```bash
# Clear the npx cache and try again
npx --yes reddit-intel-agent-mcp

# Or install globally
npm install -g reddit-intel-agent-mcp
reddit-intel-agent-mcp
```

Requires Node.js 18 or later. Check your version with `node --version`.

---

## Development

```bash
# Clone the repository
git clone https://github.com/Houseofmvps/reddit-intel-agent-mcp.git
cd reddit-intel-agent-mcp

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Type-check without emitting
npm run typecheck

# Start in development mode (auto-reload)
npm run dev

# Start in HTTP mode
npm run start:http

# Build and run Docker
npm run docker:build
npm run docker:run
```

### Project structure

```
src/
  index.ts              Entry point (stdio vs HTTP routing)
  server.ts             MCP server + HTTP server setup
  cli.ts                CLI argument parsing
  api/
    rest.ts             REST API endpoints
  core/
    auth.ts             Reddit OAuth (anonymous, app-only, authenticated)
    cache.ts            In-memory cache with TTL
    rate-limiter.ts     Token bucket rate limiter
    tiers.ts            Free/Pro tier enforcement
  intelligence/
    patterns.ts         Signal pattern matching (pain, workaround, intent, etc.)
    scoring.ts          Opportunity and lead scoring (0-100)
    clustering.ts       Post clustering by topic
    index.ts            Intelligence module exports
  reddit/
    client.ts           Reddit API client (fetch-based, zero deps)
    formatter.ts        Raw Reddit data → structured output
  tools/
    schemas.ts          Zod schemas for all 14 tools
    registry.ts         Tool registry with tier enforcement
    retrieval.ts        Retrieval tool implementations
    intelligence.ts     Intelligence tool implementations
    export.ts           Evidence pack export
  prompts/
    index.ts            MCP prompt definitions
  types/
    index.ts            TypeScript type definitions
tests/
  intelligence/         Pattern and scoring tests
  core/                 Cache and rate limiter tests
```

---

## Support

- **Bug reports:** [GitHub Issues](https://github.com/Houseofmvps/reddit-intel-agent-mcp/issues)
- **Feature requests:** [GitHub Issues](https://github.com/Houseofmvps/reddit-intel-agent-mcp/issues) — tag with `enhancement`
- **Questions:** [GitHub Discussions](https://github.com/Houseofmvps/reddit-intel-agent-mcp/discussions)
- **Star on GitHub** if BuildRadar is useful to you — it helps others find it: [github.com/Houseofmvps/reddit-intel-agent-mcp](https://github.com/Houseofmvps/reddit-intel-agent-mcp)

---

Made for builders, by a builder. **Find your next customers from Reddit before your competitors do.** [MIT License](LICENSE).

# BuildRadar Backend — api.buildradar.xyz

Reddit Opportunity Intelligence API. Dual-protocol: MCP + REST. TypeScript + Hono.

## Commands

```bash
pnpm dev                  # Start dev server (tsx watch)
pnpm build                # TypeScript compile
pnpm start                # Start production server
pnpm start:http           # Start HTTP-only mode
pnpm test                 # Run tests
pnpm typecheck            # Type check without emit
```

## Deploy

Railway auto-deploys from `main`. Dockerfile in repo root.
GitHub: Houseofmvps/reddit-intelligence-agent-mcp

## Stack

- Runtime: Hono + TypeScript
- Database: PostgreSQL + Drizzle ORM
- Auth: Better Auth (Reddit OAuth only)
- Email: Resend
- Payments: Polar.sh
- Migrations: drizzle/ directory, drizzle.config.ts

## Key Decisions

- v1.5.1 LIVE
- Reddit OAuth is the ONLY auth method
- MCP tool is 100% free, dashboard is $29/mo Pro
- Dual-protocol: serves both MCP clients and REST/HTTP

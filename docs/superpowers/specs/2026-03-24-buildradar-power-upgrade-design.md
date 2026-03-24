# BuildRadar Power Upgrade: High-Intent Reddit Lead Engine

**Date:** 2026-03-24
**Status:** Approved
**Scope:** Backend (reddit-intelligence-agent-mcp) + Frontend (buildradar-insights)

**NOTE:** Backend uses raw Node `http.createServer`, NOT Hono (despite CLAUDE.md). All new endpoints follow the `handleDashboardRequest` pattern in `src/api/dashboard.ts` using `IncomingMessage`/`ServerResponse`.

## Problem

BuildRadar's scan-and-display pipeline works, but the features that differentiate a $14.99/mo product from a free tool are either fake, broken, or missing. Reply templates are hardcoded junk. Competitors/Buyer Signals pages are filtered duplicates of the same data. Settings is read-only. No error handling. No upgrade funnel. Technical debt from Lovable scaffold.

## Goal

Transform BuildRadar into the most powerful high-intent lead engine for Reddit. Users pay because:
1. AI generates personalized, contextual reply drafts they can copy-paste to convert leads
2. Every lead is scored, classified, and actionable
3. The product feels solid — errors handled, upgrade paths clear, no broken states

## 7 Workstreams

### WS1: AI Reply Engine (Pro feature)

**Backend:** New endpoint `POST /dashboard/generate-reply`

Request:
```json
{
  "resultId": "uuid",
  "tone": "casual" | "helpful" | "direct",
  "productContext": "optional override"
}
```

Response:
```json
{
  "replies": [
    { "tone": "casual", "text": "..." },
    { "tone": "helpful", "text": "..." },
    { "tone": "direct", "text": "..." }
  ]
}
```

Implementation:
- Load scan_result by ID (includes post title, body quote, subreddit, signals, score)
- Load user profile (product description from monitor context)
- Load monitor keywords/signals for additional context
- Call Claude API (claude-haiku-4-5-20251001) with structured prompt:
  - System: "You are a Reddit reply strategist for SaaS founders. Write replies that are helpful, not salesy. Never start with 'Hey!' or sound like a bot."
  - User: post content + signals detected + product description + tone requested
  - Output: 3 reply variations (casual, helpful, direct), each 2-4 sentences
- Store generated replies in new `generated_reply` table for caching
- Pro gate: free users get 1 blurred preview, upgrade CTA
- Rate limit: 50 replies/day per user (Pro), 3/day (Free preview)

**Frontend:** "Generate AI Reply" button on every opportunity card and lead card
- Click → loading state → 3 tabbed reply options (Casual / Helpful / Direct)
- Each reply has "Copy" button + character count
- Free tier: shows first reply, blurs others with "Upgrade to Pro for unlimited AI replies"

**New DB table (Drizzle schema — matches existing TEXT-based ID pattern):**
```typescript
export const generatedReply = pgTable('generated_reply', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  resultId: text('result_id').notNull().references(() => scanResult.id, { onDelete: 'cascade' }),
  tone: text('tone').notNull(), // 'casual' | 'helpful' | 'direct'
  replyText: text('reply_text').notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**New dependency:** Add `@anthropic-ai/sdk` to backend package.json. Add `ANTHROPIC_API_KEY` to Railway env vars and `.env.example`.

**Cost model:** ~$0.001/reply with Haiku. 100 users * 10 replies/day = $30/mo vs $1,499 revenue.

### WS2: Smarter Reddit Search

**Problem:** Composio has no direct post search. Current scanner fetches 25 "new" posts and filters client-side.

**Fix (modify scanner.ts loop — composio-client.ts already supports sort switching via `browseSubreddit(sub, sort)`):**
- Increase fetch window: 100 posts per subreddit per scan (new + top combined)
- Multi-sort scanning: call `browseSubreddit(sub, 'new')` + `browseSubreddit(sub, 'top')` per subreddit, deduplicate by post ID
- Smarter keyword matching: fuzzy match with word boundaries, not just substring includes
- Weighted scoring: boost posts that match multiple keywords, have higher engagement (upvotes + comments)
- Cache posts per scan cycle to avoid redundant Composio calls

**No breaking changes.** Scanner internals only.

### WS3: Consolidate Pages

**Remove:**
- `CompetitorsPage.tsx`
- `BuyerIntentPage.tsx`

**Upgrade OpportunitiesPage to be the unified intelligence view:**
- Filter tabs: All | Buyer Intent | Competitor Intel | Pain Points | Feature Gaps
- Each tab filters by signal type
- Same powerful filters (time, subreddit, score range, sort)
- Tab counts shown as badges

**New sidebar:**
- Daily Brief (home)
- Opportunities (unified intelligence view)
- Leads
- Monitors
- Evidence Packs
- Settings

6 items instead of 9. Each one real and powerful.

### WS4: Upgrade Funnel

**Touchpoints (all linking to Polar.sh checkout):**
1. Daily Brief: if free tier, show banner "Upgrade to Pro — unlock AI replies, hourly scans, Slack alerts"
2. AI Reply: free users see 1 blurred preview + "Upgrade to unlock"
3. Slack alerts toggle in monitor editor: "Pro feature — Upgrade"
4. Bulk lead operations: "Pro feature — Upgrade"
5. JSON/PDF export: "Pro feature — Upgrade" (existing, keep)
6. Settings page: prominent upgrade card with feature comparison table
7. After 3rd monitor created (free limit): "Upgrade for unlimited monitors"

**Implementation:**
- `UpgradeCTA` component: takes `feature` prop, renders inline upgrade prompt with Polar.sh link
- `useProGate(feature)` hook: reads `me.tier` from `useAuth()` context, returns `{ isPro, gate: ReactNode }` — renders gate or null
- Polar.sh checkout URL includes `?metadata[userId]=xxx` for webhook matching

### WS5: Error States + Session Handling

**Global:**
- `ErrorBoundary` component wrapping all routes — catches render errors, shows "Something went wrong" with retry
- Modify existing `apiFetch` in `src/lib/api.ts`: check for 401 status before throwing, clear auth context, redirect to `/app/login`
- Session check on app mount + every 5 minutes (silent ping to `/api/auth/get-session`)

**Per-page:**
- Replace infinite shimmer with proper loading → error → empty state machine
- `useApiQuery` wrapper around react-query with built-in error/retry UI
- Error state: "Failed to load [resource]. [Retry] button"
- Empty state: contextual message + CTA (e.g., "No leads yet — create a monitor to start scanning")

### WS6: Settings Page (Functional)

**Sections:**
1. **Profile** — edit display name (PUT /dashboard/me)
2. **Reddit Connection** — status + reconnect button (calls getComposioConnectUrl)
3. **Notifications** — email alerts on/off, daily digest on/off (new fields on user table)
4. **Subscription** — current tier, upgrade/manage link, feature comparison
5. **Danger Zone** — delete account (DELETE /dashboard/me, requires confirmation). Must revoke Composio entity connection before cascading DB delete to avoid orphaned external connections.

**New backend endpoints:**
- `PUT /dashboard/me` — update name, notification preferences
- `DELETE /dashboard/me` — delete user + all associated data (cascading)

**New user table columns:**
- `email_alerts_enabled BOOLEAN DEFAULT true`
- `daily_digest_enabled BOOLEAN DEFAULT true`

### WS7: Technical Debt Cleanup

**Backend:**
- Keep `better-auth` and `@polar-sh/better-auth` in dependencies (auth session management may still reference them internally — verify before removing)
- Remove `verification` table from schema if confirmed unused (keep `account` table — may store OAuth provider data)
- Clean `.env.example` — remove GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (keep BETTER_AUTH_SECRET if better-auth is retained)
- Fix process.env mutation in scanner — pass credentials as function args instead

**Frontend:**
- Remove from package.json: `lovable-tagger`, `next-themes`, `react-hook-form`, `@hookform/resolvers`, `recharts`, `react-resizable-panels`, `vaul`, `cmdk`, `embla-carousel-react`, `react-day-picker`, unused Radix packages
- Rename package to `buildradar-insights`, bump to `1.0.0`
- Delete unused shadcn component files (~50 files)
- Deduplicate `formatTimeAgo` into single `src/lib/utils.ts` export
- Fix onboarding: replace fake 3s timer with real scan polling (GET /dashboard/results?monitorId=X, poll every 2s, timeout after 30s)
- Remove CompetitorsPage.tsx and BuyerIntentPage.tsx
- Remove dead API functions or wire them up

## Out of Scope (YAGNI)

- Chrome extension
- Zapier/webhook integration
- Team features
- Weekly market report PDF
- Auto-posting to Reddit
- CSRF tokens (SameSite=Lax sufficient)
- Market snapshot feature
- Direct Reddit API as alternative to Composio (too complex, Composio works)

## Implementation Order

1. WS7 (Cleanup) — clean foundation first
2. WS5 (Error states) — make existing features solid
3. WS3 (Consolidate pages) — simplify before adding
4. WS6 (Settings) — functional settings
5. WS2 (Search) — better data quality
6. WS1 (AI Replies) — the killer feature, built on solid foundation
7. WS4 (Upgrade funnel) — monetize last, after product is strong

## Success Criteria

- Every page loads real data, handles errors, shows empty states
- AI replies generate contextual, personalized, copy-paste-ready responses
- Free → Pro upgrade path is visible at every gated moment
- Sidebar has 6 honest, powerful pages instead of 8 padded ones
- Zero infinite shimmers, zero hardcoded mock data
- Clean dependency tree, proper package identity

# BuildRadar Power Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BuildRadar from a Reddit scanner into the most powerful high-intent lead engine — with AI-powered reply drafts, consolidated intelligence views, upgrade funnels, error handling, and zero technical debt.

**Architecture:** Backend is raw Node `http.createServer` with manual route matching in `src/api/dashboard.ts`. Frontend is React + Vite SPA with `@tanstack/react-query` for data fetching. All new endpoints follow the `handleDashboardRequest` pattern. All new DB tables follow the Drizzle `text('id').primaryKey().$defaultFn(() => crypto.randomUUID())` pattern.

**Tech Stack:** TypeScript, Node HTTP, PostgreSQL + Drizzle ORM, Composio Reddit API, Anthropic SDK (claude-haiku-4-5), React, Tailwind CSS, @tanstack/react-query, framer-motion

**Repos:**
- Backend: `~/reddit-intelligence-agent-mcp` → Railway (api.buildradar.xyz)
- Frontend: `~/buildradar-insights` → Vercel (buildradar.xyz)

---

## Task 1: Backend Cleanup — Remove Dead Dependencies & Fix Env

**Files:**
- Modify: `~/reddit-intelligence-agent-mcp/package.json`
- Modify: `~/reddit-intelligence-agent-mcp/.env.example`
- Modify: `~/reddit-intelligence-agent-mcp/src/db/schema.ts`

- [ ] **Step 1: Check if better-auth is actually imported anywhere**

Run: `cd ~/reddit-intelligence-agent-mcp && grep -r "better-auth" src/ --include="*.ts" -l`
Run: `grep -r "from 'better-auth" src/ --include="*.ts"`

If nothing imports it, it's dead weight. If something does, keep it.

- [ ] **Step 2: Clean .env.example — remove dead vars, add missing ones**

Remove `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (GitHub OAuth removed).
Add `COMPOSIO_API_KEY` (used but never listed).
Add `ANTHROPIC_API_KEY` (needed for WS1).
Keep `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` only if better-auth is still imported.

- [ ] **Step 3: Remove `verification` table from schema if unused**

Run: `grep -r "verification" src/ --include="*.ts"` to confirm no code reads/writes it.
If unused, remove the table definition from `src/db/schema.ts`.

- [ ] **Step 4: Fix process.env mutation in scanner**

In `~/reddit-intelligence-agent-mcp/src/monitor/scanner.ts`, find the block that temporarily sets `process.env.REDDIT_INTEL_*` vars (around lines 258-292). Refactor to pass credentials as function arguments instead of mutating global state.

- [ ] **Step 5: Commit**

```bash
cd ~/reddit-intelligence-agent-mcp
git add -A && git commit -m "chore: clean dead deps, fix env, remove unused schema

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Frontend Cleanup — Remove Lovable Bloat

**Files:**
- Modify: `~/buildradar-insights/package.json`
- Delete: ~37 unused files in `~/buildradar-insights/src/components/ui/`
- Modify: `~/buildradar-insights/src/lib/utils.ts`
- Modify: Multiple pages (deduplicate `formatTimeAgo`)

- [ ] **Step 1: Rename package and bump version**

In `~/buildradar-insights/package.json`:
- Change `"name": "vite_react_shadcn_ts"` → `"name": "buildradar-insights"`
- Change `"version": "0.0.0"` → `"version": "1.0.0"`

- [ ] **Step 2: Remove unused dependencies from package.json**

Remove from `dependencies`:
- `@hookform/resolvers`, `react-hook-form` (no forms use them)
- `recharts` (no charts)
- `react-resizable-panels`, `vaul`, `cmdk`, `embla-carousel-react`, `react-day-picker`, `input-otp` (unused scaffold)
- `next-themes` (not a Next.js app)
- Unused Radix packages: `@radix-ui/react-accordion`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-aspect-ratio`, `@radix-ui/react-calendar` (if exists), `@radix-ui/react-checkbox`, `@radix-ui/react-collapsible`, `@radix-ui/react-context-menu`, `@radix-ui/react-hover-card`, `@radix-ui/react-menubar`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-progress`, `@radix-ui/react-radio-group`, `@radix-ui/react-scroll-area`, `@radix-ui/react-select`, `@radix-ui/react-slider`, `@radix-ui/react-switch`, `@radix-ui/react-tabs`, `@radix-ui/react-toggle`, `@radix-ui/react-toggle-group`

Remove from `devDependencies`:
- `lovable-tagger`

- [ ] **Step 3: Delete unused UI component files**

Delete these files from `~/buildradar-insights/src/components/ui/`:
```
accordion.tsx, alert.tsx, alert-dialog.tsx, aspect-ratio.tsx,
breadcrumb.tsx, calendar.tsx, carousel.tsx, chart.tsx,
checkbox.tsx, collapsible.tsx, context-menu.tsx, drawer.tsx,
dropdown-menu.tsx, form.tsx, hover-card.tsx, input-otp.tsx,
menubar.tsx, navigation-menu.tsx, pagination.tsx, progress.tsx,
radio-group.tsx, resizable.tsx, scroll-area.tsx, select.tsx,
slider.tsx, switch.tsx, table.tsx, tabs.tsx, toggle.tsx, toggle-group.tsx
```

Keep: `avatar.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `command.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `popover.tsx`, `separator.tsx`, `sheet.tsx`, `skeleton.tsx`, `sidebar.tsx`, `sonner.tsx`, `textarea.tsx`, `toast.tsx`, `toaster.tsx`, `tooltip.tsx`, `use-toast.ts`

- [ ] **Step 4: Remove lovable-tagger from vite config**

In `~/buildradar-insights/vite.config.ts`, remove the `lovable-tagger` plugin import and usage if present.

- [ ] **Step 5: Extract `formatTimeAgo` to shared utility**

Add to `~/buildradar-insights/src/lib/utils.ts`:
```ts
export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
```

Then in `DashboardHome.tsx`, `OpportunitiesPage.tsx`, `CompetitorsPage.tsx`, `BuyerIntentPage.tsx`: replace local `formatTimeAgo` definitions with `import { formatTimeAgo } from "@/lib/utils"`.

- [ ] **Step 6: Run build to verify nothing broke**

```bash
cd ~/buildradar-insights && npm run build
```

- [ ] **Step 7: Commit**

```bash
cd ~/buildradar-insights
git add -A && git commit -m "chore: remove Lovable bloat, rename package to buildradar-insights v1.0.0

Remove 30 unused shadcn components, 12 unused npm dependencies,
lovable-tagger plugin. Extract shared formatTimeAgo utility.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Error Boundary + 401 Interceptor + Session Refresh

**Files:**
- Create: `~/buildradar-insights/src/components/ErrorBoundary.tsx`
- Create: `~/buildradar-insights/src/components/ErrorState.tsx`
- Modify: `~/buildradar-insights/src/lib/api.ts`
- Modify: `~/buildradar-insights/src/lib/auth-context.tsx`
- Modify: `~/buildradar-insights/src/App.tsx`

- [ ] **Step 1: Create ErrorBoundary component**

Create `~/buildradar-insights/src/components/ErrorBoundary.tsx`:
```tsx
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8">
          <div className="text-4xl mb-4">Something went wrong</div>
          <p className="text-muted-foreground mb-6 max-w-md">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Create ErrorState component for per-page errors**

Create `~/buildradar-insights/src/components/ErrorState.tsx`:
```tsx
import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = "Failed to load data", onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] text-center p-8">
      <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
      <p className="text-muted-foreground mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-card border border-border rounded-lg hover:bg-accent transition"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add 401 interceptor to apiFetch**

In `~/buildradar-insights/src/lib/api.ts`, modify `apiFetch`:
```ts
async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    if (res.status === 401 && !path.includes("/auth/")) {
      window.location.href = "/app/login";
      throw new ApiError(401, "Session expired");
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || `Request failed (${res.status})`);
  }
  return res.json();
}
```

- [ ] **Step 4: Add periodic session check to AuthProvider**

In `~/buildradar-insights/src/lib/auth-context.tsx`, add a 5-minute session ping:
```ts
useEffect(() => {
  const interval = setInterval(async () => {
    const session = await getSession();
    if (!session && user) {
      setUser(null);
    }
  }, 5 * 60 * 1000);
  return () => clearInterval(interval);
}, [user]);
```

- [ ] **Step 5: Wrap routes with ErrorBoundary in App.tsx**

In `~/buildradar-insights/src/App.tsx`, import `ErrorBoundary` and wrap the `<Routes>` block:
```tsx
<ErrorBoundary>
  <Routes>
    {/* ... existing routes ... */}
  </Routes>
</ErrorBoundary>
```

- [ ] **Step 6: Add error states to DashboardHome**

In `~/buildradar-insights/src/pages/app/DashboardHome.tsx`, import `ErrorState` and add error handling to queries:
```tsx
const { data: resultsData, isLoading: loadingResults, isError: resultsError, refetch: refetchResults } = useQuery({
  queryKey: ["results"],
  queryFn: () => getResults(),
});

// In the render, after loading check:
if (resultsError) return <ErrorState message="Failed to load results" onRetry={() => refetchResults()} />;
```

Do the same for every page that uses `useQuery`: OpportunitiesPage, LeadsPage, MonitorsPage, EvidencePacksPage, SettingsPage.

- [ ] **Step 7: Build and verify**

```bash
cd ~/buildradar-insights && npm run build
```

- [ ] **Step 8: Commit**

```bash
cd ~/buildradar-insights
git add -A && git commit -m "feat: add error boundary, 401 interceptor, session refresh

Global ErrorBoundary catches render errors. Per-page ErrorState
replaces infinite shimmers. 401 responses auto-redirect to login.
Session checked every 5 minutes.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Consolidate Pages — Merge Competitors + Buyer Signals into Opportunities

**Files:**
- Modify: `~/buildradar-insights/src/pages/app/OpportunitiesPage.tsx`
- Delete: `~/buildradar-insights/src/pages/app/CompetitorsPage.tsx`
- Delete: `~/buildradar-insights/src/pages/app/BuyerIntentPage.tsx`
- Modify: `~/buildradar-insights/src/components/dashboard/DashboardLayout.tsx`
- Modify: `~/buildradar-insights/src/App.tsx`

- [ ] **Step 1: Upgrade OpportunitiesPage with signal type tabs**

Rewrite `~/buildradar-insights/src/pages/app/OpportunitiesPage.tsx` to include tabbed signal filtering. Keep the existing filter UI (time range, subreddit, sort) and add a tab bar at the top:

```tsx
const SIGNAL_TABS = [
  { key: "all", label: "All Signals" },
  { key: "buyer_intent", label: "Buyer Intent" },
  { key: "competitor", label: "Competitor Intel" },
  { key: "pain_point", label: "Pain Points" },
  { key: "feature_gap", label: "Feature Gaps" },
  { key: "pricing_objection", label: "Pricing" },
] as const;
```

Each tab filters results by signal type. Show badge counts per tab. Incorporate the urgency badges (Hot/Warm/Cold from BuyerIntentPage) and subreddit breakdown cards (from CompetitorsPage) as inline sections when the relevant tab is active.

- [ ] **Step 2: Remove Competitors and BuyerIntent routes from App.tsx**

Remove these route entries:
```tsx
<Route path="competitors" element={<CompetitorsPage />} />
<Route path="buyer-signals" element={<BuyerIntentPage />} />
```

Remove the imports for `CompetitorsPage` and `BuyerIntentPage`.

- [ ] **Step 3: Delete the page files**

```bash
rm ~/buildradar-insights/src/pages/app/CompetitorsPage.tsx
rm ~/buildradar-insights/src/pages/app/BuyerIntentPage.tsx
```

- [ ] **Step 4: Update sidebar nav items in DashboardLayout**

In `~/buildradar-insights/src/components/dashboard/DashboardLayout.tsx`, update `navItems`:
```ts
const navItems = [
  { label: "Daily Brief",    icon: Inbox,     path: "/app" },
  { label: "Opportunities",  icon: Lightbulb, path: "/app/opportunities" },
  { label: "Leads",          icon: Users,     path: "/app/leads" },
  { label: "Monitors",       icon: Bell,      path: "/app/monitors" },
  { label: "Evidence Packs", icon: Download,  path: "/app/evidence-packs" },
  { label: "Settings",       icon: Settings,  path: "/app/settings" },
];
```

6 items. Each one real.

- [ ] **Step 5: Build and verify**

```bash
cd ~/buildradar-insights && npm run build
```

- [ ] **Step 6: Commit**

```bash
cd ~/buildradar-insights
git add -A && git commit -m "feat: consolidate Competitors + Buyer Signals into Opportunities

Unified intelligence view with signal type tabs: All, Buyer Intent,
Competitor Intel, Pain Points, Feature Gaps, Pricing. Sidebar reduced
from 8 to 6 items. Deleted CompetitorsPage and BuyerIntentPage.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Functional Settings Page

**Files:**
- Modify: `~/reddit-intelligence-agent-mcp/src/api/dashboard.ts`
- Modify: `~/reddit-intelligence-agent-mcp/src/db/schema.ts`
- Modify: `~/buildradar-insights/src/pages/app/SettingsPage.tsx`
- Modify: `~/buildradar-insights/src/lib/api.ts`

- [ ] **Step 1: Add notification columns to user table**

In `~/reddit-intelligence-agent-mcp/src/db/schema.ts`, add to the `user` table:
```ts
emailAlertsEnabled: boolean('email_alerts_enabled').notNull().default(true),
dailyDigestEnabled: boolean('daily_digest_enabled').notNull().default(true),
```

- [ ] **Step 2: Add PUT /dashboard/me endpoint**

In `~/reddit-intelligence-agent-mcp/src/api/dashboard.ts`, add before the 404 fallback:
```ts
// ── PUT /dashboard/me ──
if (url === '/dashboard/me' && req.method === 'PUT') {
  const body = await readBody(req) as {
    name?: string;
    emailAlertsEnabled?: boolean;
    dailyDigestEnabled?: boolean;
  } | null;
  if (!body) {
    json(res, 400, { error: 'Invalid request body' });
    return true;
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.emailAlertsEnabled !== undefined) updates.emailAlertsEnabled = body.emailAlertsEnabled;
  if (body.dailyDigestEnabled !== undefined) updates.dailyDigestEnabled = body.dailyDigestEnabled;

  if (Object.keys(updates).length === 0) {
    json(res, 400, { error: 'No fields to update' });
    return true;
  }

  await db.update(schema.user).set(updates).where(eq(schema.user.id, userId));
  const [updated] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
  json(res, 200, { user: { id: updated.id, name: updated.name, email: updated.email, tier: updated.tier, emailAlertsEnabled: updated.emailAlertsEnabled, dailyDigestEnabled: updated.dailyDigestEnabled } });
  return true;
}
```

- [ ] **Step 3: Add DELETE /dashboard/me endpoint**

In `~/reddit-intelligence-agent-mcp/src/api/dashboard.ts`:
```ts
// ── DELETE /dashboard/me ──
if (url === '/dashboard/me' && req.method === 'DELETE') {
  // Revoke Composio connection if exists
  try {
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    if (u?.composioConnectedAccountId) {
      const { Composio } = await import('@composio/core');
      const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
      await composio.connectedAccounts.delete({ connectedAccountId: u.composioConnectedAccountId }).catch(() => {});
    }
  } catch {}

  // Cascade delete handled by FK constraints
  await db.delete(schema.session).where(eq(schema.session.userId, userId));
  await db.delete(schema.user).where(eq(schema.user.id, userId));

  res.setHeader('Set-Cookie', 'buildradar.session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  json(res, 200, { deleted: true });
  return true;
}
```

- [ ] **Step 4: Add frontend API functions**

In `~/buildradar-insights/src/lib/api.ts`, add:
```ts
export async function updateMe(data: { name?: string; emailAlertsEnabled?: boolean; dailyDigestEnabled?: boolean }) {
  return apiFetch<{ user: DashboardUser }>("/dashboard/me", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteAccount() {
  return apiFetch<{ deleted: boolean }>("/dashboard/me", { method: "DELETE" });
}
```

Update `DashboardUser` interface to include:
```ts
emailAlertsEnabled: boolean;
dailyDigestEnabled: boolean;
```

- [ ] **Step 5: Rewrite SettingsPage with functional sections**

Rewrite `~/buildradar-insights/src/pages/app/SettingsPage.tsx` with 5 sections:

1. **Profile** — editable name field with save button (calls `updateMe`)
2. **Reddit Connection** — status display + "Reconnect" button (calls `getComposioConnectUrl()` and redirects)
3. **Notifications** — toggle switches for email alerts and daily digest (calls `updateMe`)
4. **Subscription** — current tier badge + upgrade card (Polar.sh link) with feature comparison
5. **Danger Zone** — "Delete Account" button with confirmation dialog

Use `useMutation` for saves, `queryClient.invalidateQueries({ queryKey: ["me"] })` on success, toast feedback.

- [ ] **Step 6: Push schema changes**

```bash
cd ~/reddit-intelligence-agent-mcp && npx drizzle-kit push
```

- [ ] **Step 7: Build both and verify**

```bash
cd ~/reddit-intelligence-agent-mcp && npm run build
cd ~/buildradar-insights && npm run build
```

- [ ] **Step 8: Commit both repos**

```bash
cd ~/reddit-intelligence-agent-mcp
git add -A && git commit -m "feat: add PUT/DELETE /dashboard/me endpoints, notification columns

Functional settings: edit name, toggle email alerts/daily digest,
delete account with Composio cleanup.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

cd ~/buildradar-insights
git add -A && git commit -m "feat: functional settings page with profile editing, notifications, account deletion

5 sections: Profile (edit name), Reddit (reconnect), Notifications
(toggle alerts/digest), Subscription (upgrade CTA), Danger Zone
(delete account with confirmation).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Smarter Reddit Search — Multi-Sort + Better Matching

**Files:**
- Modify: `~/reddit-intelligence-agent-mcp/src/monitor/scanner.ts`
- Modify: `~/reddit-intelligence-agent-mcp/src/reddit/composio-client.ts`

- [ ] **Step 1: Increase Composio fetch limit and add multi-sort**

In `~/reddit-intelligence-agent-mcp/src/reddit/composio-client.ts`, update the default limit:
```ts
const { limit = 50, after } = opts;
```

- [ ] **Step 2: Update scanner to fetch both new and top posts**

In `~/reddit-intelligence-agent-mcp/src/monitor/scanner.ts`, find the `scanMonitorComposio` function. Update the subreddit loop to fetch both sorts and deduplicate:

```ts
for (const sub of subreddits) {
  try {
    // Fetch both new and top posts, deduplicate
    const [newPosts, topPosts] = await Promise.all([
      composioClient.browseSubreddit(sub, 'new', { limit: 50 }),
      composioClient.browseSubreddit(sub, 'top', { limit: 50 }),
    ]);

    const seen = new Set<string>();
    for (const post of [...newPosts, ...topPosts]) {
      const id = post.id || post.permalink;
      if (id && !seen.has(id)) {
        seen.add(id);
        allPosts.push(post);
      }
    }
  } catch (err) {
    console.error(`[scanner] Error fetching r/${sub}:`, err);
  }
}
```

- [ ] **Step 3: Add word-boundary keyword matching**

In the scoring/filtering section of scanner.ts, replace simple `includes()` with word-boundary matching:

```ts
function matchesKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}
```

- [ ] **Step 4: Add engagement-weighted scoring boost**

When scoring posts, add a boost for high engagement:
```ts
const engagementBoost = Math.min(
  10,
  Math.floor(((post.ups || 0) + (post.num_comments || 0) * 2) / 10)
);
// Add to lead score
```

- [ ] **Step 5: Build and verify**

```bash
cd ~/reddit-intelligence-agent-mcp && npm run build
```

- [ ] **Step 6: Commit**

```bash
cd ~/reddit-intelligence-agent-mcp
git add -A && git commit -m "feat: smarter search — multi-sort scanning, word-boundary matching, engagement boost

Fetch both new+top posts per subreddit (100 total), deduplicate.
Word-boundary keyword matching replaces substring includes.
Engagement-weighted scoring boosts high-activity posts.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: AI Reply Engine — The Killer Feature

**Files:**
- Modify: `~/reddit-intelligence-agent-mcp/package.json` (add `@anthropic-ai/sdk`)
- Create: `~/reddit-intelligence-agent-mcp/src/api/reply-engine.ts`
- Modify: `~/reddit-intelligence-agent-mcp/src/db/schema.ts` (add `generatedReply` table)
- Modify: `~/reddit-intelligence-agent-mcp/src/api/dashboard.ts` (wire endpoint)
- Modify: `~/buildradar-insights/src/lib/api.ts` (add API function)
- Create: `~/buildradar-insights/src/components/dashboard/AIReplyPanel.tsx`
- Modify: `~/buildradar-insights/src/pages/app/OpportunitiesPage.tsx`
- Modify: `~/buildradar-insights/src/pages/app/LeadsPage.tsx`
- Modify: `~/buildradar-insights/src/pages/app/DashboardHome.tsx`

- [ ] **Step 1: Install Anthropic SDK**

```bash
cd ~/reddit-intelligence-agent-mcp && npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Add generatedReply table to schema**

In `~/reddit-intelligence-agent-mcp/src/db/schema.ts`, add:
```ts
export const generatedReply = pgTable('generated_reply', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  resultId: text('result_id').notNull().references(() => scanResult.id, { onDelete: 'cascade' }),
  tone: text('tone').notNull(),
  replyText: text('reply_text').notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

- [ ] **Step 3: Create the reply engine**

Create `~/reddit-intelligence-agent-mcp/src/api/reply-engine.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a Reddit reply strategist helping SaaS founders engage with potential customers on Reddit. Your replies must:
- Sound like a genuine community member, not a marketer or bot
- Never start with "Hey!" or generic greetings
- Lead with empathy or shared experience, then naturally mention the product
- Be 2-4 sentences maximum
- Never use sales language like "game-changer", "revolutionary", "check out"
- Include a specific detail from their post to show you actually read it
- End with something useful (a tip, resource, or genuine question) — not a pitch`;

interface GenerateReplyInput {
  postTitle: string;
  postQuote: string;
  subreddit: string;
  signals: string[];
  score: number;
  productDescription: string;
  keywords: string[];
}

interface GeneratedReply {
  tone: string;
  text: string;
}

export async function generateReplies(input: GenerateReplyInput): Promise<GeneratedReply[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey });

  const userPrompt = `Generate 3 Reddit reply variations for this post. Each reply should be distinct in tone.

**Post title:** ${input.postTitle}
**Subreddit:** r/${input.subreddit}
**Post excerpt:** "${input.postQuote}"
**Detected signals:** ${input.signals.join(', ')}
**Intent score:** ${input.score}/100

**My product:** ${input.productDescription}
**Keywords I track:** ${input.keywords.join(', ')}

Respond in this exact JSON format:
[
  {"tone": "casual", "text": "reply text here"},
  {"tone": "helpful", "text": "reply text here"},
  {"tone": "direct", "text": "reply text here"}
]

casual = conversational, peer-to-peer, mentions product almost as an afterthought
helpful = leads with genuine advice, weaves product in as one option among others
direct = straightforward value prop, still human and non-salesy`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Failed to parse reply response');

  return JSON.parse(jsonMatch[0]) as GeneratedReply[];
}
```

- [ ] **Step 4: Add POST /dashboard/generate-reply endpoint**

In `~/reddit-intelligence-agent-mcp/src/api/dashboard.ts`, add:
```ts
// ── POST /dashboard/generate-reply ──
if (url === '/dashboard/generate-reply' && req.method === 'POST') {
  const body = await readBody(req) as { resultId?: string; productContext?: string } | null;
  if (!body?.resultId) {
    json(res, 400, { error: 'resultId is required' });
    return true;
  }

  // Check rate limit: count today's generations
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [countRow] = await db.select({ count: sql<number>`count(*)` })
    .from(schema.generatedReply)
    .where(and(
      eq(schema.generatedReply.userId, userId),
      gte(schema.generatedReply.createdAt, today)
    ));
  const dailyCount = Number(countRow?.count || 0);

  // Check user tier
  const [me] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
  const limit = me?.tier === 'pro' ? 50 : 3;
  if (dailyCount >= limit) {
    json(res, 429, {
      error: me?.tier === 'pro'
        ? 'Daily reply limit reached (50/day)'
        : 'Free tier limit reached (3/day). Upgrade to Pro for 50 replies/day.',
      tier: me?.tier,
      limit,
      used: dailyCount,
    });
    return true;
  }

  // Check cache first
  const existing = await db.select().from(schema.generatedReply)
    .where(and(
      eq(schema.generatedReply.userId, userId),
      eq(schema.generatedReply.resultId, body.resultId),
    ));
  if (existing.length > 0) {
    json(res, 200, { replies: existing.map(r => ({ tone: r.tone, text: r.replyText })), cached: true });
    return true;
  }

  // Load result + monitor context
  const [result] = await db.select().from(schema.scanResult)
    .where(eq(schema.scanResult.id, body.resultId));
  if (!result) {
    json(res, 404, { error: 'Result not found' });
    return true;
  }

  const [monitor] = result.monitorId
    ? await db.select().from(schema.monitor).where(eq(schema.monitor.id, result.monitorId))
    : [null];

  const { generateReplies } = await import('./reply-engine.js');
  const replies = await generateReplies({
    postTitle: result.title,
    postQuote: result.quote || '',
    subreddit: result.subreddit,
    signals: (result.signals as string[]) || [],
    score: result.score,
    productDescription: body.productContext || monitor?.name || 'my SaaS product',
    keywords: (monitor?.keywords as string[]) || [],
  });

  // Cache the replies
  for (const reply of replies) {
    await db.insert(schema.generatedReply).values({
      userId,
      resultId: body.resultId,
      tone: reply.tone,
      replyText: reply.text,
      model: 'claude-haiku-4-5-20251001',
    });
  }

  json(res, 200, { replies, cached: false, remaining: limit - dailyCount - 1 });
  return true;
}
```

Note: Import `sql`, `and`, `gte` from drizzle-orm at the top of the file if not already imported.

- [ ] **Step 5: Push schema to DB**

```bash
cd ~/reddit-intelligence-agent-mcp && npx drizzle-kit push
```

- [ ] **Step 6: Build backend and verify**

```bash
cd ~/reddit-intelligence-agent-mcp && npm run build
```

- [ ] **Step 7: Add frontend API function**

In `~/buildradar-insights/src/lib/api.ts`, add:
```ts
export interface AIReply {
  tone: string;
  text: string;
}

export interface GenerateReplyResponse {
  replies: AIReply[];
  cached: boolean;
  remaining?: number;
  error?: string;
  tier?: string;
  limit?: number;
  used?: number;
}

export async function generateReply(resultId: string, productContext?: string): Promise<GenerateReplyResponse> {
  return apiFetch<GenerateReplyResponse>("/dashboard/generate-reply", {
    method: "POST",
    body: JSON.stringify({ resultId, productContext }),
  });
}
```

- [ ] **Step 8: Create AIReplyPanel component**

Create `~/buildradar-insights/src/components/dashboard/AIReplyPanel.tsx`:
```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { generateReply, type AIReply } from "@/lib/api";
import { Sparkles, Copy, Check, Lock } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface AIReplyPanelProps {
  resultId: string;
  isPro: boolean;
}

const TONE_LABELS: Record<string, { label: string; description: string }> = {
  casual: { label: "Casual", description: "Peer-to-peer, mentions product as afterthought" },
  helpful: { label: "Helpful", description: "Leads with advice, weaves product in naturally" },
  direct: { label: "Direct", description: "Clear value prop, still human" },
};

export function AIReplyPanel({ resultId, isPro }: AIReplyPanelProps) {
  const [replies, setReplies] = useState<AIReply[]>([]);
  const [activeTone, setActiveTone] = useState("casual");
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: () => generateReply(resultId),
    onSuccess: (data) => {
      setReplies(data.replies);
      if (data.remaining !== undefined) setRemaining(data.remaining);
    },
    onError: (err: Error & { status?: number }) => {
      if (String(err.message).includes("Free tier limit")) {
        toast.error("Upgrade to Pro for 50 AI replies/day", {
          action: {
            label: "Upgrade",
            onClick: () => window.open("https://buy.polar.sh/polar_cl_UtVSj9xLsKxLpVfMikXELQiorn5CcY4Wiz25X1qTty0", "_blank"),
          },
        });
      } else {
        toast.error(err.message || "Failed to generate replies");
      }
    },
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Reply copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (replies.length === 0) {
    return (
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-lg hover:bg-violet-500/20 transition disabled:opacity-50"
      >
        <Sparkles className="w-4 h-4" />
        {mutation.isPending ? "Generating..." : "AI Reply"}
      </button>
    );
  }

  const activeReply = replies.find(r => r.tone === activeTone) || replies[0];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="mt-3 border border-violet-500/20 rounded-lg overflow-hidden"
      >
        {/* Tone tabs */}
        <div className="flex border-b border-border">
          {replies.map((reply, i) => {
            const isLocked = !isPro && i > 0;
            return (
              <button
                key={reply.tone}
                onClick={() => !isLocked && setActiveTone(reply.tone)}
                className={`flex-1 px-3 py-2 text-xs font-medium transition ${
                  activeTone === reply.tone
                    ? "bg-violet-500/10 text-violet-400 border-b-2 border-violet-400"
                    : isLocked
                    ? "text-muted-foreground/50 cursor-not-allowed"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {isLocked && <Lock className="w-3 h-3 inline mr-1" />}
                {TONE_LABELS[reply.tone]?.label || reply.tone}
              </button>
            );
          })}
        </div>

        {/* Reply content */}
        <div className="p-3">
          {!isPro && activeTone !== replies[0]?.tone ? (
            <div className="text-center py-4">
              <Lock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-2">Upgrade to Pro for all reply tones</p>
              <a
                href="https://buy.polar.sh/polar_cl_UtVSj9xLsKxLpVfMikXELQiorn5CcY4Wiz25X1qTty0"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-violet-400 hover:underline"
              >
                Upgrade to Pro - $14.99/mo
              </a>
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground leading-relaxed">{activeReply.text}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-muted-foreground">
                  {activeReply.text.length} chars
                  {remaining !== null && ` · ${remaining} replies left today`}
                </span>
                <button
                  onClick={() => handleCopy(activeReply.text)}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs bg-violet-500/10 text-violet-400 rounded hover:bg-violet-500/20 transition"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 9: Wire AIReplyPanel into OpportunitiesPage**

In `~/buildradar-insights/src/pages/app/OpportunitiesPage.tsx`, import `AIReplyPanel` and add it to each opportunity card. Replace the old hardcoded reply template section. Also fetch `getMe()` to check tier:

```tsx
import { AIReplyPanel } from "@/components/dashboard/AIReplyPanel";

// In the component:
const { data: meData } = useQuery({ queryKey: ["me"], queryFn: getMe });
const isPro = meData?.tier === "pro";

// In each card, after the signals/score area:
<AIReplyPanel resultId={result.id} isPro={isPro} />
```

- [ ] **Step 10: Wire AIReplyPanel into DashboardHome**

Same pattern — add `AIReplyPanel` to opportunity cards on the Daily Brief page.

- [ ] **Step 11: Fix LeadsPage — remove hardcoded templates, add AI reply button**

In `~/buildradar-insights/src/pages/app/LeadsPage.tsx`:
1. Delete the `REPLY_TEMPLATES` object and `getReplyTemplate` function
2. Replace the `ReplyPopover` with a version that uses `AIReplyPanel` or links to the lead's source result for AI reply generation
3. Since leads don't have a `resultId` directly, add a "View on Reddit" + "Generate Reply" button that links to the Opportunities view filtered for that lead

- [ ] **Step 12: Build frontend and verify**

```bash
cd ~/buildradar-insights && npm run build
```

- [ ] **Step 13: Commit both repos**

```bash
cd ~/reddit-intelligence-agent-mcp
git add -A && git commit -m "feat: AI reply engine — Claude-powered contextual Reddit reply drafts

POST /dashboard/generate-reply generates 3 tone variations (casual,
helpful, direct) using Claude Haiku. Pro: 50/day, Free: 3/day preview.
Results cached in generated_reply table.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

cd ~/buildradar-insights
git add -A && git commit -m "feat: AI reply panel — generate contextual replies on every opportunity

AIReplyPanel component with tone tabs, copy button, Pro gate.
Replaces hardcoded reply templates. Wired into Opportunities,
Daily Brief, and Leads pages.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Upgrade Funnel — Make It Easy to Pay

**Files:**
- Create: `~/buildradar-insights/src/components/dashboard/UpgradeCTA.tsx`
- Create: `~/buildradar-insights/src/hooks/use-pro-gate.tsx`
- Modify: `~/buildradar-insights/src/pages/app/DashboardHome.tsx`
- Modify: `~/buildradar-insights/src/pages/app/SettingsPage.tsx`
- Modify: `~/buildradar-insights/src/pages/app/EvidencePacksPage.tsx`

- [ ] **Step 1: Create UpgradeCTA component**

Create `~/buildradar-insights/src/components/dashboard/UpgradeCTA.tsx`:
```tsx
import { Sparkles } from "lucide-react";

const POLAR_URL = "https://buy.polar.sh/polar_cl_UtVSj9xLsKxLpVfMikXELQiorn5CcY4Wiz25X1qTty0";

const FEATURE_COPY: Record<string, string> = {
  "ai-replies": "Unlock unlimited AI-powered reply drafts",
  "slack-alerts": "Get real-time Slack notifications for new leads",
  "bulk-ops": "Manage leads in bulk with Pro",
  "export": "Export full intelligence packs in JSON and PDF",
  "monitors": "Create unlimited monitors with Pro",
  "digest": "Get daily email digests of new opportunities",
  default: "Unlock all Pro features",
};

interface UpgradeCTAProps {
  feature?: string;
  inline?: boolean;
}

export function UpgradeCTA({ feature = "default", inline = false }: UpgradeCTAProps) {
  const copy = FEATURE_COPY[feature] || FEATURE_COPY.default;

  if (inline) {
    return (
      <a
        href={POLAR_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 transition"
      >
        <Sparkles className="w-3.5 h-3.5" />
        {copy}
      </a>
    );
  }

  return (
    <div className="flex items-center justify-between p-4 bg-violet-500/5 border border-violet-500/20 rounded-xl">
      <div>
        <p className="text-sm font-medium text-foreground">{copy}</p>
        <p className="text-xs text-muted-foreground mt-0.5">$14.99/mo — cancel anytime</p>
      </div>
      <a
        href={POLAR_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="px-4 py-2 text-sm font-medium bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition"
      >
        Upgrade to Pro
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Create useProGate hook**

Create `~/buildradar-insights/src/hooks/use-pro-gate.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api";
import { UpgradeCTA } from "@/components/dashboard/UpgradeCTA";

export function useProGate(feature?: string) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const isPro = me?.tier === "pro";

  return {
    isPro,
    tier: me?.tier || "free",
    gate: isPro ? null : <UpgradeCTA feature={feature} />,
    inlineGate: isPro ? null : <UpgradeCTA feature={feature} inline />,
  };
}
```

- [ ] **Step 3: Add upgrade banner to DashboardHome**

In `~/buildradar-insights/src/pages/app/DashboardHome.tsx`, add at the top of the page content (after the header, before results):
```tsx
const { isPro, gate } = useProGate();
// ...
{!isPro && (
  <div className="mb-6">
    <UpgradeCTA feature="ai-replies" />
  </div>
)}
```

- [ ] **Step 4: Add Pro gates to existing features**

- In `MonitorsPage.tsx`: when user hits 3-monitor limit, show `<UpgradeCTA feature="monitors" />` instead of just a toast
- In `EvidencePacksPage.tsx`: replace the Pro-locked section with `<UpgradeCTA feature="export" />`
- In `LeadsPage.tsx`: gate bulk operations behind `useProGate("bulk-ops")`

- [ ] **Step 5: Add feature comparison to SettingsPage**

In the Subscription section of SettingsPage, add a comparison table:
```tsx
const FEATURES = [
  { name: "Monitors", free: "3", pro: "Unlimited" },
  { name: "Scan interval", free: "3 hours", pro: "1 hour" },
  { name: "AI Reply Drafts", free: "3/day", pro: "50/day" },
  { name: "Slack Alerts", free: "—", pro: "Yes" },
  { name: "Daily Email Digest", free: "—", pro: "Yes" },
  { name: "JSON + PDF Export", free: "—", pro: "Yes" },
  { name: "Bulk Lead Operations", free: "—", pro: "Yes" },
];
```

- [ ] **Step 6: Build and verify**

```bash
cd ~/buildradar-insights && npm run build
```

- [ ] **Step 7: Commit**

```bash
cd ~/buildradar-insights
git add -A && git commit -m "feat: upgrade funnel — Pro gates + CTAs on every gated feature

UpgradeCTA component + useProGate hook. Upgrade prompts on Daily
Brief, monitor limit, bulk operations, exports, AI replies.
Feature comparison table on Settings page.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Fix Onboarding Fake Timer — Real Scan Polling

**Files:**
- Modify: `~/buildradar-insights/src/pages/app/OnboardingPage.tsx`

- [ ] **Step 1: Replace fake setTimeout with real polling**

In `~/buildradar-insights/src/pages/app/OnboardingPage.tsx`, replace the fake 3-second timer:

```tsx
// OLD:
useEffect(() => {
  if (!scanning) return;
  const timer = setTimeout(() => setScanReady(true), 3000);
  return () => clearTimeout(timer);
}, [scanning]);

// NEW:
useEffect(() => {
  if (!scanning || !monitorId) return;
  let attempts = 0;
  const maxAttempts = 15; // 30 seconds total

  const poll = setInterval(async () => {
    attempts++;
    try {
      const data = await getResults();
      const hasResults = data.results.some(r => r.monitorId === monitorId);
      if (hasResults || attempts >= maxAttempts) {
        setScanReady(true);
        clearInterval(poll);
      }
    } catch {
      if (attempts >= maxAttempts) {
        setScanReady(true); // Show button anyway after timeout
        clearInterval(poll);
      }
    }
  }, 2000);

  return () => clearInterval(poll);
}, [scanning, monitorId]);
```

Store `monitorId` from the `createMonitor` response.

- [ ] **Step 2: Build and verify**

```bash
cd ~/buildradar-insights && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd ~/buildradar-insights
git add -A && git commit -m "fix: replace fake onboarding scan timer with real result polling

Polls GET /dashboard/results every 2s for up to 30s, checks for
results matching the new monitor ID. Falls back to showing button
after timeout.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Final Build Verification + Deploy

**Files:** None — verification only

- [ ] **Step 1: Build backend**

```bash
cd ~/reddit-intelligence-agent-mcp && npm run build
```
Expected: Clean compile, no errors.

- [ ] **Step 2: Build frontend**

```bash
cd ~/buildradar-insights && npm run build
```
Expected: Clean compile, no errors.

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd ~/reddit-intelligence-agent-mcp && npx tsc --noEmit
cd ~/buildradar-insights && npx tsc --noEmit
```

- [ ] **Step 4: Git status check — nothing left unstaged**

```bash
cd ~/reddit-intelligence-agent-mcp && git status
cd ~/buildradar-insights && git status
```

- [ ] **Step 5: Push backend to deploy on Railway**

```bash
cd ~/reddit-intelligence-agent-mcp && git push origin main
```

- [ ] **Step 6: Push frontend to deploy on Vercel**

```bash
cd ~/buildradar-insights && git push origin main
```

- [ ] **Step 7: Set ANTHROPIC_API_KEY on Railway**

User must manually add `ANTHROPIC_API_KEY` environment variable on Railway dashboard for the backend service.

- [ ] **Step 8: Run drizzle-kit push on Railway**

Either via Railway CLI or by ensuring the schema push happens on deploy. May need to SSH/exec into the Railway container:
```bash
npx drizzle-kit push
```

---

## Environment Variables Needed

Before deploying Task 7 (AI Replies), add to Railway:
- `ANTHROPIC_API_KEY` — get from console.anthropic.com

## Summary of Changes

| Workstream | Backend Changes | Frontend Changes |
|---|---|---|
| WS7 Cleanup | Remove dead deps, fix env, fix scanner | Remove 30 UI files, 12 deps, rename pkg |
| WS5 Errors | — | ErrorBoundary, ErrorState, 401 interceptor, session refresh |
| WS3 Consolidate | — | Delete 2 pages, upgrade Opportunities with tabs |
| WS6 Settings | PUT/DELETE /dashboard/me, notification columns | Functional settings with 5 sections |
| WS2 Search | Multi-sort scan, word-boundary match, engagement boost | — |
| WS1 AI Replies | Reply engine + endpoint + generated_reply table | AIReplyPanel component, wire to 3 pages |
| WS4 Upgrade | — | UpgradeCTA, useProGate, gates on all Pro features |
| Onboarding | — | Real scan polling replacing fake timer |

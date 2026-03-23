/**
 * Monitor Scanner — runs each user's active monitors using their Reddit credentials
 *
 * For each active monitor:
 *   1. Decrypt the user's Reddit credentials
 *   2. Create a RedditClient with those credentials
 *   3. Search configured subreddits for configured keywords/signals
 *   4. Score results, store in scan_result table
 *   5. Extract leads, store in lead table
 *   6. Send alerts (email or Slack)
 */

import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { decrypt } from '../db/crypto.js';
import { RedditAuth } from '../core/auth.js';
import { RedditClient } from '../reddit/client.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { IntelCache } from '../core/cache.js';
import {
  matchPatterns,
  hasCategory,
  signalSummary,
  scoreLeadPost,
  type PatternCategory,
} from '../intelligence/index.js';
import type { RedditPost } from '../types/index.js';
import { generateDossier } from '../intelligence/dossier.js';
import { sendAlert, type AlertPayload } from './alerts.js';
import { ComposioRedditClient } from '../reddit/composio-client.js';
import { getComposio, checkRedditConnection } from '../core/composio-auth.js';

const PRO_SCAN_INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 hour for pro users
const FREE_SCAN_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours for free users

interface ScanStats {
  monitorsScanned: number;
  resultsFound: number;
  leadsFound: number;
  errors: number;
}

/**
 * Generate a contextual suggested reply based on detected signals and post content.
 */
function generateSuggestedReply(
  result: { title: string; quote?: string; signals: string[] },
  monitorName: string,
): string {
  const primarySignal = result.signals[0] || 'pain_point';
  const context = result.quote || result.title;
  // Truncate context to first sentence or 100 chars
  const shortContext = context.split(/[.!?]/)[0].slice(0, 100);

  const templates: Record<string, string> = {
    pain_point: `I feel your pain with ${shortContext}. We built ${monitorName} to solve exactly this — would love to show you how it works if you're interested!`,
    buyer_intent: `Great question! I'm building ${monitorName} which does exactly this. Happy to give you a walkthrough — what's your main use case?`,
    switching: `A lot of people are making that switch lately. ${monitorName} might be worth checking out — we focused on ${shortContext.toLowerCase().includes('price') ? 'keeping it affordable' : 'making it simple'}. Happy to share more!`,
    feature_request: `That's a great feature idea! We actually built something similar in ${monitorName}. Would love your feedback on our approach.`,
    pricing_objection: `Totally get the pricing concern. We built ${monitorName} to be accessible — happy to extend a free trial so you can see the value first.`,
    workaround: `Nice workaround! If you want to automate that, ${monitorName} handles this out of the box. Might save you some time — want to check it out?`,
  };

  return templates[primarySignal] || templates.pain_point;
}

/**
 * Generate and store a dossier for a high-scoring scan result.
 * Returns the dossier data if generated (for use as suggestedReply), or null.
 */
async function tryGenerateDossier(
  r: {
    title: string;
    quote?: string;
    author: string;
    subreddit: string;
    redditUrl: string;
    upvotes: number;
    comments: number;
    signals: string[];
    leadScore: number;
    createdUtc?: number;
  },
  userId: string,
  monitorName: string,
  db: ReturnType<typeof getDb>,
): Promise<{ draftReply: string } | null> {
  if (r.leadScore < 40) return null;

  try {
    const dossierData = generateDossier({
      post: {
        id: r.redditUrl.split('/').pop() || '',
        title: r.title,
        selftext: r.quote || '',
        author: r.author,
        subreddit: r.subreddit,
        subreddit_name_prefixed: `r/${r.subreddit}`,
        score: r.upvotes,
        num_comments: r.comments,
        created_utc: r.createdUtc ?? Date.now() / 1000 - 3600,
        permalink: r.redditUrl.replace('https://reddit.com', ''),
        url: r.redditUrl,
        is_self: true,
        over_18: false,
        stickied: false,
        locked: false,
        is_video: false,
        link_flair_text: undefined,
        author_flair_text: undefined,
        ups: r.upvotes,
        downs: 0,
        upvote_ratio: 0.9,
      },
      signals: r.signals,
      patternWeights: Object.fromEntries(r.signals.map(s => [s, 3])),
      userHistory: null,
      productDescription: monitorName,
    });

    if (dossierData.conversionScore >= 40) {
      // Strip string-typed date fields that don't match the DB timestamp columns
      const { repliedAt: _r, convertedAt: _c, ...dossierValues } = dossierData as Record<string, unknown>;

      await db
        .insert(schema.leadDossier)
        .values({
          userId,
          ...dossierValues,
        } as typeof schema.leadDossier.$inferInsert)
        .onConflictDoNothing();

      return { draftReply: dossierData.draftReply };
    }
  } catch (err) {
    console.error(`[scanner] Dossier generation failed for "${r.title}":`, err);
  }

  return null;
}

/**
 * Run a full scan cycle across all active monitors
 */
export async function runScanCycle(): Promise<ScanStats> {
  const db = getDb();
  const stats: ScanStats = { monitorsScanned: 0, resultsFound: 0, leadsFound: 0, errors: 0 };

  // Get all active monitors
  const allActiveMonitors = await db
    .select()
    .from(schema.monitor)
    .where(eq(schema.monitor.active, true));

  // Look up user tiers so we can apply per-tier staleness thresholds
  const userIds = [...new Set(allActiveMonitors.map(m => m.userId))];
  const userTiers = new Map<string, string>();
  for (const uid of userIds) {
    const [u] = await db.select({ tier: schema.user.tier }).from(schema.user).where(eq(schema.user.id, uid));
    if (u) userTiers.set(uid, u.tier);
  }

  // Filter monitors that are stale based on their user's tier
  const now = Date.now();
  const monitors = allActiveMonitors.filter(m => {
    if (!m.lastScannedAt) return true; // never scanned
    const tier = userTiers.get(m.userId) ?? 'free';
    const interval = tier === 'pro' ? PRO_SCAN_INTERVAL_MS : FREE_SCAN_INTERVAL_MS;
    return m.lastScannedAt.getTime() < now - interval;
  });

  console.error(`[scanner] Found ${monitors.length} monitors to scan`);

  // Group monitors by userId so we create one client per user
  const byUser = new Map<string, typeof monitors>();
  for (const mon of monitors) {
    const arr = byUser.get(mon.userId) ?? [];
    arr.push(mon);
    byUser.set(mon.userId, arr);
  }

  for (const [userId, userMonitors] of byUser) {
    try {
      await scanUserMonitors(userId, userMonitors, stats);
    } catch (err) {
      console.error(`[scanner] Error scanning user ${userId}:`, err);
      stats.errors++;
    }
  }

  console.error(`[scanner] Cycle complete: ${stats.monitorsScanned} monitors, ${stats.resultsFound} results, ${stats.leadsFound} leads, ${stats.errors} errors`);
  return stats;
}

async function scanUserMonitors(
  userId: string,
  monitors: Array<typeof schema.monitor.$inferSelect>,
  stats: ScanStats,
): Promise<void> {
  const db = getDb();

  // Try Composio first (preferred — no Reddit app approval needed)
  if (process.env.COMPOSIO_API_KEY) {
    try {
      const { connected } = await checkRedditConnection(userId);
      if (connected) {
        const composioClient = new ComposioRedditClient(getComposio(), userId);
        for (const monitor of monitors) {
          try {
            await scanMonitorComposio(userId, monitor, composioClient, stats);
          } catch (err) {
            console.error(`[scanner] Error scanning monitor ${monitor.id} via Composio:`, err);
            stats.errors++;
          }
        }
        return; // Done — used Composio, don't fall through to legacy
      }
    } catch (err) {
      console.error(`[scanner] Composio check failed for user ${userId}, falling back to direct:`, err);
    }
  }

  // Get user's Reddit credentials
  const creds = await db
    .select()
    .from(schema.redditCredentials)
    .where(eq(schema.redditCredentials.userId, userId))
    .limit(1);

  if (creds.length === 0) {
    console.error(`[scanner] User ${userId} has no Reddit credentials, skipping`);
    return;
  }

  const cred = creds[0];

  // Create a RedditAuth with decrypted credentials
  const auth = new RedditAuth();
  // Set credentials via env-like injection for this scan
  const origEnv = {
    REDDIT_INTEL_CLIENT_ID: process.env.REDDIT_INTEL_CLIENT_ID,
    REDDIT_INTEL_CLIENT_SECRET: process.env.REDDIT_INTEL_CLIENT_SECRET,
    REDDIT_INTEL_USERNAME: process.env.REDDIT_INTEL_USERNAME,
    REDDIT_INTEL_PASSWORD: process.env.REDDIT_INTEL_PASSWORD,
  };

  try {
    // Temporarily set user's credentials
    process.env.REDDIT_INTEL_CLIENT_ID = decrypt(cred.clientId);
    process.env.REDDIT_INTEL_CLIENT_SECRET = decrypt(cred.clientSecret);
    if (cred.username) process.env.REDDIT_INTEL_USERNAME = decrypt(cred.username);
    if (cred.password) process.env.REDDIT_INTEL_PASSWORD = decrypt(cred.password);

    await auth.initialize();

    const cache = new IntelCache({ defaultTTL: 5 * 60_000, maxSizeBytes: 10 * 1024 * 1024 });
    const limiter = new RateLimiter({ limit: auth.getRateLimit(), windowMs: 60_000, label: `User ${userId}` });
    const reddit = new RedditClient({ auth, rateLimiter: limiter, cache });

    for (const monitor of monitors) {
      try {
        await scanMonitor(userId, monitor, reddit, stats);
      } catch (err) {
        console.error(`[scanner] Error scanning monitor ${monitor.id}:`, err);
        stats.errors++;
      }
    }
  } finally {
    // Restore original env
    for (const [key, val] of Object.entries(origEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
}

async function scanMonitor(
  userId: string,
  monitor: typeof schema.monitor.$inferSelect,
  reddit: RedditClient,
  stats: ScanStats,
): Promise<void> {
  const db = getDb();
  const subreddits = monitor.subreddits as string[];
  const keywords = monitor.keywords as string[];
  const signalTypes = monitor.signalTypes as string[];

  console.error(`[scanner] Scanning monitor "${monitor.name}" (${subreddits.length} subs, ${keywords.length} keywords)`);

  // Gather posts from configured subreddits
  const allPosts: RedditPost[] = [];

  for (const sub of subreddits) {
    try {
      // Search with keywords if provided, otherwise browse new
      if (keywords.length > 0) {
        for (const kw of keywords) {
          const res = await reddit.search(kw, {
            subreddit: sub,
            sort: 'new',
            time: 'day',
            limit: 25,
          });
          allPosts.push(...res.data.children.map(c => c.data));
        }
      } else {
        const res = await reddit.browseSubreddit(sub, 'new', { limit: 50 });
        allPosts.push(...res.data.children.map(c => c.data));
      }
    } catch (err) {
      console.error(`[scanner] Error fetching r/${sub}:`, err);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const posts = allPosts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Filter by signal types and score
  const results: Array<{
    title: string;
    subreddit: string;
    score: number;
    signals: string[];
    quote: string;
    redditUrl: string;
    upvotes: number;
    comments: number;
    author: string;
    leadScore: number;
    createdUtc: number;
  }> = [];

  for (const post of posts) {
    const text = `${post.title} ${post.selftext ?? ''}`;
    const matches = matchPatterns(text);

    if (matches.length === 0) continue;

    // Check if any matched signal type is in the monitor's config
    const matchedCategories = matches.map(m => m.category);
    const relevant = signalTypes.some(st => {
      if (st === 'pain_point') return hasCategory(matches, 'pain') || hasCategory(matches, 'frustration');
      if (st === 'buyer_intent') return hasCategory(matches, 'buyer_intent');
      if (st === 'workaround') return hasCategory(matches, 'workaround');
      if (st === 'switching') return hasCategory(matches, 'switching');
      if (st === 'feature_request') return hasCategory(matches, 'feature_request');
      if (st === 'pricing_objection') return hasCategory(matches, 'pricing_objection');
      return matchedCategories.includes(st as PatternCategory);
    });

    if (!relevant) continue;

    const leadScore = scoreLeadPost(post);
    const signals = signalSummary(matches);

    // Score: use lead score total as the primary metric (0-100)
    const totalScore = Math.max(leadScore.total, matches.reduce((sum, m) => sum + m.weight, 0) * 10);

    results.push({
      title: post.title,
      subreddit: post.subreddit,
      score: Math.min(totalScore, 100),
      signals,
      quote: (post.selftext ?? '').slice(0, 500),
      redditUrl: `https://reddit.com${post.permalink}`,
      upvotes: post.score,
      comments: post.num_comments,
      author: post.author,
      leadScore: leadScore.total,
      createdUtc: post.created_utc,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Store top results
  const topResults = results.slice(0, 50);

  for (const r of topResults) {
    // Try to generate a dossier for high-scoring results; use its draft reply if available
    const dossier = await tryGenerateDossier(r, userId, monitor.name, db);
    const suggestedReply = dossier?.draftReply ?? generateSuggestedReply(r, monitor.name);

    await db.insert(schema.scanResult).values({
      monitorId: monitor.id,
      userId,
      score: r.score,
      title: r.title,
      subreddit: r.subreddit,
      signals: r.signals,
      quote: r.quote,
      suggestedReply,
      redditUrl: r.redditUrl,
      upvotes: r.upvotes,
      comments: r.comments,
      data: r as unknown as Record<string, unknown>,
    });
    stats.resultsFound++;
  }

  // Extract and upsert leads (users with high intent)
  const highIntentResults = results.filter(r => r.leadScore >= 40);
  for (const r of highIntentResults) {
    if (r.author === '[deleted]' || r.author === 'AutoModerator') continue;

    const existingLeads = await db
      .select()
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.userId, userId),
          eq(schema.lead.redditUsername, r.author),
        ),
      );

    if (existingLeads.length > 0) {
      // Update existing lead
      await db
        .update(schema.lead)
        .set({
          signalCount: existingLeads[0].signalCount + 1,
          lastActive: new Date(),
        })
        .where(eq(schema.lead.id, existingLeads[0].id));
    } else {
      await db.insert(schema.lead).values({
        userId,
        redditUsername: r.author,
        signalCount: 1,
        status: 'new',
        subreddits: [r.subreddit],
      });
      stats.leadsFound++;
    }
  }

  // Update monitor lastScannedAt
  await db
    .update(schema.monitor)
    .set({ lastScannedAt: new Date() })
    .where(eq(schema.monitor.id, monitor.id));

  stats.monitorsScanned++;

  // Send alerts if results found
  if (topResults.length > 0) {
    const [user] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    if (user) {
      const payload: AlertPayload = {
        monitorName: monitor.name,
        resultCount: topResults.length,
        topResults: topResults.slice(0, 5).map(r => ({
          title: r.title,
          subreddit: r.subreddit,
          score: r.score,
          url: r.redditUrl,
          signals: r.signals,
        })),
        leadCount: highIntentResults.length,
        dashboardUrl: 'https://buildradar.xyz/app/results',
      };

      try {
        await sendAlert(monitor, user, payload);
      } catch (err) {
        console.error(`[scanner] Alert failed for monitor ${monitor.id}:`, err);
      }
    }
  }

  console.error(`[scanner] Monitor "${monitor.name}": ${topResults.length} results, ${highIntentResults.length} leads`);
}

/**
 * Scan a single monitor using ComposioRedditClient.
 * Same logic as scanMonitor() but works with ComposioRedditClient
 * which returns RedditPost[] directly (no Listing wrapper).
 */
async function scanMonitorComposio(
  userId: string,
  monitor: typeof schema.monitor.$inferSelect,
  composio: ComposioRedditClient,
  stats: ScanStats,
): Promise<void> {
  const db = getDb();
  const subreddits = monitor.subreddits as string[];
  const keywords = monitor.keywords as string[];
  const signalTypes = monitor.signalTypes as string[];

  console.error(`[scanner] Scanning monitor "${monitor.name}" via Composio (${subreddits.length} subs, ${keywords.length} keywords)`);

  // Gather posts from configured subreddits
  const allPosts: RedditPost[] = [];

  for (const sub of subreddits) {
    try {
      if (keywords.length > 0) {
        for (const kw of keywords) {
          // Scope search to this subreddit using Reddit's search syntax
          const posts = await composio.search(`subreddit:${sub} ${kw}`, {
            sort: 'new',
            time: 'day',
            limit: 25,
          });
          allPosts.push(...posts);
        }
      } else {
        const posts = await composio.browseSubreddit(sub, 'new', { limit: 50 });
        allPosts.push(...posts);
      }
    } catch (err) {
      console.error(`[scanner] Error fetching r/${sub} via Composio:`, err);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const posts = allPosts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Filter by signal types and score
  const results: Array<{
    title: string;
    subreddit: string;
    score: number;
    signals: string[];
    quote: string;
    redditUrl: string;
    upvotes: number;
    comments: number;
    author: string;
    leadScore: number;
    createdUtc: number;
  }> = [];

  for (const post of posts) {
    const text = `${post.title} ${post.selftext ?? ''}`;
    const matches = matchPatterns(text);

    if (matches.length === 0) continue;

    const matchedCategories = matches.map(m => m.category);
    const relevant = signalTypes.some(st => {
      if (st === 'pain_point') return hasCategory(matches, 'pain') || hasCategory(matches, 'frustration');
      if (st === 'buyer_intent') return hasCategory(matches, 'buyer_intent');
      if (st === 'workaround') return hasCategory(matches, 'workaround');
      if (st === 'switching') return hasCategory(matches, 'switching');
      if (st === 'feature_request') return hasCategory(matches, 'feature_request');
      if (st === 'pricing_objection') return hasCategory(matches, 'pricing_objection');
      return matchedCategories.includes(st as PatternCategory);
    });

    if (!relevant) continue;

    const leadScore = scoreLeadPost(post);
    const signals = signalSummary(matches);
    const totalScore = Math.max(leadScore.total, matches.reduce((sum, m) => sum + m.weight, 0) * 10);

    results.push({
      title: post.title,
      subreddit: post.subreddit,
      score: Math.min(totalScore, 100),
      signals,
      quote: (post.selftext ?? '').slice(0, 500),
      redditUrl: `https://reddit.com${post.permalink}`,
      upvotes: post.score,
      comments: post.num_comments,
      author: post.author,
      leadScore: leadScore.total,
      createdUtc: post.created_utc,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Store top results
  const topResults = results.slice(0, 50);

  for (const r of topResults) {
    // Try to generate a dossier for high-scoring results; use its draft reply if available
    const dossier = await tryGenerateDossier(r, userId, monitor.name, db);
    const suggestedReply = dossier?.draftReply ?? generateSuggestedReply(r, monitor.name);

    await db.insert(schema.scanResult).values({
      monitorId: monitor.id,
      userId,
      score: r.score,
      title: r.title,
      subreddit: r.subreddit,
      signals: r.signals,
      quote: r.quote,
      suggestedReply,
      redditUrl: r.redditUrl,
      upvotes: r.upvotes,
      comments: r.comments,
      data: r as unknown as Record<string, unknown>,
    });
    stats.resultsFound++;
  }

  // Extract and upsert leads (users with high intent)
  const highIntentResults = results.filter(r => r.leadScore >= 40);
  for (const r of highIntentResults) {
    if (r.author === '[deleted]' || r.author === 'AutoModerator') continue;

    const existingLeads = await db
      .select()
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.userId, userId),
          eq(schema.lead.redditUsername, r.author),
        ),
      );

    if (existingLeads.length > 0) {
      await db
        .update(schema.lead)
        .set({
          signalCount: existingLeads[0].signalCount + 1,
          lastActive: new Date(),
        })
        .where(eq(schema.lead.id, existingLeads[0].id));
    } else {
      await db.insert(schema.lead).values({
        userId,
        redditUsername: r.author,
        signalCount: 1,
        status: 'new',
        subreddits: [r.subreddit],
      });
      stats.leadsFound++;
    }
  }

  // Update monitor lastScannedAt
  await db
    .update(schema.monitor)
    .set({ lastScannedAt: new Date() })
    .where(eq(schema.monitor.id, monitor.id));

  stats.monitorsScanned++;

  // Send alerts if results found
  if (topResults.length > 0) {
    const [user] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    if (user) {
      const payload: AlertPayload = {
        monitorName: monitor.name,
        resultCount: topResults.length,
        topResults: topResults.slice(0, 5).map(r => ({
          title: r.title,
          subreddit: r.subreddit,
          score: r.score,
          url: r.redditUrl,
          signals: r.signals,
        })),
        leadCount: highIntentResults.length,
        dashboardUrl: 'https://buildradar.xyz/app/results',
      };

      try {
        await sendAlert(monitor, user, payload);
      } catch (err) {
        console.error(`[scanner] Alert failed for monitor ${monitor.id}:`, err);
      }
    }
  }

  console.error(`[scanner] Monitor "${monitor.name}" (Composio): ${topResults.length} results, ${highIntentResults.length} leads`);
}

/**
 * Factory: get the best available Reddit client for a user.
 * Tries Composio first, falls back to direct RedditClient.
 * Exported for testing.
 */
export async function getClientForUser(
  userId: string,
): Promise<{ type: 'composio'; client: ComposioRedditClient } | { type: 'direct'; client: RedditClient } | null> {
  // Try Composio first
  if (process.env.COMPOSIO_API_KEY) {
    try {
      const { connected } = await checkRedditConnection(userId);
      if (connected) {
        return { type: 'composio', client: new ComposioRedditClient(getComposio(), userId) };
      }
    } catch {
      // Fall through to direct
    }
  }

  // Try direct Reddit credentials
  const db = getDb();
  const creds = await db
    .select()
    .from(schema.redditCredentials)
    .where(eq(schema.redditCredentials.userId, userId))
    .limit(1);

  if (creds.length === 0) return null;

  const cred = creds[0];
  const auth = new RedditAuth();
  const origEnv = {
    REDDIT_INTEL_CLIENT_ID: process.env.REDDIT_INTEL_CLIENT_ID,
    REDDIT_INTEL_CLIENT_SECRET: process.env.REDDIT_INTEL_CLIENT_SECRET,
    REDDIT_INTEL_USERNAME: process.env.REDDIT_INTEL_USERNAME,
    REDDIT_INTEL_PASSWORD: process.env.REDDIT_INTEL_PASSWORD,
  };

  try {
    process.env.REDDIT_INTEL_CLIENT_ID = decrypt(cred.clientId);
    process.env.REDDIT_INTEL_CLIENT_SECRET = decrypt(cred.clientSecret);
    if (cred.username) process.env.REDDIT_INTEL_USERNAME = decrypt(cred.username);
    if (cred.password) process.env.REDDIT_INTEL_PASSWORD = decrypt(cred.password);

    await auth.initialize();
    const cache = new IntelCache({ defaultTTL: 5 * 60_000, maxSizeBytes: 10 * 1024 * 1024 });
    const limiter = new RateLimiter({ limit: auth.getRateLimit(), windowMs: 60_000, label: `User ${userId}` });
    return { type: 'direct', client: new RedditClient({ auth, rateLimiter: limiter, cache }) };
  } finally {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
}

/**
 * Run a scan for a single monitor by ID.
 * Used for on-demand "Scan Now" and post-onboarding first scan.
 */
export async function runSingleMonitorScan(monitorId: string, userId: string): Promise<ScanStats> {
  const db = getDb();
  const stats: ScanStats = { monitorsScanned: 0, resultsFound: 0, leadsFound: 0, errors: 0 };

  const [monitor] = await db
    .select()
    .from(schema.monitor)
    .where(and(eq(schema.monitor.id, monitorId), eq(schema.monitor.userId, userId)));

  if (!monitor) {
    console.error(`[scanner] Monitor ${monitorId} not found for user ${userId}`);
    return stats;
  }

  try {
    await scanUserMonitors(userId, [monitor], stats);
  } catch (err) {
    console.error(`[scanner] Single-monitor scan failed for ${monitorId}:`, err);
    stats.errors++;
  }

  return stats;
}

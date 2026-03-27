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
import { DirectRedditClient, ComposioTokenProvider, PublicRedditClient } from '../reddit/direct-reddit-client.js';
import { getComposio, checkRedditConnection } from '../core/composio-auth.js';

const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'for', 'and', 'or', 'but', 'not', 'with', 'this', 'that', 'has', 'have', 'been', 'its', 'my', 'your', 'our', 'do', 'does', 'to', 'of', 'in', 'on', 'at', 'by', 'it', 'i', 'me', 'we', 'they', 'so', 'if', 'can', 'how', 'what', 'why', 'who', 'all', 'every', 'out', 'up', 'about', 'their', 'keep', 'cant', "can't", 'any', 'good', 'best', 'need', 'help', 'looking', 'just', 'like', 'also', 'get', 'got', 'use', 'using', 'make', 'want', 'know', 'thing', 'things', 'way', 'really', 'much', 'many', 'some', 'still', 'even', 'could', 'would', 'should', 'will']);

/**
 * Extract significant words from a keyword phrase, removing stop words.
 */
function extractSignificant(phrase: string): string[] {
  return phrase.toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Intent modifiers — combined with topic keywords to pull posts
 * where someone is actively looking for a solution, not just discussing a topic.
 */
const INTENT_MODIFIERS = [
  'looking for', 'recommend', 'alternative to', 'need a',
  'best tool', 'best software', 'anyone use', 'what do you use',
  'switching from', 'replacement for', 'how do you handle',
];

/**
 * Convert user keywords into intent-focused Reddit search queries.
 * Combines topic terms with intent modifiers so results are people
 * actively seeking solutions, not general discussion.
 */
function buildSearchQueries(keywords: string[]): string[] {
  const queries: string[] = [];

  // Extract core topic terms from all keywords
  const topicTerms = new Set<string>();
  for (const kw of keywords) {
    const significant = extractSignificant(kw);
    // Take the 1-2 most distinctive words (longest = most specific)
    const sorted = significant.sort((a, b) => b.length - a.length);
    for (const w of sorted.slice(0, 2)) {
      if (w.length >= 4) topicTerms.add(w);
    }
  }

  const topics = [...topicTerms].slice(0, 8); // cap to avoid query explosion

  // Strategy 1: Topic + intent modifier (highest quality)
  // "churn looking for tool", "retention recommend", etc.
  for (const topic of topics.slice(0, 5)) {
    for (const intent of INTENT_MODIFIERS.slice(0, 4)) {
      queries.push(`${topic} ${intent}`);
    }
  }

  // Strategy 2: Direct competitor/brand searches (pass-through keywords that look like brand names)
  for (const kw of keywords) {
    const trimmed = kw.trim();
    // Brand names: single word, starts with uppercase, or known competitor patterns
    if (trimmed.split(/\s+/).length === 1 && trimmed.length >= 4) {
      queries.push(`${trimmed} alternative`);
      queries.push(trimmed);
    }
  }

  // Strategy 3: Original keyword phrases (top 3 only, as fallback)
  for (const kw of keywords.slice(0, 3)) {
    const significant = extractSignificant(kw);
    if (significant.length >= 2) {
      queries.push(significant.slice(0, 3).join(' '));
    }
  }

  // Deduplicate
  return [...new Set(queries)];
}

/**
 * Keyword matching against post text.
 * Requires words to appear in the SAME SENTENCE (proximity check)
 * to avoid false matches from unrelated co-occurrences.
 * Single words only match if they're distinctive brand/product names.
 */
function matchesKeyword(text: string, keyword: string): boolean {
  const lower = text.toLowerCase();
  const significant = extractSignificant(keyword);

  if (significant.length === 0) return lower.includes(keyword.toLowerCase().trim());

  // Single word: only match distinctive terms (brand names, 6+ chars, not generic)
  if (significant.length === 1) {
    return significant[0].length >= 6 && lower.includes(significant[0]);
  }

  // Multi-word: require 2+ significant words in the SAME sentence
  const sentences = lower.split(/[.!?\n]+/);
  for (const sentence of sentences) {
    const matched = significant.filter(w => sentence.includes(w));
    if (matched.length >= 2) return true;
  }

  return false;
}

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
  if (r.leadScore < 55) return null;

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

  // Try Direct Reddit API via Composio OAuth token (preferred — real search)
  if (process.env.COMPOSIO_API_KEY) {
    try {
      const [usr] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
      const connAccountId = usr?.composioConnectedAccountId;
      const entityId = usr?.composioEntityId;

      if (connAccountId && entityId) {
        // Check connection status
        let connected = false;
        try {
          const composio = getComposio();
          const account = await composio.connectedAccounts.get(connAccountId);
          connected = account?.status === 'ACTIVE';
          if (!connected) {
            console.warn(`[scanner] Composio account ${connAccountId} status: ${account?.status ?? 'unknown'} (not ACTIVE)`);
          }
        } catch (connErr) {
          console.warn(`[scanner] connectedAccounts.get(${connAccountId}) failed:`, connErr instanceof Error ? connErr.message : connErr);
          const result = await checkRedditConnection(entityId);
          connected = result.connected;
        }

        if (connected) {
          // Use DirectRedditClient with the OAuth token from Composio
          const tokenProvider = new ComposioTokenProvider(getComposio(), connAccountId);
          const directClient = new DirectRedditClient(tokenProvider);
          let oauthWorked = false;
          let authFailed = false;
          for (const monitor of monitors) {
            try {
              const before = stats.resultsFound;
              await scanMonitorDirect(userId, monitor, directClient, stats);
              if (stats.resultsFound > before) oauthWorked = true;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('token is invalid') || errMsg.includes('No access_token') || errMsg.includes('Blocked')) {
                console.error(`[scanner] AUTH FAILURE for user ${userId} monitor ${monitor.id}: ${errMsg}`);
                authFailed = true;
                break; // Don't waste time on other monitors with a broken token
              }
              console.error(`[scanner] Error scanning monitor ${monitor.id} via Direct API:`, err);
              stats.errors++;
            }
          }
          if (oauthWorked) return;
          if (authFailed) {
            console.error(`[scanner] Composio OAuth token invalid for user ${userId}, falling back to public API`);
          } else {
            // 0 results is legitimate — subreddits may just not have matching posts. Don't fallback.
            console.log(`[scanner] Composio OAuth scan completed for user ${userId} — 0 matching results (not an error)`);
            return;
          }
        }
      }
    } catch (err) {
      console.error(`[scanner] Direct API check failed for user ${userId}, falling back to legacy:`, err);
    }
  }

  // Get user's Reddit credentials
  const creds = await db
    .select()
    .from(schema.redditCredentials)
    .where(eq(schema.redditCredentials.userId, userId))
    .limit(1);

  if (creds.length === 0) {
    // No legacy creds either — use public Reddit API as last resort
    console.error(`[scanner] User ${userId} has no Reddit credentials, using public API fallback`);
    const publicClient = new PublicRedditClient();
    for (const monitor of monitors) {
      try {
        await scanMonitorDirect(userId, monitor, publicClient as any, stats);
      } catch (err) {
        console.error(`[scanner] Public API scan failed for monitor ${monitor.id}:`, err);
        stats.errors++;
      }
    }
    return;
  }

  const cred = creds[0];

  // Create a RedditAuth with decrypted credentials (no process.env mutation)
  const auth = new RedditAuth();
  auth.initializeWithConfig({
    clientId: decrypt(cred.clientId),
    clientSecret: decrypt(cred.clientSecret),
    username: cred.username ? decrypt(cred.username) : undefined,
    password: cred.password ? decrypt(cred.password) : undefined,
  });

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

    // Check if post matches any monitor keyword (keyword match alone is valuable)
    const keywordHit = keywords.length > 0 && keywords.some(kw => matchesKeyword(text, kw));

    // Posts must have signal patterns OR match a keyword
    if (matches.length === 0 && !keywordHit) continue;

    // Check if any matched signal type is in the monitor's config
    const matchedCategories = matches.map(m => m.category);
    const hasSignal = signalTypes.some(st => {
      if (st === 'pain_point') return hasCategory(matches, 'pain') || hasCategory(matches, 'frustration');
      if (st === 'buyer_intent') return hasCategory(matches, 'buyer_intent');
      if (st === 'workaround') return hasCategory(matches, 'workaround');
      if (st === 'switching') return hasCategory(matches, 'switching');
      if (st === 'feature_request') return hasCategory(matches, 'feature_request');
      if (st === 'pricing_objection') return hasCategory(matches, 'pricing_objection');
      return matchedCategories.includes(st as PatternCategory);
    });

    // Include if: has matching signal patterns OR matches a keyword
    if (!hasSignal && !keywordHit) continue;

    const leadScore = scoreLeadPost(post);
    const signals = signalSummary(matches);
    if (keywordHit && signals.length === 0) signals.push('keyword_match');

    // Score: lead score is the primary metric. Pattern weight sum is a minor boost, not a multiplier.
    const patternBoost = Math.min(15, matches.reduce((sum, m) => sum + Math.max(0, m.weight), 0));
    // Keyword matches get a base score of 25 if no other signals
    const keywordBoost = keywordHit && matches.length === 0 ? 25 : 0;
    const totalScore = Math.max(leadScore.total + patternBoost + keywordBoost, keywordHit ? 20 : 0);

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
  const highIntentResults = results.filter(r => r.leadScore >= 55);
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
 * Scan a single monitor using DirectRedditClient (real Reddit search API).
 * This is the primary scanning path — uses actual keyword search across subreddits.
 */
async function scanMonitorDirect(
  userId: string,
  monitor: typeof schema.monitor.$inferSelect,
  reddit: DirectRedditClient,
  stats: ScanStats,
): Promise<void> {
  const db = getDb();
  const subreddits = monitor.subreddits as string[];
  const keywords = monitor.keywords as string[];
  const signalTypes = monitor.signalTypes as string[];

  const isPublicApi = (reddit as any)._isPublicClient === true;
  console.error(`[scanner] Scanning monitor "${monitor.name}" via ${isPublicApi ? 'Public' : 'OAuth'} Reddit API (${subreddits.length} subs, ${keywords.length} keywords)`);

  const allPosts: RedditPost[] = [];

  // Build optimized search queries from user keywords
  const searchQueries = keywords.length > 0 ? buildSearchQueries(keywords) : [];
  console.error(`[scanner] ${keywords.length} keywords → ${searchQueries.length} search queries: ${searchQueries.slice(0, 5).join(' | ')}${searchQueries.length > 5 ? '...' : ''}`);

  if (isPublicApi) {
    // PUBLIC API PATH: ~10 req/min budget.
    // Strategy: search within each configured subreddit (top 2 queries each) + browse new.
    // This keeps results topically relevant (no global search spam from r/poker, r/VeteransBenefits).
    // Budget: 2 searches per sub + 1 browse = 3 per sub × 8 subs = 24 requests (~2.5 min at 6.5s gap)
    const topQueries = searchQueries.slice(0, 2);
    for (const sub of subreddits) {
      const cleanSub = sub.replace(/^r\//, '');
      // Search with top keyword queries inside this subreddit
      for (const query of topQueries) {
        try {
          const posts = await reddit.search(query, {
            subreddit: cleanSub,
            sort: 'new',
            time: 'week',
            limit: 100,
          });
          allPosts.push(...posts);
          console.error(`[scanner] Search r/${cleanSub} "${query.slice(0, 30)}": ${posts.length} posts`);
        } catch (err) {
          console.error(`[scanner] Search failed for "${query}" in r/${cleanSub}:`, err);
        }
      }
      // Browse new posts for broader coverage
      try {
        const posts = await reddit.browseSubreddit(cleanSub, 'new', { limit: 100 });
        allPosts.push(...posts);
        console.error(`[scanner] Browse r/${cleanSub}: ${posts.length} posts`);
      } catch (err) {
        console.error(`[scanner] Error browsing r/${cleanSub}:`, err);
      }
    }
  } else {
    // OAUTH API PATH: 90 req/min budget. Full search per subreddit.
    for (const sub of subreddits) {
      try {
        if (searchQueries.length > 0) {
          for (const query of searchQueries) {
            try {
              const posts = await reddit.search(query, {
                subreddit: sub,
                sort: 'new',
                time: 'week',
                limit: 100,
              });
              allPosts.push(...posts);
            } catch (kwErr) {
              const msg = kwErr instanceof Error ? kwErr.message : String(kwErr);
              // Re-throw auth errors so the caller can detect and break
              if (msg.includes('token is invalid') || msg.includes('No access_token')) {
                throw kwErr;
              }
              console.error(`[scanner] Search failed for "${query}" in r/${sub}:`, kwErr);
            }
          }
        } else {
          const posts = await reddit.browseSubreddit(sub, 'new', { limit: 50 });
          allPosts.push(...posts);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('token is invalid') || msg.includes('No access_token')) {
          throw err; // Propagate auth errors to stop wasting requests
        }
        console.error(`[scanner] Error fetching r/${sub}:`, err);
      }
    }

    // Cross-subreddit global search for broader discovery
    if (searchQueries.length > 0) {
      for (const query of searchQueries.slice(0, 3)) {
        try {
          const globalPosts = await reddit.search(query, {
            sort: 'relevance',
            time: 'week',
            limit: 50,
          });
          allPosts.push(...globalPosts);
        } catch (err) {
          console.error(`[scanner] Global search failed for "${query}":`, err);
        }
      }
    }
  }

  // Deduplicate by post ID
  const seen = new Set<string>();
  const posts = allPosts.filter(p => {
    if (!p.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  console.error(`[scanner] Fetched ${allPosts.length} posts, ${posts.length} unique after dedup`);

  // Score and filter
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
    keywordMatch: boolean;
  }> = [];

  for (const post of posts) {
    // ── Upfront junk filtering ──
    if (post.author === '[deleted]' || post.author === 'AutoModerator') continue;
    if (post.stickied || post.locked) continue;
    // Skip posts older than 30 days
    if (post.created_utc > 0 && (Date.now() / 1000 - post.created_utc) > 30 * 86400) continue;

    const text = `${post.title} ${post.selftext ?? ''}`;
    const matches = matchPatterns(text);

    // Check if post matches any monitor keyword
    const keywordMatch = keywords.length > 0 && keywords.some(kw => matchesKeyword(text, kw));

    // STRICT: posts MUST have at least one positive signal pattern
    // Keyword-only matches without intent signals are noise
    const positiveMatches = matches.filter(m => m.weight > 0);
    if (positiveMatches.length === 0) continue;

    const hasSignal = signalTypes.length === 0 || signalTypes.some(st => {
      if (st === 'pain_point') return hasCategory(matches, 'pain') || hasCategory(matches, 'frustration');
      if (st === 'buyer_intent') return hasCategory(matches, 'buyer_intent');
      if (st === 'workaround') return hasCategory(matches, 'workaround');
      if (st === 'switching') return hasCategory(matches, 'switching');
      if (st === 'feature_request') return hasCategory(matches, 'feature_request');
      if (st === 'pricing_objection') return hasCategory(matches, 'pricing_objection');
      return matches.some(m => m.category === (st as PatternCategory));
    });

    if (!hasSignal) continue;

    const leadScore = scoreLeadPost(post);
    const signals = signalSummary(matches);
    if (keywordMatch) signals.push('keyword_match');

    // Score: lead score + pattern boost + engagement. No free points for keyword-only.
    const patternBoost = Math.min(15, positiveMatches.reduce((sum, m) => sum + m.weight, 0));
    const engagementBoost = Math.min(10, Math.floor(((post.ups || 0) + (post.num_comments || 0) * 2) / 10));
    // Keyword match amplifies an already-signaled post, doesn't create score from nothing
    const keywordBoost = keywordMatch ? 5 : 0;
    const totalScore = leadScore.total + patternBoost + engagementBoost + keywordBoost;

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
      leadScore: leadScore.total + engagementBoost,
      createdUtc: post.created_utc,
      keywordMatch,
    });
  }

  // Sort: keyword matches first, then by score
  results.sort((a, b) => {
    if (a.keywordMatch !== b.keywordMatch) return a.keywordMatch ? -1 : 1;
    return b.score - a.score;
  });

  const topResults = results.slice(0, 50);

  for (const r of topResults) {
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

  // Extract leads
  const highIntentResults = results.filter(r => r.leadScore >= 55);
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

  // Update monitor
  await db
    .update(schema.monitor)
    .set({ lastScannedAt: new Date() })
    .where(eq(schema.monitor.id, monitor.id));

  stats.monitorsScanned++;

  // Alerts
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

  console.error(`[scanner] Monitor "${monitor.name}" (Direct API): ${topResults.length} results, ${highIntentResults.length} leads`);
}

/**
 * Factory: get the best available Reddit client for a user.
 * Tries Direct API (via Composio token) first, falls back to legacy RedditClient.
 * Exported for testing.
 */
export async function getClientForUser(
  userId: string,
): Promise<{ type: 'direct-api'; client: DirectRedditClient } | { type: 'composio'; client: ComposioRedditClient } | { type: 'direct'; client: RedditClient } | null> {
  // Try Direct Reddit API via Composio OAuth token (best option — real search)
  if (process.env.COMPOSIO_API_KEY) {
    try {
      const db = getDb();
      const [usr] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
      const connAccountId = usr?.composioConnectedAccountId;
      const entityId = usr?.composioEntityId;

      if (connAccountId && entityId) {
        let connected = false;
        try {
          const account = await getComposio().connectedAccounts.get(connAccountId);
          connected = account?.status === 'ACTIVE';
          if (!connected) {
            console.warn(`[getClientForUser] Composio account ${connAccountId} status: ${account?.status ?? 'unknown'}`);
          }
        } catch (connErr) {
          console.warn(`[getClientForUser] connectedAccounts.get(${connAccountId}) failed:`, connErr instanceof Error ? connErr.message : connErr);
          const result = await checkRedditConnection(entityId);
          connected = result.connected;
        }
        if (connected) {
          const tokenProvider = new ComposioTokenProvider(getComposio(), connAccountId);
          return { type: 'direct-api', client: new DirectRedditClient(tokenProvider) };
        }
      }
    } catch (outerErr) {
      console.warn(`[getClientForUser] Composio check failed for user ${userId}:`, outerErr instanceof Error ? outerErr.message : outerErr);
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
  auth.initializeWithConfig({
    clientId: decrypt(cred.clientId),
    clientSecret: decrypt(cred.clientSecret),
    username: cred.username ? decrypt(cred.username) : undefined,
    password: cred.password ? decrypt(cred.password) : undefined,
  });

  const cache = new IntelCache({ defaultTTL: 5 * 60_000, maxSizeBytes: 10 * 1024 * 1024 });
  const limiter = new RateLimiter({ limit: auth.getRateLimit(), windowMs: 60_000, label: `User ${userId}` });
  return { type: 'direct', client: new RedditClient({ auth, rateLimiter: limiter, cache }) };
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

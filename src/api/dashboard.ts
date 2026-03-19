/**
 * Dashboard API — authenticated routes for Pro dashboard
 *
 * All routes require a valid Better Auth session.
 * Pattern matches src/api/rest.ts — returns boolean (handled or not).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getSessionFromRequest } from '../auth/session.js';
import { getDb, schema } from '../db/index.js';
import { encrypt, decrypt } from '../db/crypto.js';
import { eq, and } from 'drizzle-orm';
import { buildAuthorizationUrl, exchangeCodeForTokens, getRedditUsername, isRedditOAuthConfigured } from './reddit-oauth.js';
import { randomBytes } from 'crypto';
import { runSingleMonitorScan } from '../monitor/scanner.js';

const MAX_BODY = 512 * 1024; // 512KB

export async function handleDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/dashboard/')) return false;

  // CORS for dashboard frontend
  const origin = req.headers.origin ?? '';
  const allowedOrigins = ['https://buildradar.xyz', 'https://app.buildradar.xyz', 'http://localhost:5173'];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return true;
  }

  // Auth check
  const session = await getSessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: 'Unauthorized' });
    return true;
  }

  const userId = session.user.id;
  const db = getDb();

  // ── GET /dashboard/me ──
  if (url === '/dashboard/me' && req.method === 'GET') {
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    if (!u) { json(res, 404, { error: 'User not found' }); return true; }
    json(res, 200, {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      tier: u.tier,
      createdAt: u.createdAt,
    });
    return true;
  }

  // ── GET /dashboard/credentials ──
  if (url === '/dashboard/credentials' && req.method === 'GET') {
    const creds = await db.select().from(schema.redditCredentials).where(eq(schema.redditCredentials.userId, userId));
    json(res, 200, {
      credentials: creds.map(c => ({
        id: c.id,
        clientId: decrypt(c.clientId).slice(0, 6) + '...', // masked
        hasUsername: !!c.username,
        rateLimit: c.rateLimit,
        createdAt: c.createdAt,
      })),
    });
    return true;
  }

  // ── POST /dashboard/credentials ──
  if (url === '/dashboard/credentials' && req.method === 'POST') {
    const body = await readBody(req) as { clientId?: string; clientSecret?: string; username?: string; password?: string } | null;
    if (!body?.clientId || !body?.clientSecret) {
      json(res, 400, { error: 'clientId and clientSecret are required' });
      return true;
    }

    const [cred] = await db.insert(schema.redditCredentials).values({
      userId,
      clientId: encrypt(body.clientId),
      clientSecret: encrypt(body.clientSecret),
      username: body.username ? encrypt(body.username) : null,
      password: body.password ? encrypt(body.password) : null,
      rateLimit: body.username ? 100 : 60,
    }).returning();

    json(res, 201, { id: cred.id, rateLimit: cred.rateLimit });
    return true;
  }

  // ── DELETE /dashboard/credentials/:id ──
  const credDeleteMatch = url.match(/^\/dashboard\/credentials\/([a-f0-9-]+)$/);
  if (credDeleteMatch && req.method === 'DELETE') {
    await db.delete(schema.redditCredentials)
      .where(and(
        eq(schema.redditCredentials.id, credDeleteMatch[1]),
        eq(schema.redditCredentials.userId, userId),
      ));
    json(res, 200, { deleted: true });
    return true;
  }

  // ── GET /dashboard/monitors ──
  if (url === '/dashboard/monitors' && req.method === 'GET') {
    const monitors = await db.select().from(schema.monitor).where(eq(schema.monitor.userId, userId));
    json(res, 200, { monitors });
    return true;
  }

  // ── POST /dashboard/monitors ──
  if (url === '/dashboard/monitors' && req.method === 'POST') {
    const body = await readBody(req) as {
      name?: string; subreddits?: string[]; keywords?: string[];
      signalTypes?: string[]; alertChannel?: string; slackWebhookUrl?: string;
    } | null;

    if (!body?.name || !body?.subreddits?.length) {
      json(res, 400, { error: 'name and subreddits are required' });
      return true;
    }

    // Free tier limit: 1 monitor
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    if (u?.tier !== 'pro') {
      const existing = await db.select().from(schema.monitor).where(eq(schema.monitor.userId, userId));
      if (existing.length >= 1) {
        json(res, 403, { error: 'Free tier allows 1 monitor. Upgrade to Pro for unlimited.' });
        return true;
      }
    }

    const [mon] = await db.insert(schema.monitor).values({
      userId,
      name: body.name,
      subreddits: body.subreddits,
      keywords: body.keywords ?? [],
      signalTypes: body.signalTypes ?? ['pain_point', 'buyer_intent'],
      alertChannel: body.alertChannel ?? 'email',
      slackWebhookUrl: body.slackWebhookUrl,
    }).returning();

    // Trigger first scan immediately in background (don't wait for cron)
    runSingleMonitorScan(mon.id, userId).catch(err => {
      console.error(`[dashboard] First scan failed for new monitor ${mon.id}:`, err);
    });

    json(res, 201, { monitor: mon });
    return true;
  }

  // ── PUT /dashboard/monitors/:id ──
  const monUpdateMatch = url.match(/^\/dashboard\/monitors\/([a-f0-9-]+)$/);
  if (monUpdateMatch && req.method === 'PUT') {
    const body = await readBody(req) as Record<string, unknown> | null;
    if (!body) { json(res, 400, { error: 'Request body required' }); return true; }

    const updates: Record<string, unknown> = {};
    if ('name' in body) updates.name = body.name;
    if ('subreddits' in body) updates.subreddits = body.subreddits;
    if ('keywords' in body) updates.keywords = body.keywords;
    if ('signalTypes' in body) updates.signalTypes = body.signalTypes;
    if ('alertChannel' in body) updates.alertChannel = body.alertChannel;
    if ('slackWebhookUrl' in body) updates.slackWebhookUrl = body.slackWebhookUrl;
    if ('active' in body) updates.active = body.active;
    updates.updatedAt = new Date();

    await db.update(schema.monitor)
      .set(updates)
      .where(and(
        eq(schema.monitor.id, monUpdateMatch[1]),
        eq(schema.monitor.userId, userId),
      ));

    json(res, 200, { updated: true });
    return true;
  }

  // ── DELETE /dashboard/monitors/:id ──
  const monDeleteMatch = url.match(/^\/dashboard\/monitors\/([a-f0-9-]+)$/);
  if (monDeleteMatch && req.method === 'DELETE') {
    await db.delete(schema.monitor).where(and(
      eq(schema.monitor.id, monDeleteMatch[1]),
      eq(schema.monitor.userId, userId),
    ));
    json(res, 200, { deleted: true });
    return true;
  }

  // ── POST /dashboard/monitors/:id/scan — Trigger immediate scan ──
  const monScanMatch = url.match(/^\/dashboard\/monitors\/([a-f0-9-]+)\/scan$/);
  if (monScanMatch && req.method === 'POST') {
    const monitorId = monScanMatch[1];

    // Verify monitor belongs to this user
    const [monitor] = await db.select().from(schema.monitor)
      .where(and(eq(schema.monitor.id, monitorId), eq(schema.monitor.userId, userId)));

    if (!monitor) {
      json(res, 404, { error: 'Monitor not found' });
      return true;
    }

    // Fire and forget — don't block the response
    runSingleMonitorScan(monitorId, userId).catch(err => {
      console.error(`[dashboard] Background scan failed for monitor ${monitorId}:`, err);
    });

    json(res, 200, { scanning: true, message: 'Scan triggered' });
    return true;
  }

  // ── GET /dashboard/results ──
  if (url.startsWith('/dashboard/results') && req.method === 'GET') {
    const results = await db.select().from(schema.scanResult)
      .where(eq(schema.scanResult.userId, userId))
      .orderBy(schema.scanResult.createdAt)
      .limit(50);
    json(res, 200, { results });
    return true;
  }

  // ── GET /dashboard/leads ──
  if (url === '/dashboard/leads' && req.method === 'GET') {
    const leads = await db.select().from(schema.lead).where(eq(schema.lead.userId, userId));
    json(res, 200, { leads });
    return true;
  }

  // ── PUT /dashboard/leads/:id ──
  const leadUpdateMatch = url.match(/^\/dashboard\/leads\/([a-f0-9-]+)$/);
  if (leadUpdateMatch && req.method === 'PUT') {
    const body = await readBody(req) as { status?: string; notes?: string | null } | null;
    if (!body) { json(res, 400, { error: 'Request body required' }); return true; }

    const hasStatus = 'status' in body;
    const hasNotes = 'notes' in body;
    if (!hasStatus && !hasNotes) {
      json(res, 400, { error: 'At least one of status or notes is required' });
      return true;
    }

    if (hasStatus && (!body.status || !['new', 'contacted', 'converted'].includes(body.status))) {
      json(res, 400, { error: 'status must be one of: new, contacted, converted' });
      return true;
    }

    const updates: Record<string, unknown> = { lastActive: new Date() };
    if (hasStatus) updates.status = body.status;
    if (hasNotes) updates.notes = body.notes ?? null;

    await db.update(schema.lead)
      .set(updates)
      .where(and(
        eq(schema.lead.id, leadUpdateMatch[1]),
        eq(schema.lead.userId, userId),
      ));
    json(res, 200, { updated: true });
    return true;
  }

  // ── GET /dashboard/reddit/connect — Initiate Reddit OAuth ──
  if (url === '/dashboard/reddit/connect' && req.method === 'GET') {
    if (!isRedditOAuthConfigured()) {
      json(res, 503, { error: 'Reddit OAuth not configured on this server' });
      return true;
    }
    const state = encrypt(JSON.stringify({ userId, nonce: randomBytes(16).toString('hex'), ts: Date.now() }));
    const authUrl = buildAuthorizationUrl(state);
    json(res, 200, { url: authUrl });
    return true;
  }

  // ── GET /dashboard/reddit/callback — Handle Reddit OAuth redirect ──
  if (url.startsWith('/dashboard/reddit/callback') && req.method === 'GET') {
    const frontendBase = process.env.BETTER_AUTH_URL?.replace('api.', '') || 'https://buildradar.xyz';
    const settingsUrl = `${frontendBase}/app/settings`;

    try {
      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const code = parsedUrl.searchParams.get('code');
      const state = parsedUrl.searchParams.get('state');
      const error = parsedUrl.searchParams.get('error');

      if (error) {
        redirect(res, `${settingsUrl}?reddit=error&reason=${encodeURIComponent(error)}`);
        return true;
      }

      if (!code || !state) {
        redirect(res, `${settingsUrl}?reddit=error&reason=missing_params`);
        return true;
      }

      // Validate state
      let stateData: { userId: string; ts: number };
      try {
        stateData = JSON.parse(decrypt(state));
      } catch {
        redirect(res, `${settingsUrl}?reddit=error&reason=invalid_state`);
        return true;
      }

      if (stateData.userId !== userId) {
        redirect(res, `${settingsUrl}?reddit=error&reason=user_mismatch`);
        return true;
      }

      if (Date.now() - stateData.ts > 10 * 60 * 1000) {
        redirect(res, `${settingsUrl}?reddit=error&reason=expired`);
        return true;
      }

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code);
      const redditUsername = await getRedditUsername(tokens.access_token);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // Upsert — one connection per user
      const existing = await db.select().from(schema.redditOAuthConnection).where(eq(schema.redditOAuthConnection.userId, userId));
      if (existing.length > 0) {
        await db.update(schema.redditOAuthConnection)
          .set({
            redditUsername,
            accessToken: encrypt(tokens.access_token),
            refreshToken: encrypt(tokens.refresh_token),
            scope: tokens.scope,
            expiresAt,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(schema.redditOAuthConnection.userId, userId));
      } else {
        await db.insert(schema.redditOAuthConnection).values({
          userId,
          redditUsername,
          accessToken: encrypt(tokens.access_token),
          refreshToken: encrypt(tokens.refresh_token),
          scope: tokens.scope,
          expiresAt,
        });
      }

      redirect(res, `${settingsUrl}?reddit=connected`);
    } catch (err) {
      console.error('[reddit-oauth] callback error:', err);
      redirect(res, `${settingsUrl}?reddit=error&reason=exchange_failed`);
    }
    return true;
  }

  // ── GET /dashboard/reddit/status — Check Reddit connection ──
  if (url === '/dashboard/reddit/status' && req.method === 'GET') {
    const [conn] = await db.select().from(schema.redditOAuthConnection).where(eq(schema.redditOAuthConnection.userId, userId));
    if (!conn || conn.status === 'revoked') {
      json(res, 200, { connected: false });
    } else {
      json(res, 200, {
        connected: true,
        redditUsername: conn.redditUsername,
        scope: conn.scope,
        connectedAt: conn.createdAt,
        status: conn.status,
      });
    }
    return true;
  }

  // ── DELETE /dashboard/reddit/disconnect — Remove Reddit connection ──
  if (url === '/dashboard/reddit/disconnect' && req.method === 'DELETE') {
    await db.delete(schema.redditOAuthConnection).where(eq(schema.redditOAuthConnection.userId, userId));
    json(res, 200, { disconnected: true });
    return true;
  }

  // ── GET /dashboard/reply-templates ──
  if (url === '/dashboard/reply-templates' && req.method === 'GET') {
    json(res, 200, { templates: REPLY_TEMPLATES });
    return true;
  }

  // ── GET /dashboard/subreddit-recommendations?product=... ──
  if (url.startsWith('/dashboard/subreddit-recommendations') && req.method === 'GET') {
    const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const product = parsedUrl.searchParams.get('product')?.toLowerCase().trim();
    if (!product) {
      json(res, 400, { error: 'product query parameter is required' });
      return true;
    }

    const matched = new Set<string>();
    for (const [category, subreddits] of Object.entries(SUBREDDIT_MAP)) {
      if (product.includes(category)) {
        for (const sub of subreddits) matched.add(sub);
      }
    }

    // Also match category keywords that might appear as substrings
    const CATEGORY_KEYWORDS: Record<string, string[]> = {
      saas: ['saas', 'software', 'subscription', 'b2b', 'platform'],
      devtools: ['developer', 'dev', 'api', 'sdk', 'cli', 'code', 'programming'],
      marketing: ['marketing', 'seo', 'ads', 'content', 'social media', 'growth'],
      ecommerce: ['ecommerce', 'e-commerce', 'shop', 'store', 'retail', 'commerce'],
      fintech: ['fintech', 'finance', 'payment', 'banking', 'invoice', 'accounting'],
      ai: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'gpt', 'neural'],
      design: ['design', 'ui', 'ux', 'figma', 'prototype'],
      productivity: ['productivity', 'project management', 'task', 'workflow', 'automation', 'notion'],
      education: ['education', 'learning', 'course', 'teaching', 'edtech', 'tutorial'],
      health: ['health', 'medical', 'fitness', 'wellness', 'telehealth'],
    };

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some(kw => product.includes(kw))) {
        const subreddits = SUBREDDIT_MAP[category];
        if (subreddits) {
          for (const sub of subreddits) matched.add(sub);
        }
      }
    }

    // If no matches, return general startup/business subreddits
    if (matched.size === 0) {
      for (const sub of ['startups', 'entrepreneur', 'smallbusiness', 'indiehackers', 'SideProject']) {
        matched.add(sub);
      }
    }

    json(res, 200, {
      product,
      subreddits: [...matched],
      count: matched.size,
    });
    return true;
  }

  json(res, 404, { error: 'Dashboard route not found' });
  return true;
}

// ── Static data ──

const REPLY_TEMPLATES: Record<string, { name: string; template: string; tips: string }> = {
  pain_point: {
    name: 'Pain Point Response',
    template: "Hey! I noticed you're dealing with {pain}. We built {product} specifically to solve this — it {key_benefit}. Happy to give you a free trial if you want to check it out. No pressure!",
    tips: 'Acknowledge their pain first, then position your solution. Keep it genuine and helpful, not salesy.',
  },
  buyer_intent: {
    name: 'Buyer Intent Response',
    template: "Great question! I'm the founder of {product} — we do exactly this. {brief_pitch}. Would love to give you a walkthrough if you're interested. What's your main use case?",
    tips: "They're already looking to buy. Be direct about what you offer. Ask about their specific needs.",
  },
  switching: {
    name: 'Switching Intent Response',
    template: 'I hear you — a lot of people have been switching from {competitor} lately. We built {product} as an alternative that {differentiator}. Happy to share a comparison if helpful!',
    tips: "Don't trash the competitor. Focus on what makes you different. Offer proof.",
  },
  feature_request: {
    name: 'Feature Request Response',
    template: 'That\'s a great idea! We actually just built something similar in {product}. {feature_description}. Would love your feedback on our approach — want to try it out?',
    tips: "Show you're listening. If you don't have the feature yet, say you're considering it.",
  },
  pricing_objection: {
    name: 'Pricing Objection Response',
    template: 'Totally get it — pricing matters. We built {product} at {price} because we wanted it accessible for {audience}. It includes {value_props}. Happy to extend a trial so you can see the ROI first.',
    tips: "Don't compete on price alone. Emphasize value. Offer a trial to reduce risk.",
  },
  workaround: {
    name: 'Workaround Response',
    template: "Nice hack! If you're tired of the manual work, we built {product} to automate exactly this. Takes about {setup_time} to set up. Might save you some time!",
    tips: 'Compliment their resourcefulness. Show how your product replaces the manual work.',
  },
};

const SUBREDDIT_MAP: Record<string, string[]> = {
  saas: ['SaaS', 'startups', 'entrepreneur', 'smallbusiness', 'indiehackers'],
  devtools: ['programming', 'webdev', 'devops', 'node', 'reactjs', 'golang'],
  marketing: ['marketing', 'digital_marketing', 'SEO', 'socialmedia', 'PPC'],
  ecommerce: ['ecommerce', 'shopify', 'dropshipping', 'FulfillmentByAmazon'],
  fintech: ['fintech', 'personalfinance', 'smallbusiness', 'accounting', 'tax'],
  ai: ['artificial', 'MachineLearning', 'ChatGPT', 'LocalLLaMA', 'singularity'],
  design: ['web_design', 'UI_Design', 'userexperience', 'graphic_design'],
  productivity: ['productivity', 'Notion', 'ObsidianMD', 'PKMS', 'projectmanagement'],
  education: ['edtech', 'learnprogramming', 'OnlineEducation', 'education'],
  health: ['healthIT', 'digitalhealth', 'fitness', 'nutrition'],
};

// ── Helpers ──

function redirect(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url });
  res.end();
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk;
      if (raw.length > MAX_BODY) { resolve(null); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

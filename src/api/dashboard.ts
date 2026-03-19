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
    const body = await readBody(req) as { status?: string } | null;
    if (!body?.status || !['new', 'contacted', 'converted'].includes(body.status)) {
      json(res, 400, { error: 'status must be one of: new, contacted, converted' });
      return true;
    }
    await db.update(schema.lead)
      .set({ status: body.status, lastActive: new Date() })
      .where(and(
        eq(schema.lead.id, leadUpdateMatch[1]),
        eq(schema.lead.userId, userId),
      ));
    json(res, 200, { updated: true });
    return true;
  }

  json(res, 404, { error: 'Dashboard route not found' });
  return true;
}

// ── Helpers ──

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

/**
 * Tracking API — Outreach Log + Link Tracking
 *
 * Routes:
 *   Public:  GET /r/:hash                              → redirect + click log
 *   Authed:  GET  /dashboard/outreach                  → list logs + stats
 *            POST /dashboard/outreach/log              → save a logged reply
 *            GET  /dashboard/outreach/tracking-link   → get user's tracking link
 *            POST /dashboard/outreach/tracking-link   → create/update (Pro)
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getDb, schema } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';
import { getSessionFromRequest } from '../auth/session.js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const { trackingLink, outreachLog, linkClick } = schema;

// ── Helpers ──────────────────────────────────────────────────────

function generateHash(): string {
  return randomBytes(4).toString('hex'); // 8-char hex e.g. "a3f9b2c1"
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 512_000) reject(new Error('Too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body) as Record<string, unknown>); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

// ── Public: GET /r/:hash ─────────────────────────────────────────

export async function handleTrackingRedirect(
  req: IncomingMessage,
  res: ServerResponse,
  hash: string,
) {
  const db = getDb();
  const rows = await db.select().from(trackingLink).where(eq(trackingLink.hash, hash)).limit(1);

  if (!rows[0]) {
    // Unknown hash — send to homepage rather than 404
    res.writeHead(302, { Location: 'https://buildradar.xyz', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const link = rows[0];
  const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket?.remoteAddress ?? '';
  const hashedIp = rawIp
    ? createHash('sha256').update(rawIp).digest('hex').slice(0, 16)
    : null;

  // Fire-and-forget click logging — don't block the redirect
  Promise.all([
    db.insert(linkClick).values({
      id: randomUUID(),
      trackingLinkId: link.id,
      userId: link.userId,
      referrer: (req.headers.referer as string) || null,
      userAgent: (req.headers['user-agent'] as string) || null,
      ip: hashedIp,
    }),
    db.update(trackingLink)
      .set({ clickCount: link.clickCount + 1 })
      .where(eq(trackingLink.id, link.id)),
  ]).catch(err => console.error('[tracking] click log failed:', err));

  res.writeHead(301, {
    Location: link.destinationUrl,
    'Cache-Control': 'no-store, no-cache',
    'Pragma': 'no-cache',
  });
  res.end();
}

// ── Authed: /dashboard/outreach/* ────────────────────────────────

export async function handleOutreachRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/dashboard/outreach')) return false;

  const session = await getSessionFromRequest(req);
  if (!session) { json(res, 401, { error: 'Unauthorized' }); return true; }

  const db = getDb();
  const userId = session.user.id;
  const isPro = session.user.tier === 'pro';
  const method = req.method ?? 'GET';

  // ── GET /dashboard/outreach ──────────────────────────────────
  if (url === '/dashboard/outreach' && method === 'GET') {
    const logs = await db
      .select()
      .from(outreachLog)
      .where(eq(outreachLog.userId, userId))
      .orderBy(desc(outreachLog.createdAt))
      .limit(200);

    // Get the user's tracking link click count once (all logs share one link per user)
    const userLink = await db.select({ id: trackingLink.id, clickCount: trackingLink.clickCount })
      .from(trackingLink)
      .where(eq(trackingLink.userId, userId))
      .limit(1);
    const totalClicks = userLink[0]?.clickCount ?? 0;

    json(res, 200, {
      logs,
      stats: {
        totalLogged: logs.length,
        totalClicks,
      },
    });
    return true;
  }

  // ── POST /dashboard/outreach/log ─────────────────────────────
  if (url === '/dashboard/outreach/log' && method === 'POST') {
    const body = await readBody(req);
    const { subreddit, postTitle, postUrl, tone, replyText, resultId } = body as {
      subreddit?: string; postTitle?: string; postUrl?: string;
      tone?: string; replyText?: string; resultId?: string;
    };

    if (!subreddit || !postTitle || !tone || !replyText) {
      json(res, 400, { error: 'subreddit, postTitle, tone, and replyText are required' });
      return true;
    }

    const id = randomUUID();
    await db.insert(outreachLog).values({
      id,
      userId,
      resultId: resultId ?? null,
      subreddit: subreddit.replace(/^r\//, ''),
      postTitle,
      postUrl: postUrl ?? null,
      tone,
      replyText,
    });

    json(res, 200, { ok: true, id });
    return true;
  }

  // ── GET /dashboard/outreach/tracking-link ────────────────────
  if (url === '/dashboard/outreach/tracking-link' && method === 'GET') {
    if (!isPro) {
      json(res, 200, { link: null, locked: true });
      return true;
    }
    const rows = await db.select().from(trackingLink).where(eq(trackingLink.userId, userId)).limit(1);
    json(res, 200, { link: rows[0] ?? null, locked: false });
    return true;
  }

  // ── POST /dashboard/outreach/tracking-link ───────────────────
  if (url === '/dashboard/outreach/tracking-link' && method === 'POST') {
    if (!isPro) { json(res, 403, { error: 'Tracking links are a Pro feature' }); return true; }

    const body = await readBody(req);
    const { destinationUrl } = body as { destinationUrl?: string };

    if (!destinationUrl || !destinationUrl.startsWith('http')) {
      json(res, 400, { error: 'Valid destinationUrl starting with http is required' });
      return true;
    }

    const existing = await db.select().from(trackingLink).where(eq(trackingLink.userId, userId)).limit(1);

    if (existing[0]) {
      await db.update(trackingLink)
        .set({ destinationUrl })
        .where(eq(trackingLink.id, existing[0].id));
      json(res, 200, { link: { ...existing[0], destinationUrl } });
      return true;
    }

    // Generate a unique hash (retry up to 5 times on collision)
    let hash = generateHash();
    for (let attempt = 0; attempt < 5; attempt++) {
      const taken = await db.select({ id: trackingLink.id })
        .from(trackingLink).where(eq(trackingLink.hash, hash)).limit(1);
      if (!taken[0]) break;
      hash = generateHash();
    }

    const id = randomUUID();
    const row = { id, userId, hash, destinationUrl, clickCount: 0, createdAt: new Date() };
    await db.insert(trackingLink).values(row);
    json(res, 200, { link: row });
    return true;
  }

  return false;
}

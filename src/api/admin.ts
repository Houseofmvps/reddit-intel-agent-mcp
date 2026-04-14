/**
 * Super Admin API — protected routes for BuildRadar admin console
 *
 * Routes (admin-only, checked against ADMIN_EMAILS env var):
 *   GET  /admin/overview       → platform-wide stats
 *   GET  /admin/users          → all users with enriched usage data
 *   GET  /admin/activity       → recent events timeline
 *   POST /admin/users/:id/tier → manually set user tier (free | pro)
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getDb, schema } from '../db/index.js';
import { eq, sql, desc, gte } from 'drizzle-orm';
import { getSessionFromRequest } from '../auth/session.js';

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'houseofmvps2024@gmail.com')
  .split(',').map(e => e.trim().toLowerCase());

function json(res: ServerResponse, status: number, body: unknown) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function requireAdmin(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const session = await getSessionFromRequest(req);
  if (!session) { json(res, 401, { error: 'Unauthorized' }); return false; }
  if (!ADMIN_EMAILS.includes(session.user.email.toLowerCase())) {
    json(res, 403, { error: 'Forbidden' }); return false;
  }
  return true;
}

export async function handleAdminRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/admin')) return false;

  const ok = await requireAdmin(req, res);
  if (!ok) return true;

  const db = getDb();
  const method = req.method ?? 'GET';

  // ── GET /admin/overview ──────────────────────────────────────────
  if (url === '/admin/overview' && method === 'GET') {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      allUsers, proUsers, newToday, newWeek,
      totalMonitors, activeMonitors,
      scansToday, scansTotal,
      sessionsToday, sessionsTotal,
      outreachTotal, warmupCount,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(schema.user),
      db.select({ count: sql<number>`count(*)` }).from(schema.user).where(eq(schema.user.tier, 'pro')),
      db.select({ count: sql<number>`count(*)` }).from(schema.user).where(gte(schema.user.createdAt, today)),
      db.select({ count: sql<number>`count(*)` }).from(schema.user).where(gte(schema.user.createdAt, weekAgo)),
      db.select({ count: sql<number>`count(*)` }).from(schema.monitor),
      db.select({ count: sql<number>`count(*)` }).from(schema.monitor).where(eq(schema.monitor.active, true)),
      db.select({ count: sql<number>`count(*)` }).from(schema.scanResult).where(gte(schema.scanResult.createdAt, today)),
      db.select({ count: sql<number>`count(*)` }).from(schema.scanResult),
      db.select({ count: sql<number>`count(*)` }).from(schema.generatedReply).where(gte(schema.generatedReply.createdAt, today)),
      db.select({ count: sql<number>`count(*)` }).from(schema.generatedReply),
      db.select({ count: sql<number>`count(*)` }).from(schema.outreachLog),
      db.select({ count: sql<number>`count(*)` }).from(schema.warmupPlan),
    ]);

    const proCount = Number(proUsers[0]?.count ?? 0);
    const totalCount = Number(allUsers[0]?.count ?? 0);

    json(res, 200, {
      totalUsers: totalCount,
      proUsers: proCount,
      freeUsers: totalCount - proCount,
      mrrEstimate: proCount * 29,
      newUsersToday: Number(newToday[0]?.count ?? 0),
      newUsersThisWeek: Number(newWeek[0]?.count ?? 0),
      totalMonitors: Number(totalMonitors[0]?.count ?? 0),
      activeMonitors: Number(activeMonitors[0]?.count ?? 0),
      scansToday: Number(scansToday[0]?.count ?? 0),
      scansTotal: Number(scansTotal[0]?.count ?? 0),
      replySessionsToday: Number(sessionsToday[0]?.count ?? 0),
      replySessionsTotal: Number(sessionsTotal[0]?.count ?? 0),
      outreachLogsTotal: Number(outreachTotal[0]?.count ?? 0),
      warmupPlansStarted: Number(warmupCount[0]?.count ?? 0),
    });
    return true;
  }

  // ── GET /admin/users ─────────────────────────────────────────────
  if (url === '/admin/users' && method === 'GET') {
    const allUsers = await db.select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      tier: schema.user.tier,
      polarCustomerId: schema.user.polarCustomerId,
      createdAt: schema.user.createdAt,
    }).from(schema.user).orderBy(desc(schema.user.createdAt));

    if (allUsers.length === 0) { json(res, 200, { users: [] }); return true; }

    const [monitorCounts, scanCounts, replyCounts, outreachCounts, warmupRows, recentSessions] = await Promise.all([
      db.select({ userId: schema.monitor.userId, count: sql<number>`count(*)` }).from(schema.monitor).groupBy(schema.monitor.userId),
      db.select({ userId: schema.scanResult.userId, count: sql<number>`count(*)` }).from(schema.scanResult).groupBy(schema.scanResult.userId),
      db.select({ userId: schema.generatedReply.userId, count: sql<number>`count(*)` }).from(schema.generatedReply).groupBy(schema.generatedReply.userId),
      db.select({ userId: schema.outreachLog.userId, count: sql<number>`count(*)` }).from(schema.outreachLog).groupBy(schema.outreachLog.userId),
      db.select({ userId: schema.warmupPlan.userId, startedAt: schema.warmupPlan.startedAt, completedDays: schema.warmupPlan.completedDays }).from(schema.warmupPlan),
      db.select({ userId: schema.session.userId, createdAt: schema.session.createdAt }).from(schema.session).orderBy(desc(schema.session.createdAt)).limit(1000),
    ]);

    const monitorMap = new Map(monitorCounts.map(r => [r.userId, Number(r.count)]));
    const scanMap = new Map(scanCounts.map(r => [r.userId, Number(r.count)]));
    const replyMap = new Map(replyCounts.map(r => [r.userId, Number(r.count)]));
    const outreachMap = new Map(outreachCounts.map(r => [r.userId, Number(r.count)]));
    const warmupMap = new Map(warmupRows.map(r => [r.userId, r]));
    // Last session per user
    const lastSessionMap = new Map<string, Date>();
    for (const s of recentSessions) {
      if (!lastSessionMap.has(s.userId)) lastSessionMap.set(s.userId, s.createdAt);
    }

    const users = allUsers.map(u => {
      const warmup = warmupMap.get(u.id);
      const warmupDay = warmup
        ? Math.min(30, Math.floor((Date.now() - new Date(warmup.startedAt).getTime()) / (24 * 60 * 60 * 1000)) + 1)
        : null;
      const warmupCompleted = warmup ? (warmup.completedDays as number[]).length : null;

      return {
        ...u,
        monitors: monitorMap.get(u.id) ?? 0,
        scans: scanMap.get(u.id) ?? 0,
        replySessions: replyMap.get(u.id) ?? 0,
        outreachLogs: outreachMap.get(u.id) ?? 0,
        warmupDay,
        warmupCompleted,
        lastActiveAt: lastSessionMap.get(u.id) ?? null,
        hasPolar: !!u.polarCustomerId,
      };
    });

    json(res, 200, { users });
    return true;
  }

  // ── GET /admin/activity ──────────────────────────────────────────
  if (url === '/admin/activity' && method === 'GET') {
    const [recentUsers, recentReplies, recentScans, recentOutreach] = await Promise.all([
      db.select({
        id: schema.user.id, name: schema.user.name, email: schema.user.email,
        tier: schema.user.tier, createdAt: schema.user.createdAt,
      }).from(schema.user).orderBy(desc(schema.user.createdAt)).limit(15),

      db.select({
        id: schema.generatedReply.id, tone: schema.generatedReply.tone,
        createdAt: schema.generatedReply.createdAt, name: schema.user.name,
        email: schema.user.email,
      }).from(schema.generatedReply)
        .innerJoin(schema.user, eq(schema.generatedReply.userId, schema.user.id))
        .orderBy(desc(schema.generatedReply.createdAt)).limit(15),

      db.select({
        id: schema.scanResult.id, subreddit: schema.scanResult.subreddit,
        score: schema.scanResult.score, createdAt: schema.scanResult.createdAt,
        name: schema.user.name, email: schema.user.email,
      }).from(schema.scanResult)
        .innerJoin(schema.user, eq(schema.scanResult.userId, schema.user.id))
        .orderBy(desc(schema.scanResult.createdAt)).limit(15),

      db.select({
        id: schema.outreachLog.id, subreddit: schema.outreachLog.subreddit,
        tone: schema.outreachLog.tone, createdAt: schema.outreachLog.createdAt,
        name: schema.user.name, email: schema.user.email,
      }).from(schema.outreachLog)
        .innerJoin(schema.user, eq(schema.outreachLog.userId, schema.user.id))
        .orderBy(desc(schema.outreachLog.createdAt)).limit(15),
    ]);

    const events = [
      ...recentUsers.map(u => ({
        type: 'signup' as const,
        label: u.name || u.email,
        sub: u.tier === 'pro' ? 'Pro user signed up' : 'Free user signed up',
        ts: (u.createdAt as Date).toISOString(),
      })),
      ...recentReplies.map(r => ({
        type: 'reply' as const,
        label: r.name || r.email,
        sub: `Coach Me — ${r.tone} style`,
        ts: (r.createdAt as Date).toISOString(),
      })),
      ...recentScans.map(s => ({
        type: 'scan' as const,
        label: s.name || s.email,
        sub: `Scanned r/${s.subreddit} · score ${s.score}`,
        ts: (s.createdAt as Date).toISOString(),
      })),
      ...recentOutreach.map(o => ({
        type: 'outreach' as const,
        label: o.name || o.email,
        sub: `Logged reply in r/${o.subreddit}`,
        ts: (o.createdAt as Date).toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 40);

    json(res, 200, { events });
    return true;
  }

  // ── POST /admin/users/:id/tier ────────────────────────────────────
  const tierMatch = url.match(/^\/admin\/users\/([^/]+)\/tier$/);
  if (tierMatch && method === 'POST') {
    const body = await readBody(req);
    const targetId = tierMatch[1];
    const newTier = body.tier === 'pro' ? 'pro' : 'free';
    await db.update(schema.user)
      .set({ tier: newTier, updatedAt: new Date() })
      .where(eq(schema.user.id, targetId));
    json(res, 200, { ok: true, tier: newTier });
    return true;
  }

  json(res, 404, { error: 'Admin route not found' });
  return true;
}

/**
 * Warmup Plan API — 30-day Reddit credibility building roadmap
 *
 * Routes (all authed):
 *   GET  /dashboard/warmup            → get plan state (null if not started)
 *   POST /dashboard/warmup/start      → start the plan
 *   POST /dashboard/warmup/check-in   → mark today done
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { getSessionFromRequest } from '../auth/session.js';
import { randomUUID } from 'node:crypto';

const { warmupPlan } = schema;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Phase definitions ─────────────────────────────────────────────

const PHASES = [
  {
    number: 1,
    range: [1, 7] as [number, number],
    name: 'Lurk & Learn',
    goal: 'Understand the community. Zero self-promotion.',
    task: 'Find 3 posts where you can add a genuinely helpful comment. No product mentions at all.',
    tip: 'Read what gets upvoted vs removed. Notice the community\'s language, inside jokes, and what questions get asked most.',
  },
  {
    number: 2,
    range: [8, 14] as [number, number],
    name: 'Familiar Face',
    goal: 'Build comment karma and become a recognisable name.',
    task: 'Reply to 2 posts with specific, useful advice. Still no product mentions.',
    tip: 'Redditors remember usernames that show up consistently with value. Be the helpful expert, not the marketer.',
  },
  {
    number: 3,
    range: [15, 21] as [number, number],
    name: 'Soft Mentions',
    goal: 'Introduce your product naturally where it genuinely solves the problem.',
    task: 'Find 1 post where your product directly answers their question. Mention it — in context, with disclosure.',
    tip: 'Always say "I built X..." never "Check out X...". Keep it 1 mention per 10 comments maximum.',
  },
  {
    number: 4,
    range: [22, 30] as [number, number],
    name: 'Founder Mode',
    goal: 'Engage as a trusted community member. Share your story.',
    task: 'Go deep in 1-2 threads. If a subreddit allows it, consider a genuine "I built X because I had this problem" post.',
    tip: 'Check your Subreddit Playbook before posting. Some communities love founder stories. Others ban them instantly.',
  },
] as const;

function getPhase(day: number) {
  return PHASES.find(p => day >= p.range[0] && day <= p.range[1]) ?? PHASES[3];
}

// ── Helpers ───────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 32_000) reject(new Error('Too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body) as Record<string, unknown>); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

function buildResponse(row: typeof warmupPlan.$inferSelect) {
  const elapsed = Math.floor((Date.now() - new Date(row.startedAt).getTime()) / DAY_MS);
  const currentDay = Math.min(30, elapsed + 1);
  const completedDays = (row.completedDays as number[]) ?? [];
  const phase = getPhase(currentDay);

  return {
    startedAt: row.startedAt,
    currentDay,
    completedDays,
    targetSubreddits: (row.targetSubreddits as string[]) ?? [],
    phase: { number: phase.number, name: phase.name, goal: phase.goal },
    todayTask: phase.task,
    todayTip: phase.tip,
    todayDone: completedDays.includes(currentDay),
    isComplete: currentDay === 30 && completedDays.includes(30),
  };
}

// ── Route handler ─────────────────────────────────────────────────

export async function handleWarmupRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/dashboard/warmup')) return false;

  const session = await getSessionFromRequest(req);
  if (!session) { json(res, 401, { error: 'Unauthorized' }); return true; }

  const db = getDb();
  const userId = session.user.id;
  const method = req.method ?? 'GET';

  // ── GET /dashboard/warmup ────────────────────────────────────
  if (url === '/dashboard/warmup' && method === 'GET') {
    const [row] = await db.select().from(warmupPlan).where(eq(warmupPlan.userId, userId)).limit(1);
    json(res, 200, { plan: row ? buildResponse(row) : null });
    return true;
  }

  // ── POST /dashboard/warmup/start ─────────────────────────────
  if (url === '/dashboard/warmup/start' && method === 'POST') {
    const [existing] = await db.select().from(warmupPlan).where(eq(warmupPlan.userId, userId)).limit(1);
    if (existing) {
      json(res, 200, { plan: buildResponse(existing) });
      return true;
    }
    const body = await readBody(req);
    const targetSubreddits = Array.isArray(body.targetSubreddits)
      ? (body.targetSubreddits as unknown[]).filter(s => typeof s === 'string').slice(0, 5) as string[]
      : [];

    const [inserted] = await db.insert(warmupPlan).values({
      id: randomUUID(),
      userId,
      targetSubreddits,
      completedDays: [],
    }).returning();

    json(res, 200, { plan: buildResponse(inserted) });
    return true;
  }

  // ── POST /dashboard/warmup/check-in ──────────────────────────
  if (url === '/dashboard/warmup/check-in' && method === 'POST') {
    const [row] = await db.select().from(warmupPlan).where(eq(warmupPlan.userId, userId)).limit(1);
    if (!row) { json(res, 404, { error: 'No warmup plan. Start one first.' }); return true; }

    const state = buildResponse(row);
    if (state.todayDone) {
      json(res, 200, { plan: state, alreadyDone: true });
      return true;
    }

    const newCompleted = [...state.completedDays, state.currentDay];
    await db.update(warmupPlan).set({ completedDays: newCompleted }).where(eq(warmupPlan.userId, userId));

    const [updated] = await db.select().from(warmupPlan).where(eq(warmupPlan.userId, userId)).limit(1);
    json(res, 200, { plan: buildResponse(updated), alreadyDone: false });
    return true;
  }

  return false;
}

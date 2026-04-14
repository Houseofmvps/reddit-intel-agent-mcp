/**
 * Cron scheduler — runs monitor scan cycles on a fixed interval
 * and the daily 8am UTC email digest for Pro users.
 *
 * Uses a simple setInterval approach (no external cron dependency).
 * The scanner is resilient to failures — each monitor is scanned independently.
 */

import { runScanCycle } from './scanner.js';
import { runDailyDigest } from './daily-digest.js';
import { getDb, schema } from '../db/index.js';
import { lt } from 'drizzle-orm';

const DEFAULT_INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 hour (scanner applies per-tier staleness)
const DAILY_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REPLY_CACHE_TTL_DAYS = 30;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let digestTimer: ReturnType<typeof setInterval> | null = null;
let digestInitialTimeout: ReturnType<typeof setTimeout> | null = null;
let running = false;
let digestRunning = false;

/**
 * Calculate milliseconds until the next 8:00 AM UTC from now.
 */
function msUntilNext8amUtc(): number {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(8, 0, 0, 0);

  // If we're past 8am UTC today, schedule for tomorrow
  if (now.getTime() >= target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * Start the monitor cron. Only starts if DATABASE_URL is set.
 */
export function startMonitorCron(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (!process.env.DATABASE_URL) {
    console.error('[cron] DATABASE_URL not set, monitor cron disabled');
    return;
  }

  if (scanTimer) {
    console.error('[cron] Already running');
    return;
  }

  console.error(`[cron] Starting monitor scanner (interval: ${intervalMs / 60_000}min)`);

  // Run first scan after a short delay (let server finish starting)
  setTimeout(() => {
    void runCycle();
  }, 30_000);

  scanTimer = setInterval(() => {
    void runCycle();
  }, intervalMs);

  // Don't keep process alive just for cron
  if (scanTimer && typeof scanTimer === 'object' && 'unref' in scanTimer) {
    scanTimer.unref();
  }

  // Start daily digest cron at 8am UTC
  startDailyDigestCron();

  // Weekly reply cache cleanup (runs once after 1 hour, then every 7 days)
  const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const cleanupTimer = setTimeout(() => {
    void runCacheCleanup();
    setInterval(() => void runCacheCleanup(), CLEANUP_INTERVAL_MS).unref();
  }, 60 * 60 * 1000);
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Schedule the daily digest to run at 8:00 AM UTC every day.
 *
 * Uses an initial setTimeout to align to the next 8am UTC,
 * then a 24-hour setInterval for subsequent runs.
 */
function startDailyDigestCron(): void {
  const delayMs = msUntilNext8amUtc();
  const delayMinutes = Math.round(delayMs / 60_000);
  const nextRun = new Date(Date.now() + delayMs);

  console.error(`[cron] Daily digest scheduled for 8:00 AM UTC (next run in ${delayMinutes}min at ${nextRun.toISOString()})`);

  digestInitialTimeout = setTimeout(() => {
    void runDigestCycle();

    digestTimer = setInterval(() => {
      void runDigestCycle();
    }, DAILY_DIGEST_INTERVAL_MS);

    if (digestTimer && typeof digestTimer === 'object' && 'unref' in digestTimer) {
      digestTimer.unref();
    }
  }, delayMs);

  if (digestInitialTimeout && typeof digestInitialTimeout === 'object' && 'unref' in digestInitialTimeout) {
    digestInitialTimeout.unref();
  }
}

async function runCycle(): Promise<void> {
  if (running) {
    console.error('[cron] Previous scan still running, skipping');
    return;
  }

  running = true;
  try {
    const stats = await runScanCycle();
    console.error(`[cron] Scan complete:`, JSON.stringify(stats));
  } catch (err) {
    console.error('[cron] Scan cycle failed:', err);
  } finally {
    running = false;
  }
}

async function runDigestCycle(): Promise<void> {
  if (digestRunning) {
    console.error('[cron] Previous digest still running, skipping');
    return;
  }

  digestRunning = true;
  try {
    const stats = await runDailyDigest();
    console.error(`[cron] Daily digest complete:`, JSON.stringify(stats));
  } catch (err) {
    console.error('[cron] Daily digest failed:', err);
  } finally {
    digestRunning = false;
  }
}

async function runCacheCleanup(): Promise<void> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - REPLY_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const result = await db.delete(schema.generatedReply)
      .where(lt(schema.generatedReply.createdAt, cutoff));
    console.error(`[cron] Reply cache cleanup: removed old cached replies (cutoff: ${cutoff.toISOString()})`);
    return result as unknown as void;
  } catch (err) {
    console.error('[cron] Reply cache cleanup failed:', err);
  }
}

export function stopMonitorCron(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (digestTimer) {
    clearInterval(digestTimer);
    digestTimer = null;
  }
  if (digestInitialTimeout) {
    clearTimeout(digestInitialTimeout);
    digestInitialTimeout = null;
  }
  console.error('[cron] Monitor cron and daily digest stopped');
}

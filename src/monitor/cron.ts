/**
 * Cron scheduler — runs monitor scan cycles on a fixed interval
 *
 * Uses a simple setInterval approach (no external cron dependency).
 * The scanner is resilient to failures — each monitor is scanned independently.
 */

import { runScanCycle } from './scanner.js';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Start the monitor cron. Only starts if DATABASE_URL is set.
 */
export function startMonitorCron(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (!process.env.DATABASE_URL) {
    console.error('[cron] DATABASE_URL not set, monitor cron disabled');
    return;
  }

  if (timer) {
    console.error('[cron] Already running');
    return;
  }

  console.error(`[cron] Starting monitor scanner (interval: ${intervalMs / 60_000}min)`);

  // Run first scan after a short delay (let server finish starting)
  setTimeout(() => {
    void runCycle();
  }, 30_000);

  timer = setInterval(() => {
    void runCycle();
  }, intervalMs);

  // Don't keep process alive just for cron
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
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

export function stopMonitorCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.error('[cron] Monitor cron stopped');
  }
}

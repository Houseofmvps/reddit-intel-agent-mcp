/**
 * Startup migration runner
 *
 * Runs idempotent SQL from drizzle/pending/*.sql on every boot.
 * Uses IF NOT EXISTS / IF EXISTS guards so re-runs are safe.
 * Logs each file applied. Exits process on failure so Railway
 * restarts the dyno rather than silently serving with a broken schema.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
// drizzle/ lives two levels up from src/db/
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle', 'pending');

export async function runStartupMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return; // validated earlier in index.ts

  let files: string[];
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    files = entries.filter(f => f.endsWith('.sql')).sort();
  } catch {
    // No pending/ directory — nothing to run
    return;
  }

  if (files.length === 0) return;

  const sql = postgres(url, { max: 1 });
  try {
    for (const file of files) {
      const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      console.error(`[migrate] Applying ${file}...`);
      await sql.unsafe(sqlText);
      console.error(`[migrate] ${file} applied`);
    }
  } catch (err) {
    console.error('[migrate] Migration failed — aborting startup:', err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();
}

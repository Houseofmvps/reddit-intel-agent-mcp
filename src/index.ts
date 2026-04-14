/**
 * Reddit Intelligence Agent — Entry point
 */

import { startStdio, startHttp } from './server.js';

function parseBool(val: string | undefined): boolean {
  if (!val) return false;
  return ['true', '1', 'yes', 'on'].includes(val.toLowerCase().trim());
}

function parsePort(val: string | undefined): number {
  const fallback = 3000;
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    console.error(`Invalid port "${val}" — using ${fallback}`);
    return fallback;
  }
  return n;
}

const isHttp = parseBool(process.env.REDDIT_INTEL_HTTP);
const port = parsePort(process.env.REDDIT_INTEL_PORT);

// Required env vars when running as HTTP server (dashboard mode)
if (isHttp) {
  const REQUIRED_HTTP_ENV: string[] = [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'CREDENTIAL_ENCRYPTION_KEY',
  ];
  const missing = REQUIRED_HTTP_ENV.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  if (!isHttp) process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

async function main() {
  if (isHttp) {
    await startHttp(port);
  } else {
    await startStdio();
  }
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

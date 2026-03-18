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

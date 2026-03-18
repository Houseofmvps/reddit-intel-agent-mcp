#!/usr/bin/env node

/**
 * Reddit Intelligence Agent — CLI
 */

import { RedditAuth } from './core/auth.js';
import { SERVER_VERSION } from './server.js';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import readline from 'readline/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function setupAuth(): Promise<void> {
  console.log('\n  Reddit Intelligence Agent — Authentication Setup\n');
  console.log('  This gives you up to 100 requests/minute instead of 10.\n');
  console.log('  Step 1: Go to https://www.reddit.com/prefs/apps');
  console.log('  Step 2: Click "Create App" → Type: "script"');
  console.log('  Step 3: Set Redirect URI to http://localhost:8080');
  console.log('  Step 4: Copy your Client ID and Secret below\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const clientId = await rl.question('  Client ID: ');
    if (!/^[A-Za-z0-9_-]{10,30}$/.test(clientId)) {
      console.error('\n  Invalid Client ID format (should be 10-30 alphanumeric chars)');
      process.exit(1);
    }

    const clientSecret = await rl.question('  Client Secret: ');
    if (!clientSecret || clientSecret.length < 20) {
      console.error('\n  Invalid Client Secret');
      process.exit(1);
    }

    console.log('\n  Optional: Add Reddit username/password for 100 req/min (leave blank for 60 req/min)\n');
    const username = await rl.question('  Reddit Username (optional): ');

    let password = '';
    if (username) {
      process.stdout.write('  Reddit Password: ');
      password = await new Promise<string>((resolve, reject) => {
        let pwd = '';
        const timeout = setTimeout(() => { reject(new Error('Timeout')); }, 60_000);

        try {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        } catch { reject(new Error('Cannot set raw mode')); return; }

        const handler = (chunk: Buffer) => {
          const ch = chunk.toString('utf8');
          if (ch === '\n' || ch === '\r' || ch === '\u0004') {
            clearTimeout(timeout);
            try { process.stdin.setRawMode(false); } catch {}
            process.stdin.pause();
            process.stdin.removeAllListeners('data');
            process.stdout.write('\n');
            resolve(pwd);
          } else if (ch === '\u0003') {
            clearTimeout(timeout);
            try { process.stdin.setRawMode(false); } catch {}
            process.exit();
          } else if (ch === '\u007f') {
            if (pwd.length > 0) { pwd = pwd.slice(0, -1); process.stdout.write('\b \b'); }
          } else if (pwd.length < 256) {
            pwd += ch;
            process.stdout.write('*');
          }
        };
        process.stdin.on('data', handler);
      });
    }

    console.log('\n  Testing credentials...');
    const auth = new RedditAuth();
    (auth as any).config = {
      clientId, clientSecret,
      username: username || undefined,
      password: password || undefined,
      userAgent: 'RedditIntelligenceAgent/0.1.0',
    };

    try {
      await auth.refreshToken();
      console.log('  Success! Authentication configured.');
      console.log(`  Mode: ${username ? 'Authenticated (100 req/min)' : 'App-Only (60 req/min)'}`);
      console.log('\n  Start the server: reddit-intel\n');
    } catch (err: unknown) {
      console.error('\n  Authentication failed. Check your credentials.');
      console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
      await auth.clearConfig();
      password = '';
      process.exit(1);
    } finally {
      password = '';
    }
  } finally {
    rl.close();
  }
}

function startServer(): void {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    const child = spawn('tsx', [join(__dirname, 'index.ts')], { stdio: 'inherit', env: { ...process.env } });
    child.on('error', (err) => { console.error('Failed to start dev server:', err.message); process.exit(1); });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    const serverPath = join(__dirname, 'index.js');
    import(pathToFileURL(serverPath).href).catch(err => {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    });
  }
}

// ─── CLI argument parsing ───────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--auth') || args.includes('-a')) {
  setupAuth().catch(err => { console.error('Setup failed:', err); process.exit(1); });
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Reddit Intelligence Agent v${SERVER_VERSION}
  Reddit Opportunity Intelligence — scored startup ideas, market signals, and buyer intent.

  Usage:
    reddit-intel                Start MCP server (stdio mode, for Claude Desktop)
    reddit-intel --http         Start dual-protocol server (MCP + REST, for ChatGPT/Gemini/web)
    reddit-intel --auth         Set up Reddit authentication (optional, for higher rate limits)
    reddit-intel --version      Show version
    reddit-intel --help         Show this help

  Environment:
    REDDIT_INTEL_CLIENT_ID      Reddit app client ID
    REDDIT_INTEL_CLIENT_SECRET  Reddit app client secret
    REDDIT_INTEL_USERNAME       Reddit username (optional, for 100 req/min)
    REDDIT_INTEL_PASSWORD       Reddit password (optional, for 100 req/min)
    REDDIT_INTEL_HTTP           Run HTTP server (true/false)
    REDDIT_INTEL_PORT           HTTP port (default: 3000)
    REDDIT_INTEL_TIER           Product tier (free/pro/team)
    REDDIT_INTEL_LICENSE_KEY    License key for Pro/Team

  Integrations:
    Claude Desktop: Add to claude_desktop_config.json with "npx reddit-intel-agent-mcp"
    Claude Code:    claude mcp add --transport stdio reddit-intel -s user -- npx -y reddit-intel-agent-mcp
    ChatGPT:        Start with --http, use /api/openapi.json for custom GPT Actions
    Gemini:         Start with --http, use /api/tools/* REST endpoints
    Any MCP client: Use stdio transport with "npx reddit-intel-agent-mcp"
`);
} else if (args.includes('--version') || args.includes('-v')) {
  console.log(`reddit-intelligence-agent v${SERVER_VERSION}`);
} else {
  if (args.includes('--http')) process.env.REDDIT_INTEL_HTTP = 'true';
  startServer();
}

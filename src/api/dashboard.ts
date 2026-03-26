/**
 * Dashboard API — authenticated routes for Pro dashboard
 *
 * All routes require a valid session (cookie-based, no Better Auth).
 * Pattern matches src/api/rest.ts — returns boolean (handled or not).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getSessionFromRequest } from '../auth/session.js';
import { getDb, schema } from '../db/index.js';
import { encrypt, decrypt } from '../db/crypto.js';
import { eq, and, desc, sql, gte } from 'drizzle-orm';
import { buildAuthorizationUrl, exchangeCodeForTokens, getRedditUsername, isRedditOAuthConfigured } from './reddit-oauth.js';
import { randomBytes } from 'crypto';
import { runSingleMonitorScan } from '../monitor/scanner.js';

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

  // ── GET /dashboard/composio/login — Start Reddit login via Composio (no auth) ──
  if (url === '/dashboard/composio/login' && req.method === 'GET') {
    try {
      const { getRedditConnectLink } = await import('../core/composio-auth.js');
      const { randomUUID } = await import('crypto');
      // Use a temp ID; embed it in the callback URL so we can retrieve it without DB lookup
      const tempId = `pending_${randomUUID()}`;
      const baseCallback = `${process.env.BETTER_AUTH_URL || 'https://api.buildradar.xyz'}/dashboard/composio/callback`;
      const callbackUrl = `${baseCallback}?composio_user=${encodeURIComponent(tempId)}`;
      const result = await getRedditConnectLink(tempId, callbackUrl);
      console.log(`[composio] login initiated: tempId=${tempId}, redirectUrl=${result.redirectUrl?.slice(0, 80)}...`);
      res.writeHead(302, { Location: result.redirectUrl });
      res.end();
    } catch (err) {
      console.error('[composio] login initiation error:', err);
      const frontendOrigin = process.env.FRONTEND_URL || 'https://buildradar.xyz';
      res.writeHead(302, { Location: `${frontendOrigin}/app/login?error=reddit_unavailable` });
      res.end();
    }
    return true;
  }

  // ── GET /dashboard/composio/callback — Handle Composio OAuth callback, create session ──
  // Composio appends ?status=success&connected_account_id=... to callback URL
  if (url.startsWith('/dashboard/composio/callback')) {
    const frontendOrigin = process.env.FRONTEND_URL || 'https://buildradar.xyz';
    try {
      const { getComposio } = await import('../core/composio-auth.js');
      const { randomUUID } = await import('crypto');
      const composio = getComposio();
      const db = getDb();

      // Parse query params from callback
      const callbackUrl = new URL(url, `${process.env.BETTER_AUTH_URL || 'https://api.buildradar.xyz'}`);
      const status = callbackUrl.searchParams.get('status');
      const connectedAccountId = callbackUrl.searchParams.get('connected_account_id');
      const composioEntityId = callbackUrl.searchParams.get('composio_user') || '';

      console.log(`[composio] callback: status=${status}, connected_account_id=${connectedAccountId}, composio_user=${composioEntityId}`);

      if (!connectedAccountId) {
        console.error('[composio] callback: missing connected_account_id');
        res.writeHead(302, { Location: `${frontendOrigin}/app/login?error=connection_failed` });
        res.end();
        return true;
      }

      if (status === 'failed') {
        console.error('[composio] callback: Composio reported failure');
        res.writeHead(302, { Location: `${frontendOrigin}/app/login?error=connection_failed` });
        res.end();
        return true;
      }

      // ── Step 1: Verify the connected account and extract access token ──
      // SDK method is .get(), not .retrieve()
      let accountStatus = 'UNKNOWN';
      let redditAccessToken = '';
      let redditUsername = '';
      try {
        const account = await composio.connectedAccounts.get(connectedAccountId);
        accountStatus = account?.status || 'UNKNOWN';
        console.log(`[composio] Connected account ${connectedAccountId} status: ${accountStatus}`);

        // Access token is in account.data (not connectionParams)
        const data = (account as any)?.data || {};
        redditAccessToken = data?.access_token || '';
        if (redditAccessToken) {
          console.log(`[composio] Got Reddit access token from account.data`);
        }
      } catch (err) {
        console.warn('[composio] Could not get connected account:', (err as Error).message);
      }

      // ── Step 2: Get Reddit username via Composio tool execution ──
      if (!redditUsername && composioEntityId) {
        try {
          const meResult = await composio.tools.execute('REDDIT_GET_REDDIT_USER_ABOUT', {
            userId: composioEntityId,
            arguments: { username: 'me' },
            version: '20260316_00',
          });
          const meData = (meResult as any)?.data?.data || (meResult as any)?.data || {};
          redditUsername = meData?.name || '';
          if (redditUsername) console.log(`[composio] Got Reddit username via REDDIT_GET_REDDIT_USER_ABOUT: ${redditUsername}`);
        } catch (err) {
          console.warn('[composio] REDDIT_GET_REDDIT_USER_ABOUT failed:', (err as Error).message);
        }
      }

      // ── Step 4: Fallback username ──
      if (!redditUsername) {
        redditUsername = `reddit_${connectedAccountId.slice(-8)}`;
        console.log(`[composio] Using fallback username: ${redditUsername}`);
      }

      const email = `${redditUsername}@reddit.buildradar.xyz`;

      // ── Step 5: Find existing user — try multiple lookups to prevent duplicates ──
      let [existingUser] = await db.select().from(schema.user)
        .where(eq(schema.user.composioConnectedAccountId, connectedAccountId));

      // Check by email (stable across logins for same Reddit user)
      if (!existingUser) {
        [existingUser] = await db.select().from(schema.user).where(eq(schema.user.email, email));
      }

      // Check by entity ID
      if (!existingUser && composioEntityId) {
        [existingUser] = await db.select().from(schema.user)
          .where(eq(schema.user.composioEntityId, composioEntityId));
      }

      // If we resolved a real Reddit username, search for any existing user with
      // a fallback reddit_ name — they're the same person from a previous login
      if (!existingUser && !redditUsername.startsWith('reddit_')) {
        const { like } = await import('drizzle-orm');
        const redditUsers = await db.select().from(schema.user)
          .where(like(schema.user.email, '%@reddit.buildradar.xyz'));
        // If there's only one reddit-auth user, it must be this person
        if (redditUsers.length === 1) {
          [existingUser] = redditUsers;
          console.log(`[auth] Found existing reddit user ${existingUser.id} (${existingUser.name}), merging`);
        }
      }

      if (!existingUser) {
        const userId = randomUUID();
        await db.insert(schema.user).values({
          id: userId,
          name: redditUsername,
          email,
          emailVerified: false,
          tier: 'free',
          composioEntityId: composioEntityId || null,
          composioConnectedAccountId: connectedAccountId,
        });
        [existingUser] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
        console.log(`[auth] Created new user for Reddit u/${redditUsername} (${userId})`);
      } else {
        // Update existing user with latest Composio IDs and real username if resolved
        const updatedName = !redditUsername.startsWith('reddit_') ? redditUsername : existingUser.name;
        const updatedEmail = !redditUsername.startsWith('reddit_') ? email : existingUser.email;
        await db.update(schema.user)
          .set({
            composioEntityId: composioEntityId || existingUser.composioEntityId,
            composioConnectedAccountId: connectedAccountId,
            name: updatedName,
            email: updatedEmail,
            updatedAt: new Date(),
          })
          .where(eq(schema.user.id, existingUser.id));
        console.log(`[auth] Updated existing user ${existingUser.id}: name=${updatedName}, composioEntity=${composioEntityId}`);
      }

      // Create session
      const sessionToken = randomUUID();
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.insert(schema.session).values({
        id: sessionId,
        token: sessionToken,
        userId: existingUser.id,
        expiresAt,
        ipAddress: req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
      });

      // Set the session cookie and redirect to dashboard
      const isSecure = (process.env.BETTER_AUTH_URL || '').startsWith('https');
      const cookieValue = `buildradar.session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${isSecure ? '; Secure' : ''}; Domain=${isSecure ? '.buildradar.xyz' : ''}`;

      console.log(`[auth] Reddit login successful for u/${redditUsername}, redirecting to dashboard`);
      res.writeHead(302, {
        'Set-Cookie': cookieValue,
        Location: `${frontendOrigin}/app`,
      });
      res.end();
    } catch (err) {
      console.error('[composio] callback error:', err);
      res.writeHead(302, { Location: `${frontendOrigin}/app/login?error=auth_failed` });
      res.end();
    }
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

  // Look up user tier for pro-gating
  const [currentUser] = await db.select({ tier: schema.user.tier }).from(schema.user).where(eq(schema.user.id, userId));
  const userTier = currentUser?.tier ?? 'free';
  const isPro = userTier === 'pro';

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
      emailAlertsEnabled: u.emailAlertsEnabled,
      dailyDigestEnabled: u.dailyDigestEnabled,
      createdAt: u.createdAt,
    });
    return true;
  }

  // ── PUT /dashboard/me ──
  if (url === '/dashboard/me' && req.method === 'PUT') {
    const body = await readBody(req) as { name?: string; emailAlertsEnabled?: boolean; dailyDigestEnabled?: boolean } | null;
    if (!body) { json(res, 400, { error: 'Request body required' }); return true; }

    const updates: Record<string, unknown> = {};
    if ('name' in body) updates.name = body.name;
    if ('emailAlertsEnabled' in body) updates.emailAlertsEnabled = body.emailAlertsEnabled;
    if ('dailyDigestEnabled' in body) updates.dailyDigestEnabled = body.dailyDigestEnabled;

    if (Object.keys(updates).length === 0) {
      json(res, 400, { error: 'At least one field required (name, emailAlertsEnabled, dailyDigestEnabled)' });
      return true;
    }

    updates.updatedAt = new Date();
    await db.update(schema.user).set(updates).where(eq(schema.user.id, userId));

    const [updated] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    json(res, 200, {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      tier: updated.tier,
      emailAlertsEnabled: updated.emailAlertsEnabled,
      dailyDigestEnabled: updated.dailyDigestEnabled,
    });
    return true;
  }

  // ── DELETE /dashboard/me ──
  if (url === '/dashboard/me' && req.method === 'DELETE') {
    // Try to revoke Composio connection
    const [usr] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    if (usr?.composioConnectedAccountId) {
      try {
        const { Composio } = await import('@composio/core');
        const composio = new Composio();
        await composio.connectedAccounts.delete(usr.composioConnectedAccountId);
      } catch (err) {
        console.warn('[settings] Could not revoke Composio connection:', (err as Error).message);
      }
    }

    // Delete sessions and user (FK cascades handle related data)
    await db.delete(schema.session).where(eq(schema.session.userId, userId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));

    // Clear session cookie
    res.setHeader('Set-Cookie', 'buildradar.session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    json(res, 200, { deleted: true });
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
      if (existing.length >= 3) {
        json(res, 403, { error: 'Free tier allows 3 monitors. Upgrade to Pro for unlimited.' });
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

    // Trigger first scan immediately in background (don't wait for cron)
    runSingleMonitorScan(mon.id, userId).catch(err => {
      console.error(`[dashboard] First scan failed for new monitor ${mon.id}:`, err);
    });

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

  // ── POST /dashboard/monitors/:id/scan — Trigger immediate scan ──
  const monScanMatch = url.match(/^\/dashboard\/monitors\/([a-f0-9-]+)\/scan$/);
  if (monScanMatch && req.method === 'POST') {
    const monitorId = monScanMatch[1];

    // Verify monitor belongs to this user
    const [monitor] = await db.select().from(schema.monitor)
      .where(and(eq(schema.monitor.id, monitorId), eq(schema.monitor.userId, userId)));

    if (!monitor) {
      json(res, 404, { error: 'Monitor not found' });
      return true;
    }

    // Fire and forget — don't block the response
    runSingleMonitorScan(monitorId, userId).catch(err => {
      console.error(`[dashboard] Background scan failed for monitor ${monitorId}:`, err);
    });

    json(res, 200, { scanning: true, message: 'Scan triggered' });
    return true;
  }

  // ── GET /dashboard/results ──
  if (url.startsWith('/dashboard/results') && req.method === 'GET') {
    const allResults = await db.select().from(schema.scanResult)
      .where(eq(schema.scanResult.userId, userId))
      .orderBy(schema.scanResult.createdAt)
      .limit(50);

    if (isPro) {
      json(res, 200, { results: allResults, gatedCount: 0 });
    } else {
      const visible = allResults.filter(r => r.score < 70);
      const gated = allResults.filter(r => r.score >= 70);
      const lockedPreviews = gated.map(r => ({
        id: r.id,
        title: r.title,
        score: r.score,
        subreddit: r.subreddit,
        locked: true,
      }));
      json(res, 200, { results: visible, gatedCount: gated.length, lockedResults: lockedPreviews });
    }
    return true;
  }

  // ── GET /dashboard/leads ──
  if (url === '/dashboard/leads' && req.method === 'GET') {
    const allLeads = await db.select().from(schema.lead).where(eq(schema.lead.userId, userId));

    if (isPro) {
      json(res, 200, { leads: allLeads, gatedCount: 0 });
    } else {
      const visible = allLeads.slice(0, 20);
      const gatedCount = Math.max(0, allLeads.length - 20);
      json(res, 200, { leads: visible, gatedCount });
    }
    return true;
  }

  // ── PUT /dashboard/leads/:id ──
  const leadUpdateMatch = url.match(/^\/dashboard\/leads\/([a-f0-9-]+)$/);
  if (leadUpdateMatch && req.method === 'PUT') {
    const body = await readBody(req) as { status?: string; notes?: string | null } | null;
    if (!body) { json(res, 400, { error: 'Request body required' }); return true; }

    const hasStatus = 'status' in body;
    const hasNotes = 'notes' in body;
    if (!hasStatus && !hasNotes) {
      json(res, 400, { error: 'At least one of status or notes is required' });
      return true;
    }

    if (hasStatus && (!body.status || !['new', 'contacted', 'converted'].includes(body.status))) {
      json(res, 400, { error: 'status must be one of: new, contacted, converted' });
      return true;
    }

    const updates: Record<string, unknown> = { lastActive: new Date() };
    if (hasStatus) updates.status = body.status;
    if (hasNotes) updates.notes = body.notes ?? null;

    await db.update(schema.lead)
      .set(updates)
      .where(and(
        eq(schema.lead.id, leadUpdateMatch[1]),
        eq(schema.lead.userId, userId),
      ));
    json(res, 200, { updated: true });
    return true;
  }

  // ── GET /dashboard/reddit/connect — Initiate Reddit OAuth ──
  if (url === '/dashboard/reddit/connect' && req.method === 'GET') {
    if (!isRedditOAuthConfigured()) {
      json(res, 503, { error: 'Reddit OAuth not configured on this server' });
      return true;
    }
    const state = encrypt(JSON.stringify({ userId, nonce: randomBytes(16).toString('hex'), ts: Date.now() }));
    const authUrl = buildAuthorizationUrl(state);
    json(res, 200, { url: authUrl });
    return true;
  }

  // ── GET /dashboard/reddit/callback — Handle Reddit OAuth redirect ──
  if (url.startsWith('/dashboard/reddit/callback') && req.method === 'GET') {
    const frontendBase = process.env.BETTER_AUTH_URL?.replace('api.', '') || 'https://buildradar.xyz';
    const settingsUrl = `${frontendBase}/app/settings`;

    try {
      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const code = parsedUrl.searchParams.get('code');
      const state = parsedUrl.searchParams.get('state');
      const error = parsedUrl.searchParams.get('error');

      if (error) {
        redirect(res, `${settingsUrl}?reddit=error&reason=${encodeURIComponent(error)}`);
        return true;
      }

      if (!code || !state) {
        redirect(res, `${settingsUrl}?reddit=error&reason=missing_params`);
        return true;
      }

      // Validate state
      let stateData: { userId: string; ts: number };
      try {
        stateData = JSON.parse(decrypt(state));
      } catch {
        redirect(res, `${settingsUrl}?reddit=error&reason=invalid_state`);
        return true;
      }

      if (stateData.userId !== userId) {
        redirect(res, `${settingsUrl}?reddit=error&reason=user_mismatch`);
        return true;
      }

      if (Date.now() - stateData.ts > 10 * 60 * 1000) {
        redirect(res, `${settingsUrl}?reddit=error&reason=expired`);
        return true;
      }

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code);
      const redditUsername = await getRedditUsername(tokens.access_token);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // Upsert — one connection per user
      const existing = await db.select().from(schema.redditOAuthConnection).where(eq(schema.redditOAuthConnection.userId, userId));
      if (existing.length > 0) {
        await db.update(schema.redditOAuthConnection)
          .set({
            redditUsername,
            accessToken: encrypt(tokens.access_token),
            refreshToken: encrypt(tokens.refresh_token),
            scope: tokens.scope,
            expiresAt,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(schema.redditOAuthConnection.userId, userId));
      } else {
        await db.insert(schema.redditOAuthConnection).values({
          userId,
          redditUsername,
          accessToken: encrypt(tokens.access_token),
          refreshToken: encrypt(tokens.refresh_token),
          scope: tokens.scope,
          expiresAt,
        });
      }

      redirect(res, `${settingsUrl}?reddit=connected`);
    } catch (err) {
      console.error('[reddit-oauth] callback error:', err);
      redirect(res, `${settingsUrl}?reddit=error&reason=exchange_failed`);
    }
    return true;
  }

  // ── GET /dashboard/reddit/status — Check Reddit connection ──
  if (url === '/dashboard/reddit/status' && req.method === 'GET') {
    const [conn] = await db.select().from(schema.redditOAuthConnection).where(eq(schema.redditOAuthConnection.userId, userId));
    if (!conn || conn.status === 'revoked') {
      json(res, 200, { connected: false });
    } else {
      json(res, 200, {
        connected: true,
        redditUsername: conn.redditUsername,
        scope: conn.scope,
        connectedAt: conn.createdAt,
        status: conn.status,
      });
    }
    return true;
  }

  // ── DELETE /dashboard/reddit/disconnect — Remove Reddit connection ──
  if (url === '/dashboard/reddit/disconnect' && req.method === 'DELETE') {
    await db.delete(schema.redditOAuthConnection).where(eq(schema.redditOAuthConnection.userId, userId));
    json(res, 200, { disconnected: true });
    return true;
  }

  // ── GET /dashboard/composio/connect — Get Composio Connect Link (re-connect) ──
  if (url === '/dashboard/composio/connect' && req.method === 'GET') {
    try {
      const { getRedditConnectLink } = await import('../core/composio-auth.js');
      const { randomUUID } = await import('crypto');
      const composioId = `reconnect_${randomUUID()}`;
      const baseCallback = `${process.env.BETTER_AUTH_URL || 'https://api.buildradar.xyz'}/dashboard/composio/callback`;
      const callbackUrl = `${baseCallback}?composio_user=${encodeURIComponent(composioId)}`;
      const result = await getRedditConnectLink(composioId, callbackUrl);
      await db.update(schema.user).set({ composioEntityId: composioId }).where(eq(schema.user.id, userId));
      json(res, 200, { url: result.redirectUrl });
    } catch (err) {
      console.error('[composio] connect error:', err);
      json(res, 503, { error: 'Reddit connection service unavailable' });
    }
    return true;
  }

  // ── GET /dashboard/composio/status — Check Composio Reddit connection ──
  if (url === '/dashboard/composio/status' && req.method === 'GET') {
    try {
      const [usr] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
      const connAccountId = usr?.composioConnectedAccountId;

      if (!connAccountId) {
        json(res, 200, { connected: false, connectionId: null });
        return true;
      }

      // Check connection status directly via connected account ID
      let connected = false;
      try {
        const { getComposio } = await import('../core/composio-auth.js');
        const composio = getComposio();
        const account = await composio.connectedAccounts.get(connAccountId);
        connected = account?.status === 'ACTIVE';
      } catch {
        // If retrieve fails, fall back to checking via entity ID
        const { checkRedditConnection } = await import('../core/composio-auth.js');
        const entityId = usr?.composioEntityId;
        if (entityId) {
          const result = await checkRedditConnection(entityId);
          connected = result.connected;
        }
      }

      json(res, 200, { connected, connectionId: connAccountId });
    } catch (err) {
      console.error('[composio] status check error:', err);
      json(res, 200, { connected: false, connectionId: null });
    }
    return true;
  }

  // ── GET /dashboard/reply-templates ──
  if (url === '/dashboard/reply-templates' && req.method === 'GET') {
    json(res, 200, { templates: REPLY_TEMPLATES });
    return true;
  }

  // ── GET /dashboard/subreddit-recommendations?product=... ──
  if (url.startsWith('/dashboard/subreddit-recommendations') && req.method === 'GET') {
    const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const product = parsedUrl.searchParams.get('product')?.toLowerCase().trim();
    if (!product) {
      json(res, 400, { error: 'product query parameter is required' });
      return true;
    }

    const matched = new Set<string>();
    for (const [category, subreddits] of Object.entries(SUBREDDIT_MAP)) {
      if (product.includes(category)) {
        for (const sub of subreddits) matched.add(sub);
      }
    }

    // Also match category keywords that might appear as substrings
    const CATEGORY_KEYWORDS: Record<string, string[]> = {
      saas: ['saas', 'software', 'subscription', 'b2b', 'platform'],
      devtools: ['developer', 'dev', 'api', 'sdk', 'cli', 'code', 'programming'],
      marketing: ['marketing', 'seo', 'ads', 'content', 'social media', 'growth'],
      ecommerce: ['ecommerce', 'e-commerce', 'shop', 'store', 'retail', 'commerce'],
      fintech: ['fintech', 'finance', 'payment', 'banking', 'invoice', 'accounting'],
      ai: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'gpt', 'neural'],
      design: ['design', 'ui', 'ux', 'figma', 'prototype'],
      productivity: ['productivity', 'project management', 'task', 'workflow', 'automation', 'notion'],
      education: ['education', 'learning', 'course', 'teaching', 'edtech', 'tutorial'],
      health: ['health', 'medical', 'fitness', 'wellness', 'telehealth'],
    };

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some(kw => product.includes(kw))) {
        const subreddits = SUBREDDIT_MAP[category];
        if (subreddits) {
          for (const sub of subreddits) matched.add(sub);
        }
      }
    }

    // If no matches, return general startup/business subreddits
    if (matched.size === 0) {
      for (const sub of ['startups', 'entrepreneur', 'smallbusiness', 'indiehackers', 'SideProject']) {
        matched.add(sub);
      }
    }

    json(res, 200, {
      product,
      subreddits: [...matched],
      count: matched.size,
    });
    return true;
  }

  // ── PUT /dashboard/leads/bulk — Bulk update lead statuses ──
  if (url === '/dashboard/leads/bulk' && req.method === 'PUT') {
    const body = await readBody(req) as { ids?: string[]; status?: string } | null;
    if (!body?.ids?.length || !body?.status || !['new', 'contacted', 'converted'].includes(body.status)) {
      json(res, 400, { error: 'ids (array) and status (new|contacted|converted) required' });
      return true;
    }

    let updated = 0;
    for (const id of body.ids) {
      await db.update(schema.lead)
        .set({ status: body.status, lastActive: new Date() })
        .where(and(eq(schema.lead.id, id), eq(schema.lead.userId, userId)));
      updated++;
    }

    json(res, 200, { updated });
    return true;
  }

  // ── GET /dashboard/export-check — Check if user can export (Pro feature) ──
  if (url === '/dashboard/export-check' && req.method === 'GET') {
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    json(res, 200, { canExport: u?.tier === 'pro', tier: u?.tier || 'free' });
    return true;
  }

  // ── GET /dashboard/dossiers ──
  if (url === '/dashboard/dossiers' && req.method === 'GET') {
    const allDossiers = await db.select().from(schema.leadDossier)
      .where(eq(schema.leadDossier.userId, userId))
      .orderBy(desc(schema.leadDossier.conversionScore))
      .limit(50);

    if (isPro) {
      json(res, 200, { dossiers: allDossiers, gatedCount: 0 });
    } else {
      const visible = allDossiers.filter(d => d.conversionScore < 70);
      const gatedCount = allDossiers.length - visible.length;
      json(res, 200, { dossiers: visible, gatedCount });
    }
    return true;
  }

  // ── PUT /dashboard/dossiers/:id/status ──
  if (url.match(/^\/dashboard\/dossiers\/[^/]+\/status$/) && req.method === 'PUT') {
    const dossierId = url.split('/')[3]; // extract ID from URL
    const body = await readBody(req) as { status?: string; notes?: string } | null;
    if (!body?.status) { json(res, 400, { error: 'status is required' }); return true; }

    const [dossier] = await db.select().from(schema.leadDossier)
      .where(and(eq(schema.leadDossier.id, dossierId), eq(schema.leadDossier.userId, userId)));
    if (!dossier) { json(res, 404, { error: 'Not found' }); return true; }

    const updateData: Record<string, any> = { status: body.status, updatedAt: new Date() };
    if (body.status === 'replied') updateData.repliedAt = new Date();
    if (body.status === 'converted') updateData.convertedAt = new Date();

    await db.update(schema.leadDossier).set(updateData)
      .where(eq(schema.leadDossier.id, dossierId));

    // Log conversion event
    await db.insert(schema.conversionEvent).values({
      dossierId: dossier.id,
      userId,
      fromStatus: dossier.status,
      toStatus: body.status,
      notes: body.notes,
    });

    json(res, 200, { success: true });
    return true;
  }

  // ── GET /dashboard/conversion-stats ──
  if (url === '/dashboard/conversion-stats' && req.method === 'GET') {
    const { sql } = await import('drizzle-orm');
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'replied')::int AS replied,
        COUNT(*) FILTER (WHERE status = 'converted')::int AS converted,
        COUNT(*) FILTER (WHERE status = 'passed')::int AS passed,
        COALESCE(ROUND(AVG(conversion_score))::int, 0) AS avg_score,
        COUNT(*) FILTER (WHERE conversion_label = 'hot' AND status = 'pending')::int AS hot_leads
      FROM lead_dossier
      WHERE user_id = ${userId}
    `);

    const row = (result as any)?.[0] ?? {};
    const total = row.total ?? 0;
    const converted = row.converted ?? 0;

    json(res, 200, {
      total,
      pending: row.pending ?? 0,
      replied: row.replied ?? 0,
      converted,
      passed: row.passed ?? 0,
      conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
      avgScore: row.avg_score ?? 0,
      hotLeads: row.hot_leads ?? 0,
    });
    return true;
  }

  // ── POST /dashboard/generate-reply ──
  if (url === '/dashboard/generate-reply' && req.method === 'POST') {
    const body = await readBody(req) as { resultId?: string; productContext?: string } | null;
    if (!body?.resultId) {
      json(res, 400, { error: 'resultId is required' });
      return true;
    }

    // Rate limit: count today's generations
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [countRow] = await db.select({ count: sql<number>`count(*)` })
      .from(schema.generatedReply)
      .where(and(
        eq(schema.generatedReply.userId, userId),
        gte(schema.generatedReply.createdAt, today)
      ));
    const dailyCount = Number(countRow?.count || 0);

    // Check user tier
    const [me] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    const limit = me?.tier === 'pro' ? 50 : 3;
    if (dailyCount >= limit) {
      json(res, 429, {
        error: me?.tier === 'pro'
          ? 'Daily reply limit reached (50/day)'
          : 'Free tier limit reached (3/day). Upgrade to Pro for 50 replies/day.',
        tier: me?.tier,
        limit,
        used: dailyCount,
      });
      return true;
    }

    // Check cache first
    const existing = await db.select().from(schema.generatedReply)
      .where(and(
        eq(schema.generatedReply.userId, userId),
        eq(schema.generatedReply.resultId, body.resultId),
      ));
    if (existing.length > 0) {
      json(res, 200, { replies: existing.map(r => ({ tone: r.tone, text: r.replyText })), cached: true });
      return true;
    }

    // Load result + monitor context
    const [result] = await db.select().from(schema.scanResult)
      .where(eq(schema.scanResult.id, body.resultId));
    if (!result) {
      json(res, 404, { error: 'Result not found' });
      return true;
    }

    const [monitorRow] = result.monitorId
      ? await db.select().from(schema.monitor).where(eq(schema.monitor.id, result.monitorId))
      : [null];

    try {
      const { generateReplies } = await import('./reply-engine.js');
      const replies = await generateReplies({
        postTitle: result.title,
        postQuote: result.quote || '',
        subreddit: result.subreddit,
        signals: (result.signals as string[]) || [],
        score: result.score,
        productDescription: body.productContext || monitorRow?.name || 'my SaaS product',
        keywords: (monitorRow?.keywords as string[]) || [],
      });

      // Cache the replies
      for (const reply of replies) {
        await db.insert(schema.generatedReply).values({
          userId,
          resultId: body.resultId,
          tone: reply.tone,
          replyText: reply.text,
          model: 'claude-haiku-4-5-20251001',
        });
      }

      json(res, 200, { replies, cached: false, remaining: limit - dailyCount - 1 });
    } catch (err) {
      console.error('[reply-engine] generation error:', err);
      json(res, 500, { error: 'Failed to generate replies' });
    }
    return true;
  }

  json(res, 404, { error: 'Dashboard route not found' });
  return true;
}

// ── Static data ──

const REPLY_TEMPLATES: Record<string, { name: string; template: string; tips: string }> = {
  pain_point: {
    name: 'Pain Point Response',
    template: "Hey! I noticed you're dealing with {pain}. We built {product} specifically to solve this — it {key_benefit}. Happy to give you a free trial if you want to check it out. No pressure!",
    tips: 'Acknowledge their pain first, then position your solution. Keep it genuine and helpful, not salesy.',
  },
  buyer_intent: {
    name: 'Buyer Intent Response',
    template: "Great question! I'm the founder of {product} — we do exactly this. {brief_pitch}. Would love to give you a walkthrough if you're interested. What's your main use case?",
    tips: "They're already looking to buy. Be direct about what you offer. Ask about their specific needs.",
  },
  switching: {
    name: 'Switching Intent Response',
    template: 'I hear you — a lot of people have been switching from {competitor} lately. We built {product} as an alternative that {differentiator}. Happy to share a comparison if helpful!',
    tips: "Don't trash the competitor. Focus on what makes you different. Offer proof.",
  },
  feature_request: {
    name: 'Feature Request Response',
    template: 'That\'s a great idea! We actually just built something similar in {product}. {feature_description}. Would love your feedback on our approach — want to try it out?',
    tips: "Show you're listening. If you don't have the feature yet, say you're considering it.",
  },
  pricing_objection: {
    name: 'Pricing Objection Response',
    template: 'Totally get it — pricing matters. We built {product} at {price} because we wanted it accessible for {audience}. It includes {value_props}. Happy to extend a trial so you can see the ROI first.',
    tips: "Don't compete on price alone. Emphasize value. Offer a trial to reduce risk.",
  },
  workaround: {
    name: 'Workaround Response',
    template: "Nice hack! If you're tired of the manual work, we built {product} to automate exactly this. Takes about {setup_time} to set up. Might save you some time!",
    tips: 'Compliment their resourcefulness. Show how your product replaces the manual work.',
  },
};

const SUBREDDIT_MAP: Record<string, string[]> = {
  saas: ['SaaS', 'startups', 'entrepreneur', 'smallbusiness', 'indiehackers'],
  devtools: ['programming', 'webdev', 'devops', 'node', 'reactjs', 'golang'],
  marketing: ['marketing', 'digital_marketing', 'SEO', 'socialmedia', 'PPC'],
  ecommerce: ['ecommerce', 'shopify', 'dropshipping', 'FulfillmentByAmazon'],
  fintech: ['fintech', 'personalfinance', 'smallbusiness', 'accounting', 'tax'],
  ai: ['artificial', 'MachineLearning', 'ChatGPT', 'LocalLLaMA', 'singularity'],
  design: ['web_design', 'UI_Design', 'userexperience', 'graphic_design'],
  productivity: ['productivity', 'Notion', 'ObsidianMD', 'PKMS', 'projectmanagement'],
  education: ['edtech', 'learnprogramming', 'OnlineEducation', 'education'],
  health: ['healthIT', 'digitalhealth', 'fitness', 'nutrition'],
};

// ── Helpers ──

function redirect(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url });
  res.end();
}

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

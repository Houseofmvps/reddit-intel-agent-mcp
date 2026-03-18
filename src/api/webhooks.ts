/**
 * Polar.sh webhook handler — auto-activates Pro tier on subscription
 *
 * Events handled:
 *   subscription.created  → activate Pro
 *   subscription.updated  → activate/deactivate based on status
 *   subscription.canceled → downgrade to free
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const MAX_BODY = 256 * 1024; // 256KB

export async function handleWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/webhooks/')) return false;

  // ── POST /webhooks/polar ──
  if (url === '/webhooks/polar' && req.method === 'POST') {
    await handlePolarWebhook(req, res);
    return true;
  }

  json(res, 404, { error: 'Webhook not found' });
  return true;
}

async function handlePolarWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    json(res, 503, { error: 'Webhook not configured' });
    return;
  }

  const rawBody = await readRawBody(req);
  if (!rawBody) {
    json(res, 400, { error: 'Invalid body' });
    return;
  }

  // Verify signature
  const signature = req.headers['webhook-signature'] as string | undefined;
  if (!signature || !verifyPolarSignature(rawBody, signature, secret)) {
    json(res, 401, { error: 'Invalid signature' });
    return;
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }

  console.error(`[webhook] Polar event: ${event.type}`);

  try {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.updated':
        await handleSubscription(event.data);
        break;
      case 'subscription.canceled':
        await handleCancellation(event.data);
        break;
      default:
        console.error(`[webhook] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error(`[webhook] Error processing ${event.type}:`, err);
    json(res, 500, { error: 'Processing failed' });
    return;
  }

  json(res, 200, { received: true });
}

async function handleSubscription(data: Record<string, unknown>): Promise<void> {
  const db = getDb();

  const customerId = data.customer_id as string | undefined;
  const status = data.status as string | undefined;
  const customerEmail = (data.customer as Record<string, unknown> | undefined)?.email as string | undefined;

  if (!customerId) {
    console.error('[webhook] No customer_id in subscription event');
    return;
  }

  const isActive = status === 'active' || status === 'trialing';
  const tier = isActive ? 'pro' : 'free';

  // Try to find user by polar customer ID first
  let users = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.polarCustomerId, customerId));

  // Fall back to email match
  if (users.length === 0 && customerEmail) {
    users = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, customerEmail));
  }

  if (users.length === 0) {
    console.error(`[webhook] No user found for customer ${customerId} / ${customerEmail}`);
    return;
  }

  const user = users[0];

  await db
    .update(schema.user)
    .set({
      tier,
      polarCustomerId: customerId,
      updatedAt: new Date(),
    })
    .where(eq(schema.user.id, user.id));

  console.error(`[webhook] User ${user.id} → tier: ${tier}`);
}

async function handleCancellation(data: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const customerId = data.customer_id as string | undefined;

  if (!customerId) return;

  await db
    .update(schema.user)
    .set({ tier: 'free', updatedAt: new Date() })
    .where(eq(schema.user.polarCustomerId, customerId));

  console.error(`[webhook] Customer ${customerId} → free (canceled)`);
}

// ── Signature verification ──

function verifyPolarSignature(body: string, signature: string, secret: string): boolean {
  try {
    // Polar uses webhook-signature header with format: v1,<timestamp>.<signature>
    // or simple HMAC-SHA256
    const parts = signature.split(',');
    const sigPart = parts.length > 1 ? parts[1] : parts[0];
    const [_ts, sig] = sigPart.includes('.') ? sigPart.split('.') : ['', sigPart];
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const sigBuf = Buffer.from(sig ?? signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

// ── Helpers ──

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function readRawBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk;
      if (raw.length > MAX_BODY) { resolve(null); req.destroy(); }
    });
    req.on('end', () => resolve(raw || null));
    req.on('error', () => resolve(null));
  });
}

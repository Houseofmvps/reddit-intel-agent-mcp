/**
 * Composio Authentication — singleton factory + Reddit connection helpers
 *
 * Uses Composio's managed OAuth to access Reddit API without
 * our own Reddit OAuth app approval.
 *
 * API reference: https://docs.composio.dev/docs/authenticating-users/manually-authenticating
 */

import { Composio } from '@composio/core';

let _instance: Composio | null = null;

/**
 * Singleton factory for the Composio client.
 * Requires COMPOSIO_API_KEY env var.
 */
export function getComposio(): Composio {
  if (_instance) return _instance;

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error(
      'COMPOSIO_API_KEY environment variable is required. ' +
      'Get one at https://app.composio.dev/settings'
    );
  }

  _instance = new Composio({ apiKey });
  return _instance;
}

/**
 * Initiate a Composio connection for Reddit OAuth.
 * Uses the documented session.authorize() flow.
 * Returns a redirect URL the user should visit to authorize.
 */
export async function getRedditConnectLink(
  userId: string,
  callbackUrl: string,
): Promise<{ redirectUrl: string; connectionId: string }> {
  const composio = getComposio();

  // Create a session for this user, then authorize Reddit
  const session = await composio.create(userId, { manageConnections: false });
  const connectionRequest = await session.authorize('reddit', {
    callbackUrl,
  });

  return {
    redirectUrl: connectionRequest.redirectUrl ?? '',
    connectionId: connectionRequest.id ?? '',
  };
}

/**
 * Check if a user has an active Reddit connection via Composio.
 * Returns the connection ID if active, null otherwise.
 */
export async function checkRedditConnection(
  userId: string,
): Promise<{ connected: boolean; connectionId: string | null }> {
  const composio = getComposio();

  try {
    const session = await composio.create(userId, { manageConnections: false });
    const toolkits = await session.toolkits();
    const items = 'items' in toolkits ? toolkits.items : toolkits;

    const reddit = (Array.isArray(items) ? items : []).find(
      (t: any) => t.slug === 'reddit' && t.connection?.isActive,
    );

    return {
      connected: !!reddit,
      connectionId: reddit?.connection?.connectedAccount?.id ?? null,
    };
  } catch (sessionErr) {
    console.warn(`[composio-auth] Session approach failed for user ${userId}:`, sessionErr instanceof Error ? sessionErr.message : sessionErr);
    // Fallback to lower-level API if session approach fails
    const accounts = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['reddit'],
    });

    const items = 'items' in accounts ? (accounts as any).items : accounts;
    const active = (Array.isArray(items) ? items : []).find(
      (acc: { status: string; id: string }) => acc.status === 'ACTIVE',
    );

    return {
      connected: !!active,
      connectionId: active?.id ?? null,
    };
  }
}

/**
 * Reset the singleton (for testing).
 */
export function resetComposioInstance(): void {
  _instance = null;
}

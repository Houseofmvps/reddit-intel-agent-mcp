/**
 * Composio Authentication — singleton factory + Reddit connection helpers
 *
 * Uses Composio's managed OAuth to access Reddit API without
 * our own Reddit OAuth app approval.
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
 * Returns a redirect URL the user should visit to authorize.
 */
export async function getRedditConnectLink(
  userId: string,
  redirectUrl: string,
): Promise<{ redirectUrl: string; connectionId: string }> {
  const composio = getComposio();

  const connectionRequest = await composio.connectedAccounts.initiate(
    userId,
    'reddit',  // toolkit slug
    {
      callbackUrl: redirectUrl,
    },
  );

  return {
    redirectUrl: connectionRequest.redirectUrl,
    connectionId: connectionRequest.id,
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

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: ['reddit'],
  });

  const active = accounts.find(
    (acc: { status: string; id: string }) => acc.status === 'ACTIVE',
  );

  return {
    connected: !!active,
    connectionId: active?.id ?? null,
  };
}

/**
 * Reset the singleton (for testing).
 */
export function resetComposioInstance(): void {
  _instance = null;
}

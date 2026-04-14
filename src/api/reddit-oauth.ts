/**
 * Reddit OAuth2 utilities — token exchange, refresh, and user info
 *
 * BuildRadar uses a single "web app" Reddit OAuth application.
 * Users connect via OAuth2 authorization code flow → 100 req/min.
 */

const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/authorize';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const SCOPES = 'read history identity';

function getOAuthConfig() {
  const clientId = process.env.REDDIT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.REDDIT_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.REDDIT_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing REDDIT_OAUTH_CLIENT_ID, REDDIT_OAUTH_CLIENT_SECRET, or REDDIT_OAUTH_REDIRECT_URI');
  }
  return { clientId, clientSecret, redirectUri };
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getOAuthConfig();
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

/** Build the Reddit authorization URL for a user to visit */
export function buildAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    state,
    redirect_uri: redirectUri,
    duration: 'permanent',
    scope: SCOPES,
  });
  return `${REDDIT_AUTH_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { redirectUri } = getOAuthConfig();
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'BuildRadar/1.0 (by /u/buildradar)',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as TokenResponse;
  if (!data.access_token) {
    throw new Error(`Reddit token exchange returned no access_token (keys: ${Object.keys(data).join(', ')})`);
  }
  return data;
}

/** Refresh an expired access token using a refresh token */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'BuildRadar/1.0 (by /u/buildradar)',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  if (!data.access_token) {
    throw new Error('Reddit token refresh returned no access_token');
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Fetch the Reddit username for an access token */
export async function getRedditUsername(accessToken: string): Promise<string> {
  const res = await fetch(`${REDDIT_API_BASE}/api/v1/me`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'BuildRadar/1.0 (by /u/buildradar)',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Reddit user info (${res.status})`);
  }

  const data = await res.json() as { name: string };
  return data.name;
}

/** Check if Reddit OAuth env vars are configured */
export function isRedditOAuthConfigured(): boolean {
  return !!(
    process.env.REDDIT_OAUTH_CLIENT_ID &&
    process.env.REDDIT_OAUTH_CLIENT_SECRET &&
    process.env.REDDIT_OAUTH_REDIRECT_URI
  );
}

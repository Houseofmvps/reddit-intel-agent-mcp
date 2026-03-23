/**
 * Better Auth configuration — Reddit OAuth only
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins';
import { getDb, schema } from '../db/index.js';
import { encrypt } from '../db/crypto.js';
import { eq } from 'drizzle-orm';

function createAuth() {
  const db = getDb();

  const plugins: any[] = [];

  // Reddit as generic OAuth provider (primary login method)
  if (process.env.REDDIT_OAUTH_CLIENT_ID && process.env.REDDIT_OAUTH_CLIENT_SECRET) {
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: 'reddit',
            clientId: process.env.REDDIT_OAUTH_CLIENT_ID,
            clientSecret: process.env.REDDIT_OAUTH_CLIENT_SECRET,
            authorizationUrl: 'https://www.reddit.com/api/v1/authorize',
            tokenUrl: 'https://www.reddit.com/api/v1/access_token',
            userInfoUrl: 'https://oauth.reddit.com/api/v1/me',
            scopes: ['identity', 'read', 'history'],
            redirectURI: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/api/auth/callback/reddit`,
            authentication: 'basic',
            pkce: false,
            accessType: 'offline',
            prompt: 'consent',
            responseType: 'code',
            getUserInfo: async (token) => {
              const res = await fetch('https://oauth.reddit.com/api/v1/me', {
                headers: {
                  'Authorization': `Bearer ${token.accessToken}`,
                  'User-Agent': 'BuildRadar/1.0 (by /u/buildradar)',
                },
              });
              const data = await res.json() as { name: string; icon_img?: string; id: string };
              return {
                id: data.id,
                name: data.name,
                email: `${data.name}@reddit.buildradar.xyz`, // Reddit doesn't expose email
                image: data.icon_img?.split('?')[0] || undefined,
                emailVerified: false,
              };
            },
          },
        ],
      }),
    );
  }

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true },
    plugins,
    databaseHooks: {
      account: {
        create: {
          after: async (account: any) => {
            // When a user logs in via Reddit, auto-store tokens in redditOAuthConnection
            // so they get 100 req/min immediately — no separate "Connect Reddit" step
            if (account.providerId === 'reddit' && account.accessToken) {
              try {
                const [usr] = await db.select().from(schema.user).where(eq(schema.user.id, account.userId));
                const redditUsername = usr?.name || 'unknown';
                const accessToken = account.accessToken;
                const refreshToken = account.refreshToken || '';
                const expiresAt = account.accessTokenExpiresAt
                  ? new Date(account.accessTokenExpiresAt)
                  : new Date(Date.now() + 3600 * 1000);

                const existing = await db.select().from(schema.redditOAuthConnection)
                  .where(eq(schema.redditOAuthConnection.userId, account.userId));

                if (existing.length > 0) {
                  await db.update(schema.redditOAuthConnection)
                    .set({
                      redditUsername,
                      accessToken: encrypt(accessToken),
                      refreshToken: encrypt(refreshToken),
                      scope: account.scope || 'identity read history',
                      expiresAt,
                      status: 'active',
                      updatedAt: new Date(),
                    })
                    .where(eq(schema.redditOAuthConnection.userId, account.userId));
                } else {
                  await db.insert(schema.redditOAuthConnection).values({
                    userId: account.userId,
                    redditUsername,
                    accessToken: encrypt(accessToken),
                    refreshToken: encrypt(refreshToken),
                    scope: account.scope || 'identity read history',
                    expiresAt,
                  });
                }
                console.log(`[auth] Auto-connected Reddit for user ${account.userId} (u/${redditUsername})`);
              } catch (err) {
                console.error('[auth] Failed to auto-connect Reddit:', err);
              }
            }
          },
        },
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    trustedOrigins: [
      'https://buildradar.xyz',
      'https://app.buildradar.xyz',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;

let authInstance: AuthInstance | null = null;

export function getAuth(): AuthInstance {
  if (authInstance) return authInstance;
  authInstance = createAuth();
  return authInstance;
}

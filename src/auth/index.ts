/**
 * Better Auth configuration — Email/password + Magic link + GitHub OAuth
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { getDb, schema } from '../db/index.js';

function createAuth() {
  const db = getDb();

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          const apiKey = process.env.RESEND_API_KEY;
          if (!apiKey) {
            console.error('[auth] RESEND_API_KEY not set, cannot send magic link');
            return;
          }
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'BuildRadar <login@buildradar.xyz>',
              to: [email],
              subject: 'Sign in to BuildRadar',
              html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
                  <h2 style="color:#1a1a2e;margin-bottom:8px">Sign in to BuildRadar</h2>
                  <p style="color:#4b5563">Click the button below to sign in. This link expires in 10 minutes.</p>
                  <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;margin:16px 0;font-weight:500">Sign In</a>
                  <p style="color:#9ca3af;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
                </div>
              `,
            }),
          });
        },
      }),
    ],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min cache
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

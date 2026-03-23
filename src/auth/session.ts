/**
 * Simple cookie-based session — no Better Auth dependency.
 * Reads `buildradar.session` cookie, looks up token in session table.
 */

import type { IncomingMessage } from 'http';
import { getDb, schema } from '../db/index.js';
import { eq, and, gt } from 'drizzle-orm';

export const SESSION_COOKIE = 'buildradar.session';

/**
 * Parse a cookie header and return a Map of name→value.
 */
function parseCookies(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    }
  }
  return map;
}

/**
 * Extract session + user from request cookie.
 * Returns null if no valid session.
 */
export async function getSessionFromRequest(req: IncomingMessage) {
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookies = parseCookies(cookieHeader);
    const token = cookies.get(SESSION_COOKIE);
    if (!token) return null;

    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.session)
      .where(
        and(
          eq(schema.session.token, token),
          gt(schema.session.expiresAt, new Date()),
        ),
      );

    if (!row) return null;

    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, row.userId));

    if (!user) return null;

    return { session: row, user };
  } catch {
    return null;
  }
}

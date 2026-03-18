/**
 * Session extraction helper for dashboard routes
 */

import type { IncomingMessage } from 'http';
import { getAuth } from './index.js';
import { fromNodeHeaders } from 'better-auth/node';

export async function getSessionFromRequest(req: IncomingMessage) {
  try {
    const auth = getAuth()!;
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    return session;
  } catch {
    return null;
  }
}

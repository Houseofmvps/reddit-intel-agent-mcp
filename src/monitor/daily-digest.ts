/**
 * Daily Digest — 8am UTC email with previous 24h scan results for Pro users
 *
 * Queries all tier='pro' users, fetches their scan results from the last 24 hours,
 * groups by monitor, and sends a branded HTML email via Resend.
 */

import { eq, and, gte } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

// ── Types ──

interface DigestResult {
  score: number;
  title: string;
  subreddit: string;
  signals: string[];
  quote: string | null;
  redditUrl: string | null;
}

interface MonitorDigest {
  monitorName: string;
  results: DigestResult[];
}

interface DigestStats {
  usersProcessed: number;
  emailsSent: number;
  errors: number;
}

// ── Main entry point ──

export async function runDailyDigest(): Promise<DigestStats> {
  const stats: DigestStats = { usersProcessed: 0, emailsSent: 0, errors: 0 };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[daily-digest] RESEND_API_KEY not set, skipping digest');
    return stats;
  }

  const db = getDb();

  // Get all Pro users
  const proUsers = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.tier, 'pro'));

  console.error(`[daily-digest] Found ${proUsers.length} Pro users`);

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const user of proUsers) {
    try {
      stats.usersProcessed++;

      // Fetch scan results from the last 24 hours for this user
      const results = await db
        .select({
          id: schema.scanResult.id,
          monitorId: schema.scanResult.monitorId,
          score: schema.scanResult.score,
          title: schema.scanResult.title,
          subreddit: schema.scanResult.subreddit,
          signals: schema.scanResult.signals,
          quote: schema.scanResult.quote,
          redditUrl: schema.scanResult.redditUrl,
          createdAt: schema.scanResult.createdAt,
        })
        .from(schema.scanResult)
        .where(
          and(
            eq(schema.scanResult.userId, user.id),
            gte(schema.scanResult.createdAt, cutoff),
          ),
        );

      if (results.length === 0) {
        continue; // Don't send empty digests
      }

      // Get monitor names for grouping
      const monitorIds = [...new Set(results.map(r => r.monitorId))];
      const monitors = await db
        .select({ id: schema.monitor.id, name: schema.monitor.name })
        .from(schema.monitor)
        .where(
          // drizzle doesn't have a clean "in" for dynamic arrays here, so we fetch all user monitors
          eq(schema.monitor.userId, user.id),
        );

      const monitorNameMap = new Map(monitors.map(m => [m.id, m.name]));

      // Group results by monitor, sorted by score desc, top 5 per monitor
      const grouped = new Map<string, DigestResult[]>();
      for (const monitorId of monitorIds) {
        const monitorResults = results
          .filter(r => r.monitorId === monitorId)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(r => ({
            score: r.score,
            title: r.title,
            subreddit: r.subreddit,
            signals: r.signals as string[],
            quote: r.quote,
            redditUrl: r.redditUrl,
          }));

        if (monitorResults.length > 0) {
          grouped.set(monitorId, monitorResults);
        }
      }

      // Build digest sections
      const digestSections: MonitorDigest[] = [];
      for (const [monitorId, monitorResults] of grouped) {
        digestSections.push({
          monitorName: monitorNameMap.get(monitorId) ?? 'Unknown Monitor',
          results: monitorResults,
        });
      }

      if (digestSections.length === 0) {
        continue;
      }

      // Build and send email
      const totalResults = results.length;
      const dateStr = formatDate(new Date());
      const html = buildDigestHtml(dateStr, digestSections, totalResults);

      await sendDigestEmail(apiKey, user.email, user.name, dateStr, html);
      stats.emailsSent++;

      console.error(`[daily-digest] Sent digest to ${user.email} (${totalResults} results across ${digestSections.length} monitors)`);
    } catch (err) {
      console.error(`[daily-digest] Error processing user ${user.id}:`, err);
      stats.errors++;
    }
  }

  console.error(`[daily-digest] Complete: ${stats.usersProcessed} users, ${stats.emailsSent} emails sent, ${stats.errors} errors`);
  return stats;
}

// ── Email sending ──

async function sendDigestEmail(
  apiKey: string,
  toEmail: string,
  _userName: string,
  dateStr: string,
  html: string,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'BuildRadar <digest@buildradar.xyz>',
      to: [toEmail],
      subject: `BuildRadar Daily Brief — ${dateStr}`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend failed: ${res.status} — ${text.slice(0, 200)}`);
  }
}

// ── HTML template ──

function buildDigestHtml(
  dateStr: string,
  sections: MonitorDigest[],
  totalResults: number,
): string {
  const monitorSectionsHtml = sections
    .map(section => buildMonitorSectionHtml(section))
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>BuildRadar Daily Brief</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f1a;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

  <!-- Header -->
  <tr><td style="padding:32px 24px 16px;text-align:center;">
    <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
      BuildRadar Daily Brief
    </h1>
    <p style="margin:0;font-size:15px;color:#8b8fa3;">
      ${escapeHtml(dateStr)} &middot; ${totalResults} signal${totalResults === 1 ? '' : 's'} detected
    </p>
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:0 24px;">
    <div style="height:1px;background:linear-gradient(90deg,transparent,#2d2d44,transparent);"></div>
  </td></tr>

  <!-- Monitor Sections -->
  ${monitorSectionsHtml}

  <!-- CTA -->
  <tr><td style="padding:24px;text-align:center;">
    <a href="https://buildradar.xyz/app/results"
       style="display:inline-block;background:#2563eb;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
      View in Dashboard
    </a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px;text-align:center;">
    <div style="height:1px;background:linear-gradient(90deg,transparent,#2d2d44,transparent);margin-bottom:16px;"></div>
    <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">
      You're receiving this because you have an active BuildRadar Pro subscription.
    </p>
    <p style="margin:0;font-size:12px;color:#6b7280;">
      <a href="https://buildradar.xyz/app/settings" style="color:#6b7280;text-decoration:underline;">Manage preferences</a>
      &nbsp;&middot;&nbsp;
      <a href="https://buildradar.xyz" style="color:#6b7280;text-decoration:underline;">buildradar.xyz</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildMonitorSectionHtml(section: MonitorDigest): string {
  const resultsHtml = section.results
    .map(r => buildResultRowHtml(r))
    .join('');

  return `
  <tr><td style="padding:24px 24px 8px;">
    <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#e2e4ea;">
      ${escapeHtml(section.monitorName)}
    </h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 8px;">
      ${resultsHtml}
    </table>
  </td></tr>`;
}

function buildResultRowHtml(r: DigestResult): string {
  const badgeColor = r.score >= 80 ? '#22c55e' : r.score >= 60 ? '#eab308' : '#6b7280';
  const badgeBg = r.score >= 80 ? '#052e16' : r.score >= 60 ? '#422006' : '#1f2937';

  const signalsText = (r.signals ?? []).map(s => escapeHtml(s)).join(', ');
  const quoteHtml = r.quote
    ? `<p style="margin:8px 0 0;font-size:13px;color:#8b8fa3;font-style:italic;line-height:1.4;border-left:2px solid #2d2d44;padding-left:10px;">
        "${escapeHtml(r.quote.length > 200 ? r.quote.slice(0, 200) + '...' : r.quote)}"
       </p>`
    : '';

  const linkHtml = r.redditUrl
    ? `<a href="${escapeHtml(r.redditUrl)}" style="color:#60a5fa;font-size:12px;text-decoration:none;">View on Reddit &rarr;</a>`
    : '';

  return `
      <tr><td style="background:#1a1a2e;border-radius:8px;padding:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="48" valign="top" style="padding-right:12px;">
              <div style="width:44px;height:44px;border-radius:8px;background:${badgeBg};display:flex;align-items:center;justify-content:center;text-align:center;line-height:44px;">
                <span style="font-size:16px;font-weight:700;color:${badgeColor};">${r.score}</span>
              </div>
            </td>
            <td valign="top">
              <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#e2e4ea;line-height:1.3;">
                ${escapeHtml(r.title)}
              </p>
              <p style="margin:0;font-size:13px;color:#8b8fa3;">
                <span style="color:#60a5fa;">r/${escapeHtml(r.subreddit)}</span>
                ${signalsText ? ` &middot; ${signalsText}` : ''}
              </p>
              ${quoteHtml}
              <p style="margin:8px 0 0;">${linkHtml}</p>
            </td>
          </tr>
        </table>
      </td></tr>`;
}

// ── Utilities ──

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Alert system — Email (Resend) + Slack webhook notifications
 */

export interface AlertPayload {
  monitorName: string;
  resultCount: number;
  topResults: Array<{
    title: string;
    subreddit: string;
    score: number;
    url: string;
    signals: string[];
  }>;
  leadCount: number;
  dashboardUrl: string;
}

type Monitor = {
  alertChannel: string;
  slackWebhookUrl: string | null;
};

type User = {
  email: string;
  name: string;
};

/**
 * Send alert via configured channel (email or Slack)
 */
export async function sendAlert(
  monitor: Monitor,
  user: User,
  payload: AlertPayload,
): Promise<void> {
  if (monitor.alertChannel === 'slack' && monitor.slackWebhookUrl) {
    await sendSlackAlert(monitor.slackWebhookUrl, payload);
  } else {
    await sendEmailAlert(user, payload);
  }
}

// ── Slack ──

async function sendSlackAlert(webhookUrl: string, payload: AlertPayload): Promise<void> {
  const resultsBlock = payload.topResults
    .map((r, i) => `${i + 1}. *<${r.url}|${r.title}>* (r/${r.subreddit}, score: ${r.score})\n   Signals: ${r.signals.join(', ')}`)
    .join('\n');

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🎯 BuildRadar: ${payload.monitorName}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Found *${payload.resultCount} new signals* and *${payload.leadCount} leads*`,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Top Results:*\n${resultsBlock}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Dashboard' },
          url: payload.dashboardUrl,
        },
      ],
    },
  ];

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status}`);
  }
}

// ── Email (Resend) ──

async function sendEmailAlert(user: User, payload: AlertPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(`[alerts] RESEND_API_KEY not set — email alert skipped for ${user.email} (monitor: ${payload.monitorName}). Set RESEND_API_KEY to enable alerts.`);
    return;
  }

  const resultsHtml = payload.topResults
    .map(
      r =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee"><a href="${r.url}" style="color:#2563eb;text-decoration:none">${escapeHtml(r.title)}</a></td>
          <td style="padding:8px;border-bottom:1px solid #eee">r/${escapeHtml(r.subreddit)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center"><strong>${r.score}</strong></td>
          <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${r.signals.map(s => escapeHtml(s)).join(', ')}</td>
        </tr>`,
    )
    .join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a1a2e">🎯 ${escapeHtml(payload.monitorName)} — Daily Brief</h2>
      <p>Found <strong>${payload.resultCount} new signals</strong> and <strong>${payload.leadCount} potential leads</strong>.</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#f8f9fa">
            <th style="padding:8px;text-align:left">Post</th>
            <th style="padding:8px;text-align:left">Subreddit</th>
            <th style="padding:8px;text-align:center">Score</th>
            <th style="padding:8px;text-align:left">Signals</th>
          </tr>
        </thead>
        <tbody>${resultsHtml}</tbody>
      </table>

      <a href="${payload.dashboardUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;margin:16px 0">View Full Results →</a>

      <p style="color:#6b7280;font-size:12px;margin-top:24px">
        You're receiving this because you have an active monitor on BuildRadar.
        <a href="https://buildradar.xyz/app/monitors" style="color:#6b7280">Manage monitors</a>
      </p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'BuildRadar <alerts@buildradar.xyz>',
      to: [user.email],
      subject: `🎯 ${payload.monitorName}: ${payload.resultCount} new signals found`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend failed: ${res.status} — ${text.slice(0, 200)}`);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

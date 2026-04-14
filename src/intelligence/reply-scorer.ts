/**
 * Reply Scorer — heuristic scoring for Reddit reply quality
 *
 * Scores each generated reply on three dimensions without an extra API call:
 *   banRisk          (0-100) — higher = more likely to trigger mod action or ban
 *   helpfulness      (0-100) — higher = adds genuine value to the conversation
 *   conversionPotential (0-100) — higher = likely to drive curiosity/clicks
 *
 * Scores feed the Reply Coach UI to help founders pick the safest, most
 * effective reply before they post manually on Reddit.
 */

// Maps stored tone names (including legacy ones from v1.x) to display labels
export const TONE_LABELS: Record<string, string> = {
  expert: 'Helpful Expert',
  peer: 'Peer Founder',
  story: 'Story-Based',
  // Legacy tone names (before Reply Coach v2.0)
  helpful: 'Helpful Expert',
  casual: 'Peer Founder',
  direct: 'Story-Based',
};

export interface ReplyScores {
  banRisk: number;
  helpfulness: number;
  conversionPotential: number;
}

export type BanRiskLevel = 'safe' | 'caution' | 'high';

export function getBanRiskLevel(score: number): BanRiskLevel {
  if (score <= 30) return 'safe';
  if (score <= 60) return 'caution';
  return 'high';
}

export function scoreReply(
  text: string,
  context: {
    subreddit: string;
    signals: string[];
    postTitle: string;
  }
): ReplyScores {
  let banRisk = 20; // baseline: low risk
  let helpfulness = 45;
  let conversionPotential = 35;

  const lower = text.toLowerCase();
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const firstSentence = sentences[0]?.toLowerCase() ?? '';
  const chars = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // ── Ban Risk Factors ──────────────────────────────────────────

  // Promotional language — biggest red flag
  if (/\bcheck out\b|\btry it\b|\bsign up\b|\bclick here\b|\bvisit us\b|\bget started\b/i.test(text)) banRisk += 22;

  // Sales copy phrases
  if (/free trial|limited time|promo|coupon|discount|use code|special offer/i.test(lower)) banRisk += 25;

  // Product mention in the very first sentence — biggest signal of spam
  if (/\b(i built|i made|i created|my product|my tool|my app|my saas|my startup|my service)\b/i.test(firstSentence)) banRisk += 38;

  // URL in reply (Reddit flags promotional links heavily)
  if (/https?:\/\//.test(text)) banRisk += 22;

  // Markdown links [text](url)
  if (/\[.+?\]\(.+?\)/.test(text)) banRisk += 15;

  // Too short — signals low effort / bot-like
  if (chars < 60) banRisk += 22;
  if (wordCount < 12) banRisk += 15;

  // Wall of text — gets flagged by mods in many subs
  if (chars > 600) banRisk += 12;

  // Generic opener patterns often used by bots/marketers
  if (/^(hey|hi there|hello|great question|this is great|thanks for sharing|i came across)/i.test(text)) banRisk += 12;

  // Risk reducers
  if (/\?/.test(text)) banRisk -= 12; // asking a question = conversational
  if (/\b(i understand|i know how|i've been there|same thing happened|i had the same|can relate)\b/i.test(lower)) banRisk -= 18; // empathy
  if (context.signals.includes('buyer_intent')) banRisk -= 18; // post explicitly asks for recommendations
  if (context.signals.includes('pain_point')) banRisk -= 8; // offering help to someone with a problem
  if (/\b(also|another option|alternatively|you could also|one thing that helped me)\b/i.test(lower)) banRisk -= 8; // mentioning alternatives

  // ── Helpfulness Factors ───────────────────────────────────────

  // Good reply length
  if (chars >= 100 && chars <= 400) helpfulness += 18;
  else if (chars < 60) helpfulness -= 25;
  else if (chars > 600) helpfulness -= 8;

  // Specific detail or advice
  if (/for example|for instance|specifically|in my (case|experience)|one thing (that|i)/i.test(lower)) helpfulness += 18;

  // Engaging with the post content
  if (/you mentioned|your (question|post|issue|problem)|sounds like you/i.test(lower)) helpfulness += 15;

  // Giving actionable advice
  if (/\b(try|consider|recommend|suggest|might help|could help|worked for me)\b/i.test(lower)) helpfulness += 12;

  // Asks a genuine question (shows interest, not just pitching)
  if (/\?/.test(text)) helpfulness += 10;

  // Offers alternatives (not just pushing own product)
  if (/\b(also|alternatively|another option|other tools|other ways)\b/i.test(lower)) helpfulness += 12;

  // Reply too short to be genuinely helpful
  if (wordCount < 10) helpfulness -= 20;

  // ── Conversion Potential Factors ─────────────────────────────

  // Sweet spot length for Reddit (not too short, not a wall of text)
  if (chars >= 80 && chars <= 280) conversionPotential += 18;

  // Soft CTA patterns that feel organic
  if (/\b(happy to (help|share|explain)|let me know if|feel free to dm|reach out if)\b/i.test(lower)) conversionPotential += 14;

  // Specific pain point match
  if (context.signals.some(s => ['buyer_intent', 'pain_point', 'feature_gap'].includes(s))) conversionPotential += 18;

  // Curiosity hook — ending that makes them want to learn more
  if (sentences.length >= 2 && /\?/.test(sentences[sentences.length - 1] ?? '')) conversionPotential += 12;

  // High ban risk tanks conversion potential (post will be removed)
  if (banRisk > 65) conversionPotential -= 22;
  else if (banRisk > 45) conversionPotential -= 10;

  // Authenticity boost — personal experience shared
  if (/\b(i (used to|struggled|found|learned|built|shipped)|in my (experience|case))\b/i.test(lower)) conversionPotential += 12;

  return {
    banRisk: clamp(banRisk),
    helpfulness: clamp(helpfulness),
    conversionPotential: clamp(conversionPotential),
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

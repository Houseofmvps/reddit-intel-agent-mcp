/**
 * Reddit Intelligence Agent — Scoring systems
 *
 * Three scoring systems:
 *   A. Opportunity Score (0-100) — startup idea validation
 *   B. Signal Score (0-100) — market intelligence signals
 *   C. Lead Score (0-100) — buyer intent quality
 */

import type { RedditPost, OpportunityScore, PainPoint, Workaround } from '../types/index.js';
import { matchPatterns, categoryWeight, type PatternMatch } from './patterns.js';
import { daysSince } from '../reddit/formatter.js';

// ─── A. Opportunity Scoring ─────────────────────────────────────

export interface OpportunityInput {
  painPoints: PainPoint[];
  workarounds: Workaround[];
  competitorMentions: Array<{ sentiment: 'positive' | 'negative' | 'neutral'; score: number }>;
  totalPostsSearched: number;
  subredditSubscribers: number[];
}

export function scoreOpportunity(input: OpportunityInput): OpportunityScore {
  const { painPoints, workarounds, competitorMentions, totalPostsSearched, subredditSubscribers } = input;

  // Pain frequency: # unique pain posts / total searched (0-25)
  const painRatio = totalPostsSearched > 0 ? painPoints.length / totalPostsSearched : 0;
  const painFrequency = Math.min(25, Math.round(painRatio * 250));

  // Pain severity: avg upvotes + comment depth on pain posts (0-20)
  const avgPainEngagement = painPoints.length > 0
    ? painPoints.reduce((s, p) => s + Math.log10(Math.max(1, p.score)) + Math.log10(Math.max(1, p.num_comments)), 0) / painPoints.length
    : 0;
  const painSeverity = Math.min(20, Math.round(avgPainEngagement * 4));

  // Workaround prevalence (0-15)
  const workaroundPrevalence = Math.min(15, workarounds.length * 3);

  // Competition weakness: negative sentiment ratio (0-15)
  const negMentions = competitorMentions.filter(m => m.sentiment === 'negative').length;
  const compRatio = competitorMentions.length > 0 ? negMentions / competitorMentions.length : 0;
  const competitionWeakness = Math.min(15, Math.round(compRatio * 15));

  // Recency: % of signals from last 30 days (0-10)
  const recentPains = painPoints.filter(p => p.recency_days <= 30).length;
  const recencyRatio = painPoints.length > 0 ? recentPains / painPoints.length : 0;
  const recency = Math.round(recencyRatio * 10);

  // Subreddit quality: subscriber count quality signal (0-10)
  const avgSubs = subredditSubscribers.length > 0
    ? subredditSubscribers.reduce((s, n) => s + n, 0) / subredditSubscribers.length
    : 0;
  const subQuality = Math.min(10, Math.round(Math.log10(Math.max(1, avgSubs)) * 2));

  // Noise penalty: meme/joke ratio (0 to -5)
  const noiseSignals = painPoints.filter(p => p.signals.some(s => s === 'slang' || s === 'meme' || s === 'reddit_joke'));
  const noiseRatio = painPoints.length > 0 ? noiseSignals.length / painPoints.length : 0;
  const noisePenalty = -Math.round(noiseRatio * 5);

  const total = Math.max(0, Math.min(100,
    painFrequency + painSeverity + workaroundPrevalence +
    competitionWeakness + recency + subQuality + noisePenalty
  ));

  const confidence = total >= 70 ? 'high' : total >= 40 ? 'medium' : 'low';
  const verdict = total >= 80
    ? 'Strong signal — validated pain with weak competition and active demand'
    : total >= 60
    ? 'Promising — clear pain exists, needs more validation'
    : total >= 40
    ? 'Moderate — some signal but noisy or competitive'
    : 'Weak — insufficient evidence or saturated market';

  return {
    total,
    breakdown: {
      pain_frequency: painFrequency,
      pain_severity: painSeverity,
      workaround_prevalence: workaroundPrevalence,
      competition_weakness: competitionWeakness,
      recency,
      subreddit_quality: subQuality,
      noise_penalty: noisePenalty,
    },
    confidence,
    verdict,
    evidence_count: painPoints.length + workarounds.length,
  };
}

// ─── B. Signal Scoring ──────────────────────────────────────────

export interface SignalInput {
  posts: RedditPost[];
  query: string;
}

export function scoreSignals(input: SignalInput): {
  mention_volume: number;
  sentiment_polarity: number;
  feature_request_frequency: number;
  switching_intent: number;
  price_sensitivity: number;
  recency: number;
  total: number;
} {
  const { posts } = input;
  if (posts.length === 0) {
    return { mention_volume: 0, sentiment_polarity: 0, feature_request_frequency: 0, switching_intent: 0, price_sensitivity: 0, recency: 0, total: 0 };
  }

  const allMatches: Array<{ post: RedditPost; matches: PatternMatch[] }> = posts.map(p => ({
    post: p,
    matches: matchPatterns(`${p.title} ${p.selftext ?? ''}`),
  }));

  // Mention volume (0-20)
  const mentionVolume = Math.min(20, Math.round(Math.log10(Math.max(1, posts.length)) * 10));

  // Sentiment polarity (0-20): ratio of negative/pain signals
  const totalNegWeight = allMatches.reduce((s, { matches }) => s + categoryWeight(matches, 'pain') + categoryWeight(matches, 'frustration'), 0);
  const totalPosWeight = allMatches.reduce((s, { matches }) => s + categoryWeight(matches, 'positive'), 0);
  const polarity = totalNegWeight > 0 ? Math.min(20, Math.round((totalNegWeight / (totalNegWeight + totalPosWeight + 1)) * 20)) : 0;

  // Feature request frequency (0-20)
  const featureReqs = allMatches.filter(({ matches }) => categoryWeight(matches, 'feature_request') > 0).length;
  const featureFreq = Math.min(20, Math.round((featureReqs / posts.length) * 20));

  // Switching intent (0-15)
  const switchers = allMatches.filter(({ matches }) => categoryWeight(matches, 'switching') > 0).length;
  const switchIntent = Math.min(15, Math.round((switchers / posts.length) * 15));

  // Price sensitivity (0-15)
  const priceComplaints = allMatches.filter(({ matches }) => categoryWeight(matches, 'pricing_objection') > 0).length;
  const priceSens = Math.min(15, Math.round((priceComplaints / posts.length) * 15));

  // Recency (0-10)
  const recent = posts.filter(p => daysSince(p.created_utc) <= 30).length;
  const recencyScore = Math.round((recent / posts.length) * 10);

  const total = Math.min(100, mentionVolume + polarity + featureFreq + switchIntent + priceSens + recencyScore);

  return {
    mention_volume: mentionVolume,
    sentiment_polarity: polarity,
    feature_request_frequency: featureFreq,
    switching_intent: switchIntent,
    price_sensitivity: priceSens,
    recency: recencyScore,
    total,
  };
}

// ─── C. Lead Scoring ────────────────────────────────────────────

export function scoreLeadPost(post: RedditPost): {
  intent: number;
  role_clarity: number;
  urgency: number;
  budget_signal: number;
  account_quality: number;
  total: number;
  signals: string[];
  budget_hints: string[];
} {
  const text = `${post.title} ${post.selftext ?? ''}`;
  const matches = matchPatterns(text);

  // Intent (0-30) — weighted by signal strength, not just count
  const intentWeight = categoryWeight(matches, 'buyer_intent');
  const switchWeight = categoryWeight(matches, 'switching');
  // Switching intent is a strong buying signal too
  const combinedIntent = intentWeight + Math.floor(switchWeight * 0.5);
  const intent = Math.min(30, combinedIntent * 3);

  // Role clarity (0-15): gradient scoring for decision-maker roles
  const decisionMaker = /\b(?:founder|ceo|cto|vp|head of|director|owner)\b/i.test(text);
  const techRole = /\b(?:developer|engineer|architect|devops|sre|lead)\b/i.test(text);
  const businessRole = /\b(?:marketer|agency|consultant|freelancer|manager|designer|product manager)\b/i.test(text);
  const hasFlair = !!post.author_flair_text;
  const roleClarity = (decisionMaker ? 15 : techRole ? 10 : businessRole ? 8 : 0) + (hasFlair ? 3 : 0);

  // Urgency (0-15) — gradient: immediate > this week > general
  const immediateUrgency = /\b(?:need (?:this )?asap|urgent(?:ly)? need|immediately need|right now)\b/i.test(text);
  const nearTermUrgency = /\b(?:(?:need|want) (?:it |this )?(?:this week|this month)|deadline (?:is|coming)|by (?:end of|next) (?:week|month))\b/i.test(text);
  const generalUrgency = /\b(?:need (?:this )?soon|time-sensitive|running out of time)\b/i.test(text);
  const urgencyScore = immediateUrgency ? 15 : nearTermUrgency ? 12 : generalUrgency ? 6 : 0;

  // Budget signal (0-20) — strongest conversion predictor
  const budgetMentions = text.match(/\$\d[\d,]*/g) ?? [];
  const willingToPay = /\b(?:willing to pay|happy to pay|worth paying|pay for|budget (?:is|of|around))\b/i.test(text);
  const hasBudgetRange = /\$\d[\d,]*\s*(?:-|to)\s*\$\d[\d,]*/i.test(text);
  const pricingInquiry = /\b(?:how much (?:does|is|would)|what(?:'s| is) the pricing|get a quote|pricing page)\b/i.test(text);
  const budgetSignal = Math.min(20,
    (budgetMentions.length > 0 ? 8 : 0) +
    (hasBudgetRange ? 6 : 0) +
    (willingToPay ? 10 : 0) +
    (pricingInquiry ? 4 : 0)
  );

  // Account quality (0-10) — engagement signals indicate real user
  const engagementScore = Math.min(5, Math.floor(Math.log2(Math.max(1, post.score)) * 1.5));
  const hasComments = post.num_comments > 2 ? 3 : post.num_comments > 0 ? 1 : 0;
  const notDeleted = post.author !== '[deleted]' && post.author !== 'AutoModerator' ? 2 : 0;
  const accountQuality = engagementScore + hasComments + notDeleted;

  // Signal stacking bonus (0-10): multiple strong signals = much higher conversion
  const strongSignalCount = [
    intentWeight >= 5,         // strong buyer intent
    switchWeight >= 3,         // switching/comparing
    budgetSignal >= 8,         // budget mentioned
    urgencyScore >= 10,        // time pressure
    roleClarity >= 10,         // decision-maker
    categoryWeight(matches, 'pain') >= 4, // deep pain
  ].filter(Boolean).length;
  const stackingBonus = strongSignalCount >= 4 ? 10 : strongSignalCount >= 3 ? 6 : strongSignalCount >= 2 ? 3 : 0;

  // Budget hints
  const budgetHints: string[] = [];
  for (const bp of budgetMentions) budgetHints.push(bp);
  if (willingToPay) budgetHints.push('expressed willingness to pay');
  if (hasBudgetRange) budgetHints.push('specified budget range');
  if (pricingInquiry) budgetHints.push('asking about pricing');

  const total = Math.min(100, intent + roleClarity + urgencyScore + budgetSignal + accountQuality + stackingBonus);

  return {
    intent,
    role_clarity: roleClarity,
    urgency: urgencyScore,
    budget_signal: budgetSignal,
    account_quality: accountQuality,
    total,
    signals: matches.filter(m => m.weight > 0).map(m => m.label),
    budget_hints: budgetHints,
  };
}

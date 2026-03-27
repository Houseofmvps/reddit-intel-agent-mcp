/**
 * Reddit Intelligence Agent — Pattern matching for pain points, workarounds, intent
 *
 * These patterns detect specific signal types in Reddit post titles and body text.
 * Each pattern has a label, category, and weight for scoring.
 */

export interface PatternMatch {
  label: string;
  category: PatternCategory;
  weight: number;
  matched: string; // the substring that matched
}

export type PatternCategory =
  | 'pain'
  | 'frustration'
  | 'workaround'
  | 'buyer_intent'
  | 'switching'
  | 'feature_request'
  | 'pricing_objection'
  | 'positive'
  | 'meme_noise';

interface PatternRule {
  regex: RegExp;
  label: string;
  category: PatternCategory;
  weight: number;
}

const PATTERN_RULES: PatternRule[] = [
  // ─── Pain signals ─────────────────────────────────────────
  // Words that are unambiguously negative — safe as standalone
  { regex: /\b(?:frustrated|frustrating|infuriating|maddening)\b/i, label: 'frustration', category: 'pain', weight: 3 },
  { regex: /\b(?:terrible|awful|horrible|worst)\b/i, label: 'extreme_negative', category: 'pain', weight: 2 },
  { regex: /\b(?:broken|doesn'?t work|not working|buggy|crashes|keeps crashing)\b/i, label: 'broken', category: 'pain', weight: 3 },
  { regex: /\b(?:pain point|painpoint|pain-point)\b/i, label: 'explicit_pain', category: 'pain', weight: 4 },
  { regex: /\b(?:struggling? with|can'?t figure out)\b/i, label: 'struggle', category: 'pain', weight: 2 },
  { regex: /\b(?:waste of time|wasting time|time-consuming|tedious)\b/i, label: 'time_waste', category: 'pain', weight: 3 },
  { regex: /\b(?:there'?s no good|no good way|no easy way)\b/i, label: 'unmet_need', category: 'pain', weight: 4 },
  { regex: /\b(?:i wish|if only|would be great if|really need)\b/i, label: 'desire', category: 'pain', weight: 3 },
  { regex: /\b(?:annoying|annoyed|drives me crazy)\b/i, label: 'annoyance', category: 'pain', weight: 2 },
  { regex: /\b(?:dealbreaker|deal-breaker|deal breaker)\b/i, label: 'dealbreaker', category: 'pain', weight: 4 },
  { regex: /\b(?:gave up|giving up|about to give up)\b/i, label: 'abandonment', category: 'pain', weight: 3 },
  { regex: /\bi hate (?:this|that|it|my|the|how|when)\b/i, label: 'hatred', category: 'pain', weight: 2 },

  // ─── Frustration amplifiers ───────────────────────────────
  { regex: /\b(?:still no |still doesn'?t|still can'?t|still waiting)\b/i, label: 'persistent_issue', category: 'frustration', weight: 3 },
  { regex: /\b(?:for years|for months)\b/i, label: 'chronic', category: 'frustration', weight: 1 },
  { regex: /\b(?:every single time|every time i|always breaks)\b/i, label: 'recurring', category: 'frustration', weight: 2 },

  // ─── Workaround signals ───────────────────────────────────
  { regex: /\b(?:workaround|work-around|hacky)\b/i, label: 'explicit_workaround', category: 'workaround', weight: 4 },
  { regex: /\b(?:i built|i made|i wrote|i created|cobbled together)\b/i, label: 'diy_solution', category: 'workaround', weight: 3 },
  { regex: /\b(?:duct tape|band-?aid|jerry-?rig|kludge)\b/i, label: 'duct_tape', category: 'workaround', weight: 3 },
  { regex: /\b(?:spreadsheet|google sheets?|excel|csv)\b.*\b(?:track|manage|organize|handle)\b/i, label: 'spreadsheet_workaround', category: 'workaround', weight: 3 },
  { regex: /\b(?:ended up using|resorted to|had to use|fell back to)\b/i, label: 'fallback', category: 'workaround', weight: 2 },
  { regex: /\b(?:not ideal|it'?s not perfect|it works but)\b/i, label: 'suboptimal', category: 'workaround', weight: 2 },

  // ─── Buyer intent signals ─────────────────────────────────
  { regex: /\b(?:looking for|searching for|need a|need an|anyone know of)\b/i, label: 'seeking', category: 'buyer_intent', weight: 3 },
  { regex: /\b(?:recommend|recommendation|suggestions?|which .+ should i)\b/i, label: 'asking_rec', category: 'buyer_intent', weight: 3 },
  { regex: /\b(?:willing to pay|worth paying|happy to pay|budget (?:is|of|around))\b/i, label: 'budget_signal', category: 'buyer_intent', weight: 5 },
  { regex: /\b(?:best .+(?:tool|software|app|platform|service)|what .+ do you use)\b/i, label: 'tool_search', category: 'buyer_intent', weight: 3 },
  { regex: /\b(?:how much does|what(?:'s| is) the pricing|want to (?:buy|purchase|subscribe))\b/i, label: 'purchase_signal', category: 'buyer_intent', weight: 3 },
  { regex: /\b(?:asap|urgent(?:ly)?|deadline|immediately)\b/i, label: 'urgency', category: 'buyer_intent', weight: 4 },
  { regex: /\b(?:for my (?:team|company|business|startup|agency|client))\b/i, label: 'business_context', category: 'buyer_intent', weight: 4 },
  { regex: /\b(?:evaluating|trialing|testing out|trying out|demo|proof of concept)\b/i, label: 'active_evaluation', category: 'buyer_intent', weight: 5 },
  { regex: /\b(?:by (?:end of|next) (?:week|month|quarter)|by q[1-4]|this quarter)\b/i, label: 'timeline', category: 'buyer_intent', weight: 5 },
  { regex: /\b(?:team of \d+|\d+ employees|\d+ person team|\d+ devs)\b/i, label: 'team_size', category: 'buyer_intent', weight: 4 },
  { regex: /\b(?:shortlist|narrowed down|final (?:two|three|candidates)|deciding between)\b/i, label: 'final_selection', category: 'buyer_intent', weight: 5 },
  { regex: /\b(?:onboard|implement|integrate|deploy|roll out)\b/i, label: 'implementation_intent', category: 'buyer_intent', weight: 3 },

  // ─── Switching intent ─────────────────────────────────────
  { regex: /\b(?:switch(?:ed|ing)? (?:from|to|away)|moved? (?:from|to)|migrat(?:ed|ing))\b/i, label: 'switching', category: 'switching', weight: 3 },
  { regex: /\b(?:alternative to|alternatives? for|replacement for|instead of)\b/i, label: 'seeking_alt', category: 'switching', weight: 4 },
  { regex: /\b(?:cancel(?:led|ing)|unsubscrib|churn(?:ed|ing)?|left .{0,15}(?:for|because))\b/i, label: 'churn', category: 'switching', weight: 3 },
  { regex: /\b(?:\w+ vs\.? \w+|versus|compared to|comparison)\b/i, label: 'comparison', category: 'switching', weight: 2 },

  // ─── Feature requests ─────────────────────────────────────
  { regex: /\b(?:feature request|feature-request|feature wish)\b/i, label: 'explicit_request', category: 'feature_request', weight: 4 },
  { regex: /\b(?:why can'?t|why doesn'?t|why isn'?t|why don'?t they)\b/i, label: 'missing_feature', category: 'feature_request', weight: 3 },
  { regex: /\b(?:should add|should have|should support|needs to support)\b/i, label: 'suggestion', category: 'feature_request', weight: 3 },
  { regex: /\b(?:would love|please add|can you add)\b/i, label: 'request', category: 'feature_request', weight: 2 },
  { regex: /\b(?:missing|lacks?|doesn'?t support|no support for)\b/i, label: 'gap', category: 'feature_request', weight: 2 },

  // ─── Pricing objections ───────────────────────────────────
  { regex: /\b(?:too expensive|overpriced|not worth|rip-?off)\b/i, label: 'price_complaint', category: 'pricing_objection', weight: 4 },
  { regex: /\b(?:free (?:alternative|tier|version|plan)|open.?source alternative)\b/i, label: 'seeking_free', category: 'pricing_objection', weight: 3 },
  { regex: /\b(?:price increase|raised prices?|jacked up|price hike)\b/i, label: 'price_hike', category: 'pricing_objection', weight: 3 },
  { regex: /\b(?:cancel(?:led|ing)? (?:my )?subscription|unsubscrib)\b/i, label: 'cancellation', category: 'pricing_objection', weight: 3 },
  { regex: /\b(?:not worth \$|paying \$\d+|costs? \$\d+)\b/i, label: 'price_anchor', category: 'pricing_objection', weight: 2 },

  // ─── Noise / meme detection ───────────────────────────────
  { regex: /\b(?:lol|lmao|rofl|bruh|sus|no cap|fr fr|bussin)\b/i, label: 'slang', category: 'meme_noise', weight: -1 },
  { regex: /\b(?:shitpost|meme|upvote if|this is the way)\b/i, label: 'meme', category: 'meme_noise', weight: -2 },
  { regex: /\b(?:banana for scale|username checks out)\b/i, label: 'reddit_joke', category: 'meme_noise', weight: -1 },
];

/**
 * Check if a match is negated by a preceding "not", "no", "don't", "never", etc.
 * Looks at the 30 chars before the match for negation words.
 */
function isNegated(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 30), matchIndex).toLowerCase();
  return /\b(?:not|no|don'?t|doesn'?t|won'?t|can'?t|never|isn'?t|aren'?t|wasn'?t|without|neither)\s*$/.test(prefix);
}

export function matchPatterns(text: string): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const rule of PATTERN_RULES) {
    const m = rule.regex.exec(text);
    if (m) {
      // Skip positive signals that are negated (e.g., "NOT willing to pay")
      if (rule.weight > 0 && m.index !== undefined && isNegated(text, m.index)) {
        continue;
      }
      matches.push({
        label: rule.label,
        category: rule.category,
        weight: rule.weight,
        matched: m[0],
      });
    }
  }
  return matches;
}

export function matchPatternsMulti(texts: string[]): PatternMatch[] {
  const combined = texts.join(' ');
  return matchPatterns(combined);
}

export function hasCategory(matches: PatternMatch[], category: PatternCategory): boolean {
  return matches.some(m => m.category === category);
}

export function categoryWeight(matches: PatternMatch[], category: PatternCategory): number {
  return matches
    .filter(m => m.category === category)
    .reduce((sum, m) => sum + m.weight, 0);
}

export function signalSummary(matches: PatternMatch[]): string[] {
  return [...new Set(matches.filter(m => m.weight > 0).map(m => m.label))];
}

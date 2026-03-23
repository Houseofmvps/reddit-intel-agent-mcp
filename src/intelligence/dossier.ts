import { analyzeThreadTiming } from './timing.js';
import { draftReply } from './reply-drafter.js';
import type { RedditPost, LeadDossier } from '../types/index.js';

// ─── Input types ────────────────────────────────────────────────

export interface DossierInput {
  post: RedditPost;
  signals: string[];
  patternWeights: Record<string, number>;
  userHistory: {
    accountAge: string;
    totalKarma: number;
    activeSubreddits: string[];
    hasAskedForRecsBefore: boolean;
    role?: string;
  } | null;
  productDescription?: string;
}

type DossierOutput = Omit<LeadDossier, 'id' | 'leadId' | 'userId' | 'createdAt' | 'updatedAt'>;

// ─── Intent classification ──────────────────────────────────────

const INTENT_KEYWORDS: Record<string, string[]> = {
  'alternative-seeking': [
    'alternative', 'alternatives', 'looking for', 'switch', 'switching',
    'replace', 'replacement', 'instead of', 'moved away', 'moving away',
    'tired of', 'fed up', 'leaving', 'left', 'migrate from',
  ],
  'migration-planning': [
    'migration', 'migrating', 'export', 'import', 'transfer',
    'moving to', 'transition', 'migrate', 'porting',
  ],
  'pain-expressing': [
    'frustrated', 'frustrating', 'annoying', 'broken', 'sucks',
    'terrible', 'worst', 'hate', 'expensive', 'overpriced',
    'too expensive', 'got too', 'keeps crashing', 'buggy',
    'pricing', 'price hike', 'raised prices',
  ],
  'recommendation-asking': [
    'recommend', 'recommendation', 'what do you use', 'what does everyone',
    'best tool', 'suggestions', 'suggest', 'which one', 'opinions on',
    'curious', 'prefer', 'favorite',
  ],
};

// Priority order — first match wins
const INTENT_PRIORITY: string[] = [
  'alternative-seeking',
  'migration-planning',
  'pain-expressing',
  'recommendation-asking',
];

const INTENT_SCORES: Record<string, number> = {
  'alternative-seeking': 30,
  'migration-planning': 25,
  'pain-expressing': 15,
  'recommendation-asking': 10,
};

function classifyIntent(title: string, body: string, signals: string[]): string {
  const text = `${title} ${body}`.toLowerCase();

  // Check signals first for strong indicators
  if (signals.includes('switching')) return 'alternative-seeking';

  for (const intent of INTENT_PRIORITY) {
    const keywords = INTENT_KEYWORDS[intent]!;
    if (keywords.some((kw) => text.includes(kw))) {
      return intent;
    }
  }

  return 'recommendation-asking'; // default
}

// ─── Budget extraction ──────────────────────────────────────────

const BUDGET_PATTERNS = [
  /\$\d+(?:[.,]\d+)?(?:\s*\/\s*(?:mo|month|yr|year|week|user|seat))?/gi,
  /under\s+\$\d+/gi,
  /up to\s+\$\d+/gi,
  /budget(?:\s+(?:is|of|around|approved))?\s*[$:]?\s*\$?\d+/gi,
  /willing to pay\s+\$?\d+/gi,
  /can afford\s+(?:up to\s+)?\$?\d+/gi,
];

function extractBudgetSignals(title: string, body: string): string[] {
  const text = `${title} ${body}`;
  const signals: string[] = [];
  const seen = new Set<string>();

  for (const pattern of BUDGET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const normalized = match[0].trim();
      if (!seen.has(normalized.toLowerCase())) {
        seen.add(normalized.toLowerCase());
        signals.push(normalized);
      }
    }
  }

  return signals;
}

// ─── Pain point extraction ──────────────────────────────────────

const PAIN_WORDS = [
  'frustrated', 'frustrating', 'annoying', 'expensive', 'overpriced',
  'broken', 'terrible', 'sucks', 'worst', 'hate', 'horrible',
  'too expensive', 'keeps crashing', 'buggy', 'unreliable', 'slow',
  'painful', 'nightmare', 'ridiculous', 'unusable', 'clunky',
  'pricing', 'price hike', 'raised prices', 'wants', 'charges',
];

function extractPainPoints(title: string, body: string): string[] {
  const painPoints: string[] = [];

  // Check title as a pain point if it has pain words
  const titleLower = title.toLowerCase();
  if (PAIN_WORDS.some((w) => titleLower.includes(w))) {
    painPoints.push(title);
  }

  // Split body into sentences and find those with pain words
  const sentences = body
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (PAIN_WORDS.some((w) => lower.includes(w))) {
      painPoints.push(sentence);
    }
  }

  // If no explicit pain found, look for implicit frustration in title
  if (painPoints.length === 0 && title.length > 15) {
    const implicitPain = [
      'too expensive', 'looking for', 'need', 'help',
      'alternative', 'switch', 'replace',
    ];
    if (implicitPain.some((p) => titleLower.includes(p))) {
      painPoints.push(title);
    }
  }

  return painPoints;
}

// ─── Conversion scoring ─────────────────────────────────────────

function computeConversionScore(
  intentType: string,
  budgetSignals: string[],
  urgency: 'immediate' | 'this-week' | 'exploring',
  userHistory: DossierInput['userHistory'],
  patternWeights: Record<string, number>,
): number {
  let score = 0;

  // 1. Intent type (0-30)
  score += INTENT_SCORES[intentType] ?? 10;

  // 2. Signal strength from pattern weights (0-25)
  const totalWeight = Object.values(patternWeights).reduce((a, b) => a + b, 0);
  score += Math.min(25, totalWeight * 3);

  // 3. Budget signals (8 each, max 15)
  score += Math.min(15, budgetSignals.length * 8);

  // 4. Timing (0-15)
  const timingScores: Record<string, number> = {
    immediate: 15,
    'this-week': 8,
    exploring: 2,
  };
  score += timingScores[urgency] ?? 2;

  // 5. User quality (0-15)
  if (userHistory) {
    if (userHistory.totalKarma > 500) score += 5;
    if (userHistory.hasAskedForRecsBefore) score += 5;
    if (userHistory.role === 'founder' || userHistory.role === 'marketer') score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

function scoreToLabel(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

// ─── Recommended approach ───────────────────────────────────────

function getRecommendedApproach(intentType: string, urgency: string): string {
  if (intentType === 'alternative-seeking' && urgency === 'immediate') {
    return 'Reply quickly with personal experience. Mention specific pain point they raised and how you solved it. Keep it conversational, not salesy.';
  }
  if (intentType === 'migration-planning') {
    return 'Offer migration tips and share your experience. Position your tool as the destination without being pushy.';
  }
  if (intentType === 'pain-expressing') {
    return 'Empathize first, then offer a practical tip. Mention your tool only as part of a broader solution.';
  }
  return 'Join the conversation naturally. Ask a clarifying question, then share your experience when relevant.';
}

// ─── Main generator ─────────────────────────────────────────────

export function generateDossier(input: DossierInput): DossierOutput {
  const { post, signals, patternWeights, userHistory, productDescription } = input;
  const text = post.selftext ?? '';

  // Classify intent
  const intentType = classifyIntent(post.title, text, signals);

  // Extract budget signals
  const budgetSignals = extractBudgetSignals(post.title, text);

  // Extract pain points
  const painPoints = extractPainPoints(post.title, text);

  // Analyze timing
  const timing = analyzeThreadTiming(post);

  // Compute conversion score
  const conversionScore = computeConversionScore(
    intentType,
    budgetSignals,
    timing.urgency,
    userHistory,
    patternWeights,
  );
  const conversionLabel = scoreToLabel(conversionScore);

  // Build user context
  const userContext = userHistory
    ? {
        accountAge: userHistory.accountAge,
        totalKarma: userHistory.totalKarma,
        activeSubreddits: userHistory.activeSubreddits,
        hasAskedForRecsBefore: userHistory.hasAskedForRecsBefore,
        role: userHistory.role,
      }
    : {
        accountAge: 'unknown',
        totalKarma: 0,
        activeSubreddits: [] as string[],
        hasAskedForRecsBefore: false,
        role: undefined,
      };

  // Draft reply
  const reply = draftReply({
    intentType,
    painPoints,
    productDescription,
    subreddit: post.subreddit,
    postTitle: post.title,
    postBody: text,
  });

  // Recommended approach
  const recommendedApproach = getRecommendedApproach(intentType, timing.urgency);

  return {
    redditUsername: post.author,
    conversionScore,
    conversionLabel,
    triggerPost: {
      title: post.title,
      body: text,
      subreddit: post.subreddit,
      url: post.permalink,
      postedAt: new Date(post.created_utc * 1000).toISOString(),
      commentCount: post.num_comments,
      score: post.score,
    },
    painPoints,
    budgetSignals,
    intentType,
    urgency: timing.urgency,
    userContext,
    threadAge: timing.threadAgeMinutes,
    replyWindow: timing.replyWindowMinutes,
    commentVelocity: timing.commentVelocity,
    recommendedApproach,
    draftReply: reply,
    status: 'pending',
  };
}

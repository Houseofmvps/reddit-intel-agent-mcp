/**
 * Subreddit Analyzer — builds the Subreddit Playbook for a given community
 *
 * Fetches top posts from a subreddit via Composio, then uses Claude to
 * analyze the community culture, tone, self-promotion tolerance, and
 * engagement patterns. Results are cached in the subreddit_playbook table.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Composio } from '@composio/core';
import { ComposioRedditClient } from '../reddit/composio-client.js';

export interface SubredditPlaybookData {
  subreddit: string;
  selfPromoAllowed: 'yes' | 'flair' | 'no' | 'unknown';
  communityTone: 'technical' | 'founder' | 'consumer' | 'mixed';
  banRiskLevel: 'low' | 'medium' | 'high';
  bestTimeToEngage: string;
  avgRepliesPerPost: number;
  exampleMention: string;
  insightSummary: string;
  selfPromoNotes: string;
  topTopics: string[];
}

// Known community patterns — used as priors before analysis
const KNOWN_BAN_RISK: Record<string, 'low' | 'medium' | 'high'> = {
  saas: 'low',
  sideproject: 'low',
  indiehackers: 'low',
  startups: 'medium',
  entrepreneur: 'medium',
  smallbusiness: 'medium',
  technology: 'high',
  programming: 'high',
  webdev: 'high',
  javascript: 'high',
  python: 'high',
};

const KNOWN_TONE: Record<string, 'technical' | 'founder' | 'consumer' | 'mixed'> = {
  saas: 'founder',
  sideproject: 'founder',
  indiehackers: 'founder',
  startups: 'founder',
  technology: 'consumer',
  programming: 'technical',
  webdev: 'technical',
  javascript: 'technical',
  entrepreneur: 'mixed',
  smallbusiness: 'consumer',
};

export async function analyzeSubreddit(
  subredditName: string,
  composio: Composio,
  composioUserId: string,
): Promise<SubredditPlaybookData> {
  const sub = subredditName.replace(/^r\//, '').trim().toLowerCase();
  const displaySub = sub;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // Fetch top posts from last month (better sample than "new")
  const client = new ComposioRedditClient(composio, composioUserId);
  let posts: Array<{ title: string; score: number; comments: number }> = [];

  try {
    const rawPosts = await client.browseSubreddit(sub, 'top', { limit: 30 });
    posts = rawPosts.slice(0, 30).map(p => ({
      title: p.title ?? '',
      score: p.score ?? 0,
      comments: p.num_comments ?? 0,
    }));
  } catch (err) {
    console.warn(`[subreddit-analyzer] Failed to fetch posts for r/${sub}:`, err);
    // Fall through — Claude will analyze with limited data + known priors
  }

  const avgComments = posts.length > 0
    ? Math.round(posts.reduce((s, p) => s + p.comments, 0) / posts.length)
    : 5;

  // Build priors from known patterns
  const knownBanRisk = KNOWN_BAN_RISK[sub];
  const knownTone = KNOWN_TONE[sub];

  const promptPosts = posts.length > 0
    ? posts.slice(0, 20).map((p, i) => `${i + 1}. "${p.title}" (↑${p.score}, 💬${p.comments})`).join('\n')
    : '(No posts retrieved — analyze based on general knowledge of this subreddit)';

  const anthropic = new Anthropic({ apiKey });

  const prompt = `Analyze the Reddit community r/${displaySub} based on these top posts and your knowledge of this community.

TOP POSTS FROM r/${displaySub}:
${promptPosts}

${knownBanRisk ? `Prior signal: ban risk is known to be "${knownBanRisk}"` : ''}
${knownTone ? `Prior signal: community tone is known to be "${knownTone}"` : ''}

Return a JSON object with EXACTLY this structure (no markdown, raw JSON only):
{
  "selfPromoAllowed": "yes" | "flair" | "no" | "unknown",
  "communityTone": "technical" | "founder" | "consumer" | "mixed",
  "banRiskLevel": "low" | "medium" | "high",
  "bestTimeToEngage": "string e.g. 'Mon-Wed, 8am-11am ET' or 'Weekday mornings ET'",
  "exampleMention": "A realistic example of a post title from this sub that successfully mentioned a product — make it specific to this community's language",
  "insightSummary": "2-3 sentence paragraph: how should a solo founder engage here? What tone works? What gets removed?",
  "selfPromoNotes": "One specific rule or gotcha about self-promotion in this sub. Be concrete.",
  "topTopics": ["topic1", "topic2", "topic3", "topic4", "topic5"]
}

Definitions:
- selfPromoAllowed: "yes" = allowed with disclosure, "flair" = only with specific post flair, "no" = strictly banned, "unknown" = unclear
- banRiskLevel: "low" = founder-friendly, mentions get upvoted; "medium" = allowed but risky; "high" = will be removed/banned
- topTopics: the 5 most common conversation themes in this community`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Failed to parse playbook response for r/${sub}`);

  const parsed = JSON.parse(jsonMatch[0]) as Omit<SubredditPlaybookData, 'subreddit' | 'avgRepliesPerPost'>;

  return {
    subreddit: sub,
    avgRepliesPerPost: avgComments,
    ...parsed,
  };
}

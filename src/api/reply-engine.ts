/**
 * AI Reply Engine — Claude-powered Reddit reply coach
 *
 * Generates 3 tone-distinct reply variants (Helpful Expert, Peer Founder,
 * Story-Based) for a given Reddit post using Claude Haiku. Each variant
 * is scored by reply-scorer.ts for ban risk, helpfulness, and conversion
 * potential so founders can pick the safest, most effective option.
 */

import Anthropic from '@anthropic-ai/sdk';
import { scoreReply, TONE_LABELS } from '../intelligence/reply-scorer.js';

const SYSTEM_PROMPT = `You are a Reddit reply coach helping solo founders get their first customers from Reddit without getting banned. Your replies must:
- Sound like a genuine community member, NOT a marketer or bot
- Never start with "Hey!", "Hi there!", generic greetings, or "Great question!"
- Lead with empathy, shared experience, or a specific observation about their post
- Be 2-4 sentences maximum (60-280 characters is the sweet spot)
- Never use sales language: "game-changer", "revolutionary", "check out", "sign up"
- Include a specific detail from their post to prove you actually read it
- Only mention a product when genuinely relevant — always as one option, never a pitch
- End with something useful: a tip, resource, or genuine question — not a CTA
- The goal is to start a conversation, not close a sale`;

export interface GenerateReplyInput {
  postTitle: string;
  postQuote: string;
  subreddit: string;
  signals: string[];
  score: number;
  productDescription: string;
  keywords: string[];
}

export interface GeneratedReply {
  tone: string;
  label: string;
  text: string;
  banRisk: number;
  helpfulness: number;
  conversionPotential: number;
}

export async function generateReplies(input: GenerateReplyInput): Promise<GeneratedReply[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey });

  const userPrompt = `Generate 3 Reddit reply variations for this opportunity. Each reply must be distinctly different in approach.

**Post title:** ${input.postTitle}
**Subreddit:** r/${input.subreddit}
**Post excerpt:** "${input.postQuote}"
**Detected signals:** ${input.signals.join(', ')}
**Intent score:** ${input.score}/100

**My product:** ${input.productDescription}
**Keywords I track:** ${input.keywords.join(', ')}

Respond in this exact JSON format (raw JSON only, no markdown):
[
  {"tone": "expert", "text": "reply text here"},
  {"tone": "peer", "text": "reply text here"},
  {"tone": "story", "text": "reply text here"}
]

expert = share genuine expertise and advice first; mention product only if it's the most logical next step
peer = talk founder-to-founder; share what you've tried; mention product almost as an afterthought ("I actually ended up building something for this")
story = open with a very brief personal story or moment of recognition ("I spent three months debugging this exact issue"); weave product in naturally at the end`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Failed to parse reply response');

  const rawReplies = JSON.parse(jsonMatch[0]) as Array<{ tone: string; text: string }>;

  // Score each reply using heuristic scorer (no additional API call)
  return rawReplies.map(r => {
    const scores = scoreReply(r.text, {
      subreddit: input.subreddit,
      signals: input.signals,
      postTitle: input.postTitle,
    });
    return {
      tone: r.tone,
      label: TONE_LABELS[r.tone] ?? r.tone,
      text: r.text,
      ...scores,
    };
  });
}

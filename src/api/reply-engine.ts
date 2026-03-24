/**
 * AI Reply Engine — Claude-powered contextual Reddit reply drafts
 *
 * Generates 3 tone variations (casual, helpful, direct) for a given
 * Reddit post using Claude Haiku. Called from the dashboard API.
 */

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a Reddit reply strategist helping SaaS founders engage with potential customers on Reddit. Your replies must:
- Sound like a genuine community member, not a marketer or bot
- Never start with "Hey!" or generic greetings
- Lead with empathy or shared experience, then naturally mention the product
- Be 2-4 sentences maximum
- Never use sales language like "game-changer", "revolutionary", "check out"
- Include a specific detail from their post to show you actually read it
- End with something useful (a tip, resource, or genuine question) — not a pitch`;

interface GenerateReplyInput {
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
  text: string;
}

export async function generateReplies(input: GenerateReplyInput): Promise<GeneratedReply[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey });

  const userPrompt = `Generate 3 Reddit reply variations for this post. Each reply should be distinct in tone.

**Post title:** ${input.postTitle}
**Subreddit:** r/${input.subreddit}
**Post excerpt:** "${input.postQuote}"
**Detected signals:** ${input.signals.join(', ')}
**Intent score:** ${input.score}/100

**My product:** ${input.productDescription}
**Keywords I track:** ${input.keywords.join(', ')}

Respond in this exact JSON format (no markdown, just raw JSON):
[
  {"tone": "casual", "text": "reply text here"},
  {"tone": "helpful", "text": "reply text here"},
  {"tone": "direct", "text": "reply text here"}
]

casual = conversational, peer-to-peer, mentions product almost as an afterthought
helpful = leads with genuine advice, weaves product in as one option among others
direct = straightforward value prop, still human and non-salesy`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Failed to parse reply response');

  return JSON.parse(jsonMatch[0]) as GeneratedReply[];
}

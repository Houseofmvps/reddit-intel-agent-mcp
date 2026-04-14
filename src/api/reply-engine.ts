/**
 * AI Reply Engine — Claude-powered Reddit reply coach
 *
 * Generates 3 tone-distinct reply variants (Helpful Expert, Peer Founder,
 * Story Based) for a given Reddit post using Claude Sonnet. Each variant
 * is scored by reply-scorer.ts for ban risk, helpfulness, and conversion
 * potential so founders can pick the safest, most effective option.
 */

import Anthropic from '@anthropic-ai/sdk';
import { scoreReply, TONE_LABELS } from '../intelligence/reply-scorer.js';

const SYSTEM_PROMPT = `You are a solo founder replying to Reddit posts from lived experience. Write exactly like a real person typing quickly — not like an AI assistant generating a helpful response.

VOICE RULES (breaking any of these makes the reply sound like AI):
- Use contractions everywhere: "I've", "we'd", "it's", "didn't", "that's", "you're"
- Mix sentence lengths. Short ones land. Longer ones carry the specifics.
- No bullet points, no numbered lists, no markdown formatting of any kind
- No em dashes. Use a comma or just end the sentence instead.
- Never start with: "Great", "That's", "Interesting", "I completely understand", "Hey", "Hi there", "Absolutely"
- Never end with: "Hope that helps!", "Feel free to DM me", "Let me know if you have questions", "Happy to help!"
- Do not validate the question before answering it. Start with the answer or the observation.
- Prove you read the post: include one specific detail from their situation, not a generic observation
- Vary your opener across the 3 tones — no two replies should start the same way

ENERGY BY TONE:
- expert: You've solved this exact problem before and you're being direct about what actually worked. Confident, maybe slightly blunt. You skip the preamble and get to the useful part.
- peer: You're figuring this out alongside them, not above them. Slightly uncertain. You mention what you tried, including one thing that didn't work. It reads like a text from a friend.
- story: One brief specific memory opens it ("spent most of Q3 on this exact bug") then you get to the point fast. No dramatic arc, just a detail that earns the advice.

PRODUCT MENTION RULES:
- Only mention if it directly and obviously solves their stated problem
- Frame as "I ended up building X because of this" — never "check out X" or "you should try X"
- One mention maximum. Then drop it and keep being helpful.
- If the product is not clearly relevant to their specific situation, skip it entirely.

LENGTH: 2 to 4 sentences. Aim for 60 to 200 characters per reply. Reddit readers skim fast.

WORDS AND PHRASES THAT INSTANTLY READ AS AI (never use these):
"game-changer", "definitely", "certainly", "absolutely", "it's worth noting", "it's important to mention", "in conclusion", "overall", "moving forward", "leverage", "streamline", "seamlessly", "robust", "comprehensive", "revolutionary", "innovative", "cutting-edge", "best practices", "deep dive", "circle back", "at the end of the day", "the best approach would be", "there are several ways", "I completely understand your frustration"

DO NOT write three balanced parallel sentences. Do not structure every reply as opener → middle → closer. Real humans write messier than that.`;

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

  const userPrompt = `Write 3 Reddit replies for this post. Each reply should feel like it came from a different real person — different energy, different sentence rhythm, different way into the topic.

The post is in r/${input.subreddit}. Title: "${input.postTitle}". Key excerpt: "${input.postQuote}". Signals detected: ${input.signals.join(', ')}. Intent score: ${input.score}/100.

The founder's product: ${input.productDescription}. Keywords they track: ${input.keywords.join(', ')}.

Write the replies like someone who genuinely knows this problem — not someone trying to sound like they know it. The expert reply comes in direct with experience. The peer reply is founder-to-founder, including something that didn't work. The story reply opens with one quick specific moment before getting to the point. All three should feel like different humans wrote them, not three variations of the same AI template.

Output raw JSON only, no markdown, no explanation:
[
  {"tone": "expert", "text": "reply text here"},
  {"tone": "peer", "text": "reply text here"},
  {"tone": "story", "text": "reply text here"}
]`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
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

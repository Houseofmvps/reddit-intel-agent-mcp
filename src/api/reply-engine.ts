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

FACTUAL ACCURACY — THIS IS THE MOST IMPORTANT RULE:
You will be given a post title and an excerpt. That excerpt is ALL you know about this person's situation. Do not invent, assume, or add any detail that is not explicitly present in the post.
- If the post doesn't name a payment processor, do not name one in your reply
- If the post doesn't mention their stack, team size, company type, or revenue, do not mention those things
- If the post mentions "Stripe" specifically, you may reference it. If they say "our billing provider", match their language
- When you don't have enough specifics to give precise advice, ask one good question instead of guessing
- Do not extrapolate: "they said recurring billing issues" does not mean "they're probably on Stripe" or "they're likely doing $10K MRR"
- Every fact in your reply must be traceable to something the OP actually wrote

VOICE RULES (breaking any of these makes the reply sound like AI):
- Use contractions everywhere: "I've", "we'd", "it's", "didn't", "that's", "you're"
- Mix sentence lengths. Short ones land. Longer ones carry the specifics.
- No bullet points, no numbered lists, no markdown formatting of any kind
- No em dashes. Use a comma or just end the sentence instead.
- Never start with: "Great", "That's", "Interesting", "I completely understand", "Hey", "Hi there", "Absolutely"
- Never end with: "Hope that helps!", "Feel free to DM me", "Let me know if you have questions", "Happy to help!"
- Do not validate the question before answering it. Start with the answer or the observation.
- Reference one specific detail from their post — not a generic observation about the topic
- Vary your opener across the 3 tones — no two replies should start the same way

ENERGY BY TONE:
- expert: You've solved this exact problem before and you're being direct about what actually worked. Confident, maybe slightly blunt. You skip the preamble and get to the useful part.
- peer: You're figuring this out alongside them, not above them. Slightly uncertain. You mention what you tried, including one thing that didn't work. It reads like a text from a friend.
- story: One brief specific memory opens it ("spent most of Q3 on this exact bug") then you get to the point fast. No dramatic arc, just a detail that earns the advice.

PRODUCT MENTION RULES:
- Only mention if: (a) it directly and obviously solves their stated problem AND (b) you have a real description of what the product does — not a vague name
- Frame as "I ended up building X because of this" — never "check out X" or "you should try X"
- One mention maximum. Then drop it and keep being helpful.
- If the product description is vague or doesn't clearly map to their specific situation, skip it entirely. Better to be helpful without mentioning it.

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

// Consider a product description too vague to mention if it's a generic placeholder
function isVagueProductDescription(desc: string): boolean {
  const lower = desc.toLowerCase().trim();
  return (
    lower === 'my saas product' ||
    lower === 'my product' ||
    lower === 'my startup' ||
    lower === 'my tool' ||
    lower.length < 15 ||
    // Monitor names that are just subreddit names or keyword sets aren't product descriptions
    /^(r\/|monitor|keyword|track|alert)/i.test(lower)
  );
}

export async function generateReplies(input: GenerateReplyInput): Promise<GeneratedReply[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey });

  const productIsVague = isVagueProductDescription(input.productDescription);

  // Build the post context block — be explicit about what we do and don't know
  const postContext = [
    `Subreddit: r/${input.subreddit}`,
    `Post title: "${input.postTitle}"`,
    input.postQuote?.trim()
      ? `Post body excerpt (everything you know about this person's situation): "${input.postQuote}"`
      : `Post body: (no body text — only the title above is available)`,
    `Signals detected in this post: ${input.signals.length > 0 ? input.signals.join(', ') : 'none'}`,
  ].join('\n');

  const productContext = productIsVague
    ? `The founder's product: do not mention any product in these replies — the description is too vague to use accurately.`
    : `The founder's product: "${input.productDescription}". Only mention this if their post directly describes the exact problem it solves. If it's a stretch, skip it.`;

  const userPrompt = `Write 3 Reddit replies for this post. Each reply should feel like it came from a different real person — different energy, different sentence rhythm, different way into the topic.

${postContext}

${productContext}

CRITICAL: Your replies must only reference facts from the post text above. If the post doesn't mention a specific tool, company, or number — do not invent one. If you're unsure about their specific setup, ask a short question rather than assume.

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

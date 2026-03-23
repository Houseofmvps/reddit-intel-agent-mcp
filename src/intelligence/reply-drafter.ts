interface DraftInput {
  intentType: string;
  painPoints: string[];
  productDescription?: string;
  subreddit: string;
  postTitle?: string;
  postBody?: string;
}

const TEMPLATES: Record<string, (input: DraftInput) => string> = {
  'alternative-seeking': (i) => {
    const pain = i.painPoints[0] ?? 'the frustrations';
    return `I went through the same thing — ${pain}. After trying a few options, I ended up switching to a ${i.productDescription || 'different tool'} and it's been solid for the past few months.\n\nThe biggest difference for me was [specific benefit that addresses their pain]. Happy to share my setup if you want to compare notes.`;
  },
  'pain-expressing': (i) => {
    const pain = i.painPoints[0] ?? 'that issue';
    const cleanPain = pain.toLowerCase().replace(/^(i |my |our |we )/, '');
    return `Totally feel this — dealing with ${cleanPain} is one of those problems that seems small but eats hours every week.\n\nWhat worked for me was [specific approach or tip]. I also use a ${i.productDescription || 'tool'} that handles this automatically, which saved me about [time estimate] per week. Let me know if you want details on the setup.`;
  },
  'recommendation-asking': (i) => {
    return `I've tested about a dozen options in this space. Here's what I'd look at:\n\n1. [Category leader] — great if you need [feature], but pricey\n2. [Budget option] — good for getting started\n3. I personally use a ${i.productDescription || 'tool'} — it's been the best fit for [specific use case]\n\nWhat's your main priority — price, features, or ease of setup?`;
  },
  'migration-planning': (i) => {
    const pain = i.painPoints[0] ?? 'the migration';
    return `I migrated from a similar setup about 6 months ago. ${pain} was exactly what pushed me to switch.\n\nThe transition took me about [timeframe] — the main gotcha was [specific challenge]. I ended up going with a ${i.productDescription || 'different solution'} and the difference in [key metric] was noticeable within the first week.\n\nHappy to share the migration checklist I used if that'd help.`;
  },
};

export function draftReply(input: DraftInput): string {
  const template = TEMPLATES[input.intentType] ?? TEMPLATES['pain-expressing']!;
  let reply = template(input);
  if (reply.length > 800) reply = reply.slice(0, 797) + '...';
  return reply;
}

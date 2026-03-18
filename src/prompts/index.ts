/**
 * Reddit Intelligence Agent — Prompt packs
 *
 * Pre-built prompts that guide users through intelligence workflows.
 * These are returned as MCP prompt templates.
 */

export interface PromptPack {
  name: string;
  description: string;
  tier: 'free' | 'pro';
  workflow: string;
}

export const PROMPT_PACKS: PromptPack[] = [
  // ─── Free prompts ─────────────────────────────────────────
  {
    name: 'validate_startup_idea',
    description: 'Validate a startup idea using Reddit evidence',
    tier: 'free',
    workflow: `Step 1: Use find_pain_points with your idea domain and relevant subreddits.
Step 2: Use detect_workarounds to see what DIY solutions exist.
Step 3: Use search_reddit to find existing competitor discussions.
Step 4: Synthesize: How many people have this pain? How are they solving it today? Is the market open?`,
  },
  {
    name: 'quick_market_scan',
    description: 'Quickly scan a market from Reddit discussions',
    tier: 'free',
    workflow: `Step 1: Use search_reddit for your market/product category across 3-5 relevant subreddits.
Step 2: Use find_pain_points to identify common frustrations.
Step 3: Look at post scores and comment counts to gauge engagement.
Step 4: Summarize the top 3 themes and biggest pain points you found.`,
  },
  {
    name: 'subreddit_deep_dive',
    description: 'Deep-dive into a specific subreddit for research',
    tier: 'free',
    workflow: `Step 1: Use browse_subreddit with sort="top" and time="month" to see what resonates.
Step 2: Use browse_subreddit with sort="new" to see current discussions.
Step 3: Pick 2-3 high-engagement posts and use post_details to read comments.
Step 4: Use find_pain_points scoped to this subreddit for structured insight.`,
  },
  {
    name: 'user_research',
    description: 'Research a Reddit user for context on their needs',
    tier: 'free',
    workflow: `Step 1: Use user_profile to understand their activity and interests.
Step 2: Look at their top subreddits to understand their role/domain.
Step 3: Check their recent posts and comments for pain points or buying signals.
Step 4: Build a profile: What do they care about? What tools do they use? What frustrates them?`,
  },
  {
    name: 'find_underserved_niches',
    description: 'Discover underserved niches where people lack good tools',
    tier: 'free',
    workflow: `Step 1: Use detect_workarounds across several problem domains you're interested in.
Step 2: Use find_pain_points in the same domains.
Step 3: Compare: Where do workarounds exist but pain is still high? That's your opportunity.
Step 4: Use search_reddit to check if existing solutions are discussed (low mentions = underserved).`,
  },

  // ─── Pro prompts ──────────────────────────────────────────
  {
    name: 'full_opportunity_assessment',
    description: 'Complete startup opportunity assessment with scoring',
    tier: 'pro',
    workflow: `Step 1: Use score_opportunity with your idea, relevant subreddits, and competitor names.
Step 2: Review the opportunity score breakdown — which signals are strong vs weak?
Step 3: Use extract_feature_gaps to find what competitors miss.
Step 4: Use track_pricing_objections to understand price sensitivity.
Step 5: Use export_evidence_pack to create a shareable report.`,
  },
  {
    name: 'competitor_intelligence_report',
    description: 'Build a comprehensive competitor intelligence report',
    tier: 'pro',
    workflow: `Step 1: Use monitor_competitors with 3-5 competitor names.
Step 2: Use extract_feature_gaps for each competitor.
Step 3: Use track_pricing_objections for the top 2 competitors.
Step 4: Synthesize: Where are competitors weakest? What do users want that nobody provides?
Step 5: Use export_evidence_pack to create a Markdown report.`,
  },
  {
    name: 'lead_discovery_workflow',
    description: 'Find and qualify buyer intent leads from Reddit',
    tier: 'pro',
    workflow: `Step 1: Use find_buyer_intent with your solution category and target subreddits.
Step 2: Review the lead scores — focus on "hot" leads (score 70+).
Step 3: For each hot lead, use post_details to understand full context.
Step 4: Use build_icp to understand the common profile of buyers.
Step 5: Use export_evidence_pack to create a lead list with evidence.`,
  },
  {
    name: 'pricing_strategy_research',
    description: 'Research pricing strategy from Reddit discussions',
    tier: 'pro',
    workflow: `Step 1: Use track_pricing_objections for your product (or competitors).
Step 2: Use find_buyer_intent to see what people are willing to pay.
Step 3: Use search_reddit for "pricing" + your domain to find general pricing discussions.
Step 4: Synthesize: What price points are mentioned? What's considered "too expensive"? Where's the sweet spot?`,
  },
  {
    name: 'icp_builder',
    description: 'Build a detailed Ideal Customer Profile from Reddit data',
    tier: 'pro',
    workflow: `Step 1: Use build_icp with your product domain and 3-5 target subreddits.
Step 2: Use find_pain_points to validate the ICP's pain points.
Step 3: Use find_buyer_intent to cross-reference with actual buying signals.
Step 4: Refine: Which roles appear most? What tools do they already use? What triggers buying?`,
  },
];

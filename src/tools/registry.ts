/**
 * Reddit Intelligence Agent — Tool registry with tier enforcement
 *
 * Central dispatcher: validates tier access, parses args with Zod, routes to tool method.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema, type JsonSchema7Type } from 'zod-to-json-schema';
import { RetrievalTools } from './retrieval.js';
import { IntelligenceTools } from './intelligence.js';
import { ExportTools } from './export.js';
import { canAccessTool, tierGateMessage } from '../core/tiers.js';
import type { ProductTier, ToolTier } from '../types/index.js';
import * as schemas from './schemas.js';

interface ToolEntry {
  name: string;
  description: string;
  tier: ToolTier;
  category: string;
  schema: z.ZodTypeAny;
  execute: (args: unknown) => Promise<unknown>;
}

function toInputSchema(schema: z.ZodTypeAny, name: string): Tool['inputSchema'] {
  try {
    const json = zodToJsonSchema(schema, { name, target: 'jsonSchema7', $refStrategy: 'none' }) as JsonSchema7Type & Record<string, unknown>;
    if ('definitions' in json && name in (json.definitions as Record<string, unknown>)) {
      return (json.definitions as Record<string, unknown>)[name] as Tool['inputSchema'];
    }
    return json as Tool['inputSchema'];
  } catch {
    return { type: 'object', properties: {} } as Tool['inputSchema'];
  }
}

export class ToolRegistry {
  private entries: ToolEntry[] = [];
  private retrieval: RetrievalTools;
  private intel: IntelligenceTools;
  private exporter: ExportTools;

  constructor(
    retrieval: RetrievalTools,
    intel: IntelligenceTools,
    exporter: ExportTools,
  ) {
    this.retrieval = retrieval;
    this.intel = intel;
    this.exporter = exporter;
    this.registerAll();
  }

  private registerAll(): void {
    // ─── Retrieval tools (all free) ──────────────────────────────
    this.register('browse_subreddit', 'Fetch posts from a subreddit with sorting options. Returns post list with content, scores, and metadata.', 'free', 'retrieval', schemas.browseSubredditSchema, a => this.retrieval.browseSubreddit(schemas.browseSubredditSchema.parse(a)));
    this.register('search_reddit', 'Search for posts across Reddit or specific subreddits. Returns matching posts with content and metadata.', 'free', 'retrieval', schemas.searchRedditSchema, a => this.retrieval.searchReddit(schemas.searchRedditSchema.parse(a)));
    this.register('post_details', 'Fetch a Reddit post with its comments. Requires EITHER url OR post_id.', 'free', 'retrieval', schemas.postDetailsSchema, a => this.retrieval.postDetails(schemas.postDetailsSchema.parse(a)));
    this.register('user_profile', 'Analyze a Reddit user\'s posting history, karma, and activity patterns.', 'free', 'retrieval', schemas.userProfileSchema, a => this.retrieval.userProfile(schemas.userProfileSchema.parse(a)));
    this.register('reddit_explain', 'Explain Reddit terms, jargon, and culture (karma, cake day, AMA, flair, etc). 40+ terms covered.', 'free', 'retrieval', schemas.redditExplainSchema, a => this.retrieval.redditExplain(schemas.redditExplainSchema.parse(a)));

    // ─── Intelligence tools (all free — Pro unlocks full results) ──
    this.register('find_pain_points', 'Discover user frustrations and unmet needs. Free: top 10 results. Pro: unlimited with full severity scoring.', 'free', 'intelligence', schemas.findPainPointsSchema, a => this.intel.findPainPoints(schemas.findPainPointsSchema.parse(a)));
    this.register('detect_workarounds', 'Find DIY solutions people built because no good product exists. Free: top 10. Pro: unlimited with clustering.', 'free', 'intelligence', schemas.detectWorkaroundsSchema, a => this.intel.detectWorkarounds(schemas.detectWorkaroundsSchema.parse(a)));
    this.register('score_opportunity', 'Score a startup idea against Reddit evidence. Returns 0-100 opportunity score. Free: basic score. Pro: full breakdown.', 'free', 'intelligence', schemas.scoreOpportunitySchema, a => this.intel.scoreOpportunity(schemas.scoreOpportunitySchema.parse(a)));
    this.register('monitor_competitors', 'Track how competitors are discussed on Reddit. Free: top 3 competitors, 5 posts each. Pro: unlimited.', 'free', 'intelligence', schemas.monitorCompetitorsSchema, a => this.intel.monitorCompetitors(schemas.monitorCompetitorsSchema.parse(a)));
    this.register('extract_feature_gaps', 'Find features users want but a product doesn\'t offer yet. Free: top 10 gaps. Pro: unlimited with clustering.', 'free', 'intelligence', schemas.extractFeatureGapsSchema, a => this.intel.extractFeatureGaps(schemas.extractFeatureGapsSchema.parse(a)));
    this.register('track_pricing_objections', 'Discover what people say about pricing — too expensive, seeking alternatives. Free: top 10. Pro: unlimited.', 'free', 'intelligence', schemas.trackPricingObjectionsSchema, a => this.intel.trackPricingObjections(schemas.trackPricingObjectionsSchema.parse(a)));
    this.register('find_buyer_intent', 'Find people actively looking to buy a solution. Free: top 10 leads. Pro: unlimited with full lead scoring.', 'free', 'intelligence', schemas.findBuyerIntentSchema, a => this.intel.findBuyerIntent(schemas.findBuyerIntentSchema.parse(a)));
    this.register('build_icp', 'Build an Ideal Customer Profile from Reddit — roles, pain points, tools used, buying triggers.', 'free', 'intelligence', schemas.buildICPSchema, a => this.intel.buildICP(schemas.buildICPSchema.parse(a)));

    // ─── Export (free) ────────────────────────────────────────
    this.register('export_evidence_pack', 'Bundle intelligence results into a structured evidence report (JSON or Markdown).', 'free', 'export', schemas.exportEvidencePackSchema, a => this.exporter.exportEvidencePack(schemas.exportEvidencePackSchema.parse(a)));
  }

  private register(name: string, description: string, tier: ToolTier, category: string, schema: z.ZodTypeAny, execute: (args: unknown) => Promise<unknown>) {
    this.entries.push({ name, description, tier, category, schema, execute });
  }

  listTools(): Tool[] {
    return this.entries.map(e => ({
      name: e.name,
      description: `[${e.tier.toUpperCase()}] ${e.description}`,
      inputSchema: toInputSchema(e.schema, e.name),
      readOnlyHint: true,
    }));
  }

  async callTool(name: string, args: unknown, currentTier: ProductTier): Promise<{ result: string; isError: boolean }> {
    const entry = this.entries.find(e => e.name === name);
    if (!entry) {
      return { result: `Unknown tool: ${name}`, isError: true };
    }

    if (!canAccessTool(currentTier, entry.tier)) {
      return { result: tierGateMessage(name, entry.tier), isError: true };
    }

    try {
      const result = await entry.execute(args);
      return { result: typeof result === 'string' ? result : JSON.stringify(result, null, 2), isError: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { result: `Error: ${msg}`, isError: true };
    }
  }
}

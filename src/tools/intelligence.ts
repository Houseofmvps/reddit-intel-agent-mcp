/**
 * Reddit Intelligence Agent — Intelligence tools
 *
 * All 13 tools available on free tier with result limits (10 results).
 * Pro ($9/mo): Unlimited results, full scoring breakdowns, clustering.
 * Team ($29/mo): Everything in Pro + priority support.
 */

import { z } from 'zod';
import { RedditClient } from '../reddit/client.js';
import { daysSince } from '../reddit/formatter.js';
import {
  matchPatterns, hasCategory, categoryWeight, signalSummary,
  scoreOpportunity, scoreSignals, scoreLeadPost,
  clusterPosts,
  type OpportunityInput,
} from '../intelligence/index.js';
import type { PainPoint, Workaround, ProductTier, RedditPost } from '../types/index.js';
import {
  findPainPointsSchema,
  detectWorkaroundsSchema,
  scoreOpportunitySchema,
  monitorCompetitorsSchema,
  extractFeatureGapsSchema,
  trackPricingObjectionsSchema,
  findBuyerIntentSchema,
  buildICPSchema,
} from './schemas.js';

export class IntelligenceTools {
  constructor(private reddit: RedditClient, private tier: ProductTier) {}

  // ─── find_pain_points ─────────────────────────────────────────

  async findPainPoints(params: z.infer<typeof findPainPointsSchema>) {
    const posts = await this.gatherPosts(params.query, params.subreddits, params.time, params.limit);

    const painPoints: PainPoint[] = [];

    for (const post of posts) {
      const text = `${post.title} ${post.selftext ?? ''}`;
      const matches = matchPatterns(text);

      if (hasCategory(matches, 'pain') || hasCategory(matches, 'frustration')) {
        const severity = this.classifySeverity(matches);
        painPoints.push({
          text: post.title,
          source_url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          score: post.score,
          num_comments: post.num_comments,
          recency_days: Math.round(daysSince(post.created_utc)),
          author: post.author,
          severity,
          signals: signalSummary(matches),
          opportunity_hint: this.deriveOpportunityHint(matches),
        });
      }
    }

    // Sort by engagement (score + comments)
    painPoints.sort((a, b) => (b.score + b.num_comments) - (a.score + a.num_comments));

    // Free tier: top 10 with basic scoring
    if (this.tier === 'free') {
      const limited = painPoints.slice(0, 10);
      return {
        pain_points: limited.map(p => ({
          text: p.text,
          source_url: p.source_url,
          subreddit: p.subreddit,
          score: p.score,
          num_comments: p.num_comments,
          author: p.author,
          severity: p.severity,
          signals: p.signals,
        })),
        total_found: painPoints.length,
        note: painPoints.length > 10
          ? `Showing 10 of ${painPoints.length} pain points. Upgrade to Pro ($9.99/mo) at https://buildradar.xyz for unlimited results with opportunity hints.`
          : undefined,
      };
    }

    // Pro/Team: full results with scoring
    return {
      pain_points: painPoints,
      total_found: painPoints.length,
      severity_breakdown: {
        critical: painPoints.filter(p => p.severity === 'critical').length,
        high: painPoints.filter(p => p.severity === 'high').length,
        medium: painPoints.filter(p => p.severity === 'medium').length,
        low: painPoints.filter(p => p.severity === 'low').length,
      },
      top_subreddits: this.topSubreddits(painPoints),
    };
  }

  // ─── detect_workarounds ───────────────────────────────────────

  async detectWorkarounds(params: z.infer<typeof detectWorkaroundsSchema>) {
    const safeDomain = params.domain.replace(/"/g, '');
    const queries = [
      `"${safeDomain}" workaround`,
      `"${safeDomain}" hack`,
      `"${safeDomain}" built my own`,
      `"${safeDomain}" spreadsheet`,
    ];

    const allPosts: RedditPost[] = [];
    for (const q of queries) {
      const posts = await this.gatherPosts(q, params.subreddits, params.time, Math.ceil(params.limit / queries.length));
      allPosts.push(...posts);
    }

    // Deduplicate by post ID
    const seen = new Set<string>();
    const uniquePosts = allPosts.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    const workarounds: Workaround[] = [];

    for (const post of uniquePosts) {
      const text = `${post.title} ${post.selftext ?? ''}`;
      const matches = matchPatterns(text);

      if (hasCategory(matches, 'workaround')) {
        workarounds.push({
          description: post.title,
          tools_mentioned: this.extractToolMentions(text),
          frustration_level: categoryWeight(matches, 'pain') >= 6 ? 'high' : categoryWeight(matches, 'pain') >= 3 ? 'medium' : 'low',
          source_url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          upvotes: post.score,
          author: post.author,
          signals: signalSummary(matches),
        });
      }
    }

    workarounds.sort((a, b) => b.upvotes - a.upvotes);

    // Free tier: top 10 with basic info
    if (this.tier === 'free') {
      const limited = workarounds.slice(0, 10);
      return {
        workarounds: limited.map(w => ({
          description: w.description,
          source_url: w.source_url,
          subreddit: w.subreddit,
          upvotes: w.upvotes,
          author: w.author,
          frustration_level: w.frustration_level,
          signals: w.signals,
        })),
        total_found: workarounds.length,
        note: workarounds.length > 10
          ? `Showing 10 of ${workarounds.length} workarounds. Upgrade to Pro ($9.99/mo) at https://buildradar.xyz for unlimited results with clustering and tool mentions.`
          : undefined,
      };
    }

    // Pro: full results + clustering
    const clusters = clusterPosts(uniquePosts.filter(p => {
      const matches = matchPatterns(`${p.title} ${p.selftext ?? ''}`);
      return hasCategory(matches, 'workaround');
    }));

    return {
      workarounds,
      total_found: workarounds.length,
      clusters: clusters.slice(0, 8),
      common_tools: this.aggregateTools(workarounds),
    };
  }

  // ─── score_opportunity (Pro only) ─────────────────────────────

  async scoreOpportunity(params: z.infer<typeof scoreOpportunitySchema>) {
    const postLimit = params.depth === 'quick' ? 25 : 75;

    // Gather pain points
    const painPosts = await this.gatherPosts(params.idea, params.subreddits, params.time, postLimit);
    const painPoints: PainPoint[] = [];
    for (const post of painPosts) {
      const matches = matchPatterns(`${post.title} ${post.selftext ?? ''}`);
      if (hasCategory(matches, 'pain') || hasCategory(matches, 'frustration')) {
        painPoints.push({
          text: post.title,
          source_url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          score: post.score,
          num_comments: post.num_comments,
          recency_days: Math.round(daysSince(post.created_utc)),
          author: post.author,
          severity: this.classifySeverity(matches),
          signals: signalSummary(matches),
        });
      }
    }

    // Gather workarounds
    const workaroundPosts = await this.gatherPosts(`${params.idea} workaround OR hack OR "built my own"`, params.subreddits, params.time, Math.ceil(postLimit / 2));
    const workarounds: Workaround[] = [];
    for (const post of workaroundPosts) {
      const matches = matchPatterns(`${post.title} ${post.selftext ?? ''}`);
      if (hasCategory(matches, 'workaround')) {
        workarounds.push({
          description: post.title,
          tools_mentioned: this.extractToolMentions(`${post.title} ${post.selftext ?? ''}`),
          frustration_level: categoryWeight(matches, 'pain') >= 6 ? 'high' : 'medium',
          source_url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          upvotes: post.score,
          author: post.author,
          signals: signalSummary(matches),
        });
      }
    }

    // Gather competitor sentiment
    const competitorMentions: Array<{ sentiment: 'positive' | 'negative' | 'neutral'; score: number }> = [];
    for (const comp of params.competitors) {
      const compPosts = await this.gatherPosts(comp, params.subreddits, params.time, 15);
      for (const post of compPosts) {
        const matches = matchPatterns(`${post.title} ${post.selftext ?? ''}`);
        const painW = categoryWeight(matches, 'pain') + categoryWeight(matches, 'frustration');
        const posW = categoryWeight(matches, 'positive');
        const sentiment = painW > posW ? 'negative' : posW > painW ? 'positive' : 'neutral';
        competitorMentions.push({ sentiment, score: post.score });
      }
    }

    // Get subreddit subscriber counts
    const subNames = [...new Set(painPosts.map(p => p.subreddit))];
    const subSubscribers: number[] = [];
    for (const sub of subNames.slice(0, 5)) {
      try {
        const info = await this.reddit.getSubredditInfo(sub);
        subSubscribers.push(info.subscribers);
      } catch {
        // skip
      }
    }

    const input: OpportunityInput = {
      painPoints,
      workarounds,
      competitorMentions,
      totalPostsSearched: painPosts.length,
      subredditSubscribers: subSubscribers,
    };

    const opportunityScore = scoreOpportunity(input);

    return {
      idea: params.idea,
      score: opportunityScore,
      top_pain_points: painPoints.slice(0, 10),
      top_workarounds: workarounds.slice(0, 5),
      competitor_sentiment: params.competitors.length > 0 ? {
        total_mentions: competitorMentions.length,
        negative_ratio: competitorMentions.length > 0
          ? (competitorMentions.filter(m => m.sentiment === 'negative').length / competitorMentions.length).toFixed(2)
          : '0',
      } : undefined,
    };
  }

  // ─── monitor_competitors (Pro) ────────────────────────────────

  async monitorCompetitors(params: z.infer<typeof monitorCompetitorsSchema>) {
    const results: Array<{
      competitor: string;
      mentions: number;
      signal_score: ReturnType<typeof scoreSignals>;
      sample_posts: Array<{ title: string; url: string; score: number; subreddit: string; sentiment: string }>;
    }> = [];

    for (const competitor of params.competitors) {
      const posts = await this.gatherPosts(competitor, params.subreddits, params.time, params.limit);
      const signalScore = scoreSignals({ posts, query: competitor });

      const samplePosts = posts.slice(0, 5).map(p => {
        const matches = matchPatterns(`${p.title} ${p.selftext ?? ''}`);
        const painW = categoryWeight(matches, 'pain') + categoryWeight(matches, 'frustration');
        const posW = categoryWeight(matches, 'positive');
        return {
          title: p.title,
          url: `https://reddit.com${p.permalink}`,
          score: p.score,
          subreddit: p.subreddit,
          sentiment: painW > posW ? 'negative' : posW > painW ? 'positive' : 'neutral',
        };
      });

      results.push({
        competitor,
        mentions: posts.length,
        signal_score: signalScore,
        sample_posts: samplePosts,
      });
    }

    results.sort((a, b) => b.signal_score.total - a.signal_score.total);

    return {
      competitors: results,
      summary: results.map(r => `${r.competitor}: ${r.mentions} mentions, signal score ${r.signal_score.total}/100`).join('\n'),
    };
  }

  // ─── extract_feature_gaps (Pro) ───────────────────────────────

  async extractFeatureGaps(params: z.infer<typeof extractFeatureGapsSchema>) {
    const queries = [
      `"${params.product.replace(/"/g, '')}" "feature request"`,
      `"${params.product.replace(/"/g, '')}" "wish" OR "should have" OR "why can't"`,
      `"${params.product.replace(/"/g, '')}" missing OR lacks`,
    ];

    const allPosts: RedditPost[] = [];
    for (const q of queries) {
      const posts = await this.gatherPosts(q, params.subreddits, params.time, 25);
      allPosts.push(...posts);
    }

    const deduped = this.deduplicate(allPosts);
    const gaps: Array<{
      title: string;
      source_url: string;
      subreddit: string;
      score: number;
      signals: string[];
      competitors_mentioned: string[];
    }> = [];

    for (const post of deduped) {
      const text = `${post.title} ${post.selftext ?? ''}`;
      const matches = matchPatterns(text);
      if (hasCategory(matches, 'feature_request') || hasCategory(matches, 'pain')) {
        const competitorsMentioned = params.competitors.filter(c =>
          text.toLowerCase().includes(c.toLowerCase()),
        );
        gaps.push({
          title: post.title,
          source_url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          score: post.score,
          signals: signalSummary(matches),
          competitors_mentioned: competitorsMentioned,
        });
      }
    }

    gaps.sort((a, b) => b.score - a.score);
    const clusters = clusterPosts(deduped.filter(p => {
      const m = matchPatterns(`${p.title} ${p.selftext ?? ''}`);
      return hasCategory(m, 'feature_request');
    }));

    return {
      product: params.product,
      feature_gaps: gaps.slice(0, 20),
      total_found: gaps.length,
      themes: clusters.slice(0, 5),
    };
  }

  // ─── track_pricing_objections (Pro) ───────────────────────────

  async trackPricingObjections(params: z.infer<typeof trackPricingObjectionsSchema>) {
    const queries = [
      `"${params.product.replace(/"/g, '')}" "too expensive" OR "overpriced" OR "not worth"`,
      `"${params.product.replace(/"/g, '')}" pricing OR price OR cost`,
      `"${params.product.replace(/"/g, '')}" "free alternative" OR "open source alternative"`,
    ];

    const allPosts: RedditPost[] = [];
    for (const q of queries) {
      const posts = await this.gatherPosts(q, params.subreddits, params.time, 25);
      allPosts.push(...posts);
    }

    const deduped = this.deduplicate(allPosts);
    const objections: Array<{
      title: string;
      source_url: string;
      subreddit: string;
      score: number;
      objection_type: string;
      signals: string[];
    }> = [];

    for (const post of deduped) {
      const text = `${post.title} ${post.selftext ?? ''}`;
      const matches = matchPatterns(text);
      if (hasCategory(matches, 'pricing_objection')) {
        const types = matches.filter(m => m.category === 'pricing_objection').map(m => m.label);
        objections.push({
          title: post.title,
          source_url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          score: post.score,
          objection_type: types[0] ?? 'general',
          signals: signalSummary(matches),
        });
      }
    }

    objections.sort((a, b) => b.score - a.score);

    const typeBreakdown: Record<string, number> = {};
    for (const o of objections) {
      typeBreakdown[o.objection_type] = (typeBreakdown[o.objection_type] ?? 0) + 1;
    }

    return {
      product: params.product,
      objections: objections.slice(0, 20),
      total_found: objections.length,
      type_breakdown: typeBreakdown,
    };
  }

  // ─── find_buyer_intent (Pro) ──────────────────────────────────

  async findBuyerIntent(params: z.infer<typeof findBuyerIntentSchema>) {
    const queries = [
      `"${params.solution_category.replace(/"/g, '')}" "looking for" OR "recommend" OR "need a"`,
      `"${params.solution_category.replace(/"/g, '')}" "best" OR "which" OR "suggestions"`,
      `"${params.solution_category.replace(/"/g, '')}" "willing to pay" OR "budget"`,
    ];

    const allPosts: RedditPost[] = [];
    for (const q of queries) {
      const posts = await this.gatherPosts(q, params.subreddits, params.time, Math.ceil(params.limit / queries.length));
      allPosts.push(...posts);
    }

    const deduped = this.deduplicate(allPosts);
    const leads: Array<{
      title: string;
      source_url: string;
      subreddit: string;
      author: string;
      lead_score: ReturnType<typeof scoreLeadPost>;
      created_utc: number;
    }> = [];

    for (const post of deduped) {
      const leadScore = scoreLeadPost(post);
      if (leadScore.total >= 20) {
        leads.push({
          title: post.title,
          source_url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          author: post.author,
          lead_score: leadScore,
          created_utc: post.created_utc,
        });
      }
    }

    leads.sort((a, b) => b.lead_score.total - a.lead_score.total);

    return {
      solution_category: params.solution_category,
      leads: leads.slice(0, 25),
      total_found: leads.length,
      quality_breakdown: {
        hot: leads.filter(l => l.lead_score.total >= 70).length,
        warm: leads.filter(l => l.lead_score.total >= 40 && l.lead_score.total < 70).length,
        cool: leads.filter(l => l.lead_score.total < 40).length,
      },
    };
  }

  // ─── build_icp (Pro) ──────────────────────────────────────────

  async buildICP(params: z.infer<typeof buildICPSchema>) {
    const posts: RedditPost[] = [];
    for (const sub of params.subreddits) {
      const result = await this.reddit.search(params.product_domain, {
        subreddit: sub,
        sort: 'relevance',
        time: params.time,
        limit: 30,
      });
      posts.push(...result.data.children.map(c => c.data));
    }

    // Extract roles mentioned
    const roleRegex = /\b(founder|ceo|cto|developer|engineer|marketer|designer|freelancer|consultant|agency|manager|director|vp|head of|lead)\b/gi;
    const roleCounts = new Map<string, number>();
    const painPoints: string[] = [];
    const toolsMentioned = new Set<string>();

    for (const post of posts) {
      const text = `${post.title} ${post.selftext ?? ''}`;
      const roles = text.match(roleRegex) ?? [];
      for (const r of roles) roleCounts.set(r.toLowerCase(), (roleCounts.get(r.toLowerCase()) ?? 0) + 1);

      const matches = matchPatterns(text);
      if (hasCategory(matches, 'pain')) painPoints.push(post.title);

      const tools = this.extractToolMentions(text);
      for (const t of tools) toolsMentioned.add(t);
    }

    const topRoles = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r]) => r);

    // Budget signals
    const budgetPosts = posts.filter(p => {
      const text = `${p.title} ${p.selftext ?? ''}`;
      return /\$\d+|\bbudget\b|\bwilling to pay\b|\bpricing\b/i.test(text);
    });
    const priceMatches = posts.flatMap(p => (`${p.title} ${p.selftext ?? ''}`).match(/\$\d[\d,]*/g) ?? []);

    return {
      product_domain: params.product_domain,
      icp: {
        roles: topRoles.length > 0 ? topRoles : ['not enough data'],
        pain_points: painPoints.slice(0, 10),
        tools_used: [...toolsMentioned].slice(0, 15),
        active_subreddits: params.subreddits,
        budget_indicators: priceMatches.slice(0, 5),
        buying_triggers: [
          budgetPosts.length > 0 ? 'price-sensitive buyers present' : null,
          painPoints.length > 5 ? 'high pain frequency' : null,
        ].filter(Boolean),
      },
      data_quality: {
        posts_analyzed: posts.length,
        subreddits_searched: params.subreddits.length,
      },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async gatherPosts(query: string, subreddits: string[], time: string, limit: number): Promise<RedditPost[]> {
    if (subreddits.length === 0) {
      const res = await this.reddit.search(query, { sort: 'relevance', time, limit });
      return res.data.children.map(c => c.data);
    }

    const posts: RedditPost[] = [];
    const perSub = Math.ceil(limit / subreddits.length);
    const results = await Promise.allSettled(
      subreddits.map(sub => this.reddit.search(query, { subreddit: sub, sort: 'relevance', time, limit: perSub })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') posts.push(...r.value.data.children.map(c => c.data));
    }
    return posts;
  }

  private deduplicate(posts: RedditPost[]): RedditPost[] {
    const seen = new Set<string>();
    return posts.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  private classifySeverity(matches: import('../intelligence/patterns.js').PatternMatch[]): 'low' | 'medium' | 'high' | 'critical' {
    const painW = categoryWeight(matches, 'pain') + categoryWeight(matches, 'frustration');
    if (painW >= 10) return 'critical';
    if (painW >= 6) return 'high';
    if (painW >= 3) return 'medium';
    return 'low';
  }

  private deriveOpportunityHint(matches: import('../intelligence/patterns.js').PatternMatch[]): string | undefined {
    if (hasCategory(matches, 'workaround')) return 'Users are building workarounds — product opportunity exists';
    if (matches.some(m => m.label === 'unmet_need')) return 'Explicit unmet need detected';
    if (matches.some(m => m.label === 'dealbreaker')) return 'Dealbreaker-level frustration — high urgency';
    if (matches.some(m => m.label === 'time_waste')) return 'Users wasting significant time — automation opportunity';
    return undefined;
  }

  private extractToolMentions(text: string): string[] {
    const tools = new Set<string>();
    const toolPatterns = [
      /\b(google sheets?|excel|airtable|notion|trello|asana|jira|slack|zapier|n8n|make\.com|figma|canva|stripe|shopify|wordpress|hubspot|salesforce|mailchimp|sendgrid|postman|github|gitlab|vercel|netlify|aws|gcp|azure|heroku|railway|supabase|firebase|mongodb|postgres|mysql|redis|docker|kubernetes)\b/gi,
    ];
    for (const pattern of toolPatterns) {
      const found = text.match(pattern) ?? [];
      for (const t of found) tools.add(t.toLowerCase());
    }
    return [...tools];
  }

  private aggregateTools(workarounds: Workaround[]): Array<{ tool: string; count: number }> {
    const counts = new Map<string, number>();
    for (const w of workarounds) {
      for (const t of w.tools_mentioned) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tool, count]) => ({ tool, count }));
  }

  private topSubreddits(painPoints: PainPoint[]): Array<{ subreddit: string; count: number }> {
    const counts = new Map<string, number>();
    for (const p of painPoints) counts.set(p.subreddit, (counts.get(p.subreddit) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([subreddit, count]) => ({ subreddit, count }));
  }
}

/**
 * Reddit Intelligence Agent — Zod schemas for all MCP tools
 */

import { z } from 'zod';

// ─── Retrieval Schemas (Free) ───────────────────────────────────

export const browseSubredditSchema = z.object({
  subreddit: z.string().describe('Subreddit name without r/ prefix. Use "all" for frontpage, "popular" for trending.'),
  sort: z.enum(['hot', 'new', 'top', 'rising', 'controversial']).optional().default('hot'),
  time: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe('Time filter for top/controversial sort'),
  limit: z.number().min(1).max(100).optional().default(25).describe('Number of posts (1-100). Change ONLY IF user specifies.'),
  include_nsfw: z.boolean().optional().default(false),
  include_subreddit_info: z.boolean().optional().default(false).describe('Include subscriber count and description'),
});

export const searchRedditSchema = z.object({
  query: z.string().describe('Search query'),
  subreddits: z.array(z.string()).optional().describe('Specific subreddits to search (empty = all Reddit)'),
  sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional().default('relevance'),
  time: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().default('all'),
  limit: z.number().min(1).max(100).optional().default(25).describe('Results per subreddit (1-100). Change ONLY IF user specifies.'),
  author: z.string().optional().describe('Filter by author username'),
  flair: z.string().optional().describe('Filter by post flair'),
});

export const postDetailsSchema = z.object({
  post_id: z.string().optional().describe('Reddit post ID (e.g. "abc123")'),
  subreddit: z.string().optional().describe('Subreddit name — more efficient when provided with post_id'),
  url: z.string().optional().describe('Full Reddit URL (alternative to post_id)'),
  comment_limit: z.number().min(1).max(500).optional().default(20).describe('Number of comments (1-500). Change ONLY IF user specifies.'),
  comment_sort: z.enum(['best', 'top', 'new', 'controversial', 'qa']).optional().default('best'),
  comment_depth: z.number().min(1).max(10).optional().default(3),
  extract_links: z.boolean().optional().default(false).describe('Extract URLs from comments'),
  max_top_comments: z.number().min(1).max(50).optional().default(5),
});

export const userProfileSchema = z.object({
  username: z.string().describe('Reddit username without u/ prefix'),
  posts_limit: z.number().min(0).max(100).optional().default(10),
  comments_limit: z.number().min(0).max(100).optional().default(10),
  time_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional().default('month'),
  top_subreddits_limit: z.number().min(1).max(50).optional().default(10),
});

export const redditExplainSchema = z.object({
  term: z.string().describe('Reddit term or concept to explain (e.g. "karma", "cake day", "AMA", "flair", "crosspost")'),
});

// ─── Intelligence Schemas (Free basic / Pro scored) ─────────────

export const findPainPointsSchema = z.object({
  query: z.string().describe('Domain or problem area to investigate (e.g. "project management", "invoicing for freelancers")'),
  subreddits: z.array(z.string()).optional().default([]).describe('Subreddits to search (empty = all Reddit)'),
  time: z.enum(['day', 'week', 'month', 'year', 'all']).optional().default('year'),
  limit: z.number().min(5).max(100).optional().default(50).describe('Posts to analyze (5-100). Higher = slower but more thorough.'),
});

export const detectWorkaroundsSchema = z.object({
  domain: z.string().describe('Problem domain to search for DIY solutions (e.g. "expense tracking", "team scheduling")'),
  subreddits: z.array(z.string()).optional().default([]).describe('Subreddits to search'),
  time: z.enum(['day', 'week', 'month', 'year', 'all']).optional().default('year'),
  limit: z.number().min(5).max(100).optional().default(50),
});

export const scoreOpportunitySchema = z.object({
  idea: z.string().describe('Startup idea or product concept to validate (e.g. "AI-powered meal planning app")'),
  subreddits: z.array(z.string()).optional().default([]).describe('Subreddits to analyze'),
  competitors: z.array(z.string()).optional().default([]).describe('Competitor names to check sentiment for'),
  time: z.enum(['month', 'year', 'all']).optional().default('year'),
  depth: z.enum(['quick', 'thorough']).optional().default('thorough').describe('"quick" = 25 posts, "thorough" = 75 posts'),
});

// ─── Pro-only Schemas ───────────────────────────────────────────

export const monitorCompetitorsSchema = z.object({
  competitors: z.array(z.string()).min(1).max(25).describe('Competitor product/company names'),
  subreddits: z.array(z.string()).optional().default([]).describe('Subreddits to monitor'),
  time: z.enum(['day', 'week', 'month', 'year']).optional().default('month'),
  limit: z.number().min(10).max(100).optional().default(50),
});

export const extractFeatureGapsSchema = z.object({
  product: z.string().describe('Product to analyze feature gaps for'),
  competitors: z.array(z.string()).optional().default([]).describe('Competitors to compare against'),
  subreddits: z.array(z.string()).optional().default([]),
  time: z.enum(['month', 'year', 'all']).optional().default('year'),
});

export const trackPricingObjectionsSchema = z.object({
  product: z.string().describe('Product whose pricing to analyze'),
  subreddits: z.array(z.string()).optional().default([]),
  time: z.enum(['month', 'year', 'all']).optional().default('year'),
});

export const findBuyerIntentSchema = z.object({
  solution_category: z.string().describe('Type of solution buyers are looking for (e.g. "CRM software", "email marketing tool")'),
  subreddits: z.array(z.string()).optional().default([]),
  time: z.enum(['day', 'week', 'month', 'year']).optional().default('month'),
  limit: z.number().min(10).max(100).optional().default(50),
});

export const buildICPSchema = z.object({
  product_domain: z.string().describe('Product domain to build ICP for (e.g. "developer productivity tool")'),
  subreddits: z.array(z.string()).min(1).describe('Subreddits where your target users hang out'),
  time: z.enum(['month', 'year', 'all']).optional().default('year'),
});

// ─── Export Schema ──────────────────────────────────────────────

export const exportEvidencePackSchema = z.object({
  title: z.string().describe('Report title'),
  data: z.any().describe('Results from any intelligence tool to export'),
  format: z.enum(['json', 'markdown']).optional().default('markdown').describe('Output format'),
});

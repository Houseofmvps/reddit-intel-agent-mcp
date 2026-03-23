/**
 * Composio-backed Reddit Client
 *
 * Drop-in alternative to RedditClient that uses Composio's managed OAuth
 * instead of direct Reddit API access.
 *
 * Available Composio Reddit tools (as of 2026-03-24):
 *   REDDIT_GET_NEW          - Get new posts from subreddit (params: subreddit, limit, after, count, before)
 *   REDDIT_GET              - Get Reddit listing by sort (params: sort, limit, show, after, count, before, time_filter)
 *   REDDIT_GET_R_TOP        - Get top posts (params: subreddit, time, limit, after, count, before)
 *   REDDIT_GET_CONTROVERSIAL_POSTS - Get controversial posts
 *   REDDIT_GET_SUBREDDITS_SEARCH  - Search subreddits (NOT posts)
 *   REDDIT_GET_REDDIT_USER_ABOUT  - Get user info (params: username)
 *   REDDIT_EDIT_REDDIT_COMMENT_OR_POST - Edit a comment/post
 */

import type { Composio } from '@composio/core';
import type { RedditPost, RedditComment } from '../types/index.js';
import { IntelCache } from '../core/cache.js';

const TOOL_VERSION = '20260316_00';

export interface ComposioSearchOptions {
  limit?: number;
  time?: string;
  sort?: string;
  after?: string;
}

export interface ComposioSubredditOptions {
  limit?: number;
  time?: string;
  after?: string;
}

export class ComposioRedditClient {
  private composio: Composio;
  private userId: string;
  private cache: IntelCache;

  constructor(composio: Composio, userId: string, cache?: IntelCache) {
    this.composio = composio;
    this.userId = userId;
    this.cache = cache ?? new IntelCache({ defaultTTL: 20 * 60_000 });
  }

  /**
   * Search Reddit by fetching new posts from a subreddit and filtering by query.
   * Note: Composio doesn't have a direct post search tool, so we fetch new posts
   * and filter client-side. The query format "subreddit:X keyword" is parsed.
   */
  async search(query: string, opts: ComposioSearchOptions = {}): Promise<RedditPost[]> {
    const { limit = 25 } = opts;

    const cacheKey = `composio:search:${query}`;
    const cached = this.cache.get<RedditPost[]>(cacheKey);
    if (cached) return cached;

    // Parse "subreddit:X keyword" format
    const subMatch = query.match(/subreddit:(\S+)/);
    const subreddit = subMatch ? subMatch[1] : '';
    const keyword = query.replace(/subreddit:\S+\s*/, '').trim().toLowerCase();

    if (!subreddit) return [];

    // Fetch new posts from the subreddit
    const allPosts = await this.browseSubreddit(subreddit, 'new', { limit: Math.min(limit * 2, 100) });

    // Filter by keyword in title or selftext
    const filtered = keyword
      ? allPosts.filter(p =>
          p.title.toLowerCase().includes(keyword) ||
          (p.selftext?.toLowerCase().includes(keyword) ?? false)
        )
      : allPosts;

    const results = filtered.slice(0, limit);
    this.cache.set(cacheKey, results);
    return results;
  }

  /**
   * Browse a subreddit via REDDIT_GET_NEW.
   */
  async browseSubreddit(
    subreddit: string,
    sort: string = 'new',
    opts: ComposioSubredditOptions = {},
  ): Promise<RedditPost[]> {
    subreddit = subreddit.replace(/^r\//, '').trim();
    if (!subreddit) throw new Error('Subreddit name is required');

    const { limit = 25, after } = opts;

    const cacheKey = `composio:browse:${subreddit}:${sort}`;
    const cached = this.cache.get<RedditPost[]>(cacheKey);
    if (cached) return cached;

    // Use REDDIT_GET_NEW for 'new' sort, REDDIT_GET_R_TOP for 'top'
    const toolName = sort === 'top' ? 'REDDIT_GET_R_TOP' : 'REDDIT_GET_NEW';
    const args: Record<string, unknown> = { subreddit, limit };
    if (after) args.after = after;
    if (sort === 'top') args.time = 'day';

    const result = await this.composio.tools.execute(toolName, {
      userId: this.userId,
      arguments: args,
      version: TOOL_VERSION,
    });

    const posts = this.extractPosts(result);
    const normalized = posts.map((p: Record<string, unknown>) => this.normalizePost(p));
    this.cache.set(cacheKey, normalized);
    return normalized;
  }

  /**
   * Get a single post — not directly supported, returns empty.
   */
  async getPost(_postId: string): Promise<{ post: RedditPost; comments: RedditComment[] }> {
    // No single-post retrieval tool available in Composio
    return {
      post: this.normalizePost({}),
      comments: [],
    };
  }

  /**
   * Get content posted by a specific user.
   */
  async getUserContent(username: string): Promise<RedditPost[]> {
    const cacheKey = `composio:user:${username}`;
    const cached = this.cache.get<RedditPost[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.composio.tools.execute('REDDIT_GET_REDDIT_USER_ABOUT', {
        userId: this.userId,
        arguments: { username },
        version: TOOL_VERSION,
      });
      // This returns user info, not posts — return empty for now
      void result;
      return [];
    } catch {
      return [];
    }
  }

  // ─── Normalizers ────────────────────────────────────────────────

  normalizePost(p: Record<string, unknown>): RedditPost {
    const subreddit = String(p.subreddit ?? p.subreddit_name ?? '');
    const id = String(p.id ?? p.name ?? '');
    const permalink = String(
      p.permalink ?? `/r/${subreddit}/comments/${id}/`,
    );

    return {
      id,
      title: String(p.title ?? ''),
      author: String(p.author ?? p.author_name ?? '[deleted]'),
      subreddit,
      subreddit_name_prefixed: `r/${subreddit}`,
      score: Number(p.score ?? p.ups ?? 0),
      num_comments: Number(p.num_comments ?? p.comment_count ?? 0),
      created_utc: Number(p.created_utc ?? p.created ?? 0),
      selftext: p.selftext != null ? String(p.selftext) : undefined,
      url: String(p.url ?? `https://www.reddit.com${permalink}`),
      permalink,
      is_video: p.is_video === true,
      is_self: p.is_self === true,
      over_18: p.over_18 === true || p.nsfw === true,
      stickied: p.stickied === true,
      locked: p.locked === true,
      link_flair_text: p.link_flair_text != null ? String(p.link_flair_text) : undefined,
      author_flair_text: p.author_flair_text != null ? String(p.author_flair_text) : undefined,
      distinguished: p.distinguished != null ? String(p.distinguished) : undefined,
      ups: Number(p.ups ?? p.score ?? 0),
      downs: Number(p.downs ?? 0),
      upvote_ratio: p.upvote_ratio != null ? Number(p.upvote_ratio) : undefined,
    };
  }

  normalizeComment(c: Record<string, unknown>): RedditComment {
    const replies = Array.isArray(c.replies)
      ? c.replies.map((r: Record<string, unknown>) => this.normalizeComment(r))
      : undefined;

    return {
      id: String(c.id ?? ''),
      author: String(c.author ?? '[deleted]'),
      body: String(c.body ?? ''),
      score: Number(c.score ?? 0),
      created_utc: Number(c.created_utc ?? c.created ?? 0),
      permalink: String(c.permalink ?? ''),
      depth: Number(c.depth ?? 0),
      replies,
      distinguished: c.distinguished != null ? String(c.distinguished) : undefined,
      is_submitter: c.is_submitter === true,
      stickied: c.stickied === true,
      controversiality: c.controversiality != null ? Number(c.controversiality) : undefined,
    };
  }

  // ─── Response extraction helpers ────────────────────────────────

  private extractPosts(result: unknown): Array<Record<string, unknown>> {
    const data = this.extractData(result);

    if (Array.isArray(data)) return data;
    if (Array.isArray(data.posts)) return data.posts;
    if (Array.isArray(data.children)) {
      return data.children.map((child: Record<string, unknown>) => {
        return (child.data ?? child) as Record<string, unknown>;
      });
    }
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.results)) return data.results;

    // Reddit listing format: { data: { children: [...] } }
    if (data.data && typeof data.data === 'object') {
      const inner = data.data as Record<string, unknown>;
      if (Array.isArray(inner.children)) {
        return inner.children.map((child: Record<string, unknown>) => {
          return (child.data ?? child) as Record<string, unknown>;
        });
      }
    }

    return [];
  }

  private extractData(result: unknown): Record<string, unknown> {
    if (result == null) return {};
    if (typeof result !== 'object') return {};

    const obj = result as Record<string, unknown>;

    if (obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      return obj.data as Record<string, unknown>;
    }
    if (obj.result != null && typeof obj.result === 'object') {
      return obj.result as Record<string, unknown>;
    }
    if (Array.isArray(obj.data)) {
      return { posts: obj.data };
    }

    return obj;
  }
}

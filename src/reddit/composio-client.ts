/**
 * Composio-backed Reddit Client
 *
 * Drop-in alternative to RedditClient that uses Composio's managed OAuth
 * instead of direct Reddit API access. Returns clean arrays (not Reddit's
 * wrapped Listing format) — the scanner adapter (Task 3) handles the
 * interface difference.
 */

import type { Composio } from '@composio/core';
import type { RedditPost, RedditComment } from '../types/index.js';
import { IntelCache } from '../core/cache.js';

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
   * Search Reddit via Composio's REDDIT_SEARCH_REDDIT tool.
   */
  async search(query: string, opts: ComposioSearchOptions = {}): Promise<RedditPost[]> {
    const { limit = 25, time, sort = 'relevance' } = opts;

    const cacheKey = `composio:search:${query}:${sort}`;
    const cached = this.cache.get<RedditPost[]>(cacheKey);
    if (cached) return cached;

    const result = await this.composio.tools.execute('REDDIT_SEARCH_REDDIT', {
      userId: this.userId,
      arguments: {
        q: query,
        limit,
        sort,
        ...(time ? { t: time } : {}),
      },
    });

    const posts = this.extractPosts(result);
    const normalized = posts.map((p: Record<string, unknown>) => this.normalizePost(p));
    this.cache.set(cacheKey, normalized);
    return normalized;
  }

  /**
   * Browse a subreddit via Composio's REDDIT_GET_SUBREDDIT_POSTS tool.
   */
  async browseSubreddit(
    subreddit: string,
    sort: string = 'hot',
    opts: ComposioSubredditOptions = {},
  ): Promise<RedditPost[]> {
    subreddit = subreddit.replace(/^r\//, '').trim();
    if (!subreddit) throw new Error('Subreddit name is required');

    const { limit = 25, time, after } = opts;

    const cacheKey = `composio:browse:${subreddit}:${sort}`;
    const cached = this.cache.get<RedditPost[]>(cacheKey);
    if (cached) return cached;

    const result = await this.composio.tools.execute('REDDIT_GET_SUBREDDIT_POSTS', {
      userId: this.userId,
      arguments: {
        subreddit,
        sort,
        limit,
        ...(time ? { t: time } : {}),
        ...(after ? { after } : {}),
      },
    });

    const posts = this.extractPosts(result);
    const normalized = posts.map((p: Record<string, unknown>) => this.normalizePost(p));
    this.cache.set(cacheKey, normalized);
    return normalized;
  }

  /**
   * Get a single post and its comments.
   */
  async getPost(postId: string): Promise<{ post: RedditPost; comments: RedditComment[] }> {
    const result = await this.composio.tools.execute('REDDIT_GET_POST', {
      userId: this.userId,
      arguments: {
        id: postId,
      },
    });

    const data = this.extractData(result);
    const postData = data.post ?? data;
    const commentsData = Array.isArray(data.comments) ? data.comments : [];

    return {
      post: this.normalizePost(postData as Record<string, unknown>),
      comments: commentsData.map((c: Record<string, unknown>) => this.normalizeComment(c)),
    };
  }

  /**
   * Get content posted by a specific user.
   */
  async getUserContent(username: string): Promise<RedditPost[]> {
    const cacheKey = `composio:user:${username}`;
    const cached = this.cache.get<RedditPost[]>(cacheKey);
    if (cached) return cached;

    const result = await this.composio.tools.execute('REDDIT_GET_USER_POSTS', {
      userId: this.userId,
      arguments: {
        username,
      },
    });

    const posts = this.extractPosts(result);
    const normalized = posts.map((p: Record<string, unknown>) => this.normalizePost(p));
    this.cache.set(cacheKey, normalized);
    return normalized;
  }

  // ─── Normalizers ────────────────────────────────────────────────

  /**
   * Convert a raw Composio response object into our RedditPost type.
   * Handles variations in field names across Composio tool responses.
   */
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

  /**
   * Convert a raw comment object into our RedditComment type.
   */
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

  /**
   * Extract an array of posts from various Composio response shapes.
   */
  private extractPosts(result: unknown): Array<Record<string, unknown>> {
    const data = this.extractData(result);

    // Direct array
    if (Array.isArray(data)) return data;

    // Nested in common keys
    if (Array.isArray(data.posts)) return data.posts;
    if (Array.isArray(data.children)) return data.children;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.results)) return data.results;

    // Reddit listing format from Composio
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

  /**
   * Unwrap the top-level Composio response envelope.
   */
  private extractData(result: unknown): Record<string, unknown> {
    if (result == null) return {};
    if (typeof result !== 'object') return {};

    const obj = result as Record<string, unknown>;

    // Composio wraps in { data: ... } or { result: ... }
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

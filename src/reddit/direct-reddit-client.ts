/**
 * Direct Reddit API Client
 *
 * Uses the raw OAuth access_token from Composio to hit Reddit's API directly.
 * This bypasses Composio's limited tool set and gives us full Reddit search.
 *
 * Rate limit: 100 requests/minute for OAuth-authenticated requests.
 * Docs: https://www.reddit.com/dev/api/
 */

import type { RedditPost } from '../types/index.js';

const REDDIT_API = 'https://oauth.reddit.com';
const USER_AGENT = 'BuildRadar/2.0 (by /u/BuildRadarBot)';

export interface DirectSearchOptions {
  subreddit?: string;      // restrict to specific subreddit
  sort?: 'relevance' | 'new' | 'hot' | 'top' | 'comments';
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  limit?: number;          // max 100
  after?: string;          // pagination cursor
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

/**
 * Simple rate limiter for Reddit's 100 req/min limit.
 */
class RedditRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests = 90; // stay under 100 for safety
  private readonly windowMs = 60_000;

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => t > now - this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = oldest + this.windowMs - now + 100;
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      this.timestamps = this.timestamps.filter(t => t > Date.now() - this.windowMs);
    }

    this.timestamps.push(Date.now());
  }
}

export class DirectRedditClient {
  private tokenProvider: TokenProvider;
  private rateLimiter = new RedditRateLimiter();

  constructor(tokenProvider: TokenProvider) {
    this.tokenProvider = tokenProvider;
  }

  /**
   * Search Reddit posts — the core feature Composio was missing.
   * Can search all of Reddit or restrict to a specific subreddit.
   */
  async search(query: string, opts: DirectSearchOptions = {}): Promise<RedditPost[]> {
    const { subreddit, sort = 'relevance', time = 'week', limit = 100, after } = opts;

    const params = new URLSearchParams({
      q: query,
      sort,
      t: time,
      limit: String(Math.min(limit, 100)),
      type: 'link',        // only posts, not comments or subreddits
      restrict_sr: subreddit ? 'on' : 'off',
    });
    if (after) params.set('after', after);

    const path = subreddit
      ? `/r/${subreddit}/search.json?${params}`
      : `/search.json?${params}`;

    const data = await this.request(path);
    return this.extractPosts(data);
  }

  /**
   * Browse a subreddit by sort order (new, hot, top).
   */
  async browseSubreddit(
    subreddit: string,
    sort: 'new' | 'hot' | 'top' | 'rising' = 'new',
    opts: { limit?: number; time?: string; after?: string } = {},
  ): Promise<RedditPost[]> {
    subreddit = subreddit.replace(/^r\//, '').trim();
    const { limit = 50, time = 'day', after } = opts;

    const params = new URLSearchParams({
      limit: String(Math.min(limit, 100)),
    });
    if (sort === 'top') params.set('t', time);
    if (after) params.set('after', after);

    const data = await this.request(`/r/${subreddit}/${sort}.json?${params}`);
    return this.extractPosts(data);
  }

  /**
   * Get a single post with comments.
   */
  async getPost(subreddit: string, postId: string): Promise<{ post: RedditPost; comments: any[] }> {
    const data = await this.request(`/r/${subreddit}/comments/${postId}.json?limit=50`);

    if (Array.isArray(data) && data.length >= 1) {
      const postData = data[0]?.data?.children?.[0]?.data;
      const comments = data[1]?.data?.children?.map((c: any) => c.data) ?? [];
      return {
        post: postData ? this.normalizePost(postData) : this.emptyPost(),
        comments,
      };
    }

    return { post: this.emptyPost(), comments: [] };
  }

  /**
   * Get user's recent posts and comments.
   */
  async getUserContent(username: string, opts: { limit?: number } = {}): Promise<RedditPost[]> {
    const { limit = 25 } = opts;
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 100)),
      sort: 'new',
    });

    const data = await this.request(`/user/${username}/submitted.json?${params}`);
    return this.extractPosts(data);
  }

  // ─── Internal ──────────────────────────────────────────────────

  private async request(path: string, retried = false): Promise<any> {
    await this.rateLimiter.waitIfNeeded();

    const token = await this.tokenProvider.getAccessToken();
    const url = `${REDDIT_API}${path}`;

    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    });

    if (resp.status === 401 && !retried) {
      // Token might be expired — try once more with a fresh token
      console.warn('[direct-reddit] Got 401, retrying with fresh token...');
      return this.request(path, true);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Reddit API ${resp.status}: ${body.slice(0, 200)}`);
    }

    return resp.json();
  }

  private extractPosts(data: any): RedditPost[] {
    const children = data?.data?.children;
    if (!Array.isArray(children)) return [];

    return children
      .filter((c: any) => c.kind === 't3') // t3 = link/post
      .map((c: any) => this.normalizePost(c.data));
  }

  private normalizePost(p: any): RedditPost {
    const subreddit = String(p.subreddit ?? '');
    const permalink = String(p.permalink ?? `/r/${subreddit}/comments/${p.id}/`);

    return {
      id: String(p.id ?? ''),
      title: String(p.title ?? ''),
      author: String(p.author ?? '[deleted]'),
      subreddit,
      subreddit_name_prefixed: `r/${subreddit}`,
      score: Number(p.score ?? 0),
      num_comments: Number(p.num_comments ?? 0),
      created_utc: Number(p.created_utc ?? 0),
      selftext: p.selftext != null ? String(p.selftext) : undefined,
      url: String(p.url ?? `https://www.reddit.com${permalink}`),
      permalink,
      is_video: p.is_video === true,
      is_self: p.is_self === true,
      over_18: p.over_18 === true,
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

  private emptyPost(): RedditPost {
    return {
      id: '', title: '', author: '[deleted]', subreddit: '',
      subreddit_name_prefixed: '', score: 0, num_comments: 0,
      created_utc: 0, url: '', permalink: '', is_self: true,
      over_18: false, stickied: false, locked: false, is_video: false,
      ups: 0, downs: 0,
    };
  }
}

/**
 * Token provider that fetches the access token from Composio's connected account.
 * Re-fetches on each call to handle token rotation/refresh.
 */
export class ComposioTokenProvider implements TokenProvider {
  private composio: any; // Composio instance
  private connectedAccountId: string;
  private cachedToken: string | null = null;
  private cachedAt = 0;
  private readonly cacheTTL = 30 * 60_000; // cache token for 30 min (Reddit tokens last 1hr)

  constructor(composio: any, connectedAccountId: string) {
    this.composio = composio;
    this.connectedAccountId = connectedAccountId;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now - this.cachedAt < this.cacheTTL) {
      return this.cachedToken;
    }

    const account = await this.composio.connectedAccounts.get(this.connectedAccountId);
    const data = (account as any)?.data || {};
    const token = data?.access_token;

    if (!token) {
      throw new Error(`No access_token in Composio connected account ${this.connectedAccountId}`);
    }

    this.cachedToken = token;
    this.cachedAt = now;
    return token;
  }

  /**
   * Invalidate the cached token (e.g., after a 401).
   */
  invalidate(): void {
    this.cachedToken = null;
    this.cachedAt = 0;
  }
}

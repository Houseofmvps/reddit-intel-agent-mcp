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
  invalidate?(): void;
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
    const { subreddit: rawSub, sort = 'relevance', time = 'week', limit = 100, after } = opts;
    const subreddit = rawSub?.replace(/^r\//, '').trim();

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

    // Reddit returns 403 "Blocked" (not 401) for expired/invalid OAuth tokens
    if ((resp.status === 401 || resp.status === 403) && !retried) {
      const body = await resp.text().catch(() => '');
      const isAuthError = resp.status === 401 || body.includes('Blocked') || body.includes('<!doctype');
      if (isAuthError) {
        console.warn(`[direct-reddit] Got ${resp.status} (auth error), invalidating token and retrying...`);
        this.tokenProvider.invalidate?.();
        return this.request(path, true);
      }
      // Non-auth 403 (e.g., private subreddit)
      throw new Error(`Reddit API ${resp.status}: ${body.slice(0, 200)}`);
    }

    if ((resp.status === 401 || resp.status === 403) && retried) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Reddit API ${resp.status} after token refresh — token is invalid: ${body.slice(0, 200)}`);
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
 * Public Reddit API client — no auth needed.
 * Uses www.reddit.com (not oauth.reddit.com).
 * Rate limited to ~10 req/min by Reddit, but good enough as a fallback.
 */
export class PublicRedditClient {
  readonly _isPublicClient = true; // marker for scanMonitorDirect to detect public API budget
  private lastRequest = 0;
  private readonly minDelay = 6500; // ~9 req/min, safely under Reddit's ~10 req/min limit

  async search(query: string, opts: DirectSearchOptions = {}): Promise<RedditPost[]> {
    const { subreddit: rawSub, sort = 'relevance', time = 'week', limit = 100 } = opts;
    const subreddit = rawSub?.replace(/^r\//, '').trim();

    const params = new URLSearchParams({
      q: query,
      sort,
      t: time,
      limit: String(Math.min(limit, 100)),
      type: 'link',
      restrict_sr: subreddit ? 'on' : 'off',
    });

    const base = subreddit
      ? `https://www.reddit.com/r/${subreddit}/search.json`
      : `https://www.reddit.com/search.json`;

    return this.request(`${base}?${params}`);
  }

  async browseSubreddit(
    subreddit: string,
    sort: 'new' | 'hot' | 'top' | 'rising' = 'new',
    opts: { limit?: number; time?: string } = {},
  ): Promise<RedditPost[]> {
    subreddit = subreddit.replace(/^r\//, '').trim();
    const { limit = 50, time = 'day' } = opts;

    const params = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
    if (sort === 'top') params.set('t', time);

    return this.request(`https://www.reddit.com/r/${subreddit}/${sort}.json?${params}`);
  }

  private async request(url: string, retries = 2): Promise<RedditPost[]> {
    // Rate limiting — enforce minimum gap between requests
    const now = Date.now();
    const wait = this.lastRequest + this.minDelay - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastRequest = Date.now();

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'BuildRadar/2.0 (by /u/BuildRadarBot)' },
    });

    // Retry on 429 with exponential backoff
    if (resp.status === 429 && retries > 0) {
      const backoff = (3 - retries) * 10_000 + 5_000; // 15s, 25s
      console.error(`[public-reddit] 429 rate limited, backing off ${backoff / 1000}s...`);
      await new Promise(r => setTimeout(r, backoff));
      this.lastRequest = Date.now();
      return this.request(url, retries - 1);
    }

    if (!resp.ok) {
      console.error(`[public-reddit] ${resp.status} for ${url.slice(0, 120)}`);
      return [];
    }

    const data: any = await resp.json();
    const children = data?.data?.children;
    if (!Array.isArray(children)) return [];

    return children
      .filter((c: any) => c.kind === 't3')
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

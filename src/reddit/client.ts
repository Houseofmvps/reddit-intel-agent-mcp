/**
 * Reddit Intelligence Agent — Reddit API client
 *
 * Handles: auth headers, rate limiting, caching, retries with backoff,
 * request deduplication, and detailed error messages.
 */

import type { RedditPost, RedditComment, RedditUser, RedditSubreddit, RedditListing } from '../types/index.js';
import { RedditAuth } from '../core/auth.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { IntelCache } from '../core/cache.js';

export interface RedditClientConfig {
  auth: RedditAuth;
  rateLimiter: RateLimiter;
  cache: IntelCache;
  timeoutMs?: number;
}

const INITIAL_BACKOFF = 100;
const MAX_BACKOFF = 30_000;
const BACKOFF_MULT = 2;
const INFLIGHT_TTL = 5 * 60_000;

export class RedditClient {
  private auth: RedditAuth;
  private limiter: RateLimiter;
  private cache: IntelCache;
  private timeout: number;
  private inflight = new Map<string, Promise<unknown>>();
  private inflightTs = new Map<string, number>();

  constructor(config: RedditClientConfig) {
    this.auth = config.auth;
    this.limiter = config.rateLimiter;
    this.cache = config.cache;
    this.timeout = config.timeoutMs ?? 10_000;
  }

  // ─── Public API ───────────────────────────────────────────────

  async browseSubreddit(
    subreddit: string,
    sort: string = 'hot',
    opts: { limit?: number; time?: string; after?: string } = {},
  ): Promise<RedditListing<RedditPost>> {
    subreddit = subreddit.replace(/^r\//, '').trim();
    if (!subreddit) throw new Error('Subreddit name is required');

    const { limit = 25, time, after } = opts;
    const key = IntelCache.key('sub', subreddit, sort, limit, time, after);
    const cached = this.cache.get<RedditListing<RedditPost>>(key);
    if (cached) return cached;

    const params = new URLSearchParams({ limit: String(limit), raw_json: '1' });
    if (time && (sort === 'top' || sort === 'controversial')) params.set('t', time);
    if (after) params.set('after', after);

    const data = await this.get<RedditListing<RedditPost>>(`/r/${subreddit}/${sort}.json?${params}`);
    this.cache.set(key, data);
    return data;
  }

  async getPost(
    postId: string,
    opts: { limit?: number; sort?: string; depth?: number } = {},
  ): Promise<[RedditListing<RedditPost>, RedditListing<RedditComment>]> {
    const { limit = 50, sort = 'best', depth = 3 } = opts;
    const { subreddit, id } = await this.resolvePostId(postId);

    const key = IntelCache.key('post', subreddit, id, sort, limit, depth);
    const cached = this.cache.get<[RedditListing<RedditPost>, RedditListing<RedditComment>]>(key);
    if (cached) return cached;

    const params = new URLSearchParams({
      limit: String(limit), sort, depth: String(depth), raw_json: '1',
    });
    const data = await this.get<[RedditListing<RedditPost>, RedditListing<RedditComment>]>(
      `/r/${subreddit}/comments/${id}.json?${params}`,
    );
    this.cache.set(key, data);
    return data;
  }

  async search(
    query: string,
    opts: { subreddit?: string; sort?: string; time?: string; limit?: number; restrictSr?: boolean } = {},
  ): Promise<RedditListing<RedditPost>> {
    const { subreddit, sort = 'relevance', time = 'all', limit = 25 } = opts;
    const restrictSr = opts.restrictSr ?? !!subreddit;

    const key = IntelCache.key('search', query, subreddit, sort, time, limit);
    const cached = this.cache.get<RedditListing<RedditPost>>(key);
    if (cached) return cached;

    const params = new URLSearchParams({
      q: query, sort, t: time, limit: String(limit), restrict_sr: String(restrictSr), raw_json: '1',
    });
    const endpoint = subreddit ? `/r/${subreddit}/search.json` : '/search.json';
    const data = await this.get<RedditListing<RedditPost>>(`${endpoint}?${params}`);
    this.cache.set(key, data);
    return data;
  }

  async getUser(username: string): Promise<RedditUser> {
    const key = IntelCache.key('user', username);
    const cached = this.cache.get<RedditUser>(key);
    if (cached) return cached;

    const data = await this.get<{ data: RedditUser }>(`/user/${username}/about.json`);
    this.cache.set(key, data.data);
    return data.data;
  }

  async getUserContent(
    username: string,
    type: 'submitted' | 'comments' = 'submitted',
    opts: { sort?: string; time?: string; limit?: number } = {},
  ): Promise<RedditListing<RedditPost | RedditComment>> {
    const { sort = 'new', time = 'all', limit = 25 } = opts;
    const key = IntelCache.key('user-content', username, type, sort, time, limit);
    const cached = this.cache.get<RedditListing<RedditPost | RedditComment>>(key);
    if (cached) return cached;

    const params = new URLSearchParams({ sort, t: time, limit: String(limit), raw_json: '1' });
    const data = await this.get<RedditListing<RedditPost | RedditComment>>(
      `/user/${username}/${type}.json?${params}`,
    );
    this.cache.set(key, data);
    return data;
  }

  async getSubredditInfo(name: string): Promise<RedditSubreddit> {
    const key = IntelCache.key('sub-info', name);
    const cached = this.cache.get<RedditSubreddit>(key);
    if (cached) return cached;

    const data = await this.get<{ data: RedditSubreddit }>(`/r/${name}/about.json`);
    this.cache.set(key, data.data);
    return data.data;
  }

  // ─── Post ID Resolution ───────────────────────────────────────

  private async resolvePostId(input: string): Promise<{ subreddit: string; id: string }> {
    // URL format: reddit.com/r/{sub}/comments/{id}/...
    if (input.includes('/comments/')) {
      const m = input.match(/\/r\/(\w+)\/comments\/(\w+)/);
      if (m) return { subreddit: m[1], id: m[2] };
    }

    // subreddit_postid format
    if (input.includes('_')) {
      const [sub, id] = input.split('_');
      if (sub && id) return { subreddit: sub, id };
      // empty sub = short URL (redd.it)
      if (id) return this.lookupPostSubreddit(id);
    }

    // bare ID
    return this.lookupPostSubreddit(input);
  }

  private async lookupPostSubreddit(id: string): Promise<{ subreddit: string; id: string }> {
    const info = await this.get<RedditListing<RedditPost>>(`/api/info.json?id=t3_${id}`);
    if (!info.data.children.length) throw new Error(`Post ${id} not found`);
    return { subreddit: info.data.children[0].data.subreddit, id };
  }

  // ─── URL Parsing ──────────────────────────────────────────────

  static extractPostIdFromUrl(url: string): string {
    const clean = url.split('?')[0].split('#')[0];

    // Standard reddit.com URLs (www, old, np, m, new subdomains)
    const std = clean.match(/(?:https?:\/\/)?(?:(?:www|old|np|m|new)\.)?reddit\.com\/r\/(\w+)\/comments\/(\w+)/i);
    if (std) return `${std[1]}_${std[2]}`;

    // redd.it short URLs
    const short = clean.match(/(?:https?:\/\/)?redd\.it\/(\w+)/i);
    if (short) return `_${short[1]}`;

    // /comments/id (cross-post)
    const cross = clean.match(/(?:https?:\/\/)?(?:(?:www|old|np|m|new)\.)?reddit\.com\/comments\/(\w+)/i);
    if (cross) return `_${cross[1]}`;

    // /gallery/id
    const gallery = clean.match(/(?:https?:\/\/)?(?:(?:www|old|np|m|new)\.)?reddit\.com\/gallery\/(\w+)/i);
    if (gallery) return `_${gallery[1]}`;

    throw new Error('Unrecognized Reddit URL format');
  }

  // ─── HTTP Layer ───────────────────────────────────────────────

  private async get<T>(endpoint: string, retries = 2): Promise<T> {
    this.cleanupInflight();

    const existing = this.inflight.get(endpoint);
    if (existing) return existing as Promise<T>;

    const promise = this.doGet<T>(endpoint, retries);
    this.inflight.set(endpoint, promise);
    this.inflightTs.set(endpoint, Date.now());
    promise.finally(() => {
      this.inflight.delete(endpoint);
      this.inflightTs.delete(endpoint);
    }).catch(() => {}); // prevent unhandled rejection on the detached chain

    return promise;
  }

  private async doGet<T>(endpoint: string, retries: number): Promise<T> {
    if (!this.limiter.canProceed()) {
      throw new Error(
        `Rate limit reached (${this.limiter.getStats().used}/${this.limiter.getStats().limit}). ` +
        `Wait ${this.limiter.secondsUntilAvailable()}s or add REDDIT_INTEL_CLIENT_ID for higher limits.`,
      );
    }

    const headers = await this.auth.getHeaders();
    const baseUrl = this.auth.getBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${baseUrl}${endpoint}`, { headers, signal: controller.signal });
      clearTimeout(timer);
      this.limiter.record();

      // 401 → refresh token and retry
      if (res.status === 401 && this.auth.getMode() !== 'anonymous' && retries > 0) {
        await this.auth.refreshToken();
        return this.doGet<T>(endpoint, retries - 1);
      }

      // Transient errors → backoff and retry
      if ((res.status === 429 || res.status === 503) && retries > 0) {
        const delay = this.parseRetryAfter(res) ?? this.backoff(retries);
        await this.sleep(delay);
        return this.doGet<T>(endpoint, retries - 1);
      }

      if (!res.ok) {
        throw this.buildHttpError(res.status, endpoint, await res.text().catch(() => ''));
      }

      const ct = res.headers.get('content-type');
      if (ct && ct.toLowerCase().split(';')[0].trim() === 'text/html') {
        throw new Error('Reddit returned HTML instead of JSON — the resource may be inaccessible');
      }

      return await res.json() as T;
    } catch (err: unknown) {
      clearTimeout(timer);
      const e = err as Error & { name?: string; code?: string; cause?: { code?: string; hostname?: string } };

      if (e.name === 'AbortError') {
        if (retries > 0) { await this.sleep(this.backoff(retries)); return this.doGet<T>(endpoint, retries - 1); }
        throw new Error('Request timed out — Reddit may be slow or blocked on your network');
      }
      if (e.code === 'ECONNRESET' && retries > 0) {
        await this.sleep(this.backoff(retries));
        return this.doGet<T>(endpoint, retries - 1);
      }
      if (e.code === 'ENOTFOUND' || e.cause?.code === 'ENOTFOUND') {
        throw new Error(`Cannot resolve Reddit — check DNS or firewall (${e.cause?.hostname ?? 'reddit.com'})`);
      }
      if (e.code === 'ECONNREFUSED') throw new Error('Connection refused — Reddit may be blocked by firewall');
      if (e.code === 'ETIMEDOUT') {
        if (retries > 0) { await this.sleep(this.backoff(retries)); return this.doGet<T>(endpoint, retries - 1); }
        throw new Error('Connection timed out — Reddit may be unreachable');
      }

      throw err;
    }
  }

  private buildHttpError(status: number, endpoint: string, body: string): Error {
    const sub = endpoint.match(/\/r\/([^/]+)/)?.[1];
    switch (status) {
      case 404: return new Error(`Not found — ${sub ? `r/${sub} does not exist or is inaccessible` : 'resource not found'}`);
      case 403: return new Error(`Access forbidden — ${sub ? `r/${sub} may be private or quarantined` : 'content is restricted'}`);
      case 429: return new Error('Rate limited by Reddit — wait before retrying');
      case 503: return new Error('Reddit is temporarily unavailable');
      default: {
        console.error(`[reddit] API error ${status}: ${body.substring(0, 200)}`);
        return new Error(`Reddit API error (HTTP ${status}). Try again or check your query.`);
      }
    }
  }

  private backoff(retriesLeft: number): number {
    const attempt = 2 - retriesLeft;
    const base = Math.min(INITIAL_BACKOFF * Math.pow(BACKOFF_MULT, attempt), MAX_BACKOFF);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  private parseRetryAfter(res: Response): number | null {
    const val = res.headers.get('retry-after');
    if (!val) return null;
    const secs = parseInt(val, 10);
    if (!isNaN(secs)) return Math.min(secs * 1000, MAX_BACKOFF);
    try {
      return Math.max(0, Math.min(new Date(val).getTime() - Date.now(), MAX_BACKOFF));
    } catch { return null; }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private cleanupInflight(): void {
    const now = Date.now();
    for (const [ep, ts] of this.inflightTs) {
      if (now - ts > INFLIGHT_TTL) {
        this.inflight.delete(ep);
        this.inflightTs.delete(ep);
      }
    }
  }
}

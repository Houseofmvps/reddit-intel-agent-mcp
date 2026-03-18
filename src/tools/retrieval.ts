/**
 * Reddit Intelligence Agent — Retrieval tools (free tier)
 *
 * Tools: browse_subreddit, search_reddit, post_details, user_profile
 */

import { z } from 'zod';
import { RedditClient } from '../reddit/client.js';
import { formatPost, formatComment } from '../reddit/formatter.js';
import {
  browseSubredditSchema,
  searchRedditSchema,
  postDetailsSchema,
  userProfileSchema,
} from './schemas.js';

export class RetrievalTools {
  constructor(private reddit: RedditClient) {}

  async browseSubreddit(params: z.infer<typeof browseSubredditSchema>) {
    const listing = await this.reddit.browseSubreddit(params.subreddit, params.sort, {
      limit: params.limit,
      time: params.time,
    });

    let children = listing.data.children;
    if (!params.include_nsfw) {
      children = children.filter(c => !c.data.over_18);
    }

    const posts = children.map(c => formatPost(c.data));

    const result: Record<string, unknown> = { posts, total_posts: posts.length };

    if (params.include_subreddit_info) {
      try {
        const info = await this.reddit.getSubredditInfo(params.subreddit);
        result.subreddit_info = {
          name: info.display_name,
          subscribers: info.subscribers,
          description: info.public_description || info.description,
          type: info.subreddit_type,
          created: new Date(info.created_utc * 1000).toISOString(),
          nsfw: info.over18,
        };
      } catch {
        // non-critical — continue without it
      }
    }

    return result;
  }

  async searchReddit(params: z.infer<typeof searchRedditSchema>) {
    let allChildren: Array<{ kind: string; data: import('../types/index.js').RedditPost }>;

    if (params.subreddits && params.subreddits.length > 0) {
      if (params.subreddits.length === 1) {
        const res = await this.reddit.search(params.query, {
          subreddit: params.subreddits[0],
          sort: params.sort,
          time: params.time,
          limit: params.limit,
        });
        allChildren = res.data.children;
      } else {
        const perSub = Math.ceil(params.limit / params.subreddits.length);
        const results = await Promise.allSettled(
          params.subreddits.map(sub =>
            this.reddit.search(params.query, { subreddit: sub, sort: params.sort, time: params.time, limit: perSub }),
          ),
        );
        allChildren = results
          .filter((r): r is PromiseFulfilledResult<import('../types/index.js').RedditListing<import('../types/index.js').RedditPost>> => r.status === 'fulfilled')
          .flatMap(r => r.value.data.children);

        if (allChildren.length === 0) {
          const failed = params.subreddits.filter((_, i) => results[i].status === 'rejected');
          throw new Error(`Search failed for all subreddits: ${failed.join(', ')}`);
        }
      }
    } else {
      const res = await this.reddit.search(params.query, {
        sort: params.sort,
        time: params.time,
        limit: params.limit,
      });
      allChildren = res.data.children;
    }

    // Post-filter by author and flair
    if (params.author) {
      allChildren = allChildren.filter(c => c.data.author.toLowerCase() === params.author!.toLowerCase());
    }
    if (params.flair) {
      allChildren = allChildren.filter(c => c.data.link_flair_text?.toLowerCase().includes(params.flair!.toLowerCase()));
    }

    const posts = allChildren.map(c => formatPost(c.data));
    return { results: posts, total_results: posts.length };
  }

  async postDetails(params: z.infer<typeof postDetailsSchema>) {
    let identifier: string;
    if (params.url) {
      identifier = RedditClient.extractPostIdFromUrl(params.url);
    } else if (params.post_id) {
      identifier = params.subreddit ? `${params.subreddit}_${params.post_id}` : params.post_id;
    } else {
      throw new Error('Provide either url OR post_id');
    }

    const [postListing, commentsListing] = await this.reddit.getPost(identifier, {
      limit: params.comment_limit,
      sort: params.comment_sort,
      depth: params.comment_depth,
    });

    const post = formatPost(postListing.data.children[0].data);
    // Expand content for detail view
    const rawPost = postListing.data.children[0].data;
    if (rawPost.selftext) {
      (post as unknown as Record<string, unknown>).content = rawPost.selftext.substring(0, 2000);
    }

    const comments = commentsListing.data.children
      .filter(c => c.kind === 't1')
      .map(c => formatComment(c.data));

    const result: Record<string, unknown> = {
      post,
      total_comments: comments.length,
      top_comments: comments.slice(0, params.max_top_comments),
    };

    if (params.extract_links) {
      const links = new Set<string>();
      for (const c of commentsListing.data.children) {
        if (c.kind === 't1') {
          const urls = (c.data.body ?? '').match(/https?:\/\/[^\s)>\]]+/g) ?? [];
          urls.forEach(u => links.add(u));
        }
      }
      result.extracted_links = [...links];
    }

    return result;
  }

  async userProfile(params: z.infer<typeof userProfileSchema>) {
    const user = await this.reddit.getUser(params.username);
    const sort = params.time_range === 'all' ? 'new' : 'top';

    let posts = null;
    let comments = null;
    let usedFallback = false;

    if (params.posts_limit > 0) {
      posts = await this.reddit.getUserContent(params.username, 'submitted', {
        limit: params.posts_limit,
        sort,
        time: params.time_range,
      });
      if (posts.data.children.length === 0 && params.time_range !== 'all') {
        usedFallback = true;
        posts = await this.reddit.getUserContent(params.username, 'submitted', {
          limit: params.posts_limit,
          sort: 'new',
          time: 'all',
        });
      }
    }

    if (params.comments_limit > 0) {
      comments = await this.reddit.getUserContent(params.username, 'comments', {
        limit: params.comments_limit,
        sort,
        time: params.time_range,
      });
      if (comments.data.children.length === 0 && params.time_range !== 'all') {
        usedFallback = true;
        comments = await this.reddit.getUserContent(params.username, 'comments', {
          limit: params.comments_limit,
          sort: 'new',
          time: 'all',
        });
      }
    }

    // Build subreddit activity map
    const subActivity = new Map<string, { posts: number; karma: number }>();
    if (posts) {
      for (const c of posts.data.children) {
        const d = c.data as unknown as Record<string, unknown>;
        const sub = (d.subreddit as string) ?? 'unknown';
        const existing = subActivity.get(sub) ?? { posts: 0, karma: 0 };
        existing.posts++;
        existing.karma += (d.score as number) ?? 0;
        subActivity.set(sub, existing);
      }
    }

    const topSubreddits = [...subActivity.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.karma - a.karma)
      .slice(0, params.top_subreddits_limit);

    const accountAge = new Date(user.created_utc * 1000);
    const ageYears = (Date.now() - accountAge.getTime()) / (365.25 * 24 * 3600_000);

    const result: Record<string, unknown> = {
      username: user.name,
      account_age: ageYears > 1 ? `${Math.floor(ageYears)} years` : `${Math.floor(ageYears * 12)} months`,
      karma: {
        link: user.link_karma ?? 0,
        comment: user.comment_karma ?? 0,
        total: (user.link_karma ?? 0) + (user.comment_karma ?? 0),
      },
      top_subreddits: topSubreddits,
    };

    if (posts && posts.data.children.length > 0) {
      result.recent_posts = posts.data.children.map(c => formatPost(c.data as import('../types/index.js').RedditPost));
    }
    if (comments && comments.data.children.length > 0) {
      result.recent_comments = comments.data.children
        .filter(c => c.data && (c.data as unknown as Record<string, unknown>).body)
        .map(c => {
          const d = c.data as unknown as Record<string, unknown>;
          return {
            id: d.id,
            body: ((d.body as string) ?? '').substring(0, 200),
            score: d.score ?? 0,
            subreddit: d.subreddit ?? 'unknown',
            post_title: d.link_title ?? '',
            url: d.permalink ? `https://reddit.com${d.permalink}` : null,
          };
        });
    }
    if (usedFallback) {
      result.note = `No posts found in last ${params.time_range} — showing all recent activity instead`;
    }

    return result;
  }
}

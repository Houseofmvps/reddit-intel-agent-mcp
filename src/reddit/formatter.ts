/**
 * Reddit Intelligence Agent — Post and comment formatting
 */

import type { RedditPost, RedditComment, FormattedPost, FormattedComment } from '../types/index.js';

export function formatPost(raw: RedditPost): FormattedPost {
  return {
    id: raw.id,
    title: raw.title,
    author: raw.author,
    score: raw.score,
    upvote_ratio: raw.upvote_ratio,
    num_comments: raw.num_comments,
    created_utc: raw.created_utc,
    url: raw.url,
    permalink: `https://reddit.com${raw.permalink}`,
    subreddit: raw.subreddit,
    is_video: raw.is_video,
    is_text_post: raw.is_self,
    content: raw.selftext?.substring(0, 500),
    nsfw: raw.over_18,
    stickied: raw.stickied,
    flair: raw.link_flair_text,
  };
}

export function formatComment(raw: RedditComment, maxBodyLength = 500): FormattedComment {
  return {
    id: raw.id,
    author: raw.author,
    score: raw.score,
    body: (raw.body ?? '').substring(0, maxBodyLength),
    created_utc: raw.created_utc,
    depth: raw.depth,
    is_op: raw.is_submitter,
    permalink: `https://reddit.com${raw.permalink}`,
  };
}

export function formatScore(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function daysSince(utcSeconds: number): number {
  return Math.max(0, (Date.now() / 1000 - utcSeconds) / 86_400);
}

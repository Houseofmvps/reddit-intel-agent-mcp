/**
 * Tests for ComposioRedditClient
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComposioRedditClient } from '../composio-client.js';
import type { RedditPost, RedditComment } from '../../types/index.js';

// ─── Mock Composio SDK ─────────────────────────────────────────

function createMockComposio(executeResult: unknown = { data: [] }) {
  return {
    tools: {
      execute: vi.fn().mockResolvedValue(executeResult),
    },
    connectedAccounts: {
      list: vi.fn().mockResolvedValue([]),
      initiate: vi.fn().mockResolvedValue({ redirectUrl: 'https://example.com', id: 'conn_1' }),
    },
  } as unknown as import('@composio/core').Composio;
}

// ─── Sample response data ──────────────────────────────────────

const sampleRawPost = {
  id: 'abc123',
  title: 'Looking for a project management tool',
  author: 'startup_founder',
  subreddit: 'SaaS',
  score: 42,
  num_comments: 15,
  created_utc: 1700000000,
  selftext: 'We need something better than Trello...',
  url: 'https://www.reddit.com/r/SaaS/comments/abc123/looking_for_a_project_management_tool/',
  permalink: '/r/SaaS/comments/abc123/looking_for_a_project_management_tool/',
  is_self: true,
  ups: 42,
  downs: 3,
  upvote_ratio: 0.93,
};

const sampleRawComment = {
  id: 'comment1',
  author: 'helpful_user',
  body: 'Have you tried Linear? It is great for small teams.',
  score: 10,
  created_utc: 1700001000,
  permalink: '/r/SaaS/comments/abc123/comment/comment1/',
  depth: 0,
  is_submitter: false,
  stickied: false,
};

// ─── Tests ─────────────────────────────────────────────────────

describe('ComposioRedditClient', () => {
  let mockComposio: ReturnType<typeof createMockComposio>;
  let client: ComposioRedditClient;

  beforeEach(() => {
    mockComposio = createMockComposio({ data: { posts: [sampleRawPost] } });
    client = new ComposioRedditClient(mockComposio, 'user_test');
  });

  describe('search()', () => {
    it('calls REDDIT_SEARCH_REDDIT with correct arguments', async () => {
      await client.search('project management tool', { limit: 10, sort: 'new' });

      expect(mockComposio.tools.execute).toHaveBeenCalledWith(
        'REDDIT_SEARCH_REDDIT',
        {
          userId: 'user_test',
          arguments: {
            q: 'project management tool',
            limit: 10,
            sort: 'new',
          },
        },
      );
    });

    it('returns normalized RedditPost[] array', async () => {
      const posts = await client.search('project management');

      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        id: 'abc123',
        title: 'Looking for a project management tool',
        author: 'startup_founder',
        subreddit: 'SaaS',
        subreddit_name_prefixed: 'r/SaaS',
        score: 42,
        num_comments: 15,
        ups: 42,
        downs: 3,
      });
    });

    it('includes time filter when provided', async () => {
      await client.search('test', { time: 'week' });

      expect(mockComposio.tools.execute).toHaveBeenCalledWith(
        'REDDIT_SEARCH_REDDIT',
        expect.objectContaining({
          arguments: expect.objectContaining({ t: 'week' }),
        }),
      );
    });

    it('returns empty array on empty response', async () => {
      mockComposio = createMockComposio({ data: [] });
      client = new ComposioRedditClient(mockComposio, 'user_test');

      const posts = await client.search('nothing');
      expect(posts).toEqual([]);
    });
  });

  describe('browseSubreddit()', () => {
    it('calls REDDIT_GET_SUBREDDIT_POSTS with correct arguments', async () => {
      await client.browseSubreddit('SaaS', 'hot', { limit: 50 });

      expect(mockComposio.tools.execute).toHaveBeenCalledWith(
        'REDDIT_GET_SUBREDDIT_POSTS',
        {
          userId: 'user_test',
          arguments: {
            subreddit: 'SaaS',
            sort: 'hot',
            limit: 50,
          },
        },
      );
    });

    it('strips r/ prefix from subreddit name', async () => {
      await client.browseSubreddit('r/startups');

      expect(mockComposio.tools.execute).toHaveBeenCalledWith(
        'REDDIT_GET_SUBREDDIT_POSTS',
        expect.objectContaining({
          arguments: expect.objectContaining({ subreddit: 'startups' }),
        }),
      );
    });

    it('throws on empty subreddit name', async () => {
      await expect(client.browseSubreddit('')).rejects.toThrow('Subreddit name is required');
    });

    it('returns normalized RedditPost[]', async () => {
      const posts = await client.browseSubreddit('SaaS');

      expect(posts).toHaveLength(1);
      expect(posts[0].subreddit_name_prefixed).toBe('r/SaaS');
    });
  });

  describe('getPost()', () => {
    it('calls REDDIT_GET_POST with post ID', async () => {
      mockComposio = createMockComposio({
        data: { post: sampleRawPost, comments: [sampleRawComment] },
      });
      client = new ComposioRedditClient(mockComposio, 'user_test');

      await client.getPost('abc123');

      expect(mockComposio.tools.execute).toHaveBeenCalledWith(
        'REDDIT_GET_POST',
        {
          userId: 'user_test',
          arguments: { id: 'abc123' },
        },
      );
    });

    it('returns post and comments', async () => {
      mockComposio = createMockComposio({
        data: { post: sampleRawPost, comments: [sampleRawComment] },
      });
      client = new ComposioRedditClient(mockComposio, 'user_test');

      const result = await client.getPost('abc123');

      expect(result.post.id).toBe('abc123');
      expect(result.post.subreddit_name_prefixed).toBe('r/SaaS');
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe('comment1');
      expect(result.comments[0].body).toContain('Linear');
    });
  });

  describe('getUserContent()', () => {
    it('calls REDDIT_GET_USER_POSTS with username', async () => {
      await client.getUserContent('startup_founder');

      expect(mockComposio.tools.execute).toHaveBeenCalledWith(
        'REDDIT_GET_USER_POSTS',
        {
          userId: 'user_test',
          arguments: { username: 'startup_founder' },
        },
      );
    });
  });

  describe('normalizePost()', () => {
    it('maps all required RedditPost fields', () => {
      const post = client.normalizePost(sampleRawPost);

      // Check every required field
      const requiredFields: (keyof RedditPost)[] = [
        'id', 'title', 'author', 'subreddit', 'subreddit_name_prefixed',
        'score', 'num_comments', 'created_utc', 'url', 'permalink',
        'ups', 'downs',
      ];

      for (const field of requiredFields) {
        expect(post).toHaveProperty(field);
        expect(post[field]).not.toBeUndefined();
      }
    });

    it('always sets subreddit_name_prefixed to r/{subreddit}', () => {
      const post = client.normalizePost({ subreddit: 'startups', id: 'x' });
      expect(post.subreddit_name_prefixed).toBe('r/startups');
    });

    it('handles missing fields gracefully', () => {
      const post = client.normalizePost({ id: 'minimal' });

      expect(post.id).toBe('minimal');
      expect(post.title).toBe('');
      expect(post.author).toBe('[deleted]');
      expect(post.subreddit).toBe('');
      expect(post.subreddit_name_prefixed).toBe('r/');
      expect(post.score).toBe(0);
      expect(post.ups).toBe(0);
      expect(post.downs).toBe(0);
    });

    it('handles alternate field names from Composio', () => {
      const post = client.normalizePost({
        id: 'alt1',
        author_name: 'alt_author',
        subreddit_name: 'altSub',
        comment_count: 7,
      });

      expect(post.author).toBe('alt_author');
      expect(post.subreddit).toBe('altSub');
      expect(post.num_comments).toBe(7);
    });
  });

  describe('normalizeComment()', () => {
    it('maps all required RedditComment fields', () => {
      const comment = client.normalizeComment(sampleRawComment);

      const requiredFields: (keyof RedditComment)[] = [
        'id', 'author', 'body', 'score', 'created_utc', 'permalink', 'depth',
      ];

      for (const field of requiredFields) {
        expect(comment).toHaveProperty(field);
        expect(comment[field]).not.toBeUndefined();
      }
    });

    it('recursively normalizes nested replies', () => {
      const nested = {
        ...sampleRawComment,
        replies: [{ id: 'reply1', author: 'replier', body: 'nice', score: 2, depth: 1 }],
      };

      const comment = client.normalizeComment(nested);
      expect(comment.replies).toHaveLength(1);
      expect(comment.replies![0].id).toBe('reply1');
      expect(comment.replies![0].depth).toBe(1);
    });
  });

  describe('response extraction', () => {
    it('handles Composio { data: { posts: [...] } } envelope', async () => {
      mockComposio = createMockComposio({ data: { posts: [sampleRawPost, sampleRawPost] } });
      client = new ComposioRedditClient(mockComposio, 'user_test');

      const posts = await client.search('test');
      expect(posts).toHaveLength(2);
    });

    it('handles Composio { data: [...] } array envelope', async () => {
      mockComposio = createMockComposio({ data: [sampleRawPost] });
      client = new ComposioRedditClient(mockComposio, 'user_test');

      const posts = await client.search('test');
      expect(posts).toHaveLength(1);
    });

    it('handles { result: { children: [...] } } envelope', async () => {
      mockComposio = createMockComposio({ result: { children: [sampleRawPost] } });
      client = new ComposioRedditClient(mockComposio, 'user_test');

      const posts = await client.search('test');
      expect(posts).toHaveLength(1);
    });

    it('handles null/undefined response gracefully', async () => {
      mockComposio = createMockComposio(null);
      client = new ComposioRedditClient(mockComposio, 'user_test');

      const posts = await client.search('test');
      expect(posts).toEqual([]);
    });
  });
});

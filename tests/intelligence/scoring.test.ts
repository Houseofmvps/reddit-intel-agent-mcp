import { describe, it, expect } from 'vitest';
import { scoreOpportunity, scoreLeadPost, type OpportunityInput } from '../../src/intelligence/scoring.js';
import type { RedditPost } from '../../src/types/index.js';

function makePost(overrides: Partial<RedditPost> = {}): RedditPost {
  return {
    id: 'test1',
    title: 'Test post',
    author: 'testuser',
    subreddit: 'startups',
    subreddit_name_prefixed: 'r/startups',
    score: 100,
    num_comments: 20,
    created_utc: Date.now() / 1000 - 86400, // 1 day ago
    url: 'https://reddit.com/test',
    permalink: '/r/startups/comments/test1/test_post/',
    ups: 100,
    downs: 5,
    upvote_ratio: 0.95,
    ...overrides,
  };
}

describe('scoreOpportunity', () => {
  it('returns high score for strong signal', () => {
    const input: OpportunityInput = {
      painPoints: Array.from({ length: 15 }, (_, i) => ({
        text: `Pain point ${i}`,
        source_url: `https://reddit.com/p/${i}`,
        subreddit: 'startups',
        score: 200,
        num_comments: 50,
        recency_days: 10,
        author: 'user',
        severity: 'high' as const,
        signals: ['frustration', 'unmet_need'],
      })),
      workarounds: Array.from({ length: 5 }, (_, i) => ({
        description: `Workaround ${i}`,
        tools_mentioned: ['spreadsheet'],
        frustration_level: 'high' as const,
        source_url: `https://reddit.com/w/${i}`,
        subreddit: 'startups',
        upvotes: 100,
        author: 'user',
        signals: ['workaround'],
      })),
      competitorMentions: [
        { sentiment: 'negative', score: 50 },
        { sentiment: 'negative', score: 30 },
        { sentiment: 'neutral', score: 10 },
      ],
      totalPostsSearched: 50,
      subredditSubscribers: [500_000, 200_000],
    };

    const result = scoreOpportunity(input);
    expect(result.total).toBeGreaterThan(50);
    expect(result.confidence).not.toBe('low');
    expect(result.evidence_count).toBe(20);
  });

  it('returns low score for weak signal', () => {
    const input: OpportunityInput = {
      painPoints: [{ text: 'minor issue', source_url: '', subreddit: 'test', score: 2, num_comments: 1, recency_days: 300, author: 'u', severity: 'low', signals: [] }],
      workarounds: [],
      competitorMentions: [],
      totalPostsSearched: 50,
      subredditSubscribers: [100],
    };

    const result = scoreOpportunity(input);
    expect(result.total).toBeLessThan(30);
    expect(result.confidence).toBe('low');
  });

  it('returns 0 for empty input', () => {
    const result = scoreOpportunity({
      painPoints: [],
      workarounds: [],
      competitorMentions: [],
      totalPostsSearched: 0,
      subredditSubscribers: [],
    });
    expect(result.total).toBe(0);
  });

  it('score is always 0-100', () => {
    const big: OpportunityInput = {
      painPoints: Array.from({ length: 100 }, () => ({
        text: 'pain', source_url: '', subreddit: 's', score: 10000, num_comments: 5000, recency_days: 1, author: 'u', severity: 'critical' as const, signals: [],
      })),
      workarounds: Array.from({ length: 50 }, () => ({
        description: 'w', tools_mentioned: [], frustration_level: 'high' as const, source_url: '', subreddit: 's', upvotes: 1000, author: 'u', signals: [],
      })),
      competitorMentions: Array.from({ length: 50 }, () => ({ sentiment: 'negative' as const, score: 100 })),
      totalPostsSearched: 100,
      subredditSubscribers: [10_000_000],
    };
    const result = scoreOpportunity(big);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });
});

describe('scoreLeadPost', () => {
  it('scores buyer intent post highly', () => {
    const post = makePost({
      title: 'Looking for a CRM tool for my startup',
      selftext: 'We have a budget of $200/mo and need something ASAP. I am the CEO.',
    });
    const result = scoreLeadPost(post);
    expect(result.total).toBeGreaterThan(40);
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.budget_hints.length).toBeGreaterThan(0);
  });

  it('scores generic post low', () => {
    const post = makePost({ title: 'Funny cat video', selftext: 'Check out this hilarious cat' });
    const result = scoreLeadPost(post);
    expect(result.total).toBeLessThan(20);
  });

  it('detects urgency signals', () => {
    const post = makePost({ title: 'Need a project management tool ASAP for my team', selftext: 'Deadline is this week' });
    const result = scoreLeadPost(post);
    expect(result.urgency).toBeGreaterThan(0);
  });
});

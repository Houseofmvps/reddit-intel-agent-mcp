import { describe, it, expect } from 'vitest';
import { generateDossier } from '../dossier.js';

describe('Lead Dossier Generator', () => {
  it('should produce a hot dossier for high-intent switching post', () => {
    const dossier = generateDossier({
      post: {
        id: 'abc123',
        title: 'Mailchimp got too expensive, looking for alternatives under $50/mo',
        selftext: 'Running a 2K subscriber newsletter. Mailchimp wants $80/mo now.',
        author: 'frustrated_founder',
        subreddit: 'SaaS',
        subreddit_name_prefixed: 'r/SaaS',
        score: 12, num_comments: 4,
        created_utc: Date.now() / 1000 - 2400, // 40 min ago
        permalink: '/r/SaaS/comments/abc123',
        url: '', is_self: true, over_18: false, stickied: false, locked: false,
        is_video: false, link_flair_text: null as unknown as string, author_flair_text: null as unknown as string,
        ups: 12, downs: 0, upvote_ratio: 0.95,
      },
      signals: ['switching', 'pricing_objection', 'buyer_intent'],
      patternWeights: { switching: 4, pricing_objection: 3, buyer_intent: 4 },
      userHistory: {
        accountAge: '2 years', totalKarma: 1500,
        activeSubreddits: ['SaaS', 'Entrepreneur', 'EmailMarketing'],
        hasAskedForRecsBefore: true, role: 'founder',
      },
      productDescription: 'email marketing tool for SaaS',
    });

    expect(dossier.conversionScore).toBeGreaterThan(70);
    expect(dossier.conversionLabel).toBe('hot');
    expect(dossier.painPoints.length).toBeGreaterThan(0);
    expect(dossier.budgetSignals).toContain('$50/mo');
    expect(dossier.intentType).toBe('alternative-seeking');
    expect(dossier.urgency).toBe('immediate');
    expect(dossier.replyWindow).toBeGreaterThan(0);
    expect(dossier.draftReply.length).toBeGreaterThan(50);
    expect(dossier.status).toBe('pending');
    expect(dossier.redditUsername).toBe('frustrated_founder');
  });

  it('should score cold leads correctly', () => {
    const dossier = generateDossier({
      post: {
        id: 'xyz789',
        title: 'What email tools does everyone use?',
        selftext: 'Just curious what the community prefers',
        author: 'casual_asker', subreddit: 'Entrepreneur',
        subreddit_name_prefixed: 'r/Entrepreneur',
        score: 3, num_comments: 45,
        created_utc: Date.now() / 1000 - 36000, // 10 hours ago
        permalink: '/r/Entrepreneur/comments/xyz789',
        url: '', is_self: true, over_18: false, stickied: false, locked: false,
        is_video: false, link_flair_text: null as unknown as string, author_flair_text: null as unknown as string,
        ups: 3, downs: 0, upvote_ratio: 0.75,
      },
      signals: ['buyer_intent'],
      patternWeights: { buyer_intent: 2 },
      userHistory: null,
      productDescription: 'email marketing tool',
    });

    expect(dossier.conversionScore).toBeLessThan(50);
    expect(dossier.conversionLabel).toBe('cold');
    expect(dossier.urgency).toBe('exploring');
  });

  it('should extract budget signals from text', () => {
    const dossier = generateDossier({
      post: {
        id: 'budget1', title: 'Need CRM under $30/month, budget approved',
        selftext: 'Can afford up to $50/mo for our team',
        author: 'buyer', subreddit: 'smallbusiness',
        subreddit_name_prefixed: 'r/smallbusiness',
        score: 5, num_comments: 2,
        created_utc: Date.now() / 1000 - 600,
        permalink: '/r/smallbusiness/comments/budget1',
        url: '', is_self: true, over_18: false, stickied: false, locked: false,
        is_video: false, link_flair_text: null as unknown as string, author_flair_text: null as unknown as string,
        ups: 5, downs: 0, upvote_ratio: 0.9,
      },
      signals: ['buyer_intent'],
      patternWeights: { buyer_intent: 3 },
      userHistory: null,
      productDescription: 'CRM tool',
    });

    expect(dossier.budgetSignals.length).toBeGreaterThan(0);
  });

  it('should handle null userHistory gracefully', () => {
    const dossier = generateDossier({
      post: {
        id: 'null1', title: 'Test post', selftext: 'test',
        author: 'user', subreddit: 'test',
        subreddit_name_prefixed: 'r/test',
        score: 1, num_comments: 0,
        created_utc: Date.now() / 1000 - 300,
        permalink: '/r/test/null1', url: '',
        is_self: true, over_18: false, stickied: false, locked: false,
        is_video: false, link_flair_text: null as unknown as string, author_flair_text: null as unknown as string,
        ups: 1, downs: 0, upvote_ratio: 1,
      },
      signals: [],
      patternWeights: {},
      userHistory: null,
      productDescription: 'tool',
    });

    expect(dossier.userContext.accountAge).toBe('unknown');
    expect(dossier.userContext.hasAskedForRecsBefore).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { draftReply } from '../reply-drafter.js';

describe('Reply Drafter', () => {
  it('should generate a help-first reply for pain_point signal', () => {
    const reply = draftReply({
      intentType: 'pain-expressing',
      painPoints: ['email deliverability is terrible'],
      productDescription: 'email marketing tool for SaaS',
      subreddit: 'SaaS',
    });
    expect(reply.length).toBeGreaterThan(50);
    expect(reply.length).toBeLessThan(800);
    // Should NOT lead with product pitch
    expect(reply.slice(0, 50).toLowerCase()).not.toContain('check out');
  });

  it('should generate alternative-comparison reply for switching signal', () => {
    const reply = draftReply({
      intentType: 'alternative-seeking',
      painPoints: ['Mailchimp got too expensive'],
      productDescription: 'affordable email tool',
      subreddit: 'Entrepreneur',
    });
    expect(reply).toContain('expensive');
    expect(reply.length).toBeGreaterThan(50);
  });

  it('should generate recommendation reply', () => {
    const reply = draftReply({
      intentType: 'recommendation-asking',
      painPoints: [],
      productDescription: 'project management tool',
      subreddit: 'startups',
    });
    expect(reply.length).toBeGreaterThan(50);
  });

  it('should generate migration reply', () => {
    const reply = draftReply({
      intentType: 'migration-planning',
      painPoints: ['the migration from Jira is painful'],
      productDescription: 'agile tool',
      subreddit: 'projectmanagement',
    });
    expect(reply).toContain('migrat');
    expect(reply.length).toBeGreaterThan(50);
  });

  it('should truncate replies over 800 chars', () => {
    const reply = draftReply({
      intentType: 'pain-expressing',
      painPoints: ['a'.repeat(500)],
      productDescription: 'tool',
      subreddit: 'test',
    });
    expect(reply.length).toBeLessThanOrEqual(800);
  });

  it('should fallback to pain-expressing for unknown intent', () => {
    const reply = draftReply({
      intentType: 'unknown-type',
      painPoints: ['some issue'],
      productDescription: 'tool',
      subreddit: 'test',
    });
    expect(reply.length).toBeGreaterThan(50);
  });
});

import { describe, it, expect } from 'vitest';
import { matchPatterns, hasCategory, categoryWeight, signalSummary } from '../../src/intelligence/patterns.js';

describe('matchPatterns', () => {
  it('detects pain signals', () => {
    const matches = matchPatterns('I am so frustrated with this broken tool');
    expect(hasCategory(matches, 'pain')).toBe(true);
    expect(matches.some(m => m.label === 'frustration')).toBe(true);
    expect(matches.some(m => m.label === 'broken')).toBe(true);
  });

  it('detects workaround signals', () => {
    const matches = matchPatterns('I built a hacky workaround using Google Sheets to track expenses');
    expect(hasCategory(matches, 'workaround')).toBe(true);
    expect(matches.some(m => m.label === 'explicit_workaround')).toBe(true);
  });

  it('detects buyer intent', () => {
    const matches = matchPatterns('Looking for a CRM tool for my startup, willing to pay up to $50/mo');
    expect(hasCategory(matches, 'buyer_intent')).toBe(true);
    expect(matches.some(m => m.label === 'seeking')).toBe(true);
    expect(matches.some(m => m.label === 'budget_signal')).toBe(true);
  });

  it('detects switching intent', () => {
    const matches = matchPatterns('Just switched from Jira to Linear and it is so much better');
    expect(hasCategory(matches, 'switching')).toBe(true);
  });

  it('detects feature requests', () => {
    const matches = matchPatterns("Why can't Notion add a proper Gantt chart? This is a missing feature");
    expect(hasCategory(matches, 'feature_request')).toBe(true);
  });

  it('detects pricing objections', () => {
    const matches = matchPatterns('Figma is way too expensive, looking for a free alternative');
    expect(hasCategory(matches, 'pricing_objection')).toBe(true);
    expect(matches.some(m => m.label === 'price_complaint')).toBe(true);
    expect(matches.some(m => m.label === 'seeking_free')).toBe(true);
  });

  it('detects meme noise', () => {
    const matches = matchPatterns('lol this is the way bruh');
    expect(hasCategory(matches, 'meme_noise')).toBe(true);
  });

  it('returns empty for neutral text', () => {
    const matches = matchPatterns('Today I went to the store and bought milk');
    const significant = matches.filter(m => m.weight > 1);
    expect(significant.length).toBe(0);
  });

  it('calculates category weight correctly', () => {
    const matches = matchPatterns('Frustrated, broken, terrible experience that wastes my time');
    const painWeight = categoryWeight(matches, 'pain');
    expect(painWeight).toBeGreaterThan(5);
  });

  it('produces signal summary without duplicates', () => {
    const matches = matchPatterns('Frustrated and struggling with this broken tool');
    const summary = signalSummary(matches);
    expect(new Set(summary).size).toBe(summary.length);
  });
});

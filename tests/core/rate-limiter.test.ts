import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../src/core/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests under limit', () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 60_000 });
    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    limiter.record();
    expect(limiter.getStats().used).toBe(2);
    expect(limiter.getStats().available).toBe(3);
  });

  it('blocks when limit reached', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.record();
    limiter.record();
    expect(limiter.canProceed()).toBe(false);
  });

  it('throws on record() when at limit', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000, label: 'test' });
    limiter.record();
    expect(() => limiter.record()).toThrow(/Rate limit/);
  });

  it('tryRecord returns false at limit', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.tryRecord()).toBe(true);
    expect(limiter.tryRecord()).toBe(false);
  });

  it('recovers after window passes', async () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 50 });
    limiter.record();
    expect(limiter.canProceed()).toBe(false);
    await new Promise(r => setTimeout(r, 80));
    expect(limiter.canProceed()).toBe(true);
  });

  it('reset clears all records', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.record();
    limiter.record();
    expect(limiter.canProceed()).toBe(false);
    limiter.reset();
    expect(limiter.canProceed()).toBe(true);
    expect(limiter.getStats().used).toBe(0);
  });

  it('reports seconds until available', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.secondsUntilAvailable()).toBe(0);
    limiter.record();
    expect(limiter.secondsUntilAvailable()).toBeGreaterThan(0);
  });
});

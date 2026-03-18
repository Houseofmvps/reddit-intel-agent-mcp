import { describe, it, expect, afterEach } from 'vitest';
import { IntelCache } from '../../src/core/cache.js';

describe('IntelCache', () => {
  let cache: IntelCache;

  afterEach(() => {
    cache?.destroy();
  });

  it('stores and retrieves values', () => {
    cache = new IntelCache();
    cache.set('test:key', { hello: 'world' });
    expect(cache.get('test:key')).toEqual({ hello: 'world' });
  });

  it('returns null for missing keys', () => {
    cache = new IntelCache();
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns null for expired entries', async () => {
    cache = new IntelCache({ defaultTTL: 50 });
    cache.set('expire', 'data');
    expect(cache.get('expire')).toBe('data');
    await new Promise(r => setTimeout(r, 80));
    expect(cache.get('expire')).toBeNull();
  });

  it('respects custom TTL', async () => {
    cache = new IntelCache({ defaultTTL: 5000 });
    cache.set('short', 'data', 50);
    await new Promise(r => setTimeout(r, 80));
    expect(cache.get('short')).toBeNull();
  });

  it('evicts LRU entries when full', () => {
    cache = new IntelCache({ maxSizeBytes: 200 });
    cache.set('a', 'x'.repeat(50));
    cache.set('b', 'y'.repeat(50));
    // Access 'b' to increase its hit count
    cache.get('b');
    // Force eviction
    cache.set('c', 'z'.repeat(100));
    // 'a' should be evicted (lower score), 'b' should survive
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).not.toBeNull();
  });

  it('skips items larger than maxSize', () => {
    cache = new IntelCache({ maxSizeBytes: 100 });
    cache.set('huge', 'x'.repeat(200));
    expect(cache.get('huge')).toBeNull();
  });

  it('has() returns false for expired', async () => {
    cache = new IntelCache({ defaultTTL: 50 });
    cache.set('k', 'v');
    expect(cache.has('k')).toBe(true);
    await new Promise(r => setTimeout(r, 80));
    expect(cache.has('k')).toBe(false);
  });

  it('clear() empties the cache', () => {
    cache = new IntelCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(cache.getStats().entries).toBe(0);
  });

  it('static key() creates valid keys', () => {
    expect(IntelCache.key('sub', 'technology', 'hot')).toBe('sub:technology:hot');
    expect(IntelCache.key('search', 'AI tools', 25)).toBe('search:ai_tools:25');
  });

  it('static key() truncates long keys with hash', () => {
    const longPart = 'a'.repeat(300);
    const key = IntelCache.key(longPart);
    expect(key.length).toBeLessThanOrEqual(256);
  });

  it('static key() throws on empty parts', () => {
    expect(() => IntelCache.key()).toThrow();
  });
});

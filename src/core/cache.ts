/**
 * Reddit Intelligence Agent — In-memory LRU cache with adaptive TTL
 */

interface CacheEntry<T> {
  data: T;
  createdAt: number;
  expiresAt: number;
  size: number;
  hits: number;
}

export interface CacheConfig {
  maxSizeBytes?: number;
  defaultTTL?: number;
  cleanupIntervalMs?: number;
}

const ADAPTIVE_TTL: Array<[RegExp, number]> = [
  [/^sub:.*:hot$/, 5 * 60_000],
  [/^sub:.*:new$/, 2 * 60_000],
  [/^sub:.*:top$/, 30 * 60_000],
  [/^post:/, 10 * 60_000],
  [/^user:/, 15 * 60_000],
  [/^search:/, 10 * 60_000],
  [/^intel:/, 5 * 60_000],
];

export class IntelCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private usedBytes = 0;
  private readonly maxBytes: number;
  private readonly defaultTTL: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(config: CacheConfig = {}) {
    this.maxBytes = config.maxSizeBytes ?? 50 * 1024 * 1024;
    this.defaultTTL = config.defaultTTL ?? 5 * 60_000;

    if (this.maxBytes > 0 && config.cleanupIntervalMs !== 0) {
      this.timer = setInterval(() => this.purgeExpired(), config.cleanupIntervalMs ?? 60_000);
      this.timer.unref();
    }
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.remove(key);
      return null;
    }
    entry.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T, customTTL?: number): void {
    const size = this.estimateSize(data);
    if (size > this.maxBytes) return; // too large to cache

    while (this.usedBytes + size > this.maxBytes && this.store.size > 0) {
      this.evictLowest();
    }

    if (this.store.has(key)) this.remove(key);

    const ttl = customTTL ?? this.resolveTTL(key);
    const now = Date.now();
    this.store.set(key, { data, createdAt: now, expiresAt: now + ttl, size, hits: 0 });
    this.usedBytes += size;
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      this.remove(key);
      return false;
    }
    return true;
  }

  remove(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.usedBytes -= entry.size;
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.usedBytes = 0;
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clear();
  }

  static key(...parts: Array<string | number | boolean | undefined>): string {
    const cleaned = parts
      .filter((p): p is string | number | boolean => p !== undefined && p !== null)
      .map(p => String(p).toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_'));

    if (cleaned.length === 0) throw new Error('Cache key requires at least one part');

    let k = cleaned.join(':');
    if (k.length > 256) {
      const hash = k.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(36);
      k = k.substring(0, 245) + '_' + hash;
    }
    return k;
  }

  getStats() {
    return {
      entries: this.store.size,
      usedMB: (this.usedBytes / 1024 / 1024).toFixed(2),
      maxMB: (this.maxBytes / 1024 / 1024).toFixed(2),
    };
  }

  private resolveTTL(key: string): number {
    for (const [pattern, ttl] of ADAPTIVE_TTL) {
      if (pattern.test(key)) return ttl;
    }
    return this.defaultTTL;
  }

  private estimateSize(data: unknown): number {
    try {
      return JSON.stringify(data).length * 2;
    } catch {
      return 1024;
    }
  }

  private evictLowest(): void {
    let lowestKey: string | null = null;
    let lowestScore = Infinity;

    for (const [key, entry] of this.store) {
      const age = Math.max(1, Date.now() - entry.createdAt);
      const score = entry.hits / (age / 1000);
      if (score < lowestScore) {
        lowestScore = score;
        lowestKey = key;
      }
    }
    if (lowestKey) this.remove(lowestKey);
  }

  private purgeExpired(): void {
    const now = Date.now();
    const expired: string[] = [];
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) expired.push(key);
    }
    for (const key of expired) this.remove(key);
  }
}

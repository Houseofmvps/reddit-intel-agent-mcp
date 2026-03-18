/**
 * Reddit Intelligence Agent — Sliding-window rate limiter
 */

export interface RateLimiterConfig {
  limit: number;
  windowMs: number;
  label?: string;
}

export class RateLimiter {
  private timestamps: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly label: string;

  constructor(config: RateLimiterConfig) {
    this.limit = config.limit;
    this.windowMs = config.windowMs;
    this.label = config.label ?? 'RateLimiter';
  }

  canProceed(): boolean {
    this.sweep();
    return this.timestamps.length < this.limit;
  }

  record(): void {
    this.sweep();
    if (this.timestamps.length >= this.limit) {
      throw new Error(this.formatError());
    }
    this.timestamps.push(Date.now());
  }

  tryRecord(): boolean {
    if (!this.canProceed()) return false;
    this.timestamps.push(Date.now());
    return true;
  }

  secondsUntilAvailable(): number {
    this.sweep();
    if (this.timestamps.length < this.limit) return 0;
    const oldest = this.timestamps[0];
    return Math.max(0, Math.ceil(((oldest + this.windowMs) - Date.now()) / 1000));
  }

  getStats() {
    this.sweep();
    return {
      used: this.timestamps.length,
      limit: this.limit,
      available: Math.max(0, this.limit - this.timestamps.length),
      waitSeconds: this.secondsUntilAvailable(),
    };
  }

  reset(): void {
    this.timestamps = [];
  }

  private sweep(): void {
    const cutoff = Date.now() - this.windowMs;
    this.timestamps = this.timestamps.filter(t => t > cutoff);
  }

  private formatError(): string {
    const wait = this.secondsUntilAvailable();
    return `[${this.label}] Rate limit reached (${this.limit} req/${this.windowMs / 1000}s). ` +
           `Retry in ${wait}s. Tip: configure REDDIT_INTEL_CLIENT_ID for higher limits.`;
  }
}

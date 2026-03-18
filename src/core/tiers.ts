/**
 * Reddit Intelligence Agent — Product tier enforcement
 *
 * Founder-friendly pricing:
 * - Free: All 14 tools with result limits (10 results, basic scoring)
 * - Pro ($7.99/mo): Unlimited results, full scoring breakdowns, clustering
 */

import type { ProductTier, ToolTier } from '../types/index.js';

export function resolveCurrentTier(): ProductTier {
  const env = (process.env.REDDIT_INTEL_TIER ?? 'free').toLowerCase().trim();
  if (env === 'pro' || env === 'team') {
    const key = process.env.REDDIT_INTEL_LICENSE_KEY?.trim();
    if (!key || key.length < 10) {
      console.error(`[tiers] REDDIT_INTEL_TIER=${env} but no valid license key — falling back to free`);
      return 'free';
    }
    return 'pro' as ProductTier;
  }
  return 'free';
}

const TIER_RANK: Record<ProductTier, number> = { free: 0, pro: 1, team: 2 };

export function canAccessTool(currentTier: ProductTier, requiredTier: ToolTier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[requiredTier];
}

export function tierGateMessage(toolName: string, _requiredTier: ToolTier): string {
  return `[${toolName}] requires Pro. Upgrade to Pro ($7.99/mo) at https://buildradar.xyz for unlimited results, full scoring, and clustering. ` +
         `Set REDDIT_INTEL_TIER=pro and REDDIT_INTEL_LICENSE_KEY to activate.`;
}

/** Get result limits for the current tier */
export function getResultLimit(tier: ProductTier): number {
  if (tier === 'pro' || tier === 'team') return 100;
  return 10;
}

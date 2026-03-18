/**
 * Reddit Intelligence Agent — Product tier enforcement
 *
 * Founder-friendly pricing:
 * - Free: All 14 tools with result limits (10 results, basic scoring)
 * - Pro ($9.99/mo): Unlimited results, full scoring breakdowns, clustering
 *
 * License keys validated via Polar.sh
 */

import type { ProductTier, ToolTier } from '../types/index.js';
import { validateLicenseKey } from './license.js';

/** Synchronous tier check from env (used at startup) */
export function resolveCurrentTier(): ProductTier {
  const env = (process.env.REDDIT_INTEL_TIER ?? 'free').toLowerCase().trim();
  if (env === 'pro' || env === 'team') {
    const key = process.env.REDDIT_INTEL_LICENSE_KEY?.trim();
    if (!key || key.length < 10) {
      console.error(`[tiers] REDDIT_INTEL_TIER=${env} but no valid license key — falling back to free`);
      return 'free';
    }
    // Key exists, assume pro at startup — async validation happens on first request
    return 'pro' as ProductTier;
  }
  return 'free';
}

/** Async tier validation — calls Polar API to verify license key */
export async function validateTier(): Promise<ProductTier> {
  const env = (process.env.REDDIT_INTEL_TIER ?? 'free').toLowerCase().trim();
  if (env !== 'pro' && env !== 'team') return 'free';

  const key = process.env.REDDIT_INTEL_LICENSE_KEY?.trim();
  if (!key || key.length < 10) return 'free';

  const result = await validateLicenseKey(key);
  return result.tier;
}

const TIER_RANK: Record<ProductTier, number> = { free: 0, pro: 1, team: 2 };

export function canAccessTool(currentTier: ProductTier, requiredTier: ToolTier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[requiredTier];
}

export function tierGateMessage(toolName: string, _requiredTier: ToolTier): string {
  return `[${toolName}] requires Pro. Upgrade to Pro ($9.99/mo) at https://buildradar.xyz for unlimited results, full scoring, and clustering. ` +
         `Set REDDIT_INTEL_TIER=pro and REDDIT_INTEL_LICENSE_KEY to activate.`;
}

/** Get result limits for the current tier */
export function getResultLimit(tier: ProductTier): number {
  if (tier === 'pro' || tier === 'team') return 100;
  return 10;
}

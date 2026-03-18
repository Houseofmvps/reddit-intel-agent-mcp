/**
 * Reddit Intelligence Agent — Product tier enforcement
 *
 * MCP is 100% free and open-source. No license keys, no gating.
 * Pro features (dashboard, unlimited results) are in the paid dashboard at app.buildradar.xyz.
 */

import type { ProductTier, ToolTier } from '../types/index.js';

/** Resolve tier from env — no license key needed */
export function resolveCurrentTier(): ProductTier {
  const env = (process.env.REDDIT_INTEL_TIER ?? 'free').toLowerCase().trim();
  if (env === 'pro' || env === 'team') return 'pro' as ProductTier;
  return 'free';
}

const TIER_RANK: Record<ProductTier, number> = { free: 0, pro: 1, team: 2 };

export function canAccessTool(currentTier: ProductTier, requiredTier: ToolTier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[requiredTier];
}

export function tierGateMessage(toolName: string, _requiredTier: ToolTier): string {
  return `[${toolName}] requires Pro. Get Pro ($9.99/mo) at https://buildradar.xyz for unlimited results, full scoring, and clustering.`;
}

/** Get result limits for the current tier */
export function getResultLimit(tier: ProductTier): number {
  if (tier === 'pro' || tier === 'team') return 100;
  return 10;
}

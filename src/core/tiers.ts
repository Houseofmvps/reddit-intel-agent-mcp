/**
 * Reddit Intelligence Agent — Product tier enforcement
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
    // In production this would verify a JWT or call a license API.
    // For now, presence of a key >= 10 chars activates the tier.
    return env as ProductTier;
  }
  return 'free';
}

const TIER_RANK: Record<ProductTier, number> = { free: 0, pro: 1, team: 2 };

export function canAccessTool(currentTier: ProductTier, requiredTier: ToolTier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[requiredTier];
}

export function tierGateMessage(toolName: string, requiredTier: ToolTier): string {
  const upgrade = requiredTier === 'pro'
    ? 'Upgrade to Pro ($49/mo) for scored intelligence, competitor monitoring, and evidence exports.'
    : 'Upgrade to Team ($199/mo) for lead ranking, workspaces, and priority support.';
  return `[${toolName}] requires the ${requiredTier} tier. ${upgrade} ` +
         `Set REDDIT_INTEL_TIER=${requiredTier} and REDDIT_INTEL_LICENSE_KEY to activate.`;
}

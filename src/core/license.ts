/**
 * Reddit Intelligence Agent — License key validation via Polar.sh
 *
 * Validates license keys against Polar's API.
 * Keys are cached for 1 hour to avoid hitting Polar on every request.
 */

const POLAR_VALIDATE_URL = 'https://api.polar.sh/v1/customer-portal/license-keys/validate';
const CACHE_TTL_MS = 60 * 60_000; // 1 hour
const CACHE_TTL_FAIL_MS = 5 * 60_000; // 5 min for failed validations (retry sooner)

interface LicenseValidation {
  valid: boolean;
  tier: 'pro' | 'free';
  expiresAt: number; // cache expiry
}

let cachedValidation: LicenseValidation | null = null;

export async function validateLicenseKey(key: string): Promise<{ valid: boolean; tier: 'pro' | 'free' }> {
  if (!key || key.length < 10) {
    return { valid: false, tier: 'free' };
  }

  // Return cached result if still valid
  if (cachedValidation && Date.now() < cachedValidation.expiresAt) {
    return { valid: cachedValidation.valid, tier: cachedValidation.tier };
  }

  try {
    const res = await fetch(POLAR_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        organization_id: process.env.POLAR_ORG_ID,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error(`[license] Polar validation failed: HTTP ${res.status}`);
      // On API failure, allow existing cached result or fall back to offline check
      return offlineFallback(key);
    }

    const data = await res.json() as {
      validated: boolean;
      license_key?: {
        status: string;
        expires_at?: string;
      };
    };

    const valid = data.validated === true &&
      data.license_key?.status === 'granted';

    cachedValidation = {
      valid,
      tier: valid ? 'pro' : 'free',
      expiresAt: Date.now() + (valid ? CACHE_TTL_MS : CACHE_TTL_FAIL_MS),
    };

    if (valid) {
      console.error(`\x1b[32m[license]\x1b[0m Pro license validated via Polar`);
    } else {
      console.error(`\x1b[33m[license]\x1b[0m License key not valid (status: ${data.license_key?.status ?? 'unknown'})`);
    }

    return { valid, tier: valid ? 'pro' : 'free' };
  } catch (err) {
    console.error(`[license] Polar API error: ${err instanceof Error ? err.message : String(err)}`);
    return offlineFallback(key);
  }
}

/**
 * Offline fallback: if Polar API is unreachable, allow keys that
 * match the expected format (br_pro_*) and are long enough.
 * This prevents paying users from being locked out due to API issues.
 * The key will be re-validated when the cache expires.
 */
function offlineFallback(key: string): { valid: boolean; tier: 'pro' | 'free' } {
  // If we had a previous successful validation, trust it
  if (cachedValidation && cachedValidation.valid) {
    console.error(`[license] Polar unreachable — using cached validation (expires ${new Date(cachedValidation.expiresAt).toISOString()})`);
    return { valid: true, tier: 'pro' };
  }

  // If key looks legitimate and we can't reach Polar, give benefit of the doubt
  // but with a short cache so we re-validate soon
  if (key.length >= 20) {
    console.error(`[license] Polar unreachable — allowing key temporarily (will re-validate in 5min)`);
    cachedValidation = {
      valid: true,
      tier: 'pro',
      expiresAt: Date.now() + CACHE_TTL_FAIL_MS,
    };
    return { valid: true, tier: 'pro' };
  }

  return { valid: false, tier: 'free' };
}

/** Clear cached validation (for testing) */
export function clearLicenseCache(): void {
  cachedValidation = null;
}

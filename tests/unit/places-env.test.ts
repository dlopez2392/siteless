/**
 * D-02 — the Places kill switch's parse contract, and the cron secret's.
 *
 * `PLACES_MODE` is how danlo turns paid Google traffic on and off: a Vercel env edit plus a
 * redeploy, deliberately, with no in-app toggle. Its failure modes are all about money:
 *   - unset must mean `off`, never a paid mode (T-4-02);
 *   - '' must mean `off` too — GitHub Actions hands an absent secret over as the empty string;
 *   - a typo ('on', 'true', 'enterprize') must throw at boot naming the variable, because a
 *     schema that quietly coerced it to a default would hide the mistake either way — off when
 *     danlo meant on (a sweep that silently does nothing), or worse.
 *
 * `CRON_SECRET` is optional in the schema because the purge route (04-17) refuses when it is
 * unset — "open when unset" is the failure that avoids. A value too short to be a secret is
 * refused here, at boot (T-4-08).
 *
 * Each case re-imports the module: src/env.ts parses process.env once, at module load.
 *
 * Mutations:
 *   - drop `.default('off')` → 'PLACES_MODE defaults to off when unset or empty' goes red.
 *   - widen the enum to z.string() → 'PLACES_MODE refuses an unknown value' goes red.
 *   - drop `.min(16)` → 'CRON_SECRET is optional and refused when shorter than 16 characters'
 *     goes red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('SUPABASE_DB_POOL_URL', 'postgres://u:p@localhost:5432/x');
  // Start every case from a known-absent state: the developer's shell or .env.local must
  // not be able to decide these tests.
  vi.stubEnv('PLACES_MODE', undefined);
  vi.stubEnv('CRON_SECRET', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const loadEnv = async () => (await import('@/env')).env;

describe('src/env.ts PLACES_MODE (D-02)', () => {
  it('PLACES_MODE defaults to off when unset or empty', async () => {
    expect((await loadEnv()).PLACES_MODE).toBe('off');

    vi.resetModules();
    vi.stubEnv('PLACES_MODE', '');
    expect((await loadEnv()).PLACES_MODE).toBe('off');
  });

  it('PLACES_MODE accepts ids_only and enterprise', async () => {
    vi.stubEnv('PLACES_MODE', 'ids_only');
    expect((await loadEnv()).PLACES_MODE).toBe('ids_only');

    vi.resetModules();
    vi.stubEnv('PLACES_MODE', 'enterprise');
    expect((await loadEnv()).PLACES_MODE).toBe('enterprise');
  });

  it('PLACES_MODE refuses an unknown value', async () => {
    vi.stubEnv('PLACES_MODE', 'on');
    await expect(loadEnv()).rejects.toThrow(/PLACES_MODE/);
  });
});

describe('src/env.ts CRON_SECRET', () => {
  it('CRON_SECRET is optional and refused when shorter than 16 characters', async () => {
    expect((await loadEnv()).CRON_SECRET).toBeUndefined();

    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 'short');
    await expect(loadEnv()).rejects.toThrow(/CRON_SECRET/);

    vi.resetModules();
    const thirtyTwo = 'a'.repeat(32);
    vi.stubEnv('CRON_SECRET', thirtyTwo);
    expect((await loadEnv()).CRON_SECRET).toBe(thirtyTwo);
  });
});

/**
 * src/env.ts resolves the runtime pool URL from SUPABASE_DB_POOL_URL, falling back to
 * RUNTIME_DB_URL. The alias exists because T-1-19 asserts .github/workflows/ci.yml is
 * greppable-clean of the production project's vendor name, and CI still has to hand the
 * build and the db suite a runtime URL.
 *
 * An alias nothing exercises is exactly the kind of thing that rots silently: nothing in
 * `src/` reads RUNTIME_DB_URL directly, so without this file the only place it is proven
 * to work is a CI run nobody re-reads.
 *
 * Mutation: delete `?? process.env.RUNTIME_DB_URL` from src/env.ts — 'RUNTIME_DB_URL is
 * accepted when the vendor-named variable is absent' goes red, and only that one.
 *
 * Each case re-imports the module: src/env.ts parses process.env once, at module load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const POOL = 'SUPABASE_DB_POOL_URL';
const ALIAS = 'RUNTIME_DB_URL';
const A_URL = 'postgres://app_user:x@localhost:5432/primary';
const B_URL = 'postgres://app_user:x@localhost:5432/alias';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = { [POOL]: process.env[POOL], [ALIAS]: process.env[ALIAS] };
  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_this_test';
  vi.resetModules();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

const loadEnv = async () => (await import('@/env')).env;

describe('src/env.ts runtime pool URL', () => {
  it('uses SUPABASE_DB_POOL_URL when it is set', async () => {
    process.env[POOL] = A_URL;
    delete process.env[ALIAS];
    expect((await loadEnv()).SUPABASE_DB_POOL_URL).toBe(A_URL);
  });

  it('RUNTIME_DB_URL is accepted when the vendor-named variable is absent', async () => {
    delete process.env[POOL];
    process.env[ALIAS] = B_URL;
    expect((await loadEnv()).SUPABASE_DB_POOL_URL).toBe(B_URL);
  });

  it('an EMPTY vendor-named variable falls through to RUNTIME_DB_URL', async () => {
    // GitHub Actions substitutes an absent secret or variable as '' rather than leaving it
    // unset, so `??` would accept the empty string as "present" and fail zod with a message
    // about the wrong variable. This is the case that actually happens in CI.
    process.env[POOL] = '';
    process.env[ALIAS] = B_URL;
    expect((await loadEnv()).SUPABASE_DB_POOL_URL).toBe(B_URL);
  });

  it('the vendor-named variable wins when both are set', async () => {
    process.env[POOL] = A_URL;
    process.env[ALIAS] = B_URL;
    // Precedence matters in one direction only: on Vercel the primary is the real pooler
    // and an alias left over from anywhere else must never displace it.
    expect((await loadEnv()).SUPABASE_DB_POOL_URL).toBe(A_URL);
  });

  it('neither set is still a boot-time throw naming the variable', async () => {
    delete process.env[POOL];
    delete process.env[ALIAS];
    // The throw is the feature (a silent undefined cost BIS a day), so the fallback must
    // not have turned a missing URL into an accepted one.
    await expect(loadEnv()).rejects.toThrow(/SUPABASE_DB_POOL_URL/);
  });
});

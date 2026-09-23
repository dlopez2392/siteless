/**
 * The Texas Comptroller Socrata client and its two dataset transforms. DATA-01, D-03.
 *
 * Every request in this file is served by `./msw/server.ts` from a recorded payload.
 * Nothing here touches the network, and `onUnhandledRequest: 'error'` turns an accidental
 * live call into a failure rather than a flake.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { naicsPredicate } from '@/lib/socrata/client';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('the NAICS predicate (Pitfall 6)', () => {
  it('naics prefix: the SoQL string-prefix function appears nowhere in the Socrata client or the counts script', () => {
    // `outlet_naics_code` is a Socrata NUMBER; the string-prefix function on it is an HTTP
    // 400 `query.soql.type-mismatch`. The gate covers comments too: a comment quoting the
    // function is how it gets copied back into code. This file lives under tests/ and is
    // outside the scan, so it may spell the token.
    const forbidden = 'starts_with';
    const files = [
      ...walk(join(ROOT, 'src/lib/socrata')),
      join(ROOT, 'scripts/refresh-outlet-counts.ts'),
    ];
    const scanned = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'));

    // Non-vacuous: the walk really did reach the lifted client and the script.
    expect(scanned).toContain('src/lib/socrata/client.ts');
    expect(scanned).toContain('scripts/refresh-outlet-counts.ts');

    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(forbidden));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('naics prefix: ranges become half-open numeric comparisons', () => {
    expect(naicsPredicate([{ lo: 230000, hi: 240000 }])).toBe(
      '((outlet_naics_code >= 230000 and outlet_naics_code < 240000))',
    );
    expect(
      naicsPredicate([
        { lo: 812100, hi: 812200 },
        { lo: 621000, hi: 622000 },
      ]),
    ).toBe(
      '((outlet_naics_code >= 812100 and outlet_naics_code < 812200) or ' +
        '(outlet_naics_code >= 621000 and outlet_naics_code < 622000))',
    );
  });
});

describe('SOCRATA_APP_TOKEN in src/env.ts', () => {
  const KEYS = ['SOCRATA_APP_TOKEN', 'SUPABASE_DB_POOL_URL', 'CLERK_SECRET_KEY'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_this_test';
    process.env.SUPABASE_DB_POOL_URL ||= 'postgres://app_user:x@localhost:5432/unused';
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

  it('socrata app token: an EMPTY value is absent, not a boot failure', async () => {
    // GitHub Actions substitutes an absent secret as ''. Without the `|| undefined`
    // normalisation `.min(1)` refuses it and every deploy dies at boot over an OPTIONAL
    // variable.
    process.env.SOCRATA_APP_TOKEN = '';
    expect((await loadEnv()).SOCRATA_APP_TOKEN).toBeUndefined();
  });

  it('socrata app token: a real value is carried through', async () => {
    process.env.SOCRATA_APP_TOKEN = 'app-token-for-test';
    expect((await loadEnv()).SOCRATA_APP_TOKEN).toBe('app-token-for-test');
  });
});

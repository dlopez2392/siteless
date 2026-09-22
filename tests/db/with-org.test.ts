import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { db } from '@/db/client';
import { withOrg, type OrgClaims } from '@/db/with-org';

/**
 * D-11b, executed instead of grepped.
 *
 * Two invariants live in src/db/with-org.ts and neither is visible to typecheck:
 *   T-1-05  the claims are a BOUND parameter — never sql.raw(JSON.stringify(...)), which
 *           is what the Drizzle Supabase recipe publishes and what injects the moment a
 *           claim value contains a single quote
 *   T-1-04  set_config's third argument is `true`, the transaction-LOCAL form. The
 *           non-local form survives COMMIT, and on a transaction-mode pooler the
 *           connection is handed to the next request with the previous tenant's claims
 *           still set (executed on PostgreSQL 18.3 during research)
 *
 * Until this file existed, both were asserted only by a one-time grep at execution time,
 * so a later refactor could reintroduce either with nothing in CI catching it. This is
 * mutation gate M4 in 01-VALIDATION.md.
 *
 * SCOPE: claim locality, plus the IDENTITY of the connection those claims are set on.
 * Until WR-04 this file fell back to TEST_DATABASE_URL, which in CI is the owner, and as
 * the superuser `set local role authenticated` always succeeds — so the membership that
 * makes the production path work, `grant authenticated to app_user` in
 * drizzle/0000_bootstrap.sql, was proven only on a developer machine whose .env.local
 * happened to carry the app_user URL. Deleting that line left CI green and production
 * returning 42501 on every request. There is no fallback now, and section 3 pins both
 * ends: `authenticated` inside the wrapper, `app_user` outside it.
 *
 * The complementary property — a connection that SKIPS the wrapper is refused 42501 —
 * belongs to plan 05's test (tests/db/rls-isolation.test.ts) and is not re-proven here.
 */

// Hoisted above every import by vitest: src/env.ts parses process.env at module load and
// src/db/client.ts opens the pool from it, so this has to run first.
vi.hoisted(() => {
  // Two names, one meaning: the NON-OWNER runtime connection. CI supplies RUNTIME_DB_URL
  // because T-1-19 asserts .github/workflows/ci.yml is greppable-clean of the production
  // vendor's name; locally the identical URL arrives from .env.local under the name the
  // app itself reads. What is NOT in this chain is TEST_DATABASE_URL — that is the owner's
  // URL, and the fallback to it that used to be here downgraded section 3 into an
  // assertion the superuser passes for free.
  const url = process.env.RUNTIME_DB_URL ?? process.env.SUPABASE_DB_POOL_URL;
  if (!url) {
    throw new Error(
      'tests/db/with-org.test.ts: neither RUNTIME_DB_URL nor SUPABASE_DB_POOL_URL is set. Either must name the NON-OWNER runtime role (app_user), never the migration owner. Local dev: .env.local. CI: the db job env.',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/with-org.test.ts: the database URL points at a Supabase host. D-04: the cloud project is production only and is never a test target.',
    );
  }
  process.env.SUPABASE_DB_POOL_URL = url;
  // src/env.ts requires this name to be present; nothing in this file reaches Clerk.
  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_the_db_suite';
});

// `server-only` throws when imported outside a React Server Component graph.
vi.mock('server-only', () => ({}));

const A: OrgClaims = { o: { id: 'org_A' }, sub: 'user_A', role: 'authenticated' };
const B: OrgClaims = { o: { id: 'org_B' }, sub: 'user_B', role: 'authenticated' };
const READ = sql`select current_setting('request.jwt.claims', true) as claims`;
const WHO = sql`select current_user as who`;

const claimsOf = (rows: unknown): string =>
  String((rows as Array<{ claims: string | null }>)[0]?.claims ?? '');

const whoOf = (rows: unknown): string => String((rows as Array<{ who: string }>)[0]?.who ?? '');

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // postgres.js holds the socket open; without this vitest reports "something prevents
  // the main process from exiting" and the db job burns its timeout.
  await db.$client.end({ timeout: 5 });
});

test('withOrg binds the tenant claims and they die with the transaction', async () => {
  // ---- 1. the SQL withOrg actually issues (T-1-05, and the `true` of T-1-04) ----
  const issued: SQL[] = [];
  const spy = vi.spyOn(db, 'transaction').mockImplementation((async (
    fn: (tx: { execute: (q: SQL) => Promise<unknown> }) => Promise<unknown>,
  ) =>
    fn({
      execute: async (q: SQL) => {
        issued.push(q);
        return [];
      },
    })) as never);
  try {
    await withOrg(A, async () => 'ok');
  } finally {
    spy.mockRestore();
  }

  expect(issued).toHaveLength(2);
  const [setConfigSql, setRoleSql] = issued;
  if (!setConfigSql || !setRoleSql) throw new Error('withOrg issued no SQL');

  const dialect = new PgDialect();
  const setConfig = dialect.sqlToQuery(setConfigSql);
  expect(setConfig.sql).toBe("select set_config('request.jwt.claims', $1, true)");
  expect(setConfig.params).toEqual([JSON.stringify(A)]);
  expect(setConfig.sql).not.toContain('org_A'); // interpolated == injectable
  expect(dialect.sqlToQuery(setRoleSql).sql).toBe('set local role authenticated');

  // A role outside the allow-list is refused before any SQL is issued.
  await expect(
    withOrg({ ...A, role: 'postgres' } as unknown as OrgClaims, async () => 'never'),
  ).rejects.toThrow('refusing role');

  // ---- 2. the behaviour, on the real connection (client.ts pins max: 1) ----
  expect(claimsOf(await withOrg(A, (tx) => tx.execute(READ)))).toContain('org_A');

  // The same pooled connection, outside any transaction. NULL before the GUC has ever
  // been set, '' once a reverted `set local` has defined the placeholder — which is why
  // app.jwt() wraps it in nullif(..., ''). Never a tenant's claims.
  expect(claimsOf(await db.execute(READ))).toBe('');

  // The next request on that connection sees its own org and nothing of the previous one.
  const second = claimsOf(await withOrg(B, (tx) => tx.execute(READ)));
  expect(second).toContain('org_B');
  expect(second).not.toContain('org_A');

  // ---- 3. the identity those claims were set on (WR-04) ----
  // Both ends, not just one. `authenticated` inside proves `grant authenticated to app_user`
  // (0000_bootstrap) is actually in place — as the owner this succeeds for free and proves
  // nothing. `app_user` outside proves the pool is NOT the owner, which is what makes the
  // RLS suite's refusals mean anything: a table owner bypasses row-level security entirely.
  expect(whoOf(await withOrg(A, (tx) => tx.execute(WHO)))).toBe('authenticated');
  expect(whoOf(await db.execute(WHO))).toBe('app_user');
});

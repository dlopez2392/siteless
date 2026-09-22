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
 * SCOPE: this connects as whatever the URL names — in CI that is the owner. It proves
 * claim LOCALITY only. The non-owner "a connection without set local role is refused
 * 42501" property belongs to plan 05's test and is deliberately not re-proven here.
 */

// Hoisted above every import by vitest: src/env.ts parses process.env at module load and
// src/db/client.ts opens the pool from it, so this has to run first.
vi.hoisted(() => {
  const url = process.env.SUPABASE_DB_POOL_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'tests/db/with-org.test.ts: neither SUPABASE_DB_POOL_URL nor TEST_DATABASE_URL is set. Local dev: .env.local. CI: the postgres:18 service container sets TEST_DATABASE_URL.',
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

const claimsOf = (rows: unknown): string =>
  String((rows as Array<{ claims: string | null }>)[0]?.claims ?? '');

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
});

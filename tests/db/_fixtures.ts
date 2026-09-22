import { Client } from 'pg';

/**
 * Ten seconds, not pg's default of "forever": an unreachable host otherwise hangs every
 * test to vitest's ceiling and the suite reports a wall of timeouts instead of one
 * connection error naming the cause. (BIS: the direct db.<ref>.supabase.co address is
 * IPv6-only and GitHub-hosted runners have no IPv6.)
 *
 * TEST_DATABASE_URL, and never the production Supabase connection variable. D-04: the
 * cloud project jahgeqshuesndyscnmjo is production only and is never a test target. A
 * separate name makes "the suite pointed at production" a typo you can see; the guard
 * below makes it one you cannot run.
 *
 * One refused statement per rolled-back transaction. A refusal aborts the transaction;
 * the NEXT statement reports 25P02 ("current transaction is aborted"), not its own
 * reason. Split refusals across tests.
 *
 * Under RLS most cross-org statements are FILTERED, not refused (executed on
 * PostgreSQL 18.3):
 *     select                              -> own rows only, no error
 *     update                              -> rowCount 0, no error
 *     delete                              -> rowCount 0, no error
 *     insert carrying a foreign org_id    -> 42501 "new row violates row-level security policy"
 *     update that MOVES org_id            -> 42501 (WITH CHECK)
 * Assert the zero-row cases with rowCount/length; assert 42501 only on the INSERT.
 */
export async function withRollback(fn: (c: Client) => Promise<void>): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'tests/db/_fixtures.ts: TEST_DATABASE_URL is not set. Local dev: docs/local-postgres.md. CI: the postgres:18 service container sets it.',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/_fixtures.ts: TEST_DATABASE_URL points at a Supabase host. D-04: the cloud project is production only and is never a test target.',
    );
  }
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await c.connect();
  try {
    await c.query('begin');
    await fn(c);
  } finally {
    await c.query('rollback');
    await c.end();
  }
}

/** Clerk session token v1 (flat org_id) and v2 (nested `o`). The suite exercises BOTH (D-11). */
export type Claims =
  | { org_id: string; sub?: string; role?: 'authenticated' }
  | { o: { id: string; rol?: string; slg?: string }; sub?: string; role?: 'authenticated' };

/** Simulate an RLS caller. `true` = set_config is transaction-LOCAL and dies with the tx (D-11b). */
export async function actAs(c: Client, claims: Claims): Promise<void> {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query('set local role authenticated');
}

/** Become a role with NO claims — proves a connection that skipped the wrapper is refused. */
export async function actAsRole(c: Client, role: 'app_user' | 'anon'): Promise<void> {
  if (role !== 'app_user' && role !== 'anon') throw new Error('actAsRole: refusing role ' + role);
  await c.query('set local role ' + role);
}

export async function actAsOwner(c: Client): Promise<void> {
  await c.query('reset role');
}

/**
 * Two tenants, always. With one org every RLS bug is invisible: a policy that returns
 * everything and a policy that returns the caller's rows are the same result set.
 * Returns orgs.id (uuid) for clerk_org_id 'org_A' and 'org_B'.
 *
 * Call this BEFORE actAs — it inserts as the connection owner on purpose. `orgs` has no
 * insert policy for `authenticated`, because JIT provisioning goes through the
 * SECURITY DEFINER function app.ensure_org (D-03).
 */
export async function seedTwoOrgs(c: Client): Promise<{ a: string; b: string }> {
  const a = await c.query<{ id: string }>(
    "insert into orgs (clerk_org_id, name_internal, display_name) values ('org_A','Alpha (test)','Alpha') returning id",
  );
  const b = await c.query<{ id: string }>(
    "insert into orgs (clerk_org_id, name_internal, display_name) values ('org_B','Bravo (test)','Bravo') returning id",
  );
  const aid = a.rows[0]?.id;
  const bid = b.rows[0]?.id;
  if (!aid || !bid) throw new Error('seedTwoOrgs: insert returned no row');
  return { a: aid, b: bid };
}

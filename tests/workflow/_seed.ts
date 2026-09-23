import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { periodStart } from '@/lib/budget/period';
import { PRICE_BOOK } from '@/lib/budget/price-book';
import { seedPlacesRun, seedPlacesSpine, type SpineKey } from '../db/_places-fixtures';

/**
 * The workflow lane's world (04-22): a REAL, COMMITTED org in the local test database.
 *
 * The DB lane rolls every test back and swaps `withWorkerOrg` for a savepoint double. Neither
 * works here: the compiled workflow runs its steps from a prebuilt bundle (`vi.mock` does not
 * reach them — 04-RESEARCH spike) and opens its OWN connections through `src/db/client.ts` as
 * the non-owner `app_user`. So the world is seeded by the owner and committed, and
 * `teardownOrg` removes every row of it afterwards.
 *
 * 🔴 A DEDICATED ORG PER WORLD (`clerk_org_id = 'org_wf_<random>'`). The local database is
 * shared with the other lanes and with parallel plans; nothing here touches a row it did not
 * create, and `runs_one_active_per_org` never meets another test's run.
 *
 * 🔴 D-04: the owner URL must be local. The same guard as tests/db/_fixtures.ts.
 */

export const WF_ORG_PREFIX = 'org_wf_';

export async function ownerClient(): Promise<Client> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'tests/workflow/_seed.ts: TEST_DATABASE_URL is not set. Local dev: docs/local-postgres.md. CI: the db job sets it.',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/workflow/_seed.ts: TEST_DATABASE_URL points at a Supabase host. D-04: production is never a test target.',
    );
  }
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await c.connect();
  return c;
}

export type SweepWorld = {
  orgId: string;
  clerkOrgId: string;
  runId: string;
  versionId: string;
  searchId: string;
  /** The queue-time admission hold (queueRun's reservation), reserved under the org's claims. */
  admissionReservationId: string;
  biz: Record<SpineKey, string>;
  input: { runId: string; clerkOrgId: string };
};

/**
 * One committed world: an org, the five `PLACES_SPINE` businesses (through the shipped Overture
 * ingest path), a McAllen × home_services search + version, a `queued` run with
 * `ceiling_requests`, and an admission hold reserved exactly as queueRun reserves it — through
 * `app.reserve_budget` under the org's own claims, never inserted by hand.
 *
 * `capMicroUsd` pre-creates this month's `places` budget period with that cap (otherwise
 * `ensure_budget_period` creates it at the $50 default on the first reserve).
 */
export async function seedSweepWorld(
  c: Client,
  opts: {
    kind?: 'full_sweep' | 'partition' | 'change_check';
    ceilingRequests?: number;
    capMicroUsd?: number;
    admissionHoldMicroUsd?: number;
    /** Runs after the run row exists and before the admission hold, in the same transaction. */
    extra?: (c: Client, orgId: string, runId: string) => Promise<void>;
  } = {},
): Promise<SweepWorld> {
  const clerkOrgId = WF_ORG_PREFIX + randomBytes(6).toString('hex');
  await c.query('begin');
  try {
    const org = await c.query<{ id: string }>(
      `insert into orgs (clerk_org_id, name_internal, display_name)
       values ($1, $2, 'Workflow lane') returning id`,
      [clerkOrgId, `${clerkOrgId} (workflow lane)`],
    );
    const orgId = org.rows[0]!.id;
    const period = periodStart(new Date());
    if (opts.capMicroUsd !== undefined) {
      await c.query(
        `insert into budget_periods (org_id, provider, period_start, cap_micro_usd)
         values ($1, 'places', $2::date, $3)`,
        [orgId, period, opts.capMicroUsd],
      );
    }
    const biz = await seedPlacesSpine(c, orgId);
    const run = await seedPlacesRun(c, orgId, {
      status: 'queued',
      kind: opts.kind ?? 'full_sweep',
      ceilingRequests: opts.ceilingRequests ?? 50,
    });
    await opts.extra?.(c, orgId, run.runId);

    // The admission hold, as queueRun takes it: the org's claims, the authenticated role, the
    // meter. Last in the transaction — `set local role` lasts until COMMIT.
    const hold = opts.admissionHoldMicroUsd ?? PRICE_BOOK.ts_enterprise.microUsdPerRequest;
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ o: { id: clerkOrgId } }),
    ]);
    await c.query('set local role authenticated');
    const meter = await c.query<{ reservation_id: string | null }>(
      `select reservation_id
         from app.reserve_budget('places', $1::date, $2::bigint, $3::uuid, 'ts_enterprise')`,
      [period, hold, run.runId],
    );
    const admissionReservationId = meter.rows[0]?.reservation_id;
    if (!admissionReservationId) throw new Error('seedSweepWorld: the admission hold was refused');
    await c.query('commit');
    return {
      orgId,
      clerkOrgId,
      runId: run.runId,
      versionId: run.versionId,
      searchId: run.searchId,
      admissionReservationId,
      biz,
      input: { runId: run.runId, clerkOrgId },
    };
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

/**
 * Deletes EVERY row of one lane org, then the org.
 *
 * Every public base table carrying `org_id` is emptied of this org's rows, read from the
 * catalog rather than listed by hand — a table a later plan adds cannot leak rows into the
 * shared database. `session_replication_role = replica` (transaction-local, the owner is a
 * superuser locally and in CI) switches off the triggers that make `events` and
 * `place_observations` append-only even for the owner, and the event triggers that would
 * otherwise log each delete; the foreign keys it also switches off do not matter, because the
 * org's rows all go in the one transaction. Refuses any org outside the lane's prefix.
 */
export async function teardownOrg(c: Client, orgId: string): Promise<void> {
  const org = await c.query<{ clerk_org_id: string }>(
    'select clerk_org_id from orgs where id = $1',
    [orgId],
  );
  const clerk = org.rows[0]?.clerk_org_id;
  if (clerk === undefined) return;
  if (!clerk.startsWith(WF_ORG_PREFIX)) {
    throw new Error('teardownOrg: refusing to delete an org the workflow lane did not create');
  }
  const tables = await c.query<{ table_name: string }>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'org_id'
        and t.table_type = 'BASE TABLE' and c.table_name <> 'orgs'
      order by c.table_name`,
  );
  await c.query('begin');
  try {
    await c.query('set local session_replication_role = replica');
    for (const { table_name } of tables.rows) {
      await c.query(`delete from public."${table_name.replaceAll('"', '""')}" where org_id = $1`, [
        orgId,
      ]);
    }
    await c.query('delete from orgs where id = $1', [orgId]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

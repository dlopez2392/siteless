/**
 * THE HARNESS THAT IS DELIBERATELY NOT THE ROLLED-BACK ONE.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE DIVERGES, AND WHY YOU MUST NOT "FIX" IT BACK
 *
 * CONVENTIONS § Testing says the rolled-back single-transaction fixture exported by
 * `tests/db/_fixtures.ts` wraps every DB test, and for every other test in this repo that
 * is correct. It cannot express THIS one.
 *
 * That fixture is ONE transaction on ONE connection. The budget meter's whole claim is that
 * N concurrent workers cannot collectively over-reserve past the cap — and a worker can
 * only be stopped by another worker's reservation if it can SEE that reservation, which
 * means the other worker must have COMMITTED. Two statements inside one transaction see
 * each other trivially and prove nothing; two transactions on one connection cannot even
 * run at the same time. So the concurrency proof needs N real connections that really
 * commit, and therefore a cleanup that runs in `finally` instead of a rollback that is free.
 *
 * That is the entire divergence. Everything else — the `TEST_DATABASE_URL` name, the
 * Supabase-host refusal, the 10 s connection timeout — is copied from `tests/db/_fixtures.ts`
 * on purpose, because those guards protect production and are not negotiable here either.
 * The refusal below rejects any supabase.co, supabase.com or pooler.supabase host (D-04).
 *
 * The name of the rollback helper is deliberately not spelled anywhere in this file. A bare
 * token grep is what enforces the divergence — the same arrangement, and for the same
 * reason, as the comment in `src/lib/time.ts`: naming the guarded token inside the guarded
 * file trips the guard and the only way back to green is to delete the check.
 *
 * 🔴 The cleanup MUST NOT delete an `orgs` row (Pitfall 8). `app.log_event`'s AFTER DELETE
 * trigger inserts an `events` row referencing the org that was just deleted, which violates
 * `events_org_id_orgs_id_fk` and leaves the suite wedged. Rolled back, that never bites
 * because nothing commits; a COMMITTING fixture is exactly where it does. So the fixture org
 * is created once, `on conflict do nothing`, and is LEFT IN PLACE forever. Only the burst's
 * own ledger, reservation and budget rows are removed, and only for a provider/period pair
 * no other test uses.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */
import { Client } from 'pg';

/**
 * The dedicated identity of the concurrency fixture. Nothing else in the suite may use
 * these three values — the cleanup below deletes by them, so a second test sharing the pair
 * would have its rows removed underneath it by a burst running in another file.
 */
export const CONCURRENCY_ORG_CLERK_ID = 'org_concurrency_fixture';
export const CONCURRENCY_PROVIDER = 'places_concurrency_fixture';
/** A period start far outside any real budget month, so a burst can never collide with a
 *  fixture that seeds "this month" or with a figure a human is reading off a screen. */
export const CONCURRENCY_PERIOD_START = '2099-01-01';

function resolveUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'tests/db/_concurrency.ts: TEST_DATABASE_URL is not set. Local dev: docs/local-postgres.md. CI: the postgres:18 service container sets it.',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/_concurrency.ts: TEST_DATABASE_URL points at a Supabase host. D-04: the cloud project is production only and is never a test target.',
    );
  }
  return url;
}

/**
 * One real connection. Ten seconds and not pg's default of "forever": an unreachable host
 * otherwise hangs the burst to vitest's ceiling and reports a wall of timeouts instead of
 * the one connection error that names the cause.
 */
export async function openTestClient(): Promise<Client> {
  const c = new Client({ connectionString: resolveUrl(), connectionTimeoutMillis: 10000 });
  await c.connect();
  return c;
}

/**
 * N connections, opened in parallel, then a short settle.
 *
 * 🔴 The settle is load-bearing and is not a flake-hider. `connect()` resolves when the
 * startup exchange completes, but a client still finishing its handshake when the burst
 * fires is not a concurrent worker — it arrives late, finds the cap already taken, and is
 * denied for the wrong reason. The test would still be green and would have proved nothing.
 * 150 ms is enough for every socket on a local server to be genuinely idle-ready.
 *
 * If any connection fails, the ones that succeeded are closed before rethrowing — otherwise
 * a bad URL leaks N-1 live sockets into the rest of the run.
 */
export async function openTestClients(n: number): Promise<Client[]> {
  if (!Number.isInteger(n) || n < 1) throw new Error('openTestClients: n must be a positive integer');

  const settled = await Promise.allSettled(Array.from({ length: n }, () => openTestClient()));
  const opened = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

  if (opened.length !== n) {
    await closeAll(opened);
    const firstError = settled.find((r) => r.status === 'rejected');
    throw new Error(
      `openTestClients: opened ${opened.length} of ${n} connections. ` +
        `First failure: ${firstError && firstError.status === 'rejected' ? String(firstError.reason) : 'unknown'}`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
  return opened;
}

/**
 * End every client, swallowing individual failures.
 *
 * One connection that is already dead must not stop the other 39 from being closed — a
 * throw partway through leaks the remainder and the NEXT test file fails on
 * `too many clients already`, which is a diagnosis nobody enjoys. Always call from a
 * `finally`.
 */
export async function closeAll(clients: Client[]): Promise<void> {
  await Promise.allSettled(clients.map((c) => c.end()));
}

/**
 * A COMMITTING scope. It opens no transaction: the point is that the work inside is visible
 * to other connections.
 *
 * Cleanup runs in `finally` on its own fresh connection, so it still runs when `fn` threw
 * and still runs when `fn` left the burst's connections in a bad state. It deletes the
 * burst's rows in FK order (ledger, then reservations, then the period) and scopes every
 * delete by the dedicated provider/period pair.
 *
 * 🔴 It does not delete the org, and there is a guard below that makes trying to fail
 * loudly rather than mysteriously (Pitfall 8).
 */
export async function withCommittedFixture<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const setup = await openTestClient();
  try {
    // Created once and left in place. `on conflict do nothing` makes a re-run and a first
    // run identical, which matters because the previous run deliberately did not remove it.
    await setup.query(
      `insert into orgs (clerk_org_id, name_internal, display_name)
       values ($1, 'Concurrency fixture (test)', 'Concurrency fixture')
       on conflict (clerk_org_id) do nothing`,
      [CONCURRENCY_ORG_CLERK_ID],
    );
  } finally {
    await setup.end();
  }

  const work = await openTestClient();
  try {
    return await fn(work);
  } finally {
    await work.end();
    await cleanupConcurrencyRows();
  }
}

/** The org id the burst's rows hang off. Resolved rather than assumed, because
 *  `orgs.id` is a `gen_random_uuid()` default and survives across runs. */
export async function concurrencyOrgId(c: Client): Promise<string> {
  const r = await c.query<{ id: string }>('select id from orgs where clerk_org_id = $1', [
    CONCURRENCY_ORG_CLERK_ID,
  ]);
  const id = r.rows[0]?.id;
  if (!id) {
    throw new Error(
      'tests/db/_concurrency.ts: the fixture org is absent. Call withCommittedFixture, which creates it.',
    );
  }
  return id;
}

/**
 * Remove only what the burst wrote, and only for the dedicated provider/period pair.
 *
 * Every statement is guarded by `to_regclass` so this is safe to call before plan 02-03's
 * migrations land: a table that does not exist yet is skipped rather than aborting cleanup
 * and leaving the tables that DO exist full of rows.
 */
export async function cleanupConcurrencyRows(): Promise<void> {
  const c = await openTestClient();
  try {
    const org = await c.query<{ id: string }>('select id from orgs where clerk_org_id = $1', [
      CONCURRENCY_ORG_CLERK_ID,
    ]);
    const orgId = org.rows[0]?.id;
    if (!orgId) return;

    // FK order: ledger rows reference reservations, reservations reference the period.
    const steps: Array<[string, string]> = [
      [
        'cost_ledger',
        `delete from cost_ledger where org_id = $1 and provider = $2`,
      ],
      [
        'cost_reservations',
        `delete from cost_reservations where org_id = $1 and provider = $2`,
      ],
      [
        'budget_periods',
        `delete from budget_periods where org_id = $1 and provider = $2`,
      ],
    ];

    for (const [table, sql] of steps) {
      const exists = await c.query<{ reg: string | null }>('select to_regclass($1) as reg', [
        'public.' + table,
      ]);
      if (!exists.rows[0]?.reg) continue;
      await c.query(sql, [orgId, CONCURRENCY_PROVIDER]);
    }
  } finally {
    await c.end();
  }
}

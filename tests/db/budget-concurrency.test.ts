/**
 * ROADMAP SUCCESS CRITERION 5 — and the ONE test in this repo that COMMITS.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE DOES NOT USE THE ROLLED-BACK FIXTURE, AND WHY YOU MUST NOT "FIX" IT BACK
 *
 * Every other DB test here runs inside the single-transaction fixture in
 * `tests/db/_fixtures.ts`, and for every other test that is correct. It CANNOT express this
 * one. The budget meter's whole claim is that N concurrent workers cannot collectively
 * over-reserve past the cap — and a worker is only stopped by another worker's reservation
 * if it can SEE that reservation, which means the other worker must have COMMITTED. Two
 * statements inside one transaction see each other trivially and prove nothing; two
 * transactions on one connection cannot even run at the same time.
 *
 * So: 40 real `pg.Client` connections through `tests/db/_concurrency.ts`, real commits, and
 * a cleanup in `finally` instead of a rollback that would have been free. That cleanup never
 * deletes the fixture `orgs` row — app.log_event's AFTER DELETE arm would insert an events
 * row referencing the org that was just deleted and violate `events_org_id_orgs_id_fk`
 * (RESEARCH Pitfall 8, hit during research). The org is created `on conflict do nothing` and
 * left in place forever; only the burst's own budget/reservation/ledger/event rows go.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * 🔴 THE CONTROL IS WHAT MAKES THIS A PROOF. Gate mutation M7 swaps the meter's single
 * conditional UPDATE for the naive read-then-decide-then-update body. Under the IDENTICAL
 * burst, research measured that body granting 40 of 40 and reserving 400 against a cap of
 * 100 — a 4x over-spend — while every single-worker test in `tests/db/budget-meter.test.ts`
 * stayed green. A green suite proves nothing a mutation check hasn't.
 */
import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  CONCURRENCY_ORG_CLERK_ID,
  CONCURRENCY_PERIOD_START,
  CONCURRENCY_PROVIDER,
  closeAll,
  concurrencyOrgId,
  openTestClients,
  withCommittedFixture,
} from './_concurrency';

/** 40 workers, a cap of 100 µUSD, 10 µUSD each: the cap fits exactly ten of them. */
const N = 40;
const CAP = 100;
const UNIT = 10;
const EXPECTED_GRANTS = CAP / UNIT;
const SKU = 'ts_enterprise';

const CLAIMS = JSON.stringify({
  o: { id: CONCURRENCY_ORG_CLERK_ID },
  sub: 'user_burst',
  role: 'authenticated',
});

/**
 * Session-scoped, not transaction-scoped: these connections issue one autocommitted
 * statement each, so there is no transaction for a `local` setting to live in.
 */
async function becomeTenant(c: Client): Promise<void> {
  await c.query("select set_config('request.jwt.claims', $1, false)", [CLAIMS]);
  await c.query('set role authenticated');
}

/** The budget row the burst competes over, inserted as the OWNER and COMMITTED. */
async function seedPeriod(c: Client, orgId: string, reserved = 0): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into budget_periods (org_id, provider, period_start, cap_micro_usd, reserved_micro_usd)
     values ($1, $2, $3, $4, $5) returning id`,
    [orgId, CONCURRENCY_PROVIDER, CONCURRENCY_PERIOD_START, CAP, reserved],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('seedPeriod: insert returned no row');
  return id;
}

type Outcome = { granted: boolean; error: string | null };

/** Fire all N reserves at once and tally. A DENIAL is a row whose reservation_id is null —
 *  never an exception — so an entry in `errors` is always a real failure. */
async function burst(clients: Client[]): Promise<Outcome[]> {
  return Promise.all(
    clients.map(async (c): Promise<Outcome> => {
      try {
        const r = await c.query<{ reservation_id: string | null }>(
          'select reservation_id from app.reserve_budget($1, $2, $3, null, $4)',
          [CONCURRENCY_PROVIDER, CONCURRENCY_PERIOD_START, UNIT, SKU],
        );
        return { granted: r.rows[0]?.reservation_id != null, error: null };
      } catch (e) {
        return { granted: false, error: String(e) };
      }
    }),
  );
}

type Totals = { reserved: string; spent: string; cap: string };

async function totals(c: Client, periodId: string): Promise<Totals> {
  const r = await c.query<Totals>(
    `select reserved_micro_usd::text as reserved,
            spent_micro_usd::text    as spent,
            cap_micro_usd::text      as cap
       from budget_periods where id = $1`,
    [periodId],
  );
  const row = r.rows[0];
  if (!row) throw new Error('totals: no budget_periods row');
  return row;
}

describe('the budget meter under genuine concurrency', () => {
  it('concurrent burst: 40 workers against a cap that fits 10', () =>
    withCommittedFixture(async (c) => {
      const orgId = await concurrencyOrgId(c);
      const period = await seedPeriod(c, orgId);

      const clients = await openTestClients(N);
      try {
        await Promise.all(clients.map(becomeTenant));
        const started = Date.now();
        const outcomes = await burst(clients);
        const elapsed = Date.now() - started;

        const granted = outcomes.filter((o) => o.granted).length;
        const errors = outcomes.filter((o) => o.error !== null).map((o) => o.error);
        const denied = outcomes.length - granted - errors.length;
        const after = await totals(c, period);
        console.log(
          `[burst] N=${N} cap=${CAP} unit=${UNIT} -> granted=${granted} denied=${denied} ` +
            `errors=${errors.length} reserved=${after.reserved} spent=${after.spent} in ${elapsed}ms`,
        );

        // 4. Zero errors, asserted FIRST and by content, so a connection failure or a
        //    deadlock names itself instead of hiding inside a wrong count.
        expect(errors).toEqual([]);
        // 1 and 2. Ten granted, thirty refused. A refusal is a row with a null id.
        expect(granted).toBe(EXPECTED_GRANTS);
        expect(denied).toBe(N - EXPECTED_GRANTS);
        // 3. TWO-SIDED ON PURPOSE. `reserved + spent === cap` catches the over-spend M7
        //    reproduces (400 against a cap of 100) AND the under-grant that a meter
        //    refusing everybody would produce — which would satisfy "never over cap"
        //    perfectly while making the product useless.
        expect(Number(after.reserved) + Number(after.spent)).toBe(CAP);
        expect(after.cap).toBe(String(CAP));
      } finally {
        await closeAll(clients);
      }
    }));

  it('concurrent burst: open reservations equal the grants', () =>
    withCommittedFixture(async (c) => {
      const orgId = await concurrencyOrgId(c);
      const period = await seedPeriod(c, orgId);

      const clients = await openTestClients(N);
      try {
        await Promise.all(clients.map(becomeTenant));
        const outcomes = await burst(clients);
        expect(outcomes.filter((o) => o.error !== null)).toEqual([]);

        // The budget row's counter and the reservation rows are two different records of the
        // same decision. If a grant could increment the counter without writing its row (or
        // the reverse), the balance and the audit trail would disagree and the self-heal
        // would have nothing to reclaim.
        const open = await c.query<{ n: number }>(
          `select count(*)::int as n from cost_reservations
            where budget_period_id = $1 and settled_at is null and released_at is null`,
          [period],
        );
        expect(open.rows[0]?.n).toBe(EXPECTED_GRANTS);
        expect(outcomes.filter((o) => o.granted).length).toBe(EXPECTED_GRANTS);
      } finally {
        await closeAll(clients);
      }
    }));

  it('concurrent burst survives a crashed worker holding the whole cap', () =>
    withCommittedFixture(async (c) => {
      const orgId = await concurrencyOrgId(c);
      // Five workers took the ENTIRE cap and died: reserved is 100 of 100 and every one of
      // those claims is past its TTL. Without the self-heal this org is finished for the
      // period, and no scheduler is coming (that is the point of putting the release on the
      // reserve path). This is RESEARCH Pattern 2 under concurrency rather than in isolation.
      const period = await seedPeriod(c, orgId, CAP);
      for (let i = 0; i < 5; i++) {
        await c.query(
          `insert into cost_reservations (org_id, budget_period_id, sku, est_micro_usd, expires_at)
           values ($1, $2, $3, $4, now() - interval '1 hour')`,
          [orgId, period, SKU, CAP / 5],
        );
      }

      const clients = await openTestClients(N);
      try {
        await Promise.all(clients.map(becomeTenant));
        const outcomes = await burst(clients);

        const granted = outcomes.filter((o) => o.granted).length;
        const errors = outcomes.filter((o) => o.error !== null).map((o) => o.error);
        const after = await totals(c, period);
        const released = await c.query<{ n: number }>(
          `select count(*)::int as n from cost_reservations
            where budget_period_id = $1 and est_micro_usd = $2 and released_at is not null`,
          [period, CAP / 5],
        );
        console.log(
          `[burst/self-heal] granted=${granted} errors=${errors.length} ` +
            `reserved=${after.reserved} released=${released.rows[0]?.n}`,
        );

        expect(errors).toEqual([]);
        // Exactly ten again — not zero (the healer never ran) and not forty (it released the
        // budget and then let everybody through).
        expect(granted).toBe(EXPECTED_GRANTS);
        expect(Number(after.reserved) + Number(after.spent)).toBe(CAP);
        expect(released.rows[0]?.n).toBe(5);
      } finally {
        await closeAll(clients);
      }
    }));

  // A-WR-08. settle_reservation read the hold WITHOUT a lock and computed "how much is still
  // held" from that snapshot. A release (release_reservation, or the page-view self-heal
  // release_expired_reservations) committing between the settle's read and its update freed the
  // hold, and the settle then subtracted it AGAIN: with no other hold, reserved went negative,
  // bp_non_negative raised, the exception block swallowed it and rolled back the whole balance
  // update — spent_micro_usd missed a real charge. Phase 4's settleInFlight settles exactly at
  // the TTL edge, where the self-heal races it. The settle now locks the reservation at the
  // read (0030), so it waits for the release and sees it.
  //
  // Deterministic, not a timing race: the release holds its row lock in an OPEN transaction,
  // the settle is started and observed WAITING on a lock (pg_stat_activity), and only then does
  // the release commit.
  it('a settle racing a release of the same hold counts the hold once', () =>
    withCommittedFixture(async (c) => {
      const orgId = await concurrencyOrgId(c);
      const HOLD = 40;
      const ACTUAL = 25;
      const period = await seedPeriod(c, orgId, HOLD);
      const r = await c.query<{ id: string }>(
        `insert into cost_reservations (org_id, budget_period_id, sku, est_micro_usd, expires_at)
         values ($1, $2, $3, $4, now() + interval '10 minutes') returning id`,
        [orgId, period, SKU, HOLD],
      );
      const reservation = r.rows[0]!.id;

      const [releaser, settler] = await openTestClients(2);
      try {
        await becomeTenant(releaser!);
        await becomeTenant(settler!);
        const pid = (await settler!.query<{ pid: number }>('select pg_backend_pid() as pid'))
          .rows[0]!.pid;

        await releaser!.query('begin');
        const freed = await releaser!.query<{ freed: string }>(
          'select app.release_reservation($1)::text as freed',
          [reservation],
        );
        expect(freed.rows[0]?.freed).toBe(String(HOLD));

        await settler!.query('begin');
        const settling = settler!.query<{ ok: boolean }>(
          'select app.settle_reservation($1, $2, $3, 1, $4, $5) as ok',
          [reservation, 'a-wr-08-race-attempt-1', ACTUAL, SKU, CONCURRENCY_PROVIDER],
        );
        // Wait until the settle is BLOCKED on the release's row lock — otherwise the test
        // would not be exercising the interleaving at all.
        const deadline = Date.now() + 10_000;
        for (;;) {
          const w = await c.query<{ wait: string | null }>(
            'select wait_event_type as wait from pg_stat_activity where pid = $1',
            [pid],
          );
          if (w.rows[0]?.wait === 'Lock') break;
          if (Date.now() > deadline) throw new Error('the settle never waited on the release');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await releaser!.query('commit');
        const settled = await settling;
        await settler!.query('commit');
        expect(settled.rows[0]?.ok).toBe(true);

        // The hold left `reserved` exactly once (the release), and the charge is in `spent`.
        const after = await totals(c, period);
        expect({ reserved: after.reserved, spent: after.spent }).toEqual({
          reserved: '0',
          spent: String(ACTUAL),
        });
        // And nothing fell back to the overrun path.
        const overrun = await c.query<{ n: number }>(
          `select count(*)::int as n from events where org_id = $1 and action = 'budget_overrun'`,
          [orgId],
        );
        expect(overrun.rows[0]?.n).toBe(0);
        const ledger = await c.query<{ n: number; micro: string }>(
          `select count(*)::int as n, coalesce(sum(micro_usd), 0)::text as micro
             from cost_ledger where reservation_id = $1`,
          [reservation],
        );
        expect(ledger.rows[0]).toEqual({ n: 1, micro: String(ACTUAL) });
      } finally {
        await closeAll([releaser!, settler!]);
      }
    }));

  it('the fixture cleans up after itself and leaves the org in place', () =>
    withCommittedFixture(async (c) => {
      // A committing test is only safe if its cleanup is itself verified. This runs LAST in
      // the file and asserts the shape the previous three depend on: the burst's rows are
      // scoped to a dedicated org + provider + period, and the org row is deliberately NOT
      // among the things that get deleted.
      const orgId = await concurrencyOrgId(c);
      expect(orgId).toBeTruthy();
      const scoped = await c.query<{ n: number }>(
        `select count(*)::int as n from budget_periods
          where org_id = $1 and provider = $2 and period_start = $3`,
        [orgId, CONCURRENCY_PROVIDER, CONCURRENCY_PERIOD_START],
      );
      // Zero, because the PREVIOUS test's finally already ran. That is the cleanup being
      // observed from outside rather than assumed.
      expect(scoped.rows[0]?.n).toBe(0);
    }));
});

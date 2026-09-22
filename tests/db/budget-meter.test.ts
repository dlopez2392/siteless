/**
 * BUDG-01 / BUDG-02 — the meter's SINGLE-WORKER invariants.
 *
 * The concurrency claim lives in `tests/db/budget-concurrency.test.ts` and needs real
 * committed connections; everything below is expressible in ONE transaction and therefore
 * belongs in the rolled-back fixture. The split is deliberate: gate mutation M7 (the naive
 * check-then-spend body) must red the burst while EVERY test in this file stays green —
 * that is what proves the two files are not redundant with one another.
 *
 * Mutations this file is the watched-red target of (each applied to the LIVE database, never
 * to the migration file, so the revert is provable by `git diff --stat`):
 *
 *   M8  `alter table budget_periods drop constraint bp_not_over`
 *          reds `bp_not_over refuses a hand-written over-reserve`
 *           and `cap below current spend is refused`
 *          leaves `cap at exactly spent plus reserved is accepted` GREEN
 *   M9  `alter table cost_ledger drop constraint cost_ledger_request_id_key`
 *          reds `settlement idempotency: settle twice with one request_id` and only that
 *   M-self-heal  `create or replace function app.reserve_budget(...)` with step 1 removed
 *          reds `self-heal: a crashed worker's expired reservations are released by the
 *          next reserve` and only that; `self-heal does not release a live reservation`
 *          stays GREEN, because a healer that released everything would pass the first alone
 *
 * One refused statement per `withRollback` (a refusal aborts the transaction and the next
 * statement reports 25P02, not its own reason), two orgs always, and a positive control
 * beside every refusal. CONVENTIONS § Testing.
 */
import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { actAs, actAsOwner, seedTwoOrgs, withRollback } from './_fixtures';

const ORG_A_CLAIMS = { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' } as const;

/** One of the three providers `bp_provider_known` admits. Not a free-form string. */
const PROVIDER = 'places';
/** A fixed period. Every test here rolls back, so it never collides with anything. */
const PERIOD = '2026-09-01';
const SKU = 'ts_enterprise';

/**
 * The fixture row, inserted as the OWNER: `authenticated` holds SELECT and nothing else on
 * budget_periods (migration 0015), so a tenant cannot create its own period by hand — in
 * production app.ensure_budget_period does it inside a definer.
 *
 * Every money figure is micro-USD (1 µUSD = $0.000001), and every one is a bigint, so it
 * comes back through pg as a STRING. Read them as text in SQL rather than comparing the
 * driver's rendering.
 */
async function seedPeriod(
  c: Client,
  orgId: string,
  opts: { cap: number; spent?: number; reserved?: number },
): Promise<string> {
  await actAsOwner(c);
  const r = await c.query<{ id: string }>(
    `insert into budget_periods
       (org_id, provider, period_start, cap_micro_usd, spent_micro_usd, reserved_micro_usd)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [orgId, PROVIDER, PERIOD, opts.cap, opts.spent ?? 0, opts.reserved ?? 0],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('seedPeriod: insert returned no row');
  return id;
}

type Totals = { cap: string; reserved: string; spent: string; warned: string | null };

async function totals(c: Client, periodId: string): Promise<Totals> {
  const r = await c.query<Totals>(
    `select cap_micro_usd::text as cap,
            reserved_micro_usd::text as reserved,
            spent_micro_usd::text as spent,
            extract(epoch from warned_80_at)::text as warned
       from budget_periods where id = $1`,
    [periodId],
  );
  const row = r.rows[0];
  if (!row) throw new Error('totals: no budget_periods row');
  return row;
}

type ReserveRow = {
  reservation_id: string | null;
  pct_after: string | null;
  at_80: boolean;
  at_100: boolean;
};

/** The meter's public shape: one row, always. A DENIAL is a row whose reservation_id is
 *  null — never an exception, which is why nothing here is wrapped in a try. */
async function reserve(c: Client, micro: number): Promise<ReserveRow> {
  const r = await c.query<ReserveRow>(
    'select reservation_id, pct_after::text as pct_after, at_80, at_100 ' +
      'from app.reserve_budget($1, $2, $3, null, $4)',
    [PROVIDER, PERIOD, micro, SKU],
  );
  expect(r.rows).toHaveLength(1);
  const row = r.rows[0];
  if (!row) throw new Error('reserve: no row');
  return row;
}

async function countReservations(c: Client, periodId: string): Promise<number> {
  const r = await c.query<{ n: number }>(
    'select count(*)::int as n from cost_reservations where budget_period_id = $1',
    [periodId],
  );
  return r.rows[0]?.n ?? -1;
}

describe('the budget meter, one worker at a time', () => {
  it('reserve: a grant returns a reservation id and moves reserved', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 100000 });
      await actAs(c, ORG_A_CLAIMS);

      const row = await reserve(c, 10000);
      expect(row.reservation_id).toBeTruthy();
      expect(row.at_80).toBe(false);
      expect(row.at_100).toBe(false);
      expect(row.pct_after).toBe('10.0');

      expect(await totals(c, period)).toMatchObject({ reserved: '10000', spent: '0' });

      // The reservation row itself: the estimate, unsettled, and a TTL in the future — the
      // three fields the self-heal below turns on.
      const res = await c.query<{ est: string; settled: boolean; future: boolean }>(
        `select est_micro_usd::text as est,
                (settled_at is not null) as settled,
                (expires_at > now())    as future
           from cost_reservations where id = $1`,
        [row.reservation_id],
      );
      expect(res.rows[0]).toEqual({ est: '10000', settled: false, future: true });
    }));

  it('denied returns null: a denial is zero rows, not an exception', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 10000, spent: 10000 });
      await actAs(c, ORG_A_CLAIMS);

      // The whole design point: there is NOTHING TO CATCH. `reserve` would reject and fail
      // this test if the meter raised, so the absence of a try/catch here is the assertion.
      const row = await reserve(c, 10000);
      expect(row.reservation_id).toBeNull();
      expect(row.at_100).toBe(true);
      expect(row.pct_after).toBe('100.0');

      // A denial writes nothing at all — not a released row, not a zero-value one.
      expect(await countReservations(c, period)).toBe(0);
      expect(await totals(c, period)).toMatchObject({ reserved: '0', spent: '10000' });
    }));

  it('bp_not_over refuses a hand-written over-reserve', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 10000 });

      // As the OWNER, with the meter function bypassed entirely: the constraint refuses a
      // breach even when the SQL is hand-written, and even when a bug inside the definer
      // function computes the wrong total. That is why it is the SECOND wall (T-2-07).
      const attempt = c.query(
        'update budget_periods set reserved_micro_usd = cap_micro_usd + 1 where id = $1',
        [period],
      );
      await expect(attempt).rejects.toMatchObject({ code: '23514' });
      // The name, not just the code: 23514 also covers bp_non_negative, cr_est_positive,
      // cl_micro_non_negative and bp_provider_known on these same tables.
      await expect(attempt).rejects.toThrow(/bp_not_over/);
    }));

  it('cap at exactly spent plus reserved is accepted', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 5000, spent: 1200, reserved: 400 });

      // The positive control for the refusal below, boundary-exact. Without it, a
      // constraint that refused EVERY cap change would pass that test.
      const ok = await c.query('update budget_periods set cap_micro_usd = 1600 where id = $1', [
        period,
      ]);
      expect(ok.rowCount).toBe(1);
      expect(await totals(c, period)).toMatchObject({ cap: '1600' });
    }));

  it('cap below current spend is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 5000, spent: 1200, reserved: 400 });

      // 🔴 THE TRUE FLOOR IS spent + reserved (1600), which is TIGHTER than UI-SPEC's copy
      // ("at least {spent + $1}" — 1201 here). The reserved half is invisible to that
      // sentence. Do NOT "fix" bp_not_over to match the copy: the money already promised to
      // in-flight calls is committed spend that simply has not landed in the ledger yet.
      // Fix the copy instead.
      const attempt = c.query('update budget_periods set cap_micro_usd = 1599 where id = $1', [
        period,
      ]);
      await expect(attempt).rejects.toMatchObject({ code: '23514' });
      await expect(attempt).rejects.toThrow(/bp_not_over/);
    }));

  it("self-heal: a crashed worker's expired reservations are released by the next reserve", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // Five workers took the WHOLE cap and died. reserved is 100000 and no scheduler is
      // coming: without the self-heal this org can never spend another cent this period.
      const period = await seedPeriod(c, a, { cap: 100000, reserved: 100000 });
      for (let i = 0; i < 5; i++) {
        await c.query(
          `insert into cost_reservations (org_id, budget_period_id, sku, est_micro_usd, expires_at)
           values ($1, $2, $3, 20000, now() - interval '1 hour')`,
          [a, period, SKU],
        );
      }

      await actAs(c, ORG_A_CLAIMS);
      const row = await reserve(c, 10000);
      expect(row.reservation_id).toBeTruthy();

      const released = await c.query<{ n: number }>(
        `select count(*)::int as n from cost_reservations
          where budget_period_id = $1 and est_micro_usd = 20000 and released_at is not null`,
        [period],
      );
      expect(released.rows[0]?.n).toBe(5);
      // 100000 freed, 10000 newly taken. Not 110000, and not 0.
      expect(await totals(c, period)).toMatchObject({ reserved: '10000' });
    }));

  it('self-heal does not release a live reservation', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 10000, reserved: 10000 });
      const live = await c.query<{ id: string }>(
        `insert into cost_reservations (org_id, budget_period_id, sku, est_micro_usd, expires_at)
         values ($1, $2, $3, 10000, now() + interval '1 hour') returning id`,
        [a, period, SKU],
      );
      const liveId = live.rows[0]?.id;
      expect(liveId).toBeTruthy();

      await actAs(c, ORG_A_CLAIMS);
      // The other half of the pair. A healer that released EVERYTHING — the obvious wrong
      // implementation — passes the test above and fails here: an in-flight paid call would
      // have its budget handed to somebody else and the cap would be breached for real.
      const row = await reserve(c, 10000);
      expect(row.reservation_id).toBeNull();
      expect(row.at_100).toBe(true);

      const still = await c.query<{ released: boolean }>(
        'select (released_at is not null) as released from cost_reservations where id = $1',
        [liveId],
      );
      expect(still.rows[0]?.released).toBe(false);
      expect(await totals(c, period)).toMatchObject({ reserved: '10000' });
    }));

  it('threshold: the 80 percent crossing emits exactly one events row per period', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 5000, spent: 3900 });
      await actAs(c, ORG_A_CLAIMS);

      const warnings = async (): Promise<number> => {
        const r = await c.query<{ n: number }>(
          `select count(*)::int as n from events
            where entity_type = 'budget_periods'
              and action = 'budget_80_percent'
              and entity_id = $1`,
          [period],
        );
        return r.rows[0]?.n ?? -1;
      };

      const first = await reserve(c, 200);
      expect(first.reservation_id).toBeTruthy();
      expect(first.pct_after).toBe('82.0');
      expect(first.at_80).toBe(true);
      expect(first.at_100).toBe(false);
      expect(await warnings()).toBe(1);
      const afterFirst = await totals(c, period);
      expect(afterFirst.warned).not.toBeNull();

      // The SECOND reserve is the whole test. "Once per period" is only a claim until a
      // caller already past 80 % reserves again: an implementation that emits on every
      // reserve past the line passes everything above and writes an events row per paid
      // call from here to the end of the month.
      const second = await reserve(c, 100);
      expect(second.reservation_id).toBeTruthy();
      expect(second.at_80).toBe(true);
      expect(await warnings()).toBe(1);
      const afterSecond = await totals(c, period);
      expect(afterSecond.warned).toBe(afterFirst.warned);
    }));

  it('threshold: at 100 percent every new reservation is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 5000, spent: 5000 });
      await actAs(c, ORG_A_CLAIMS);

      const row = await reserve(c, 1);
      expect(row.reservation_id).toBeNull();
      expect(row.at_100).toBe(true);
      expect(await countReservations(c, period)).toBe(0);
    }));

  it('settlement idempotency: settle twice with one request_id', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 100000 });
      await actAs(c, ORG_A_CLAIMS);
      const granted = await reserve(c, 10000);
      expect(granted.reservation_id).toBeTruthy();

      const settle = async (): Promise<boolean> => {
        const r = await c.query<{ ok: boolean }>(
          'select app.settle_reservation($1, $2, $3, $4, $5, $6) as ok',
          [granted.reservation_id, 'req-abc', 7000, 1, SKU, PROVIDER],
        );
        return r.rows[0]?.ok === true;
      };

      expect(await settle()).toBe(true);
      // 🔴 A REPLAY, NOT AN ERROR. A retried workflow step must converge, not explode — so
      // the second call returns false and moves nothing. All three consequences below are
      // asserted separately: a "return false" that still moved the balance would be worse
      // than a throw, because it would look like it worked.
      expect(await settle()).toBe(false);

      const ledger = await c.query<{ n: number }>(
        "select count(*)::int as n from cost_ledger where request_id = 'req-abc'",
      );
      expect(ledger.rows[0]?.n).toBe(1);
      // 10000 -> 0 once, not twice (twice would be -10000 and bp_non_negative would abort);
      // 7000 spent once, not 14000.
      expect(await totals(c, period)).toMatchObject({ reserved: '0', spent: '7000' });
    }));

  it('settlement: reserve the worst case, settle the actual', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, { cap: 100000 });
      await actAs(c, ORG_A_CLAIMS);
      const granted = await reserve(c, 10000);

      // Reserving one page and discovering three is the only way to breach the cap, so the
      // reservation is the PESSIMISTIC estimate and the ledger is the actual. The 3000
      // difference has to come back, or a month of over-estimates silently shrinks the cap.
      const r = await c.query<{ ok: boolean }>(
        'select app.settle_reservation($1, $2, $3, $4, $5, $6) as ok',
        [granted.reservation_id, 'req-true-up', 7000, 1, SKU, PROVIDER],
      );
      expect(r.rows[0]?.ok).toBe(true);
      expect(await totals(c, period)).toMatchObject({ reserved: '0', spent: '7000' });
    }));

  it('settlement: a zero-cost paid-SKU call still writes a ledger row', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await seedPeriod(c, a, { cap: 100000 });
      await actAs(c, ORG_A_CLAIMS);
      const granted = await reserve(c, 10000);

      // 🔴 p_actual_micro = 0 is LEGITIMATE: the call was inside Google's monthly free
      // allowance. Without these rows the allowance is untrackable and every early-month
      // estimate is wrong (RESEARCH Pitfall 4). A "don't write zero-cost rows" optimisation
      // is the defect this test exists to catch.
      const r = await c.query<{ ok: boolean }>(
        'select app.settle_reservation($1, $2, $3, $4, $5, $6) as ok',
        [granted.reservation_id, 'req-free-tier', 0, 1, SKU, PROVIDER],
      );
      expect(r.rows[0]?.ok).toBe(true);

      const row = await c.query<{ micro: string; units: number; cents: string }>(
        `select micro_usd::text as micro, units, cost_cents::text as cents
           from cost_ledger where request_id = 'req-free-tier'`,
      );
      expect(row.rows[0]).toEqual({ micro: '0', units: 1, cents: '0.00' });
    }));

  it('cost_cents renders micro-USD exactly', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await seedPeriod(c, a, { cap: 100000 });
      await actAs(c, ORG_A_CLAIMS);
      const granted = await reserve(c, 35000);
      await c.query('select app.settle_reservation($1, $2, $3, $4, $5, $6)', [
        granted.reservation_id,
        'req-one-enterprise-call',
        35000,
        1,
        SKU,
        PROVIDER,
      ]);

      const row = await c.query<{ cents: string }>(
        "select cost_cents::text as cents from cost_ledger where request_id = 'req-one-enterprise-call'",
      );
      // 35,000 µUSD is one Text Search Enterprise request at $35.00 / 1,000.
      expect(row.rows[0]?.cents).toBe('3.50');

      // And the reason the column is numeric(12,2) over a bigint rather than integer cents:
      // 1,428 of these is the whole $50 cap. Integer cents would render $57.12 (rounding
      // each row up to 4c) or $42.84 (down to 3c) — both wrong by more than $7 on a $50
      // budget, which is the difference between "under cap" and "over".
      const sum = await c.query<{ usd: string; exact: boolean }>(
        `select ((35000::bigint * 1428) / 10000.0)::numeric(12,2)::text as usd,
                ((35000::bigint * 1428) / 10000.0) = 4998 as exact`,
      );
      // Two assertions, because they say different things. `exact` is the arithmetic: the
      // division carries no remainder at all. `usd` is the RENDERING, cast to cost_cents's
      // own numeric(12,2) — a bare ::text on the division returns 4998.0000000000000000,
      // which is the same money and not the same string, and the UI reads the column.
      expect(sum.rows[0]?.exact).toBe(true);
      expect(sum.rows[0]?.usd).toBe('4998.00');
    }));

  it('server version: the test database is at least PostgreSQL 17', () =>
    withRollback(async (c) => {
      // Production is Supabase 17.6 while this machine and CI are 18. The companion guard
      // is the `pg17` grep over drizzle/*.sql (tests/unit/pg17-compat.test.ts): that one
      // catches 18-only SYNTAX in a migration, this one catches a test database older than
      // production, where a migration could pass here and fail there.
      const r = await c.query<{ num: number; ok: boolean }>(
        `select current_setting('server_version_num')::int as num,
                current_setting('server_version_num')::int >= 170000 as ok`,
      );
      expect(r.rows[0]?.ok).toBe(true);
      expect(r.rows[0]?.num).toBeGreaterThanOrEqual(170000);
    }));
});

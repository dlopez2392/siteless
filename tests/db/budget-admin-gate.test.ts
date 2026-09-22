/**
 * D-10 / T-2-02 — the cap is admin-only IN THE DATABASE, against both Clerk role spellings.
 * Plus T-2-11 (a cap change is audited, a reservation is not) and D-11 (the Chicago month,
 * proven in SQL by a pair with opposite verdicts).
 *
 * 🔴 TWO REFUSALS THAT MUST NEVER SHARE A TEST. A member is stopped twice over, by two
 * different invariants:
 *
 *   the FUNCTION  app.set_budget_cap   -> 42501 'set_budget_cap: admin role required'
 *   the GRANT     budget_periods       -> 42501 'permission denied for table budget_periods'
 *
 * Same SQLSTATE, different guard. Only the MESSAGE tells them apart, and if one test covered
 * both then one mutation would red both and the mutation check would stop telling you which
 * guard you broke. Hence two tests, each with its own positive control:
 *
 *   M10  `create or replace function app.current_org_role() ... select 'admin'`
 *          reds `set_budget_cap refuses a member` and `current_org_role returns null for a
 *          member`; `set_budget_cap accepts an admin` stays GREEN
 *   MGRANT `grant update on public.budget_periods to authenticated`
 *          reds `budget_periods holds no direct UPDATE for authenticated` ALONE
 *
 * One refused statement per `withRollback`; two orgs always. CONVENTIONS § Testing.
 */
import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { actAs, actAsOwner, seedTwoOrgs, withRollback } from './_fixtures';

const PROVIDER = 'places';
const SKU = 'ts_enterprise';

/** Clerk session token v2: the org claim is nested and the role is BARE. */
const V2_ADMIN = { o: { id: 'org_A', rol: 'admin' }, sub: 'user_danlo', role: 'authenticated' } as const;
const V2_MEMBER = {
  o: { id: 'org_A', rol: 'basic_member' },
  sub: 'user_member',
  role: 'authenticated',
} as const;
/** Clerk session token v1: the org claim is flat and the role carries the `org:` PREFIX. */
const V1_ADMIN = {
  org_id: 'org_A',
  org_role: 'org:admin',
  sub: 'user_danlo',
  role: 'authenticated',
} as const;

/** The month the cap actually lands in, computed the way the function computes it. */
const CHICAGO_MONTH = "(date_trunc('month', now() at time zone 'America/Chicago'))::date";

async function currentRole(c: Client): Promise<string | null> {
  const r = await c.query<{ role: string | null }>('select app.current_org_role() as role');
  return r.rows[0]?.role ?? null;
}

/** Inserted as the OWNER: `authenticated` holds SELECT and nothing else on budget_periods. */
async function seedPeriod(
  c: Client,
  orgId: string,
  cap: number,
  reserved = 0,
): Promise<string> {
  await actAsOwner(c);
  const r = await c.query<{ id: string }>(
    `insert into budget_periods (org_id, provider, period_start, cap_micro_usd, reserved_micro_usd)
     values ($1, $2, ${CHICAGO_MONTH}, $3, $4) returning id`,
    [orgId, PROVIDER, cap, reserved],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('seedPeriod: insert returned no row');
  return id;
}

describe('the cap is admin-only in the database', () => {
  it('current_org_role resolves the v2 bare claim', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      // 🔴 v2 nests the BARE role under o.rol. Read out of danlo's real stored session
      // token, 2026-09-22 — not inferred from Clerk's documentation.
      await actAs(c, V2_ADMIN);
      expect(await currentRole(c)).toBe('admin');
    }));

  it('current_org_role resolves the v1 prefixed claim', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      // 🔴 v1 carries 'org:admin' FLAT, and @clerk/shared rebuilds exactly that string for
      // auth().orgRole — so the TypeScript side sees 'org:admin' while SQL sees 'admin' out
      // of the very same token. A naive
      //     coalesce(app.jwt()->'o'->>'rol', app.jwt()->>'org_role')
      // compares 'admin' to 'org:admin' and the admin gate then silently passes or silently
      // fails depending on which side was written first. This is the exact sibling of Phase
      // 1's D-11, the single highest-probability silent failure in that build, which is why
      // each spelling gets its own named test rather than a loop over both.
      await actAs(c, V1_ADMIN);
      expect(await currentRole(c)).toBe('admin');
    }));

  it('current_org_role returns null for a member', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      // Both halves, because a function returning the constant 'admin' — mutation M10 —
      // must fail here, and so must one returning a constant null.
      await actAs(c, V2_MEMBER);
      expect(await currentRole(c)).toBe('basic_member');

      await actAs(c, { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' });
      // Not '' — the nullif collapses the empty string `replace` produces from an absent
      // claim, so "no role" is NULL and never a falsy string that `is distinct from 'admin'`
      // would still let through.
      expect(await currentRole(c)).toBeNull();
    }));

  it('set_budget_cap refuses a member', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAs(c, V2_MEMBER);

      const attempt = c.query('select app.set_budget_cap($1, $2)', [PROVIDER, 75000000]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      // 🔴 PIN THE MESSAGE. 42501 also covers the grant refusal below and an RLS refusal;
      // only the wording tells the three apart, and the role check is deliberately the FIRST
      // statement in the function so a member never gets an org or provider error that
      // would leak which gate it failed.
      await expect(attempt).rejects.toThrow(/set_budget_cap: admin role required/);
    }));

  it('set_budget_cap accepts an admin', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, V2_ADMIN);

      // The positive control, in its own test. Without it a function that refused EVERYBODY
      // would pass the refusal above — and mutation M10 is only meaningful if this one stays
      // green while that one reds.
      const r = await c.query<{ cap: string }>(
        'select app.set_budget_cap($1, $2)::text as cap',
        [PROVIDER, 75000000],
      );
      expect(r.rows[0]?.cap).toBe('75000000');

      const row = await c.query<{ cap: string }>(
        `select cap_micro_usd::text as cap from budget_periods
          where org_id = $1 and provider = $2 and period_start = ${CHICAGO_MONTH}`,
        [a, PROVIDER],
      );
      expect(row.rows[0]?.cap).toBe('75000000');
    }));

  it('set_budget_cap: an expired hold no longer holds the cap floor up', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // $50 cap, $20 of it reserved by a run that died over an hour ago.
      const period = await seedPeriod(c, a, 50000000, 20000000);
      await c.query(
        `insert into cost_reservations (org_id, budget_period_id, sku, est_micro_usd, expires_at)
         values ($1, $2, $3, 20000000, now() - interval '1 hour')`,
        [a, period, SKU],
      );

      await actAs(c, V2_ADMIN);
      // 🔴 THE FLOOR bp_not_over ENFORCES IS spent + reserved, AND reserved MUST BE LIVE.
      // Lowering the cap to $10 is legitimate here: nothing is spent and nothing is actually
      // in flight. Before WR-01 this was refused with 23514 against a hold that had expired
      // an hour earlier, and CAP_BELOW_SPEND quoted that dead money back to the admin as the
      // minimum they were allowed to set — with no way to clear it but to queue another run.
      const r = await c.query<{ cap: string }>(
        'select app.set_budget_cap($1, $2)::text as cap',
        [PROVIDER, 10000000],
      );
      expect(r.rows[0]?.cap).toBe('10000000');
      const row = await c.query<{ cap: string; reserved: string }>(
        `select cap_micro_usd::text as cap, reserved_micro_usd::text as reserved
           from budget_periods where id = $1`,
        [period],
      );
      expect(row.rows[0]).toEqual({ cap: '10000000', reserved: '0' });
    }));

  it('set_budget_cap: a LIVE hold still holds the cap floor up', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, 50000000, 20000000);
      await c.query(
        `insert into cost_reservations (org_id, budget_period_id, sku, est_micro_usd, expires_at)
         values ($1, $2, $3, 20000000, now() + interval '1 hour')`,
        [a, period, SKU],
      );

      await actAs(c, V2_ADMIN);
      // The control for the test above, resting on the SAME constraint but the opposite
      // side of expires_at. Money promised to a call that is happening right now is
      // committed spend that has not landed in the ledger yet, and a release that ignored
      // the TTL would let an admin lower the cap underneath it. Do not "fix" this one.
      const attempt = c.query('select app.set_budget_cap($1, $2)', [PROVIDER, 10000000]);
      await expect(attempt).rejects.toMatchObject({ code: '23514' });
      await expect(attempt).rejects.toThrow(/bp_not_over/);
    }));

  it('budget_periods holds no direct UPDATE for authenticated', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, V2_ADMIN);

      // A DIFFERENT invariant from the role check: this is the GRANT layer, and it refuses
      // even an admin. app.set_budget_cap is the only door to the cap, and that is a fact
      // about privileges rather than about the function's first `if`.
      const attempt = c.query('update budget_periods set cap_micro_usd = 99999999 where org_id = $1', [a]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table budget_periods/);
    }));

  it('cap change is audited', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, 50000000);

      // Claims bound, then back to the OWNER: the write below is RAW SQL with no application
      // code anywhere in the path (D-08), while app.log_event still resolves the Clerk actor
      // out of the transaction-local claims rather than out of a parameter (T-2-11). A
      // caller cannot author its own audit row, and cannot forge somebody else's.
      await actAs(c, V2_ADMIN);
      await actAsOwner(c);
      await c.query('update budget_periods set cap_micro_usd = 60000000 where id = $1', [period]);

      const ev = await c.query<{
        actor_id: string;
        action: string;
        before_cap: string | null;
        after_cap: string | null;
        age_seconds: string;
      }>(
        `select actor_id, action,
                before->>'cap_micro_usd' as before_cap,
                after->>'cap_micro_usd'  as after_cap,
                extract(epoch from (now() - occurred_at))::text as age_seconds
           from events
          where entity_type = 'budget_periods' and entity_id = $1
          order by id desc limit 1`,
        [period],
      );
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0]?.action).toBe('update');
      expect(ev.rows[0]?.actor_id).toBe('user_danlo');
      expect(ev.rows[0]?.before_cap).toBe('50000000');
      expect(ev.rows[0]?.after_cap).toBe('60000000');
      expect(ev.rows[0]?.before_cap).not.toBe(ev.rows[0]?.after_cap);
      // Compared IN SQL. A timestamptz handed back through pg becomes a JS Date, and this
      // suite runs TZ=UTC on an America/Chicago machine — the round trip is exactly where a
      // wrong comparison hides.
      expect(Number(ev.rows[0]?.age_seconds)).toBeGreaterThanOrEqual(0);
      expect(Number(ev.rows[0]?.age_seconds)).toBeLessThan(60);
    }));

  it('a reservation does NOT write an events row', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const period = await seedPeriod(c, a, 100000);

      const events = async (): Promise<number> => {
        const r = await c.query<{ n: number }>(
          "select count(*)::int as n from events where entity_type = 'budget_periods' and entity_id = $1",
          [period],
        );
        return r.rows[0]?.n ?? -1;
      };
      const before = await events();

      await actAs(c, V2_ADMIN);
      const res = await c.query<{ reservation_id: string | null }>(
        'select reservation_id from app.reserve_budget($1, ' +
          CHICAGO_MONTH +
          ', $2, null, $3)',
        [PROVIDER, 10000, SKU],
      );
      expect(res.rows[0]?.reservation_id).toBeTruthy();

      // The other half of the narrowing. At Phase 4 volumes an unnarrowed UPDATE trigger
      // would write roughly two events rows per paid call, each carrying a full before/after
      // payload whose only difference is a balance moving by design — the source_records
      // write-amplification mistake CONVENTIONS already decided against. The reservation and
      // the ledger row ARE the audit record for spend.
      expect(await events()).toBe(before);
    }));

  it('two zones: one instant, opposite month verdicts in SQL', () =>
    withRollback(async (c) => {
      // 04:30Z on the 1st of October is 23:30 on 30 September in the RGV. A bare ::date
      // buckets in UTC and moves every late-evening cap change, reserve and ledger row into
      // next month — silently, and only for the last five or six hours of each month.
      const r = await c.query<{ chicago: string; utc: string; month: string }>(
        `select to_char((timestamptz '2026-10-01 04:30:00+00' at time zone 'America/Chicago')::date,
                        'YYYY-MM-DD') as chicago,
                to_char((timestamptz '2026-10-01 04:30:00+00' at time zone 'UTC')::date,
                        'YYYY-MM-DD') as utc,
                to_char(date_trunc('month',
                          timestamptz '2026-10-01 04:30:00+00' at time zone 'America/Chicago')::date,
                        'YYYY-MM-DD') as month`,
      );
      expect(r.rows[0]?.chicago).toBe('2026-09-30');
      expect(r.rows[0]?.utc).toBe('2026-10-01'); // the wrong answer
      expect(r.rows[0]?.month).toBe('2026-09-01');
      // 🔴 America/Chicago only ever as HALF a pair. The suite runs TZ=UTC precisely so a
      // forgotten zone argument is a red assertion rather than an accident of this machine.
      expect(r.rows[0]?.chicago).not.toBe(r.rows[0]?.utc);
    }));

  it("two zones: October's period begins at 05:00Z and March's at 06:00Z", () =>
    withRollback(async (c) => {
      // The DST companion. A fixed-offset implementation gets exactly one of these right,
      // which is why one alone would not discriminate: October is CDT (-5), March is CST
      // (-6), and "subtract six hours" is wrong for half the year.
      const r = await c.query<{ october: string; march: string }>(
        `select to_char((timestamp '2026-10-01 00:00' at time zone 'America/Chicago')
                          at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as october,
                to_char((timestamp '2026-03-01 00:00' at time zone 'America/Chicago')
                          at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as march`,
      );
      expect(r.rows[0]?.october).toBe('2026-10-01T05:00:00Z');
      expect(r.rows[0]?.march).toBe('2026-03-01T06:00:00Z');
      expect(r.rows[0]?.october).not.toBe(r.rows[0]?.march);
    }));

  it('set_budget_cap buckets the period in Chicago, not UTC', () =>
    withRollback(async (c) => {
      const def = await c.query<{ def: string }>(
        "select pg_get_functiondef('app.set_budget_cap'::regproc) as def",
      );
      const body = def.rows[0]?.def ?? '';
      // The catalog, not the migration file: this asserts what the DATABASE is running.
      expect(body).toMatch(/date_trunc\('month', now\(\) at time zone 'America\/Chicago'\)/);
      // A bare cast is the defect, and it is invisible for all but five or six hours a
      // month — which is why it is asserted here rather than left to a behavioural test that
      // would only discriminate if the suite happened to run on a month edge.
      expect(body).not.toMatch(/now\(\)::date/);

      // The behavioural half: the row the function creates lands in the Chicago bucket.
      const { a } = await seedTwoOrgs(c);
      await actAs(c, V2_ADMIN);
      await c.query('select app.set_budget_cap($1, $2)', [PROVIDER, 40000000]);
      const row = await c.query<{ same: boolean }>(
        `select (period_start = ${CHICAGO_MONTH}) as same from budget_periods
          where org_id = $1 and provider = $2`,
        [a, PROVIDER],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]?.same).toBe(true);
    }));
});

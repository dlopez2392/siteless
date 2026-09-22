import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { orgs } from './orgs';
import { runs } from './runs';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * BUDG-01 + BUDG-02. The meter, as three tables.
 *
 * 🔴 EVERY MONEY COLUMN IS `bigint` MICRO-USD. Not `integer`, and not cents:
 *
 *   * A Text Search Enterprise request costs 35,000 µUSD = $0.035 = **3.50 ¢**. Integer
 *     cents cannot express it; rounding up costs +14.3 % (the cap refuses early) and
 *     rounding down −14.3 % (the cap silently over-spends). Verified on PG 18.6.
 *   * `select (50*1000000)*80/100` raises `22003 integer out of range` — the intermediate
 *     is 4x10^9 against int4's 2.1x10^9 ceiling. The 80 % threshold computation in
 *     app.reserve_budget is CORRECT and would still error on an int4 column, which reads
 *     as a schema bug. Every literal in the meter rides a bigint column.
 *
 * `.default(sql`...`)`, never `.default(50000000n)`: drizzle-kit 0.31.10 serializes the
 * default into meta/NNNN_snapshot.json with JSON.stringify, which throws "TypeError: Do
 * not know how to serialize a BigInt" and emits NO migration at all while typecheck stays
 * green. Cost wave 1 a cycle on runs.cost_micro_usd; the SQL literal is identical DDL.
 *
 * The grants, the partial index and the audit triggers are NOT here — drizzle-kit's
 * differ cannot emit them. They are in drizzle/0014_budget_grants_and_triggers.sql, and
 * since migration 0008 a new table inherits NOTHING, so that file is not optional.
 */

/**
 * One row per (org, provider, calendar month). The cap lives here and is edited ONLY
 * through app.set_budget_cap — `authenticated` holds no UPDATE grant on this table at all
 * (D-10), so a direct `update budget_periods set cap_micro_usd = ...` is refused at the
 * grant layer with `42501 permission denied for table budget_periods`, a message distinct
 * from set_budget_cap's own `42501 set_budget_cap: admin role required`.
 *
 * Rows are created lazily by app.ensure_budget_period, which copies the previous period's
 * cap forward so an edited cap persists across months.
 */
export const budgetPeriods = pgTable(
  'budget_periods',
  {
    ...orgScoped,
    provider: text('provider').notNull(),
    // The first day of the CHICAGO calendar month. Derived inside the definer functions as
    // `(date_trunc('month', now() at time zone 'America/Chicago'))::date` — CONVENTIONS
    // section Time forbids a bare `::date`, which silently buckets in UTC and hands the
    // last ~5-6 hours of every month to the next one.
    periodStart: date('period_start').notNull(),
    capMicroUsd: bigint('cap_micro_usd', { mode: 'bigint' })
      .notNull()
      .default(sql`50000000`),
    reservedMicroUsd: bigint('reserved_micro_usd', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    spentMicroUsd: bigint('spent_micro_usd', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    // D-12's 80 % warning is emitted ONCE per period. Stamped by a conditional UPDATE
    // (`where id = ... and warned_80_at is null`) inside app.reserve_budget, so two workers
    // crossing 80 % simultaneously cannot both emit.
    warned80At: tstz('warned_80_at'),
  },
  (t) => [
    // An RLS predicate on org_id gets no index for free (RESEARCH Pitfall 5).
    index('budget_periods_org_idx').on(t.orgId),
    unique('budget_periods_org_provider_period_uniq').on(t.orgId, t.provider, t.periodStart),
    // The three providers D-14's spend view lists.
    check('bp_provider_known', sql`provider in ('places','firecrawl','anthropic')`),
    // 🔴 T-2-04, the second wall. The conditional UPDATE in app.reserve_budget is the
    // concurrency control; THIS refuses even hand-written SQL and a bug inside the definer
    // itself, with 23514. It is also what refuses lowering the cap below what is already
    // committed — the true floor is `spent + reserved`, verified boundary-exact (cap 5000
    // -> 1600 accepted, -> 1599 refused, with spent 1200 and reserved 400).
    check('bp_not_over', sql`spent_micro_usd + reserved_micro_usd <= cap_micro_usd`),
    check(
      'bp_non_negative',
      sql`cap_micro_usd >= 0 and reserved_micro_usd >= 0 and spent_micro_usd >= 0`,
    ),
    ...orgPolicies('budget_periods'),
  ],
);

/**
 * A claim on the budget, taken BEFORE the billable call and settled after it.
 *
 * 🔴 Reserve the worst case, settle the actual. Reserving one page and discovering three
 * is the only way to breach the cap; the true-up returns the difference.
 *
 * T-2-06: a crashed worker's reservation is reclaimed by the NEXT caller, inside
 * app.reserve_budget, under `for update ... skip locked` and backed by the
 * `cost_reservations_open` partial index in drizzle/0014. No scheduler is on the
 * correctness path, so a paused project cannot strand the budget forever.
 *
 * Deliberately NO `app.log_event` trigger (RESEARCH Pitfall 9): one reservation per paid
 * call is exactly the write-amplification shape CONVENTIONS excludes source_records for.
 * The reservation IS its own audit record.
 */
export const costReservations = pgTable(
  'cost_reservations',
  {
    ...orgScoped,
    budgetPeriodId: uuid('budget_period_id')
      .notNull()
      .references(() => budgetPeriods.id),
    runId: uuid('run_id').references(() => runs.id),
    sku: text('sku').notNull(),
    estMicroUsd: bigint('est_micro_usd', { mode: 'bigint' }).notNull(),
    expiresAt: tstz('expires_at').notNull(),
    settledAt: tstz('settled_at'),
    releasedAt: tstz('released_at'),
  },
  (t) => [
    index('cost_reservations_org_idx').on(t.orgId),
    // T-2-07. A non-positive estimate would let a caller hold the meter open for free;
    // app.reserve_budget raises 22023 on it first, and this refuses it with 23514 even
    // when the definer is bypassed.
    check('cr_est_positive', sql`est_micro_usd > 0`),
    ...orgPolicies('cost_reservations'),
  ],
);

/**
 * BUDG-01's external contract, append-only: `{provider, sku, units, cost_cents, run_id,
 * lead_id?}` — satisfied by NAME and by VALUE, while the internal arithmetic stays in
 * micro-USD and never loses a half cent.
 *
 * 🔴 `reservation_id` is NOT NULL WITH AN FK. That single fact is T-2-03: a ledger row
 * cannot exist without a reservation, so NO code path can spend a cent outside the meter.
 * The only writer is app.settle_reservation (a SECURITY DEFINER that loads the reservation
 * first); `authenticated` holds no INSERT on this table at all.
 *
 * No `updated_at`, no `updated_by`, and so NOT `...orgScoped` — the ledger is append-only,
 * and a mutable-attribution pair on it would be a lie. No `app.touch_updated_at` trigger
 * and no `app.log_event` trigger (Pitfall 9) for the same reason.
 */
export const costLedger = pgTable(
  'cost_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    budgetPeriodId: uuid('budget_period_id')
      .notNull()
      .references(() => budgetPeriods.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => costReservations.id),
    runId: uuid('run_id').references(() => runs.id),
    // Phase 5+. Nullable and deliberately un-referenced: the leads table does not exist yet.
    leadId: uuid('lead_id'),
    provider: text('provider').notNull(),
    sku: text('sku').notNull(),
    units: integer('units').notNull().default(1),
    microUsd: bigint('micro_usd', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    // 35000 µUSD renders 3.50. STORED, not VIRTUAL — a virtual generated column is
    // PostgreSQL 18 only and production is 17.6 (drizzle-kit emits `stored`).
    costCents: numeric('cost_cents', { precision: 12, scale: 2 }).generatedAlwaysAs(
      sql`micro_usd / 10000.0`,
    ),
    requestId: text('request_id').notNull(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    // 🔴 T-2-05. Paired with `on conflict (request_id) do nothing` + `get diagnostics` in
    // app.settle_reservation, a replayed settlement returns false and moves NO balance.
    unique('cost_ledger_request_id_key').on(t.requestId),
    check('cl_micro_non_negative', sql`micro_usd >= 0`),
    check('cl_units_positive', sql`units > 0`),
    // D-14's spend view wants both from day one: the monthly total, and "by run".
    index('cost_ledger_org_period_idx').on(t.orgId, t.budgetPeriodId),
    index('cost_ledger_run_idx').on(t.runId),
    // Select + insert only, declared inline rather than via orgPolicies(), exactly as
    // events.ts does: the ledger has no legitimate UPDATE or DELETE path. drizzle/0014
    // revokes those grants too, so the append-only property does not rest on a policy that
    // a later `for all` could widen. cost_ledger_insert is kept although the INSERT grant
    // is revoked — the grant layer refuses first, and this is the scope that would still
    // apply if a later migration ever re-granted INSERT.
    pgPolicy('cost_ledger_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`org_id = (select app.current_org_id())`,
    }),
    pgPolicy('cost_ledger_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`org_id = (select app.current_org_id())`,
    }),
  ],
);

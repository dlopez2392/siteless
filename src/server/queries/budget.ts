import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { periodResetInstant, periodStart } from '@/lib/budget/period';
import type { Provider, Sku } from '@/lib/budget/price-book';

/**
 * The meter, as an RSC page reads it. D-14.
 *
 * 🔴 THESE ARE QUERIES, NOT ACTIONS. No server directive anywhere in this file: a page
 * component awaits these directly during render, and marking them as actions would publish
 * four read endpoints to the browser for no reason. The screens' WRITE paths are the six
 * modules in `src/server/actions/`, and every one of them authenticates before it calls
 * anything here.
 *
 * 🔴 EVERY FUNCTION COMES IN TWO HALVES: a `read*` that takes an open transaction, and a
 * `get*` that opens one. That is not stylistic. `src/db/client.ts` pools with `max: 1`, so
 * a second `withOrg` opened INSIDE a first one would wait for a connection the outer
 * transaction is holding and the request would hang until the pool timeout — not fail, hang.
 * An action that needs three of these in one transaction calls the `read*` halves.
 *
 * 🔴 BIGINT COLUMNS COME BACK AS STRINGS. postgres.js parses int2/int4/float4/float8 into
 * numbers and leaves int8 and numeric as text, deliberately, because a µUSD figure past
 * 2^53 would silently lose its low digits. Every money column below is cast `::text` at the
 * call site — self-documenting, and immune to a driver that later changes its mind — and
 * converted with `BigInt()` here so nothing downstream ever sees a half-parsed number.
 *
 * 🔴 `period_start` IS CAST `::text` FOR THE SAME CLASS OF REASON. It is a `date`, and
 * postgres.js parses oid 1082 with `new Date('2026-09-01')`, which anchors UTC midnight —
 * the exact trap `src/lib/budget/period.ts` exists to avoid. It stays a 'YYYY-MM-01' string
 * from the database to the caller.
 */

/** The transaction handle `withOrg` hands its callback. Declared here rather than imported
 *  because `src/db/with-org.ts` derives it inline and exports no name for it. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Drizzle's postgres-js `execute` returns the driver's RowList. `ensureOrgRow` in
 * `src/lib/auth/require-org.ts` does this cast inline; it is written once here because five
 * call sites below need it and a cast repeated five times is a cast nobody reads.
 */
export function rowsOf<T>(result: unknown): T[] {
  return result as unknown as T[];
}

export type BudgetPeriodRow = {
  id: string;
  /** 'YYYY-MM-01' in the app's zone. A string, never a Date — see the header. */
  periodStart: string;
  capMicroUsd: bigint;
  reservedMicroUsd: bigint;
  spentMicroUsd: bigint;
  warned80At: Date | null;
  /** `(spent + reserved) * 100 / cap`, integer. What the gauge and the banner switch on. */
  pctUsed: number;
};

type RawPeriod = {
  id: string;
  period_start: string;
  cap: string;
  reserved: string;
  spent: string;
  warned_80_at: Date | null;
};

/**
 * Percent of the cap committed. Never throws and never returns NaN.
 *
 * A zero cap cannot be set through `app.set_budget_cap` (it raises 22023 on a non-positive
 * cap) but the column permits it, and `BigInt` division by zero is a thrown RangeError, not
 * an Infinity. A 500 on the spend page because somebody's cap is $0.00 would be a real
 * outage produced by a valid row, so the answer at a zero cap is 100 when anything is
 * committed and 0 when nothing is — the same convention the estimator's percent helper uses.
 */
export function pctUsedOf(capMicroUsd: bigint, spentMicroUsd: bigint, reservedMicroUsd: bigint) {
  const committed = spentMicroUsd + reservedMicroUsd;
  if (capMicroUsd <= 0n) return committed > 0n ? 100 : 0;
  return Number((committed * 100n) / capMicroUsd);
}

function toPeriodRow(raw: RawPeriod): BudgetPeriodRow {
  const capMicroUsd = BigInt(raw.cap);
  const reservedMicroUsd = BigInt(raw.reserved);
  const spentMicroUsd = BigInt(raw.spent);
  return {
    id: raw.id,
    periodStart: raw.period_start,
    capMicroUsd,
    reservedMicroUsd,
    spentMicroUsd,
    warned80At: raw.warned_80_at,
    pctUsed: pctUsedOf(capMicroUsd, spentMicroUsd, reservedMicroUsd),
  };
}

/**
 * This month's row for one provider, created on first read.
 *
 * `app.ensure_budget_period` is select-then-do-nothing (migration 0016) and carries the
 * previous month's cap forward, so the common path writes nothing, fires no trigger and
 * takes no row lock — and an edited cap does not silently revert to the $50 default on the
 * first page view of a new month.
 */
export async function readCurrentPeriod(
  tx: Tx,
  provider: Provider = 'places',
  now: Date = new Date(),
): Promise<BudgetPeriodRow> {
  const period = periodStart(now);
  const ensured = rowsOf<{ id: string }>(
    await tx.execute(sql`select app.ensure_budget_period(${provider}, ${period}::date) as id`),
  )[0];
  if (!ensured?.id) {
    throw new Error(`readCurrentPeriod: app.ensure_budget_period returned no id for ${provider}`);
  }
  const row = rowsOf<RawPeriod>(
    await tx.execute(sql`
      select id,
             period_start::text      as period_start,
             cap_micro_usd::text     as cap,
             reserved_micro_usd::text as reserved,
             spent_micro_usd::text   as spent,
             warned_80_at
        from budget_periods
       where id = ${ensured.id}`),
  )[0];
  // RLS confines this read to the caller's org. A period the definer just ensured and this
  // statement cannot see would mean the claims changed mid-transaction, which is a bug.
  if (!row) throw new Error('readCurrentPeriod: the ensured budget period is not readable');
  return toPeriodRow(row);
}

export async function getCurrentPeriod(
  claims: OrgClaims,
  provider: Provider = 'places',
): Promise<BudgetPeriodRow> {
  return withOrg(claims, (tx) => readCurrentPeriod(tx, provider));
}

/**
 * Paid-SKU units already consumed this period — the number the free allowance is derived
 * from (`src/lib/budget/price-book.ts` § freeRemaining).
 *
 * 🔴 `coalesce(sum(units), 0)`, not `count(*)`. A settlement records `units` per call and a
 * single ledger row can carry more than one; counting rows would under-report the allowance
 * and quote a $0.00 estimate for a preset that is about to be billed.
 *
 * The rows with `micro_usd = 0` are the whole point: a free-tier Enterprise call is a
 * paid-SKU call that happened to cost nothing, and skipping those rows makes every
 * early-month estimate wrong.
 */
export async function readUnitsUsedThisPeriod(
  tx: Tx,
  sku: Sku,
  periodId: string,
): Promise<number> {
  const row = rowsOf<{ units: number }>(
    await tx.execute(sql`
      select coalesce(sum(units), 0)::int as units
        from cost_ledger
       where budget_period_id = ${periodId}
         and sku = ${sku}`),
  )[0];
  return row?.units ?? 0;
}

export async function getUnitsUsedThisPeriod(
  claims: OrgClaims,
  sku: Sku,
  periodId: string,
): Promise<number> {
  return withOrg(claims, (tx) => readUnitsUsedThisPeriod(tx, sku, periodId));
}

export type ProviderSpend = {
  provider: Provider;
  microUsd: bigint;
  calls: number;
};

/**
 * One row per provider, every month, spend or no spend (D-14 / UI-SPEC § Spend).
 *
 * 🔴 THE `values` LIST IS THE POINT. Grouping the ledger alone returns rows only for
 * providers that spent something, so Firecrawl and Anthropic would simply be absent from
 * the table in Phase 2 — and an absent row reads as "we are not tracking this", which is
 * the opposite of the truth. UI-SPEC renders a zero provider as `$0.00 · no calls yet`, and
 * it can only do that if the row exists.
 *
 * The join is on the period's START, not on `periodId`: `budget_periods` is keyed
 * (org, provider, month), so one period id belongs to exactly one provider and joining on
 * it would collapse this back to a single row. RLS confines both joined tables to the org.
 */
export async function readSpendByProvider(tx: Tx, periodId: string): Promise<ProviderSpend[]> {
  const rows = rowsOf<{ provider: Provider; micro_usd: string; calls: number }>(
    await tx.execute(sql`
      with anchor as (
        select period_start from budget_periods where id = ${periodId}
      ), providers(provider, ord) as (
        values ('places', 1), ('firecrawl', 2), ('anthropic', 3)
      )
      select p.provider,
             coalesce(sum(l.micro_usd), 0)::text as micro_usd,
             count(l.id)::int                    as calls
        from providers p
        left join budget_periods b
               on b.provider = p.provider
              and b.period_start = (select period_start from anchor)
        left join cost_ledger l on l.budget_period_id = b.id
       group by p.provider, p.ord
       order by p.ord`),
  );
  return rows.map((r) => ({
    provider: r.provider,
    microUsd: BigInt(r.micro_usd),
    calls: r.calls,
  }));
}

export async function getSpendByProvider(
  claims: OrgClaims,
  periodId: string,
): Promise<ProviderSpend[]> {
  return withOrg(claims, (tx) => readSpendByProvider(tx, periodId));
}

export type RunSpend = {
  runId: string;
  presetDisplayName: string;
  version: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  calls: number;
  microUsd: bigint;
  status: string;
  stoppedReason: string | null;
};

/**
 * The two instants a 'YYYY-MM-01' period covers, in the app's zone.
 *
 * 🔴 NO ZONE IS NAMED HERE, and that is deliberate rather than incidental: CONVENTIONS
 * § Time makes `src/lib/time.ts` the only file in `src/` allowed to name one, enforced by a
 * bare token grep. `periodResetInstant` resolves the offset AT the wall-clock moment, so
 * this is right across a DST boundary — the end of a CDT month is 05:00Z and of a CST month
 * 06:00Z, and an implementation that subtracted a constant six hours would be right half
 * the year.
 *
 * The start of month M is the RESET instant of month M−1, which is why the previous month
 * is computed as a string and handed back to the same helper rather than re-deriving
 * midnight by hand.
 */
export function periodWindow(periodStartIso: string): { from: Date; to: Date } {
  const match = /^(\d{4})-(\d{2})-01$/.exec(periodStartIso);
  if (!match) {
    throw new Error(
      `periodWindow: expected a 'YYYY-MM-01' period start, got ${JSON.stringify(periodStartIso)}`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const prev =
    month === 1
      ? `${year - 1}-12-01`
      : `${String(year).padStart(4, '0')}-${String(month - 1).padStart(2, '0')}-01`;
  return { from: periodResetInstant(prev), to: periodResetInstant(periodStartIso) };
}

/**
 * D-14's "by run" table: every run STARTED in this budget month, with what it actually
 * cost, joined through `runs -> search_versions -> searches`.
 *
 * 🔴 A REFUSED RUN IS IN THIS LIST. It has no reservation and no ledger row — that is what
 * being refused means — so a query built from the ledger outwards would omit exactly the
 * rows that explain why the month stopped. The window is on the run's own `created_at`, and
 * the ledger is a LEFT join.
 *
 * `presetDisplayName`, never `name_internal` (CONVENTIONS § Naming). The internal label is
 * the operator's and BIS's single `accounts.name` reached customers three times.
 */
export async function readSpendByRun(
  tx: Tx,
  periodStartIso: string,
): Promise<RunSpend[]> {
  const { from, to } = periodWindow(periodStartIso);
  const rows = rowsOf<{
    run_id: string;
    preset_display_name: string;
    version: number;
    started_at: Date | null;
    finished_at: Date | null;
    calls: number;
    micro_usd: string;
    status: string;
    stopped_reason: string | null;
  }>(
    await tx.execute(sql`
      select r.id                                 as run_id,
             s.display_name                       as preset_display_name,
             v.version                            as version,
             r.started_at                         as started_at,
             r.finished_at                        as finished_at,
             r.status                             as status,
             r.stopped_reason                     as stopped_reason,
             count(l.id)::int                     as calls,
             coalesce(sum(l.micro_usd), 0)::text  as micro_usd
        from runs r
        join search_versions v on v.id = r.search_version_id
        join searches s        on s.id = v.search_id
        left join cost_ledger l on l.run_id = r.id
       where r.created_at >= ${from} and r.created_at < ${to}
       group by r.id, s.display_name, v.version, r.started_at, r.finished_at,
                r.status, r.stopped_reason
       order by r.created_at desc`),
  );
  return rows.map((r) => ({
    runId: r.run_id,
    presetDisplayName: r.preset_display_name,
    version: r.version,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    calls: r.calls,
    microUsd: BigInt(r.micro_usd),
    status: r.status,
    stoppedReason: r.stopped_reason,
  }));
}

export async function getSpendByRun(claims: OrgClaims, periodId: string): Promise<RunSpend[]> {
  return withOrg(claims, async (tx) => {
    const anchor = rowsOf<{ period_start: string }>(
      await tx.execute(
        sql`select period_start::text as period_start from budget_periods where id = ${periodId}`,
      ),
    )[0];
    if (!anchor) return [];
    return readSpendByRun(tx, anchor.period_start);
  });
}

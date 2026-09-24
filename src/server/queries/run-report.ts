import 'server-only';
import { sql } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { periodResetInstant, periodStart } from '@/lib/budget/period';
import { instantOf, requireInstant } from '@/lib/instant';
import type { HostClass } from '@/lib/places/host-class';
import {
  STOPPED_REASONS,
  type RunKind,
  type RunStatus,
  type StoppedReason,
} from '@/lib/ui/run-tone';
import { readCurrentPeriod, rowsOf, type Tx } from './budget';

/**
 * `/runs/[id]` (D-17; 04-UI-SPEC § Screen 1; criterion 3): every number the run report shows,
 * read in ONE transaction.
 *
 * 🔴 ONE TRANSACTION. `src/db/client.ts` pools with `max: 1`, so a second transaction opened from
 * inside the first would HANG, not fail. `readRunReport` takes the open transaction and runs its
 * statements one after another; `getRunReport` opens it. Every table read here is RLS-scoped and
 * every statement ALSO names `org_id = app.current_org_id()` — a foreign or unknown run id is
 * `null` (T-4-06), never another org's numbers.
 *
 * 🔴 STATIC STRUCTURE, NOT DATA (the `/sources` pattern, Rule 27). Three things on this screen
 * must exist whether or not anything happened:
 *   * both Text Search SKU rows — a `values` list LEFT-joined to the ledger, so a run that made
 *     no Essentials request still shows "0" rather than no row;
 *   * every cluster of the run's version (D-06) — `unnest(cluster_ids)` LEFT-joined to the
 *     outcomes, so the coverage gap is measured per cluster with zeros included;
 *   * every host class (D-09) — a `values` list, so a class nobody listed is 0, not absent.
 *
 * 🔴 TRUNCATION IS NEVER A SILENT PARTIAL (criterion 3). `stillTruncated` counts every search
 * whose `truncated` flag is set and `truncated` lists each one; a truncated search whose
 * `truncated_why` was never written is still counted and listed, with `why: null`.
 *
 * 🔴 THE WEBSITE SPLIT COUNTS ATTACHED LISTINGS ONLY (D-05, D-08, D-09). Observations of THIS
 * run joined to their attachment, filtered to the attachment's CURRENT status `attached`: a
 * tentative listing is observed but is not a signal, and a rejected / detached pair never is.
 *
 * 🔴 INSTANTS AS EPOCH-MS TEXT → `instantOf`; MONEY AS TEXT → a checked integer. A `timestamptz`
 * through postgres.js with `prepare: false` arrives as a zone-rendered string, and an int8 sum
 * arrives as text (budget.ts header). Money here is a JS number because the report's type says
 * so; a figure past 2^53 µUSD (≈ $9 billion) is refused rather than silently rounded.
 *
 * T-4-04 / T-4-05: only counts, enums, keys and our own names are read. `place_coordinates` is
 * never touched (authenticated holds no grant on it), and no Places text exists to read.
 */

export type TextSearchSkuRow = 'ts_enterprise' | 'ts_essentials';

export type TruncatedWhy = 'max_depth' | 'min_size' | 'novelty';

export type RunReport = {
  run: {
    id: string;
    status: RunStatus;
    /** A machine key; `STOPPED_REASON` in copy.ts renders it. An unknown key reads as null. */
    stoppedReason: StoppedReason | null;
    kind: RunKind;
    partitionIndex: number | null;
    /** `searches.id` — the preset this run belongs to. */
    presetId: string;
    /** `searches.display_name`, never `name_internal` (CONVENTIONS § Naming). */
    presetName: string;
    versionNumber: number;
    createdMs: number;
    startedMs: number | null;
    finishedMs: number | null;
    /** `sum(cost_ledger.micro_usd)` for this run — live while the run is running. */
    costMicroUsd: number;
    callsCount: number;
    estimateRequestsLo: number | null;
    estimateRequestsHi: number | null;
    estimateMicroUsdLo: number | null;
    estimateMicroUsdHi: number | null;
    ceilingRequests: number;
    /**
     * 🔴 C-CR-04: the Places cap of the RUN'S OWN budget month — the month (APP_TZ) its
     * `created_at` falls in, which is the period `queueRun` reserved against — and the instant
     * that month reset. Never the month the report happens to be opened in: a run stopped at
     * September's cap and read on Oct 2 must not say "can run after the cap resets on Nov 1".
     */
    capMicroUsd: number;
    capResetMs: number;
    /** 'YYYY-MM-01' of the run's budget month. */
    capPeriodStart: string;
    /** False once that month is over — the alerts then speak in the past tense. */
    capPeriodIsCurrent: boolean;
  };
  requests: {
    /** Always both rows, Enterprise first, even at zero. */
    rows: Array<{
      sku: TextSearchSkuRow;
      /** `sum(units)` of this run's ledger rows for the SKU (one unit per request). */
      requests: number;
      /** The subset of `requests` settled at $0 — inside the month's free allowance. */
      freeThisMonth: number;
      costMicroUsd: number;
    }>;
    /** 1 when the meter refused the next request (`stopped_reason = 'budget_cap_reached'`). */
    refusedByMeter: number;
    /** Every ledgered request of the run PLUS `refusedByMeter` — the Requests card's Total row. */
    totalRequests: number;
    totalMicroUsd: number;
  };
  tiles: {
    total: number;
    /** `status = 'done'`. */
    searched: number;
    saturated: number;
    subdivided: number;
    stillTruncated: number;
    truncated: Array<{
      tileKey: string;
      cellKey: string;
      placesType: string;
      why: TruncatedWhy | null;
    }>;
    /** Searches still `planned` / `searching` when the run is TERMINAL; empty while it runs. */
    stillSubdividing: Array<{ tileKey: string; cellKey: string; placesType: string }>;
  };
  outcomes: {
    /** Distinct place ids with any non-`outside` outcome in this run. */
    found: number;
    /** Each found place counted once, at its best outcome across clusters — the three sum to `found`. */
    attached: number;
    tentative: number;
    unmatched: number;
    byCluster: Array<{
      clusterKey: string;
      displayName: string;
      found: number;
      attached: number;
      tentative: number;
      unmatched: number;
    }>;
    website: {
      listed: number;
      none: number;
      byHostClass: Record<Exclude<HostClass, 'none'>, number>;
    };
  };
  /** Non-null only for `kind = 'change_check'` (D-16). */
  changes: {
    checked: number;
    unchanged: number;
    withNew: number;
    withGone: number;
    newIds: number;
    goneIds: number;
    changedTiles: number;
  } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TERMINAL: ReadonlySet<RunStatus> = new Set(['complete', 'partial', 'refused', 'failed']);

/** An int8 / numeric arriving as text (or an int4 as a number) into a JS integer, refused past 2^53. */
function intOf(value: string | number | null, what: string): number {
  if (value === null) throw new Error(`readRunReport: ${what} came back null`);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`readRunReport: ${what} is not a safe integer (${JSON.stringify(value)})`);
  }
  return n;
}

function intOrNull(value: string | number | null, what: string): number | null {
  return value === null ? null : intOf(value, what);
}

function stoppedReasonOf(value: string | null): StoppedReason | null {
  return value !== null && (STOPPED_REASONS as readonly string[]).includes(value)
    ? (value as StoppedReason)
    : null;
}

type RawRun = {
  id: string;
  status: RunStatus;
  stopped_reason: string | null;
  kind: RunKind;
  partition_index: number | null;
  preset_id: string;
  preset_name: string;
  version: number;
  created_ms: string | null;
  started_ms: string | null;
  finished_ms: string | null;
  calls_count: number;
  estimate_requests_lo: number | null;
  estimate_requests_hi: number | null;
  estimate_micro_usd_lo: string | null;
  estimate_micro_usd_hi: string | null;
  ceiling_requests: number;
  ledger_units: string;
  ledger_micro_usd: string;
};

type RawSku = { sku: TextSearchSkuRow; requests: number; free: number; micro_usd: string };

type RawTiles = {
  total: number;
  searched: number;
  saturated: number;
  subdivided: number;
  truncated: number;
};

type RawTileRow = {
  tile_key: string;
  cell_key: string;
  places_type: string;
  truncated_why: TruncatedWhy | null;
};

type RawOutcomes = { found: number; attached: number; tentative: number; unmatched: number };

type RawCluster = RawOutcomes & { cluster_key: string | null; display_name: string | null };

type RawHost = { host_class: HostClass; n: number };

type RawChanges = {
  checked: number;
  unchanged: number;
  with_new: number;
  with_gone: number;
  new_ids: number;
  gone_ids: number;
  changed_tiles: number;
};

/**
 * `now` exists so the month-boundary test can pin "when the report was opened"; callers leave it.
 */
export async function readRunReport(
  tx: Tx,
  runId: string,
  now: Date = new Date(),
): Promise<RunReport | null> {
  // A malformed id is an unknown run, not a 22P02 that aborts the transaction.
  if (!UUID.test(runId)) return null;

  // ---- The run, its preset/version, and its ledger totals ---------------------------------
  const [run] = rowsOf<RawRun>(
    await tx.execute(sql`
      select r.id,
             r.status,
             r.stopped_reason,
             r.kind,
             r.partition_index,
             s.id                                                       as preset_id,
             s.display_name                                             as preset_name,
             v.version                                                  as version,
             (extract(epoch from r.created_at)  * 1000)::bigint::text   as created_ms,
             (extract(epoch from r.started_at)  * 1000)::bigint::text   as started_ms,
             (extract(epoch from r.finished_at) * 1000)::bigint::text   as finished_ms,
             r.calls_count,
             r.estimate_requests_lo,
             r.estimate_requests_hi,
             r.estimate_micro_usd_lo::text                              as estimate_micro_usd_lo,
             r.estimate_micro_usd_hi::text                              as estimate_micro_usd_hi,
             r.ceiling_requests,
             lt.units                                                   as ledger_units,
             lt.micro_usd                                               as ledger_micro_usd
        from runs r
        join search_versions v on v.id = r.search_version_id
        join searches s        on s.id = v.search_id
        left join lateral (
          select coalesce(sum(l.units), 0)::text     as units,
                 coalesce(sum(l.micro_usd), 0)::text as micro_usd
            from cost_ledger l
           where l.org_id = (select app.current_org_id())
             and l.run_id = r.id
        ) lt on true
       where r.id = ${runId}::uuid
         and r.org_id = (select app.current_org_id())`),
  );
  if (!run) return null;

  // 🔴 C-CR-04. The RUN'S budget month, taken in APP_TZ by `periodStart` (never the process or
  // session zone), from the run's `created_at` — the instant `queueRun` reserved against. The
  // period row is read through the same get-or-create the rest of the app uses; for a run's own
  // month it already exists (its reservation was made there), so this is a read.
  const createdAt = requireInstant(run.created_ms, 'runs.created_at');
  const period = await readCurrentPeriod(tx, 'places', createdAt);
  const capPeriodIsCurrent = period.periodStart === periodStart(now);

  // ---- Requests by SKU: both rows always (static structure) -------------------------------
  const skuRows = rowsOf<RawSku>(
    await tx.execute(sql`
      select k.sku,
             coalesce(l.requests, 0)::int  as requests,
             coalesce(l.free, 0)::int      as free,
             coalesce(l.micro_usd, 0)::text as micro_usd
        from (values ('ts_enterprise', 1), ('ts_essentials', 2)) as k(sku, ord)
        left join lateral (
          select sum(c.units)                                   as requests,
                 sum(c.units) filter (where c.micro_usd = 0)    as free,
                 sum(c.micro_usd)                               as micro_usd
            from cost_ledger c
           where c.org_id = (select app.current_org_id())
             and c.run_id = ${runId}::uuid
             and c.sku = k.sku
        ) l on true
       order by k.ord`),
  );

  // ---- Tiles --------------------------------------------------------------------------------
  const [tileCounts] = rowsOf<RawTiles>(
    await tx.execute(sql`
      select count(*)::int                                  as total,
             count(*) filter (where rs.status = 'done')::int as searched,
             count(*) filter (where rs.saturated)::int       as saturated,
             count(*) filter (where rs.subdivided)::int      as subdivided,
             count(*) filter (where rs.truncated)::int       as truncated
        from run_searches rs
       where rs.org_id = (select app.current_org_id())
         and rs.run_id = ${runId}::uuid`),
  );
  if (!tileCounts) throw new Error('readRunReport: the tile aggregate returned no row');

  const truncatedRows = rowsOf<RawTileRow>(
    await tx.execute(sql`
      select rs.tile_key, rs.cell_key, rs.places_type, rs.truncated_why
        from run_searches rs
       where rs.org_id = (select app.current_org_id())
         and rs.run_id = ${runId}::uuid
         and rs.truncated
       order by rs.tile_key`),
  );

  const stillSubdividing = TERMINAL.has(run.status)
    ? rowsOf<RawTileRow>(
        await tx.execute(sql`
          select rs.tile_key, rs.cell_key, rs.places_type, rs.truncated_why
            from run_searches rs
           where rs.org_id = (select app.current_org_id())
             and rs.run_id = ${runId}::uuid
             and rs.status in ('planned', 'searching')
           order by rs.tile_key`),
      )
    : [];

  // ---- Outcomes: run-wide (each place at its best outcome) and per cluster ---------------------
  const [outcomes] = rowsOf<RawOutcomes>(
    await tx.execute(sql`
      with per_place as (
        select o.place_id,
               max(case o.outcome when 'attached' then 3 when 'tentative' then 2
                                  when 'unmatched' then 1 else 0 end) as rank
          from run_place_outcomes o
         where o.org_id = (select app.current_org_id())
           and o.run_id = ${runId}::uuid
         group by o.place_id
      )
      select count(*) filter (where rank >= 1)::int as found,
             count(*) filter (where rank = 3)::int  as attached,
             count(*) filter (where rank = 2)::int  as tentative,
             count(*) filter (where rank = 1)::int  as unmatched
        from per_place`),
  );
  if (!outcomes) throw new Error('readRunReport: the outcome aggregate returned no row');

  const clusterRows = rowsOf<RawCluster>(
    await tx.execute(sql`
      select ic.key                         as cluster_key,
             ic.display_name                as display_name,
             coalesce(o.found, 0)::int      as found,
             coalesce(o.attached, 0)::int   as attached,
             coalesce(o.tentative, 0)::int  as tentative,
             coalesce(o.unmatched, 0)::int  as unmatched
        from runs r
        join search_versions v on v.id = r.search_version_id
        cross join lateral unnest(v.cluster_ids) with ordinality as u(cluster_id, pos)
        left join industry_clusters ic on ic.id = u.cluster_id
        left join lateral (
          select count(*) filter (where x.outcome <> 'outside')   as found,
                 count(*) filter (where x.outcome = 'attached')   as attached,
                 count(*) filter (where x.outcome = 'tentative')  as tentative,
                 count(*) filter (where x.outcome = 'unmatched')  as unmatched
            from run_place_outcomes x
           where x.org_id = (select app.current_org_id())
             and x.run_id = r.id
             and x.cluster_key = ic.key
        ) o on true
       where r.id = ${runId}::uuid
         and r.org_id = (select app.current_org_id())
       order by ic.sort_order nulls last, ic.key nulls last, u.pos`),
  );

  // ---- Website on Google: this run's observations of CURRENTLY attached listings -----------------
  const hostRows = rowsOf<RawHost>(
    await tx.execute(sql`
      select h.host_class, coalesce(w.n, 0)::int as n
        from (values ('none', 0), ('other', 1), ('social', 2), ('directory', 3),
                     ('platform_subdomain', 4), ('business_site_dead', 5)) as h(host_class, ord)
        left join lateral (
          select count(*) as n
            from place_observations po
            join place_attachments pa on pa.id = po.attachment_id
           where po.org_id = (select app.current_org_id())
             and po.run_id = ${runId}::uuid
             and po.host_class = h.host_class
             and pa.status = 'attached'
        ) w on true
       order by h.ord`),
  );

  // ---- Changes (D-16): change checks only ------------------------------------------------------
  let changes: RunReport['changes'] = null;
  if (run.kind === 'change_check') {
    const [c] = rowsOf<RawChanges>(
      await tx.execute(sql`
        select count(*) filter (where rs.change_verdict is not null)::int                  as checked,
               count(*) filter (where rs.change_verdict = 'unchanged')::int                as unchanged,
               count(*) filter (where rs.change_verdict in ('new', 'both'))::int           as with_new,
               count(*) filter (where rs.change_verdict in ('gone', 'both'))::int          as with_gone,
               coalesce(sum(rs.new_ids), 0)::int                                            as new_ids,
               coalesce(sum(rs.gone_ids), 0)::int                                           as gone_ids,
               count(*) filter (where rs.change_verdict in ('new', 'gone', 'both', 'saturated'))::int
                                                                                            as changed_tiles
          from run_searches rs
         where rs.org_id = (select app.current_org_id())
           and rs.run_id = ${runId}::uuid`),
    );
    if (!c) throw new Error('readRunReport: the change aggregate returned no row');
    changes = {
      checked: c.checked,
      unchanged: c.unchanged,
      withNew: c.with_new,
      withGone: c.with_gone,
      newIds: c.new_ids,
      goneIds: c.gone_ids,
      changedTiles: c.changed_tiles,
    };
  }

  // ---- Assemble -------------------------------------------------------------------------------
  const stoppedReason = stoppedReasonOf(run.stopped_reason);
  const refusedByMeter = stoppedReason === 'budget_cap_reached' ? 1 : 0;

  const byHostClass: Record<Exclude<HostClass, 'none'>, number> = {
    other: 0,
    social: 0,
    directory: 0,
    platform_subdomain: 0,
    business_site_dead: 0,
  };
  let none = 0;
  for (const h of hostRows) {
    if (h.host_class === 'none') none = h.n;
    else byHostClass[h.host_class] = h.n;
  }
  const listed = Object.values(byHostClass).reduce((a, b) => a + b, 0);

  const byCluster = clusterRows.map((c) => {
    // A cluster id in the version that resolves to no visible cluster row would silently drop a
    // row of the coverage gap (D-06). Refused loudly instead.
    if (c.cluster_key === null || c.display_name === null) {
      throw new Error('readRunReport: a cluster of the run version is not readable');
    }
    return {
      clusterKey: c.cluster_key,
      displayName: c.display_name,
      found: c.found,
      attached: c.attached,
      tentative: c.tentative,
      unmatched: c.unmatched,
    };
  });

  const costMicroUsd = intOf(run.ledger_micro_usd, 'the run cost');

  return {
    run: {
      id: run.id,
      status: run.status,
      stoppedReason,
      kind: run.kind,
      partitionIndex: run.partition_index,
      presetId: run.preset_id,
      presetName: run.preset_name,
      versionNumber: run.version,
      createdMs: createdAt.getTime(),
      startedMs: instantOf(run.started_ms)?.getTime() ?? null,
      finishedMs: instantOf(run.finished_ms)?.getTime() ?? null,
      costMicroUsd,
      callsCount: run.calls_count,
      estimateRequestsLo: run.estimate_requests_lo,
      estimateRequestsHi: run.estimate_requests_hi,
      estimateMicroUsdLo: intOrNull(run.estimate_micro_usd_lo, 'estimate_micro_usd_lo'),
      estimateMicroUsdHi: intOrNull(run.estimate_micro_usd_hi, 'estimate_micro_usd_hi'),
      ceilingRequests: run.ceiling_requests,
      capMicroUsd: intOf(period.capMicroUsd.toString(), 'the monthly cap'),
      capResetMs: periodResetInstant(period.periodStart).getTime(),
      capPeriodStart: period.periodStart,
      capPeriodIsCurrent,
    },
    requests: {
      rows: skuRows.map((r) => ({
        sku: r.sku,
        requests: r.requests,
        freeThisMonth: r.free,
        costMicroUsd: intOf(r.micro_usd, `the ${r.sku} cost`),
      })),
      refusedByMeter,
      totalRequests: intOf(run.ledger_units, 'the ledgered requests') + refusedByMeter,
      totalMicroUsd: costMicroUsd,
    },
    tiles: {
      total: tileCounts.total,
      searched: tileCounts.searched,
      saturated: tileCounts.saturated,
      subdivided: tileCounts.subdivided,
      stillTruncated: tileCounts.truncated,
      truncated: truncatedRows.map((t) => ({
        tileKey: t.tile_key,
        cellKey: t.cell_key,
        placesType: t.places_type,
        why: t.truncated_why,
      })),
      stillSubdividing: stillSubdividing.map((t) => ({
        tileKey: t.tile_key,
        cellKey: t.cell_key,
        placesType: t.places_type,
      })),
    },
    outcomes: {
      found: outcomes.found,
      attached: outcomes.attached,
      tentative: outcomes.tentative,
      unmatched: outcomes.unmatched,
      byCluster,
      website: { listed, none, byHostClass },
    },
    changes,
  };
}

export async function getRunReport(claims: OrgClaims, runId: string): Promise<RunReport | null> {
  return withOrg(claims, (tx) => readRunReport(tx, runId));
}

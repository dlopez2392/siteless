import { auth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { PlacesModeNotice } from '@/components/preset-detail/places-mode-notice';
import {
  RECENT_RUNS_LIMIT,
  RecentRuns,
  type RecentRun,
} from '@/components/preset-detail/recent-runs';
import { RunActions, type RunActionsProps } from '@/components/preset-detail/run-actions';
import { presetRunCosts } from '@/components/preset-detail/run-costs';
import { planRunActions, RUN_KIND_OF_ACTION } from '@/components/preset-detail/run-plan';
import type { RunVersionOption } from '@/components/preset-detail/run-drawer';
import {
  estimateLineParts,
  estimateRangeLabel,
  estimateRequestsLabel,
  SummaryCard,
  type LastRun,
  type SummaryRunCost,
} from '@/components/preset-detail/summary-card';
import {
  describeVersionDiff,
  type DiffGeo,
  type DiffVersion,
} from '@/components/preset-detail/version-diff';
import {
  VersionHistory,
  type HistoryContext,
  type HistoryVersion,
} from '@/components/preset-detail/version-history';
import { withOrg } from '@/db/with-org';
import { env } from '@/env';
import { orgClaims } from '@/lib/auth/require-org';
import { formatUsd } from '@/lib/budget/money';
import { isUuid } from '@/lib/ids';
import { ESTIMATE_SKU } from '@/lib/estimate/assumptions';
import { estimatePreset, type EstimateRange } from '@/lib/estimate/estimate';
import type { PresetSpec } from '@/lib/estimate/expand-cells';
import { RUN_KIND_LABEL, type RunStatus } from '@/lib/ui/run-tone';
import {
  readCurrentPeriod,
  readUnitsUsedThisPeriod,
  requireInstant,
  rowsOf,
} from '@/server/queries/budget';
import {
  getSeedTables,
  readPreset,
  readReferenceIndex,
  resolveSpec,
  type PresetVersionRow,
  type ReferenceIndex,
} from '@/server/queries/presets';

export const dynamic = 'force-dynamic';

/**
 * The preset detail screen (UI-SPEC § Screen Inventory 3) — SRCH-03 and D-16 made
 * visible, and the only place in Phase 2 a budget reservation can be caused from a
 * browser.
 *
 * 🔴 T-2-10: AN UNKNOWN ID AND A FOREIGN ID ARE THE SAME ANSWER. `readPreset` reads
 * through `withOrg`, so RLS confines it to the caller's tenant and another org's preset
 * is simply not there — this page renders `notFound()` for both and never tells a
 * wrong-tenant caller that the resource exists. That is the whole mitigation; there is no
 * ownership check in this file, because a check here would be a second, weaker answer to
 * a question the database has already settled.
 *
 * 🔴 ONE TRANSACTION, NEVER NESTED. `src/db/client.ts` pools with `max: 1`, so a second
 * `withOrg` opened INSIDE a first one waits forever on a connection the outer transaction
 * is holding and the request HANGS rather than failing (02-09's deviation 7). Everything
 * this screen needs — the reference index, the preset, the meter, the units and the last
 * run — is read in the single `withOrg` below, which is exactly why the query module
 * exports `tx`-taking `read*` functions beside its `get*` convenience wrappers.
 *
 * 🔴 THREE WAYS TO RUN, ONE ACCENT AT MOST (04-UI-SPEC § Screen 2, Rules 33, 34, 40). "Run
 * full sweep", "Run this week's partition" and "Check for changes (free)" are rendered by
 * `RunActions` in two slots: the primary (title row on desk, sticky bar on phone — one element
 * moved by CSS) and the "Other ways to run" card. The accent goes to the first action the
 * Places mode enables, and there is none in `off`. "Edit preset" is secondary.
 *
 * 🔴 `PLACES_MODE` IS READ HERE, ON THE SERVER, AND ONLY PASSED ON AS A STRING (Rule 33, T-4-01).
 * It is never a `NEXT_PUBLIC_` variable and no client component imports `src/env.ts`. The
 * buttons are an affordance; `queueRun` refuses the same modes on its own (D-02, T-4-02).
 */

/** Cluster ids -> display names. A key (`auto_retail`) is never shown to a person
 *  (CONVENTIONS § Naming), so this resolves to `clusters.display_name` and falls back to
 *  the id rather than dropping a cluster silently out of the list. */
function clusterNamesOf(clusterIds: string[], index: ReferenceIndex): string[] {
  return clusterIds.map((id) => index.clusterById.get(id)?.displayName ?? id);
}

/**
 * A stored version row's geography, resolved to the names a diff sentence is made of.
 *
 * Counties are rendered `{name} County` — the seed stores the bare Census name ("Starr"),
 * and "Removed Starr" beside a city list containing "Mission" is ambiguous in exactly the
 * place SRCH-03 needs to be unambiguous.
 */
function diffGeoOf(version: PresetVersionRow, index: ReferenceIndex): DiffGeo {
  const payload = version.geoPayload;
  if (version.geoKind === 'cities' && 'cityIds' in payload) {
    return {
      kind: 'cities',
      names: payload.cityIds.map((id) => index.cityById.get(id)?.name ?? id),
    };
  }
  if (version.geoKind === 'counties' && 'countyIds' in payload) {
    return {
      kind: 'counties',
      names: payload.countyIds.map((id) => {
        const county = index.countyById.get(id);
        return county ? `${county.name} County` : id;
      }),
    };
  }
  if (version.geoKind === 'radius' && 'radiusMiles' in payload) {
    return {
      kind: 'radius',
      radiusMiles: payload.radiusMiles,
      matchedAddress: payload.matchedAddress,
    };
  }
  // The payload does not match its own `geo_kind`. Unreachable through the editor (the
  // shape is validated on write) and answered with an empty unit list, which
  // `geoHeadline` renders as "Geography unavailable" rather than as a preset that
  // searches nowhere.
  return { kind: 'cities', names: [] };
}

function diffVersionOf(version: PresetVersionRow, index: ReferenceIndex): DiffVersion {
  return {
    clusterNames: clusterNamesOf(version.clusterIds, index),
    geo: diffGeoOf(version, index),
  };
}

/**
 * 🔴 THIS PAGE USED TO CARRY ITS OWN `timestamptz` NORMALISER, AND IT IS GONE (WR-07).
 *
 * A `timestamptz` read through `tx.execute` arrives as postgres.js's own text —
 * `2026-09-22 11:49:28.864085-05` — not as a `Date`, because drizzle's column mapper runs
 * only for query-builder results. `Intl.DateTimeFormat.format(aString)` coerces with
 * `Number()`, gets `NaN`, and throws `RangeError: Invalid time value`: a 500 on the whole
 * page, with typecheck, lint and build green.
 *
 * This screen was the first to FORMAT one, so it grew a private normaliser that parsed the
 * text by hand. That fixed this page and left `listPresets` and the edit page still handing a
 * string to anything that called `formatLocal`, which is the defect WR-07 names. The cast now
 * happens once, in SQL, at the boundary in `src/server/queries/` — epoch milliseconds, cast
 * with the value — so every consumer gets a real `Date` and nobody parses a driver's text
 * format by hand. `src/server/queries/budget.ts` had already reached that conclusion for
 * bigint, for `date`, and for its own timestamps.
 */
type RawRecentRun = {
  id: string;
  kind: string;
  status: string;
  stopped_reason: string | null;
  cost: string;
  version: number;
  /** finished, else started, else created — "Last run {date}" on the summary card. */
  at_ms: string | null;
  /** started, else created — the recent-runs row's time. */
  started_ms: string | null;
};

/** The notice's element id. Every mode-disabled run action points `aria-describedby` at it. */
const NOTICE_ID = 'places-mode-notice';

export default async function PresetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // WR-08: shared with /presets/[id]/edit, which had no guard at all and answered a 500
  // where this route answered a 404, on the same mistyped url.
  if (!isUuid(id)) notFound();

  const claims = await orgClaims();

  // Affordance only, exactly as in the shell's banner: this decides which sentence a
  // refused reservation offers as its way out, never what a member is allowed to do. The
  // boundary is `app.set_budget_cap` plus the absent UPDATE grant on budget_periods
  // (T-2-02). Clerk spells the role `org:admin` in a session claim.
  const { orgRole } = await auth();
  const isAdmin = orgRole === 'org:admin';

  const data = await withOrg(claims, async (tx) => {
    const index = await readReferenceIndex(tx);
    const preset = await readPreset(tx, id, index);
    if (!preset) return null;

    const period = await readCurrentPeriod(tx, 'places');
    const units = await readUnitsUsedThisPeriod(tx, ESTIMATE_SKU, period.id);

    // The preset's most recent runs, across every version of it — the newest is the summary
    // card's "last run", all five are the "Recent runs" card. Read here rather than added to
    // `readPreset` because `src/server/queries/presets.ts` is shared with the list and the
    // editor, and a column added to a shared read for one screen is how three screens end up
    // paying for each other's joins. Same transaction as everything else (never nested).
    const recent = rowsOf<RawRecentRun>(
      await tx.execute(sql`
        select r.id,
               r.kind,
               r.status,
               r.stopped_reason,
               r.cost_micro_usd::text as cost,
               v.version,
               (extract(epoch from coalesce(r.finished_at, r.started_at, r.created_at))
                  * 1000)::bigint::text as at_ms,
               (extract(epoch from coalesce(r.started_at, r.created_at))
                  * 1000)::bigint::text as started_ms
          from runs r
          join search_versions v on v.id = r.search_version_id
         where v.search_id = ${id}
         order by r.created_at desc
         limit ${RECENT_RUNS_LIMIT}`),
    );

    return { preset, period, units, index, recent };
  });

  if (!data) notFound();
  const { preset, period, units, index, recent } = data;
  const lastRun = recent[0] ?? null;

  // D-02 / Rule 33: the kill switch, read on the server and handed on as a plain string.
  const placesMode = env.PLACES_MODE;

  const seed = getSeedTables();
  const estimateContext = {
    seed,
    unitsUsedThisPeriod: units,
    capMicroUsd: period.capMicroUsd,
    spentMicroUsd: period.spentMicroUsd,
    reservedMicroUsd: period.reservedMicroUsd,
  };

  /**
   * Every version priced against the SAME meter reading, in one pass.
   *
   * 🔴 NOT `estimate_snapshot`. The stored snapshot records what the estimator quoted at
   * the moment that version was saved — possibly last month, against a free allowance
   * since consumed — and re-presenting it here would show a quote nobody is being
   * offered. `queueRun` recomputes for the same reason; the number on this screen and the
   * number the reservation uses come from the same function over the same inputs.
   */
  function specOf(version: PresetVersionRow): PresetSpec | null {
    if (!version.spec) return null;
    const resolved = resolveSpec(version.spec, index, preset.displayName);
    return resolved.ok ? resolved.spec : null;
  }

  function estimateOf(version: PresetVersionRow): EstimateRange | null {
    const spec = specOf(version);
    if (!spec) return null;
    try {
      return estimatePreset(spec, estimateContext);
    } catch {
      // The estimator throws when a (cluster, geography) pair has no seeded outlet count.
      // A preset that cannot be priced is still a preset you can read and edit.
      return null;
    }
  }

  const current = preset.currentVersion;
  const currentEstimate = current ? estimateOf(current) : null;

  /**
   * The three run actions' cost lines, and this ISO week's partition (PLACE-04, D-16) — priced
   * by the same `cellsForRun` + `estimatePreset({ onlyCells })` `queueRun` admits with, against
   * the same meter reading as everything else on this screen. The week is the RGV's (APP_TZ).
   */
  const runCosts = presetRunCosts(current ? specOf(current) : null, estimateContext, new Date());

  const history: HistoryVersion[] = preset.versions.map((v, i) => {
    const range = estimateOf(v);
    // `preset.versions` is ordered `version desc`, so a version's PREDECESSOR is the next
    // element, not the previous one. Getting this backwards renders every diff inverted —
    // "Added" for everything that was removed — and still looks plausible on screen.
    const predecessor = preset.versions[i + 1];
    return {
      id: v.id,
      version: v.version,
      isCurrent: v.id === preset.currentVersionId,
      clauses: describeVersionDiff(
        predecessor ? diffVersionOf(predecessor, index) : null,
        diffVersionOf(v, index),
      ),
      clusterNames: clusterNamesOf(v.clusterIds, index),
      geo: diffGeoOf(v, index),
      usedByRuns: v.usedByRuns,
      createdAt: v.createdAt,
      costRange: range ? estimateRangeLabel(range) : null,
      requests: range ? estimateRequestsLabel(range) : null,
    };
  });

  const editHref = `/presets/${preset.id}/edit`;

  // What the drawer tells you is left before you commit to a run. `remaining` is
  // cap - spent - reserved, the same three numbers `app.reserve_budget` compares.
  const remaining = period.capMicroUsd - period.spentMicroUsd - period.reservedMicroUsd;
  const historyContext: HistoryContext = {
    presetName: preset.displayName,
    isAdmin,
    remainingLabel: `${formatUsd(remaining < 0n ? 0n : remaining)} of ${formatUsd(
      period.capMicroUsd,
    )}`,
    // C-CR-02: the version rows' "Run version N" obey the same mode as the run actions.
    placesMode,
    noticeId: NOTICE_ID,
  };

  const runOptions: RunVersionOption[] = history.map((v) => ({
    id: v.id,
    version: v.version,
    isCurrent: v.isCurrent,
    costRange: v.costRange,
    requests: v.requests,
  }));

  const lastRunProps: LastRun | null = lastRun
    ? {
        id: lastRun.id,
        status: lastRun.status as RunStatus,
        at: requireInstant(lastRun.at_ms, 'the last run timestamp'),
        costMicroUsd: BigInt(lastRun.cost),
      }
    : null;

  const recentRuns: RecentRun[] = recent.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    stoppedReason: r.stopped_reason,
    costMicroUsd: BigInt(r.cost),
    at: requireInstant(r.started_ms, 'a recent run timestamp'),
    version: Number(r.version),
  }));

  /**
   * One version option per run kind, for the drawer each action opens. The partition's drawer
   * must quote the PARTITION's range and the check's must show the full request count — the
   * drawer reads "Estimated cost" and "Requests" off the option it is given.
   */
  const currentOption = runOptions.find((o) => o.isCurrent) ?? null;
  const optionFor = (range: EstimateRange | null): RunVersionOption[] =>
    currentOption
      ? [
          {
            ...currentOption,
            costRange: range ? estimateRangeLabel(range) : null,
            requests: range ? estimateRequestsLabel(range) : null,
          },
        ]
      : [];

  // Accent and the summary's cost line follow the PRIMARY action: the first one the mode enables
  // (the change check in ids_only, the full sweep otherwise). So the three costs are all on
  // screen in every mode — two in the card, one beside the estimate.
  const { primary } = planRunActions(placesMode);
  const summaryRunCost: SummaryRunCost | null = current
    ? { kindLabel: RUN_KIND_LABEL[RUN_KIND_OF_ACTION[primary]], line: runCosts.lines[primary] }
    : null;

  const runActions: Omit<RunActionsProps, 'slot'> | null = preset.currentVersionId
    ? {
        mode: placesMode,
        noticeId: NOTICE_ID,
        costs: runCosts.lines,
        partition: runCosts.partition,
        drawer: {
          presetName: preset.displayName,
          editHref,
          initialVersionId: preset.currentVersionId,
          remainingLabel: historyContext.remainingLabel,
          isAdmin,
          versions: {
            full: runOptions,
            partition: optionFor(runCosts.ranges.partition),
            check: optionFor(runCosts.ranges.full),
          },
        },
      }
    : null;

  return (
    /* Extra bottom room on phone so the sticky run bar never sits on top of the last
       version row: the shell already clears the 64px tab bar, this clears the bar above it
       (and, in off mode, the one-line note under it). */
    <div
      className={`flex flex-col gap-6 sm:pb-0 ${placesMode === 'off' && runActions ? 'pb-28' : 'pb-20'}`}
    >
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/presets" data-testid="preset-breadcrumb-presets">
                Presets
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{preset.displayName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 data-testid="preset-name" className="text-xl font-semibold leading-tight">
          {preset.displayName}
        </h1>

        <div className="flex items-center gap-2">
          {/* Desk placement. The phone gets a full-width twin beneath the summary card,
              per UI-SPEC § Screen Inventory 3 — distinct testids because the touch-target
              check asserts exactly one VISIBLE match per hook.

              🔴 THE BREAKPOINT LIVES ON A WRAPPER, NOT ON THE BUTTON. `hidden` and the
              cva base's `inline-flex` are both unprefixed display utilities, so which one
              wins depends on their order in the generated stylesheet rather than on the
              order they are written here. A wrapper makes it a containment question
              instead of a cascade race. */}
          <span className="hidden sm:block">
            <Button asChild variant="outline" className="h-9">
              <Link href={editHref} data-testid="edit-preset">
                Edit preset
              </Link>
            </Button>
          </span>

          {/*
            🔴 THE PRIMARY RUN ACTION, one element in the DOM: the first action the mode
            enables (accent), or in `off` the inert full sweep (no accent). On a phone its
            wrapper lifts it into a sticky bar ABOVE the 64px tab bar; from 640px up it sits
            here in the title row. The other two actions are the "Other ways to run" card.
          */}
          {runActions ? <RunActions slot="primary" {...runActions} /> : null}
        </div>
      </div>

      {/* In `off` this is the screen's focal point; `enterprise` renders nothing. Rendered
          even without a runnable version: the recent-runs empty state points at it. */}
      <PlacesModeNotice mode={placesMode} id={NOTICE_ID} />

      {current ? (
        <SummaryCard
          version={current.version}
          isCurrent
          clusterNames={clusterNamesOf(current.clusterIds, index)}
          geo={diffGeoOf(current, index)}
          estimate={currentEstimate ? estimateLineParts(currentEstimate) : null}
          runCost={summaryRunCost}
          lastRun={lastRunProps}
        />
      ) : null}

      {/* Phone: "Edit preset" as a full-width secondary button directly under the summary
          card. */}
      <div className="sm:hidden">
        <Button asChild variant="outline" className="h-11 w-full">
          <Link href={editHref} data-testid="edit-preset-mobile">
            Edit preset
          </Link>
        </Button>
      </div>

      {runActions ? <RunActions slot="card" {...runActions} /> : null}

      <RecentRuns runs={recentRuns} mode={placesMode} />

      <VersionHistory versions={history} editHref={editHref} context={historyContext} />
    </div>
  );
}

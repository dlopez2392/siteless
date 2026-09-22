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
import {
  estimateLineParts,
  SummaryCard,
  type LastRun,
} from '@/components/preset-detail/summary-card';
import {
  describeVersionDiff,
  type DiffGeo,
  type DiffVersion,
} from '@/components/preset-detail/version-diff';
import {
  VersionHistory,
  type HistoryVersion,
} from '@/components/preset-detail/version-history';
import { withOrg } from '@/db/with-org';
import { orgClaims } from '@/lib/auth/require-org';
import { ESTIMATE_SKU } from '@/lib/estimate/assumptions';
import { estimatePreset, type EstimateRange } from '@/lib/estimate/estimate';
import type { RunStatus } from '@/lib/ui/run-tone';
import { readCurrentPeriod, readUnitsUsedThisPeriod, rowsOf } from '@/server/queries/budget';
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
 * 🔴 EXECUTOR RULE 10, ONE ACCENT ACTION: "Run this preset" is the single filled accent
 * button on this screen and it appears exactly ONCE in the DOM. "Edit preset" is
 * secondary. The phone's sticky-bottom placement and the desk's title-row placement are
 * the same element moved by CSS, not two buttons with one hidden.
 */

/** A uuid, before it reaches a `where id = ...`. Postgres answers a malformed uuid with
 *  `22P02 invalid input syntax`, which would surface as a 500 on a mistyped URL — a
 *  crash where the honest answer is "we couldn't find that preset". */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type RawLastRun = { status: string; cost: string; at: Date };

export default async function PresetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const claims = await orgClaims();

  const data = await withOrg(claims, async (tx) => {
    const index = await readReferenceIndex(tx);
    const preset = await readPreset(tx, id, index);
    if (!preset) return null;

    const period = await readCurrentPeriod(tx, 'places');
    const units = await readUnitsUsedThisPeriod(tx, ESTIMATE_SKU, period.id);

    // The preset's most recent run, across every version of it. Read here rather than
    // added to `readPreset` because `src/server/queries/presets.ts` is shared with the
    // plans building the list and the editor in this same wave, and a column added to a
    // shared read for one screen is how three screens end up paying for each other's
    // joins.
    const lastRun =
      rowsOf<RawLastRun>(
        await tx.execute(sql`
          select r.status,
                 r.cost_micro_usd::text as cost,
                 coalesce(r.finished_at, r.started_at, r.created_at) as at
            from runs r
            join search_versions v on v.id = r.search_version_id
           where v.search_id = ${id}
           order by r.created_at desc
           limit 1`),
      )[0] ?? null;

    return { preset, period, units, index, lastRun };
  });

  if (!data) notFound();
  const { preset, period, units, index, lastRun } = data;

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
  function estimateOf(version: PresetVersionRow): EstimateRange | null {
    if (!version.spec) return null;
    const resolved = resolveSpec(version.spec, index, preset.displayName);
    if (!resolved.ok) return null;
    try {
      return estimatePreset(resolved.spec, estimateContext);
    } catch {
      // The estimator throws when a (cluster, geography) pair has no seeded outlet count.
      // A preset that cannot be priced is still a preset you can read and edit.
      return null;
    }
  }

  const current = preset.currentVersion;
  const currentEstimate = current ? estimateOf(current) : null;

  const history: HistoryVersion[] = preset.versions.map((v, i) => {
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
    };
  });

  const editHref = `/presets/${preset.id}/edit`;

  const lastRunProps: LastRun | null = lastRun
    ? {
        status: lastRun.status as RunStatus,
        at: lastRun.at,
        costMicroUsd: BigInt(lastRun.cost),
      }
    : null;

  return (
    /* Extra bottom room on phone so the sticky run bar never sits on top of the last
       version row: the shell already clears the 64px tab bar, this clears the bar above it. */
    <div className="flex flex-col gap-6 pb-20 sm:pb-0">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
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
            🔴 THE ONE FILLED ACCENT BUTTON ON THIS SCREEN (Executor Rule 10), and one
            element in the DOM. On a phone the wrapper below lifts it into a sticky action
            bar sitting ABOVE the 64px tab bar and its safe-area inset; from 640px up it
            sits here in the title row. Plan 02-12 Task 2 wraps this trigger in the run
            drawer.
          */}
          <Button
            variant="default"
            data-testid="run-preset"
            className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 h-12 shadow-lg sm:static sm:inset-auto sm:h-9 sm:shadow-none"
          >
            Run this preset
          </Button>
        </div>
      </div>

      {current ? (
        <SummaryCard
          version={current.version}
          isCurrent
          clusterNames={clusterNamesOf(current.clusterIds, index)}
          geo={diffGeoOf(current, index)}
          estimate={currentEstimate ? estimateLineParts(currentEstimate) : null}
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

      <VersionHistory versions={history} editHref={editHref} />
    </div>
  );
}

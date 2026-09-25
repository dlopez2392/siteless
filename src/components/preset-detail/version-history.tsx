import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatLocal } from '@/lib/time';
import type { PlacesModeName } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import { DuplicateDialog } from './duplicate-dialog';
import { RunDrawer, type RunVersionOption } from './run-drawer';
// Server-safe (no directive): the mode table, never a copy of it that could drift.
import { MODE_ALLOWS } from './run-plan';
import { geoDetail, type DiffGeo } from './version-diff';

/**
 * SRCH-03 / D-16 made visible: every version this preset has ever had, what changed at
 * each one, and how many runs are still pointing at it.
 *
 * 🔴 `usedByRuns` IS A LIVE `count(*)`, COMPUTED IN THE QUERY (src/server/queries/presets.ts).
 * There is no denormalised counter column anywhere in this path and there must never be
 * one: the entire claim this screen makes is "this run searched for exactly this", and a
 * cached number that drifts out of agreement with the rows it counts turns that claim into
 * a decoration. `drizzle/0013` also keeps `runs.search_version_id` outside the column
 * grant, so a finished run cannot be re-pointed and the count cannot be gamed from the
 * client either (T-2-12).
 *
 * 🔴 A SERVER COMPONENT. The diff clauses and the dates are computed on the server and
 * arrive as props; the row actions are small client islands (Task 2), so the table
 * itself never ships to the browser and the diff sentences cannot be recomputed
 * client-side into disagreeing with the server's.
 *
 * 🔴 ROW ACTIONS ARE TEXT BUTTONS, NEVER ICON-ONLY (UI-SPEC § Screen Inventory 3). "Run
 * version 2" and "Duplicate from version 2" name the version they act on, because on this
 * screen every row looks the same except for a number and an icon would make the
 * consequential choice the ambiguous one.
 */

export type HistoryVersion = {
  id: string;
  version: number;
  isCurrent: boolean;
  /** From `describeVersionDiff`, already resolved to display names. */
  clauses: string[];
  clusterNames: string[];
  geo: DiffGeo;
  usedByRuns: number;
  createdAt: Date;
  /** Priced on the server against the CURRENT meter reading, not from
   *  `estimate_snapshot`. `null` when this version cannot be priced. */
  costRange: string | null;
  requests: string | null;
};

/** Everything the two row dialogs need that is the same for every row. Passed once rather
 *  than repeated on each `HistoryVersion`, so "which preset am I duplicating" cannot end
 *  up answered differently on two rows of the same table. */
export type HistoryContext = {
  presetName: string;
  isAdmin: boolean;
  remainingLabel: string;
  /** C-CR-02: `env.PLACES_MODE`, read by the page on the server and passed as a string (Rule
   *  33). A row's "Run version N" is a full sweep, so it is inert wherever the mode refuses
   *  one — exactly like the page's own run actions. */
  placesMode: PlacesModeName;
  /** The Places-mode notice's element id; every mode-disabled row action is described by it. */
  noticeId: string;
};

/** The same inert look as `run-actions.tsx`'s mode-disabled buttons. */
const DISABLED_CLASS = 'cursor-not-allowed opacity-50';

/** Which of the two presentations a hook belongs to. The desk table keeps the canonical
 *  `version-row-` prefix that `tests/e2e/preset-detail.spec.ts` drives. */
export type Surface = 'row' | 'card';

/** UI-SPEC § Copy Table → preset detail → "Used by". Three sentences, and "No runs yet"
 *  rather than "0" — a zero in a column of counts reads as missing data. */
export function usedByLabel(n: number): string {
  if (n === 0) return 'No runs yet';
  return n === 1 ? '1 run' : `${n} runs`;
}

function CreatedAt({ at }: { at: Date }) {
  // Zone pinned through src/lib/time.ts. A version timestamp is exactly the kind of date
  // that renders a day early across the Americas when a bare formatter picks the system
  // zone, and "which version was live on the 1st" is a question this table has to answer.
  return (
    <span className="tabular-nums">
      {formatLocal(at, { month: 'short', day: 'numeric', year: 'numeric' })}
    </span>
  );
}

/**
 * The Collapsible that reveals a version's full cluster and geography detail beside its
 * diff sentence. Inside the cell rather than as a second table row: a Collapsible renders
 * a div, and a div wrapping two <tr>s is invalid markup that browsers silently reparent.
 *
 * 🔴 `surface` KEEPS THE DESK AND PHONE HOOKS DISTINCT. Both presentations are in the DOM
 * at once and CSS picks one, so a shared testid would match twice — and the repo's
 * touch-target check asserts exactly ONE visible match per hook for exactly this reason.
 */
function VersionDetail({ version, surface }: { version: HistoryVersion; surface: Surface }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        data-testid={`version-${surface}-${version.version}-detail`}
        className="inline-flex h-11 items-center text-sm font-normal text-muted-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-9"
      >
        What this version searches for
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-2 text-sm font-normal text-muted-foreground">
        <p>{version.clusterNames.join(' · ')}</p>
        <p>{geoDetail(version.geo)}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The two row actions, as TEXT buttons naming the version they act on.
 *
 * 🔴 NEVER ICON-ONLY (UI-SPEC § Screen Inventory 3). Every row on this screen looks
 * identical except for a number, so an icon would make the consequential choice — which
 * version am I about to spend money on — the ambiguous one.
 *
 * 44px on phone, 36px from 640px up (Executor Rule 9 / MOB-01). Plan 02-12 Task 2 wraps
 * each of these in its client dialog trigger; the labels and the hooks are fixed here so
 * that wrapping cannot quietly reword them.
 */
function RowActions({
  version,
  surface,
  context,
  options,
  editHref,
}: {
  version: HistoryVersion;
  surface: Surface;
  context: HistoryContext;
  options: RunVersionOption[];
  editHref: string;
}) {
  const runTestId = `version-${surface}-${version.version}-run`;
  // 🔴 C-CR-02 / Rule 33. In `off` and `ids_only` a full sweep cannot run, so the row's button
  // is `aria-disabled`, focusable, described by the Places-mode notice, and opens NOTHING — no
  // drawer, so no "switched off after this page loaded" sentence about a mode that was already
  // off when the page loaded, and no reload loop. A server component can't attach a click
  // handler, and it needs none: a `type="button"` outside a form with no handler is a no-op.
  // `queueRun` still refuses on its own (D-02); this is the affordance, not the boundary.
  const runnable = MODE_ALLOWS[context.placesMode].full;
  return (
    <>
      {runnable ? (
        /* D-16's "any version is re-runnable, explicitly". `pickable` is true here because
           the reader arrived from a specific row and may want to change their mind — from
           the primary CTA there is nothing to pick. */
        <RunDrawer
          kind="full"
          presetName={context.presetName}
          editHref={editHref}
          versions={options}
          initialVersionId={version.id}
          pickable
          remainingLabel={context.remainingLabel}
          isAdmin={context.isAdmin}
        >
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            data-testid={runTestId}
            data-enabled="true"
          >
            Run version {version.version}
          </Button>
        </RunDrawer>
      ) : (
        <Button
          type="button"
          variant="outline"
          className={cn('h-11 sm:h-9', DISABLED_CLASS)}
          data-testid={runTestId}
          data-enabled="false"
          aria-disabled="true"
          aria-describedby={context.noticeId}
        >
          Run version {version.version}
        </Button>
      )}

      {/* D-17. `Copy of {name}` is derived from the preset's own display name, the same
          string `duplicate-preset.ts` derives it from when the field is left untouched. */}
      <DuplicateDialog
        fromVersionId={version.id}
        fromVersion={version.version}
        defaultName={`Copy of ${context.presetName}`}
        estimateLabel={version.costRange}
      >
        <Button
          variant="ghost"
          className="h-11 sm:h-9"
          data-testid={`version-${surface}-${version.version}-duplicate`}
        >
          Duplicate from version {version.version}
        </Button>
      </DuplicateDialog>
    </>
  );
}

function CurrentBadge() {
  // 🔴 § Color, accent list item 7: accent outline, accent text, NO fill — and the only
  // badge in the whole product that carries accent.
  return (
    <Badge variant="outline" className="border-primary text-primary">
      Current
    </Badge>
  );
}

export function VersionHistory({
  versions,
  editHref,
  context,
}: {
  /** Newest first, as `readPreset` orders them. */
  versions: HistoryVersion[];
  editHref: string;
  context: HistoryContext;
}) {
  const onlyOneVersion = versions.length === 1;

  // Built once and handed to every row's drawer, so the picker inside any row offers the
  // same set of versions at the same prices.
  const options: RunVersionOption[] = versions.map((v) => ({
    id: v.id,
    version: v.version,
    isCurrent: v.isCurrent,
    costRange: v.costRange,
    requests: v.requests,
  }));

  return (
    <Card data-testid="version-history">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Version history</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Desk. Hidden rather than unmounted below 640px so the phone list can be the
            one that renders — two presentations of the same server-rendered data, never
            two sources of it. */}
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="tabular-nums">Version</TableHead>
                <TableHead>What changed</TableHead>
                <TableHead className="text-right tabular-nums">Used by</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.id} data-testid={`version-row-${v.version}`}>
                  <TableCell className="align-top tabular-nums">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{v.version}</span>
                      {v.isCurrent ? <CurrentBadge /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <p data-testid={`version-row-${v.version}-diff`} className="text-balance">
                      {v.clauses.join(' · ')}
                    </p>
                    <VersionDetail version={v} surface="row" />
                  </TableCell>
                  {/* 🔴 THE COUNT IS ALSO AN ATTRIBUTE, and that is what the e2e spec
                      asserts on. The sentence is UI-SPEC copy and may be reworded; the
                      NUMBER is SRCH-03's actual claim ("this run is still pointing at
                      that version"), so the test pins the number and stays honest through
                      a copy change instead of breaking on one. */}
                  <TableCell
                    data-testid={`version-row-${v.version}-used-by`}
                    data-used-by-count={v.usedByRuns}
                    className="text-right align-top tabular-nums"
                  >
                    {usedByLabel(v.usedByRuns)}
                  </TableCell>
                  <TableCell className="align-top">
                    <CreatedAt at={v.createdAt} />
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <RowActions
                        version={v}
                        surface="row"
                        context={context}
                        options={options}
                        editHref={editHref}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Phone: the same fields as label/value rows, one Item per version. */}
        <ItemGroup className="sm:hidden">
          {versions.map((v, i) => (
            <div key={v.id}>
              {i > 0 ? <ItemSeparator /> : null}
              <Item
                data-testid={`version-card-${v.version}`}
                className="flex-col items-start gap-2 px-0"
              >
                <ItemContent className="w-full">
                  <div className="flex flex-wrap items-center gap-2">
                    <ItemTitle className="text-base font-semibold tabular-nums">
                      Version {v.version}
                    </ItemTitle>
                    {v.isCurrent ? <CurrentBadge /> : null}
                  </div>

                  <p
                    data-testid={`version-card-${v.version}-diff`}
                    className="text-sm font-normal text-balance"
                  >
                    {v.clauses.join(' · ')}
                  </p>

                  <p className="text-sm font-normal text-muted-foreground">
                    <span
                      data-testid={`version-card-${v.version}-used-by`}
                      data-used-by-count={v.usedByRuns}
                      className="tabular-nums"
                    >
                      {usedByLabel(v.usedByRuns)}
                    </span>
                    {' · '}
                    <CreatedAt at={v.createdAt} />
                  </p>

                  <VersionDetail version={v} surface="card" />

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RowActions
                      version={v}
                      surface="card"
                      context={context}
                      options={options}
                      editHref={editHref}
                    />
                  </div>
                </ItemContent>
              </Item>
            </div>
          ))}
        </ItemGroup>

        {/*
          UI-SPEC § Empty → "Version history, single version".

          🔴 IT SITS BENEATH THE ROW RATHER THAN REPLACING IT. Version 1 is real data and
          its "Used by" count is the entire point of SRCH-03 for a preset that has run
          once — hiding the only row to show an empty state would delete the answer in
          order to explain that there is only one of it (Executor Rule 11).
        */}
        {onlyOneVersion ? (
          <Empty data-testid="version-history-single">
            <EmptyHeader>
              <EmptyTitle className="text-xl font-semibold">
                Version 1 is the only version so far
              </EmptyTitle>
              <EmptyDescription className="max-w-[60ch] text-base font-normal">
                Edit this preset and Siteless saves version 2 automatically. Runs that
                already finished keep pointing at the version that produced them.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline" className="h-11">
                <Link href={editHref} data-testid="version-history-edit">
                  Edit preset
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
      </CardContent>
    </Card>
  );
}

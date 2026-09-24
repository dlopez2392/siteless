import { MapPinOff } from 'lucide-react';
import Link from 'next/link';
import { GoogleMapsTag } from '@/components/places/google-maps-tag';
import { CountGrid, RUN_CARD_CLASS, RunCardTitle } from '@/components/runs/tiles-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemGroup } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount } from '@/lib/time';
import {
  RUN_CLUSTER_COLUMN,
  RUN_CLUSTER_FOOTNOTE,
  RUN_MATCHING_COUNT,
  RUN_OPEN_PRESET,
  RUN_OUTCOMES_NONE_REACHED_BODY,
  RUN_OUTCOMES_NONE_REACHED_HEADING,
  RUN_REPORT_CARD,
  RUN_RESULTS_PENDING_BODY,
  RUN_RESULTS_PENDING_HEADING,
  RUN_REVIEW_LINK,
  RUN_WEBSITE_ROW,
  RUN_WEBSITE_TITLE,
  RUN_ZERO_PLACES_BODY,
  RUN_ZERO_PLACES_HEADING,
} from '@/lib/ui/copy';
import { HOST_CLASS_ORDER, hostClassLabel } from '@/lib/ui/places-format';
import type { RunReport } from '@/server/queries/run-report';

/**
 * The run report's Outcomes card (04-UI-SPEC § Screen 1 → Outcomes; D-06, D-08, D-09): Matching,
 * By cluster, and Website on Google, separated by `Separator`.
 *
 * 🔴 PLACES-DERIVED, SO IT CARRIES THE GOOGLE MAPS TAG (Executor Rule 28; PLACE-06). The card is
 * the `[data-places-content]` container and one `GoogleMapsTag` sits at its foot. This file
 * imports `places-format.ts`, and 04-28's repo walk requires every such file to import the tag.
 *
 * 🔴 HOST CLASSES ARE WORDS, NEVER COLOURS (D-09, § Color). Every website row has the same
 * foreground label and foreground count; the order is `HOST_CLASS_ORDER`, fixed, never sorted by
 * count, so a row stays in the same place from run to run.
 *
 * 🔴 EVERY CLUSTER OF THE VERSION, ZEROS INCLUDED (D-06). The per-cluster "Matched nothing" is how
 * the Comptroller/Overture coverage gap is measured; a cluster that found nothing is a finding,
 * not an absence.
 *
 * 🔴 DESK AND PHONE ARE TWO TREES WITH DISTINCT TESTIDS (`run-cluster-row-*` vs
 * `run-cluster-card-*`; `/spend` By-run's rule). CSS hides one; a shared testid would make every
 * e2e lookup ambiguous.
 *
 * No client-boundary directive: a server component.
 */

const LIVE: ReadonlySet<string> = new Set(['queued', 'running']);

function Matching({ outcomes }: { outcomes: RunReport['outcomes'] }) {
  return (
    <CountGrid
      cells={[
        {
          key: 'found',
          testId: 'run-outcome-found',
          label: RUN_MATCHING_COUNT.found,
          n: outcomes.found,
        },
        {
          key: 'attached',
          testId: 'run-outcome-attached',
          label: RUN_MATCHING_COUNT.attached,
          n: outcomes.attached,
        },
        {
          key: 'tentative',
          testId: 'run-outcome-tentative',
          label: RUN_MATCHING_COUNT.tentative,
          n: outcomes.tentative,
          // An inline link inside body copy is accent (§ Accent item 6).
          below:
            outcomes.tentative > 0 ? (
              <Link
                href="/review?kind=google"
                data-testid="run-review-link"
                className="inline-flex min-h-11 items-center rounded-sm text-sm font-normal text-primary underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {RUN_REVIEW_LINK(outcomes.tentative)}
              </Link>
            ) : null,
        },
        {
          key: 'unmatched',
          testId: 'run-outcome-unmatched',
          label: RUN_MATCHING_COUNT.unmatched,
          n: outcomes.unmatched,
        },
      ]}
    />
  );
}

type Cluster = RunReport['outcomes']['byCluster'][number];

const CLUSTER_COUNTS = ['found', 'attached', 'tentative', 'unmatched'] as const;

function clusterData(c: Cluster): Record<string, number> {
  return {
    'data-found': c.found,
    'data-attached': c.attached,
    'data-tentative': c.tentative,
    'data-unmatched': c.unmatched,
  };
}

function ByCluster({ clusters }: { clusters: Cluster[] }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Desk: one table row per cluster, counts right-aligned. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-sm font-semibold">{RUN_CLUSTER_COLUMN.cluster}</TableHead>
              {CLUSTER_COUNTS.map((k) => (
                <TableHead key={k} className="text-right text-sm font-semibold">
                  {RUN_CLUSTER_COLUMN[k]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {clusters.map((c) => (
              <TableRow
                key={c.clusterKey}
                data-testid={`run-cluster-row-${c.clusterKey}`}
                {...clusterData(c)}
              >
                <TableCell className="text-sm font-normal whitespace-normal">
                  {c.displayName}
                </TableCell>
                {CLUSTER_COUNTS.map((k) => (
                  <TableCell key={k} className="text-right text-sm font-normal tabular-nums">
                    {formatCount(c[k])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phone: a card per cluster, the four counts as a 2×2 label/value grid. */}
      <ItemGroup className="gap-2 sm:hidden">
        {clusters.map((c) => (
          <Item
            key={c.clusterKey}
            role="listitem"
            variant="outline"
            data-testid={`run-cluster-card-${c.clusterKey}`}
            {...clusterData(c)}
            className="flex-col items-stretch gap-2 p-4"
          >
            <p className="text-base font-semibold">{c.displayName}</p>
            <dl className="grid grid-cols-2 gap-2">
              {CLUSTER_COUNTS.map((k) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-sm font-semibold">{RUN_CLUSTER_COLUMN[k]}</dt>
                  <dd className="text-base font-semibold tabular-nums">{formatCount(c[k])}</dd>
                </div>
              ))}
            </dl>
          </Item>
        ))}
      </ItemGroup>

      <p className="max-w-[70ch] text-sm font-normal text-muted-foreground">
        {RUN_CLUSTER_FOOTNOTE}
      </p>
    </div>
  );
}

function WebsiteRow({
  testId,
  label,
  n,
  indented,
}: {
  testId: string;
  label: string;
  n: number;
  indented?: boolean;
}) {
  // Every row the same colour: foreground label, foreground count (§ New Phase 4 elements).
  return (
    <div
      data-testid={testId}
      data-count={n}
      className={
        indented
          ? 'flex items-baseline justify-between gap-4 pl-4 text-sm font-normal'
          : 'flex items-baseline justify-between gap-4 text-base font-normal'
      }
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatCount(n)}</dd>
    </div>
  );
}

function Website({ website }: { website: RunReport['outcomes']['website'] }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="run-website-title">
      <h3 id="run-website-title" className="text-base font-semibold">
        {RUN_WEBSITE_TITLE}
      </h3>
      <dl className="flex flex-col gap-1">
        <WebsiteRow testId="run-website-listed" label={RUN_WEBSITE_ROW.listed} n={website.listed} />
        {HOST_CLASS_ORDER.map((hostClass) => (
          <WebsiteRow
            key={hostClass}
            testId={`run-host-class-${hostClass}`}
            label={hostClassLabel(hostClass)}
            n={website.byHostClass[hostClass]}
            indented
          />
        ))}
        <WebsiteRow testId="run-website-none" label={RUN_WEBSITE_ROW.none} n={website.none} />
      </dl>
    </section>
  );
}

export function OutcomesCard({
  run,
  outcomes,
}: {
  run: RunReport['run'];
  outcomes: RunReport['outcomes'];
}) {
  const live = LIVE.has(run.status);
  const empty = outcomes.found === 0;
  // 🔴 C-CR-03. "Every tile was searched and none returned a listing" is only true of a run that
  // COMPLETED. A failed or stopped-early run with nothing found (a missing key, the cap, the
  // daily limit, never started, abandoned) says so instead, and defers to the stop alert.
  const finishedClean = run.status === 'complete';

  const openPreset = (
    <EmptyContent>
      <Button asChild variant="outline" className="h-11 px-4 text-base font-normal">
        <Link href={`/presets/${run.presetId}`} data-testid="run-outcomes-open-preset">
          {RUN_OPEN_PRESET(run.presetName)}
        </Link>
      </Button>
    </EmptyContent>
  );

  return (
    <Card data-testid="run-outcomes" data-places-content className={RUN_CARD_CLASS}>
      <CardHeader>
        <RunCardTitle>{RUN_REPORT_CARD.outcomes}</RunCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {empty && live ? (
          // Inline, not a full `Empty`: the page refreshes itself, so there is no action.
          <div data-testid="run-outcomes-pending" className="flex flex-col gap-1">
            <p className="text-xl font-semibold leading-tight">{RUN_RESULTS_PENDING_HEADING}</p>
            <p className="max-w-[60ch] text-base font-normal text-muted-foreground">
              {RUN_RESULTS_PENDING_BODY}
            </p>
          </div>
        ) : empty && finishedClean ? (
          <Empty data-testid="run-outcomes-empty" className="py-12">
            <EmptyHeader>
              <EmptyMedia
                variant="icon"
                className="size-12 rounded-full bg-muted text-muted-foreground"
              >
                <MapPinOff aria-hidden="true" className="size-6" />
              </EmptyMedia>
              <EmptyTitle className="text-xl font-semibold leading-tight">
                {RUN_ZERO_PLACES_HEADING}
              </EmptyTitle>
              <EmptyDescription className="max-w-[60ch] text-base font-normal">
                {RUN_ZERO_PLACES_BODY}
              </EmptyDescription>
            </EmptyHeader>
            {openPreset}
          </Empty>
        ) : empty ? (
          <Empty data-testid="run-outcomes-none-reached" className="py-12">
            <EmptyHeader>
              <EmptyMedia
                variant="icon"
                className="size-12 rounded-full bg-muted text-muted-foreground"
              >
                <MapPinOff aria-hidden="true" className="size-6" />
              </EmptyMedia>
              <EmptyTitle className="text-xl font-semibold leading-tight">
                {RUN_OUTCOMES_NONE_REACHED_HEADING}
              </EmptyTitle>
              <EmptyDescription className="max-w-[60ch] text-base font-normal">
                {RUN_OUTCOMES_NONE_REACHED_BODY}
              </EmptyDescription>
            </EmptyHeader>
            {openPreset}
          </Empty>
        ) : (
          <>
            <Matching outcomes={outcomes} />
            <Separator />
            <ByCluster clusters={outcomes.byCluster} />
            <Separator />
            <Website website={outcomes.website} />
          </>
        )}

        <p className="text-sm">
          <GoogleMapsTag />
        </p>
      </CardContent>
    </Card>
  );
}

import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { ChangesCard } from '@/components/runs/changes-card';
import { OutcomesCard } from '@/components/runs/outcomes-card';
import { RequestsCard } from '@/components/runs/requests-card';
import { RunAlerts } from '@/components/runs/run-alerts';
import { RunHeader } from '@/components/runs/run-header';
import { TilesCard } from '@/components/runs/tiles-card';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '@/components/ui/empty';
import {
  PLACES_ACTION,
  RUN_REPORT_FOOTNOTE,
  RUN_REPORT_SUBTITLE,
  RUN_REPORT_TITLE,
} from '@/lib/ui/copy';
import type { RunReport } from '@/server/queries/run-report';

/**
 * `/runs/[id]` — the run report body (04-UI-SPEC § Screen 1; D-15, D-16, D-17; criteria 3, 5).
 *
 * It answers four questions, in this order: is it done? what did it cost against what we said?
 * did Google truncate anything? what did we find? Hierarchy: title → header card → [stop alert]
 * → [truncation warning] → Requests → Tiles → Outcomes (or Changes) → footnote.
 *
 * 🔴 A SERVER COMPONENT, NO CLIENT-BOUNDARY DIRECTIVE. Everything it renders comes from ONE
 * `RunReport` read by the page; `RunAutoRefresh` (inside the header) re-renders this tree with
 * `router.refresh()` every 5 s while the run is live. Nothing here fetches, and nothing here
 * keeps a client cache.
 *
 * 🔴 STABLE KEYS BY SECTION ID (§ Accessibility: "a refresh must not re-mount an opened
 * Collapsible"). Each section is keyed by a constant string, never by a render counter.
 *
 * 🔴 A REFUSED RUN SHOWS ONLY ITS HEADER AND ITS ALERT (§ States → Running / terminal). There
 * was never a request, a tile or a place — three cards of zeros would read as "it ran and found
 * nothing", which is a different claim.
 */
export function RunReportView({
  report,
  renderedAtMs,
  canRaiseCap,
}: {
  report: RunReport;
  /** `Date.now()` on the server at render time. */
  renderedAtMs: number;
  /** The viewer is an org admin — which way out the cap alerts offer (affordance only). */
  canRaiseCap: boolean;
}) {
  const { run, tiles } = report;
  const refused = run.status === 'refused';

  return (
    <div
      data-testid="run-report"
      data-status={run.status}
      className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 sm:gap-6"
    >
      <header key="title" className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold leading-tight">{RUN_REPORT_TITLE}</h1>
        <p className="text-sm font-normal text-muted-foreground">
          {RUN_REPORT_SUBTITLE(run.presetName, run.versionNumber)}
        </p>
      </header>

      <RunHeader key="header" run={run} tiles={tiles} renderedAtMs={renderedAtMs} />

      <RunAlerts
        key="alerts"
        run={run}
        tiles={tiles}
        canRaiseCap={canRaiseCap}
        renderedAtMs={renderedAtMs}
      />

      {refused ? null : <RequestsCard key="requests" requests={report.requests} />}
      {refused ? null : <TilesCard key="tiles" tiles={tiles} stoppedReason={run.stoppedReason} />}
      {refused ? null : report.changes ? (
        <ChangesCard key="changes" changes={report.changes} />
      ) : (
        <OutcomesCard key="outcomes" run={run} outcomes={report.outcomes} />
      )}

      <p key="footnote" className="text-sm font-normal text-muted-foreground">
        {RUN_REPORT_FOOTNOTE}
      </p>
    </div>
  );
}

/**
 * The body for a run that cannot be shown: a malformed id (`RUN_REPORT_BAD_ID`, rendered inline
 * by the page) or an unknown / foreign one (`RUN_REPORT_NOT_FOUND`, via `not-found.tsx`). Each
 * error names the problem and ends with a way out (§ States → Error).
 *
 * 🔴 UNKNOWN AND FOREIGN ARE ONE ANSWER (T-4-06). The read is RLS-scoped, so another org's run
 * is simply absent; both render the same words, and nothing confirms a row exists elsewhere.
 */
export function RunReportUnavailable({ message, testId }: { message: string; testId: string }) {
  return (
    <Empty data-testid={testId} className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-full bg-muted text-muted-foreground">
          <SearchX aria-hidden="true" className="size-6" />
        </EmptyMedia>
        <EmptyDescription className="max-w-[60ch] text-base font-normal">
          {message}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" className="h-11 px-4 text-base font-normal">
          <Link href="/spend" data-testid={`${testId}-open-spend`}>
            {PLACES_ACTION.openSpend}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

import { History } from 'lucide-react';
import Link from 'next/link';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemActions, ItemContent } from '@/components/ui/item';
import { formatUsd } from '@/lib/budget/money';
import { formatLocal } from '@/lib/time';
import {
  PRESET_CARD,
  PRESET_RECENT_RUN_META,
  PRESET_RECENT_RUNS_EMPTY_BODY,
  PRESET_RECENT_RUNS_EMPTY_BODY_OFF,
  PRESET_RECENT_RUNS_EMPTY_HEADING,
  PRESET_RECENT_RUNS_FOOTER,
  STOPPED_REASON,
  type PlacesModeName,
} from '@/lib/ui/copy';
import { RUN_KIND_LABEL, type RunKind, type StoppedReason } from '@/lib/ui/run-tone';

/**
 * "Recent runs" on the preset page (04-UI-SPEC § Screen 2, Open Question 15): the five newest
 * runs across every version of this preset, newest first, each a link to its report.
 *
 * 🔴 SERVER-SAFE: NO CLIENT-BOUNDARY DIRECTIVE. The page renders it with `bigint` money and real
 * `Date`s, neither of which may cross into a client component.
 *
 * 🔴 KEYS NEVER RENDER (Rule 35). `kind` and `stopped_reason` are machine keys in the database;
 * they pass through `RUN_KIND_LABEL` and `STOPPED_REASON`, and a key either map lacks renders
 * NOTHING rather than itself — there is deliberately no `?? key` fallback. The stopped sentence
 * shows for `partial` only, as on `/spend`: a refused run's reason is its badge.
 *
 * The status is `RunStatusBadge` — the one badge `/spend` and the run report use — so a status
 * reads the same word and tone on all three screens. Dates go through `formatLocal` (APP_TZ).
 */
export type RecentRun = {
  id: string;
  kind: string;
  status: string;
  stoppedReason: string | null;
  costMicroUsd: bigint;
  /** When the run started (or was created, if it never started). */
  at: Date;
  version: number;
};

export const RECENT_RUNS_LIMIT = 5;

function reasonOf(run: RecentRun): string | null {
  if (run.status !== 'partial' || !run.stoppedReason) return null;
  return STOPPED_REASON[run.stoppedReason as StoppedReason] ?? null;
}

function RecentRunRow({ run }: { run: RecentRun }) {
  const started = formatLocal(run.at, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const kind = RUN_KIND_LABEL[run.kind as RunKind] ?? null;
  const reason = reasonOf(run);
  return (
    <li>
      <Item asChild className="min-h-11 gap-4 px-2 py-2">
        <Link href={`/runs/${run.id}`} data-testid={`preset-run-row-${run.id}`}>
          <ItemContent className="min-w-0 gap-1">
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {PRESET_RECENT_RUN_META(started, kind, run.version)}
            </span>
            {reason ? (
              <span className="text-sm font-normal text-muted-foreground">{reason}</span>
            ) : null}
          </ItemContent>
          <ItemActions className="gap-4">
            <span className="text-base font-semibold tabular-nums">
              {formatUsd(run.costMicroUsd)}
            </span>
            <RunStatusBadge status={run.status} testId={`preset-run-status-${run.id}`} />
          </ItemActions>
        </Link>
      </Item>
    </li>
  );
}

export function RecentRuns({ runs, mode }: { runs: RecentRun[]; mode: PlacesModeName }) {
  // The query already orders and limits; this holds the claim for any caller.
  const shown = [...runs]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, RECENT_RUNS_LIMIT);

  return (
    <Card data-testid="preset-recent-runs">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{PRESET_CARD.recentRuns}</CardTitle>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <Empty data-testid="preset-recent-runs-empty" className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-xl font-semibold">
                {PRESET_RECENT_RUNS_EMPTY_HEADING}
              </EmptyTitle>
              <EmptyDescription className="max-w-[60ch] text-base font-normal">
                {mode === 'off' ? PRESET_RECENT_RUNS_EMPTY_BODY_OFF : PRESET_RECENT_RUNS_EMPTY_BODY}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {shown.map((run) => (
              <RecentRunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter>
        <Link
          href="/spend"
          data-testid="preset-recent-runs-spend"
          className="inline-flex min-h-11 items-center text-sm font-normal text-primary underline underline-offset-4"
        >
          {PRESET_RECENT_RUNS_FOOTER}
        </Link>
      </CardFooter>
    </Card>
  );
}

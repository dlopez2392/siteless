import { Merge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { formatLocal } from '@/lib/time';
import {
  BUSINESS_SECTION,
  MERGE_REASON_AUTO,
  MERGE_REASON_REVIEW,
  MERGE_ROW,
  MERGE_UNDONE,
  MERGES_EMPTY_BODY,
  MERGES_EMPTY_HEADING,
  UNMERGE_ACTION,
} from '@/lib/ui/copy';
import { UnmergeDialog } from './unmerge-dialog';

/**
 * "Merge history" (03-UI-SPEC § 4, section 4; D-20) — one row per merge, NEWEST FIRST, as
 * `readBusinessDetail` orders them (`merged_at desc, id desc`). This component does not
 * re-sort: the order is the query's, and a second ordering here could disagree with it.
 *
 * Each row: "{loser} merged into {winner}", then the reason ("Auto-merged at 97" /
 * "Reviewed by danlo") and the time in America/Chicago through `formatLocal`.
 *
 * 🔴 EACH ACTIVE ROW CARRIES A NAMED TEXT ACTION, "Unmerge {loser}" — destructive OUTLINE,
 * never icon-only. On a screen of near-identical rows the consequential choice must be the
 * unambiguous one. It opens `UnmergeDialog`, which always confirms. Unmerge is last-in-first-
 * out: if a later merge into the same winner is still active, the server refuses and the
 * dialog shows that sentence (`UNMERGE_LATER_MERGE_FIRST`) — the button is not hidden, because
 * hiding it would leave the reader guessing why this merge has no way back.
 *
 * An undone row reads "Unmerged by {actor} on {date}" in muted Label and carries no action.
 *
 * Props follow `version-history.tsx`: a per-row type plus one shared context object passed
 * once, so "which record am I looking at" cannot be answered differently on two rows. The
 * two lead keys are per-merge facts (a winner with two merges has two different losers), so
 * they travel on the row, not in the context.
 *
 * 🔴 A SERVER COMPONENT. The rows are rendered on the server; only the dialog is a client
 * island, and its strings come from `src/lib/ui/copy.ts`, never from a client module.
 */

export type MergeRow = {
  mergeId: string;
  loserName: string;
  winnerName: string;
  /** The loser's own lead key — restored to it by an unmerge. */
  loserKey: string;
  /** The winner's lead key — the survivor keeps it (D-19). */
  winnerKey: string;
  reason: 'auto' | 'review';
  score: number | null;
  /** Who merged, already resolved to a readable name by the route. */
  actor: string;
  mergedAt: Date;
  undoneAt: Date | null;
  undoneBy: string | null;
};

export type MergeContext = {
  businessName: string;
  businessId: string;
};

function when(at: Date): string {
  return formatLocal(at, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function reasonOf(row: MergeRow): string | null {
  if (row.reason === 'review') return MERGE_REASON_REVIEW(row.actor);
  // An auto merge names no actor: the actor is the desk resolve pass, not a person.
  return row.score === null ? null : MERGE_REASON_AUTO(Math.round(row.score));
}

export function MergeHistory({
  merges,
  context,
}: {
  /** Newest first, as `readBusinessDetail` orders them. */
  merges: MergeRow[];
  context: MergeContext;
}) {
  return (
    <Card data-testid="business-merge-history" data-business-id={context.businessId}>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{BUSINESS_SECTION.mergeHistory}</CardTitle>
      </CardHeader>
      <CardContent>
        {merges.length === 0 ? (
          // A complete, correct state — deliberately no action.
          <Empty data-testid="business-merges-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Merge aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-xl font-semibold">{MERGES_EMPTY_HEADING}</EmptyTitle>
              <EmptyDescription className="max-w-[60ch] text-base font-normal">
                {MERGES_EMPTY_BODY}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y divide-border" aria-label={`${BUSINESS_SECTION.mergeHistory} — ${context.businessName}`}>
            {merges.map((m) => {
              const reason = reasonOf(m);
              const active = m.undoneAt === null;
              return (
                <li
                  key={m.mergeId}
                  data-testid={`business-merge-row-${m.mergeId}`}
                  data-active={active ? 'true' : 'false'}
                  className="flex flex-col gap-2 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-base font-normal break-words">
                      {MERGE_ROW(m.loserName, m.winnerName)}
                    </p>
                    <p className="text-sm font-normal text-muted-foreground">
                      {reason === null ? null : (
                        <>
                          {reason}
                          {' · '}
                        </>
                      )}
                      <span className="tabular-nums">{when(m.mergedAt)}</span>
                    </p>
                    {!active && m.undoneAt !== null ? (
                      <p
                        data-testid={`business-merge-undone-${m.mergeId}`}
                        className="text-sm font-normal text-muted-foreground"
                      >
                        {MERGE_UNDONE(m.undoneBy ?? '', when(m.undoneAt))}
                      </p>
                    ) : null}
                  </div>

                  {active ? (
                    <UnmergeDialog
                      mergeId={m.mergeId}
                      loserName={m.loserName}
                      winnerName={m.winnerName}
                      loserKey={m.loserKey}
                      winnerKey={m.winnerKey}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-fit border-destructive text-destructive hover:bg-destructive-surface hover:text-destructive-surface-foreground sm:h-9"
                        data-testid={`business-unmerge-${m.mergeId}`}
                      >
                        {UNMERGE_ACTION(m.loserName)}
                      </Button>
                    </UnmergeDialog>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

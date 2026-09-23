import { Suspense, type ReactNode } from 'react';
import { CandidatePair } from '@/components/review/candidate-pair';
import { ReviewActions, ReviewAdvance } from '@/components/review/review-actions';
import { ReviewNothingYet, ReviewQueueClear } from '@/components/review/review-empty';
import { ReviewSkeleton } from '@/components/review/review-skeleton';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { orgClaims } from '@/lib/auth/require-org';
import { cn } from '@/lib/utils';
import {
  REVIEW_CLEAR_HEADING,
  REVIEW_EMPTY_HEADING,
  REVIEW_ORDERING_NOTE,
  REVIEW_REMAINING,
  REVIEW_SCORE_LINE,
  REVIEW_TITLE,
} from '@/lib/ui/copy';
import { formatCount } from '@/lib/ui/review-format';
import { listReviewQueue, type ReviewQueue } from '@/server/queries/review-queue';

export const dynamic = 'force-dynamic';

/**
 * `/review` — DEDUP-01's human half (03-UI-SPEC § 1; D-13, D-15, D-16). The 80–94 band, worked
 * to zero one pair at a time, highest score first, from a phone.
 *
 * 🔴 `requireOrg()` IS ALREADY ENFORCED by `src/app/(app)/layout.tsx` (its first statement).
 * This page reads `orgClaims()` only to scope its own query, and opens exactly ONE `withOrg`
 * (`listReviewQueue`) — `src/db/client.ts` pools with `max: 1`, so a transaction opened inside
 * another waits on the connection the outer one holds and the request HANGS.
 *
 * 🔴 THE HEADING PAINTS BEFORE THE DATA. The Suspense fallback renders the same `PageHeading`,
 * so first paint is the real title and a skeleton pair — never a blank page or a centred
 * spinner.
 *
 * Hierarchy (UI-SPEC § 1): "Review queue" → the remaining count (Body 16/600 tabular, in the
 * `aria-live` region) + "Highest score first" → the pair → the chip band → the actions. The
 * count and the score are deliberately quiet: the focal point is the two names.
 *
 * 🔴 ONE LIVE REGION FOR THE COUNT AND THE END STATE. `review-remaining` holds the count while
 * pairs remain; when the queue empties the same node holds "Queue clear" (visually hidden — the
 * Empty heading shows it), so reaching the end is ANNOUNCED, not merely rendered. The node
 * stays at the same position in the tree across a refresh, which is what lets a screen reader
 * hear the change.
 */

function PageHeading() {
  return <h1 className="text-xl font-semibold leading-tight">{REVIEW_TITLE}</h1>;
}

/** The key the "Queue clear" state animates in under, in place of a candidate id. */
const QUEUE_CLEAR_KEY = 'queue-clear';

function liveText({ top, remaining, ingested }: ReviewQueue): string {
  if (top) return REVIEW_REMAINING(remaining, formatCount(remaining));
  return ingested ? REVIEW_CLEAR_HEADING : REVIEW_EMPTY_HEADING;
}

/**
 * Phone only: the sticky action bar is two 48px rows, an 8px gap, 16px padding top and bottom
 * and a 1px border (2×48 + 8 + 2×16 + 1 = 137px). The layout's `<main>` already clears the
 * 64px tab bar and its inset, so this clears the bar on top of it — the last line of card B is
 * never under a thumb. From 640px up the actions are an ordinary row and need no clearance.
 */
const PHONE_BAR_CLEARANCE = 'pb-[calc(2*3rem+0.5rem+2*1rem+1px)] sm:pb-0';

/**
 * The thumb zone (MOB-01). Phone: the `--card` surface with a 1px top border and 16px padding,
 * fixed directly above the 64px tab bar — the safe-area inset is ADDED to the tab bar's height,
 * never substituted for it. From 640px up it is an ordinary row beneath the chip band. It holds
 * nothing destructive and nothing irreversible (Executor Rule 23).
 */
function ThumbBar({ children }: { children: ReactNode }) {
  return (
    <Card className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 rounded-none border-0 border-t p-4 shadow-none ring-0 sm:static sm:z-auto sm:overflow-visible sm:border-0 sm:bg-transparent sm:p-0">
      {children}
    </Card>
  );
}

async function ReviewRegion() {
  const claims = await orgClaims();
  const queue = await listReviewQueue(claims);
  const { top, ingested } = queue;

  return (
    <div className={cn('flex flex-col gap-4 lg:gap-6', top && PHONE_BAR_CLEARANCE)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <PageHeading />
          <p
            data-testid="review-remaining"
            aria-live="polite"
            aria-atomic="true"
            className={top ? 'text-base font-semibold tabular-nums' : 'sr-only'}
          >
            {liveText(queue)}
          </p>
          {top ? (
            <p className="text-sm font-normal text-muted-foreground">{REVIEW_ORDERING_NOTE}</p>
          ) : null}
        </div>
        {/* Once, right-aligned, quiet — and never without its chips, which render with it. */}
        {top ? (
          <p
            data-testid="review-score"
            data-score={top.score}
            className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground"
          >
            {REVIEW_SCORE_LINE(top.score)}
          </p>
        ) : null}
      </div>

      {top || ingested ? (
        <ReviewAdvance candidateId={top ? top.candidateId : QUEUE_CLEAR_KEY}>
          {top ? <CandidatePair pair={top} /> : <ReviewQueueClear />}
        </ReviewAdvance>
      ) : (
        <ReviewNothingYet />
      )}

      {top ? (
        <ThumbBar>
          <ReviewActions candidateId={top.candidateId} />
        </ThumbBar>
      ) : null}
    </div>
  );
}

function ReviewLoading() {
  return (
    <div className={cn('flex flex-col gap-4 lg:gap-6', PHONE_BAR_CLEARANCE)}>
      <div className="flex flex-col gap-1">
        <PageHeading />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <ReviewSkeleton />
      {/* Real buttons in their real positions, disabled until a pair exists to decide. */}
      <ThumbBar>
        <ReviewActions candidateId={null} />
      </ThumbBar>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewLoading />}>
      <ReviewRegion />
    </Suspense>
  );
}

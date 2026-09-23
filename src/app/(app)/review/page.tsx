import { Suspense } from 'react';
import { CandidatePair } from '@/components/review/candidate-pair';
import { GoogleListingCard } from '@/components/review/google-listing-card';
import { ReviewActions, ReviewAdvance, ReviewHelpers } from '@/components/review/review-actions';
import {
  ReviewDuplicatesClear,
  ReviewGoogleClear,
  ReviewNothingYet,
  ReviewQueueClear,
} from '@/components/review/review-empty';
import { ReviewFilter } from '@/components/review/review-filter';
import { ReviewSkeleton } from '@/components/review/review-skeleton';
import { ThumbBar } from '@/components/review/thumb-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { orgClaims } from '@/lib/auth/require-org';
import { REVIEW_ORDERING_NOTE, REVIEW_SCORE_LINE, REVIEW_TITLE } from '@/lib/ui/copy';
import {
  REVIEW_EMPTY_LIVE,
  parseReviewKind,
  parseSkipped,
  reviewEmptyKind,
  reviewHref,
  reviewRemainingText,
  withSkipped,
} from '@/lib/ui/review-kind';
import { listReviewQueue, type ReviewFilter as ReviewKind } from '@/server/queries/review-queue';

export const dynamic = 'force-dynamic';

/**
 * `/review` — DEDUP-01's human half (03-UI-SPEC § 1; D-13, D-15, D-16), and since Phase 4 the
 * place a tentative Google listing gets its human decision (04-UI-SPEC § Screen 3; D-05, D-08).
 * ONE score-ordered queue of two item kinds, worked to zero one item at a time, from a phone.
 *
 * 🔴 `requireOrg()` IS ALREADY ENFORCED by `src/app/(app)/layout.tsx` (its first statement).
 * This page reads `orgClaims()` only to scope its own query, and opens exactly ONE `withOrg`
 * (`listReviewQueue`) — `src/db/client.ts` pools with `max: 1`, so a transaction opened inside
 * another waits on the connection the outer one holds and the request HANGS.
 *
 * 🔴 THE HEADING AND THE FILTER PAINT BEFORE THE DATA. The URL is read outside the Suspense
 * boundary (no database), so first paint is the real title, the real filter and a skeleton item
 * — never a blank page or a centred spinner.
 *
 * URL STATE (`src/lib/ui/review-kind.ts`): `?kind=` is the filter (anything unknown is `all`);
 * `?skip=` is the Google listings skipped this session. A listing skip writes nothing, so the
 * URL is what lets the queue sink it and show the next item.
 *
 * Hierarchy: "Review queue" → the filter → the remaining count (Body 16/600 tabular, in the
 * `aria-live` region) + "Highest score first" → the item → the actions. The count and the score
 * are deliberately quiet: the focal point is the business name.
 *
 * 🔴 ONE LIVE REGION FOR THE COUNT AND THE END STATE. `review-remaining` holds the count while
 * items remain; when the (filtered) queue empties the same node holds the empty state's heading
 * (visually hidden — the Empty heading shows it), so reaching the end is ANNOUNCED, not merely
 * rendered. The node stays at the same position in the tree across a refresh.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function PageHeading() {
  return <h1 className="text-xl font-semibold leading-tight">{REVIEW_TITLE}</h1>;
}

/** The key an empty state animates in under, in place of an item id. */
const EMPTY_KEY = 'queue-empty';

async function ReviewRegion({ kind, skipped }: { kind: ReviewKind; skipped: readonly string[] }) {
  const claims = await orgClaims();
  const queue = await listReviewQueue(claims, kind, skipped);
  const { top } = queue;
  const empty = top ? null : reviewEmptyKind(kind, queue);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p
            data-testid="review-remaining"
            aria-live="polite"
            aria-atomic="true"
            className={top ? 'text-base font-semibold tabular-nums' : 'sr-only'}
          >
            {empty ? REVIEW_EMPTY_LIVE[empty] : reviewRemainingText(kind, queue)}
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

      {empty === 'nothing-yet' ? (
        <ReviewNothingYet />
      ) : (
        <ReviewAdvance
          candidateId={
            top ? (top.kind === 'google' ? top.attachmentId : top.candidateId) : EMPTY_KEY
          }
        >
          {top?.kind === 'google' ? (
            <GoogleListingCard item={top} />
          ) : top ? (
            <CandidatePair pair={top} />
          ) : empty === 'google-clear' ? (
            <ReviewGoogleClear
              pairs={queue.counts.pairs}
              href={reviewHref('duplicates', skipped)}
            />
          ) : empty === 'duplicates-clear' ? (
            <ReviewDuplicatesClear
              listings={queue.counts.google}
              href={reviewHref('google', skipped)}
            />
          ) : (
            <ReviewQueueClear />
          )}
        </ReviewAdvance>
      )}

      {/* C-WR-06: in the scrolling flow, before the bar's spacer, so on a phone it sits just
          above the fixed buttons; from 640px up `sm:order-last` puts it beneath them. */}
      {top ? <ReviewHelpers kind={top.kind} className="sm:order-last" /> : null}

      {top?.kind === 'google' ? (
        <ThumbBar>
          <ReviewActions
            kind="google"
            attachmentId={top.attachmentId}
            businessName={top.business.displayName}
            skipHref={reviewHref(kind, withSkipped(skipped, top.attachmentId))}
          />
        </ThumbBar>
      ) : top ? (
        <ThumbBar>
          <ReviewActions candidateId={top.candidateId} />
        </ThumbBar>
      ) : null}
    </div>
  );
}

function ReviewLoading() {
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <ReviewSkeleton />
      {/* Real buttons in their real positions, disabled until an item exists to decide. */}
      <ThumbBar>
        <ReviewActions candidateId={null} />
      </ThumbBar>
    </div>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const kind = parseReviewKind(params.kind);
  const skipped = parseSkipped(params.skip);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex flex-col gap-4">
        <PageHeading />
        <ReviewFilter kind={kind} skipped={skipped} />
      </div>
      <Suspense fallback={<ReviewLoading />}>
        <ReviewRegion kind={kind} skipped={skipped} />
      </Suspense>
    </div>
  );
}

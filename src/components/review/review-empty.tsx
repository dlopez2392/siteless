import { CheckCheck, Inbox, MapPinCheck, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  PLACES_ACTION,
  REVIEW_CLEAR_ACTION,
  REVIEW_CLEAR_BODY_WITH_GOOGLE,
  REVIEW_CLEAR_HEADING,
  REVIEW_DUPLICATES_EMPTY_BODY,
  REVIEW_DUPLICATES_EMPTY_HEADING,
  REVIEW_EMPTY_ACTION,
  REVIEW_EMPTY_BODY,
  REVIEW_EMPTY_HEADING,
  REVIEW_GOOGLE_EMPTY_BODY,
  REVIEW_GOOGLE_EMPTY_HEADING,
} from '@/lib/ui/copy';

/**
 * `/review`'s empty states (03-UI-SPEC § States → Empty; D-16's explicit end state; 04-UI-SPEC
 * § States → Empty for the per-kind ones).
 *
 * - **"Queue clear"** — every duplicate pair and every Google listing in the 80–95 band has a
 *   decision. The END STATE of a worked queue: a result, not an absence, and it says where new
 *   items come from (the next ingest or the next Places run).
 * - **"No Google listings to review"** / **"No duplicate pairs to review"** — a FILTERED queue
 *   is worked while the other kind still waits; it names how many and offers that kind.
 * - **"Nothing to review yet"** — no ingest has finished, so nothing was ever scored. Only
 *   rendered when `ReviewQueue.ingested` is false; it names the desk scripts to run.
 *
 * 🔴 NO SCREEN EVER SHOWS "No data". Every string is imported from `src/lib/ui/copy.ts`.
 *
 * The heading is focusable (`tabindex=-1`, `data-review-focus`) because an empty state is where
 * focus lands after the LAST decision (review-actions.tsx `ReviewAdvance`) — the pressed
 * button is gone at that point, and focus must not fall back to the page body.
 *
 * The action is an inline text link (accent list item 6), not a filled button: this screen's
 * one accent CTA is "Same business", and in these states there is nothing to decide.
 */

function ReviewEmptyState({
  'data-testid': testId,
  Icon,
  iconName,
  heading,
  body,
  action,
  href,
}: {
  'data-testid': string;
  Icon: LucideIcon;
  iconName: string;
  heading: string;
  body: string;
  action: string;
  href: string;
}) {
  return (
    <Empty data-testid={testId} className="border border-dashed py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-full bg-muted text-muted-foreground">
          <Icon data-icon={iconName} className="size-6" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2
            tabIndex={-1}
            data-review-focus=""
            className="text-xl font-semibold leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {heading}
          </h2>
        </EmptyTitle>
        <EmptyDescription className="max-w-[60ch] text-base font-normal text-muted-foreground">
          {body}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="link" className="h-11 text-base font-normal">
          <Link href={href} data-testid={`${testId}-action`}>
            {action}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function ReviewQueueClear() {
  return (
    <ReviewEmptyState
      data-testid="review-queue-clear"
      Icon={CheckCheck}
      iconName="check-check"
      heading={REVIEW_CLEAR_HEADING}
      body={REVIEW_CLEAR_BODY_WITH_GOOGLE}
      action={REVIEW_CLEAR_ACTION}
      href="/sources"
    />
  );
}

/** The Google filter, worked, with duplicate pairs still waiting. `href` keeps the session. */
export function ReviewGoogleClear({ pairs, href }: { pairs: number; href: string }) {
  return (
    <ReviewEmptyState
      data-testid="review-google-clear"
      Icon={MapPinCheck}
      iconName="map-pin-check"
      heading={REVIEW_GOOGLE_EMPTY_HEADING}
      body={REVIEW_GOOGLE_EMPTY_BODY(pairs)}
      action={PLACES_ACTION.showDuplicates}
      href={href}
    />
  );
}

/** The Duplicates filter, worked, with Google listings still waiting. */
export function ReviewDuplicatesClear({ listings, href }: { listings: number; href: string }) {
  return (
    <ReviewEmptyState
      data-testid="review-duplicates-clear"
      Icon={CheckCheck}
      iconName="check-check"
      heading={REVIEW_DUPLICATES_EMPTY_HEADING}
      body={REVIEW_DUPLICATES_EMPTY_BODY(listings)}
      action={PLACES_ACTION.showGoogle}
      href={href}
    />
  );
}

export function ReviewNothingYet() {
  return (
    <ReviewEmptyState
      data-testid="review-empty"
      Icon={Inbox}
      iconName="inbox"
      heading={REVIEW_EMPTY_HEADING}
      body={REVIEW_EMPTY_BODY}
      action={REVIEW_EMPTY_ACTION}
      href="/sources"
    />
  );
}

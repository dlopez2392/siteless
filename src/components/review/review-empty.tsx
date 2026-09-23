import { CheckCheck, Inbox, type LucideIcon } from 'lucide-react';
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
  REVIEW_CLEAR_ACTION,
  REVIEW_CLEAR_BODY,
  REVIEW_CLEAR_HEADING,
  REVIEW_EMPTY_ACTION,
  REVIEW_EMPTY_BODY,
  REVIEW_EMPTY_HEADING,
} from '@/lib/ui/copy';

/**
 * `/review`'s two empty states (03-UI-SPEC § States → Empty; D-16's explicit end state).
 *
 * - **"Queue clear"** — every pair in the 80–95 band has a decision. The END STATE of a worked
 *   queue: it is a result, not an absence, and it says where new pairs come from.
 * - **"Nothing to review yet"** — no ingest has finished, so nothing was ever scored. Only
 *   rendered when `ReviewQueue.ingested` is false; it names the desk scripts to run.
 *
 * 🔴 NO SCREEN EVER SHOWS "No data". Every string is imported from `src/lib/ui/copy.ts`.
 *
 * The heading is focusable (`tabindex=-1`, `data-review-focus`) because "Queue clear" is where
 * focus lands after the LAST decision (review-actions.tsx `ReviewAdvance`) — the pressed
 * button is gone at that point, and focus must not fall back to the page body.
 *
 * The action is an inline text link to `/sources` (accent list item 6), not a filled button:
 * this screen's one accent CTA is "Same business", and in these states there is nothing to
 * decide.
 */

function ReviewEmptyState({
  'data-testid': testId,
  Icon,
  iconName,
  heading,
  body,
  action,
}: {
  'data-testid': string;
  Icon: LucideIcon;
  iconName: string;
  heading: string;
  body: string;
  action: string;
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
          <Link href="/sources" data-testid={`${testId}-action`}>
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
      body={REVIEW_CLEAR_BODY}
      action={REVIEW_CLEAR_ACTION}
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
    />
  );
}

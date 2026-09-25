'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { REVIEW_FILTER, REVIEW_FILTER_GOOGLE_NAME } from '@/lib/ui/copy';
import { REVIEW_KINDS, parseReviewKind, reviewHref } from '@/lib/ui/review-kind';
import type { ReviewFilter as ReviewKind } from '@/server/queries/review-queue';

/**
 * `/review`'s kind filter — All · Duplicates · Google (04-UI-SPEC § Screen 3, Open Question 3).
 *
 * One score-ordered queue; the filter only lets danlo batch one kind, because Google items
 * usually mean a hop to Google Maps. The value lives in the URL (`?kind=`), so the run report's
 * "Review {n} in the queue" can deep-link to the Google items, and the page (a server
 * component) reads it. Choosing a kind navigates; the server re-reads the queue.
 *
 * - `ToggleGroup` single-select, full width on phone, 44px toggles, directly under the title.
 * - The visible label is "Google"; its accessible name is "Google listings".
 * - The session's skipped listings (`?skip=`) travel with the filter, so switching kinds does
 *   not bring a listing back that was just skipped.
 *
 * 🔴 CONTROLLED, AND AN EMPTY VALUE IS DISCARDED. Radix emits '' when the pressed item is
 * pressed again; the queue always has a kind, so '' never navigates. The pressed state moves at
 * once (the reader sees the tap land) and follows the URL again whenever the page re-renders
 * with a new `kind`.
 */
export function ReviewFilter({
  kind,
  skipped,
  className,
}: {
  kind: ReviewKind;
  skipped: readonly string[];
  className?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<ReviewKind>(kind);

  // The URL is the truth: a new `kind` from the server replaces any local selection.
  const [shownFor, setShownFor] = useState(kind);
  if (shownFor !== kind) {
    setShownFor(kind);
    setSelected(kind);
  }

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      data-testid="review-filter"
      value={selected}
      onValueChange={(next) => {
        if (!next || next === selected) return;
        const value = parseReviewKind(next);
        setSelected(value);
        startTransition(() => {
          router.push(reviewHref(value, skipped));
        });
      }}
      className={cn('w-full sm:w-fit', className)}
    >
      {REVIEW_KINDS.map((value) => (
        <ToggleGroupItem
          key={value}
          value={value}
          data-testid={`review-filter-${value}`}
          aria-label={value === 'google' ? REVIEW_FILTER_GOOGLE_NAME : undefined}
          className="min-h-11 flex-1 px-4 text-sm sm:flex-none"
        >
          {REVIEW_FILTER[value]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

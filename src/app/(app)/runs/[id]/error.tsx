'use client';

import { OctagonX } from 'lucide-react';
import Link from 'next/link';
import type { RouteErrorProps } from '@/components/app-shell/route-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PLACES_ACTION, RUN_REPORT_LOAD_FAILED } from '@/lib/ui/copy';

/**
 * `/runs/[id]` failed to load (04-UI-SPEC § States → Error → "Run report failed to load").
 *
 * 🔴 THE SENTENCE SAYS WHAT A FAILED READ MEANS FOR THE RUN: nothing. A running run keeps running
 * and keeps writing to the ledger; only this page's read failed. It ends with two ways out —
 * "Try again" and "Open spend view" (which shows what the run has cost so far).
 *
 * 🔴 THE SPEC'S WORDS, NEVER `error.message` (C-CR-01, as `RouteError`): a server-component error
 * reaches the client as a generic string or, in dev, a raw message that can leak detail.
 *
 * 🔴 `retry()`, NOT `reset()`: Next 16.3's `retry` re-fetches AND re-renders the segment, which a
 * failed server read needs. This renders inside the `(app)` layout, so the shell survives.
 *
 * `RouteError` offers only "Open sources" as its second action, so this composes the same
 * treatment with "Open spend view" rather than widening a shared component.
 */
export default function RunReportError({ retry }: RouteErrorProps) {
  return (
    <Alert
      role="alert"
      data-testid="run-report-error"
      className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
    >
      <OctagonX aria-hidden="true" className="size-5" />
      <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
        <p className="max-w-[60ch] text-base font-normal text-balance">{RUN_REPORT_LOAD_FAILED}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4 text-base font-normal"
            onClick={() => retry()}
            data-testid="run-report-error-retry"
          >
            {PLACES_ACTION.tryAgain}
          </Button>
          <Button asChild variant="ghost" className="h-11 px-4 text-base font-normal">
            <Link href="/spend" data-testid="run-report-error-open-spend">
              {PLACES_ACTION.openSpend}
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

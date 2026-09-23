'use client';

import { OctagonX } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ERROR_ACTION } from '@/lib/ui/copy';

/**
 * The body every route `error.tsx` renders (C-CR-01; 03-UI-SPEC § States → Error).
 *
 * 🔴 WHY THIS EXISTS. With no `error.tsx` anywhere, a read that threw on `/review` or
 * `/businesses/[id]` replaced the whole app — tab bar included — with Next's generic
 * "Application error", and the spec's sentences for exactly those cases were rendered by
 * nothing. A segment boundary renders INSIDE the `(app)` layout, so the shell survives.
 *
 * 🔴 THE SENTENCE IS THE SPEC'S, NEVER `error.message`. In production a server-component error
 * reaches the client as a generic string plus a digest; in dev it is the raw message. Neither is
 * copy, and the raw one can leak detail.
 *
 * 🔴 `retry()`, NOT `reset()`. Next 16.3's `retry` re-fetches AND re-renders the segment; a
 * server-component read that failed needs the re-fetch, which `reset()` does not do.
 *
 * Exports a component only — the copy comes from `src/lib/ui/copy.ts` (server-safe), so no
 * server component ever imports data from this client module (Executor Rule 5).
 */
export function RouteError({
  message,
  retry,
  openSources = false,
}: {
  message: string;
  retry: () => void;
  /** Adds the spec's "Open sources" way out beside "Try again". */
  openSources?: boolean;
}) {
  return (
    <Alert
      role="alert"
      data-testid="route-error"
      className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
    >
      <OctagonX aria-hidden="true" className="size-5" />
      <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
        <p className="max-w-[60ch] text-base font-normal text-balance">{message}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4 text-base font-normal"
            onClick={() => retry()}
            data-testid="route-error-retry"
          >
            {ERROR_ACTION.tryAgain}
          </Button>
          {openSources ? (
            <Button asChild variant="ghost" className="h-11 px-4 text-base font-normal">
              <Link href="/sources" data-testid="route-error-open-sources">
                {ERROR_ACTION.openSources}
              </Link>
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** The props Next 16.3 hands an `error.tsx` default export. */
export type RouteErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
  reset?: () => void;
};

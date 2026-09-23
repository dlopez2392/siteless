import { Database, OctagonX } from 'lucide-react';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { Suspense } from 'react';
import { AttributionBlock } from '@/components/sources/attribution-block';
import { ConfidenceDistribution } from '@/components/sources/confidence-distribution';
import { SourceLedger } from '@/components/sources/source-ledger';
import { SourcesSkeleton } from '@/components/sources/sources-skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { orgClaims } from '@/lib/auth/require-org';
import {
  ERROR_ACTION,
  SOURCES_EMPTY_ACTION,
  SOURCES_EMPTY_BODY,
  SOURCES_EMPTY_HEADING,
  SOURCES_GONE_EXPLAINER,
  SOURCES_LOAD_FAILED,
  SOURCES_SUBTITLE,
  SOURCES_TITLE,
} from '@/lib/ui/copy';
import { listSources, type SourceLedgerRow } from '@/server/queries/sources';

export const dynamic = 'force-dynamic';

/**
 * `/sources` — the ingest run ledger (03-UI-SPEC § 2; D-06, D-17; success criterion 1 made
 * visible).
 *
 * 🔴 `requireOrg()` IS ALREADY ENFORCED by `src/app/(app)/layout.tsx` (T-3-09). This page
 * reads `orgClaims()` only to scope its one query, and opens exactly ONE `withOrg`
 * (`listSources`): the pool is `max: 1`, so a nested transaction HANGS rather than failing.
 *
 * 🔴 THE HEADING, THE SUBTITLE AND THE FOUR SOURCE NAMES PAINT BEFORE ANY DATA. Only the
 * run-derived cells suspend; the fallback renders the four static rows (Executor Rule 27).
 *
 * 🔴 NO PRIMARY CTA. Ingests are desk scripts (D-01); there is deliberately no in-app
 * refresh button. The screen's action is the named script in its empty and error copy.
 *
 * Hierarchy: title → subtitle → the ledger → the `gone` explainer → the attribution block.
 */
export default function SourcesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold leading-tight">{SOURCES_TITLE}</h1>
        <p className="text-sm font-normal text-muted-foreground">{SOURCES_SUBTITLE}</p>
      </header>

      <Suspense fallback={<SourcesSkeleton />}>
        <SourcesRegion />
      </Suspense>

      <p data-testid="sources-gone-explainer" className="max-w-[70ch] text-sm font-normal text-muted-foreground">
        {SOURCES_GONE_EXPLAINER}
      </p>

      {/* Static licence notice — outside the suspended region, so it paints with the
          heading and survives a load failure. */}
      <AttributionBlock />
    </div>
  );
}

async function SourcesRegion() {
  const claims = await orgClaims();

  let rows: SourceLedgerRow[];
  try {
    rows = await listSources(claims);
  } catch (error) {
    // Framework control flow (redirects, dynamic-rendering bail-outs) is not a load failure.
    unstable_rethrow(error);
    console.error('sources: the run ledger failed to load', error);
    return <SourcesLoadFailed />;
  }

  const nothingRan = rows.every((row) => row.lastRunAt === null);
  // The one `stats` key the ledger reads, on the Overture row only (03-15 handoff).
  const overtureBands = rows.find((row) => row.sourceKey === 'overture')?.confidenceBands ?? null;
  // No bands (Overture never ran, or its run recorded none) → no expansion row at all, rather
  // than an empty full-width row under the Overture line.
  const hasBands = overtureBands !== null && Object.keys(overtureBands).length > 0;

  return (
    <>
      {nothingRan ? <SourcesEmpty /> : null}
      <SourceLedger
        rows={rows}
        overtureDetail={
          hasBands ? (
            <ConfidenceDistribution bands={overtureBands} testId="sources-confidence-toggle" />
          ) : undefined
        }
        overtureDetailMobile={
          hasBands ? (
            <ConfidenceDistribution
              bands={overtureBands}
              testId="sources-confidence-toggle-mobile"
            />
          ) : undefined
        }
      />
    </>
  );
}

/** "No ingest has run yet" — above the four rows it describes ("The four sources below are
 *  wired and waiting"), never instead of them. */
function SourcesEmpty() {
  return (
    <Empty data-testid="sources-empty" className="border border-dashed py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-full bg-muted text-muted-foreground">
          <Database className="size-6" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-xl font-semibold leading-tight">{SOURCES_EMPTY_HEADING}</EmptyTitle>
        <EmptyDescription className="max-w-[60ch] text-base font-normal text-muted-foreground">
          {SOURCES_EMPTY_BODY}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/* Outline, not accent: this screen has no primary CTA. */}
        <Button asChild variant="outline" className="h-11 px-4 text-base font-normal">
          <Link href="/businesses" data-testid="sources-empty-action">
            {SOURCES_EMPTY_ACTION}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** 03-UI-SPEC § Error → "Sources ledger failed to load": what was and was not affected,
 *  and a way out. */
function SourcesLoadFailed() {
  return (
    <Alert
      data-testid="sources-load-failed"
      className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
    >
      <OctagonX aria-hidden="true" className="size-4" />
      <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
        <p className="text-sm font-normal">{SOURCES_LOAD_FAILED}</p>
        <Button asChild variant="outline" className="h-11 px-4 text-base font-normal">
          <Link href="/sources" data-testid="sources-load-retry">
            {ERROR_ACTION.tryAgain}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

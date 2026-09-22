import { FileClock, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { ByProvider, ProviderRowsSkeleton } from '@/components/spend/by-provider';
import { ByRun } from '@/components/spend/by-run';
import { PeriodHeader, PeriodHeaderSkeleton } from '@/components/spend/period-header';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { orgClaims } from '@/lib/auth/require-org';
import { formatUsd } from '@/lib/budget/money';
import { SPEND_FOOTER } from '@/lib/ui/copy';
import { getCurrentPeriod, getSpendByProvider, getSpendByRun } from '@/server/queries/budget';

export const dynamic = 'force-dynamic';

/**
 * BUDG-04 / D-14. Month-to-date spend versus the cap, broken down by provider and by run,
 * fed by one ledger row per paid call (UI-SPEC § Screen Inventory 5).
 *
 * 🔴 EVERY NUMBER ON THIS PAGE IS A READING. There is no placeholder anywhere in this
 * file, and there was one here until this plan replaced it: the previous version of this
 * route said so out loud rather than rendering a $0.00 it had not measured. A fake $0.00
 * is the one number this product must never show, because the whole proposition is that
 * the spend figure can be trusted enough to stop worrying about the bill.
 *
 * 🔴 THE THREE READS ARE SEQUENTIAL, NEVER NESTED. `src/db/client.ts` pools with `max: 1`,
 * so a `withOrg` opened inside another one waits on a connection the outer transaction is
 * holding and the request HANGS rather than failing (02-09 deviation 7). Each `get*` below
 * opens and closes its own transaction in turn.
 *
 * 🔴 THE SHELL AND THE HEADING PAINT FIRST; ONLY THE DATA REGION SUSPENDS (UI-SPEC
 * § States → Loading). That is why the page component itself is synchronous and the
 * awaits live in a child inside `Suspense` — a page that awaited at the top would hold
 * the whole route back and the fallback would never be the thing the reader sees.
 */
export default function SpendPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold leading-tight">Spend</h1>

      <Suspense fallback={<SpendSkeleton />}>
        {/* The screen owns its e2e contract, so the hooks are passed down rather than
            buried in the components: `spend-gauge` here and `budget-period-gauge` on
            /settings/budget are the same component under two names, and one testid on
            two live elements is the silent `.first()` match 02-10 recorded. */}
        <SpendBody />
      </Suspense>

      {/* UI-SPEC § Copy Table → Spend footer note, verbatim from the copy module.
          CLAUDE.md is explicit that Vercel Pro (~$20/mo) is infrastructure and the $50
          data cap is data spend, and that the two are never merged in reporting. */}
      <p className="text-sm font-normal text-muted-foreground">{SPEND_FOOTER}</p>
    </div>
  );
}

async function SpendBody() {
  const claims = await orgClaims();
  const period = await getCurrentPeriod(claims, 'places');
  const providers = await getSpendByProvider(claims, period.id);
  const runs = await getSpendByRun(claims, period.id);

  // "Nothing spent this month" is a claim about the LEDGER: no paid call has been settled
  // and none is in flight. It is deliberately not derived from the period row alone — a
  // row exists from the first page view of every month, and a cap on its own is not spend.
  const settled = providers.reduce((total, row) => total + row.microUsd, 0n);
  const calls = providers.reduce((total, row) => total + row.calls, 0);
  const nothingSpent = settled === 0n && calls === 0 && period.reservedMicroUsd === 0n;

  return (
    <div className="flex flex-col gap-6">
      <PeriodHeader
        period={period}
        figureTestId="spend-mtd-figure"
        gaugeTestId="spend-gauge"
      />

      <Tabs defaultValue="by-provider" className="w-full">
        <TabsList className="h-auto w-full p-1 sm:w-fit">
          <TabsTrigger value="by-provider" data-testid="spend-tab-by-provider" className="h-11">
            By provider
          </TabsTrigger>
          <TabsTrigger value="by-run" data-testid="spend-tab-by-run" className="h-11">
            By run
          </TabsTrigger>
        </TabsList>

        <TabsContent value="by-provider" className="flex flex-col gap-4">
          {/* 🔴 THE THREE ROWS RENDER WHETHER OR NOT ANYTHING WAS SPENT. The empty state
              explains the month; it does not replace the readings, because a provider
              that is absent from this list reads as one nobody is measuring (D-14). */}
          {nothingSpent ? (
            <>
              <NothingSpent capMicroUsd={period.capMicroUsd} />
              <Separator />
            </>
          ) : null}
          <ByProvider rows={providers} capMicroUsd={period.capMicroUsd} />
        </TabsContent>

        <TabsContent value="by-run">
          {runs.length === 0 ? <NoRuns /> : <ByRun runs={runs} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** UI-SPEC § States → Empty, "Spend, no spend this month" — copy verbatim, except that
 *  the cap figure is the org's real one rather than the spec's illustrative $50.00. */
function NothingSpent({ capMicroUsd }: { capMicroUsd: bigint }) {
  return (
    <Empty data-testid="spend-empty" className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-full">
          <Wallet aria-hidden="true" className="size-6" />
        </EmptyMedia>
        <EmptyTitle className="text-xl font-semibold">Nothing spent this month</EmptyTitle>
        <EmptyDescription className="max-w-[60ch] text-base font-normal">
          Your {formatUsd(capMicroUsd)} cap resets on the 1st, America/Chicago. Spend shows
          up here the moment a run makes its first paid call — one row per call.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" className="h-11">
          <Link href="/presets" data-testid="spend-empty-cta">
            Review your presets
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** UI-SPEC § States → Empty, "Spend → By run, empty" — copy verbatim. */
function NoRuns() {
  return (
    <Empty data-testid="spend-by-run-empty" className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-full">
          <FileClock aria-hidden="true" className="size-6" />
        </EmptyMedia>
        <EmptyTitle className="text-xl font-semibold">No runs yet this month</EmptyTitle>
        <EmptyDescription className="max-w-[60ch] text-base font-normal">
          Runs appear here with their duration, call count and exact cost as soon as a
          preset runs.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" className="h-11">
          <Link href="/presets" data-testid="spend-by-run-empty-cta">
            Open presets
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function SpendSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <PeriodHeaderSkeleton />
      <ProviderRowsSkeleton />
    </div>
  );
}

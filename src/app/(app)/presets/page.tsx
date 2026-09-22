import { Suspense } from 'react';
import { CreatePresetCta } from '@/components/preset-list/create-preset-cta';
import { PresetCard, PresetCardSkeleton } from '@/components/preset-list/preset-card';
import { PresetsEmpty } from '@/components/preset-list/presets-empty';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { orgClaims } from '@/lib/auth/require-org';
import { PHASE4_RUN_NOTICE } from '@/lib/ui/copy';
import { listPresetCards } from '@/server/queries/preset-cards';

export const dynamic = 'force-dynamic';

/**
 * SRCH-01's list half — UI-SPEC § Screen Inventory 1.
 *
 * 🔴 `requireOrg()` IS ALREADY ENFORCED by `src/app/(app)/layout.tsx`, whose first
 * statement it is (T-2-01). This page reads `orgClaims()` only to scope its own query, and
 * it opens exactly ONE `withOrg` — `src/db/client.ts` pools with `max: 1`, so a second
 * transaction opened inside a first one waits on a connection the outer one holds and the
 * request HANGS rather than failing (02-09's deviation 7).
 *
 * 🔴 THE HEADING PAINTS BEFORE THE DATA. The title and the CTA slot are inside the
 * suspended region only so the "empty" and "populated" screens can differ in their focal
 * point; the fallback renders the same title from the same constant, so first paint is the
 * real heading and never a blank page or a centred spinner (UI-SPEC § States → Loading).
 */

const TITLE = 'Search presets';

/** UI-SPEC § Copy Table → "{n} presets · {m} run this month" / "1 preset · none run this
 *  month". Assembled here rather than at two call sites so the singular cannot drift. */
function countLine(total: number, runThisMonth: number): string {
  const presets = total === 1 ? '1 preset' : `${total} presets`;
  const runs = runThisMonth === 0 ? 'none run this month' : `${runThisMonth} run this month`;
  return `${presets} · ${runs}`;
}

function PageHeading() {
  return <h1 className="text-xl font-semibold leading-tight">{TITLE}</h1>;
}

async function PresetListRegion() {
  const claims = await orgClaims();
  const { cards, runThisMonth } = await listPresetCards(claims);

  // UI-SPEC names the empty screen's focal point as the Empty component's own CTA, so the
  // header CTA is absent in that state. Exactly one filled accent button per rendered
  // screen, in both states (Executor Rule 10).
  const isEmpty = cards.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <PageHeading />
          <p className="text-sm font-normal tabular-nums text-muted-foreground">
            {countLine(cards.length, runThisMonth)}
          </p>
        </div>
        {isEmpty ? null : (
          <CreatePresetCta
            label="Create preset"
            data-testid="presets-create-cta"
            className="hidden sm:inline-flex"
          />
        )}
      </div>

      {isEmpty ? (
        <PresetsEmpty />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
            {cards.map((preset) => (
              <PresetCard key={preset.id} preset={preset} />
            ))}
          </div>

          <p className="max-w-[60ch] text-sm font-normal text-muted-foreground">
            {PHASE4_RUN_NOTICE}
          </p>

          {/* The thumb zone (MOB-01). A full-width 48px primary button on the `--card`
              surface with a 1px top border, sitting directly above the 64px tab bar and
              its safe-area inset. Hidden from 640px up, where the header CTA takes over —
              so exactly one of the two is ever visible, each with its own hook. */}
          <Card className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 rounded-none border-0 border-t p-4 shadow-none sm:hidden">
            <CreatePresetCta
              label="Create preset"
              data-testid="presets-create-cta-mobile"
              className="h-12 w-full"
            />
          </Card>
        </>
      )}
    </>
  );
}

function PresetListSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <PageHeading />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <PresetCardSkeleton />
        <PresetCardSkeleton />
        <PresetCardSkeleton />
      </div>
    </>
  );
}

export default function PresetsPage() {
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <Suspense fallback={<PresetListSkeleton />}>
        <PresetListRegion />
      </Suspense>
    </div>
  );
}

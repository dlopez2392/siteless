'use client';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { formatUsd } from '@/lib/budget/money';
import { PRICE_BOOK } from '@/lib/budget/price-book';
import {
  ASSUMPTIONS_CAVEAT,
  ESTIMATE_SKU,
  FAN_OUT,
  PAGES_HI,
  PAGES_LO,
  RADIUS_REFERENCE_MILES,
} from '@/lib/estimate/assumptions';
import type { EstimateAssumptions } from '@/lib/estimate/estimate';
import { APP_LOCALE } from '@/lib/time';

/**
 * D-07's other half. The assumptions are "visible, editable, committed constants" — and
 * VISIBLE means this surface, one tap from the dollar figure it produced.
 *
 * 🔴 EVERY VALUE IS READ, NEVER RESTATED. Not one number below is typed into this file:
 * the fan-out, the page range and the radius footprint come from
 * `src/lib/estimate/assumptions.ts` (or, when an estimate is on screen, from the
 * assumptions that estimate was actually built with, so the drawer cannot quote one
 * fan-out while the figure beside it was built from another), and the price comes from the
 * same `PRICE_BOOK` the ledger bills against. A second copy in JSX is a second source of
 * truth for the one number the whole product rests on (T-2-08).
 *
 * 🔴 THE FAN-OUT IS UNMEASURED AND THE DRAWER SAYS SO. Every dollar figure in the product
 * scales linearly with it; it is trued up with real invoice data at the Phase 6 gate. The
 * honest thing to do with an unmeasured multiplier is to name it and show it.
 *
 * Drawer on phone, Popover on desk (UI-SPEC § Screen Inventory 2). Both are in the DOM and
 * CSS decides which is visible, because the breakpoint is not knowable on the server — and
 * each carries its OWN testid, because one hook resolving to two visible elements is plan
 * 02-10's deviation 3 and it reddened four specs.
 */

const counts = new Intl.NumberFormat(APP_LOCALE);

/** What a SKU is quoted per. Google publishes Places prices per this many requests. */
const QUOTE_UNIT = 1_000;

const TITLE = 'How this estimate is built';
const LINK_LABEL = 'How this is estimated';
const CLOSE_LABEL = 'Back to the preset';

type Row = { term: string; value: string; note?: string };

function rowsFor(assumptions: EstimateAssumptions | null): Row[] {
  const fanOut = assumptions?.fanOut ?? FAN_OUT;
  const pagesLo = assumptions?.pagesLo ?? PAGES_LO;
  const pagesHi = assumptions?.pagesHi ?? PAGES_HI;
  const radiusMiles = assumptions?.radiusReferenceMiles ?? RADIUS_REFERENCE_MILES;
  const price = PRICE_BOOK[ESTIMATE_SKU];

  return [
    {
      term: 'Pages per query leg',
      value: `${pagesLo}–${pagesHi} (low–high)`,
    },
    {
      term: 'Query fan-out multiplier',
      value: fanOut.toFixed(1),
      note: 'unmeasured; trued up with real invoice data at the Phase 6 gate',
    },
    {
      term: 'Radius reference footprint',
      value: `${radiusMiles} miles`,
    },
    {
      term: 'Outlet counts',
      value: 'TX Comptroller active sales-tax permits, measured',
    },
    {
      term: 'Price',
      value:
        `${formatUsd(BigInt(price.microUsdPerRequest) * BigInt(QUOTE_UNIT))} per ` +
        `${counts.format(QUOTE_UNIT)} Text Search Enterprise requests, ` +
        // `freePerMonth` is nullable because some SKUs have no allowance at all. Saying
        // "first null free" would be worse than saying nothing, and saying nothing would
        // be worse than saying which it is.
        (price.freePerMonth === null
          ? 'with no monthly free allowance'
          : `first ${counts.format(price.freePerMonth)} free each month`),
    },
  ];
}

function AssumptionsBody({ assumptions }: { assumptions: EstimateAssumptions | null }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-3">
        {rowsFor(assumptions).map((row) => (
          <div key={row.term} className="flex flex-col gap-0.5">
            <dt className="text-sm font-semibold">{row.term}</dt>
            <dd className="text-sm font-normal tabular-nums text-muted-foreground">
              {row.value}
              {row.note === undefined ? null : <em className="block not-italic">{row.note}</em>}
            </dd>
          </div>
        ))}
      </dl>
      <Separator />
      <p className="max-w-[60ch] text-sm font-normal text-muted-foreground">
        {ASSUMPTIONS_CAVEAT}
      </p>
    </div>
  );
}

export function AssumptionsSurface({
  assumptions,
}: {
  assumptions: EstimateAssumptions | null;
}) {
  return (
    <>
      {/* Phone */}
      <Drawer>
        <DrawerTrigger asChild>
          <Button
            type="button"
            variant="link"
            data-testid="preset-editor-assumptions-drawer"
            className="h-11 justify-start px-0 text-sm text-primary lg:hidden"
          >
            {LINK_LABEL} →
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-xl font-semibold leading-tight">{TITLE}</DrawerTitle>
            <DrawerDescription className="sr-only">
              The committed constants this estimate was built from.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <AssumptionsBody assumptions={assumptions} />
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button type="button" variant="outline" className="h-11">
                {CLOSE_LABEL}
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Desk */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="link"
            data-testid="preset-editor-assumptions-popover"
            className="hidden h-11 justify-start px-0 text-sm text-primary lg:inline-flex"
          >
            {LINK_LABEL} →
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96">
          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold leading-tight">{TITLE}</h2>
            <AssumptionsBody assumptions={assumptions} />
            <PopoverClose />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

/** The popover's closing action. UI-SPEC's dismiss copy is never a generic label. */
function PopoverClose() {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11"
      onClick={(event) => {
        // Radix closes a Popover when focus leaves it; dispatching Escape from inside is
        // the documented way to close it from a plain button without threading state.
        event.currentTarget.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      }}
    >
      {CLOSE_LABEL}
    </Button>
  );
}

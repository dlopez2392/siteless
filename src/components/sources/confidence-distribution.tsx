'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { formatPct } from '@/lib/budget/money';
import { OVERTURE_CONFIDENCE_CUTOFF } from '@/lib/resolve/score';
import { formatCount } from '@/lib/time';
import {
  SOURCES_CONFIDENCE_TOGGLE,
  SOURCES_CONFIDENCE_TOGGLE_HIDE,
  SOURCES_CUTOFF_LINE,
} from '@/lib/ui/copy';

/**
 * The Overture row's expansion on `/sources`: rows per 0.1 confidence band (D-04), as
 * label/value pairs with a thin share bar, plus the committed funnel cutoff.
 *
 * 🔴 NO CHART LIBRARY (Executor Rule 24). Each share bar is the shadcn `Progress` with its
 * indicator repainted, and the cutoff marker between the bands is a painted 1px div. The
 * guard over this is a bare token grep of `src/` and `package.json`, so — like
 * `budget-gauge.tsx` — this comment does not spell the library's name.
 *
 * 🔴 RADIX OWNS THE 200ms HEIGHT TRANSITION (`animate-collapsible-*`, tw-animate's 0.2s
 * default, switched off when the reader asks the OS for less movement — the content still
 * renders, only the animation goes). Nothing here wraps the collapsible in the gesture
 * library: two animation systems on one element is how a drawer ends up fighting itself.
 * (Tailwind's own reduced-movement variant is the only thing in this file a bare grep for
 * that library's name will find; there is no import of it.)
 *
 * 🔴 THE BANDS COME FROM THE RUN, NOT FROM A TABLE IN THIS FILE. `stats.confidence_bands`
 * is written by `scripts/ingest-overture.ts` (`confidenceBand()`: "0.0-0.1" … "0.9-1.0",
 * "=1.0", "null"), and read — that one key only — by `readSources`. For the record, the
 * measured Texas-side shape the first desk run should reproduce (03-RESEARCH):
 *   0.9–1.0 → 35,270 rows (61.9 %) · 0.8–0.9 → 4,920 · 0.7–0.8 → 3,973 · 0.0–0.3 → 2,680 (4.7 %)
 *
 * T-3-03: `stats` is desk-script jsonb. Every count goes through `Number()` and a clamp, so a
 * malformed value renders as 0 and no bar can be negative or wider than its track.
 *
 * Every figure is `tabular-nums` (Rule 25); counts and shares format through the pinned
 * helpers, never `Intl` here (Rule 26). No accent: the fill is `--muted-foreground` on the
 * `--muted` track (03-UI-SPEC § Color → "confidence-band bar track").
 */

type Band = {
  key: string;
  label: string;
  /** Upper bound of the band, for placing the cutoff marker. `null` for the no-confidence
   *  bucket and for any key this file does not recognise. */
  upper: number | null;
  /** Sort position: higher confidence first. */
  order: number;
  count: number;
};

/** Rows with no confidence at all. Not in 03-UI-SPEC § Copy Table — recorded as a copy gap
 *  in 03-17's summary rather than added to `copy.ts`, which this plan does not own. */
const NO_CONFIDENCE_LABEL = 'No confidence';

function safeCount(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

function describe(key: string, count: number): Band {
  if (key === '=1.0') return { key, label: '1.0', upper: 1, order: 11, count };
  if (key === 'null') return { key, label: NO_CONFIDENCE_LABEL, upper: null, order: -1, count };
  const m = /^(\d(?:\.\d)?)-(\d(?:\.\d)?)$/.exec(key);
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    return { key, label: `${m[1]}–${m[2]}`, upper: hi, order: lo * 10, count };
  }
  // An unrecognised key still renders, as itself, at the foot — never silently dropped.
  return { key, label: key, upper: null, order: -2, count };
}

function bandsOf(raw: Record<string, number>): { bands: Band[]; total: number } {
  const bands = Object.entries(raw)
    .map(([key, value]) => describe(key, safeCount(value)))
    .sort((a, b) => b.order - a.order || a.key.localeCompare(b.key));
  const total = bands.reduce((sum, b) => sum + b.count, 0);
  return { bands, total };
}

/** "0.50" — the committed constant, two decimals like the copy's own example. */
const CUTOFF_LABEL = OVERTURE_CONFIDENCE_CUTOFF.toFixed(2);

export function ConfidenceDistribution({
  bands: raw,
  testId,
}: {
  bands: Record<string, number> | null;
  /** The screen owns its hooks: the desk and phone copies each carry their own. */
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  if (!raw || Object.keys(raw).length === 0) return null;

  const { bands, total } = bandsOf(raw);
  // The marker sits above the first band that lies wholly below the cutoff.
  const firstBelow = bands.findIndex((b) => b.upper !== null && b.upper <= OVERTURE_CONFIDENCE_CUTOFF);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-testid={testId}
          className="h-11 w-fit gap-2 px-4 text-base font-normal [&[data-state=open]>svg]:rotate-180"
        >
          {open ? SOURCES_CONFIDENCE_TOGGLE_HIDE : SOURCES_CONFIDENCE_TOGGLE}
          <ChevronDown aria-hidden="true" className="size-4 transition-transform motion-reduce:transition-none" />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent
        data-testid={`${testId}-content`}
        className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none"
      >
        <div className="flex flex-col gap-4 pb-2">
          <ul className="flex max-w-[640px] flex-col gap-2">
            {bands.map((band, index) => {
              const share = total > 0 ? band.count / total : 0;
              const pct = Math.min(100, Math.max(0, share * 100));
              return (
                <li key={band.key} className="flex flex-col gap-2">
                  {index === firstBelow && index > 0 ? (
                    <div
                      aria-hidden="true"
                      data-testid={`${testId}-cutoff-marker`}
                      className="h-px w-full bg-border"
                    />
                  ) : null}
                  <div
                    data-band={band.key}
                    data-count={band.count}
                    // Fixed figure columns, so every bar's track starts and ends at the same
                    // x — each band is its own grid, and `auto` columns sized to "245" vs
                    // "35,270" left the tracks ragged (seen on the first built-app capture).
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)_4rem_3.5rem] items-center gap-x-4 sm:grid-cols-[6rem_minmax(0,1fr)_5rem_4rem]"
                  >
                    <span className="text-sm font-normal tabular-nums text-muted-foreground">
                      {band.label}
                    </span>
                    <Progress
                      value={pct}
                      aria-hidden="true"
                      className="h-2 bg-muted [&_[data-slot=progress-indicator]]:bg-muted-foreground"
                    />
                    <span className="text-right text-sm font-normal tabular-nums">
                      {formatCount(band.count)}
                    </span>
                    <span className="text-right text-sm font-normal tabular-nums text-muted-foreground">
                      {formatPct(share)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p
            data-testid={`${testId}-cutoff`}
            className="max-w-[70ch] text-sm font-normal tabular-nums text-muted-foreground"
          >
            {SOURCES_CUTOFF_LINE(CUTOFF_LABEL)}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

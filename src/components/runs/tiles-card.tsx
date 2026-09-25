import { ChevronDown, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { GoogleMapsTag } from '@/components/places/google-maps-tag';
import { tileRowText } from '@/components/runs/run-alerts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatCount } from '@/lib/time';
import {
  RUN_REPORT_CARD,
  RUN_SUBDIVIDING_TITLE,
  RUN_TILES_COUNT,
  RUN_TILES_EXPLAINER,
} from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { RunReport } from '@/server/queries/run-report';

/**
 * The run report's Tiles card (04-UI-SPEC § Screen 1 → Tiles; criterion 3): Searched ·
 * Saturated · Subdivided · Still truncated.
 *
 * 🔴 PLACES-DERIVED, SO IT CARRIES THE GOOGLE MAPS TAG (D-11, PLACE-06, Executor Rule 28). A
 * saturation count is computed from Places responses. The card itself is the
 * `[data-places-content]` container, and exactly one `GoogleMapsTag` sits at its foot —
 * Google's placement rule is "top or bottom of the container".
 *
 * 🔴 "STILL TRUNCATED" TAKES THE WARNING TREATMENT ONLY ABOVE ZERO (§ Warning item 13): warning
 * text plus the `triangle-alert` icon — never colour alone. At zero it is plain foreground like
 * its siblings.
 *
 * 🔴 ONE TREE FOR BOTH VIEWPORTS. The count grid is 2×2 on phone and four right-aligned columns
 * from `sm` up — the same elements re-flow, so each testid exists once.
 *
 * No client-boundary directive: a server component. `Collapsible` is a client island.
 */

/** Card chrome shared by the four report cards: 16px padding on phone, 24px on desk. The
 *  primitive pads by `--card-spacing`, so the variable moves rather than a `p-*` racing it. */
export const RUN_CARD_CLASS = 'sm:[--card-spacing:--spacing(6)]';

/** A card title — Heading 20/600, as every other card title in the product. */
export function RunCardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-semibold leading-tight">{children}</h2>;
}

export type CountCell = {
  key: string;
  testId: string;
  label: string;
  n: number;
  /** Warning text + `triangle-alert` (the still-truncated cell above zero). */
  warn?: boolean;
  /** Rendered beneath the value (the tentative count's review link). */
  below?: ReactNode;
};

/**
 * The `/sources` count-grid pattern: Label 14/600 labels over Body 16/600 tabular values; 2×2 on
 * phone, four right-aligned columns on desk. Counts never animate — a refresh swaps the digits
 * in place, and `tabular-nums` keeps the column still.
 */
export function CountGrid({ cells }: { cells: CountCell[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.key} className="flex flex-col gap-1 sm:items-end">
          <dt className="text-sm font-semibold">{c.label}</dt>
          <dd
            data-testid={c.testId}
            data-count={c.n}
            className={cn(
              'flex items-center gap-1 text-base font-semibold tabular-nums',
              c.warn ? 'text-warning' : '',
            )}
          >
            {c.warn ? (
              <TriangleAlert data-icon="triangle-alert" aria-hidden="true" className="size-4" />
            ) : null}
            {formatCount(c.n)}
          </dd>
          {c.below ?? null}
        </div>
      ))}
    </dl>
  );
}

export function TilesCard({
  tiles,
  stoppedReason,
}: {
  tiles: RunReport['tiles'];
  stoppedReason: RunReport['run']['stoppedReason'];
}) {
  const exceeded = stoppedReason === 'exceeded_estimate';
  return (
    <Card data-testid="run-tiles" data-places-content className={RUN_CARD_CLASS}>
      <CardHeader>
        <RunCardTitle>{RUN_REPORT_CARD.tiles}</RunCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CountGrid
          cells={[
            {
              key: 'searched',
              testId: 'run-tiles-searched',
              label: RUN_TILES_COUNT.searched,
              n: tiles.searched,
            },
            {
              key: 'saturated',
              testId: 'run-tiles-saturated',
              label: RUN_TILES_COUNT.saturated,
              n: tiles.saturated,
            },
            {
              key: 'subdivided',
              testId: 'run-tiles-subdivided',
              label: RUN_TILES_COUNT.subdivided,
              n: tiles.subdivided,
            },
            {
              key: 'truncated',
              testId: 'run-tiles-truncated',
              label: RUN_TILES_COUNT.truncated,
              n: tiles.stillTruncated,
              warn: tiles.stillTruncated > 0,
            },
          ]}
        />

        <p className="max-w-[70ch] text-sm font-normal text-muted-foreground">
          {RUN_TILES_EXPLAINER}
        </p>

        {exceeded && tiles.stillSubdividing.length > 0 ? (
          // Open on arrival: the stop alert's "Show the tiles still subdividing" is an in-page
          // link to this id, so the list is already showing when the reader lands on it.
          <Collapsible
            id="run-tiles-subdividing"
            data-testid="run-tiles-subdividing"
            defaultOpen
            className="flex flex-col gap-2"
          >
            <CollapsibleTrigger
              data-testid="run-tiles-subdividing-toggle"
              className="group inline-flex h-11 items-center gap-2 self-start rounded-md text-base font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {RUN_SUBDIVIDING_TITLE(tiles.stillSubdividing.length)}
              <ChevronDown
                aria-hidden="true"
                className="size-4 group-data-[state=open]:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="flex flex-col gap-1">
                {tiles.stillSubdividing.map((tile) => (
                  <li
                    key={tile.tileKey}
                    data-testid="run-tiles-subdividing-tile"
                    data-tile-key={tile.tileKey}
                    className="text-sm font-normal tabular-nums"
                  >
                    {tileRowText(tile)}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <p className="text-sm">
          <GoogleMapsTag />
        </p>
      </CardContent>
    </Card>
  );
}

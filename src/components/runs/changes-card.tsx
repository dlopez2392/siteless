import { GoogleMapsTag } from '@/components/places/google-maps-tag';
import { CountGrid, RUN_CARD_CLASS, RunCardTitle } from '@/components/runs/tiles-card';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  RUN_CHANGE_CANDIDATES,
  RUN_CHANGE_COUNT,
  RUN_CHANGE_IDS_LINE,
  RUN_REPORT_CARD,
} from '@/lib/ui/copy';
import type { RunReport } from '@/server/queries/run-report';

/**
 * A change check's "Changes" card (04-UI-SPEC § Screen 1 → Change-check runs; D-16). It replaces
 * the Outcomes card: a change check lists Google's place ids tile by tile with the free IDs-only
 * search, so there is nothing to match and no website to classify — only which tiles changed.
 *
 * 🔴 PLACES-DERIVED, SO IT CARRIES THE GOOGLE MAPS TAG (Rule 28): a change count is computed
 * from Places responses. The card is the `[data-places-content]` container.
 *
 * 🔴 TILES, NOT PAGES (04-19 handoff). `record_change_check` records `pages_done = 1` even for a
 * multi-page check, so this card never presents a page count; every figure here is a tile or a
 * place-id count.
 *
 * No client-boundary directive: a server component.
 */
export function ChangesCard({ changes }: { changes: NonNullable<RunReport['changes']> }) {
  return (
    <Card data-testid="run-changes" data-places-content className={RUN_CARD_CLASS}>
      <CardHeader>
        <RunCardTitle>{RUN_REPORT_CARD.changes}</RunCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CountGrid
          cells={[
            {
              key: 'checked',
              testId: 'run-changes-checked',
              label: RUN_CHANGE_COUNT.checked,
              n: changes.checked,
            },
            {
              key: 'unchanged',
              testId: 'run-changes-unchanged',
              label: RUN_CHANGE_COUNT.unchanged,
              n: changes.unchanged,
            },
            {
              key: 'new',
              testId: 'run-changes-new',
              label: RUN_CHANGE_COUNT.new,
              n: changes.withNew,
            },
            {
              key: 'gone',
              testId: 'run-changes-gone',
              label: RUN_CHANGE_COUNT.gone,
              n: changes.withGone,
            },
          ]}
        />
        <p data-testid="run-changes-ids" className="text-base font-normal tabular-nums">
          {RUN_CHANGE_IDS_LINE(changes.newIds, changes.goneIds)}
        </p>
        <p className="max-w-[70ch] text-sm font-normal text-muted-foreground tabular-nums">
          {RUN_CHANGE_CANDIDATES(changes.changedTiles)}
        </p>
        <p className="text-sm">
          <GoogleMapsTag />
        </p>
      </CardContent>
    </Card>
  );
}

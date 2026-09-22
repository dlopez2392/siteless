import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import type { EstimateRange } from '@/lib/estimate/estimate';
import { formatPct, formatUsd } from '@/lib/budget/money';
import { APP_LOCALE, formatLocal } from '@/lib/time';
import { RUN_LABEL, type RunStatus } from '@/lib/ui/run-tone';
import { geoHeadline, type DiffGeo } from './version-diff';

/**
 * The focal point of the preset detail screen (UI-SPEC § Screen Inventory 3): what the
 * current version searches for, what it will cost, and when it last ran.
 *
 * 🔴 A SERVER COMPONENT, AND EVERY FIGURE ARRIVES PRE-COMPUTED. The estimate is not
 * recomputed here and no number below is arithmetic performed in a render — Executor Rule
 * 16: the figures in UI-SPEC are FORMAT, not arithmetic. `~68 requests · ~$2.40` shows the
 * shape of the line; the values come from the server-computed `EstimateRange` for this
 * version with the monthly free allowance already applied, which is why an early-month
 * preset legitimately reads `$0.00` and must not be "corrected" into looking wrong.
 *
 * 🔴 NO RUN-STATUS BADGE HERE, DELIBERATELY. `RUN_TONE` maps a `running` run to the
 * accent-outline tone, and UI-SPEC § Color's accent list item 7 says the `Current` version
 * badge is the ONLY badge in the product that carries accent. A status badge on this card
 * would put a second accent badge on the same screen the rule was written about, so the
 * last run's status renders as its `RUN_LABEL` word in muted text instead. Colour was never
 * the signal there — the word is.
 */

/** The single-line estimate, already formatted, split so the dollar figure can be painted
 *  accent on its own (§ Color, accent list item 4) without this component re-deriving it. */
export type EstimateLineParts = {
  requests: string;
  cost: string;
  businesses: string;
  share: string;
};

/**
 * `EstimateRange` -> the four spans of UI-SPEC's inline estimate line.
 *
 * 🔴 `pctOfRemaining*` IS A PERCENTAGE (0-100) AND `formatPct` TAKES A FRACTION. The
 * estimator returns `100` for "all of what is left", and `formatPct` is
 * `Intl.NumberFormat(style:'percent')`, which multiplies by 100 — so handing it the
 * percentage directly renders "4,800.0%". The division is here, once, rather than at each
 * call site that wants the line.
 *
 * Counts go through `Intl.NumberFormat` with the PINNED locale from `src/lib/time.ts`, not
 * `toLocaleString()`: an unpinned locale resolves from the environment, so the server and
 * the browser can disagree and produce an SSR hydration mismatch on a rendered number (a
 * recorded BIS defect for `es-*` browsers).
 */
export function estimateLineParts(range: EstimateRange): EstimateLineParts {
  const count = new Intl.NumberFormat(APP_LOCALE);
  return {
    requests: `~${count.format(range.requestsHi)} requests`,
    cost: `~${formatUsd(range.costMicroUsdHi)}`,
    businesses: `~${count.format(range.expectedResults)} businesses`,
    share: `${formatPct(range.pctOfRemainingHi / 100)} of this month's remaining ${formatUsd(
      range.remainingMicroUsd,
    )}`,
  };
}

/** The estimate as a RANGE, for the run drawer and the duplicate dialog, where the
 *  question is "what am I about to commit to" rather than "what does this cost". */
export function estimateRangeLabel(range: EstimateRange): string {
  const lo = formatUsd(range.costMicroUsdLo);
  const hi = formatUsd(range.costMicroUsdHi);
  return lo === hi ? lo : `${lo} – ${hi}`;
}

export function estimateRequestsLabel(range: EstimateRange): string {
  const count = new Intl.NumberFormat(APP_LOCALE);
  const lo = range.requestsLo;
  const hi = range.requestsHi;
  const requests = lo === hi ? count.format(hi) : `${count.format(lo)} – ${count.format(hi)}`;
  return `${requests} requests`;
}

/** UI-SPEC's Copy Table → preset list card footer: "Last run {date}" / "Never run". The
 *  same two sentences are correct here and a third phrasing for the same fact would be a
 *  paraphrase of a fixed string. */
export type LastRun = {
  status: RunStatus;
  at: Date;
  costMicroUsd: bigint;
};

/** Inline estimate line. `tabular-nums` on every comparable figure (§ Typography) so the
 *  digits do not jump between versions, and the dollar figure carries accent. */
function EstimateLine({ parts }: { parts: EstimateLineParts }) {
  return (
    <p data-testid="summary-estimate" className="text-sm font-normal text-muted-foreground">
      <span className="tabular-nums">{parts.requests}</span>
      {' · '}
      <span data-testid="summary-estimate-cost" className="font-semibold tabular-nums text-primary">
        {parts.cost}
      </span>
      {' · '}
      <span className="tabular-nums">{parts.businesses}</span>
      {' · '}
      <span className="tabular-nums">{parts.share}</span>
    </p>
  );
}

export function SummaryCard({
  version,
  isCurrent,
  clusterNames,
  geo,
  estimate,
  lastRun,
}: {
  version: number;
  isCurrent: boolean;
  clusterNames: string[];
  geo: DiffGeo;
  /** `null` when a referenced city, county or cluster has gone, or when the estimator
   *  cannot price this geography. The card still renders everything else — Executor Rule
   *  11: never blank content to satisfy a state. */
  estimate: EstimateLineParts | null;
  lastRun: LastRun | null;
}) {
  return (
    <Card data-testid="preset-summary">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* 🔴 THE ONLY ACCENT BADGE IN THE PRODUCT (§ Color, accent list item 7):
              accent outline and accent text, NO fill. `variant="outline"` supplies the
              border-and-no-background shape; the two classes repaint it from neutral to
              accent. */}
          <Badge
            data-testid="summary-version-badge"
            variant="outline"
            className={isCurrent ? 'border-primary text-primary' : undefined}
          >
            {isCurrent ? `Version ${version} · current` : `Version ${version}`}
          </Badge>
        </div>

        <ItemGroup>
          <Item className="px-0">
            <ItemContent>
              <ItemTitle className="text-sm font-semibold text-muted-foreground">
                Industry clusters
              </ItemTitle>
              <p data-testid="summary-clusters" className="text-base font-normal">
                {clusterNames.join(' · ')}
              </p>
            </ItemContent>
          </Item>
          <Item className="px-0">
            <ItemContent>
              <ItemTitle className="text-sm font-semibold text-muted-foreground">
                Geography
              </ItemTitle>
              <p data-testid="summary-geography" className="text-base font-normal">
                {geoHeadline(geo)}
              </p>
            </ItemContent>
          </Item>
        </ItemGroup>

        <Separator />

        {estimate ? (
          <EstimateLine parts={estimate} />
        ) : (
          <p data-testid="summary-estimate" className="text-sm font-normal text-muted-foreground">
            Siteless can&rsquo;t price this version — the outlet counts behind its geography
            aren&rsquo;t seeded. Saving and editing still cost nothing.
          </p>
        )}

        {/* 🔴 THE ZONE IS PINNED. `formatLocal` resolves APP_TZ from src/lib/time.ts, the
            only file in src/ that names a zone for a machine. A bare date formatter here
            would render in the SYSTEM zone — UTC on Vercel — and show the previous day
            across the Americas for anything after 7pm Chicago. */}
        <p data-testid="summary-last-run" className="text-sm font-normal text-muted-foreground">
          {lastRun ? (
            <>
              {'Last run '}
              <span className="tabular-nums">
                {formatLocal(lastRun.at, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              {' · '}
              <span className="tabular-nums">{formatUsd(lastRun.costMicroUsd)}</span>
              {' · '}
              {RUN_LABEL[lastRun.status]}
            </>
          ) : (
            'Never run'
          )}
        </p>
      </CardContent>
    </Card>
  );
}

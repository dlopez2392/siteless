import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUsd } from '@/lib/budget/money';
import type { Provider } from '@/lib/budget/price-book';
import type { ProviderSpend } from '@/server/queries/budget';

/**
 * D-14's "by provider" tab: month-to-date settled spend for each of the three providers
 * this product can bill against, versus the cap.
 *
 * 🔴 ALL THREE ROWS, ALWAYS, INCLUDING THE ZERO ONES. `readSpendByProvider` builds the
 * provider list with a `values` clause precisely so a provider that has never been called
 * still returns a row, and this component renders every row it is handed without
 * filtering. A hidden row reads as "we are not spending there"; what it would actually
 * mean is "we are not measuring there", and those are opposite claims about money. In
 * Phase 2 that is the normal state — nothing has called anything yet — so a filter here
 * would empty the tab on the very month it matters most.
 *
 * 🔴 THE SHARE BAR IS A SHARE OF THE CAP, NOT OF THE MONTH'S SPEND. A bar normalised to
 * the largest provider would show Places at full width on a month that spent forty cents,
 * which is the chart that lies. The denominator is the cap, so three near-empty bars mean
 * three near-empty bars.
 *
 * 🔴 THE BARS ARE NOT ACCENT. UI-SPEC § Accent reserved for is an exhaustive list and the
 * per-provider bars are not on it; the gauge fill under 80% is. They are painted in the
 * muted foreground so the one accent element on the screen stays the month-to-date figure.
 */

/** Display names for the three `Provider` values — `places`, `firecrawl`, `anthropic`.
 *  Keyed by the union so a fourth provider cannot be added to the type without a label. */
const PROVIDER_LABEL: Record<Provider, string> = {
  places: 'Places',
  firecrawl: 'Firecrawl',
  anthropic: 'Anthropic',
};

/** UI-SPEC § Copy Table → "Spend | Provider zero row": `$0.00 · no calls yet`. The
 *  non-zero form reads `$12.40 · 312 calls`, so the two states share one shape and the
 *  zero row is visibly a reading rather than a gap. */
function callsLabel(calls: number): string {
  if (calls <= 0) return 'no calls yet';
  return calls === 1 ? '1 call' : `${calls} calls`;
}

/** Percent of the cap, as a plain number for a painted width. Clamped, and answered
 *  before any division so a zero cap cannot throw a RangeError onto the page. */
function shareOfCap(microUsd: bigint, capMicroUsd: bigint): number {
  if (capMicroUsd <= 0n || microUsd <= 0n) return 0;
  const tenths = (microUsd * 1000n) / capMicroUsd;
  return Number(tenths > 1000n ? 1000n : tenths) / 10;
}

export function ByProvider({
  rows,
  capMicroUsd,
}: {
  rows: ProviderSpend[];
  capMicroUsd: bigint;
}) {
  return (
    <ItemGroup data-testid="spend-by-provider">
      {rows.map((row, index) => (
        <div key={row.provider}>
          {index > 0 ? <ItemSeparator /> : null}
          <Item data-testid={`spend-provider-${row.provider}`}>
            <ItemContent className="gap-2">
              <ItemTitle className="text-base font-normal">
                {PROVIDER_LABEL[row.provider]}
              </ItemTitle>
              {/* 4px, painted, no chart library. `aria-hidden` because the figure and the
                  call count beside it already say everything the bar encodes.

                  🔴 CAPPED AT 240px RATHER THAN SPANNING THE ROW. At full row width a bar
                  reading 0% is indistinguishable from a horizontal rule, and the first
                  screenshots of this screen showed exactly that — three providers each
                  looking like they had a divider under their name. The width is the same
                  for all three, so the comparison the bar exists for still holds. */}
              <div
                aria-hidden="true"
                className="h-1 w-full max-w-[240px] overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-muted-foreground"
                  style={{ width: `${shareOfCap(row.microUsd, capMicroUsd)}%` }}
                />
              </div>
            </ItemContent>
            <ItemActions className="shrink-0 flex-col items-end gap-0.5">
              <span
                data-testid={`spend-provider-${row.provider}-amount`}
                className="text-base font-semibold tabular-nums"
              >
                {formatUsd(row.microUsd)}
              </span>
              <span className="text-sm font-normal tabular-nums text-muted-foreground">
                · {callsLabel(row.calls)}
              </span>
            </ItemActions>
          </Item>
        </div>
      ))}
    </ItemGroup>
  );
}

/** UI-SPEC § States → Loading: three row skeletons beneath the header card. */
export function ProviderRowsSkeleton() {
  return (
    <ItemGroup data-testid="spend-by-provider-skeleton">
      {[0, 1, 2].map((row) => (
        <Item key={row}>
          <ItemContent className="gap-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-1 w-full rounded-full" />
          </ItemContent>
          <ItemActions className="shrink-0 flex-col items-end gap-1">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-5 w-20" />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

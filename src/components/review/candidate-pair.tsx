import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  FLAG_CHAIN,
  FLAG_CLOSED,
  REVIEW_MISSING_FIELD,
  REVIEW_SIDE_LABEL,
  SOURCE_TAG,
} from '@/lib/ui/copy';
import { displayPhone } from '@/lib/ui/review-format';
import { formatLocal } from '@/lib/time';
import type { CandidatePairView, CandidateSideView } from '@/server/queries/review-queue';
import { SignalChips } from './signal-chips';

/**
 * `/review`'s focal point (03-UI-SPEC § 1, D-13): the two records a person is asked to judge.
 *
 * Each side, in D-13's order: `display_name` (Heading 20/600, VERBATIM — an `ñ` is the
 * business's own name) · address · phone · category / cluster · the source tag · `Closed {date}`
 * · `Chain · {n} in Texas`.
 *
 * 🔴 NO CLIENT DIRECTIVE. A server component; every value arrives as a prop and every sentence
 * from `src/lib/ui/copy.ts` (server-safe), so nothing here resolves to a client reference.
 *
 * 🔴 A FIELD THE SOURCE DOES NOT CARRY READS "Not on this record" in muted text — never a blank
 * cell and never a bare dash, because a blank reads as "we lost it" and a dash reads as nothing.
 *
 * 🔴 THE NORMALIZED MATCH KEY IS NOT IN THE VIEW AND NOT HERE (D-12, Rule 17). The chain badge
 * renders a member COUNT; it says "in Texas" only when the count is the statewide frequency
 * (`chain.statewide`) — an RGV-only count claiming the state would be a false sentence.
 *
 * LAYOUT: one grid whose DOM order is A → chips → B. Phone (<640px) stacks exactly that
 * (D-13's order); from 640px up the two cards sit side by side and the chip band moves beneath
 * BOTH (chips cannot sit between two side-by-side columns), spanning the row.
 */

function Missing() {
  return <span className="text-muted-foreground">{REVIEW_MISSING_FIELD}</span>;
}

function addressOf(side: CandidateSideView): string | null {
  const locality = [side.city, side.postal].filter((v): v is string => !!v && v.trim() !== '');
  const parts = [side.street, locality.join(' ')].filter((v): v is string => !!v && v.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

function categoryOf(side: CandidateSideView): string | null {
  const parts = [side.basicCategory, side.clusterName].filter(
    (v): v is string => !!v && v.trim() !== '',
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

function Side({
  side,
  which,
  'data-testid': testId,
  className,
}: {
  side: CandidateSideView;
  which: 'a' | 'b';
  /** Spelled at the call site so the hook a spec looks for is greppable where it is set. */
  'data-testid': string;
  className?: string;
}) {
  const address = addressOf(side);
  const category = categoryOf(side);
  return (
    <Card data-testid={testId} className={cn('h-full', className)}>
      <CardContent className="flex flex-col gap-2 p-4 lg:p-6">
        {/* The first heading of the pair takes focus after an advance (review-actions.tsx). */}
        <h2
          tabIndex={which === 'a' ? -1 : undefined}
          data-review-focus={which === 'a' ? '' : undefined}
          className="text-xl font-semibold leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          {/* Screen-reader names: "Left"/"Right" where the two sit side by side, "First
              record"/"Second record" where they stack. */}
          <span className="sr-only sm:hidden">{REVIEW_SIDE_LABEL.phone[which]}: </span>
          <span className="sr-only hidden sm:inline">{REVIEW_SIDE_LABEL.desk[which]}: </span>
          {side.displayName}
        </h2>

        <p className="text-base font-normal">{address ?? <Missing />}</p>
        <p className="text-base font-normal tabular-nums">
          {side.phoneE164 ? displayPhone(side.phoneE164) : <Missing />}
        </p>
        <p className="text-sm font-normal text-muted-foreground">{category ?? <Missing />}</p>

        {/* The inline source tag: plain muted text, never a badge (Rule 22). */}
        <p className="text-sm font-normal text-muted-foreground">
          {side.sourceKey ? SOURCE_TAG[side.sourceKey] : REVIEW_MISSING_FIELD}
        </p>

        {side.closedAt || side.chain ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {side.closedAt ? (
              <Badge
                data-testid={`${testId}-closed`}
                className="h-auto bg-destructive-surface px-2 py-1 text-sm font-semibold text-destructive-surface-foreground tabular-nums"
              >
                {FLAG_CLOSED(
                  formatLocal(side.closedAt, { month: 'short', day: 'numeric', year: 'numeric' }),
                )}
              </Badge>
            ) : null}
            {side.chain ? (
              <Badge
                variant="outline"
                data-testid={`${testId}-chain`}
                className="h-auto px-2 py-1 text-sm font-semibold text-muted-foreground tabular-nums"
              >
                {side.chain.statewide
                  ? FLAG_CHAIN(side.chain.members)
                  : // No statewide count was measured, so the only honest number is the local
                    // one and "in Texas" would overclaim; the chain word and count still show.
                    FLAG_CHAIN(side.chain.members).replace(' in Texas', '')}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CandidatePair({ pair }: { pair: CandidatePairView }) {
  return (
    <div data-testid="review-pair" className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
      <Side side={pair.a} which="a" data-testid="review-side-a" className="sm:order-1" />
      <SignalChips
        score={pair.score}
        features={pair.features}
        a={pair.a}
        b={pair.b}
        className="sm:order-3 sm:col-span-2"
      />
      <Side side={pair.b} which="b" data-testid="review-side-b" className="sm:order-2" />
    </div>
  );
}

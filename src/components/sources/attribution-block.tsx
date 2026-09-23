import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ATTRIBUTION_BODY, ATTRIBUTION_FOOTNOTE, ATTRIBUTION_HEADING } from '@/lib/ui/copy';

/**
 * "Where this data comes from" — the foot of `/sources` (03-UI-SPEC § 2; 03-CONTEXT
 * § Deferred: "the UI pass places it on /sources").
 *
 * 🔴 LICENCE TEXT (T-3-14). CDLA-Permissive 2.0 asks that the Overture attribution travel
 * with the data; this card is the in-app half of that, and it also says plainly that none
 * of the durable record is Google data. The sentences are IMPORTED from `copy.ts`, never
 * retyped, so the licence wording lives in exactly one place. The CSV half is Phase 8's
 * (COMP-03) and is deliberately not written here.
 *
 * The `--muted` surface with muted foreground, and no accent anywhere: this is a notice,
 * not an action.
 */
export function AttributionBlock() {
  return (
    <Card
      data-testid="sources-attribution"
      className="gap-4 bg-muted py-4 text-muted-foreground shadow-none ring-0 sm:py-6"
    >
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="text-xl font-semibold leading-tight">
          {ATTRIBUTION_HEADING}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4 sm:px-6">
        <p className="max-w-[70ch] text-base font-normal">{ATTRIBUTION_BODY}</p>
        <p className="max-w-[70ch] text-sm font-normal">{ATTRIBUTION_FOOTNOTE}</p>
      </CardContent>
    </Card>
  );
}

import { ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * BUDG-03, the documentation half. UI-SPEC § Screen Inventory 4, card 3.
 *
 * 🔴 THIS CARD IS STATIC PROSE AND MUST STAY THAT WAY (UI-SPEC Executor Rule 14). It reads
 * no credential, makes no request, and no test anywhere in this repo depends on the Google
 * Cloud project existing — because it does not. The project and the Places API (New) key
 * are a `checkpoint:human-action` in plan 02-14, and the whole of Phase 2 was built and
 * verified before danlo ever creates them. `tests/unit/no-google-credential.test.ts` walks
 * `src/` for credential-shaped references and this file is inside that walk.
 *
 * 🔴 THE HONESTY LINE IS THE POINT OF THE CARD, NOT A CAVEAT ON IT. 100 requests/day over
 * 30 days is 3,000 requests, which is $70 — MORE than the cap. The quota bounds a runaway
 * DAY; only the app meter bounds the MONTH. A card that printed the recommendation without
 * that sentence would read as "the quota protects the budget", and someone would eventually
 * rely on it instead of the meter.
 *
 * 🔴 THE DERIVATION IS ANCHORED TO THE $50.00 PROJECT BUDGET, NOT TO THE ORG'S LIVE CAP.
 * It is the arithmetic behind a recommended quota value, fixed verbatim by UI-SPEC and
 * re-derived independently in 02-RESEARCH § The Second Wall — not a reading of this
 * tenant's meter. Interpolating the live cap would silently restate Google's published
 * prices as a function of a number the user just typed.
 *
 * 🔴 THREE THINGS IN THIS PRODUCT ARE CALLED "MONTHLY" and this card is where two of them
 * meet: Siteless's budget period resets at local midnight on the 1st in America/Chicago,
 * while a Google Cloud daily quota resets on Google's own clock (US/Pacific) and Google's
 * billing month is a third thing again. The copy below never says or implies they coincide.
 */

/** Google Cloud console → Google Maps Platform → Quotas. Deliberately the Maps Platform
 *  path rather than a per-API deep link: the per-API URL carries an API hostname, and the
 *  credential guard treats that hostname as a reference to the integration this phase does
 *  not have. */
const QUOTAS_CONSOLE = 'https://console.cloud.google.com/google/maps-apis/quotas';

export function SecondWallCard() {
  return (
    <Card data-testid="budget-second-wall" className="bg-muted ring-1 ring-border">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <ShieldAlert data-icon="shield-alert" aria-hidden="true" className="size-5 shrink-0" />
          <span>Google Cloud daily quota — not set yet</span>
          <Badge variant="outline" className="text-xs font-semibold">
            Needs danlo
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="max-w-[60ch] text-base font-normal">
          The $50.00 cap is Siteless&apos;s own meter and it is the wall that matters. A
          per-API daily quota in Google Cloud is the independent second wall, and it can
          only be set once the Google Cloud project and the Places API (New) key exist —
          they don&apos;t yet.
        </p>

        <p className="max-w-[72ch] text-sm font-normal tabular-nums text-muted-foreground">
          Set <strong className="font-semibold">Places API (New) → 100 requests/day</strong>.
          Derivation: a $50.00 cap buys 1,428 paid Text Search Enterprise requests at
          $35.00/1,000, plus 1,000 free = 2,428/month ≈ 80/day. Rounded to 100/day so a
          weekly partition can burst. The quota does not replace the meter — it bounds a
          runaway loop to about $3.50/day instead of $50.00 in an hour.
        </p>

        <p
          data-testid="budget-second-wall-limit"
          className="max-w-[72ch] text-sm font-normal tabular-nums text-muted-foreground"
        >
          What it does <strong className="font-semibold">not</strong> do: 100/day × 30 days
          is 3,000 requests, which is $70/month — more than the $50.00 cap. The quota bounds
          a runaway <strong className="font-semibold">day</strong>; only Siteless&apos;s own
          meter bounds the <strong className="font-semibold">month</strong>. That is what
          &ldquo;second wall, not the primary meter&rdquo; means.
        </p>

        {/* Inline text link inside body copy — accent, per UI-SPEC § Color item 6. 44px
            tall because it is tapped on a phone like everything else. */}
        <a
          href={QUOTAS_CONSOLE}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="budget-second-wall-console"
          className="inline-flex h-11 w-fit items-center text-sm font-normal text-primary underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Open the Google Cloud quotas console
        </a>
      </CardContent>
    </Card>
  );
}

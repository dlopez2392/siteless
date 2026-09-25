import { ShieldAlert } from 'lucide-react';
import { FLAG_BADGE_SIZING } from '@/components/flags/flag-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PRICE_BOOK } from '@/lib/budget/price-book';
import { GOOGLE_QUOTA_REQUESTS_PER_DAY, GOOGLE_QUOTA_SET_ON } from '@/lib/budget/second-wall';
import { formatLocal } from '@/lib/time';
import {
  SECOND_WALL_BODY,
  SECOND_WALL_CONSOLE_LINK,
  SECOND_WALL_DERIVATION,
  SECOND_WALL_LIMIT,
  SECOND_WALL_NEEDS_BADGE,
  SECOND_WALL_SET_BADGE,
  SECOND_WALL_SET_BODY,
  SECOND_WALL_SET_TITLE,
  SECOND_WALL_TITLE,
  type EmphasisRun,
  type SecondWallInputs,
} from '@/lib/ui/copy';

/**
 * BUDG-03 on /settings/budget. 02-UI-SPEC § Screen Inventory 4, card 3; 04-UI-SPEC § Screen 6.
 *
 * 🔴 THIS CARD IS STATIC AND MUST STAY THAT WAY (UI-SPEC Executor Rule 14). It reads no
 * credential and makes no request — the app cannot read Google Cloud and must not claim to.
 * Its two states switch on ONE recorded constant, `GOOGLE_QUOTA_SET_ON`
 * (src/lib/budget/second-wall.ts): `null` renders "not set yet"; a date — typed in by the plan
 * that closed danlo's D-03 checkpoint (04-31) — renders "set on {date}". A record of what a
 * human did, never a reading of what Google enforces. `tests/unit/no-google-credential.test.ts`
 * walks `src/` for credential-shaped references and this file is inside that walk.
 *
 * 🔴 THE HONESTY LINE IS THE POINT OF THE CARD, NOT A CAVEAT ON IT, AND IT SHOWS IN BOTH STATES.
 * 100 requests/day over 30 days is 3,000 requests, which is $70 — MORE than the cap. The quota
 * bounds a runaway DAY; only the app meter bounds the MONTH. A card that printed the value
 * without that sentence would read as "the quota protects the budget".
 *
 * 🔴 THE DERIVATION IS ANCHORED TO THE $50.00 PROJECT BUDGET, NOT TO THE ORG'S LIVE CAP. It is
 * the arithmetic behind a recommended quota value, not a reading of this tenant's meter. It is
 * the not-set state's: once set, the imperative "Set Places API (New) → SearchTextRequest per
 * day = 100, every other Places method per day = 0" would ask for something already done, and the set body names the value and the $3.50 bound.
 *
 * 🔴 THREE THINGS IN THIS PRODUCT ARE CALLED "MONTHLY" and this card is where two of them meet:
 * Siteless's budget period resets at local midnight on the 1st in America/Chicago, while a
 * Google Cloud daily quota resets on Google's own clock (US/Pacific). The copy never says or
 * implies they coincide.
 *
 * Every word is in `copy.ts` (Rule 41); `tests/unit/second-wall-card.test.tsx` walks this
 * file's syntax tree and fails on any prose literal.
 */

/** Google Cloud console → Google Maps Platform → Quotas. Deliberately the Maps Platform
 *  path rather than a per-API deep link: the per-API URL carries an API hostname, and the
 *  credential guard treats that hostname as a reference to the integration. */
const QUOTAS_CONSOLE = 'https://console.cloud.google.com/google/maps-apis/quotas';

/**
 * 'YYYY-MM-DD' — a calendar day, never an instant → "Sep 25, 2026".
 *
 * 🔴 ANCHORED AT NOON UTC, NOT MIDNIGHT. `formatLocal` renders in America/Chicago (UTC−5/−6);
 * midnight UTC on the 25th IS the evening of the 24th there. Same rule as `formatWeekRange` in
 * src/lib/time.ts. An unreadable value renders as written rather than as a wrong date.
 */
function calendarDayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return formatLocal(at, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Runs({ runs }: { runs: readonly EmphasisRun[] }) {
  return runs.map((run, i) =>
    run.strong ? (
      <strong key={i} className="font-semibold">
        {run.text}
      </strong>
    ) : (
      <span key={i}>{run.text}</span>
    ),
  );
}

/** The project budget the recommended quota was derived against (docs/runbooks/google-quota.md),
 *  in µUSD — see the header: deliberately not the org's live cap. */
const PROJECT_BUDGET_MICRO_USD = 50_000_000;

export function SecondWallCard() {
  const setOn = GOOGLE_QUOTA_SET_ON;
  const isSet = setOn !== null;
  // 🔴 C-WR-09: every number on the card is derived from the ONE quota constant the run-stop
  // alert reads and from the price book — never typed. Change the quota and both move.
  const inputs: SecondWallInputs = {
    quotaPerDay: GOOGLE_QUOTA_REQUESTS_PER_DAY,
    microUsdPerRequest: PRICE_BOOK.ts_enterprise.microUsdPerRequest,
    freePerMonth: PRICE_BOOK.ts_enterprise.freePerMonth ?? 0,
    budgetMicroUsd: PROJECT_BUDGET_MICRO_USD,
  };

  return (
    <Card data-testid="budget-second-wall" className="bg-muted ring-1 ring-border">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <ShieldAlert data-icon="shield-alert" aria-hidden="true" className="size-5 shrink-0" />
          <span>{isSet ? SECOND_WALL_SET_TITLE : SECOND_WALL_TITLE}</span>
          {isSet ? (
            <Badge variant="secondary" className={FLAG_BADGE_SIZING}>
              {SECOND_WALL_SET_BADGE}
            </Badge>
          ) : (
            <Badge variant="outline" className={FLAG_BADGE_SIZING}>
              {SECOND_WALL_NEEDS_BADGE}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p data-testid="budget-second-wall-body" className="max-w-[60ch] text-base font-normal">
          {isSet ? SECOND_WALL_SET_BODY(calendarDayLabel(setOn), inputs) : SECOND_WALL_BODY}
        </p>

        {isSet ? null : (
          <p
            data-testid="budget-second-wall-derivation"
            className="max-w-[72ch] text-sm font-normal tabular-nums text-muted-foreground"
          >
            <Runs runs={SECOND_WALL_DERIVATION(inputs)} />
          </p>
        )}

        <p
          data-testid="budget-second-wall-limit"
          className="max-w-[72ch] text-sm font-normal tabular-nums text-muted-foreground"
        >
          <Runs runs={SECOND_WALL_LIMIT(inputs)} />
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
          {SECOND_WALL_CONSOLE_LINK}
        </a>
      </CardContent>
    </Card>
  );
}

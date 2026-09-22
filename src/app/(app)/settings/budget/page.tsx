import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { SettingsNav } from '@/components/app-shell/settings-nav';
import { CapForm } from '@/components/budget/cap-form';
import { SecondWallCard } from '@/components/budget/second-wall-card';
import { BudgetGauge } from '@/components/spend/budget-gauge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { orgClaims, requireOrg } from '@/lib/auth/require-org';
import { formatUsd, formatUsdInput } from '@/lib/budget/money';
import { periodResetInstant } from '@/lib/budget/period';
import { formatLocal } from '@/lib/time';
import { BUDGET_ADMIN_ONLY, BUDGET_CAP_HELP } from '@/lib/ui/copy';
import { getCurrentPeriod } from '@/server/queries/budget';

export const dynamic = 'force-dynamic';

/**
 * D-10 and BUDG-03. UI-SPEC § Screen Inventory 4: the cap an admin edits, the period it
 * applies to, and the second wall that is not built yet.
 *
 * 🔴 THE `org:admin` CHECK BELOW IS AFFORDANCE, NOT AUTHORIZATION. It decides which
 * sentence a member reads; it decides nothing about what a member can do. The boundary is
 * `app.set_budget_cap` re-checking `app.current_org_role()` in SQL (`42501`) and, behind
 * that, the fact that `authenticated` holds no UPDATE grant on `budget_periods` at all —
 * both proven in plan 02-08 (T-2-02). Do not remove this check, and do not rely on it.
 *
 * 🔴 THE TWO ROLE SPELLINGS ARE NOT A TYPO. Clerk session token v2 nests the BARE role
 * under `o.rol` ('admin'); `@clerk/shared` builds `auth().orgRole` as `org:${o.rol}`. The
 * TypeScript side therefore compares against `'org:admin'` and SQL against `'admin'`, out
 * of one token. Comparing one to the other is how an admin gate silently passes — or
 * silently fails — depending on which side was written first.
 *
 * 🔴 A MEMBER STILL SEES THE NUMBER. UI-SPEC is explicit: the cap value is shown read-only.
 * A ceiling you cannot see is one you cannot plan around, and hiding it would teach people
 * to ask in chat what the product could simply say. The current-period card and the second
 * wall card render for everybody.
 *
 * 🔴 ONE METER READ, SEQUENTIAL, NEVER NESTED. `src/db/client.ts` pools with `max: 1`, so a
 * `withOrg` opened inside another one waits on a connection the outer transaction holds and
 * the request HANGS rather than failing (02-09 deviation 7).
 */
export default async function BudgetSettingsPage() {
  const { orgId, orgSlug } = await requireOrg();
  const claims = await orgClaims();
  const period = await getCurrentPeriod(claims, 'places');

  const { orgRole } = await auth();
  const isAdmin = orgRole === 'org:admin';

  const cap = period.capMicroUsd;
  const committed = period.spentMicroUsd + period.reservedMicroUsd;
  const left = cap > committed ? cap - committed : 0n;
  const resetDate = formatLocal(periodResetInstant(period.periodStart), {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold leading-tight">Settings</h1>

      <SettingsNav />

      {/* UI-SPEC's focal point for this screen is "the cap input with the live gauge
          immediately beside it (desk) or above it (phone)". Side by side from `lg` up puts
          the gauge literally beside the field; below that they stack in the order the
          plan enumerates them. `items-start` so the short period card does not stretch to
          the height of the tall cap card and sit mostly empty. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card data-testid="budget-cap-card">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Monthly data cap</CardTitle>
          </CardHeader>
          <CardContent>
            {isAdmin ? (
              <CapForm provider="places" initialCapUsd={formatUsdInput(cap)} />
            ) : (
              <MemberView capMicroUsd={cap} orgLabel={orgSlug ?? orgId} />
            )}
          </CardContent>
        </Card>

        <Card data-testid="budget-period-card">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Current period</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BudgetGauge
              capMicroUsd={cap}
              committedMicroUsd={committed}
              testId="budget-period-gauge"
            />
            <p data-testid="budget-period-line" className="text-base font-normal tabular-nums">
              {formatUsd(committed)} of {formatUsd(cap)} used · {formatUsd(left)} left · resets{' '}
              {resetDate}
            </p>
          </CardContent>
        </Card>
      </div>

      <SecondWallCard />
    </div>
  );
}

/**
 * UI-SPEC § States → Error, "Non-admin on Budget settings", with the cap still visible.
 *
 * 🔴 PLAIN TEXT, NOT A DISABLED INPUT. A greyed-out copy of the admin's control says "you
 * could edit this if something changed"; the truth is that this reader never can, and a
 * sentence explaining why is more useful than an affordance that is switched off. It is
 * also one fewer focusable element that does nothing.
 */
function MemberView({ capMicroUsd, orgLabel }: { capMicroUsd: bigint; orgLabel: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-muted-foreground">Monthly cap</p>
        <p data-testid="budget-cap-readonly" className="text-base font-normal tabular-nums">
          {formatUsd(capMicroUsd)}
        </p>
      </div>

      <p data-testid="budget-cap-admin-only" className="max-w-[60ch] text-base font-normal">
        {BUDGET_ADMIN_ONLY(orgLabel)}
      </p>

      <p className="max-w-[60ch] text-sm font-normal text-muted-foreground">
        {BUDGET_CAP_HELP}
      </p>

      <Button asChild variant="outline" className="h-11 w-full sm:w-fit">
        <Link href="/spend" data-testid="budget-cap-open-spend">
          Open spend view
        </Link>
      </Button>
    </div>
  );
}

'use server';

import { auth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { requireOrg } from '@/lib/auth/require-org';
import { parseUsdToMicro } from '@/lib/budget/money';
import { periodResetInstant } from '@/lib/budget/period';
import { formatLocal } from '@/lib/time';
import { BUDGET_ADMIN_ONLY, CAP_BELOW_SPEND, UNEXPECTED_ERROR } from '@/lib/ui/copy';
import { readCurrentPeriod, rowsOf } from '@/server/queries/budget';
import { isCheckViolationOn, isInsufficientPrivilege } from './_pg';
import { fail, ok, type ActionResult } from './_result';

/**
 * D-10. The monthly cap, edited in app, by an admin.
 *
 * 🔴 GATED TWICE, AND ONLY ONE OF THEM IS THE BOUNDARY. The `orgRole` check below is an
 * AFFORDANCE — it exists so a member gets the sentence UI-SPEC wrote instead of a database
 * error. The BOUNDARY is `app.set_budget_cap`, which re-checks `app.current_org_role()` in
 * SQL and raises `42501`, and behind that `authenticated` holds no UPDATE grant on
 * `budget_periods` at all, so even a bypassed action cannot write the column. Do not remove
 * the check here, and do not rely on it.
 *
 * 🔴 THE TWO ROLE SPELLINGS ARE NOT A TYPO. Clerk session token v2 nests the BARE role under
 * `o.rol` ('admin'); `@clerk/shared` builds `auth().orgRole` as `org:${o.rol}`. So the
 * TypeScript side sees `'org:admin'` and SQL sees `'admin'` out of the very same token, and
 * `app.current_org_role()` normalises both. Comparing one to the other is how an admin gate
 * silently passes, or silently fails, depending on which side you wrote first.
 *
 * 🔴 THE REAL FLOOR IS `spent + reserved`, NOT `spent + $1`. `bp_not_over` refuses at
 * `spent_micro_usd + reserved_micro_usd <= cap_micro_usd`, verified boundary-exact (with
 * spent 1200 and reserved 400: 1600 accepted, 1599 refused). UI-SPEC's copy says "at least
 * {spent + $1}", and a user told $13.00 and then refused at $13.00 concludes the product is
 * broken — so the message renders the floor the database will actually accept.
 */
const setCapInputSchema = z.strictObject({
  provider: z.enum(['places', 'firecrawl', 'anthropic']),
  /** Raw text from the input, `$` and thousands separators and all. Never a number: a float
   *  intermediate makes `0.07` into 70000.00000000001 µUSD. */
  capUsd: z.string().min(1).max(32),
});

export async function setBudgetCap(input: unknown): Promise<ActionResult<{ capMicroUsd: string }>> {
  // 🔴 T-2-01. First statement.
  const { userId, orgId, orgSlug } = await requireOrg();
  const claims: OrgClaims = { o: { id: orgId }, sub: userId, role: 'authenticated' };

  // The PREFIXED form, because this is the TypeScript side. See the header.
  const { orgRole } = await auth();
  if (orgRole !== 'org:admin') {
    return fail('forbidden', BUDGET_ADMIN_ONLY(orgSlug ?? 'this organisation'));
  }

  const parsed = setCapInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('validation', 'Enter an amount like 75 or 75.00.');
  }
  const { provider, capUsd } = parsed.data;

  let capMicroUsd: bigint;
  try {
    capMicroUsd = parseUsdToMicro(capUsd);
  } catch {
    // A throw here is a typo, not a bug, and it names the input rather than becoming a 500.
    return fail(
      'validation',
      `"${capUsd}" isn't an amount Siteless can read. Enter dollars and cents, like 75.00.`,
    );
  }

  try {
    const applied = await withOrg(claims, async (tx) => {
      const row = rowsOf<{ cap: string }>(
        await tx.execute(sql`
          select app.set_budget_cap(${provider}, ${capMicroUsd.toString()}::bigint)::text as cap`),
      )[0];
      if (!row?.cap) throw new Error('setBudgetCap: app.set_budget_cap returned no value');
      return row.cap;
    });

    // The audit row is written by the `app.log_event` trigger on `budget_periods`; writing
    // one here as well would double every cap change and red EVENT_LOGGED's set equality.
    revalidatePath('/settings/budget');
    revalidatePath('/spend');
    return ok({ capMicroUsd: applied });
  } catch (error) {
    if (isInsufficientPrivilege(error)) {
      // The database refused. Either the definer's own `admin role required`, or
      // `permission denied for table budget_periods` one layer earlier — both mean the same
      // thing to the person who pressed the button.
      return fail('forbidden', BUDGET_ADMIN_ONLY(orgSlug ?? 'this organisation'));
    }

    if (isCheckViolationOn(error, 'bp_not_over')) {
      // The refusal ABORTED that transaction, so the numbers for the message are read in a
      // fresh one — every further statement in the aborted one answers 25P02.
      try {
        const current = await withOrg(claims, (tx) => readCurrentPeriod(tx, provider));
        const floor = current.spentMicroUsd + current.reservedMicroUsd;
        const resetDate = formatLocal(periodResetInstant(current.periodStart), {
          month: 'short',
          day: 'numeric',
        });
        return fail(
          'validation',
          CAP_BELOW_SPEND(capMicroUsd, current.spentMicroUsd, floor, resetDate),
          { floorMicroUsd: floor.toString() },
        );
      } catch {
        return fail('unexpected', UNEXPECTED_ERROR('the budget'));
      }
    }

    return fail('unexpected', UNEXPECTED_ERROR('the budget'));
  }
}

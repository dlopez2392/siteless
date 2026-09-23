'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg } from '@/db/with-org';
import { orgClaims, requireOrg } from '@/lib/auth/require-org';

import { detachFailure, detachOne, listingValidation } from './_listing-decisions';
import { ok, type ActionResult } from './_result';

/**
 * D-05 / UI-SPEC OQ 6: "Detach this listing" on the business detail — the human reversal path
 * for a wrong auto-attach (or a wrong "Same business"). The listing becomes `rejected` with
 * reason `detached`, so it never attaches to this business again, and it leaves
 * `business_place_signal` at once (that view reads `attached` only).
 *
 * 🔴 T-3-10 / T-4-06: `requireOrg()` IS THE FIRST STATEMENT, then `orgClaims()` (never
 * hand-built claims). The confirmation dialog is not the control; this is.
 *
 * 🔴 WRITES ONLY THROUGH `app.decide_place_attachment(id, 'detach')` (see
 * `_listing-decisions.ts`): a foreign or unknown id is `not_found`; a listing that is not
 * `attached` is `conflict` (`detail.reason = 'already_decided'`); `decided_by` is the claims'
 * `sub`.
 *
 * Returns the business id (the screen's own route) and its SPINE `display_name` for the toast.
 */

const detachInputSchema = z.strictObject({
  attachmentId: z.uuid(),
});

export async function detachListing(
  input: unknown,
): Promise<ActionResult<{ businessId: string; businessName: string }>> {
  // 🔴 T-3-10. First statement.
  await requireOrg();
  const claims = await orgClaims();

  const parsed = detachInputSchema.safeParse(input);
  if (!parsed.success) return listingValidation(true);

  try {
    const detached = await withOrg(claims, (tx) => detachOne(tx, parsed.data.attachmentId));
    revalidatePath(`/businesses/${detached.businessId}`);
    revalidatePath('/review');
    return ok(detached);
  } catch (error) {
    return detachFailure(error);
  }
}

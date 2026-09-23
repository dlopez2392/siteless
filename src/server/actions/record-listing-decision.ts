'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg } from '@/db/with-org';
import { orgClaims, requireOrg } from '@/lib/auth/require-org';

import {
  decideListing,
  listingAlreadyDecided,
  listingFailure,
  listingNotFound,
  listingValidation,
} from './_listing-decisions';
import { ok, type ActionResult } from './_result';

/**
 * D-05 / UI-SPEC § Screen 3: one reviewer decision on one tentative listing from the review
 * queue — "Same business" (`attached`), "Not this business" (`rejected`) or "Skip".
 *
 * 🔴 T-3-10 / T-4-06: `requireOrg()` IS THE FIRST STATEMENT. A server action is a POST any client
 * can make without rendering the page; `tests/unit/server-actions-guard.test.ts` holds every
 * action to this.
 *
 * 🔴 CLAIMS COME FROM `orgClaims()`, NEVER A HAND-BUILT OBJECT (02-13, see
 * `record-review-decision.ts`).
 *
 * 🔴 WRITES ONLY THROUGH `app.decide_place_attachment` (see `_listing-decisions.ts`). A foreign
 * or unknown id is `not_found`; a listing someone else already decided is `conflict` with
 * `detail.reason = 'already_decided'`; `decided_by` comes from the claims, never from input.
 *
 * "Skip" writes nothing and revalidates nothing — it leaves the listing pending. The screen
 * moves on client-side (the queue is score-ordered, so a re-read returns the same listing).
 *
 * Returns `remaining` (tentative listings still in the review band) and `businessName` (the
 * SPINE `display_name`, for the toast — never Google text, Rule 30).
 */

const listingInputSchema = z.strictObject({
  attachmentId: z.uuid(),
  decision: z.enum(['attached', 'rejected', 'skip']),
});

export async function recordListingDecision(
  input: unknown,
): Promise<ActionResult<{ remaining: number; businessName: string }>> {
  // 🔴 T-3-10. First statement.
  await requireOrg();
  const claims = await orgClaims();

  const parsed = listingInputSchema.safeParse(input);
  if (!parsed.success) {
    return listingValidation(parsed.error.issues.some((issue) => issue.path[0] === 'attachmentId'));
  }

  try {
    const outcome = await withOrg(claims, (tx) => decideListing(tx, parsed.data));
    if (outcome.kind === 'missing') return listingNotFound();
    if (outcome.kind === 'already_decided') return listingAlreadyDecided();
    if (parsed.data.decision !== 'skip') {
      revalidatePath('/review');
      revalidatePath(`/businesses/${outcome.businessId}`);
    }
    return ok({ remaining: outcome.remaining, businessName: outcome.businessName });
  } catch (error) {
    return listingFailure(error);
  }
}

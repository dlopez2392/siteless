'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg } from '@/db/with-org';
import { orgClaims, requireOrg } from '@/lib/auth/require-org';
import { NOT_FOUND, UNMERGE_FAILED } from '@/lib/ui/copy';

import { isSerializationFailure, MAX_ATTEMPTS, undoMerge } from './_merge-decisions';
import { isUniqueViolationOn, pgFailure } from './_pg';
import { fail, ok, type ActionResult } from './_result';

/**
 * D-20: reverse one merge — the one destructive action in Phase 3.
 *
 * 🔴 T-3-10: `requireOrg()` IS THE FIRST STATEMENT, and the merge row is re-read UNDER RLS
 * before anything is written. The confirmation dialog is not the control; this is.
 *
 * 🔴 CLAIMS FROM `orgClaims()` (never hand-built — see `record-review-decision.ts`).
 *
 * One transaction: read the merge (foreign / unknown → `not_found`, never a permission error); refuse
 * an already-undone merge with `conflict`; then `unmergeBusinesses` computes the loser's
 * fields with `survive()` over the loser's OWN source records and calls `app.undo_merge`,
 * which restores the winner from its snapshot, releases the loser's key, and marks the pair
 * `distinct` so nothing re-merges it automatically.
 *
 * Refusals the definer can still raise, each a result: `42501` (foreign / stale) →
 * `not_found`; `55000` (undo the later merge first / already undone) → `conflict`; `23505` on
 * `business_aliases_key_uniq` → `conflict`, matched by constraint name through
 * `isUniqueViolationOn`, never a bare code check; `40001` → retried.
 */
/**
 * A caught failure → its result. `55000` carries two distinct refusals, told apart by the
 * definer's message: `undo the later merge first` (LIFO) and `merge already undone`.
 *
 * 🔴 COPY GAP, RECORDED RATHER THAN INVENTED: `src/lib/ui/copy.ts` (owned by 03-04) has one
 * unmerge refusal sentence, `UNMERGE_FAILED`, and it is true of every branch below except
 * "already undone" (where the records are no longer merged). The reason travels in `detail`
 * so the dialog can branch once a dedicated string exists.
 */
function unmergeFailure<T>(error: unknown): ActionResult<T> {
  const failure = pgFailure(error);
  // 42501 from the definer: "undo_merge: merge not in this org" — a foreign or stale id.
  if (failure?.code === '42501') return fail('not_found', NOT_FOUND('merge'));
  if (failure?.code === '55000') {
    return fail('conflict', UNMERGE_FAILED, {
      reason: /later merge/.test(failure.message) ? 'later_merge_first' : 'already_undone',
    });
  }
  // The released key re-claimed by a live alias — by constraint NAME, never a bare 23505.
  if (isUniqueViolationOn(error, 'business_aliases_key_uniq')) {
    return fail('conflict', UNMERGE_FAILED, { reason: 'lead_key_in_use' });
  }
  if (failure?.code === '40001') {
    return fail('conflict', UNMERGE_FAILED, { reason: 'concurrent_merge' });
  }
  return fail('unexpected', UNMERGE_FAILED);
}

const unmergeInputSchema = z.strictObject({
  mergeId: z.uuid(),
});

export async function unmergeBusiness(
  input: unknown,
): Promise<ActionResult<{ loserId: string }>> {
  // 🔴 T-3-10. First statement.
  await requireOrg();
  const claims = await orgClaims();

  const parsed = unmergeInputSchema.safeParse(input);
  if (!parsed.success) return fail('validation', NOT_FOUND('merge'));

  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await withOrg(claims, (tx) => undoMerge(tx, parsed.data));
      if (outcome.kind === 'missing') return fail('not_found', NOT_FOUND('merge'));
      if (outcome.kind === 'already_undone') {
        return fail('conflict', UNMERGE_FAILED, { reason: 'already_undone' });
      }
      revalidatePath('/businesses');
      revalidatePath(`/businesses/${outcome.winnerId}`);
      revalidatePath(`/businesses/${outcome.loserId}`);
      revalidatePath('/review');
      return ok({ loserId: outcome.loserId });
    } catch (error) {
      if (isSerializationFailure(error) && attempt < MAX_ATTEMPTS) continue;
      return unmergeFailure(error);
    }
  }
}

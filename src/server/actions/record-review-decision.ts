'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg } from '@/db/with-org';
import { orgClaims, requireOrg } from '@/lib/auth/require-org';
import { NOT_FOUND, REVIEW_DECISION_FAILED } from '@/lib/ui/copy';

import { decideCandidate, isSerializationFailure, MAX_ATTEMPTS } from './_merge-decisions';
import { pgFailure } from './_pg';
import { fail, ok, type ActionResult } from './_result';

/**
 * D-13 / D-15 / D-16: one reviewer decision on one candidate pair — "Same business",
 * "Different" or "Skip".
 *
 * 🔴 T-3-10: `requireOrg()` IS THE FIRST STATEMENT. `src/proxy.ts` carries no authorization by
 * design (CVE-2025-29927), and a server action is a POST any client can make without ever
 * rendering the page. `tests/unit/server-actions-guard.test.ts` holds every action to this.
 *
 * 🔴 CLAIMS COME FROM `orgClaims()`, NEVER A HAND-BUILT OBJECT: it carries `org_role`, and a
 * claims object without it made every role-gated definer refuse a verified admin (02-13).
 *
 * 🔴 THE CANDIDATE IS RE-READ UNDER RLS BEFORE ANYTHING IS DECIDED, so a foreign id and an
 * unknown id are the same `not_found`, never a permission error (T-3-09). A pair somebody
 * else already decided is `conflict`.
 *
 * 🔴 WRITES ONLY THROUGH THE DEFINERS: `merged` → `app.record_merge` (via `mergePair`, reason
 * `review`); `distinct` / `skip` → `app.record_candidate_decision`. `merge_candidates` is
 * SELECT-only for this role (T-3-08).
 *
 * The new `remaining` count is read inside the same transaction, so the queue header updates
 * without a second round trip. An expected refusal is a RESULT; only a bug throws.
 */
/**
 * A caught failure → its result. The SQLSTATE is on `err.cause`; `pgFailure()` walks the chain.
 *
 * 🔴 COPY GAP, RECORDED RATHER THAN INVENTED: `src/lib/ui/copy.ts` (owned by 03-04) has no
 * sentence for "somebody decided this pair first". `REVIEW_DECISION_FAILED` is the review
 * screen's refusal copy; the `conflict` code and `detail.reason` let the screen branch (reload
 * the queue) until a dedicated string exists.
 */
function decisionFailure<T>(error: unknown): ActionResult<T> {
  const failure = pgFailure(error);
  // 42501 from a definer: "... not in this org" — a foreign or stale id.
  if (failure?.code === '42501') return fail('not_found', NOT_FOUND('pair'));
  if (failure?.code === '55000') {
    return fail('conflict', REVIEW_DECISION_FAILED, {
      reason: /distinct/.test(failure.message) ? 'marked_distinct' : 'already_decided',
    });
  }
  if (failure?.code === '40001') {
    return fail('conflict', REVIEW_DECISION_FAILED, { reason: 'concurrent_merge' });
  }
  return fail('unexpected', REVIEW_DECISION_FAILED);
}

const decisionInputSchema = z.strictObject({
  candidateId: z.uuid(),
  decision: z.enum(['merged', 'distinct', 'skip']),
});

export async function recordReviewDecision(
  input: unknown,
): Promise<ActionResult<{ remaining: number }>> {
  // 🔴 T-3-10. First statement.
  await requireOrg();
  const claims = await orgClaims();

  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) {
    const badId = parsed.error.issues.some((issue) => issue.path[0] === 'candidateId');
    return fail('validation', badId ? NOT_FOUND('pair') : REVIEW_DECISION_FAILED);
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await withOrg(claims, (tx) => decideCandidate(tx, parsed.data));
      if (outcome.kind === 'missing') return fail('not_found', NOT_FOUND('pair'));
      if (outcome.kind === 'already_decided') {
        return fail('conflict', REVIEW_DECISION_FAILED, { reason: 'already_decided' });
      }
      revalidatePath('/review');
      revalidatePath('/businesses');
      return ok({ remaining: outcome.remaining });
    } catch (error) {
      // 40001: a concurrent merge moved the pair between the read and the lock. The whole
      // transaction rolled back, so re-running it from the top is safe.
      if (isSerializationFailure(error) && attempt < MAX_ATTEMPTS) continue;
      return decisionFailure(error);
    }
  }
}

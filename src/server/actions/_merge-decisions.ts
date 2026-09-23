import 'server-only';
import { sql } from 'drizzle-orm';
import { drizzleExecutor } from '@/db/drizzle-executor';
import { mergePair, recordCandidateDecision, unmergeBusinesses } from '@/lib/resolve/merge';
import { rowsOf, type Tx } from '@/server/queries/budget';
import { readReviewRemaining } from '@/server/queries/review-queue';
import { pgFailure } from './_pg';

/**
 * The transactional core of the two spine actions (`record-review-decision.ts`,
 * `unmerge-business.ts`). Each action maps a definer's refusal to its own typed result.
 *
 * WHY A SEPARATE, `_`-PREFIXED MODULE. A module carrying the server directive publishes every
 * export as a POST endpoint, so a `tx`-taking helper exported from an action file would be an
 * unauthenticated entry point that accepts a transaction nobody opened. Here it is an ordinary
 * server-only module: the actions import it after `requireOrg()`, and
 * `tests/db/review-actions.test.ts` drives it inside a rolled-back transaction as a Clerk user.
 * `tests/unit/server-actions-guard.test.ts` skips `_` files for exactly this reason.
 *
 * 🔴 WRITES GO ONLY THROUGH THE DEFINERS. `merge_candidates`, `business_merges` and
 * `business_aliases` are SELECT-only for `authenticated` (drizzle/0023); `app.record_merge`,
 * `app.record_candidate_decision` and `app.undo_merge` read the org and the actor themselves,
 * so neither is ever a parameter and `decided_by` / `merged_by` cannot be forged (T-3-08).
 *
 * 🔴 RE-READ UNDER RLS FIRST (T-3-10). The candidate / merge row is read through the caller's
 * own claims before anything is written, so a foreign id and an unknown id are both simply
 * absent — `not_found`, never a permission error (T-3-09). The definers re-check the org on their
 * side; a refusal from them (`42501 ... not in this org`) maps to the same `not_found`.
 *
 * 🔴 AN EXPECTED REFUSAL IS A RESULT, NOT A THROW. A definer refusal aborts the transaction,
 * so it is caught OUTSIDE `withOrg` (after the rollback) by the action and mapped there. The
 * SQLSTATE is on `err.cause`, not on the error caught — `pgFailure()` walks the chain.
 */

export type ReviewDecision = 'merged' | 'distinct' | 'skip';

/** Attempts per action when a definer reports `40001` (a concurrent merge moved the pair). */
export const MAX_ATTEMPTS = 3;

export type DecisionOutcome =
  | { kind: 'missing' }
  | { kind: 'already_decided' }
  | {
      kind: 'recorded';
      remaining: number;
      mergeId: string | null;
      /** Set only on a recorded merge — see `readMergedNames`. */
      merged: MergedNames | null;
    };

/**
 * The success toast's two names ("Merged — “{loser}” now resolves to “{winner}”"), read AFTER
 * the merge in the same transaction. The winner is chosen by `mergePair` (older `created_at`),
 * never by the screen, so only the server can name it truthfully; and the winner's name is the
 * one survivorship just gave it — which is exactly what the loser now resolves to.
 * `display_name` only, verbatim (D-12).
 */
export type MergedNames = { winnerName: string; loserName: string };

async function readMergedNames(
  tx: Tx,
  winnerId: string,
  loserId: string,
): Promise<MergedNames | null> {
  const rows = rowsOf<{ id: string; display_name: string }>(
    await tx.execute(sql`
      select b.id, b.display_name
        from businesses b
       where b.id = ${winnerId} or b.id = ${loserId}`),
  );
  const winner = rows.find((r) => r.id === winnerId);
  const loser = rows.find((r) => r.id === loserId);
  return winner && loser ? { winnerName: winner.display_name, loserName: loser.display_name } : null;
}

export async function decideCandidate(
  tx: Tx,
  input: { candidateId: string; decision: ReviewDecision },
): Promise<DecisionOutcome> {
  const candidate = rowsOf<{
    id: string;
    left_id: string;
    right_id: string;
    score: number;
    features: Record<string, unknown> | null;
    decision: string;
  }>(
    await tx.execute(sql`
      select mc.id, mc.left_id, mc.right_id, mc.score, mc.features, mc.decision
        from merge_candidates mc
       where mc.id = ${input.candidateId}`),
  )[0];
  if (!candidate) return { kind: 'missing' };
  if (candidate.decision !== 'pending') return { kind: 'already_decided' };

  const x = drizzleExecutor(tx);
  let mergeId: string | null = null;
  let merged: MergedNames | null = null;
  if (input.decision === 'merged') {
    const result = await mergePair(x, {
      candidateId: candidate.id,
      leftId: candidate.left_id,
      rightId: candidate.right_id,
      reason: 'review',
      score: candidate.score,
      features: candidate.features ?? {},
    });
    mergeId = result.mergeId;
    merged = await readMergedNames(tx, result.winnerId, result.loserId);
  } else {
    await recordCandidateDecision(x, { candidateId: candidate.id, decision: input.decision });
  }

  return { kind: 'recorded', remaining: await readReviewRemaining(tx), mergeId, merged };
}

export type UnmergeOutcome =
  | { kind: 'missing' }
  | { kind: 'already_undone' }
  | { kind: 'recorded'; winnerId: string; loserId: string };

/**
 * The loser's fields are re-derived by `unmergeBusinesses` itself — `survive()` over the
 * loser's OWN source records (src/lib/resolve/merge.ts), the same function the merge used. They
 * are deliberately not recomputed here: two call sites computing the same fields is how an
 * unmerge drifts from the merge it reverses.
 */
export async function undoMerge(tx: Tx, input: { mergeId: string }): Promise<UnmergeOutcome> {
  const merge = rowsOf<{ winner_id: string; loser_id: string; undone: boolean }>(
    await tx.execute(sql`
      select m.winner_id, m.loser_id, m.undone_at is not null as undone
        from business_merges m
       where m.id = ${input.mergeId}`),
  )[0];
  if (!merge) return { kind: 'missing' };
  if (merge.undone) return { kind: 'already_undone' };

  await unmergeBusinesses(drizzleExecutor(tx), { mergeId: input.mergeId });
  return { kind: 'recorded', winnerId: merge.winner_id, loserId: merge.loser_id };
}

/** `40001`: the definer saw a concurrent merge move the pair. Safe to re-run from the top. */
export function isSerializationFailure(error: unknown): boolean {
  return pgFailure(error)?.code === '40001';
}

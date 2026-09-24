/**
 * D-14. Orchestration only — deterministic, no Node I/O. Every side effect is a step
 * (./steps.ts); every decision is the pure reducer (./reducer.ts). Scale path past ~2,000
 * events: child workflows per cell (04-RESEARCH § Alternatives).
 *
 * Started by `start(placesSweep, [{ runId, clerkOrgId }])` from `workflow/api` (04-26's
 * queueRun, after its transaction commits). The input is the whole trust boundary: the org
 * every step acts as, and the run it acts on (T-4-06).
 *
 * 🔴 SANDBOX. Replayed deterministically inside the workflow VM: `import type` from anything
 * that touches Node, no clock, no randomness, no `fetch`. A step's result is read back from the
 * event log on replay, so the loop below re-derives exactly the same queue.
 *
 * 🔴 M33 / D-19. Budget stops arrive as `stopped` RESULTS and end the loop through the reducer
 * (`partial`); only a failed step throws, and the catch turns it into an allow-listed reason
 * (`failed`). Either way `finishRun` closes the run from the ledger.
 */
import type { SweepInput } from '@/lib/places/search-tile';
import {
  applyResult,
  failReasonOf,
  finishVerdict,
  initialQueue,
  nextSearch,
  type FailReason,
} from './reducer';
import { abortRun, beginRun, checkTile, finishRun, searchTile, type BeginResult } from './steps';

export type SweepOutcome = {
  status: 'complete' | 'partial' | 'failed' | 'not_runnable';
  reason: string | null;
};

export async function placesSweep(input: SweepInput): Promise<SweepOutcome> {
  'use workflow';
  let plan: BeginResult;
  try {
    plan = await beginRun(input);
  } catch (e) {
    // M46: a run this org cannot see is never touched — not even to close it.
    if (failReasonOf(e) === 'places_request_rejected') throw e;
    // B-WR-08: anything else left the run queued with its admission hold held.
    return abortRun(input);
  }
  if (plan.kind === 'not_runnable') return { status: 'not_runnable', reason: plan.reason };

  let state = initialQueue(plan.searches);
  let failure: FailReason | null = null;
  try {
    for (let s = nextSearch(state); s; s = nextSearch(state)) {
      const r =
        plan.runKind === 'change_check' ? await checkTile(input, s) : await searchTile(input, s);
      state = applyResult(state, s, r);
      if (state.stopped) break;
    }
  } catch (e) {
    failure = failReasonOf(e);
  }
  return finishRun(input, finishVerdict(state, failure));
}

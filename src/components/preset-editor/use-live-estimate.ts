'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { EstimateRange } from '@/lib/estimate/estimate';
import type { PresetSpecInput } from '@/server/queries/presets';
import { estimatePreset } from '@/server/actions/estimate-preset';

/**
 * D-08 / SRCH-04: the estimate recomputes as danlo edits. There is no Estimate button.
 *
 * ── 🔴 THE MONOTONIC SEQUENCE GUARD IS NOT OPTIONAL ──────────────────────────────────────
 *
 * Next.js Server Actions execute SEQUENTIALLY — they are queued, not parallel — and there is
 * no `AbortController` to cancel one with. So a request issued for an earlier selection can
 * be answered AFTER a request issued for a later one, and the earlier answer will repaint a
 * stale dollar figure over a fresh one. That is the single bug class the queue behaviour
 * creates (02-RESEARCH § The live debounced estimate, Pitfall 5), and nothing on the server
 * can prevent it: by the time an answer is computed, the request that asked for it is gone.
 *
 * `seq` is a monotonically increasing counter. Each dispatch takes a ticket; an answer is
 * accepted only while its ticket is still the newest one. `tests/unit/stale-estimate.test.tsx`
 * proves it with two recomputes resolved out of order, and was watched RED with the
 * comparison deleted — with its in-order control staying green, so the guard is not simply
 * discarding every answer.
 *
 * 🔴 SERVER ACTIONS MUST BE ASYNCHRONOUS; TRANSITIONS MUST BE SYNCHRONOUS. The `async`
 * therefore lives INSIDE `startTransition`, never wrapped around it.
 *
 * 🔴 `useDebouncedCallback` IS EIGHT LINES OF `setTimeout` RATHER THAN A DEPENDENCY. This
 * repo pins every version deliberately and the behaviour needed here is one timer and one
 * cleanup.
 *
 * ── WHY "BUSY" IS NOT `useTransition`'s PENDING FLAG ─────────────────────────────────────
 *
 * The number is stale from the KEYSTROKE, not from the moment the request leaves — the
 * 400 ms debounce window is part of the wait. So busy is derived from the request in
 * flight: the key on screen versus the key that was answered. A pending flag alone would
 * leave the panel looking settled for 400 ms while showing the previous preset's cost.
 */

/** UI-SPEC Open Question 9: long enough to avoid a server action per keystroke, short
 *  enough that the number feels live. */
export const ESTIMATE_DEBOUNCE_MS = 400;

export type LiveEstimate = {
  /** The last GOOD range. Never cleared while a new one computes — Executor Rule 11. */
  estimate: EstimateRange | null;
  /** A typed refusal's sentence, already written by UI-SPEC and carried by the action. */
  error: string | null;
  /** True from the moment the selection changes until its own answer lands. */
  busy: boolean;
};

export function useLiveEstimate(
  spec: PresetSpecInput | null,
  debounceMs: number = ESTIMATE_DEBOUNCE_MS,
): LiveEstimate {
  const seq = useRef(0);
  const [, startTransition] = useTransition();
  const [estimate, setEstimate] = useState<EstimateRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);

  // The spec's identity, not its reference: the form rebuilds the object on every render,
  // so a reference-keyed effect would fire a server action per keystroke in the NAME field.
  const key = spec === null ? null : JSON.stringify(spec);

  const specRef = useRef(spec);
  specRef.current = spec;

  useEffect(() => {
    if (key === null) {
      // 🔴 "NOTHING TO COMPUTE" IS NOT "RECOMPUTING", AND RULE 11 ONLY COVERS THE SECOND.
      // The number stays on screen while a NEW one is being priced — that is the rule, and
      // the three tests above it. But when the last cluster is unchecked or the geography is
      // cleared, `buildSpec` returns null, no request is ever made and `busy` is false, so
      // the previous figure sat there at full opacity with no spinner and no prompt: a price
      // for a preset that now has nothing to search for.
      //
      // Cleared here rather than in the panel because the panel is handed `estimate` and
      // cannot tell "the last good value" from "the value for THIS selection"; the hook is
      // the only place that knows the key changed. `settledKey` goes with it, or `busy` would
      // stay false against a key that never settled once a selection is picked again.
      //
      // Runs once per transition: the effect's only dependencies are `key` and `debounceMs`.
      setEstimate(null);
      setError(null);
      setSettledKey(null);
      return;
    }
    const pending = specRef.current;
    if (pending === null) return;

    const timer = setTimeout(() => {
      const mine = ++seq.current;
      startTransition(async () => {
        const result = await estimatePreset(pending);
        // 🔴 DROP A STALE, OUT-OF-ORDER ANSWER. Deleting this line is the mutation the
        // named component test was watched red against.
        if (mine !== seq.current) return;
        setSettledKey(key);
        if (result.ok) {
          setEstimate(result.data);
          setError(null);
        } else {
          // The previous range stays on screen beside the sentence. A refusal is a reason
          // the NEW selection has no price, not evidence that the old one never had one.
          setError(result.message);
        }
      });
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [key, debounceMs]);

  return { estimate, error, busy: key !== null && key !== settledKey };
}

'use client';

import { OctagonX } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  ERROR_ACTION,
  REVIEW_ACTION_DIFFERENT,
  REVIEW_ACTION_SAME,
  REVIEW_ACTION_SKIP,
  REVIEW_BUSY,
  REVIEW_DECISION_FAILED,
  TOAST_DISTINCT,
  TOAST_MERGED,
} from '@/lib/ui/copy';
import { recordReviewDecision } from '@/server/actions/record-review-decision';

/**
 * `/review`'s action bar and the stage the pair advances on (03-UI-SPEC § 1, § States →
 * Loading, § Motion; D-13 / D-15 / D-16).
 *
 * 🔴 EXECUTOR RULE 20 — THE QUEUE NEVER ADVANCES BEFORE THE DECISION IS RECORDED. The pressed
 * button shows the spinner and "Recording…" at its full height, the other two go
 * `aria-disabled`, and the pair stays exactly where it is until `recordReviewDecision`
 * answers `ok: true`. Only then does the page re-read the next pair (`router.refresh()`). A
 * refusal leaves the pair on screen with a persistent `Alert`. Optimistic advance with an undo
 * toast is Phase 7's pattern (TRI-02) and is deliberately not here: a silently dropped
 * decision is invisible, and the whole value of this queue is that every pair got an answer.
 *
 * 🔴 `onClick` INSIDE `useTransition`, NEVER A FORM ACTION. React resets a form even when the
 * action FAILED, and a Radix control driven by that reset walks its own state backwards.
 *
 * 🔴 A TOAST ON SUCCESS ONLY; A REFUSAL IS AN `Alert` THAT STAYS. A dismissed toast is
 * indistinguishable from one that never fired. The refusal sentence is the action's own
 * `result.message` — each conflict carries its TRUE copy (someone else decided it; it is
 * marked distinct) — and a pair that can no longer be decided offers only "Reload the queue".
 *
 * 🔴 EXECUTOR RULE 23 — NO CONFIRMATION on "Same business" or "Different". Neither deletes
 * anything; the reversal is Unmerge on the detail view (D-20). A confirmation on a queue worked
 * from a phone would double every tap.
 *
 * 🔴 NO SWIPE. MOB-02's gesture layer is Phase 7's; `motion` here only fades the advance.
 */

export type ReviewDecision = 'merged' | 'distinct' | 'skip';

type Refusal = { message: string; retryable: boolean; decision: ReviewDecision };

/** A pair that is gone or already decided cannot be retried — only the queue can be reloaded. */
function isRetryable(code: string, reason: string | number | undefined): boolean {
  if (code === 'not_found') return false;
  if (code === 'conflict') return reason === 'concurrent_merge';
  return true;
}

const BUTTON_TEXT = 'text-base font-normal';

export function ReviewActions({ candidateId }: { candidateId: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<ReviewDecision | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  // A new pair on screen clears the last pair's refusal — it was about a different pair.
  const [shownFor, setShownFor] = useState(candidateId);
  if (shownFor !== candidateId) {
    setShownFor(candidateId);
    setRefusal(null);
  }

  const decide = useCallback(
    (decision: ReviewDecision) => {
      if (candidateId === null) return;
      setRefusal(null);
      setPressed(decision);
      startTransition(async () => {
        let result: Awaited<ReturnType<typeof recordReviewDecision>>;
        try {
          result = await recordReviewDecision({ candidateId, decision });
        } catch {
          // 🔴 C-CR-01: the REQUEST failed (no signal mid-tap, a 5xx, a deploy that retired the
          // action id), so the promise rejected rather than answering `ok: false`. Uncaught
          // inside a transition, React hands it to the nearest error boundary and the queue,
          // the pair and the tab bar all go. Nothing was recorded — the server never answered —
          // so it is the same refusal, retryable, with the pair still on screen (Rule 20).
          setRefusal({ message: REVIEW_DECISION_FAILED, retryable: true, decision });
          return;
        }
        if (!result.ok) {
          // 🔴 Do NOT advance. The pair stays on screen with the reason beside it.
          setRefusal({
            message: result.message,
            retryable: isRetryable(result.code, result.detail?.reason),
            decision,
          });
          return;
        }
        if (decision === 'merged' && result.data.merged) {
          toast(TOAST_MERGED(result.data.merged.loserName, result.data.merged.winnerName));
        } else if (decision === 'distinct') {
          toast(TOAST_DISTINCT);
        }
        // The server re-reads the next pair and the new count; the stage animates the swap.
        router.refresh();
      });
    },
    [candidateId, router],
  );

  const reload = useCallback(() => {
    setRefusal(null);
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const busy = isPending || candidateId === null;
  const shared = { busy, isPending, pressed, onDecide: decide };

  return (
    // The page places this in the phone thumb-zone bar (`review/page.tsx` `ThumbBar`); from
    // 640px up it is an ordinary row beneath the chip band.
    <div data-testid="review-actions" className="flex flex-col gap-2 sm:gap-4">
      {refusal ? (
        <Alert
          role="alert"
          data-testid="review-error"
          className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
        >
          <OctagonX data-icon="octagon-x" aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-normal text-balance">{refusal.message}</AlertTitle>
          <div className="col-start-2 mt-2 flex flex-wrap gap-2">
            {refusal.retryable ? (
              <Button
                type="button"
                variant="outline"
                data-testid="review-error-retry"
                className={cn('h-11', BUTTON_TEXT)}
                onClick={() => decide(refusal.decision)}
              >
                {ERROR_ACTION.tryAgain}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              data-testid="review-error-reload"
              className={cn('h-11', BUTTON_TEXT)}
              onClick={reload}
            >
              {ERROR_ACTION.reloadQueue}
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* Phone: row 1 is "Same business" full width; row 2 is "Different" and "Skip", equal
          width, 8px apart. Three 16px labels do not fit one 390px row. From 640px up: one
          44px row, left-aligned. `display: contents` lets row 2's buttons join that row. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <DecisionButton
          {...shared}
          decision="merged"
          label={REVIEW_ACTION_SAME}
          variant="default"
          data-testid="review-action-same"
        />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <DecisionButton
            {...shared}
            decision="distinct"
            label={REVIEW_ACTION_DIFFERENT}
            variant="outline"
            data-testid="review-action-different"
          />
          <DecisionButton
            {...shared}
            decision="skip"
            label={REVIEW_ACTION_SKIP}
            variant="ghost"
            data-testid="review-action-skip"
          />
        </div>
      </div>
    </div>
  );
}

function DecisionButton({
  decision,
  label,
  variant,
  'data-testid': testId,
  busy,
  isPending,
  pressed,
  onDecide,
}: {
  decision: ReviewDecision;
  label: string;
  variant: 'default' | 'outline' | 'ghost';
  'data-testid': string;
  busy: boolean;
  isPending: boolean;
  pressed: ReviewDecision | null;
  onDecide: (decision: ReviewDecision) => void;
}) {
  const recording = isPending && pressed === decision;
  return (
    <Button
      type="button"
      variant={variant}
      data-testid={testId}
      // aria-disabled rather than `disabled` while busy, so focus is not thrown off the pressed
      // button mid-decision and a screen reader still reaches all three.
      aria-disabled={busy || undefined}
      aria-busy={recording || undefined}
      onClick={() => {
        if (!busy) onDecide(decision);
      }}
      className={cn(
        // 48px on phone (both rows), 44px on desk. Width comes from the row, so the busy
        // label changing in place never resizes the button.
        'h-12 w-full sm:h-11 sm:w-auto',
        BUTTON_TEXT,
        busy && 'cursor-not-allowed',
        busy && !recording && 'opacity-50',
      )}
    >
      {/* Both labels occupy ONE grid cell and the idle one is `invisible` (visibility:
          hidden — out of the accessibility tree too), so the button is always as wide as the
          wider of the two and never resizes between "Same business" and "Recording…". */}
      <span className="grid">
        <span className={cn('[grid-area:1/1]', recording && 'invisible')}>{label}</span>
        <span
          className={cn(
            'inline-flex items-center justify-center gap-2 [grid-area:1/1]',
            !recording && 'invisible',
          )}
        >
          <Spinner aria-hidden="true" />
          {REVIEW_BUSY}
        </span>
      </span>
    </Button>
  );
}

/* ------------------------------------------------------------------------------------------
 * The advance (03-UI-SPEC § Motion, § Accessibility).
 * ---------------------------------------------------------------------------------------- */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReduced(onChange: () => void): () => void {
  const mql = window.matchMedia(REDUCED_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** The media query read directly, as well as motion's own hook: two readers of one setting,
 *  so a reduced-motion user is never animated because one of them had not resolved yet. */
function useReducedQuery(): boolean {
  return useSyncExternalStore(
    subscribeToReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

const ADVANCE_S = 0.15;

/**
 * The region the pair lives in. Each pair is keyed by its candidate id, so when the server
 * hands back the next one the old pair exits (opacity 1 → 0, 8px up) while the new one
 * enters (0 → 1) — both mounted at once in one grid cell, so the region is NEVER empty.
 *
 * 🔴 REDUCED MOTION DISABLES THE ANIMATION, NEVER THE CONTENT (recorded 956 Woodworks defect:
 * a naive rule blanked the hero). Durations go to 0 and transforms are dropped; the new pair's
 * `animate` target is always opacity 1, so there is no path on which it stays invisible.
 *
 * FOCUS: after an advance, focus moves to the new pair's first heading (`tabindex=-1`,
 * `data-review-focus`), so a keyboard or screen-reader user is not left on a button whose
 * surroundings silently changed. The first render never steals focus.
 */
export function ReviewAdvance({
  candidateId,
  children,
}: {
  candidateId: string;
  children: ReactNode;
}) {
  const prefersReduced = useReducedMotion();
  const queryReduced = useReducedQuery();
  const reduced = prefersReduced === true || queryReduced;

  const regionRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    const heading = regionRef.current?.querySelector<HTMLElement>(
      `[data-candidate="${CSS.escape(candidateId)}"] [data-review-focus]`,
    );
    heading?.focus({ preventScroll: false });
  }, [candidateId]);

  const duration = reduced ? 0 : ADVANCE_S;

  return (
    <div ref={regionRef} className="grid">
      <AnimatePresence initial={false}>
        <motion.div
          key={candidateId}
          data-candidate={candidateId}
          className="[grid-area:1/1] min-w-0"
          initial={reduced ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

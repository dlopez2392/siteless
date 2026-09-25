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
  type ComponentProps,
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
  REVIEW_ACTION_NOT_THIS,
  REVIEW_ACTION_SAME,
  REVIEW_ACTION_SKIP,
  REVIEW_BUSY,
  REVIEW_DECISION_FAILED,
  REVIEW_DIFFERENT_HELPER,
  REVIEW_GOOGLE_DECISION_FAILED,
  REVIEW_GOOGLE_HELPER_NOT_THIS,
  REVIEW_GOOGLE_HELPER_SKIP,
  REVIEW_SKIP_HELPER,
  TOAST_ATTACHED,
  TOAST_ATTACHED_TIE,
  TOAST_DISTINCT,
  TOAST_MERGED,
} from '@/lib/ui/copy';
import { recordListingDecision } from '@/server/actions/record-listing-decision';
import { recordReviewDecision } from '@/server/actions/record-review-decision';
import { RejectDialog } from './reject-dialog';

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
 *
 * THE GOOGLE KIND (04-UI-SPEC § Screen 3, `kind="google"`): the same bar, busy states, refusal
 * Alert and focus move, over `recordListingDecision`:
 * - "Same business" confirms the listing (`attached`) with no confirmation — Detach on the
 *   business reverses it. On a TIE, since 0030 the same write also REJECTS the other side (for
 *   good); the tie reason on the card says so before the tap, and the toast says so after.
 * - "Not this business" is IRREVERSIBLE, so it only OPENS `RejectDialog` (Rule 42); the queue
 *   advances after the dialog's write lands.
 * - "Skip" records nothing (04-21), so a refresh would re-read the very same listing. After the
 *   server confirms the listing is still pending, the bar navigates to `skipHref` — the URL that
 *   carries this listing as skipped this session — and the queue sinks it (`readReviewQueue`).
 */

export type ReviewDecision = 'merged' | 'distinct' | 'skip';
type ListingDecision = 'attached' | 'skip';

type Refusal<D> = { message: string; retryable: boolean; decision: D };

/** A pair that is gone or already decided cannot be retried — only the queue can be reloaded. */
function isRetryable(code: string, reason: string | number | undefined): boolean {
  if (code === 'not_found') return false;
  if (code === 'conflict') return reason === 'concurrent_merge';
  return true;
}

const BUTTON_TEXT = 'text-base font-normal';

/** The helper sentences' ids, private to this module (a client module exports components
 *  only — Rule 5). `ReviewHelpers` owns the elements; the buttons point at them. */
const HELPER_ID = {
  distinct: 'review-helper-different',
  notThis: 'review-helper-not-this',
  skip: 'review-helper-skip',
} as const;

/**
 * The Skip and Different helper sentences (03-UI-SPEC § Copy Table; C-WR-06), Label 14/400
 * muted. "Different" is PERMANENT and deliberately unconfirmed (Rule 23) — this sentence is the
 * only disclosure the spec gives the reviewer, so it is visible text, and each button names its
 * sentence through `aria-describedby`.
 *
 * 🔴 NOT INSIDE THE THUMB BAR. On a phone the bar is `position: fixed`; three more lines there
 * would take ~70px of a 390×844 screen for good. The page renders this in the scrolling flow
 * just above the bar's spacer (so it sits directly above the buttons at the end of the pair),
 * and from 640px up `sm:order-last` moves it beneath the action row.
 */
export function ReviewHelpers({
  kind = 'pair',
  className,
}: {
  /** The Google kind has its own two sentences (§ Screen 3 → Helpers). */
  kind?: 'pair' | 'google';
  className?: string;
}) {
  return (
    <div
      data-testid="review-helpers"
      className={cn('flex flex-col gap-1 text-sm font-normal text-muted-foreground', className)}
    >
      {kind === 'google' ? (
        <>
          <p id={HELPER_ID.notThis}>{REVIEW_GOOGLE_HELPER_NOT_THIS}</p>
          <p id={HELPER_ID.skip}>{REVIEW_GOOGLE_HELPER_SKIP}</p>
        </>
      ) : (
        <>
          <p id={HELPER_ID.distinct}>{REVIEW_DIFFERENT_HELPER}</p>
          <p id={HELPER_ID.skip}>{REVIEW_SKIP_HELPER}</p>
        </>
      )}
    </div>
  );
}

type PairActionsProps = { kind?: 'pair'; candidateId: string | null };
type GoogleActionsProps = {
  kind: 'google';
  attachmentId: string;
  /** The spine business's display name, for the reject dialog's title and body. */
  businessName: string;
  /** Where "Skip" goes: this `/review` URL with the listing added to the session's skipped ids. */
  skipHref: string;
  /** A TIE's other business (display name), else null/absent. Since 0030 confirming this side
   *  rejects the other in the same write, so the success toast names both. */
  tieOtherName?: string | null;
};

/** The action bar for the item on screen — a duplicate pair (default) or a Google listing. */
export function ReviewActions(props: PairActionsProps | GoogleActionsProps) {
  if (props.kind === 'google') {
    return (
      <GoogleActions
        attachmentId={props.attachmentId}
        businessName={props.businessName}
        skipHref={props.skipHref}
        tieOtherName={props.tieOtherName ?? null}
      />
    );
  }
  return <PairActions candidateId={props.candidateId} />;
}

function PairActions({ candidateId }: { candidateId: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<ReviewDecision | null>(null);
  const [refusal, setRefusal] = useState<Refusal<ReviewDecision> | null>(null);

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
        <RefusalAlert
          refusal={refusal}
          onRetry={() => decide(refusal.decision)}
          onReload={reload}
        />
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
            describedBy={HELPER_ID.distinct}
            data-testid="review-action-different"
          />
          <DecisionButton
            {...shared}
            decision="skip"
            label={REVIEW_ACTION_SKIP}
            variant="ghost"
            describedBy={HELPER_ID.skip}
            data-testid="review-action-skip"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The Google listing's bar (04-UI-SPEC § Screen 3). Same rows, busy states and refusal Alert as
 * the pair's; Rule 20 holds for all three actions — nothing advances before the server answers.
 */
function GoogleActions({
  attachmentId,
  businessName,
  skipHref,
  tieOtherName,
}: {
  attachmentId: string;
  businessName: string;
  skipHref: string;
  tieOtherName: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<ListingDecision | null>(null);
  const [refusal, setRefusal] = useState<Refusal<ListingDecision> | null>(null);

  // A new listing on screen clears the last one's refusal — it was about a different item.
  const [shownFor, setShownFor] = useState(attachmentId);
  if (shownFor !== attachmentId) {
    setShownFor(attachmentId);
    setRefusal(null);
  }

  const decide = useCallback(
    (decision: ListingDecision) => {
      setRefusal(null);
      setPressed(decision);
      startTransition(async () => {
        let result: Awaited<ReturnType<typeof recordListingDecision>>;
        try {
          result = await recordListingDecision({ attachmentId, decision });
        } catch {
          // The REQUEST failed, so nothing was recorded and the listing is still pending: the
          // same retryable refusal, the listing still on screen (Rule 20).
          setRefusal({ message: REVIEW_GOOGLE_DECISION_FAILED, retryable: true, decision });
          return;
        }
        if (!result.ok) {
          setRefusal({
            message: result.message,
            retryable: isRetryable(result.code, result.detail?.reason),
            decision,
          });
          return;
        }
        if (decision === 'attached') {
          // 0030: a confirmed tie side rejects the other side in the same write, and both leave
          // the queue — the toast says so, so the count dropping by two is never a surprise.
          toast(
            tieOtherName
              ? TOAST_ATTACHED_TIE(result.data.businessName, tieOtherName)
              : TOAST_ATTACHED(result.data.businessName),
          );
          router.refresh();
          return;
        }
        // Skip wrote nothing: a refresh would return this same listing (04-21). Move to the URL
        // that carries it as skipped; the queue sinks it and shows the next item.
        router.push(skipHref);
      });
    },
    [attachmentId, router, skipHref, tieOtherName],
  );

  const reload = useCallback(() => {
    setRefusal(null);
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  /** The reject dialog recorded its write and closed: now the queue may move on. */
  const onRejected = useCallback(() => {
    router.refresh();
  }, [router]);

  const busy = isPending;
  const shared = { busy, isPending, pressed, onDecide: decide };

  return (
    <div data-testid="review-actions" className="flex flex-col gap-2 sm:gap-4">
      {refusal ? (
        <RefusalAlert
          refusal={refusal}
          onRetry={() => decide(refusal.decision)}
          onReload={reload}
        />
      ) : null}

      {/* The pair's geometry: "Same business" full width on phone, then the other two. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <DecisionButton
          {...shared}
          decision="attached"
          label={REVIEW_ACTION_SAME}
          variant="default"
          data-testid="review-action-same"
        />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          {/* Rule 42: this trigger ONLY opens the confirmation; the dialog records. */}
          <RejectDialog
            attachmentId={attachmentId}
            businessName={businessName}
            disabled={busy}
            onRecorded={onRejected}
          >
            <TriggerButton
              busy={busy}
              describedBy={HELPER_ID.notThis}
              data-testid="review-action-not-this"
            >
              {REVIEW_ACTION_NOT_THIS}
            </TriggerButton>
          </RejectDialog>
          <DecisionButton
            {...shared}
            decision="skip"
            label={REVIEW_ACTION_SKIP}
            variant="ghost"
            describedBy={HELPER_ID.skip}
            data-testid="review-action-skip"
          />
        </div>
      </div>
    </div>
  );
}

/** The persistent refusal (a toast is for success only). "Try again" only when it can work. */
function RefusalAlert({
  refusal,
  onRetry,
  onReload,
}: {
  refusal: { message: string; retryable: boolean };
  onRetry: () => void;
  onReload: () => void;
}) {
  return (
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
            onClick={onRetry}
          >
            {ERROR_ACTION.tryAgain}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          data-testid="review-error-reload"
          className={cn('h-11', BUTTON_TEXT)}
          onClick={onReload}
        >
          {ERROR_ACTION.reloadQueue}
        </Button>
      </div>
    </Alert>
  );
}

/**
 * "Not this business": an outline bar button that only OPENS the reject dialog. The dialog's
 * trigger clones it (`asChild`) with its own `onClick` / `aria-expanded` / ref, so every prop
 * it is given is passed on to the `Button`. Busy, it is `aria-disabled` like its neighbours,
 * and the dialog refuses to open.
 */
function TriggerButton({
  busy,
  describedBy,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { busy: boolean; describedBy: string; 'data-testid': string }) {
  return (
    <Button
      type="button"
      variant="outline"
      {...props}
      aria-disabled={busy || undefined}
      aria-describedby={describedBy}
      className={cn(
        'h-12 w-full sm:h-11 sm:w-auto',
        BUTTON_TEXT,
        busy && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {children}
    </Button>
  );
}

function DecisionButton<D extends string>({
  decision,
  label,
  variant,
  'data-testid': testId,
  busy,
  isPending,
  pressed,
  onDecide,
  describedBy,
}: {
  decision: D;
  label: string;
  variant: 'default' | 'outline' | 'ghost';
  /** The id of the helper sentence this action is described by (C-WR-06). */
  describedBy?: string;
  'data-testid': string;
  busy: boolean;
  isPending: boolean;
  pressed: D | null;
  onDecide: (decision: D) => void;
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
      aria-describedby={describedBy}
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

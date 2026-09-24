import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Google listing's action bar and its reject confirmation (04-UI-SPEC § Screen 3; Executor
 * Rules 20 and 42; T-4-06).
 *
 * - Rule 42: "Not this business" is irreversible, so its trigger ONLY opens the confirmation.
 *   No server action runs until the dialog's confirm is pressed.
 * - Rule 20: the queue never advances before the write lands. "Advance" is `router.refresh()`
 *   (a decision the server recorded) or `router.push(skipHref)` (a skip, which records nothing
 *   and so must CHANGE the URL — a refresh would return the very same listing, 04-21).
 * - "Same business" has no confirmation (Rule 23's inheritance): it is reversible by Detach.
 *
 * 🔴 THE ACTION MODULES ARE FACTORY-MOCKED: each carries the server directive and pulls in
 * `src/db/`, whose `import 'server-only'` throws in the dom lane by design (vitest.config.ts).
 * `useIsDesk` lives in run-drawer.tsx, which imports the queue-run action — mocked the same way.
 */
vi.mock('@/server/actions/record-listing-decision', () => ({ recordListingDecision: vi.fn() }));
vi.mock('@/server/actions/record-review-decision', () => ({ recordReviewDecision: vi.fn() }));
vi.mock('@/server/actions/queue-run', () => ({ queueRun: vi.fn() }));

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { toast } from 'sonner';
import { ReviewActions, ReviewHelpers } from '@/components/review/review-actions';
import {
  REJECT_BODY,
  REJECT_FAILED,
  REJECT_TITLE,
  REVIEW_GOOGLE_ALREADY_DECIDED,
  REVIEW_GOOGLE_DECISION_FAILED,
  REVIEW_GOOGLE_HELPER_NOT_THIS,
  REVIEW_GOOGLE_HELPER_SKIP,
  REVIEW_GOOGLE_TIE_TAKEN,
  TOAST_ATTACHED,
  TOAST_ATTACHED_TIE,
  TOAST_REJECTED,
} from '@/lib/ui/copy';
import { recordListingDecision } from '@/server/actions/record-listing-decision';
import { recordReviewDecision } from '@/server/actions/record-review-decision';

type Answer = Awaited<ReturnType<typeof recordListingDecision>>;
const action = vi.mocked(recordListingDecision);
const pairAction = vi.mocked(recordReviewDecision);
const toastFn = vi.mocked(toast);

const ATTACHMENT = '22222222-2222-4222-8222-222222222222';
const NAME = 'Valley Locksmith & Key';
const SKIP_HREF = `/review?kind=google&skip=${ATTACHMENT}`;

/** Desk by default: `useIsDesk()` reads `(min-width: 1024px)` through matchMedia. */
let deskMatches = true;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: deskMatches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  deskMatches = true;
  action.mockReset();
  pairAction.mockReset();
  refresh.mockReset();
  push.mockReset();
  toastFn.mockReset();
});

afterEach(cleanup);

/** Hold the action's answer open until the test says so. */
function deferAnswer(): (answer: Answer) => Promise<void> {
  let resolve!: (a: Answer) => void;
  action.mockImplementationOnce(() => new Promise<Answer>((r) => (resolve = r)));
  return async (answer) => {
    await act(async () => {
      resolve(answer);
    });
  };
}

const RECORDED: Answer = { ok: true, data: { remaining: 3, businessName: NAME } };

function renderGoogleBar() {
  return render(
    <div>
      <div data-testid="review-google">the listing</div>
      <ReviewHelpers kind="google" />
      <ReviewActions
        kind="google"
        attachmentId={ATTACHMENT}
        businessName={NAME}
        skipHref={SKIP_HREF}
      />
    </div>,
  );
}

describe('google listing actions', () => {
  it('confirming a tie side says the other side was recorded as not it (0030)', async () => {
    render(
      <ReviewActions
        kind="google"
        attachmentId={ATTACHMENT}
        businessName={NAME}
        skipHref={SKIP_HREF}
        tieOtherName="Valley Lock Co"
      />,
    );
    action.mockResolvedValueOnce(RECORDED);
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-action-same'));
    });
    expect(action).toHaveBeenCalledWith({ attachmentId: ATTACHMENT, decision: 'attached' });
    expect(toastFn).toHaveBeenCalledWith(TOAST_ATTACHED_TIE(NAME, 'Valley Lock Co'));
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();

    // Not a tie: the plain toast.
    toastFn.mockReset();
    renderGoogleBar();
    action.mockResolvedValueOnce(RECORDED);
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-action-same'));
    });
    expect(toastFn).toHaveBeenCalledWith(TOAST_ATTACHED(NAME));
  });

  it('confirming a tie side whose other side a human already confirmed offers only a reload (0030)', async () => {
    // 0030's `decide_place_attachment` refuses 55000; `_listing-decisions.ts` maps THIS 55000
    // (a pending tie whose other side is confirmed) to `conflict` / `tie_confirmed_elsewhere`
    // with the sentence that names the other business. The bar shows that sentence — not "someone
    // already decided this listing", which is false here — must not claim success, must not
    // advance, and must not offer a retry that can only be refused again.
    action.mockResolvedValueOnce({
      ok: false,
      code: 'conflict',
      message: REVIEW_GOOGLE_TIE_TAKEN('Valley Lock Co'),
      detail: { reason: 'tie_confirmed_elsewhere' },
    });
    render(
      <ReviewActions
        kind="google"
        attachmentId={ATTACHMENT}
        businessName={NAME}
        skipHref={SKIP_HREF}
        tieOtherName="Valley Lock Co"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-action-same'));
    });
    const actions = screen.getByTestId('review-actions');
    expect(actions).toHaveTextContent(REVIEW_GOOGLE_TIE_TAKEN('Valley Lock Co'));
    expect(actions).not.toHaveTextContent(REVIEW_GOOGLE_ALREADY_DECIDED);
    expect(within(actions).queryByRole('button', { name: /try again/i })).toBeNull();
    expect(within(actions).getByRole('button', { name: /reload the queue/i })).toBeInTheDocument();
    expect(toastFn).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('the reject trigger calls no server action until confirm', async () => {
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-not-this'));

    const dialog = screen.getByTestId('review-reject-dialog');
    // Rule 42: opening the confirmation records nothing.
    expect(action).not.toHaveBeenCalled();
    expect(pairAction).not.toHaveBeenCalled();

    const d = within(dialog);
    expect(d.getByText(REJECT_TITLE(NAME))).toBeInTheDocument();
    expect(d.getByTestId('review-reject-consequences')).toHaveTextContent(REJECT_BODY(NAME));
    expect(d.getByTestId('review-reject-confirm')).toHaveTextContent('Never attach this listing');
    expect(d.getByTestId('review-reject-dismiss')).toHaveTextContent('Keep it pending');
    expect(d.queryByText('Cancel')).toBeNull();
    expect(d.queryByRole('button', { name: 'Close' })).toBeNull();
    // Never a form action (a reset after a failed action walks Radix state backwards).
    expect(dialog.querySelector('form')).toBeNull();

    action.mockResolvedValueOnce(RECORDED);
    await act(async () => {
      fireEvent.click(d.getByTestId('review-reject-confirm'));
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ attachmentId: ATTACHMENT, decision: 'rejected' });
    expect(toastFn).toHaveBeenCalledWith(TOAST_REJECTED(NAME));
    // Only now does the queue move on.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByTestId('review-reject-dialog')).toBeNull();
  });

  it('the reject dialog stays open until the write lands', async () => {
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-not-this'));
    const answer = deferAnswer();
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-reject-confirm'));
    });

    // In flight: "Recording…", modal, nothing advanced.
    const confirm = screen.getByTestId('review-reject-confirm');
    expect(confirm).toHaveTextContent('Recording…');
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('review-reject-dismiss')).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId('review-reject-dialog'), {
      key: 'Escape',
      code: 'Escape',
    });
    expect(screen.getByTestId('review-reject-dialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();

    await answer({ ok: false, code: 'unexpected', message: REVIEW_GOOGLE_DECISION_FAILED });

    // A failure: the reject-failed Alert INSIDE the dialog, the listing still on screen.
    const error = screen.getByTestId('review-reject-error');
    expect(
      within(screen.getByTestId('review-reject-dialog')).getByTestId('review-reject-error'),
    ).toBe(error);
    expect(error).toHaveTextContent(REJECT_FAILED);
    expect(screen.getByTestId('review-google')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();

    // "Try again" re-sends the same reject, and a recorded answer advances.
    action.mockResolvedValueOnce(RECORDED);
    await act(async () => {
      fireEvent.click(within(error).getByTestId('review-reject-retry'));
    });
    expect(action).toHaveBeenLastCalledWith({ attachmentId: ATTACHMENT, decision: 'rejected' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the reject dialog: a request that never reaches the server keeps it open with the reject-failed sentence', async () => {
    action.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-not-this'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-reject-confirm'));
    });
    expect(screen.getByTestId('review-reject-error')).toHaveTextContent(REJECT_FAILED);
    expect(screen.getByTestId('review-reject-dialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('the reject dialog: a listing someone else decided offers only a reload', async () => {
    action.mockResolvedValueOnce({
      ok: false,
      code: 'conflict',
      message: REVIEW_GOOGLE_ALREADY_DECIDED,
      detail: { reason: 'already_decided' },
    });
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-not-this'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-reject-confirm'));
    });

    const error = screen.getByTestId('review-reject-error');
    expect(error).toHaveTextContent(REVIEW_GOOGLE_ALREADY_DECIDED);
    expect(within(error).queryByTestId('review-reject-retry')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(error).getByTestId('review-reject-reload'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('review-reject-dialog')).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('keep it pending dismisses without recording', async () => {
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-not-this'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-reject-dismiss'));
    });
    expect(screen.queryByTestId('review-reject-dialog')).toBeNull();
    expect(action).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    // The listing is still on screen, pending.
    expect(screen.getByTestId('review-google')).toBeInTheDocument();
  });

  it('same business on a google item records a confirm without a dialog', async () => {
    const answer = deferAnswer();
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-same'));

    expect(screen.queryByTestId('review-reject-dialog')).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ attachmentId: ATTACHMENT, decision: 'attached' });
    expect(pairAction).not.toHaveBeenCalled();
    // Busy and not advanced until the write lands (Rule 20).
    expect(screen.getByTestId('review-action-same')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('review-action-not-this')).toHaveAttribute('aria-disabled', 'true');
    expect(refresh).not.toHaveBeenCalled();

    await answer(RECORDED);
    expect(toastFn).toHaveBeenCalledWith(TOAST_ATTACHED(NAME));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('same business on a google item that fails stays on the listing with the google sentence', async () => {
    action.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderGoogleBar();
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-action-same'));
    });
    expect(screen.getByTestId('review-error')).toHaveTextContent(REVIEW_GOOGLE_DECISION_FAILED);
    expect(screen.getByTestId('review-google')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('skip on a google item moves on to the next listing without recording a decision', async () => {
    // 04-21: Skip persists nothing, so a refresh would re-read the SAME listing. The bar pushes
    // the URL that carries this listing as skipped; the queue sinks it and shows the next.
    const answer = deferAnswer();
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-skip'));
    expect(action).toHaveBeenCalledWith({ attachmentId: ATTACHMENT, decision: 'skip' });
    expect(push).not.toHaveBeenCalled();

    await answer(RECORDED);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(SKIP_HREF);
    expect(refresh).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
  });

  it('a second tap on a google item while one decision is in flight opens nothing and sends nothing', async () => {
    const answer = deferAnswer();
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-same'));
    fireEvent.click(screen.getByTestId('review-action-not-this'));
    fireEvent.click(screen.getByTestId('review-action-skip'));
    expect(screen.queryByTestId('review-reject-dialog')).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
    await answer(RECORDED);
  });

  it('the google helper sentences are shown and describe their buttons', () => {
    renderGoogleBar();
    const helpers = screen.getByTestId('review-helpers');
    expect(helpers).toHaveTextContent(REVIEW_GOOGLE_HELPER_NOT_THIS);
    expect(helpers).toHaveTextContent(REVIEW_GOOGLE_HELPER_SKIP);
    expect(helpers).not.toHaveTextContent('Different');
    expect(screen.getByTestId('review-action-not-this')).toHaveAccessibleDescription(
      REVIEW_GOOGLE_HELPER_NOT_THIS,
    );
    expect(screen.getByTestId('review-action-skip')).toHaveAccessibleDescription(
      REVIEW_GOOGLE_HELPER_SKIP,
    );
    expect(screen.getByTestId('review-action-not-this')).toHaveTextContent('Not this business');
    expect(screen.queryByTestId('review-action-different')).toBeNull();
  });

  it('on a phone the reject confirmation is a drawer with the same contract', async () => {
    deskMatches = false;
    renderGoogleBar();
    fireEvent.click(screen.getByTestId('review-action-not-this'));
    const drawer = screen.getByTestId('review-reject-dialog');
    expect(drawer).toHaveAttribute('data-slot', 'drawer-content');
    // 48px destructive confirm on phone.
    expect(within(drawer).getByTestId('review-reject-confirm')).toHaveClass('h-12');
    expect(action).not.toHaveBeenCalled();
  });
});

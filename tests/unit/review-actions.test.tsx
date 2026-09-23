import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/review`'s action bar — 03-UI-SPEC Executor Rule 20, as named component tests:
 * THE QUEUE NEVER ADVANCES BEFORE THE DECISION IS RECORDED.
 *
 * "Advance" is `router.refresh()` — the only way the page re-reads the next pair. So each test
 * holds the action's answer open, looks at the bar while it is pending, then answers and checks
 * whether the page was asked to move on. A refusal must leave `refresh` uncalled and a
 * persistent Alert on screen; only `ok: true` may toast and refresh.
 *
 * 🔴 THE ACTION MODULE IS FACTORY-MOCKED: it carries the server directive and pulls in
 * `src/db/`, whose `import 'server-only'` throws in the dom lane by design (vitest.config.ts).
 */
vi.mock('@/server/actions/record-review-decision', () => ({ recordReviewDecision: vi.fn() }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { toast } from 'sonner';
import { recordReviewDecision } from '@/server/actions/record-review-decision';
import { ReviewActions } from '@/components/review/review-actions';
import {
  REVIEW_ALREADY_DECIDED,
  REVIEW_DECISION_FAILED,
  TOAST_DISTINCT,
  TOAST_MERGED,
} from '@/lib/ui/copy';

type Answer = Awaited<ReturnType<typeof recordReviewDecision>>;
const action = vi.mocked(recordReviewDecision);
const toastFn = vi.mocked(toast);

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

const CANDIDATE = '11111111-1111-4111-8111-111111111111';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

beforeEach(() => {
  action.mockReset();
  refresh.mockReset();
  toastFn.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('review actions', () => {
  it('a refused decision does not advance the queue', async () => {
    const answer = deferAnswer();
    render(<ReviewActions candidateId={CANDIDATE} />);

    fireEvent.click(screen.getByTestId('review-action-same'));
    expect(action).toHaveBeenCalledWith({ candidateId: CANDIDATE, decision: 'merged' });

    // Pending: the pressed button is busy, the other two are aria-disabled, nothing advanced.
    expect(screen.getByTestId('review-action-same')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('review-action-different')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('review-action-skip')).toHaveAttribute('aria-disabled', 'true');
    expect(refresh).not.toHaveBeenCalled();

    await answer({ ok: false, code: 'unexpected', message: REVIEW_DECISION_FAILED });

    expect(refresh).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
    expect(screen.getByTestId('review-error')).toHaveTextContent(REVIEW_DECISION_FAILED);
    expect(screen.getByTestId('review-error-retry')).toBeInTheDocument();
    expect(screen.getByTestId('review-error-reload')).toBeInTheDocument();
    // The bar is live again, on the same pair.
    expect(screen.getByTestId('review-action-same')).not.toHaveAttribute('aria-disabled');
  });

  it('a decision whose request never reaches the server keeps the pair and shows the refusal', async () => {
    // C-CR-01: the action PROMISE rejects (signal lost mid-tap, a 5xx, a deploy that retired
    // the action id). Uncaught inside the transition, React hands it to the nearest error
    // boundary and the whole screen goes. It must land in the same Alert a refusal does.
    action.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(
      <div>
        <div data-testid="review-pair">the pair</div>
        <ReviewActions candidateId={CANDIDATE} />
      </div>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('review-action-different'));
    });

    expect(screen.getByTestId('review-pair')).toBeInTheDocument();
    expect(screen.getByTestId('review-error')).toHaveTextContent(REVIEW_DECISION_FAILED);
    expect(screen.getByTestId('review-error-retry')).toBeInTheDocument();
    expect(screen.getByTestId('review-error-reload')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
    expect(screen.getByTestId('review-action-different')).not.toHaveAttribute('aria-disabled');

    // "Try again" re-sends the SAME decision.
    action.mockResolvedValueOnce({ ok: true, data: { remaining: 2, merged: null } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-error-retry'));
    });
    expect(action).toHaveBeenLastCalledWith({ candidateId: CANDIDATE, decision: 'distinct' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a recorded merge toasts the true names and only then advances', async () => {
    const answer = deferAnswer();
    render(<ReviewActions candidateId={CANDIDATE} />);
    fireEvent.click(screen.getByTestId('review-action-same'));
    expect(refresh).not.toHaveBeenCalled();

    await answer({
      ok: true,
      data: { remaining: 4, merged: { winnerName: 'Riverside Stone', loserName: 'RIVERSIDE STONE, INC.' } },
    });

    expect(toastFn).toHaveBeenCalledWith(TOAST_MERGED('RIVERSIDE STONE, INC.', 'Riverside Stone'));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('review-error')).toBeNull();
  });

  it('different toasts, skip advances silently', async () => {
    let answer = deferAnswer();
    render(<ReviewActions candidateId={CANDIDATE} />);
    fireEvent.click(screen.getByTestId('review-action-different'));
    await answer({ ok: true, data: { remaining: 3, merged: null } });
    expect(toastFn).toHaveBeenCalledWith(TOAST_DISTINCT);
    expect(refresh).toHaveBeenCalledTimes(1);

    toastFn.mockReset();
    answer = deferAnswer();
    fireEvent.click(screen.getByTestId('review-action-skip'));
    await answer({ ok: true, data: { remaining: 3, merged: null } });
    expect(toastFn).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a pair someone else decided offers only a reload, with its own true sentence', async () => {
    const answer = deferAnswer();
    render(<ReviewActions candidateId={CANDIDATE} />);
    fireEvent.click(screen.getByTestId('review-action-different'));
    await answer({
      ok: false,
      code: 'conflict',
      message: REVIEW_ALREADY_DECIDED,
      detail: { reason: 'already_decided' },
    });

    expect(screen.getByTestId('review-error')).toHaveTextContent(REVIEW_ALREADY_DECIDED);
    expect(screen.queryByTestId('review-error-retry')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('review-error-reload'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a second tap while one decision is in flight sends nothing', async () => {
    const answer = deferAnswer();
    render(<ReviewActions candidateId={CANDIDATE} />);
    fireEvent.click(screen.getByTestId('review-action-same'));
    fireEvent.click(screen.getByTestId('review-action-different'));
    fireEvent.click(screen.getByTestId('review-action-same'));
    expect(action).toHaveBeenCalledTimes(1);
    await answer({ ok: true, data: { remaining: 0, merged: null } });
  });

  it('the loading bar is real and disabled', () => {
    render(<ReviewActions candidateId={null} />);
    for (const id of ['review-action-same', 'review-action-different', 'review-action-skip']) {
      const button = screen.getByTestId(id);
      expect(button).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(button);
    }
    expect(action).not.toHaveBeenCalled();
  });
});

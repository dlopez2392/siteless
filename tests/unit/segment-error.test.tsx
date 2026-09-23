import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * C-CR-01: the route error boundaries. Before these existed a read that threw on `/review` or
 * `/businesses/[id]` (a DB error, a timeout) replaced the whole app — tab bar included — with
 * Next's generic "Application error", and the spec's own sentences for exactly those cases
 * (`REVIEW_LOAD_FAILED`, `SPINE_UNEXPECTED_ERROR`) were defined and rendered by nothing.
 *
 * Each boundary is a client component (Next requires it). What is proven here: it renders the
 * spec's sentence, its "Try again" calls Next's `retry()` (re-fetch AND re-render, not the
 * client-only `reset()`), and it ends with the spec's way out.
 */
import AppError from '@/app/(app)/error';
import BusinessDetailError from '@/app/(app)/businesses/[id]/error';
import ReviewError from '@/app/(app)/review/error';
import {
  ERROR_THING,
  REVIEW_LOAD_FAILED,
  SPINE_UNEXPECTED_ERROR,
  UNEXPECTED_ERROR,
} from '@/lib/ui/copy';

afterEach(cleanup);

const boom = Object.assign(new Error('An error occurred in the Server Components render.'), {
  digest: '1234567',
});

function props() {
  return { error: boom, retry: vi.fn(), reset: vi.fn() };
}

describe('route error boundaries', () => {
  it('the review boundary renders the review-load-failed sentence and retries the segment', () => {
    const p = props();
    render(<ReviewError {...p} />);
    const alert = screen.getByTestId('route-error');
    expect(alert).toHaveTextContent(REVIEW_LOAD_FAILED);
    // The framework's own message (and its digest) never reaches the reader.
    expect(alert).not.toHaveTextContent('Server Components');
    fireEvent.click(screen.getByTestId('route-error-retry'));
    expect(p.retry).toHaveBeenCalledTimes(1);
    expect(p.reset).not.toHaveBeenCalled();
    expect(screen.getByTestId('route-error-open-sources')).toHaveAttribute('href', '/sources');
  });

  it('the business detail boundary renders the spine unexpected-error sentence for this business', () => {
    const p = props();
    render(<BusinessDetailError {...p} />);
    expect(screen.getByTestId('route-error')).toHaveTextContent(
      SPINE_UNEXPECTED_ERROR(ERROR_THING.business),
    );
    fireEvent.click(screen.getByTestId('route-error-retry'));
    expect(p.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('route-error-open-sources')).toHaveAttribute('href', '/sources');
  });

  it('the app-wide boundary renders the unexpected-error sentence and retries', () => {
    const p = props();
    render(<AppError {...p} />);
    expect(screen.getByTestId('route-error')).toHaveTextContent(UNEXPECTED_ERROR(ERROR_THING.page));
    fireEvent.click(screen.getByTestId('route-error-retry'));
    expect(p.retry).toHaveBeenCalledTimes(1);
  });

  it('every route error action is a 44px target', () => {
    render(<ReviewError {...props()} />);
    for (const id of ['route-error-retry', 'route-error-open-sources']) {
      expect(screen.getByTestId(id).className).toMatch(/\bh-11\b/);
    }
  });
});

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/review`'s phone thumb bar is `position: fixed`, so the content needs clearance beneath it.
 * That clearance used to be a guessed constant (137px = two 48px rows + gap + padding + border).
 * A refusal Alert inside the bar made it 337px tall while the clearance stayed at 137px, which
 * left 184 of card B's 251px under the bar and out of scroll reach (03-22 Task 2, measured).
 *
 * The fix measures the bar. These tests pin that the in-flow spacer's height is the bar's
 * MEASURED height, and that it follows the bar when the bar grows and shrinks. jsdom has no
 * layout, so ResizeObserver and the bar's box are faked. The real-browser proof, with a
 * simulated refusal scrolled to the bottom, is in docs/measurements/03-gate-mutations.md.
 */

let observed: Element | null = null;
let notify: (() => void) | null = null;
const disconnect = vi.fn();

class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    notify = () => cb([], this as unknown as ResizeObserver);
  }
  observe(el: Element) {
    observed = el;
  }
  unobserve() {}
  disconnect() {
    disconnect();
  }
}

let barHeight = 0;

beforeEach(() => {
  observed = null;
  notify = null;
  disconnect.mockClear();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const h = this.getAttribute('data-testid') === 'review-thumb-bar' ? barHeight : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 390, bottom: h, width: 390, height: h, toJSON() {} } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

import { ThumbBar } from '@/components/review/thumb-bar';
import { PHONE_TOAST_OFFSET, THUMB_BAR_HEIGHT_VAR } from '@/lib/ui/chrome';

describe('review thumb bar clearance', () => {
  it('thumb bar spacer mirrors the measured bar height', () => {
    barHeight = 137;
    render(
      <ThumbBar>
        <button type="button">Same business</button>
      </ThumbBar>,
    );
    const bar = screen.getByTestId('review-thumb-bar');
    expect(observed).toBe(bar);
    act(() => notify!());
    const spacer = screen.getByTestId('review-thumb-bar-spacer');
    expect(spacer.style.height).toBe('137px');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    // Phone only: from 640px up the bar is an ordinary row and needs no clearance.
    expect(spacer.className).toMatch(/\bsm:hidden\b/);
  });

  it('thumb bar spacer follows the bar when a refusal makes it taller, and back', () => {
    barHeight = 137;
    render(
      <ThumbBar>
        <button type="button">Same business</button>
      </ThumbBar>,
    );
    act(() => notify!());
    const spacer = screen.getByTestId('review-thumb-bar-spacer');
    expect(spacer.style.height).toBe('137px');

    barHeight = 337; // the refusal Alert is showing
    act(() => notify!());
    expect(spacer.style.height).toBe('337px');

    barHeight = 137; // the refusal is gone
    act(() => notify!());
    expect(spacer.style.height).toBe('137px');
  });

  it('thumb bar publishes its measured height for the phone toast offset, and withdraws it on unmount', () => {
    // C-WR-07: sonner's phone toasts sat 16px off the bottom — over the tab bar and the thumb
    // bar's lower row (measured on the built app: toast 774.5–828px vs bar top 643px at
    // 390×844). The Toaster's phone offset reads this variable.
    const root = document.documentElement;
    barHeight = 137;
    const { unmount } = render(
      <ThumbBar>
        <button type="button">Same business</button>
      </ThumbBar>,
    );
    act(() => notify!());
    expect(root.style.getPropertyValue(THUMB_BAR_HEIGHT_VAR)).toBe('137px');

    barHeight = 337; // a refusal made the bar taller: toasts move up with it
    act(() => notify!());
    expect(root.style.getPropertyValue(THUMB_BAR_HEIGHT_VAR)).toBe('337px');

    unmount();
    // Off `/review` there is no bar, so toasts clear the tab bar alone.
    expect(root.style.getPropertyValue(THUMB_BAR_HEIGHT_VAR)).toBe('');
  });

  it('the phone toast offset clears the tab bar, the safe area and the measured thumb bar', () => {
    expect(PHONE_TOAST_OFFSET.bottom).toBe(
      `calc(4rem + env(safe-area-inset-bottom) + var(${THUMB_BAR_HEIGHT_VAR}, 0px) + 0.5rem)`,
    );
  });

  it('thumb bar stops observing when it unmounts', () => {
    barHeight = 137;
    const { unmount } = render(
      <ThumbBar>
        <button type="button">Same business</button>
      </ThumbBar>,
    );
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

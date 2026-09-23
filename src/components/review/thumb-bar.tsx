'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { THUMB_BAR_HEIGHT_VAR } from '@/lib/ui/chrome';

/**
 * The thumb zone (MOB-01). Phone: the `--card` surface with a 1px top border and 16px padding,
 * fixed directly above the 64px tab bar. The safe-area inset is ADDED to the tab bar's height,
 * never substituted for it. From 640px up it is an ordinary row beneath the chip band. It holds
 * nothing destructive and nothing irreversible (Executor Rule 23).
 *
 * 🔴 THE CLEARANCE IS MEASURED, NEVER GUESSED. The bar is `position: fixed`, so the content
 * needs an in-flow spacer beneath it. A constant (137px: two 48px rows + an 8px gap + 2×16px
 * padding + a 1px border) was right only while the bar held its buttons. A refusal Alert inside
 * the bar made it 337px tall, and 184 of card B's 251px sat under the bar where no scroll could
 * reach (03-22 Task 2, measured on the built app). The spacer now tracks the bar's real height
 * through a ResizeObserver. The constant stays only as the first-paint value, before any
 * measurement exists.
 *
 * `-mt-4` cancels the column's `gap-4`, so the spacer adds exactly the bar's height. The column
 * is `lg:gap-6`, but the spacer is `sm:hidden`, so it never meets that gap.
 */
export function ThumbBar({ children }: { children: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      const measured = Math.ceil(bar.getBoundingClientRect().height);
      setHeight(measured);
      // C-WR-07: the phone Toaster's offset (`PHONE_TOAST_OFFSET`) reads this, so a toast
      // lands ABOVE the bar — and moves up with it when a refusal makes it taller.
      root.style.setProperty(THUMB_BAR_HEIGHT_VAR, `${measured}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      // Off `/review` there is no bar; toasts clear the tab bar alone.
      root.style.removeProperty(THUMB_BAR_HEIGHT_VAR);
    };
  }, []);

  return (
    <>
      <div
        data-testid="review-thumb-bar-spacer"
        aria-hidden="true"
        className="-mt-4 h-[calc(2*3rem+0.5rem+2*1rem+1px)] shrink-0 sm:hidden"
        style={height === null ? undefined : { height: `${height}px` }}
      />
      <Card
        ref={barRef}
        data-testid="review-thumb-bar"
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 rounded-none border-0 border-t p-4 shadow-none ring-0 sm:static sm:z-auto sm:overflow-visible sm:border-0 sm:bg-transparent sm:p-0"
      >
        {children}
      </Card>
    </>
  );
}

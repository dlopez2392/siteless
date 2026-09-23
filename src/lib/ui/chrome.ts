/**
 * Geometry shared by the phone chrome and the toasts that must clear it (C-WR-07).
 *
 * Server-safe on purpose (no client directive — `tests/unit/ui-maps.test.ts`): the root layout
 * (a server component) passes `PHONE_TOAST_OFFSET` to the Toaster, and `ThumbBar` (a client
 * component) writes `THUMB_BAR_HEIGHT_VAR`. A value exported from a client module would reach
 * the layout as a client reference, not a string (Executor Rule 5).
 */

/** Set on `<html>` by `ThumbBar` to its MEASURED height while it is mounted; absent elsewhere. */
export const THUMB_BAR_HEIGHT_VAR = '--thumb-bar-height';

/**
 * sonner's phone (<600px) offset. Its default is 16px off the bottom edge — inside the 64px tab
 * bar, and under `/review`'s fixed thumb bar (measured on the built app at 390×844: a one-line
 * toast at 774.5–828px, the thumb bar from 643px, the tab bar from 779px). This lifts the stack
 * above the tab bar and its safe-area inset (the same `4rem + env(...)` the thumb bar sits on),
 * plus the thumb bar's measured height where there is one, plus an 8px gap.
 *
 * sonner writes it verbatim into `--mobile-offset-bottom`, and the `var()` inside resolves on
 * the toaster element, so the stack follows the bar when a refusal makes it taller.
 */
export const PHONE_TOAST_OFFSET = {
  bottom: `calc(4rem + env(safe-area-inset-bottom) + var(${THUMB_BAR_HEIGHT_VAR}, 0px) + 0.5rem)`,
} as const;

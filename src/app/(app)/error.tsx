'use client';

import { RouteError, type RouteErrorProps } from '@/components/app-shell/route-error';
import { ERROR_THING, UNEXPECTED_ERROR } from '@/lib/ui/copy';

/**
 * The app-wide fallback for every signed-in screen without a boundary of its own (C-CR-01).
 * Before it existed, any render that threw replaced the whole app with Next's generic
 * "Application error". It renders inside the `(app)` layout, so the sidebar and tab bar stay
 * and the reader can leave. `/review` and `/businesses/[id]` carry their own, more specific
 * sentences; this one is 03-UI-SPEC / 02-UI-SPEC § Error → "Unexpected server error".
 */
export default function AppError({ retry }: RouteErrorProps) {
  return <RouteError message={UNEXPECTED_ERROR(ERROR_THING.page)} retry={retry} />;
}

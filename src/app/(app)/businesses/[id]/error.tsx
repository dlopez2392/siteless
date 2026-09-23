'use client';

import { RouteError, type RouteErrorProps } from '@/components/app-shell/route-error';
import { ERROR_THING, SPINE_UNEXPECTED_ERROR } from '@/lib/ui/copy';

/**
 * `/businesses/[id]` failed to load (03-UI-SPEC § Error → "Unexpected server error"; C-CR-01).
 * `getBusinessDetail` throwing used to replace the whole app with Next's generic crash. This
 * says what the spec says is true of a failed READ — nothing was changed, no merge was
 * written — and offers "Try again" and "Open sources".
 */
export default function BusinessDetailError({ retry }: RouteErrorProps) {
  return <RouteError message={SPINE_UNEXPECTED_ERROR(ERROR_THING.business)} retry={retry} openSources />;
}

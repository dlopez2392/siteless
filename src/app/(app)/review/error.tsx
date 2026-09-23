'use client';

import { RouteError, type RouteErrorProps } from '@/components/app-shell/route-error';
import { REVIEW_LOAD_FAILED, REVIEW_TITLE } from '@/lib/ui/copy';

/**
 * `/review` failed to load (03-UI-SPEC § Error → "Review queue failed to load"; C-CR-01).
 * `listReviewQueue` throwing used to replace the whole app with Next's generic crash. The page
 * title stays, so the reader still knows where they are; the tab bar stays because this
 * boundary renders inside the `(app)` layout.
 */
export default function ReviewError({ retry }: RouteErrorProps) {
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <h1 className="text-xl font-semibold leading-tight">{REVIEW_TITLE}</h1>
      <RouteError message={REVIEW_LOAD_FAILED} retry={retry} openSources />
    </div>
  );
}

import { Skeleton } from '@/components/ui/skeleton';

/**
 * 03-UI-SPEC § States → Loading, `/businesses`: "The search field and filters render
 * immediately and are interactive; 8 row skeletons below them."
 *
 * 🔴 THIS IS ONLY THE ROWS' FALLBACK. The heading, the search field and both filters are
 * rendered by the page OUTSIDE the suspended region, as the real, interactive controls — so
 * nothing in here stands in for them, and a slow search can never blank the box.
 *
 * The count line gets its own 14px block so the rows do not jump up when it arrives.
 */
const ROWS = 8;

export function BusinessesSkeleton() {
  return (
    <div data-testid="businesses-loading" aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-64 max-w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="flex min-h-11 items-center gap-4 py-2">
            <Skeleton className="h-5 w-2/3 sm:w-1/3" />
            <Skeleton className="hidden h-4 w-1/6 sm:block" />
            <Skeleton className="hidden h-4 w-1/5 sm:block" />
            <Skeleton className="hidden h-4 w-1/6 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * `/review` loading (03-UI-SPEC § States → Loading): ONE skeleton pair in the real pair's
 * geometry — two column blocks, each a 20px title bar and four 16px meta lines, and a chip band
 * of four pill skeletons. The page's loading state renders the action bar beside it REAL and
 * disabled (`ReviewActions candidateId={null}` inside the same thumb bar the live page uses).
 * Never a centred full-page spinner: the screen's shape is on screen before its data.
 *
 * It mirrors `candidate-pair.tsx`'s grid exactly (A → chips → B on phone; A | B with the band
 * beneath from 640px), so the page does not jump when the pair arrives.
 */

function SideSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-2 p-4 lg:p-6">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-1/3" />
      </CardContent>
    </Card>
  );
}

export function ReviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6" aria-hidden="true">
      <SideSkeleton className="sm:order-1" />
      <div className="flex flex-wrap gap-2 sm:order-3 sm:col-span-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>
      <SideSkeleton className="sm:order-2" />
    </div>
  );
}

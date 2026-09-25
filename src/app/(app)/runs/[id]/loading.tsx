import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RUN_REPORT_TITLE } from '@/lib/ui/copy';

/**
 * `/runs/[id]` on first paint (04-UI-SPEC § States → Loading): the title and a breadcrumb
 * render immediately, then a header-card skeleton (badge pill, a 20px line, a 28px block for the
 * cost, two 14px lines) and three card skeletons in the Requests / Tiles / Outcomes geometry.
 * Never a centred spinner.
 *
 * Only the FIRST paint. A live refresh (`router.refresh()`) keeps the current tree until the new
 * one arrives, so this never replaces a number on screen (Executor Rule 11).
 */
export default function RunReportLoading() {
  return (
    <div
      data-testid="run-report-loading"
      aria-busy="true"
      className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 sm:gap-6"
    >
      {/* The breadcrumb's shape (desk) / the back link's (phone): the preset name isn't known yet. */}
      <Skeleton className="h-5 w-64 max-w-full" />

      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold leading-tight">{RUN_REPORT_TITLE}</h1>
        <Skeleton className="h-3.5 w-48" />
      </header>

      <Card className="sm:[--card-spacing:--spacing(6)]">
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
          <Skeleton className="h-3.5 w-56 max-w-full" />
        </CardContent>
      </Card>

      {[
        { key: 'requests', rows: 3 },
        { key: 'tiles', rows: 2 },
        { key: 'outcomes', rows: 4 },
      ].map((card) => (
        <Card key={card.key} className="sm:[--card-spacing:--spacing(6)]">
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {Array.from({ length: card.rows }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

import { auth } from '@clerk/nextjs/server';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { runInstantLabel } from '@/components/runs/run-header';
import { RunReportUnavailable, RunReportView } from '@/components/runs/run-report-view';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { orgClaims } from '@/lib/auth/require-org';
import { isUuid } from '@/lib/ids';
import {
  NAV,
  RUN_REPORT_BACK_LINK,
  RUN_REPORT_BAD_ID,
  RUN_REPORT_BREADCRUMB,
  RUN_REPORT_DOCUMENT_TITLE,
  RUN_REPORT_TITLE,
} from '@/lib/ui/copy';
import { getRunReport } from '@/server/queries/run-report';

export const dynamic = 'force-dynamic';

/**
 * `/runs/[id]` — the run report (04-UI-SPEC § Screen 1; D-15, D-16, D-17; criteria 3 and 5).
 *
 * 🔴 `[id]` IS THE INTERNAL RUN UUID, AND `isUuid` RUNS BEFORE ANY READ (WR-08). A malformed
 * segment would otherwise reach the `::uuid` comparison as a 22P02 — a 500 where the honest
 * answer is "that isn't a run id". `tests/unit/ids.test.ts` walks every `[id]` route and proves
 * each one calls the guard. The bad-id body renders inline (§ States → Error: its own sentence,
 * distinct from "not found").
 *
 * 🔴 T-4-06: AN UNKNOWN ID AND A FOREIGN ID ARE THE SAME ANSWER. `getRunReport` reads under RLS
 * with an explicit org predicate on every statement, so another org's run is simply `null`; both
 * render `notFound()`. There is no ownership check here — a second, weaker answer to a question
 * the database has already settled.
 *
 * 🔴 ONE READ PER RENDER. `generateMetadata` and the page share `loadReport` through React's
 * per-request `cache`, so the document title costs no second transaction. `src/db/client.ts`
 * pools with `max: 1`; nothing on this page opens a `withOrg` inside another.
 *
 * 🔴 THE PAGE REFRESHES ITSELF (D-17). `RunAutoRefresh` (inside the report's header) calls
 * `router.refresh()` every 5 s while the run is queued or running, which re-runs THIS component
 * against the database — `force-dynamic` is what makes that a fresh read, not a cached page.
 * `renderedAtMs` is the server's clock at render, the island's only proof a refresh landed.
 *
 * `canRaiseCap` is the same `org:admin` check the budget settings page and the shell banner use:
 * AFFORDANCE, NOT AUTHORIZATION — it picks "Raise the monthly cap" vs "Ask an admin to raise the
 * cap". `app.set_budget_cap` re-checks the role in SQL (T-2-02).
 */

const loadReport = cache(async (id: string) => {
  const claims = await orgClaims();
  return getRunReport(claims, id);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: RUN_REPORT_TITLE };
  const report = await loadReport(id);
  return { title: report ? RUN_REPORT_DOCUMENT_TITLE(report.run.presetName) : RUN_REPORT_TITLE };
}

export default async function RunReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold leading-tight">{RUN_REPORT_TITLE}</h1>
        <RunReportUnavailable message={RUN_REPORT_BAD_ID} testId="run-report-bad-id" />
      </div>
    );
  }

  const report = await loadReport(id);
  if (!report) notFound();

  const { orgRole } = await auth();
  const canRaiseCap = orgRole === 'org:admin';

  const { run } = report;
  const presetHref = `/presets/${run.presetId}`;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Desk: Presets / {preset} / Run {date}. `/runs` lights Presets in the nav (04-14). */}
      <div className="hidden sm:block">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/presets" data-testid="run-breadcrumb-presets">
                  {NAV.presets}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={presetHref} data-testid="run-breadcrumb-preset">
                  {run.presetName}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="tabular-nums">
                {RUN_REPORT_BREADCRUMB(runInstantLabel(run.startedMs ?? run.createdMs))}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Phone: a 44px back link to the preset, above the title. */}
      <Link
        href={presetHref}
        data-testid="run-report-back"
        className="inline-flex h-11 items-center gap-2 self-start rounded-md text-base font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {RUN_REPORT_BACK_LINK(run.presetName)}
      </Link>

      <RunReportView report={report} renderedAtMs={Date.now()} canRaiseCap={canRaiseCap} />
    </div>
  );
}

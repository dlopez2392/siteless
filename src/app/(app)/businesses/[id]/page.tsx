import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DetailHeader } from '@/components/business-detail/detail-header';
import { FieldsAndSources } from '@/components/business-detail/fields-and-sources';
import { SourceRecords } from '@/components/business-detail/source-records';
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
import { APP_LOCALE } from '@/lib/time';
import { BUSINESSES_TITLE, FLAG_CHAIN } from '@/lib/ui/copy';
import { getBusinessDetail } from '@/server/queries/businesses';

export const dynamic = 'force-dynamic';

/**
 * `/businesses/[id]` — every field with its source, the lead key, the merge history and the
 * unmerge action (03-UI-SPEC § 4; D-17, D-18, D-19, D-20).
 *
 * 🔴 PHASE 7'S TRIAGE CARD REUSES THIS DETAIL. The field order and the source-tag treatment in
 * `fields-and-sources.tsx` are the contract that card inherits.
 *
 * 🔴 `[id]` IS THE INTERNAL UUID (D-19, Executor Rule 18). The lead key (`SL-7F3K2`) is shown
 * and copyable on this page and is never the route parameter, never a foreign key and never a
 * query key. `isUuid` runs before any read: a malformed segment would otherwise reach the
 * `::uuid` comparison and come back as a 22P02 — a 500 where the honest answer is 404.
 * `tests/unit/ids.test.ts` walks every `[id]` route and proves each one calls the guard.
 *
 * 🔴 T-3-09: AN UNKNOWN ID AND A FOREIGN ID ARE THE SAME ANSWER. `getBusinessDetail` reads under
 * RLS, so another org's business is simply not there; both render `notFound()`. There is no
 * ownership check in this file — a check here would be a second, weaker answer to a question
 * the database has already settled.
 *
 * 🔴 ONE `withOrg` FOR THE WHOLE PAGE. The business, its source records, its merge history and
 * its aliases all come from the single `getBusinessDetail` call. `src/db/client.ts` pools with
 * `max: 1`, so a second `withOrg` opened inside the first makes the request HANG rather than
 * fail — nothing on this page opens another.
 */

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const claims = await orgClaims();
  const detail = await getBusinessDetail(claims, id);
  if (!detail) notFound();

  // Counts through the PINNED locale, here in the route rather than in a component: no file
  // under src/components/ calls a locale formatter directly (Executor Rule 26).
  //
  // 🔴 "in Texas" ONLY WHEN IT IS TRUE. `statewide` is set when the count came from the
  // Comptroller's statewide name frequency; otherwise it is this org's own RGV count, and
  // printing "in Texas" beside it would overstate a local figure as a statewide one.
  const count = new Intl.NumberFormat(APP_LOCALE);
  const chainLabel = detail.chain
    ? detail.chain.statewide
      ? FLAG_CHAIN(detail.chain.members, count.format(detail.chain.members))
      : `Chain · ${count.format(detail.chain.members)} in the RGV`
    : null;

  const displayName = detail.fields.displayName.value ?? detail.externalKey;

  return (
    <div data-testid="business-detail" className="flex flex-col gap-6">
      {/* Desk only (03-UI-SPEC § 4). On a phone the tab bar already says where you are. */}
      <div className="hidden lg:block">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/businesses" data-testid="business-breadcrumb-businesses">
                  {BUSINESSES_TITLE}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{displayName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <DetailHeader
        displayName={displayName}
        leadKey={detail.externalKey}
        status={detail.status}
        closedAt={detail.fields.closedOn.value}
        chainLabel={chainLabel}
        mergedInto={detail.mergedInto}
      />

      <FieldsAndSources fields={detail.fields} />

      <SourceRecords records={detail.sourceRecords} />
    </div>
  );
}

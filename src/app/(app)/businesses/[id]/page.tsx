import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DetailHeader } from '@/components/business-detail/detail-header';
import { FieldsAndSources } from '@/components/business-detail/fields-and-sources';
import { GoogleCheck } from '@/components/business-detail/google-check';
import {
  MergeHistory,
  type MergeContext,
  type MergeRow,
} from '@/components/business-detail/merge-history';
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
import { BUSINESSES_TITLE, SOURCE_TAG } from '@/lib/ui/copy';
import {
  getBusinessDetail,
  type GoogleCheckView,
  type MergeHistoryRow,
} from '@/server/queries/businesses';
import { actorNames } from './actor-names';

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

/** Merge actors that are a Clerk user. `etl:resolve` (the desk resolve pass) is never shown:
 *  an auto merge reads "Auto-merged at {score}", which names no actor. */
/** A `businesses.primary_source` key to its plain-text tag; an unknown or absent key names no source. */
function sourceTagOf(key: string | null): string | null {
  if (key === null || !Object.hasOwn(SOURCE_TAG, key)) return null;
  return SOURCE_TAG[key as keyof typeof SOURCE_TAG];
}

function clerkUserIds(merges: MergeHistoryRow[], google: GoogleCheckView): string[] {
  const ids = new Set<string>();
  // 04-25: who rejected or detached a Google listing — the definer stamps the claims' subject.
  for (const l of google.listings) {
    if (l.decidedBy !== null && l.decidedBy.startsWith('user_')) ids.add(l.decidedBy);
  }
  for (const m of merges) {
    if (m.reason === 'review' && m.mergedBy.startsWith('user_')) ids.add(m.mergedBy);
    if (m.undoneBy !== null && m.undoneBy.startsWith('user_')) ids.add(m.undoneBy);
  }
  return [...ids];
}

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

  const names = await actorNames(clerkUserIds(detail.merges, detail.google));
  const nameOf = (actor: string) => names.get(actor) ?? actor;

  const merges: MergeRow[] = detail.merges.map((m) => ({
    mergeId: m.id,
    loserName: m.loserName,
    winnerName: m.winnerName,
    loserKey: m.loserKey,
    winnerKey: m.winnerKey,
    loserSource: sourceTagOf(m.loserSource),
    winnerSource: sourceTagOf(m.winnerSource),
    reason: m.reason,
    score: m.score,
    actor: nameOf(m.mergedBy),
    mergedAt: m.mergedAt,
    undoneAt: m.undoneAt,
    undoneBy: m.undoneBy === null ? null : nameOf(m.undoneBy),
  }));

  const mergeContext: MergeContext = {
    businessId: detail.id,
    businessName: detail.fields.displayName.value ?? '',
  };

  const displayName = detail.fields.displayName.value ?? detail.externalKey;

  // 04-25: the spine's own name, city and cluster — the Maps link's query and the empty state's
  // sentence. Never a Places value (Rule 30) and never a coordinate (Rule 32).
  const googleBusiness = {
    id: detail.id,
    displayName,
    city: detail.fields.cityZip.value?.city ?? null,
    cluster: detail.fields.category.value?.clusterName ?? null,
  };
  const googleActors: Record<string, string> = Object.fromEntries(names);

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
        chain={detail.chain}
        mergedInto={detail.mergedInto}
      />

      <FieldsAndSources fields={detail.fields} />

      {/* 04-UI-SPEC § Screen 5: Fields and sources → Google Maps check → Source records. */}
      <GoogleCheck google={detail.google} business={googleBusiness} actors={googleActors} />

      <SourceRecords records={detail.sourceRecords} />

      <MergeHistory merges={merges} context={mergeContext} />
    </div>
  );
}

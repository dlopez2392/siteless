import { unstable_rethrow } from 'next/navigation';
import { Suspense } from 'react';
import { BusinessCards } from '@/components/business-list/business-cards';
import { BusinessFilters } from '@/components/business-list/business-filters';
import { BusinessesShowMore, BusinessTable } from '@/components/business-list/business-table';
import {
  BusinessesEmpty,
  BusinessesNoMatch,
  BusinessesSearchFailed,
} from '@/components/business-list/businesses-empty';
import { BusinessesSkeleton } from '@/components/business-list/businesses-skeleton';
import { orgClaims } from '@/lib/auth/require-org';
import { APP_LOCALE } from '@/lib/time';
import {
  BUSINESSES_COUNT_LINE,
  BUSINESSES_FILTER_LABEL,
  BUSINESSES_FILTER_OPTION,
  BUSINESSES_NO_MATCH_ACTION,
  BUSINESSES_TITLE,
  ERROR_ACTION,
} from '@/lib/ui/copy';
import {
  BUSINESS_PAGE_SIZE,
  listBusinesses,
  type BusinessList,
  type ClusterFilter,
  type ClusterOption,
  type StatusFilter,
} from '@/server/queries/businesses';

export const dynamic = 'force-dynamic';

/**
 * `/businesses` — find one record in a spine of ~92,000 (D-17, 03-UI-SPEC § 3).
 *
 * 🔴 `requireOrg()` IS ALREADY ENFORCED by `src/app/(app)/layout.tsx` (T-2-01). This page
 * reads `orgClaims()` only to scope its own query, and opens exactly ONE `withOrg` — the
 * pool is `max: 1`, so a second transaction opened inside a first waits forever on the
 * connection the outer one holds (02-09 deviation 7). The cluster filter's option list comes
 * back from that SAME `listBusinesses` call rather than from a second read.
 *
 * 🔴 ONLY THE ROWS SUSPEND. The heading, the search field and both filters render outside
 * the `Suspense` boundary, as real interactive controls, on first paint and on every search.
 * The boundary is KEYED on the search and the filters — a new search shows row skeletons —
 * but NOT on `limit`, so "Show 50 more" is a transition over an already-revealed boundary:
 * the rows on screen stay exactly where they are until the longer page arrives.
 *
 * 🔴 STATE LIVES IN THE URL (`q`, `cluster`, `status`, `limit`), so a search is linkable and
 * survives a refresh. Every value is parsed defensively here — the URL is user input — and
 * the query text only ever reaches SQL as a bound parameter (T-3-05).
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** The append pager's ceiling: `listBusinesses` answers at most 500 rows per request
 *  (`MAX_LIMIT` in `src/server/queries/businesses.ts`). Past it the count line still says
 *  how many exist and the search is the way in. */
const MAX_ROWS = 500;
const MAX_QUERY_LENGTH = 200;
const CLUSTER_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const STATUSES: ReadonlySet<string> = new Set(['active', 'closed', 'merged_away']);

type ListParams = {
  query: string;
  cluster: ClusterFilter;
  status: StatusFilter;
  limit: number;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseParams(sp: SearchParams): ListParams {
  const query = (first(sp.q) ?? '').trim().slice(0, MAX_QUERY_LENGTH);

  const rawCluster = first(sp.cluster);
  const cluster: ClusterFilter =
    rawCluster === 'none'
      ? { kind: 'none' }
      : rawCluster !== undefined && rawCluster !== 'any' && CLUSTER_KEY.test(rawCluster)
        ? { kind: 'key', key: rawCluster }
        : { kind: 'any' };

  const rawStatus = first(sp.status);
  const status: StatusFilter =
    rawStatus !== undefined && STATUSES.has(rawStatus) ? (rawStatus as StatusFilter) : 'any';

  const rawLimit = Number.parseInt(first(sp.limit) ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_ROWS, Math.max(BUSINESS_PAGE_SIZE, rawLimit))
    : BUSINESS_PAGE_SIZE;

  return { query, cluster, status, limit };
}

type Listing = { ok: true; list: BusinessList } | { ok: false };

/**
 * The one read. A database failure becomes `{ ok: false }` so the rows region can say
 * "Your query is still in the box — nothing was lost" instead of an error boundary
 * replacing the whole screen, box included. Navigation signals (the auth redirect) are
 * rethrown untouched.
 */
async function loadListing(params: ListParams): Promise<Listing> {
  const claims = await orgClaims();
  try {
    const list = await listBusinesses(claims, {
      query: params.query,
      cluster: params.cluster,
      status: params.status,
      limit: params.limit,
    });
    return { ok: true, list };
  } catch (error) {
    unstable_rethrow(error);
    console.error('[businesses] list read failed', error);
    return { ok: false };
  }
}

/** Counts in the pinned locale, never the environment's. */
const counts = new Intl.NumberFormat(APP_LOCALE);

function PageHeading() {
  return <h1 className="text-xl font-semibold leading-tight">{BUSINESSES_TITLE}</h1>;
}

/** The URL value of a cluster filter — `none` for "No cluster mapped", else the key. */
function clusterParam(cluster: ClusterFilter): string | null {
  if (cluster.kind === 'none') return 'none';
  if (cluster.kind === 'key') return cluster.key;
  return null;
}

/** `/businesses` with only the given parameters; "any" and empty values are left out. */
function listHref(parts: { q?: string; cluster?: string | null; status?: StatusFilter }): string {
  const sp = new URLSearchParams();
  if (parts.q) sp.set('q', parts.q);
  if (parts.cluster) sp.set('cluster', parts.cluster);
  if (parts.status && parts.status !== 'any') sp.set('status', parts.status);
  const qs = sp.toString();
  return qs === '' ? '/businesses' : `/businesses?${qs}`;
}

/** The filters' own words, for the no-match heading when no text was typed — the cluster's
 *  display name, never its key (CONVENTIONS § Naming). */
function filterSummary(params: ListParams, clusters: ClusterOption[]): string {
  const parts: string[] = [];
  if (params.cluster.kind === 'none') parts.push(BUSINESSES_FILTER_OPTION.noClusterMapped);
  else if (params.cluster.kind === 'key') {
    const key = params.cluster.key;
    parts.push(clusters.find((c) => c.key === key)?.displayName ?? BUSINESSES_FILTER_LABEL.cluster);
  }
  if (params.status === 'active') parts.push(BUSINESSES_FILTER_OPTION.active);
  else if (params.status === 'closed') parts.push(BUSINESSES_FILTER_OPTION.closed);
  else if (params.status === 'merged_away') parts.push(BUSINESSES_FILTER_OPTION.mergedAway);
  return parts.join(' · ');
}

async function BusinessRows({
  listing,
  params,
}: {
  listing: Promise<Listing>;
  params: ListParams;
}) {
  const result = await listing;
  const cluster = clusterParam(params.cluster);

  if (!result.ok) {
    // Keep the typed query, drop the filters — "clear the filters and search the name on
    // its own" (03-UI-SPEC § Error).
    return <BusinessesSearchFailed clearFiltersHref={listHref({ q: params.query })} />;
  }

  const { rows, total, clusters } = result.list;

  if (total === 0) {
    const filtered = cluster !== null || params.status !== 'any';
    if (params.query !== '') {
      return (
        <BusinessesNoMatch
          quoted={params.query}
          actionHref={listHref({ cluster, status: params.status })}
          actionLabel={BUSINESSES_NO_MATCH_ACTION}
        />
      );
    }
    if (filtered) {
      return (
        <BusinessesNoMatch
          quoted={filterSummary(params, clusters)}
          actionHref={listHref({})}
          actionLabel={ERROR_ACTION.clearFilters}
        />
      );
    }
    return <BusinessesEmpty />;
  }

  // Another 50 exist and the request was not already clamped by the query module.
  const canShowMore =
    rows.length < total && rows.length === params.limit && rows.length < MAX_ROWS;

  return (
    <div className="flex flex-col gap-4">
      <p
        data-testid="businesses-count"
        className="text-sm font-normal tabular-nums text-muted-foreground"
      >
        {BUSINESSES_COUNT_LINE(
          total,
          rows.length,
          counts.format(total),
          counts.format(rows.length),
        )}
      </p>

      <BusinessTable rows={rows} />
      <BusinessCards rows={rows} />

      {canShowMore ? (
        <div className="flex justify-center sm:justify-start">
          <BusinessesShowMore nextLimit={Math.min(MAX_ROWS, rows.length + BUSINESS_PAGE_SIZE)} />
        </div>
      ) : null}
    </div>
  );
}

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = parseParams(await searchParams);

  // Started here, awaited in two places: the rows region reads the page, and the filters
  // read the cluster names off the same result. One promise, one `withOrg`.
  const listing = loadListing(params);
  const clusters: Promise<ClusterOption[] | null> = listing.then(
    (r) => (r.ok ? r.list.clusters : null),
    () => null,
  );

  const clusterKey =
    params.cluster.kind === 'key' ? `key:${params.cluster.key}` : params.cluster.kind;
  const rowsKey = `${params.query}\u0000${clusterKey}\u0000${params.status}`;

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageHeading />
      <BusinessFilters clusters={clusters} />
      <Suspense key={rowsKey} fallback={<BusinessesSkeleton />}>
        <BusinessRows listing={listing} params={params} />
      </Suspense>
    </div>
  );
}

import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { Suspense } from 'react';
import { BusinessFilters } from '@/components/business-list/business-filters';
import { BusinessesSkeleton } from '@/components/business-list/businesses-skeleton';
import { orgClaims } from '@/lib/auth/require-org';
import { APP_LOCALE } from '@/lib/time';
import { BUSINESSES_COUNT_LINE, BUSINESSES_TITLE } from '@/lib/ui/copy';
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

async function BusinessRows({ listing }: { listing: Promise<Listing> }) {
  const result = await listing;
  if (!result.ok) return null;
  const { rows, total } = result.list;

  return (
    <div className="flex flex-col gap-4">
      <p
        data-testid="businesses-count"
        aria-live="polite"
        className="text-sm font-normal tabular-nums text-muted-foreground"
      >
        {BUSINESSES_COUNT_LINE(
          total,
          rows.length,
          counts.format(total),
          counts.format(rows.length),
        )}
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} data-testid={`businesses-row-${row.id}`}>
            <Link href={`/businesses/${row.id}`}>{row.displayName}</Link>
          </li>
        ))}
      </ul>
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
        <BusinessRows listing={listing} />
      </Suspense>
    </div>
  );
}

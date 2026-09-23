import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { isUuid } from '@/lib/ids';
import { instantOf, requireInstant } from '@/lib/instant';
import { HOST_CLASSES, type HostClass } from '@/lib/places/host-class';
import { rowsOf, type Tx } from './budget';
import { spineSourceOf, type ChainFlag, type SpineSourceKey } from './review-queue';

/**
 * `/businesses` and `/businesses/[id]` (03-UI-SPEC §§ 3–4, D-17 / D-18 / D-19 / D-20).
 *
 * 🔴 ONE TRANSACTION PER REQUEST, NEVER NESTED. `src/db/client.ts` pools with `max: 1`: a second
 * `withOrg` opened inside a first waits forever on the connection the outer one holds, so the
 * request HANGS rather than failing. The detail page needs the business, its source records,
 * its merge history and its aliases — `readBusinessDetail` reads all four inside the ONE
 * transaction `getBusinessDetail` opens. No `read*` below opens a transaction of its own.
 *
 * 🔴 THE INTERNAL COLUMNS ARE NEVER SELECTED: the operator annotation, the normalized match
 * keys (name, street), the phone-blockability flag and the chain key (which IS the normalized
 * name). Not "selected and then dropped" — absent from every SELECT list in this file, so no
 * refactor that spreads a row can carry one into a payload (T-3-11,
 * tests/db/provenance-render.test.ts asserts the key set).
 *
 * 🔴 `legal_name` AND `display_name` ARE NEVER INTERCHANGEABLE. Each is its own field with its
 * own provenance; neither is a fallback for the other here.
 *
 * 🔴 THE ONE PLACE THE ACCENT-FOLDING FUNCTION IS PERMITTED UNDER `src/`: the free-text search
 * predicate in `readBusinessList`, over a BOUND parameter (T-3-05). It compares what a person
 * typed with what a source spelled, and neither side is a match key — so it is not the blocking
 * parity problem `tests/unit/sql-never-normalizes.test.ts` exists for, and that test allow-lists
 * this exact path.
 *
 * 🔴 AN UNKNOWN ID AND A FOREIGN ID ARE THE SAME ANSWER: `null`, and the page calls `notFound()`.
 * RLS already confined the read to the caller's org; saying which of the two it was would
 * confirm to a wrong-tenant caller that the row exists (T-3-09).
 */

// ---------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------

/** 50 rows per page, then "Show 50 more" (03-UI-SPEC § 3). */
export const BUSINESS_PAGE_SIZE = 50;

/** Hard ceiling on one request, however large a `limit` a URL asks for. */
const MAX_LIMIT = 500;

export type BusinessStatusView = 'active' | 'closed' | 'merged_away';

export type ClusterFilter = { kind: 'any' } | { kind: 'none' } | { kind: 'key'; key: string };

export type StatusFilter = 'any' | BusinessStatusView;

export type BusinessListParams = {
  query?: string | null;
  cluster?: ClusterFilter;
  status?: StatusFilter;
  limit?: number;
  offset?: number;
};

export type BusinessListRow = {
  id: string;
  displayName: string;
  city: string | null;
  /** `industry_clusters.display_name`; null is the D-02 "No cluster mapped" state. */
  clusterName: string | null;
  /** Every durable source present, in the fixed ledger order. Rendered as muted text. */
  sources: SpineSourceKey[];
  status: BusinessStatusView;
  closedAt: Date | null;
};

/** A filter option. The key is a URL value, never rendered; the display name is the label. */
export type ClusterOption = { key: string; displayName: string };

export type BusinessList = {
  rows: BusinessListRow[];
  /** Every business matching the filters — the `{n}` of the count line. */
  total: number;
  clusters: ClusterOption[];
};

/** `%`, `_` and `\` in what a person typed are literal characters, not `ilike` wildcards. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => '\\' + c);
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

const SOURCE_ORDER: readonly SpineSourceKey[] = [
  'tx_comptroller',
  'tx_comptroller_closures',
  'overture',
  'census_geocoder',
];

function sourcesOf(csv: string | null): SpineSourceKey[] {
  if (csv === null || csv === '') return [];
  const present = new Set(csv.split(','));
  return SOURCE_ORDER.filter((k) => present.has(k));
}

function statusOf(mergedIntoId: string | null, closedMs: string | null): BusinessStatusView {
  if (mergedIntoId !== null) return 'merged_away';
  if (closedMs !== null) return 'closed';
  return 'active';
}

function listPredicate(params: BusinessListParams): SQL {
  const conds: SQL[] = [sql`b.org_id = (select app.current_org_id())`];

  const raw = (params.query ?? '').trim();
  if (raw !== '') {
    const pattern = likeEscape(raw);
    conds.push(sql`(
         unaccent(b.display_name) ilike unaccent('%' || ${pattern} || '%')
      or unaccent(coalesce(b.legal_name, '')) ilike unaccent('%' || ${pattern} || '%')
      or b.external_key = upper(${raw})
    )`);
  }

  const cluster = params.cluster ?? { kind: 'any' };
  if (cluster.kind === 'none') conds.push(sql`b.cluster_key is null`);
  else if (cluster.kind === 'key') conds.push(sql`b.cluster_key = ${cluster.key}`);

  const status = params.status ?? 'any';
  if (status === 'active') conds.push(sql`b.merged_into_id is null and b.closed_at is null`);
  else if (status === 'closed') conds.push(sql`b.merged_into_id is null and b.closed_at is not null`);
  else if (status === 'merged_away') conds.push(sql`b.merged_into_id is not null`);

  return sql.join(conds, sql` and `);
}

/** Every cluster this org can see — its own rows override a built-in with the same key. */
export async function readClusterOptions(tx: Tx): Promise<ClusterOption[]> {
  const rows = rowsOf<{ key: string; display_name: string }>(
    await tx.execute(sql`
      select o.key, o.display_name
        from (select distinct on (ic.key) ic.key, ic.display_name, ic.sort_order
                from industry_clusters ic
               order by ic.key, ic.org_id nulls last) o
       order by o.sort_order, o.key`),
  );
  return rows.map((r) => ({ key: r.key, displayName: r.display_name }));
}

export async function readBusinessList(
  tx: Tx,
  params: BusinessListParams = {},
): Promise<BusinessList> {
  const where = listPredicate(params);
  const limit = clampInt(params.limit, BUSINESS_PAGE_SIZE, 1, MAX_LIMIT);
  const offset = clampInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const total =
    rowsOf<{ total: number }>(
      await tx.execute(sql`select count(*)::int as total from businesses b where ${where}`),
    )[0]?.total ?? 0;

  // The page first, then its source records in ONE join: `source_records` has no index on
  // `business_id`, so a per-row lateral would scan it once per row.
  //
  // 🔴 `srcs` MUST BE `materialized`. It is referenced once, so Postgres (12+) otherwise
  // INLINES it into the per-row `string_agg` subplan and pushes `business_id = p.id` down —
  // recreating exactly the per-row scan the comment above exists to avoid. Measured on the
  // local spine (91,872 businesses, 141,242 source records, as `authenticated` under RLS,
  // 03-18): 50 rows 5.6 s → 167 ms, 500 rows 49 s → 270 ms, results byte-identical.
  const rows = rowsOf<{
    id: string;
    display_name: string;
    city: string | null;
    cluster_name: string | null;
    merged_into_id: string | null;
    closed_ms: string | null;
    source_keys: string | null;
  }>(
    await tx.execute(sql`
      with page as (
        select b.id, b.org_id, b.display_name, b.city, b.cluster_key, b.comptroller_key,
               b.merged_into_id, b.closed_at
          from businesses b
         where ${where}
         order by b.display_name, b.id
         limit ${limit} offset ${offset}
      ),
      -- 🔴 A-WR-09 (review 03): a row's sources are its CLUSTER's — the row plus every
      -- business merged into it (clusters are flattened: one hop), exactly the membership the
      -- detail view reads. Without it a merged winner listed "Comptroller" here while its own
      -- detail page said "Comptroller · Overture" (D-17). A merged-away row has no members
      -- but itself. The member test is "id = p.id or merged_into_id = p.id", which
      -- businesses_merged_idx serves.
      members as materialized (
        select p.id as business_id, m.id as member_id, m.comptroller_key
          from page p
          join businesses m
            on m.org_id = p.org_id and (m.id = p.id or m.merged_into_id = p.id)
      ),
      srcs as materialized (
        select mb.business_id, sr.source_key
          from members mb
          join source_records sr on sr.business_id = mb.member_id
         where sr.retention_class = 'durable'
        union
        select mb.business_id, sr.source_key
          from members mb
          join source_records sr
            on sr.org_id = (select app.current_org_id())
           and sr.source_key in ('census_geocoder', 'tx_comptroller_closures')
           and sr.external_id = mb.comptroller_key
         where mb.comptroller_key is not null
           and sr.retention_class = 'durable'
      )
      select p.id,
             p.display_name,
             p.city,
             cl.display_name                                        as cluster_name,
             p.merged_into_id,
             (extract(epoch from p.closed_at) * 1000)::bigint::text as closed_ms,
             (select string_agg(s.source_key, ',') from srcs s where s.business_id = p.id)
                                                                    as source_keys
        from page p
        left join lateral (
          select ic.display_name
            from industry_clusters ic
           where ic.key = p.cluster_key
           order by ic.org_id nulls last
           limit 1
        ) cl on true
       order by p.display_name, p.id`),
  );

  const clusters = await readClusterOptions(tx);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      city: r.city,
      clusterName: r.cluster_name,
      sources: sourcesOf(r.source_keys),
      status: statusOf(r.merged_into_id, r.closed_ms),
      closedAt: instantOf(r.closed_ms),
    })),
    total,
    clusters,
  };
}

export async function listBusinesses(
  claims: OrgClaims,
  params: BusinessListParams = {},
): Promise<BusinessList> {
  return withOrg(claims, (tx) => readBusinessList(tx, params));
}

// ---------------------------------------------------------------------------------------
// The detail
// ---------------------------------------------------------------------------------------

/**
 * One D-18 row: `label · value · source tag`.
 *
 * 🔴 THE ABSENCE OF A SOURCE IS NOT THE ABSENCE OF A VALUE. `value` and `sourceRecordId` are
 * independent: a field can carry a value no durable record cites (`provenance: 'none'`, value
 * set) as well as no value at all. The UI renders `provenance === 'none'` as the tag
 * "No durable source" and a null value as "Not stored" — the honest rendering of CONVENTIONS
 * § Retention, where a field whose only source is a Google payload cannot be set at all.
 *
 *  - `cited`   — the business's `*_source_id` names a durable source record; `source` is its key.
 *  - `derived` — the column has no provenance pair by design (survivorship.ts: category,
 *                cluster, confidence are derived, not sourced). `source` names the only source
 *                kind that carries the value; `sourceRecordId` is always null.
 *  - `none`    — nothing durable supplied it.
 */
export type FieldView<T> = {
  value: T | null;
  provenance: 'cited' | 'derived' | 'none';
  source: SpineSourceKey | null;
  sourceRecordId: string | null;
};

export type BusinessFields = {
  displayName: FieldView<string>;
  legalName: FieldView<string>;
  phone: FieldView<string>;
  address: FieldView<{ street: string | null; unit: string | null }>;
  cityZip: FieldView<{ city: string | null; postal: string | null }>;
  location: FieldView<{ lat: number; lng: number; matchType: string | null }>;
  category: FieldView<{ basicCategory: string | null; clusterName: string | null }>;
  overtureConfidence: FieldView<number>;
  /** Floating dates as the Comptroller publishes them ('YYYY-MM-DD'), not instants. */
  permitDates: FieldView<{ issued: string | null; firstSales: string | null }>;
  closedOn: FieldView<Date>;
};

export type SourceRecordRow = {
  id: string;
  sourceKey: SpineSourceKey | null;
  sourceVersion: string | null;
  externalId: string | null;
  /** The business this record created — differs from the detail's id for a merged parent. */
  businessId: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  /** D-05: a later complete run of this source did not see it (`gone`). */
  stale: boolean;
};

export type MergeHistoryRow = {
  id: string;
  winnerId: string;
  winnerName: string;
  winnerKey: string;
  loserId: string;
  loserName: string;
  loserKey: string;
  /** `businesses.primary_source` of each side (a source key, or null). With the key it tells
   *  two same-name records apart in the merge history (03-22). */
  winnerSource: string | null;
  loserSource: string | null;
  reason: 'auto' | 'review';
  score: number | null;
  /** Who merged: a Clerk user id, or the desk actor (`etl:resolve`). */
  mergedBy: string;
  mergedAt: Date;
  undoneBy: string | null;
  undoneAt: Date | null;
};

export type AliasRow = {
  externalKey: string;
  /** Where the key resolves today. */
  businessId: string;
  /** The business the key was minted for. */
  sourceBusinessId: string;
  releasedAt: Date | null;
};

/**
 * "Google Maps check" (04-UI-SPEC § Screen 5; D-05, D-08, D-10). Instants are epoch ms.
 *
 *   * `signal` — the BUSINESS-LEVEL value from `business_place_signal`: attached listings only,
 *     true if any attached listing's latest observation lists a website (D-08). Null when no
 *     listing is attached (tentative and rejected ones are never a verdict input).
 *   * `listings` — every listing, attached (newest observation first) → tentative (highest score
 *     first) → rejected/detached (most recently decided first). `latest` is what exists; whether
 *     a tentative listing's website sentence is SHOWN is the screen's rule, not this read's.
 *   * `history` — every observation (D-10's append-only rows), newest first, with its run.
 *
 * 🔴 RULE 32 / T-4-04: NEVER A COORDINATE. The Places coordinate table is not named anywhere in
 * this module — a test scans the source for its name (authenticated holds no grant on it anyway,
 * 0027) — and nothing Google-authored exists to select: an observation is a boolean, a host
 * class, a SKU and a time (D-09).
 */
export type GoogleCheckView = {
  signal: { hadWebsiteUri: boolean; hostClass: HostClass; observedMs: number } | null;
  listings: Array<{
    attachmentId: string;
    placeId: string;
    status: 'attached' | 'tentative' | 'rejected';
    /** `score` | `tie` | `confirmed` | `rejected` | `detached` (pa_reason_known). */
    reason: string;
    score: number;
    tieBusinessId: string | null;
    /** A Clerk user id, or the desk actor. */
    decidedBy: string | null;
    decidedMs: number | null;
    latest: { hadWebsiteUri: boolean; hostClass: HostClass; observedMs: number; runId: string } | null;
  }>;
  history: Array<{
    observationId: string;
    placeId: string;
    observedMs: number;
    hadWebsiteUri: boolean;
    hostClass: HostClass;
    runId: string;
  }>;
};

export type BusinessDetail = {
  id: string;
  /** The lead key (`SL-7F3K2`). Display-only — never a route parameter or a foreign key. */
  externalKey: string;
  status: BusinessStatusView;
  /** Set when this record was merged away; the page links to the survivor. */
  mergedInto: { id: string; displayName: string } | null;
  operatingStatus: string | null;
  chain: ChainFlag | null;
  fields: BusinessFields;
  sourceRecords: SourceRecordRow[];
  merges: MergeHistoryRow[];
  aliases: AliasRow[];
  /** 04-21: the Places-derived signal and its history, read in the same transaction. */
  google: GoogleCheckView;
};

type DetailRow = {
  id: string;
  external_key: string;
  display_name: string;
  legal_name: string | null;
  phone_e164: string | null;
  street: string | null;
  unit: string | null;
  city: string | null;
  postal: string | null;
  lat: number | null;
  lng: number | null;
  location_match_type: string | null;
  basic_category: string | null;
  cluster_name: string | null;
  confidence: number | null;
  operating_status: string | null;
  primary_source: string | null;
  merged_into_id: string | null;
  merged_into_name: string | null;
  closed_ms: string | null;
  display_name_source_id: string | null;
  display_name_source: string | null;
  legal_name_source_id: string | null;
  legal_name_source: string | null;
  permit_issue_date: string | null;
  first_sales_date: string | null;
  phone_source_id: string | null;
  phone_source: string | null;
  address_source_id: string | null;
  address_source: string | null;
  location_source_id: string | null;
  location_source: string | null;
  closed_at_source_id: string | null;
  closed_at_source: string | null;
  chain_members: number | null;
  chain_statewide: boolean | null;
};

function cited<T>(value: T | null, sourceRecordId: string | null, sourceKey: string | null): FieldView<T> {
  if (sourceRecordId === null) return { value, provenance: 'none', source: null, sourceRecordId: null };
  return { value, provenance: 'cited', source: spineSourceOf(sourceKey), sourceRecordId };
}

function derived<T>(value: T | null, source: SpineSourceKey | null): FieldView<T> {
  if (value === null || source === null) {
    return { value, provenance: 'none', source: null, sourceRecordId: null };
  }
  return { value, provenance: 'derived', source, sourceRecordId: null };
}

/** A Socrata floating timestamp ('2019-04-01T00:00:00.000') → its calendar date. No zone: it
 *  never was an instant. */
function floatingDate(value: string | null): string | null {
  if (value === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1]! : null;
}

function toFields(r: DetailRow): BusinessFields {
  const permit =
    r.legal_name_source === 'tx_comptroller'
      ? { issued: floatingDate(r.permit_issue_date), firstSales: floatingDate(r.first_sales_date) }
      : null;
  const hasPermit = permit !== null && (permit.issued !== null || permit.firstSales !== null);

  const addressValue =
    r.street === null && r.unit === null ? null : { street: r.street, unit: r.unit };
  const cityZipValue = r.city === null && r.postal === null ? null : { city: r.city, postal: r.postal };
  const locationValue =
    r.lat === null || r.lng === null
      ? null
      : { lat: r.lat, lng: r.lng, matchType: r.location_match_type };
  const categoryValue =
    r.basic_category === null && r.cluster_name === null
      ? null
      : { basicCategory: r.basic_category, clusterName: r.cluster_name };
  // Only an Overture record carries `basic_category` and `confidence` (survivorship.ts'
  // sourceRecordView). A cluster with no category was mapped from the Comptroller NAICS code
  // at ingest, so the record's own creating source is what supplied it.
  const categorySource: SpineSourceKey | null =
    r.basic_category !== null ? 'overture' : spineSourceOf(r.primary_source);

  return {
    displayName: cited(r.display_name, r.display_name_source_id, r.display_name_source),
    legalName: cited(r.legal_name, r.legal_name_source_id, r.legal_name_source),
    phone: cited(r.phone_e164, r.phone_source_id, r.phone_source),
    address: cited(addressValue, r.address_source_id, r.address_source),
    cityZip: cited(cityZipValue, r.address_source_id, r.address_source),
    location: cited(locationValue, r.location_source_id, r.location_source),
    category: derived(categoryValue, categorySource),
    overtureConfidence: derived(r.confidence, r.confidence === null ? null : 'overture'),
    permitDates: hasPermit
      ? cited(permit, r.legal_name_source_id, r.legal_name_source)
      : { value: null, provenance: 'none', source: null, sourceRecordId: null },
    closedOn: cited(instantOf(r.closed_ms), r.closed_at_source_id, r.closed_at_source),
  };
}

export async function readBusinessDetail(tx: Tx, id: string): Promise<BusinessDetail | null> {
  // A non-uuid would be a 22P02 from the cast, not an answer. Same answer as unknown.
  if (typeof id !== 'string' || !isUuid(id)) return null;

  const row = rowsOf<DetailRow>(
    await tx.execute(sql`
      with statewide_run as (
        select r.stats -> 'statewide_name_frequency' as f
          from ingest_runs r
         where r.org_id = (select app.current_org_id())
           and r.source_key = 'tx_comptroller'
           and r.status = 'complete'
           and jsonb_typeof(r.stats -> 'statewide_name_frequency') = 'object'
         order by r.started_at desc nulls last, r.id desc
         limit 1
      )
      select b.id,
             b.external_key,
             b.display_name,
             b.legal_name,
             b.phone_e164,
             b.street,
             b.unit,
             b.city,
             b.postal,
             b.lat,
             b.lng,
             b.location_match_type,
             b.basic_category,
             cl.display_name                                         as cluster_name,
             b.confidence,
             b.operating_status,
             b.primary_source,
             b.merged_into_id,
             w.display_name                                          as merged_into_name,
             (extract(epoch from b.closed_at) * 1000)::bigint::text  as closed_ms,
             b.display_name_source_id,
             dn.source_key                                           as display_name_source,
             b.legal_name_source_id,
             ln.source_key                                           as legal_name_source,
             ln.payload ->> 'outlet_permit_issue_date'               as permit_issue_date,
             ln.payload ->> 'outlet_first_sales_date'                as first_sales_date,
             b.phone_source_id,
             ph.source_key                                           as phone_source,
             b.address_source_id,
             ad.source_key                                           as address_source,
             b.location_source_id,
             lo.source_key                                           as location_source,
             b.closed_at_source_id,
             ca.source_key                                           as closed_at_source,
             ch.members                                              as chain_members,
             ch.statewide                                            as chain_statewide
        from businesses b
        left join businesses w      on w.id  = b.merged_into_id
        left join source_records dn on dn.id = b.display_name_source_id
        left join source_records ln on ln.id = b.legal_name_source_id
        left join source_records ph on ph.id = b.phone_source_id
        left join source_records ad on ad.id = b.address_source_id
        left join source_records lo on lo.id = b.location_source_id
        left join source_records ca on ca.id = b.closed_at_source_id
        left join lateral (
          select ic.display_name
            from industry_clusters ic
           where ic.key = b.cluster_key
           order by ic.org_id nulls last
           limit 1
        ) cl on true
        left join lateral (
          select coalesce(sw.n, lc.n)::int as members, sw.n is not null as statewide
            from (select ((select f from statewide_run) ->> b.chain_key)::int as n) sw,
                 (select count(*)::int as n
                    from businesses m
                   where m.org_id = b.org_id
                     and m.chain_key = b.chain_key
                     and m.merged_into_id is null) lc
           where b.chain_key is not null
        ) ch on true
       where b.id = ${id}`),
  )[0];
  if (!row) return null;

  // The records that built this business: its own, those of every business merged INTO it
  // (their losing values stay on their parents, D-14), and the Census / closure records keyed
  // by any of those businesses' Comptroller key (03-12 keys both that way).
  const sourceRows = rowsOf<{
    id: string;
    source_key: string;
    source_version: string | null;
    external_id: string | null;
    business_id: string | null;
    first_ms: string | null;
    last_seen_ms: string | null;
    stale: boolean;
  }>(
    await tx.execute(sql`
      with members as (
        select m.id, m.comptroller_key
          from businesses m
         where m.org_id = (select app.current_org_id())
           and (m.id = ${id} or m.merged_into_id = ${id})
      )
      select sr.id,
             sr.source_key,
             sr.source_version,
             sr.external_id,
             sr.business_id,
             (extract(epoch from sr.fetched_at)   * 1000)::bigint::text as first_ms,
             (extract(epoch from sr.last_seen_at) * 1000)::bigint::text as last_seen_ms,
             (sr.last_seen_at is not null and exists (
                select 1 from ingest_runs r
                 where r.org_id = sr.org_id
                   and r.source_key = sr.source_key
                   and r.status = 'complete'
                   and r.started_at > sr.last_seen_at)) as stale
        from source_records sr
       where sr.org_id = (select app.current_org_id())
         and sr.retention_class = 'durable'
         and (sr.business_id in (select id from members)
              or (sr.source_key in ('census_geocoder', 'tx_comptroller_closures')
                  and sr.external_id in (select comptroller_key from members
                                          where comptroller_key is not null)))
       order by case sr.source_key
                  when 'tx_comptroller' then 1
                  when 'tx_comptroller_closures' then 2
                  when 'overture' then 3
                  when 'census_geocoder' then 4
                  else 5 end,
                sr.fetched_at, sr.id`),
  );

  const mergeRows = rowsOf<{
    id: string;
    winner_id: string;
    winner_name: string;
    winner_key: string;
    loser_id: string;
    loser_name: string;
    loser_key: string;
    winner_source: string | null;
    loser_source: string | null;
    reason: 'auto' | 'review';
    score: number | null;
    merged_by: string;
    merged_ms: string;
    undone_by: string | null;
    undone_ms: string | null;
  }>(
    await tx.execute(sql`
      select m.id,
             m.winner_id,
             w.display_name as winner_name,
             w.external_key as winner_key,
             m.loser_id,
             l.display_name as loser_name,
             l.external_key as loser_key,
             w.primary_source as winner_source,
             l.primary_source as loser_source,
             m.reason,
             m.score,
             m.merged_by,
             (extract(epoch from m.merged_at) * 1000)::bigint::text as merged_ms,
             m.undone_by,
             (extract(epoch from m.undone_at) * 1000)::bigint::text as undone_ms
        from business_merges m
        join businesses w on w.id = m.winner_id
        join businesses l on l.id = m.loser_id
       where m.org_id = (select app.current_org_id())
         and (m.winner_id = ${id} or m.loser_id = ${id})
       order by m.merged_at desc, m.id desc`),
  );

  const aliasRows = rowsOf<{
    external_key: string;
    business_id: string;
    source_business_id: string;
    released_ms: string | null;
  }>(
    await tx.execute(sql`
      select a.external_key,
             a.business_id,
             a.source_business_id,
             (extract(epoch from a.released_at) * 1000)::bigint::text as released_ms
        from business_aliases a
       where a.org_id = (select app.current_org_id())
         and (a.business_id = ${id} or a.source_business_id = ${id})
       order by a.external_key, a.released_at nulls first`),
  );

  return {
    id: row.id,
    externalKey: row.external_key,
    status: statusOf(row.merged_into_id, row.closed_ms),
    mergedInto:
      row.merged_into_id === null
        ? null
        : { id: row.merged_into_id, displayName: row.merged_into_name ?? '' },
    operatingStatus: row.operating_status,
    chain:
      row.chain_members === null
        ? null
        : { members: row.chain_members, statewide: row.chain_statewide === true },
    fields: toFields(row),
    sourceRecords: sourceRows.map((s) => ({
      id: s.id,
      sourceKey: spineSourceOf(s.source_key),
      sourceVersion: s.source_version,
      externalId: s.external_id,
      businessId: s.business_id,
      firstSeenAt: instantOf(s.first_ms),
      lastSeenAt: instantOf(s.last_seen_ms),
      stale: s.stale === true,
    })),
    merges: mergeRows.map((m) => ({
      id: m.id,
      winnerId: m.winner_id,
      winnerName: m.winner_name,
      winnerKey: m.winner_key,
      loserId: m.loser_id,
      loserName: m.loser_name,
      loserKey: m.loser_key,
      winnerSource: m.winner_source,
      loserSource: m.loser_source,
      reason: m.reason,
      score: m.score,
      mergedBy: m.merged_by,
      mergedAt: requireInstant(m.merged_ms, 'business_merges.merged_at'),
      undoneBy: m.undone_by,
      undoneAt: instantOf(m.undone_ms),
    })),
    aliases: aliasRows.map((a) => ({
      externalKey: a.external_key,
      businessId: a.business_id,
      sourceBusinessId: a.source_business_id,
      releasedAt: instantOf(a.released_ms),
    })),
    // Inside this same transaction — getBusinessDetail stays ONE withOrg.
    google: await readGoogleCheck(tx, row.id),
  };
}

/** An epoch-ms text column (`(extract(epoch …) * 1000)::bigint::text`) → a number. */
function msOf(value: string, what: string): number {
  const ms = Number(value);
  if (!Number.isFinite(ms)) throw new Error(`readGoogleCheck: ${what} is not an instant`);
  return ms;
}

function hostClassOf(value: string): HostClass {
  // po_host_class_known (0026) holds the column to exactly these; anything else is a bug.
  if (!(HOST_CLASSES as readonly string[]).includes(value)) {
    throw new Error('readGoogleCheck: unknown host class');
  }
  return value as HostClass;
}

/**
 * The "Google Maps check" read (see `GoogleCheckView`). Reads `business_place_signal`,
 * `place_attachments` and `place_observations` ONLY — three statements in the caller's
 * transaction, RLS-scoped, so another org's business is the same empty check as one with no
 * listing. Never opens a transaction of its own.
 */
export async function readGoogleCheck(tx: Tx, businessId: string): Promise<GoogleCheckView> {
  const empty: GoogleCheckView = { signal: null, listings: [], history: [] };
  if (typeof businessId !== 'string' || !isUuid(businessId)) return empty;

  const signalRow = rowsOf<{ had_website_uri: boolean; host_class: string; observed_ms: string }>(
    await tx.execute(sql`
      select s.had_website_uri,
             s.host_class,
             (extract(epoch from s.observed_at) * 1000)::bigint::text as observed_ms
        from business_place_signal s
       where s.org_id = (select app.current_org_id())
         and s.business_id = ${businessId}`),
  )[0];

  const listingRows = rowsOf<{
    id: string;
    place_id: string;
    status: 'attached' | 'tentative' | 'rejected';
    reason: string;
    score: number;
    tie_business_id: string | null;
    decided_by: string | null;
    decided_ms: string | null;
    latest_had_website_uri: boolean | null;
    latest_host_class: string | null;
    latest_ms: string | null;
    latest_run_id: string | null;
  }>(
    await tx.execute(sql`
      select a.id,
             a.place_id,
             a.status,
             a.reason,
             a.score,
             a.tie_business_id,
             a.decided_by,
             (extract(epoch from a.decided_at) * 1000)::bigint::text as decided_ms,
             o.had_website_uri                                        as latest_had_website_uri,
             o.host_class                                             as latest_host_class,
             (extract(epoch from o.observed_at) * 1000)::bigint::text as latest_ms,
             o.run_id                                                 as latest_run_id
        from place_attachments a
        left join lateral (
          select po.had_website_uri, po.host_class, po.observed_at, po.run_id
            from place_observations po
           where po.org_id = a.org_id
             and po.business_id = a.business_id
             and po.place_id = a.place_id
           order by po.observed_at desc, po.id desc
           limit 1
        ) o on true
       where a.org_id = (select app.current_org_id())
         and a.business_id = ${businessId}
       order by case a.status when 'attached' then 1 when 'tentative' then 2 else 3 end,
                case when a.status = 'attached' then o.observed_at end desc nulls last,
                case when a.status = 'tentative' then a.score end desc nulls last,
                a.decided_at desc nulls last,
                a.id`),
  );

  const historyRows = rowsOf<{
    id: string;
    place_id: string;
    observed_ms: string;
    had_website_uri: boolean;
    host_class: string;
    run_id: string;
  }>(
    await tx.execute(sql`
      select po.id,
             po.place_id,
             (extract(epoch from po.observed_at) * 1000)::bigint::text as observed_ms,
             po.had_website_uri,
             po.host_class,
             po.run_id
        from place_observations po
       where po.org_id = (select app.current_org_id())
         and po.business_id = ${businessId}
       order by po.observed_at desc, po.id desc`),
  );

  return {
    signal: signalRow
      ? {
          hadWebsiteUri: signalRow.had_website_uri === true,
          hostClass: hostClassOf(signalRow.host_class),
          observedMs: msOf(signalRow.observed_ms, 'business_place_signal.observed_at'),
        }
      : null,
    listings: listingRows.map((l) => ({
      attachmentId: l.id,
      placeId: l.place_id,
      status: l.status,
      reason: l.reason,
      score: l.score,
      tieBusinessId: l.tie_business_id,
      decidedBy: l.decided_by,
      decidedMs: l.decided_ms === null ? null : msOf(l.decided_ms, 'place_attachments.decided_at'),
      latest:
        l.latest_ms === null || l.latest_run_id === null || l.latest_host_class === null
          ? null
          : {
              hadWebsiteUri: l.latest_had_website_uri === true,
              hostClass: hostClassOf(l.latest_host_class),
              observedMs: msOf(l.latest_ms, 'place_observations.observed_at'),
              runId: l.latest_run_id,
            },
    })),
    history: historyRows.map((h) => ({
      observationId: h.id,
      placeId: h.place_id,
      observedMs: msOf(h.observed_ms, 'place_observations.observed_at'),
      hadWebsiteUri: h.had_website_uri === true,
      hostClass: hostClassOf(h.host_class),
      runId: h.run_id,
    })),
  };
}

export async function getBusinessDetail(
  claims: OrgClaims,
  id: string,
): Promise<BusinessDetail | null> {
  return withOrg(claims, (tx) => readBusinessDetail(tx, id));
}

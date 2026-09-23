import type { EtlExecutor } from '@/lib/ingest/etl-actor';
import { addressKey, type PhoneKey } from '@/lib/normalize';
import { pickPhone } from '@/lib/overture/transform';
import { closureRowToSourceRecord, type ClosureRow } from '@/lib/socrata/closures';
import type { PermitRow } from '@/lib/socrata/permits';
import {
  comptrollerDerived,
  loadDerivationContext,
  overtureClusterKey,
  type DerivationContext,
} from './derivation';
import {
  survive,
  type LocationMatchType,
  type SourceRecordView,
  type SurvivingFields,
  type SurvivorSourceKey,
} from './survivorship';

/**
 * The TypeScript caller of the three merge definers (drizzle/0024_merge_functions.sql). Used by
 * BOTH `scripts/resolve.ts` (auto, the desk tier) and the review server action (a Clerk user).
 *
 * 🔴 THIS MODULE WRITES NOTHING ITSELF. Every write to `businesses`, `business_merges`,
 * `business_aliases` and `merge_candidates` happens inside `app.record_merge` /
 * `app.undo_merge` / `app.record_candidate_decision`, which read their own org and their own
 * actor. Here we only READ the parents, run `survive()` — the one D-14 function, for both the
 * merge and the unmerge — and hand the result to the definer.
 *
 * 🔴 BOTH TIERS MUST ALREADY HOLD ORG CONTEXT IN THE TRANSACTION. Every read below is scoped
 * `org_id = app.current_org_id()`, which is the org claim and nothing else:
 *   - the desk tier: `setEtlActor` + `resolveEtlOrg` (03-09) in THIS transaction — the owner
 *     connection bypasses RLS, so without the predicate these reads would span tenants;
 *   - the app tier: `withOrg` (real Clerk claims) — RLS applies as well.
 *
 * 🔴 THE EXECUTOR is the narrow pg-style `{ query(text, params) }` (`EtlExecutor`). Every value
 * is a bound parameter; no JS array is ever bound (a JS array in a drizzle `sql` template
 * becomes N placeholders); no `Date` is ever bound; instants come back as epoch text.
 *
 * 🔴 WHY THE RAW IDS, NOT THE ROOTS, ARE PASSED TO `app.record_merge`. This module resolves
 * both sides to their cluster roots to pick the winner and gather the parents, but it hands the
 * definer the caller's ids, oriented. The definer re-points them through
 * `coalesce(merged_into_id, id)` itself, so cluster-awareness lives in the one place a caller
 * cannot skip — and mutation M25 (removing that re-point) is observable by
 * `tests/db/merge-unmerge.test.ts` 'three-way cluster' instead of being masked by this file.
 */

// ---------------------------------------------------------------------------------------
// Parents: a source record's payload → the SourceRecordView survive() reads
// ---------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

function emptyView(id: string, sourceKey: SurvivorSourceKey): SourceRecordView {
  return {
    id,
    sourceKey,
    legalName: null,
    displayName: null,
    phoneE164: null,
    phoneBlockable: false,
    street: null,
    streetNum: null,
    streetNorm: null,
    unit: null,
    postal: null,
    city: null,
    lat: null,
    lng: null,
    locationMatchType: null,
    basicCategory: null,
    clusterKey: null,
    confidence: null,
    operatingStatus: null,
    closedAt: null,
  };
}

/**
 * The phone, picked by THE SAME function the Overture ingest uses (`pickPhone`,
 * src/lib/overture/transform.ts): the first blockable number, else the first dialable one.
 * Calling the ingest's own picker rather than restating it is what keeps the two from
 * drifting (B-WR-04 changed the rule; both sides moved together). 03-13 stores a plain
 * array; the DuckDB `.items` shape is tolerated. Pinned by tests/unit/payload-contract.test.ts.
 */
function firstPhone(p: Json): PhoneKey {
  const phones = p.phones as unknown;
  const list: unknown[] =
    phones && typeof phones === 'object' && Array.isArray((phones as Json).items)
      ? ((phones as Json).items as unknown[])
      : Array.isArray(phones)
        ? phones
        : [p.phone];
  return pickPhone(list.map((raw) => str(raw)));
}

function censusMatchType(p: Json): LocationMatchType | null {
  const raw = str(p.matchType) ?? str(p.match_type) ?? str(p.location_match_type);
  if (raw === 'Exact' || raw === 'census_exact') return 'census_exact';
  if (raw === 'Non_Exact' || raw === 'census_non_exact') return 'census_non_exact';
  return null;
}

/**
 * One stored source record → the fields D-14 reads from it. Pure. The payload is the SELECTED
 * fields the ingest stored (Comptroller: `jrea-zgmq` spelling; Overture: 03-13's selection,
 * with the fixture spelling tolerated; Census: the batch `Match`; closures: `3kx8-uryv`), run
 * through the same shipped normalizers the ingest used, so `survive()` over a business's own
 * parents reproduces what the ingest wrote. A key outside the four returns null and is never a
 * parent (T-3-06: a Google record can never supply a durable field).
 *
 * 🔴 `ctx` CARRIES WHAT THE PAYLOAD DOES NOT (A-CR-03, review 03): the NAICS ranges and the
 * category map a cluster comes from, and the city fold. Without it the view never set
 * `clusterKey`, so survivorship's cluster rule never ran and a merge could drop a business out
 * of the lead funnel. The Comptroller fields come from `comptrollerDerived` and the Overture
 * cluster from `overtureClusterKey` — the functions the ingests write with (derivation.ts).
 */
export function sourceRecordView(
  row: { id: string; source_key: string; payload: unknown },
  ctx: DerivationContext,
): SourceRecordView | null {
  const p: Json =
    row.payload && typeof row.payload === 'object' ? (row.payload as Json) : {};
  switch (row.source_key) {
    case 'tx_comptroller': {
      const v = emptyView(row.id, 'tx_comptroller');
      const name = str(p.outlet_name);
      const d = comptrollerDerived(p as unknown as PermitRow, ctx);
      return {
        ...v,
        legalName: name,
        displayName: name,
        street: d.street,
        streetNum: d.streetNum,
        streetNorm: d.streetNorm,
        unit: d.unit,
        postal: d.postal,
        city: d.city,
        clusterKey: d.clusterKey,
      };
    }
    case 'overture': {
      const v = emptyView(row.id, 'overture');
      const street = str(p.freeform) ?? str(p.street);
      const addr = addressKey(street, str(p.postcode));
      const phone = firstPhone(p);
      const lat = num(p.lat);
      // 03-13 stores `lon` (ST_X); `lng` tolerated. Pinned by payload-contract.test.ts.
      const lng = num(p.lon) ?? num(p.lng);
      return {
        ...v,
        displayName: str(p.name_primary) ?? str(p.name),
        phoneE164: phone.e164,
        phoneBlockable: phone.blockable,
        street,
        streetNum: addr.streetNum,
        streetNorm: addr.streetNorm,
        unit: addr.unit,
        postal: addr.postal,
        city: str(p.locality),
        lat,
        lng,
        locationMatchType: lat !== null && lng !== null ? 'overture' : null,
        basicCategory: str(p.basic_category),
        clusterKey: overtureClusterKey(str(p.basic_category), ctx.categoryMap),
        confidence: num(p.confidence),
        operatingStatus: str(p.operating_status),
      };
    }
    case 'census_geocoder': {
      const v = emptyView(row.id, 'census_geocoder');
      const matchType = censusMatchType(p);
      const lat = num(p.lat);
      const lng = num(p.lng) ?? num(p.lon);
      if (matchType === null || lat === null || lng === null) return v;
      return { ...v, lat, lng, locationMatchType: matchType };
    }
    case 'tx_comptroller_closures': {
      const v = emptyView(row.id, 'tx_comptroller_closures');
      if (typeof p.out_of_business_date !== 'string') return v;
      const closedAt = closureRowToSourceRecord(p as ClosureRow, '').closedAt;
      return {
        ...v,
        legalName: str(p.loc_name),
        closedAt: Number.isFinite(closedAt.getTime()) ? closedAt.toISOString() : null,
      };
    }
    default:
      return null;
  }
}

/**
 * The durable parents of every business in `memberSql` (a SELECT of business ids, scoped to the
 * current org). A source record belongs to a member when it created that member
 * (`business_id`), or when it is a Census / closure record keyed by the member's
 * `comptroller_key` (03-12 keys both by `taxpayer_number-outlet_number`).
 */
async function readParents(
  tx: EtlExecutor,
  memberSql: string,
  params: unknown[],
  ctx?: DerivationContext,
): Promise<SourceRecordView[]> {
  const context = ctx ?? (await loadDerivationContext(tx));
  const { rows } = await tx.query<{ id: string; source_key: string; payload: unknown }>(
    `with members as (${memberSql})
     select sr.id, sr.source_key, sr.payload
       from source_records sr
      where sr.org_id = app.current_org_id()
        and sr.retention_class = 'durable'
        and sr.source_key in ('tx_comptroller','tx_comptroller_closures','overture','census_geocoder')
        and (sr.business_id in (select id from members)
             or (sr.source_key in ('census_geocoder','tx_comptroller_closures')
                 and sr.external_id in (select comptroller_key from members
                                         where comptroller_key is not null)))
      order by sr.id`,
    params,
  );
  const views: SourceRecordView[] = [];
  for (const r of rows) {
    const v = sourceRecordView(r, context);
    if (v) views.push(v);
  }
  return views;
}

/**
 * `SurvivingFields` → the jsonb `app.apply_survivorship` accepts (its fixed column list).
 *
 * Two omissions, each so a merge never writes a NULL no parent asserted:
 *  - no parents at all → `{}` (the business keeps every field; it has nothing to re-derive from)
 *  - no display name → the display_name pair is omitted (the column is NOT NULL)
 * Derived columns appear only when some parent carries a value (see `SurvivingFields.derived`).
 */
export function survivorshipJson(
  s: SurvivingFields,
  parentCount: number,
  opts: {
    /**
     * A FULL re-derivation (scripts/rederive.ts, a re-ingest of a clustered business, the
     * winner side of an unmerge): the parents handed in are EVERY parent the business has, so
     * a derived column no parent carries is NULL, not "keep" — keeping it would leave, say, the
     * basic_category an unmerged Overture loser gave the winner. A merge keeps the old
     * "absent keeps the current value" rule.
     */
    complete?: boolean;
  } = {},
): Record<string, unknown> {
  if (parentCount === 0) return {};
  const out: Record<string, unknown> = {
    legal_name: s.legalName.value,
    legal_name_source_id: s.legalName.sourceId,
    phone_e164: s.phone.e164,
    phone_blockable: s.phone.blockable,
    phone_source_id: s.phone.sourceId,
    street: s.address.street,
    street_num: s.address.streetNum,
    street_norm: s.address.streetNorm,
    unit: s.address.unit,
    postal: s.address.postal,
    city: s.address.city,
    address_source_id: s.address.sourceId,
    lat: s.location.lat,
    lng: s.location.lng,
    location_match_type: s.location.matchType,
    location_source_id: s.location.sourceId,
    closed_at: s.closedAt.value,
    closed_at_source_id: s.closedAt.sourceId,
  };
  if (s.displayName.value !== null) {
    out.display_name = s.displayName.value;
    out.display_name_source_id = s.displayName.sourceId;
  }
  const absent = opts.complete === true ? null : undefined;
  const put = (key: string, v: unknown) => {
    const value = v === undefined ? absent : v;
    if (value !== undefined) out[key] = value;
  };
  put('basic_category', s.derived.basicCategory);
  put('cluster_key', s.derived.clusterKey);
  put('confidence', s.derived.confidence);
  put('operating_status', s.derived.operatingStatus);
  return out;
}

/**
 * Every durable parent of the cluster rooted at `rootId`: the root and every business merged
 * into it (clusters are flattened, so one level is the whole cluster). `id = $1 or
 * merged_into_id = $1` rather than `coalesce(merged_into_id, id) = $1`, so
 * `businesses_merged_idx` serves it (A-IN-02).
 */
export async function readRootParents(
  tx: EtlExecutor,
  rootId: string,
  ctx?: DerivationContext,
): Promise<SourceRecordView[]> {
  return readParents(
    tx,
    `select id, comptroller_key from businesses
      where org_id = app.current_org_id() and (id = $1::uuid or merged_into_id = $1::uuid)`,
    [rootId],
    ctx,
  );
}

// ---------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------

export type MergeReason = 'auto' | 'review';

export interface MergePairInput {
  candidateId: string;
  /** The candidate's two businesses, in either order. The winner is chosen here, not by the caller. */
  leftId: string;
  rightId: string;
  reason: MergeReason;
  score: number;
  features: Record<string, unknown>;
}

export interface MergePairResult {
  /** The `business_merges` id, or null when both sides already resolved to one business. */
  mergeId: string | null;
  winnerId: string;
  loserId: string;
}

/**
 * Merges one candidate pair.
 *
 * 🔴 THE WINNER IS DETERMINISTIC: of the two cluster roots, the business with the older
 * `created_at`, ties broken by the smaller `id` — so a re-run of the resolve pass picks the
 * same winner, and the winner is the record whose external key is most likely already out in
 * the world (BIS, a CSV export).
 */
export async function mergePair(tx: EtlExecutor, input: MergePairInput): Promise<MergePairResult> {
  const { rows: sides } = await tx.query<{ id: string; root: string }>(
    `select b.id, coalesce(b.merged_into_id, b.id) as root
       from businesses b
      where b.org_id = app.current_org_id() and (b.id = $1::uuid or b.id = $2::uuid)`,
    [input.leftId, input.rightId],
  );
  const rootOf = new Map(sides.map((s) => [s.id, s.root]));
  const leftRoot = rootOf.get(input.leftId);
  const rightRoot = rootOf.get(input.rightId);

  let winnerRoot: string | undefined;
  if (leftRoot !== undefined && rightRoot !== undefined) {
    const { rows } = await tx.query<{ id: string }>(
      `select b.id from businesses b
        where b.org_id = app.current_org_id() and (b.id = $1::uuid or b.id = $2::uuid)
        order by b.created_at asc, b.id asc
        limit 1`,
      [leftRoot, rightRoot],
    );
    winnerRoot = rows[0]?.id;
  }

  // Oriented raw ids: the raw side whose root won is the winner. When a side is missing from
  // this org the definer refuses it by name (42501 '... not in this org'); nothing here
  // pre-empts that with a different error.
  const leftWins = winnerRoot === undefined || winnerRoot === leftRoot;
  const winnerId = leftWins ? input.leftId : input.rightId;
  const loserId = leftWins ? input.rightId : input.leftId;
  const loserRoot = leftWins ? rightRoot : leftRoot;

  let fields: Record<string, unknown> = {};
  if (winnerRoot !== undefined && loserRoot !== undefined && winnerRoot !== loserRoot) {
    const parents = await readParents(
      tx,
      `select id, comptroller_key from businesses
        where org_id = app.current_org_id()
          and (coalesce(merged_into_id, id) = $1::uuid or coalesce(merged_into_id, id) = $2::uuid)`,
      [winnerRoot, loserRoot],
    );
    fields = survivorshipJson(survive(parents), parents.length);
  }

  const { rows } = await tx.query<{ merge_id: string | null }>(
    `select app.record_merge($1::uuid, $2::uuid, $3::uuid, $4::text, $5::int, $6::jsonb, $7::jsonb)
            as merge_id`,
    [
      winnerId,
      loserId,
      input.candidateId,
      input.reason,
      input.score,
      JSON.stringify(input.features),
      JSON.stringify(fields),
    ],
  );
  return {
    mergeId: rows[0]?.merge_id ?? null,
    winnerId: winnerRoot ?? winnerId,
    loserId: loserRoot ?? loserId,
  };
}

// ---------------------------------------------------------------------------------------
// Unmerge
// ---------------------------------------------------------------------------------------

/**
 * Reverses one merge. The winner is restored inside the definer from `winner_fields_before`;
 * the loser's fields are re-derived HERE from its own source records — its own, plus those of
 * every business whose live merge chain runs through it (they return under it) — by the same
 * `survive()` the merge used.
 *
 * A merge id this org cannot see is still handed to the definer, so the refusal is the
 * definer's pinned `42501 undo_merge: merge not in this org`, never a different error from here.
 */
export async function unmergeBusinesses(tx: EtlExecutor, input: { mergeId: string }): Promise<void> {
  const { rows } = await tx.query<{ loser_id: string }>(
    `select loser_id from business_merges
      where id = $1::uuid and org_id = app.current_org_id()`,
    [input.mergeId],
  );
  const loserId = rows[0]?.loser_id;

  let fields: Record<string, unknown> = {};
  if (loserId !== undefined) {
    const parents = await readParents(
      tx,
      `with recursive under_loser(id) as (
         select $1::uuid
         union
         select m.loser_id from business_merges m
           join under_loser u on m.winner_id = u.id
          where m.org_id = app.current_org_id() and m.undone_at is null
       )
       select b.id, b.comptroller_key from businesses b
         join under_loser u on u.id = b.id
        where b.org_id = app.current_org_id()`,
      [loserId],
    );
    fields = survivorshipJson(survive(parents), parents.length);
  }

  await tx.query('select app.undo_merge($1::uuid, $2::jsonb)', [
    input.mergeId,
    JSON.stringify(fields),
  ]);
}

// ---------------------------------------------------------------------------------------
// Distinct / skip
// ---------------------------------------------------------------------------------------

/** 'distinct' decides the pair; 'skip' stamps `skipped_at` and leaves it pending (D-13). */
export async function recordCandidateDecision(
  tx: EtlExecutor,
  input: { candidateId: string; decision: 'distinct' | 'skip' },
): Promise<void> {
  await tx.query('select app.record_candidate_decision($1::uuid, $2::text)', [
    input.candidateId,
    input.decision,
  ]);
}

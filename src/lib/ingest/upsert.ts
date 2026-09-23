import { createHash } from 'node:crypto';
import { newExternalKey } from '@/lib/ids/external-key';
import type { EtlExecutor } from './etl-actor';
import type { IngestSourceKey } from './run-report';

/**
 * The one shared write path both desk ingests use (D-05, DATA-04): idempotent by external id,
 * with a `payload_hash` diff that gates BOTH the `source_records` write AND the `businesses`
 * write.
 *
 * 🔴 WHY THE BUSINESSES WRITE IS GATED TOO. CONVENTIONS § Audit keeps `app.log_event` off
 * `source_records` because this phase writes ~10k+ rows per run — but `businesses` IS in
 * `EVENT_LOGGED`, and this phase writes ~92k of them. The first ingest's ~92k `events` rows are
 * a one-time, correct, auditable cost. A second ingest with nothing changed upstream must
 * produce ZERO, and that only holds if an unchanged source row touches nothing on
 * `businesses`. `tests/db/ingest-idempotency.test.ts` 're-run is idempotent' is the standing
 * proof (and mutation M20's target).
 *
 * Every value below is a bound parameter; the payload is stored as `jsonb`, never interpolated
 * (T-3-03). Column names in the dynamic statements come ONLY from the fixed allow-list
 * `DERIVED_COLUMNS`, never from a caller's object keys.
 *
 * 🔴 NO `Date` IS EVER BOUND. A `Date` through drizzle's `execute` with `prepare:false` throws
 * at query time with typecheck, lint and build all green; every instant is bound as
 * `toISOString()` with an explicit `::timestamptz`, so this module is safe behind either
 * executor.
 */

// ---------------------------------------------------------------------------------------
// The payload hash
// ---------------------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * `sha256` (hex) over a CANONICALLY KEY-SORTED JSON serialization of the SELECTED fields —
 * never `JSON.stringify(row)`. Socrata's key order is stable today but is not a contract, and
 * a re-ordering would report every row as `changed` (and, through the businesses gate, write
 * ~92k events). Keys are sorted at every depth; array order is preserved (it is data).
 * `undefined` members are dropped, exactly as `JSON.stringify` drops them.
 */
export function canonicalPayloadHash(selected: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(selected))).digest('hex');
}

// ---------------------------------------------------------------------------------------
// source_records
// ---------------------------------------------------------------------------------------

export interface SourceRecordInput {
  orgId: string;
  sourceKey: IngestSourceKey;
  /**
   * Overture → the GERS `id` VERBATIM, as text (measured: a bare UUID string; the format is
   * Overture's to change, so it is never cast to uuid). Comptroller →
   * `taxpayer_number || '-' || outlet_number`, e.g. `'32006170057-5'`.
   */
  externalId: string;
  /** The SELECTED fields. Stored as `payload` and hashed canonically as `payload_hash`. */
  payload: Record<string, unknown>;
  /** Socrata `rowsUpdatedAt` as ISO, or the Overture release string. */
  sourceVersion: string | null;
  /**
   * The run's start instant (`startRun().startedAt`). A row whose `last_seen_at` is older than
   * the run start after the pass is `gone` (`countGone`).
   */
  seenAt: Date;
  /** When the payload was fetched. Defaults to `seenAt`. Written on INSERT only. */
  fetchedAt?: Date;
}

export interface SourceRecordResult {
  id: string;
  /** A new `source_records` row — the run report's `added`. */
  inserted: boolean;
  /**
   * An EXISTING row whose `payload_hash` differed — the run report's `changed`. Always false
   * when `inserted` is true, so the three outcomes are disjoint:
   * inserted → added, changed → changed, neither → unchanged.
   */
  changed: boolean;
}

/**
 * Two corrections to the statement as 03-RESEARCH / 03-09-PLAN wrote it, both measured
 * against PostgreSQL 18.6 on 2026-09-22 before a line of this was written:
 *
 *  1. `source_records_ext_uniq` is a PARTIAL unique index (`where external_id is not null`).
 *     A conflict target without the matching predicate cannot infer it and the statement is
 *     refused outright — `42P10 there is no unique or exclusion constraint matching the ON
 *     CONFLICT specification`. Hence `on conflict (...) where external_id is not null`.
 *  2. `excluded` is NOT in scope in RETURNING — `42P01 invalid reference to FROM-clause entry
 *     for table "excluded"`. (PostgreSQL 18's `returning old.*` would do it, and production
 *     is 17.6; tests/unit/pg17-compat.test.ts exists because of exactly that trap.) The
 *     previous hash is therefore read by the `prev` CTE, which sees the pre-statement
 *     snapshot, and compared against the row's post-statement hash in RETURNING.
 *
 * `(xmax = 0)` is the standard "was this an insert?" discriminator; correct on 17 and 18.
 * `fetched_at` is written on insert only; a re-seen row advances `last_seen_at` and
 * `source_version`, and its `payload` only when the hash moved.
 */
const SOURCE_RECORD_UPSERT = `
  with prev as (
    select payload_hash from source_records
     where org_id = $1 and source_key = $2 and external_id = $3
  )
  insert into source_records (org_id, source_key, external_id, payload, payload_hash,
                              retention_class, source_version, fetched_at, last_seen_at)
  values ($1, $2, $3, $4::jsonb, $5, 'durable', $6, $7::timestamptz, $8::timestamptz)
  on conflict (org_id, source_key, external_id) where external_id is not null do update
    set last_seen_at   = excluded.last_seen_at,
        source_version = excluded.source_version,
        payload        = case when source_records.payload_hash is distinct from excluded.payload_hash
                              then excluded.payload else source_records.payload end,
        payload_hash   = excluded.payload_hash
  returning id,
            (xmax = 0) as inserted,
            (source_records.payload_hash is distinct from (select payload_hash from prev)) as hash_moved`;

export async function upsertSourceRecord(
  tx: EtlExecutor,
  input: SourceRecordInput,
): Promise<SourceRecordResult> {
  if (!input.externalId) {
    throw new Error('upsertSourceRecord: externalId is required — it is the idempotency key');
  }
  const payloadHash = canonicalPayloadHash(input.payload);
  const { rows } = await tx.query<{ id: string; inserted: boolean; hash_moved: boolean }>(
    SOURCE_RECORD_UPSERT,
    [
      input.orgId,
      input.sourceKey,
      input.externalId,
      JSON.stringify(input.payload),
      payloadHash,
      input.sourceVersion,
      (input.fetchedAt ?? input.seenAt).toISOString(),
      input.seenAt.toISOString(),
    ],
  );
  const row = rows[0];
  // An upsert always returns its row. Silence here would let the run report success while
  // writing nothing — the one failure this path must never have (scripts/seed.ts, same guard).
  if (!row) throw new Error('upsertSourceRecord: the upsert returned no row');
  return { id: row.id, inserted: row.inserted, changed: !row.inserted && row.hash_moved };
}

// ---------------------------------------------------------------------------------------
// businesses
// ---------------------------------------------------------------------------------------

/**
 * The derived columns a source record puts on its business (Pattern 2: one business per
 * source record; merges come afterwards). A field left `undefined` is NOT WRITTEN — on insert
 * it takes the column default, on a changed re-ingest it keeps its current value. That is what
 * stops a Comptroller payload change from nulling a lat/lng the Census geocoder set.
 * `null` is written as NULL.
 */
export interface BusinessDerived {
  displayName: string;
  primarySource: 'tx_comptroller' | 'overture';
  legalName?: string | null;
  comptrollerKey?: string | null;
  nameNorm?: string | null;
  phoneE164?: string | null;
  phoneBlockable?: boolean;
  city?: string | null;
  street?: string | null;
  streetNum?: string | null;
  streetNorm?: string | null;
  unit?: string | null;
  postal?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationMatchType?: string | null;
  basicCategory?: string | null;
  clusterKey?: string | null;
  confidence?: number | null;
  operatingStatus?: string | null;
}

/** The allow-list. Statement text is built from these column names and nothing else. */
const DERIVED_COLUMNS: ReadonlyArray<readonly [keyof BusinessDerived, string]> = [
  ['displayName', 'display_name'],
  ['primarySource', 'primary_source'],
  ['legalName', 'legal_name'],
  ['comptrollerKey', 'comptroller_key'],
  ['nameNorm', 'name_norm'],
  ['phoneE164', 'phone_e164'],
  ['phoneBlockable', 'phone_blockable'],
  ['city', 'city'],
  ['street', 'street'],
  ['streetNum', 'street_num'],
  ['streetNorm', 'street_norm'],
  ['unit', 'unit'],
  ['postal', 'postal'],
  ['lat', 'lat'],
  ['lng', 'lng'],
  ['locationMatchType', 'location_match_type'],
  ['basicCategory', 'basic_category'],
  ['clusterKey', 'cluster_key'],
  ['confidence', 'confidence'],
  ['operatingStatus', 'operating_status'],
];

export interface BusinessWriteOpts {
  orgId: string;
  /** `upsertSourceRecord(...).changed`. */
  changed: boolean;
  /**
   * The durable source record the LOCATION cites, when it is not this one (a Census geocoder
   * record for a Comptroller row). Defaults to this source record whenever lat/lng are written.
   * 🔴 Must be DURABLE: `businesses_location_src_fk` refuses an ephemeral (Google) record with
   * 23503 — the constraint that keeps a Places lat/lng out of the durable record (T-3-06).
   */
  locationSourceId?: string;
  /** Test seam for the collision-retry loop. Production always uses `newExternalKey`. */
  keyGen?: () => string;
}

export interface BusinessWriteResult {
  /** False ONLY on the gate: an existing business whose source payload did not change. */
  wrote: boolean;
  inserted: boolean;
  businessId: string;
}

/** At 0.093 % key-space occupancy the expected retry count is 0.001 per insert. */
export const EXTERNAL_KEY_ATTEMPTS = 5;

export class ExternalKeyExhaustedError extends Error {
  constructor(attempts: number) {
    super(
      `upsertBusinessFromSource: ${attempts} consecutive external_key collisions — ` +
        'the key space is not what the arithmetic in src/lib/ids/external-key.ts assumes',
    );
    this.name = 'ExternalKeyExhaustedError';
  }
}

type Assignment = { column: string; value: unknown };

/** The derived columns present on `derived`, plus the FOUND-05 provenance pair each implies. */
function assignmentsFor(
  sourceRecordId: string,
  derived: BusinessDerived,
  locationSourceId: string | undefined,
): Assignment[] {
  const out: Assignment[] = [];
  for (const [key, column] of DERIVED_COLUMNS) {
    const value = derived[key];
    if (value !== undefined) out.push({ column, value });
  }
  const cite = (present: boolean, column: string, id: string = sourceRecordId) =>
    out.push({ column, value: present ? id : null });
  // A provenance id is written whenever its field is written, and nulled with it.
  cite(true, 'display_name_source_id');
  if (derived.legalName !== undefined) cite(derived.legalName !== null, 'legal_name_source_id');
  if (derived.phoneE164 !== undefined) cite(derived.phoneE164 !== null, 'phone_source_id');
  if (derived.street !== undefined || derived.postal !== undefined) {
    cite((derived.street ?? derived.postal ?? null) !== null, 'address_source_id');
  }
  if (derived.lat !== undefined || derived.lng !== undefined) {
    cite(
      derived.lat != null && derived.lng != null,
      'location_source_id',
      locationSourceId ?? sourceRecordId,
    );
  }
  return out;
}

/**
 * The business for one source record: insert it the first time, update its derived columns
 * when the source payload changed, and — 🔴 the whole point — WRITE NOTHING when the payload
 * did not change and the business already exists.
 *
 * That early return is what keeps an unchanged re-run from producing ~92k `events` rows
 * (`businesses` carries `app.log_event`). It is deliberately its OWN statement, separate from
 * the lookup and from the update, so it can be deleted by itself and mutation-checked without
 * disturbing its neighbours. Executed 2026-09-22: deleting it reds 're-run is idempotent'
 * (24 businesses events where 12 were expected) and 'payload hash diff' (24 where 13 — that
 * test pins "exactly the one changed row wrote an event"), while 'gone is not a delete' and the
 * run-report tests stay green.
 *
 * On insert it draws an external key and uses `on conflict (org_id, external_key) do nothing
 * returning id`, retrying with a fresh key up to `EXTERNAL_KEY_ATTEMPTS` times. A pre-read of
 * taken keys would be both slower and racy.
 */
export async function upsertBusinessFromSource(
  tx: EtlExecutor,
  sourceRecordId: string,
  derived: BusinessDerived,
  opts: BusinessWriteOpts,
): Promise<BusinessWriteResult> {
  const { rows: linked } = await tx.query<{ business_id: string | null }>(
    'select business_id from source_records where id = $1 and org_id = $2',
    [sourceRecordId, opts.orgId],
  );
  if (linked.length === 0) {
    throw new Error(`upsertBusinessFromSource: no source record ${sourceRecordId} in this org`);
  }
  const existing = linked[0]?.business_id ?? null;

  // 🔴 THE GATE (M20's neighbour). Unchanged payload + existing business → write nothing.
  if (existing !== null && !opts.changed) {
    return { wrote: false, inserted: false, businessId: existing };
  }

  const assignments = assignmentsFor(sourceRecordId, derived, opts.locationSourceId);

  if (existing !== null) {
    const set = assignments.map((a, i) => `${a.column} = $${i + 3}`).join(', ');
    const { rows } = await tx.query<{ id: string }>(
      `update businesses set ${set} where id = $1 and org_id = $2 returning id`,
      [existing, opts.orgId, ...assignments.map((a) => a.value)],
    );
    if (rows.length === 0) {
      throw new Error(`upsertBusinessFromSource: business ${existing} vanished from its org`);
    }
    return { wrote: true, inserted: false, businessId: existing };
  }

  const keyGen = opts.keyGen ?? newExternalKey;
  const columns = ['org_id', 'external_key', ...assignments.map((a) => a.column)];
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql =
    `insert into businesses (${columns.join(', ')}) values (${placeholders}) ` +
    'on conflict (org_id, external_key) do nothing returning id';
  for (let attempt = 1; attempt <= EXTERNAL_KEY_ATTEMPTS; attempt++) {
    const { rows } = await tx.query<{ id: string }>(insertSql, [
      opts.orgId,
      keyGen(),
      ...assignments.map((a) => a.value),
    ]);
    const businessId = rows[0]?.id;
    if (!businessId) continue; // the key was taken in this org: draw another
    await tx.query('update source_records set business_id = $1 where id = $2 and org_id = $3', [
      businessId,
      sourceRecordId,
      opts.orgId,
    ]);
    return { wrote: true, inserted: true, businessId };
  }
  throw new ExternalKeyExhaustedError(EXTERNAL_KEY_ATTEMPTS);
}

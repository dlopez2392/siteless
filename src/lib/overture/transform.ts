/**
 * The Overture place row → source record transform (DATA-02). PURE: no I/O, no `fetch`, no
 * `server-only`, and 🔴 NO DUCKDB ANYWHERE IN ITS IMPORT GRAPH. `scripts/ingest-overture.ts`
 * does the S3 range-read and feeds rows in; `tests/unit/overture-transform.test.ts` feeds the
 * committed JSON fixture in. CI therefore exercises every branch with no native binary and
 * no S3 (T-3-14).
 *
 * The row shape is exactly what the desk script's SELECT produces, read through
 * the DuckDB node-api's `getRowObjects()`, which is also exactly what the fixture froze:
 *
 *   id, name_primary, basic_category, taxonomy_primary, confidence, operating_status,
 *   websites, socials, phones, emails          ← VARCHAR[] as { items: [...] }
 *   street, locality, postcode, region, country ← addresses[1].freeform/locality/…
 *   lon, lat                                   ← ST_X / ST_Y(geometry)
 *   version
 *
 * Two measured traps are encoded here, each pinned by a named test:
 *
 * 🔴 1. COUNTRY FIRST. The naive RGV bbox holds 98,960 places, 41,532 of them (42.0 %) in
 *    Mexico. `country='US' AND region='TX'` admits none of them. Three real places carry
 *    `country='MX' AND region='TX'`, so a region-only filter lets them through — both halves
 *    are load-bearing (mutation M23; `texas side filter` + the DB criterion-5 test).
 *    The trade: 180 genuine US rows with a NULL or '' region are dropped (0.3 %, mostly
 *    county-level entries). Admitting them would mean re-admitting 40,106 `region IS NULL`
 *    Mexican rows.
 *
 * 🔴 2. DuckDB's node-api returns `VARCHAR[]` as `{ items: [...] }`, NOT a bare JS array.
 *    `row.phones[0]` is `undefined` on every row; `row.phones.items[0]` is the phone. A bare
 *    array is refused as `malformed` rather than silently read as "no phones" — a reader that
 *    switched to a JSON-converting accessor would otherwise ingest ~51,000 phone-less rows.
 *
 * The coordinate is `ST_X/ST_Y(geometry)`, never the float32-rounded `bbox` struct (98,834 of
 * 98,960 rows differ, by up to ≈1.7 m). The schema below does not even name `bbox`, so zod
 * strips it and the transform cannot read it by accident.
 *
 * The category input is `basic_category` only: the older category struct is removed in the
 * September 2026 release (`2026-09-23.0`), so the transform is release-agnostic by design.
 */
import { z } from 'zod';
import type { BusinessDerived } from '@/lib/ingest/upsert';
import { addressKey, nameNorm, phoneE164, type PhoneKey } from '@/lib/normalize';

/**
 * The naive RGV range-read box: lon ∈ [-99.30, -97.10], lat ∈ [25.80, 26.75]. It is the S3
 * pushdown predicate only. It is NOT the county scope: `country='US' AND region='TX'` is.
 */
export const OVERTURE_RGV_BBOX = { xmin: -99.3, xmax: -97.1, ymin: 25.8, ymax: 26.75 } as const;

/**
 * A `VARCHAR[]` as the DuckDB node-api returns it: `{ items: [...] }`. Items may be NULL.
 * NULL as a whole is tolerated (the script coalesces to `[]`, a raw read may not).
 */
const nodeApiList = z.object({ items: z.array(z.string().nullable()) }).nullable();

/**
 * Exactly the fields the transform reads, and nothing else: zod strips every other Parquet
 * column (`sources`, `brand`, `names.common`, the `bbox` struct, …) so they never become ours
 * by accident (T-3-03). The address fields are renamed `addr_*` on the way through so a reader
 * of the filter below cannot mistake Overture's address country for anything else.
 */
const overtureRowSchema = z
  .object({
    id: z.string().min(1),
    name_primary: z.string().nullable(),
    basic_category: z.string().nullable(),
    taxonomy_primary: z.string().nullable(),
    confidence: z.number().nullable(),
    operating_status: z.string().nullable(),
    websites: nodeApiList,
    socials: nodeApiList,
    phones: nodeApiList,
    emails: nodeApiList,
    street: z.string().nullable(),
    locality: z.string().nullable(),
    postcode: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string().nullable(),
    lon: z.number().finite(),
    lat: z.number().finite(),
    version: z.number().int().nullable(),
  })
  .transform(({ street, locality, postcode, region, country, ...rest }) => ({
    ...rest,
    addr_freeform: street,
    addr_locality: locality,
    addr_postcode: postcode,
    addr_region: region,
    addr_country: country,
  }));

export type OvertureSkipReason = 'not_texas' | 'no_name' | 'malformed';

export interface OvertureSkipped {
  skipped: OvertureSkipReason;
  /** The GERS id when the row was readable enough to carry one. */
  id?: string;
}

/** The SELECTED fields as stored in `source_records.payload`: plain JSON, lists as arrays. */
export interface OverturePayload {
  id: string;
  name_primary: string;
  basic_category: string | null;
  taxonomy_primary: string | null;
  confidence: number | null;
  operating_status: string | null;
  websites: string[];
  socials: string[];
  phones: string[];
  emails: string[];
  street: string | null;
  locality: string | null;
  postcode: string | null;
  region: string;
  country: string;
  lon: number;
  lat: number;
  version: number | null;
}

export interface OvertureSourceRecord {
  sourceKey: 'overture';
  /** The GERS `id` VERBATIM, as text. Never cast to uuid: the format is Overture's to change. */
  externalId: string;
  /** The release string, e.g. `2026-08-19.0`. Recorded on every row (D-05). */
  sourceVersion: string;
  /** Overture is CDLA-Permissive 2.0: durable, and a legal `location_source_id` target. */
  retentionClass: 'durable';
  payload: OverturePayload;
  /** `clusterKey` is deliberately absent: the script resolves it from the seeded map. */
  derived: BusinessDerived;
}

export type OvertureTransformResult = OvertureSkipped | OvertureSourceRecord;

export function isSkipped(r: OvertureTransformResult): r is OvertureSkipped {
  return 'skipped' in r;
}

const present = (s: string | null): s is string => s !== null && s.trim() !== '';

const NO_PHONE: PhoneKey = { e164: null, blockable: false };

export function overtureRowToSourceRecord(row: unknown, release: string): OvertureTransformResult {
  const parsed = overtureRowSchema.safeParse(row);
  if (!parsed.success) {
    const id = (row as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? { skipped: 'malformed', id } : { skipped: 'malformed' };
  }
  const r = parsed.data;

  // 🔴 TRAP 1 — COUNTRY FIRST, then region. Both halves. (M23 drops the country half.)
  if (r.addr_country !== 'US' || r.addr_region !== 'TX') {
    return { skipped: 'not_texas', id: r.id };
  }

  const name = r.name_primary?.trim() ?? '';
  if (name === '') return { skipped: 'no_name', id: r.id };

  // 🔴 TRAP 2 — `.items`, never the bare list.
  const phones: string[] = (r.phones?.items ?? []).filter(present);
  const websites: string[] = (r.websites?.items ?? []).filter(present);
  const socials: string[] = (r.socials?.items ?? []).filter(present);
  const emails: string[] = (r.emails?.items ?? []).filter(present);

  // The first phone that normalises. `phones[]` is raw (four measured forms plus junk), and a
  // junk first entry must not hide a dialable second one. The raw list stays in the payload.
  const phone = phones.map((p) => phoneE164(p)).find((p) => p.e164 !== null) ?? NO_PHONE;
  const addr = addressKey(r.addr_freeform, r.addr_postcode);

  return {
    sourceKey: 'overture',
    externalId: r.id,
    sourceVersion: release,
    retentionClass: 'durable',
    payload: {
      id: r.id,
      name_primary: name,
      basic_category: r.basic_category,
      taxonomy_primary: r.taxonomy_primary,
      confidence: r.confidence,
      operating_status: r.operating_status,
      websites,
      socials,
      phones,
      emails,
      street: r.addr_freeform,
      locality: r.addr_locality,
      postcode: r.addr_postcode,
      region: r.addr_region,
      country: r.addr_country,
      lon: r.lon,
      lat: r.lat,
      version: r.version,
    },
    derived: {
      displayName: name,
      primarySource: 'overture',
      nameNorm: nameNorm(name),
      phoneE164: phone.e164,
      phoneBlockable: phone.blockable,
      // Blank is absent: the derived columns hold null, never '' (survivorship reads null, so a
      // merge would otherwise rewrite the column). The raw payload keeps the value as sent.
      city: present(r.addr_locality) ? r.addr_locality : null,
      street: present(r.addr_freeform) ? r.addr_freeform : null,
      streetNum: addr.streetNum,
      streetNorm: addr.streetNorm,
      unit: addr.unit,
      postal: addr.postal,
      // ST_X is longitude, ST_Y is latitude. Never the bbox struct.
      lat: r.lat,
      lng: r.lon,
      locationMatchType: 'overture',
      basicCategory: r.basic_category,
      confidence: r.confidence,
      // 'permanently_closed' lives in operating_status and NEVER writes closed_at (0023).
      operatingStatus: r.operating_status,
    },
  };
}

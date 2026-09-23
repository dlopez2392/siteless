import type { Client } from 'pg';
import type { EtlExecutor } from '@/lib/ingest/etl-actor';
import {
  upsertBusinessFromSource,
  upsertSourceRecord,
  type BusinessDerived,
} from '@/lib/ingest/upsert';
import {
  countGone,
  emptyTally,
  finishRun,
  recordOutcome,
  startRun,
  type IngestSourceKey,
} from '@/lib/ingest/run-report';
import { nameNorm } from '@/lib/normalize';
import {
  comptrollerDerived,
  loadDerivationContext,
  overtureClusterKey,
  seededClusterRanges,
  type DerivationContext,
} from '@/lib/resolve/derivation';
import type { PermitRow } from '@/lib/socrata/permits';
import overtureCategories from '@/seed/data/overture-categories.json';
import { isSkipped, overtureRowToSourceRecord } from '@/lib/overture/transform';
import { SQL_FRESH_EXTERNAL_KEY } from './_fixtures';

/**
 * Phase 3 ingest fixtures, composed on top of `_fixtures.ts`.
 *
 * 🔴 TENS OF ROWS, NEVER THOUSANDS. `withRollback` is one transaction; the scale evidence
 * (~92k businesses, ~37 MB of first-run events) lives in 03-RESEARCH, not in the suite.
 *
 * 🔴 EVERYTHING STAYS INSIDE `withRollback`. `orgs` rows cannot be deleted (Phase 2 Pitfall 8),
 * so a fixture that "cleans up by deleting an org" fails; the rollback is the only cleanup.
 *
 * 🔴 THE SEEDERS WRITE THROUGH THE SHIPPED PATH (`upsertSourceRecord` +
 * `upsertBusinessFromSource`), so every seeded business carries a real external key, a durable
 * source record and its provenance ids — the same shape the desk ingest produces. They run as
 * whatever the connection currently is: the owner (RLS bypassed), or `authenticated` after an
 * `actAs` (the write then goes through the org policies). `seedCandidatePair` and
 * `seedIngestRun` write tables `authenticated` holds SELECT-only on, so call them BEFORE
 * `actAs`, exactly as `seedTwoOrgs` is.
 */

// ---------------------------------------------------------------------------------------
// The executor adapter
// ---------------------------------------------------------------------------------------

/**
 * A `pg.Client` as the executor `setEtlActor` / `resolveEtlOrg` / the upserts take — the same
 * connection shape the desk scripts use (an owner `pg` connection, like `scripts/seed.ts`).
 * The DB tests drive THE SHIPPED HELPERS through this rather than re-typing their SQL: a test
 * that re-types the statements cannot catch the helper forgetting one.
 */
export function asEtlExecutor(c: Client): EtlExecutor {
  return {
    async query<R>(text: string, params?: unknown[]) {
      const r = await c.query(text, params);
      return { rows: r.rows as R[] };
    },
  };
}

export interface SeededBusiness {
  businessId: string;
  sourceRecordId: string;
  externalId: string;
  displayName: string;
  city: string | null;
}

export interface IngestInput {
  externalId: string;
  payload: Record<string, unknown>;
  derived: BusinessDerived;
}

// ---------------------------------------------------------------------------------------
// Comptroller (jrea-zgmq) — the SELECTED fields only, Socrata spelling
// ---------------------------------------------------------------------------------------

export interface ComptrollerFixtureRow {
  taxpayer_number: string;
  outlet_number: string;
  outlet_name: string;
  outlet_address: string;
  outlet_city: string;
  outlet_zip_code: string;
  outlet_county_code: string;
  outlet_naics_code: string;
}

const permit = (
  taxpayer: string,
  outlet: string,
  name: string,
  address: string,
  city: string,
  zip: string,
  county: string,
  naics: string,
): ComptrollerFixtureRow => ({
  taxpayer_number: taxpayer,
  outlet_number: outlet,
  outlet_name: name,
  outlet_address: address,
  outlet_city: city,
  outlet_zip_code: zip,
  outlet_county_code: county,
  outlet_naics_code: naics,
});

/** Twelve RGV outlets across the four counties (031 Cameron, 108 Hidalgo, 214 Starr, 245 Willacy). */
export const COMPTROLLER_FIXTURE: readonly ComptrollerFixtureRow[] = [
  permit('32006170057', '5', 'TACOS EL GUERO', '1200 N 10TH ST', 'MCALLEN', '78501', '108', '722513'),
  permit('32006170057', '6', 'TACOS EL GUERO #2', '4100 N 23RD ST STE 4', 'MCALLEN', '78504', '108', '722513'),
  permit('17412345678', '1', 'GARCIA A/C & HEATING', '315 E FREDDY GONZALEZ DR', 'EDINBURG', '78539', '108', '238220'),
  permit('17498765432', '1', 'LA ESTRELLA BAKERY', '201 S CLOSNER BLVD', 'EDINBURG', '78539', '108', '311811'),
  permit('32045678901', '1', 'VALLEY AUTO GLASS', '1701 W BUSINESS 83', 'PHARR', '78577', '108', '811122'),
  permit('32045678902', '1', 'SALON BELLEZA', '900 E EXPRESSWAY 83', 'WESLACO', '78596', '108', '812112'),
  permit('32045678903', '2', 'MISSION TIRE SHOP', '2020 E GRIFFIN PKWY', 'MISSION', '78572', '108', '441340'),
  permit('32045678904', '1', 'RIO PLUMBING', '410 N 77 SUNSHINE STRIP', 'HARLINGEN', '78550', '031', '238220'),
  permit('32045678905', '1', 'BROWNSVILLE NAIL SPA', '2370 N EXPRESSWAY', 'BROWNSVILLE', '78521', '031', '812113'),
  permit('32045678906', '1', 'STARR COUNTY FEED', '100 E MAIN ST', 'RIO GRANDE CITY', '78582', '214', '424910'),
  permit('32045678907', '1', 'RAYMONDVILLE DINER', '150 S 7TH ST', 'RAYMONDVILLE', '78580', '245', '722511'),
  permit('32045678908', '3', 'DONNA HARDWARE', '301 S MAIN ST', 'DONNA', '78537', '108', '444130'),
];

/**
 * The derivation context a fixture uses when the caller has no database handy: the seeded
 * NAICS ranges and category map (the same committed files `pnpm db:seed` loads) and NO city
 * fold. A seeder that has a connection loads the real one instead (`fixtureDerivationContext`),
 * which is what survivorship reads — so a fixture whose re-derivation is compared against its
 * ingest (the unmerge and rederive tests) must use that.
 */
export const STATIC_DERIVATION_CONTEXT: DerivationContext = {
  clusters: seededClusterRanges(),
  categoryMap: new Map(
    overtureCategories
      .filter((e): e is { basic_category: string; cluster_key: string; rows: number } =>
        'cluster_key' in e,
      )
      .map((e) => [e.basic_category, e.cluster_key] as const),
  ),
  cityFold: new Map(),
};

/** The live context — built-in category map and city fold read from the database. */
export async function fixtureDerivationContext(c: Client): Promise<DerivationContext> {
  return loadDerivationContext(asEtlExecutor(c));
}

/**
 * A fixture row → what the Comptroller ingest produces: the D-05 external id
 * `taxpayer_number-outlet_number`, the SELECTED fields as the payload, and the derived columns
 * through `comptrollerDerived` — the one function the ingest writes with and survivorship
 * re-reads with (A-CR-03), so a seeded business carries its cluster exactly as a real one does.
 */
export function comptrollerIngestInput(
  row: ComptrollerFixtureRow,
  ctx: DerivationContext = STATIC_DERIVATION_CONTEXT,
): IngestInput {
  const externalId = `${row.taxpayer_number}-${row.outlet_number}`;
  const d = comptrollerDerived(row as unknown as PermitRow, ctx);
  return {
    externalId,
    payload: { ...row },
    derived: {
      displayName: d.displayName,
      legalName: d.legalName,
      primarySource: 'tx_comptroller',
      comptrollerKey: externalId,
      nameNorm: nameNorm(row.outlet_name),
      city: d.city,
      street: d.street,
      streetNum: d.streetNum,
      streetNorm: d.streetNorm,
      unit: d.unit,
      postal: d.postal,
      clusterKey: d.clusterKey,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Overture places — Texas side AND Mexican side, all inside the naive RGV bbox
// ---------------------------------------------------------------------------------------

/** The naive RGV bbox — 42.0 % of the Overture places inside it are in Mexico (measured). */
export const NAIVE_RGV_BBOX = { lonMin: -99.3, lonMax: -97.1, latMin: 25.8, latMax: 26.75 } as const;

export interface OvertureFixtureRow {
  /** GERS id — a bare UUID string, stored verbatim as text. */
  id: string;
  name: string;
  country: string;
  region: string;
  locality: string;
  lat: number;
  lng: number;
  basic_category: string;
  phone: string | null;
  street: string | null;
  postcode: string | null;
}

let gersSeq = 0;
/** Deterministic GERS-shaped ids, so a re-seed of the fixture is the same set of external ids. */
const gers = (): string => {
  gersSeq += 1;
  return `e2d3a704-983c-4349-967d-${gersSeq.toString(16).padStart(12, '0')}`;
};

const place = (
  name: string,
  country: 'US' | 'MX',
  region: string,
  locality: string,
  lat: number,
  lng: number,
  basic_category: string,
  street: string | null = null,
  postcode: string | null = null,
  phone: string | null = null,
): OvertureFixtureRow => ({
  id: gers(),
  name,
  country,
  region,
  locality,
  lat,
  lng,
  basic_category,
  phone,
  street,
  postcode,
});

// Texas side: 40 rows. 36 of them within 60 km of downtown McAllen (26.2034, -98.2300);
// Brownsville and Rio Grande City sit just outside the radius but inside the bbox.
const TX_LOCALITIES: ReadonlyArray<readonly [string, number, number, string]> = [
  ['McAllen', 26.2034, -98.23, '78501'],
  ['McAllen', 26.2262, -98.2419, '78504'],
  ['Edinburg', 26.3017, -98.1633, '78539'],
  ['Pharr', 26.1948, -98.1836, '78577'],
  ['Mission', 26.2159, -98.3253, '78572'],
  ['San Juan', 26.1892, -98.1553, '78589'],
  ['Alamo', 26.1834, -98.1231, '78516'],
  ['Weslaco', 26.1595, -97.9908, '78596'],
  ['Donna', 26.1703, -98.0519, '78537'],
  ['Hidalgo', 26.1003, -98.2631, '78557'],
  ['Mercedes', 26.1498, -97.9136, '78570'],
  ['Harlingen', 26.1906, -97.6961, '78550'],
];
const TX_CATEGORIES = ['taco_restaurant', 'hvac_services', 'bakery', 'auto_glass_service', 'beauty_salon', 'plumbing'];

const TEXAS_ROWS: OvertureFixtureRow[] = [];
for (let i = 0; i < 36; i++) {
  const [locality, lat, lng, zip] = TX_LOCALITIES[i % TX_LOCALITIES.length]!;
  // A small deterministic jitter (< 1.5 km) so no two places share a coordinate.
  const dLat = ((i * 7) % 11) * 0.001;
  const dLng = ((i * 5) % 13) * 0.001;
  TEXAS_ROWS.push(
    place(
      `${locality} Business ${i + 1}`,
      'US',
      'TX',
      locality,
      lat + dLat,
      lng - dLng,
      TX_CATEGORIES[i % TX_CATEGORIES.length]!,
      `${100 + i * 10} W Main St`,
      zip,
      i % 3 === 0 ? `(956) 682-${String(2400 + i).padStart(4, '0')}` : null,
    ),
  );
}
TEXAS_ROWS.push(
  place('Brownsville Taqueria', 'US', 'TX', 'Brownsville', 25.9017, -97.4975, 'taco_restaurant', '1100 E Elizabeth St', '78520'),
  place('Port Isabel Bait', 'US', 'TX', 'Port Isabel', 26.0734, -97.2086, 'fishing_store', null, '78578'),
  place('Rio Grande City Tire', 'US', 'TX', 'Rio Grande City', 26.3798, -98.8203, 'tire_shop', '200 E Main St', '78582'),
  place('Raymondville Diner', 'US', 'TX', 'Raymondville', 26.4815, -97.7831, 'diner', '150 S 7th St', '78580'),
);

/**
 * Mexican side: real border localities, every coordinate INSIDE the naive bbox — a fixture
 * whose Mexican rows sat outside the bbox would prove nothing. Reynosa (12 km from McAllen),
 * Río Bravo and Gustavo Díaz Ordaz are INSIDE the test's 60 km radius; Matamoros and Ciudad
 * Miguel Alemán are inside the bbox but outside the radius.
 *
 * The last row is the measured pathology: 3 real Overture places carry
 * `country='MX' AND region='TX'`. A `region==='TX'`-only filter admits it (mutation M23).
 */
const MEXICAN_ROWS: OvertureFixtureRow[] = [
  place('Taquería La Reynosa', 'MX', 'TAM', 'Reynosa', 26.0922, -98.2779, 'taco_restaurant'),
  place('Farmacia Del Centro', 'MX', 'TAM', 'Reynosa', 26.0801, -98.2912, 'pharmacy'),
  place('Llantera Hidalgo', 'MX', 'TAM', 'Reynosa', 26.0655, -98.3051, 'tire_shop'),
  place('Panadería San Juan', 'MX', 'TAM', 'Municipio de Reynosa', 26.0511, -98.2604, 'bakery'),
  place('Estética Bella', 'MX', 'TAM', 'Río Bravo', 25.9869, -98.0942, 'beauty_salon'),
  place('Refaccionaria Bravo', 'MX', 'TAM', 'Rio Bravo', 25.9901, -98.1003, 'auto_parts_store'),
  place('Abarrotes Díaz', 'MX', 'TAM', 'Gustavo Díaz Ordaz', 26.2331, -98.5947, 'grocery_store'),
  place('Mariscos El Puerto', 'MX', 'TAM', 'Matamoros', 25.8697, -97.5027, 'seafood_restaurant'),
  place('Hotel Frontera', 'MX', 'TAM', 'Heroica Matamoros', 25.8792, -97.5041, 'hotel'),
  place('Ferretería Alemán', 'MX', 'TAM', 'Ciudad Miguel Alemán', 26.3995, -99.0253, 'hardware_store'),
  // The pathological row: country MX, region TX, sitting in Reynosa.
  place('Carnicería La Frontera', 'MX', 'TX', 'Reynosa', 26.0839, -98.2863, 'butcher_shop'),
];

export const OVERTURE_FIXTURE: readonly OvertureFixtureRow[] = [...TEXAS_ROWS, ...MEXICAN_ROWS];

/** The release string every seeded Overture record carries. */
export const OVERTURE_FIXTURE_RELEASE = '2026-08-19.0';

/**
 * A fixture row in the shape the desk script's SELECT produces through DuckDB's node-api
 * (`getRowObjects()`): lists as `{ items }`, the address flattened, `lon`/`lat` from
 * ST_X/ST_Y. This is what `overtureRowToSourceRecord` reads — in production and here.
 */
export function toOvertureRow(row: OvertureFixtureRow): Record<string, unknown> {
  return {
    id: row.id,
    name_primary: row.name,
    basic_category: row.basic_category,
    taxonomy_primary: null,
    confidence: 0.95,
    operating_status: 'open',
    websites: { items: [] },
    socials: { items: [] },
    phones: { items: row.phone === null ? [] : [row.phone] },
    emails: { items: [] },
    street: row.street,
    locality: row.locality,
    postcode: row.postcode,
    region: row.region,
    country: row.country,
    lon: row.lng,
    lat: row.lat,
    version: 0,
  };
}

/**
 * A fixture row → the ingest input, THROUGH THE PRODUCTION TRANSFORM (03-13), or `null` when
 * the transform skips it. There is no fixture-side Texas filter any more: the criterion-5 DB
 * test and the unit `texas side filter` test both exercise `overtureRowToSourceRecord`, so
 * mutation M23 on the transform (drop the `country` half) reds both — executed in 03-13.
 */
export function overtureIngestInput(
  row: OvertureFixtureRow,
  categoryMap: ReadonlyMap<string, string> = STATIC_DERIVATION_CONTEXT.categoryMap,
): IngestInput | null {
  const r = overtureRowToSourceRecord(toOvertureRow(row), OVERTURE_FIXTURE_RELEASE);
  if (isSkipped(r)) return null;
  // The cluster exactly as scripts/ingest-overture.ts resolves it (A-CR-03).
  return {
    externalId: r.externalId,
    payload: { ...r.payload },
    derived: { ...r.derived, clusterKey: overtureClusterKey(r.derived.basicCategory, categoryMap) },
  };
}

// ---------------------------------------------------------------------------------------
// Seeders
// ---------------------------------------------------------------------------------------

async function writeAll(
  c: Client,
  orgId: string,
  sourceKey: IngestSourceKey,
  inputs: IngestInput[],
  seenAt: Date,
  sourceVersion: string | null,
): Promise<SeededBusiness[]> {
  const x = asEtlExecutor(c);
  const out: SeededBusiness[] = [];
  for (const input of inputs) {
    const sr = await upsertSourceRecord(x, {
      orgId,
      sourceKey,
      externalId: input.externalId,
      payload: input.payload,
      sourceVersion,
      seenAt,
    });
    const b = await upsertBusinessFromSource(x, sr.id, input.derived, {
      orgId,
      changed: sr.changed,
    });
    out.push({
      businessId: b.businessId,
      sourceRecordId: sr.id,
      externalId: input.externalId,
      displayName: input.derived.displayName,
      city: input.derived.city ?? null,
    });
  }
  return out;
}

export async function seedComptrollerFixture(
  c: Client,
  orgId: string,
  rows: readonly ComptrollerFixtureRow[] = COMPTROLLER_FIXTURE,
  /** Pass `await fixtureDerivationContext(c)` when the test compares a re-derivation. */
  ctx: DerivationContext = STATIC_DERIVATION_CONTEXT,
): Promise<SeededBusiness[]> {
  return writeAll(
    c,
    orgId,
    'tx_comptroller',
    rows.map((r) => comptrollerIngestInput(r, ctx)),
    new Date(),
    '2026-09-20T00:00:00.000Z',
  );
}

/**
 * Seeds the Overture fixture through the production transform, which is where the Texas-side
 * filter lives. Returns the seeded businesses and how many rows the transform skipped — a
 * caller can assert the filter actually saw Mexican rows, not merely that none came out.
 */
export async function seedOvertureFixture(
  c: Client,
  orgId: string,
  rows: readonly OvertureFixtureRow[] = OVERTURE_FIXTURE,
): Promise<{ seeded: SeededBusiness[]; skipped: number }> {
  const kept = rows.map((r) => overtureIngestInput(r)).filter((i): i is IngestInput => i !== null);
  const seeded = await writeAll(c, orgId, 'overture', kept, new Date(), OVERTURE_FIXTURE_RELEASE);
  return { seeded, skipped: rows.length - kept.length };
}

export interface CandidateBusinessSpec {
  displayName: string;
  nameNorm?: string | null;
  phoneE164?: string | null;
  postal?: string | null;
  streetNum?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * A `merge_candidates` row plus its two `businesses`. Inserted as the OWNER —
 * `authenticated` is SELECT-only on `merge_candidates` (decisions go through a definer,
 * T-3-08) — so call it BEFORE `actAs`. `left_id < right_id` is enforced by `mc_pair_ordered`;
 * the ordering is done in SQL with `least`/`greatest` on the uuids, never in JS.
 */
export async function seedCandidatePair(
  c: Client,
  orgId: string,
  spec: {
    left: CandidateBusinessSpec;
    right: CandidateBusinessSpec;
    score?: number;
    blockKey?: string;
    features?: Record<string, unknown>;
  },
): Promise<{ candidateId: string; leftId: string; rightId: string }> {
  const insertBusiness = async (b: CandidateBusinessSpec): Promise<string> => {
    const r = await c.query<{ id: string }>(
      `insert into businesses (org_id, external_key, display_name, name_norm, phone_e164, postal,
                               street_num, city, lat, lng)
       values ($1, ${SQL_FRESH_EXTERNAL_KEY}, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        orgId,
        b.displayName,
        b.nameNorm ?? nameNorm(b.displayName),
        b.phoneE164 ?? null,
        b.postal ?? null,
        b.streetNum ?? null,
        b.city ?? null,
        b.lat ?? null,
        b.lng ?? null,
      ],
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('seedCandidatePair: business insert returned no row');
    return id;
  };
  const one = await insertBusiness(spec.left);
  const two = await insertBusiness(spec.right);
  const r = await c.query<{ id: string; left_id: string; right_id: string }>(
    `insert into merge_candidates (org_id, left_id, right_id, block_key, score, features)
     values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), $4, $5, $6::jsonb)
     returning id, left_id, right_id`,
    [orgId, one, two, spec.blockKey ?? 'phone', spec.score ?? 0, JSON.stringify(spec.features ?? {})],
  );
  const row = r.rows[0];
  if (!row) throw new Error('seedCandidatePair: candidate insert returned no row');
  return { candidateId: row.id, leftId: row.left_id, rightId: row.right_id };
}

/**
 * One `ingest_runs` row with `status='running'`. The `emit_event` tests need a real
 * `entity_id` to reference. Owner-only (`authenticated` is SELECT-only on `ingest_runs`).
 */
export async function seedIngestRun(
  c: Client,
  orgId: string,
  sourceKey: IngestSourceKey = 'tx_comptroller',
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into ingest_runs (org_id, source_key, status, started_at)
     values ($1, $2, 'running', clock_timestamp()) returning id`,
    [orgId, sourceKey],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('seedIngestRun: insert returned no row');
  return id;
}

// ---------------------------------------------------------------------------------------
// A whole run, exactly as the desk scripts compose it
// ---------------------------------------------------------------------------------------

export interface FixtureRunResult {
  runId: string;
  startedAt: Date;
  eventId: string;
  report: { added: number; changed: number; unchanged: number; gone: number; totalSeen: number };
}

/**
 * startRun → per row upsertSourceRecord + upsertBusinessFromSource → countGone → finishRun,
 * all through the shipped modules. It does NOT set the ETL actor or the org claim: the caller
 * does, in the transaction, exactly as each desk-script batch must — which is what lets a test
 * prove what happens when it doesn't.
 */
export async function runFixtureIngest(
  c: Client,
  orgId: string,
  sourceKey: IngestSourceKey,
  inputs: IngestInput[],
  sourceVersion: string | null = null,
): Promise<FixtureRunResult> {
  const x = asEtlExecutor(c);
  const run = await startRun(x, { orgId, sourceKey, datasetId: null, sourceVersion });
  const tally = emptyTally();
  for (const input of inputs) {
    const sr = await upsertSourceRecord(x, {
      orgId,
      sourceKey,
      externalId: input.externalId,
      payload: input.payload,
      sourceVersion,
      seenAt: run.startedAt,
    });
    recordOutcome(tally, sr);
    await upsertBusinessFromSource(x, sr.id, input.derived, { orgId, changed: sr.changed });
  }
  const gone = await countGone(x, { orgId, sourceKey, runStartedAt: run.startedAt });
  const report = { ...tally, gone };
  const eventId = await finishRun(x, run.id, { status: 'complete', ...report });
  return { runId: run.id, startedAt: run.startedAt, eventId, report };
}

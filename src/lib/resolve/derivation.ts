import clustersFile from '@/seed/data/clusters.json';
import type { EtlExecutor } from '@/lib/ingest/etl-actor';
import { addressKey } from '@/lib/normalize';
import {
  comptrollerRowToSourceRecord,
  type ClusterNaicsRanges,
  type PermitRow,
} from '@/lib/socrata/permits';

/**
 * THE DERIVED COLUMNS' INPUTS THAT LIVE OUTSIDE THE PAYLOAD — in one place, read by the
 * ingests AND by survivorship (A-CR-03, A-WR-06, review 03).
 *
 * `cluster_key` comes from the seeded NAICS ranges (Comptroller) or from
 * `overture_category_map` (Overture), and a Comptroller `city` from the `cities.name_variants`
 * fold. None of the three is in the source payload. Before this module the ingests resolved
 * them and survivorship did not, so `survive()` never saw a cluster: a merge could drop a
 * business out of the lead funnel (D-02), and a merged winner's city could lose its fold.
 *
 * 🔴 ONE FUNCTION PER DERIVATION, CALLED BY BOTH SIDES. `comptrollerDerived` is what
 * `permitToIngest` (scripts/ingest-comptroller.ts) writes AND what `sourceRecordView`
 * (src/lib/resolve/merge.ts) re-reads; `overtureClusterKey` is what the Overture ingest writes
 * AND what the view re-reads. A rule stated twice drifts; a rule called twice cannot.
 * tests/unit/payload-contract.test.ts pins the parity for both sources.
 *
 * 🔴 WHEN A DERIVATION CHANGES, BUMP `DERIVATION_VERSION` AND RUN `scripts/rederive.ts`. The
 * ingests' payload-hash gate writes nothing for an unchanged payload (DATA-04), so a new
 * mapping, a new city spelling or a normalizer fix never reaches a stored row by re-ingesting.
 * The rederive pass recomputes every business from its stored payloads through these same
 * functions and writes only the rows that differ (docs/runbooks/ingest.md).
 */

/**
 * Bumped whenever any derivation below — or a normalizer it calls (src/lib/normalize), or the
 * Overture phone pick — changes what a stored row would get. Recorded on every rederive run so
 * the report says which rules the spine was last brought up to.
 *
 *   1 — review 03 fixes: cluster through survivorship (A-CR-03), city fold through
 *       survivorship, the blockable-first phone pick (B-WR-04), the name/address/phone
 *       normalizer fixes (B-CR-01, B-WR-01..03).
 */
export const DERIVATION_VERSION = 1;

export interface DerivationContext {
  /** The seeded clusters' half-open NAICS ranges (`src/seed/data/clusters.json`). */
  clusters: ReadonlyArray<ClusterNaicsRanges>;
  /** Overture `basic_category` → cluster key; this org's rows override the built-ins. */
  categoryMap: ReadonlyMap<string, string>;
  /** `countyCode|OUTLET CITY` → the seeded city name (`cities.name_variants`). */
  cityFold: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------------------
// The three inputs
// ---------------------------------------------------------------------------------------

/** The seeded clusters' half-open NAICS ranges — the same file `pnpm db:seed` loads. */
export function seededClusterRanges(): ClusterNaicsRanges[] {
  return clustersFile.clusters.map((c) => ({ key: c.key, naicsRanges: c.naicsRanges }));
}

/**
 * `outlet_city` spelling → the seeded city `name`, per county: the Phase 2 ∥ 3 shared
 * contract (`cities.name_variants`, matched upper-case, displayed as `name`).
 */
export type CityFold = Map<string, string>;

export const cityFoldKey = (countyCode: number, outletCity: string) =>
  `${countyCode}|${outletCity.trim().replace(/\s+/g, ' ').toUpperCase()}`;

/** Read from the database's built-in rows, so the fold is exactly what the presets resolve. */
export async function loadCityFold(tx: EtlExecutor): Promise<CityFold> {
  const { rows } = await tx.query<{
    comptroller_code: number;
    name: string;
    name_variants: string[];
  }>(
    `select co.comptroller_code, ci.name, ci.name_variants
       from cities ci join counties co on co.id = ci.county_id
      where ci.org_id is null and co.org_id is null`,
  );
  const fold: CityFold = new Map();
  for (const r of rows) {
    for (const v of [r.name, ...r.name_variants]) fold.set(cityFoldKey(r.comptroller_code, v), r.name);
  }
  return fold;
}

/**
 * The org's Overture category map: built-ins (`org_id IS NULL`) first, then the current org's
 * own rows, so an org override wins. The org is `app.current_org_id()` — the claim both tiers
 * already hold (the desk tier through `resolveEtlOrg`, the app tier through `withOrg`).
 */
export async function loadCategoryMap(tx: EtlExecutor): Promise<Map<string, string>> {
  const { rows } = await tx.query<{ basic_category: string; cluster_key: string }>(
    `select basic_category, cluster_key from overture_category_map
      where org_id is null or org_id = app.current_org_id()
      order by (org_id is not null), basic_category`,
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.basic_category, r.cluster_key);
  return map;
}

export async function loadDerivationContext(tx: EtlExecutor): Promise<DerivationContext> {
  return {
    clusters: seededClusterRanges(),
    categoryMap: await loadCategoryMap(tx),
    cityFold: await loadCityFold(tx),
  };
}

// ---------------------------------------------------------------------------------------
// The derivations
// ---------------------------------------------------------------------------------------

/** An Overture `basic_category` → its cluster, or null when unmapped (D-02: never guessed). */
export function overtureClusterKey(
  basicCategory: string | null | undefined,
  categoryMap: ReadonlyMap<string, string>,
): string | null {
  if (basicCategory === null || basicCategory === undefined) return null;
  return categoryMap.get(basicCategory) ?? null;
}

const nonBlank = (s: string | null | undefined): string | null =>
  typeof s === 'string' && s.trim() !== '' ? s : null;

export interface ComptrollerDerived {
  legalName: string;
  displayName: string;
  street: string | null;
  streetNum: string | null;
  streetNorm: string | null;
  unit: string | null;
  postal: string | null;
  city: string | null;
  clusterKey: string | null;
}

/**
 * One permit row → the business columns it derives. The ingest writes these; the survivorship
 * view re-reads the STORED payload through this same function.
 *
 * `outlet_address` is the location, never `taxpayer_address` (PITFALLS). The city is the
 * seeded spelling when the fold knows it, else the raw `outlet_city`; a blank is NULL (the
 * derived columns hold null, never '', or survivorship would rewrite them). The cluster is
 * `comptrollerRowToSourceRecord`'s own NAICS lookup — the permits transform's rule, called,
 * not restated.
 */
export function comptrollerDerived(row: PermitRow, ctx: DerivationContext): ComptrollerDerived {
  const rec = comptrollerRowToSourceRecord(row, '', [...ctx.clusters]);
  const street = nonBlank(rec.street);
  const addr = addressKey(street, nonBlank(row.outlet_zip_code));
  const rawCity = nonBlank(row.outlet_city);
  const folded =
    rawCity === null ? undefined : ctx.cityFold.get(cityFoldKey(rec.countyCode, rawCity));
  return {
    legalName: rec.legalName,
    displayName: rec.legalName,
    street,
    streetNum: addr.streetNum,
    streetNorm: addr.streetNorm,
    unit: addr.unit,
    postal: addr.postal,
    city: folded ?? rawCity,
    clusterKey: rec.clusterKey,
  };
}

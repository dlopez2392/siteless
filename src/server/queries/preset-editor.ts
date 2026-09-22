import 'server-only';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { ESTIMATE_SKU } from '@/lib/estimate/assumptions';
import { texasMultiplier } from '@/lib/estimate/estimate';
import { APP_LOCALE } from '@/lib/time';
import type { ClusterKey } from '@/seed/types';
import { readCurrentPeriod, readUnitsUsedThisPeriod, type Tx } from './budget';
import { getSeedTables, RADIUS_MILE_OPTIONS, readReferenceIndex } from './presets';

/**
 * Everything the preset editor's three pickers need in order to render, read in ONE
 * transaction.
 *
 * ── WHY THE EDITOR CANNOT READ ANY OF THIS ITSELF ──────────────────────────────────────
 *
 * `preset-form.tsx` and its pickers are `'use client'`. Every module below carries
 * `import 'server-only'` (this one) or pulls the committed seed JSON into the bundle
 * (`src/lib/estimate/`), and `RADIUS_MILE_OPTIONS` lives in a server-only module too — so
 * importing any of them from the client would either fail the build or ship a megabyte of
 * seed data to a phone. The server reads it once and hands it down as PROPS, which is also
 * the only boundary a client module's exports survive (UI-SPEC Executor Rule 5).
 *
 * 🔴 THE TEXAS MULTIPLIER IS COMPUTED HERE, NEVER TYPED. UI-SPEC's copy table carries an
 * illustrative "×38 vs RGV"; the seeded cell lists produce ≈14.9 (1,016 Texas cells against
 * 68 RGV cells). Executor Rule 16: the figures in that document show the FORMAT, not
 * arithmetic. `texasMultiplier` re-derives it from the seed on every request, so promoting a
 * city or adding a cluster moves the chip instead of leaving a stale constant behind.
 *
 * 🔴 THE CONTEXT IS THE REAL METER, not a zeroed placeholder. The multiplier is a ratio of
 * request counts and is arithmetically independent of the budget row — but handing
 * `texasMultiplier` a fabricated context would make this the one place in the product where
 * a number on screen was built from figures nobody holds, on the screen whose entire job is
 * being believable about money.
 */

export type ClusterOption = {
  id: string;
  key: ClusterKey;
  displayName: string;
  /** "1,452 RGV outlets" — preformatted, because the client must not carry a number
   *  formatter whose locale could resolve differently from the server's (recorded BIS SSR
   *  hydration mismatch for es-* browsers). */
  outletLabel: string;
};

export type CityOption = {
  id: string;
  name: string;
  countyFips: string;
  outletLabel: string;
};

export type CountyOption = {
  id: string;
  fips: string;
  name: string;
  outletLabel: string;
};

export type EditorReference = {
  clusters: ClusterOption[];
  /** The seeded 17 (D-01/D-05), already sorted by name. */
  cities: CityOption[];
  /** Cameron · Hidalgo · Starr · Willacy. */
  rgvCounties: CountyOption[];
  /** D-04's pinned built-in row: every county id, so selecting it is an ordinary county
   *  selection and nothing downstream special-cases "Texas". */
  texas: { countyIds: string[]; label: string; outletLabel: string };
  /** Computed, never a constant. Rendered as `×{n.toFixed(1)}`. */
  texasMultiplier: number;
  radiusOptions: number[];
};

const counts = new Intl.NumberFormat(APP_LOCALE);

export async function readEditorReference(tx: Tx): Promise<EditorReference> {
  const index = await readReferenceIndex(tx);
  const period = await readCurrentPeriod(tx, 'places');
  const units = await readUnitsUsedThisPeriod(tx, ESTIMATE_SKU, period.id);
  const seed = getSeedTables();

  const multiplier = texasMultiplier({
    seed,
    unitsUsedThisPeriod: units,
    capMicroUsd: period.capMicroUsd,
    spentMicroUsd: period.spentMicroUsd,
    reservedMicroUsd: period.reservedMicroUsd,
  });

  // The RGV total for a cluster is the SUM of its four county rows. The seed file says so in
  // its own header and deliberately stores no column total: "a total spelled in prose is a
  // second source of truth that can silently disagree with its own parts."
  const rgvByCluster = new Map<string, number>();
  let texasOutlets = 0;
  for (const row of seed.outletCounts.outletCounts) {
    if (row.scope === 'county') {
      rgvByCluster.set(row.clusterKey, (rgvByCluster.get(row.clusterKey) ?? 0) + row.outlets);
    } else {
      texasOutlets += row.outlets;
    }
  }

  const cityOutlets = new Map<string, number>();
  for (const city of seed.cities.cities) {
    cityOutlets.set(`${city.countyFips}|${city.name}`, city.outletCount);
  }
  const countyOutlets = new Map<string, number>();
  for (const county of seed.counties.counties) {
    countyOutlets.set(county.fips, county.outletCount);
  }

  const clusters: ClusterOption[] = index.clusters.map((c) => ({
    id: c.id,
    key: c.key,
    displayName: c.displayName,
    outletLabel: `${counts.format(rgvByCluster.get(c.key) ?? 0)} RGV outlets`,
  }));

  const cities: CityOption[] = [...index.cityById.values()]
    .map((c) => ({
      id: c.id,
      name: c.name,
      countyFips: c.countyFips,
      outletLabel: `${counts.format(cityOutlets.get(`${c.countyFips}|${c.name}`) ?? 0)} outlets`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, APP_LOCALE));

  const allCounties = [...index.countyById.values()];
  const rgvFips = new Set(seed.counties.counties.filter((c) => c.isRgv).map((c) => c.fips));
  const rgvCounties: CountyOption[] = allCounties
    .filter((c) => rgvFips.has(c.fips))
    .map((c) => ({
      id: c.id,
      fips: c.fips,
      name: c.name,
      outletLabel: `${counts.format(countyOutlets.get(c.fips) ?? 0)} outlets`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, APP_LOCALE));

  return {
    clusters,
    cities,
    rgvCounties,
    texas: {
      countyIds: allCounties.map((c) => c.id),
      // The count comes from the rows that were actually read, so a seed that shipped 253
      // counties would say 253 rather than claiming a coverage it does not have.
      label: `Texas (${allCounties.length} counties)`,
      outletLabel: `${counts.format(texasOutlets)} outlets`,
    },
    texasMultiplier: multiplier,
    radiusOptions: [...RADIUS_MILE_OPTIONS],
  };
}

export async function getEditorReference(claims: OrgClaims): Promise<EditorReference> {
  return withOrg(claims, (tx) => readEditorReference(tx));
}

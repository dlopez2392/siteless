/**
 * Re-measure the outlet counts against the live Texas Comptroller sales-tax permit dataset
 * and REWRITE the committed JSON the seed loader reads.
 *
 *   pnpm refresh:outlet-counts
 *
 * This is the refresh story a migration structurally cannot have. drizzle-kit hashes
 * migration SQL and CONVENTIONS § Migrations forbids editing an applied file, while
 * Socrata's `rowsUpdatedAt` moves — so the counts live in `src/seed/data/*.json`, this
 * script re-derives them, and `tsx scripts/seed.ts` loads whatever is committed.
 *
 * 🔴 NEVER RUN IN CI. CI seeds from the committed JSON and must never depend on a third
 * party being up, nor spend a request budget. The drift alarm is
 * `tests/unit/outlet-counts.test.ts` (plan 02-02): it pins the totals, so a refresh that
 * MOVES a number fails loudly in review rather than updating the corpus quietly.
 *
 * 🔴 `outlet_naics_code` IS A SOCRATA *NUMBER*, and THE `000` SENTINEL. Both notes, and the
 * helpers that encode them (`quote`, `naicsPredicate`, the error-body echo), were lifted
 * verbatim into `src/lib/socrata/client.ts` in plan 03-03 so the Phase 3 ingest shares one
 * client with this script. Read them there. This file is still grepped for the absence of
 * SoQL's string-prefix function (`tests/unit/socrata.test.ts -t "naics prefix"`, which now
 * covers `src/lib/socrata/**` too) — do not reintroduce it, in code OR in a comment.
 *
 * 🔴 County codes here are `jrea-zgmq`'s ZERO-PADDED form (`paddedCountyCode`). The
 * closures dataset `3kx8-uryv` is UNPADDED; never reuse this script's formatter for it.
 *
 * After running, `pnpm format` — this writes canonical 2-space JSON and prettier owns the
 * final shape of the committed files.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  naicsPredicate,
  paddedCountyCode,
  quote,
  socrataCount,
  TEXAS_COUNTY_CODES,
} from '@/lib/socrata/client';
import type { CitiesFile, ClustersFile, CountiesFile, OutletCountsFile } from '../src/seed/types';

/** Active Sales Tax Permit Holders. The host is `src/lib/socrata/client.ts`'s constant. */
const DATASET = 'jrea-zgmq';

const dataPath = (name: string) =>
  fileURLToPath(new URL(`../src/seed/data/${name}`, import.meta.url));

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(dataPath(name), 'utf8')) as T;
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(dataPath(name), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

let requestCount = 0;

async function countWhere(where: string): Promise<number> {
  requestCount += 1;
  return socrataCount(DATASET, where);
}

async function main(): Promise<void> {
  const clusters = readJson<ClustersFile>('clusters.json');
  const counties = readJson<CountiesFile>('counties.json');
  const cities = readJson<CitiesFile>('cities.json');
  const outletCounts = readJson<OutletCountsFile>('outlet-counts.json');

  const measuredAt = new Date().toISOString().slice(0, 10);
  const rgvCounties = counties.counties.filter((c) => c.isRgv);
  if (rgvCounties.length === 0) throw new Error('refresh-outlet-counts: no RGV counties seeded');

  // 1. The cluster x county matrix, plus the statewide row per cluster.
  const rows: OutletCountsFile['outletCounts'] = [];
  for (const cluster of clusters.clusters) {
    const naics = naicsPredicate(cluster.naicsRanges);
    for (const county of rgvCounties) {
      const where = `outlet_county_code = ${quote(paddedCountyCode(county.comptrollerCode))} and ${naics}`;
      rows.push({
        scope: 'county',
        countyFips: county.fips,
        clusterKey: cluster.key,
        outlets: await countWhere(where),
      });
    }
  }
  for (const cluster of clusters.clusters) {
    rows.push({
      scope: 'state',
      countyFips: null,
      clusterKey: cluster.key,
      outlets: await countWhere(`${TEXAS_COUNTY_CODES} and ${naicsPredicate(cluster.naicsRanges)}`),
    });
  }
  // The county rows are grouped by cluster above and the state rows appended after, which is
  // the order the committed file already carries; rewriting it in a different order would
  // make every refresh a large diff regardless of whether a number moved.
  writeJson('outlet-counts.json', { ...outletCounts, measuredAt, outletCounts: rows });

  // 2. The all-NAICS county totals. Populated on the RGV counties only; the other 250 stay
  //    at 0 until a phase needs them, and are left untouched rather than re-measured (250
  //    extra requests to write 250 zeros).
  const refreshedCounties = counties.counties.map((county) => ({ ...county }));
  for (const county of refreshedCounties) {
    if (!county.isRgv) continue;
    county.outletCount = await countWhere(
      `outlet_county_code = ${quote(paddedCountyCode(county.comptrollerCode))}`,
    );
  }
  writeJson('counties.json', { ...counties, fetchedAt: measuredAt, counties: refreshedCounties });

  // 3. Per-city totals, folded over `nameVariants`. Rio Grande City is why: the source
  //    spells it RIO GRANDE CITY / RIO GRANDE CY / RIO GRANDE, and counting only the exact
  //    spelling under-reports it by 67 outlets. `in(...)` over every variant is the fold.
  const byFips = new Map(counties.counties.map((c) => [c.fips, c]));
  const refreshedCities = [];
  for (const city of cities.cities) {
    const county = byFips.get(city.countyFips);
    if (!county)
      throw new Error(
        `refresh-outlet-counts: city ${city.name} names unknown county ${city.countyFips}`,
      );
    if (city.nameVariants.length === 0) {
      throw new Error(`refresh-outlet-counts: city ${city.name} has no nameVariants to fold on`);
    }
    const variants = city.nameVariants.map(quote).join(',');
    const outletCount = await countWhere(
      `outlet_county_code = ${quote(paddedCountyCode(county.comptrollerCode))} and outlet_city in(${variants})`,
    );
    refreshedCities.push({ ...city, outletCount });
  }
  writeJson('cities.json', {
    ...cities,
    provenance: { ...cities.provenance, measuredAt },
    cities: refreshedCities,
  });

  console.log(
    `refresh-outlet-counts: rewrote outlet-counts.json, counties.json and cities.json from ${requestCount} Socrata requests (measuredAt ${measuredAt}).`,
  );
  console.log(
    'Now run `pnpm format` and `pnpm test:unit` — tests/unit/outlet-counts.test.ts pins the totals and is the drift alarm.',
  );
}

await main();

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
 * 🔴 `outlet_naics_code` IS A SOCRATA *NUMBER*. SoQL's string-prefix function applied to it
 * returns HTTP 400 `query.soql.type-mismatch` — attempted live during research
 * (02-RESEARCH.md Pitfall 6), so this is a type error and not a deprecation that a retry
 * or a newer API version would fix. Only NUMERIC RANGE predicates are expressible against
 * that column, which is why `src/seed/types.ts` states NAICS ranges as half-open
 * `{lo, hi}` intervals in the first place and why `naicsPredicate()` below emits `>=` / `<`
 * comparisons. This file is grepped for the absence of that prefix function; do not
 * reintroduce it, in code OR in a comment quoting it, or the grep stops discriminating.
 * `outlet_county_code` and `outlet_city` ARE text and are compared as strings.
 *
 * 🔴 THE `000` SENTINEL. The dataset carries 255 distinct `outlet_county_code` values:
 * 001–254 plus a `000` belonging to no Texas county (1 outlet). Every statewide figure here
 * filters `outlet_county_code between '001' and '254'`, because a statewide number that
 * cannot be reproduced by summing the 254 seeded counties is not usable by the
 * "Texas (254 counties)" geo preset.
 *
 * After running, `pnpm format` — this writes canonical 2-space JSON and prettier owns the
 * final shape of the committed files.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CitiesFile, ClustersFile, CountiesFile, OutletCountsFile } from '../src/seed/types';

const DATASET = 'https://data.texas.gov/resource/jrea-zgmq.json';

/** 001–254. The `000` sentinel belongs to no county and is excluded everywhere. */
const TEXAS_COUNTY_CODES = "outlet_county_code between '001' and '254'";

const dataPath = (name: string) =>
  fileURLToPath(new URL(`../src/seed/data/${name}`, import.meta.url));

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(dataPath(name), 'utf8')) as T;
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(dataPath(name), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Socrata string literals are single-quoted; a quote inside one is doubled. */
function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** The Comptroller's own county number, zero-padded — `outlet_county_code` is TEXT. */
function comptrollerCode(code: number): string {
  return String(code).padStart(3, '0');
}

let requestCount = 0;

async function countWhere(where: string): Promise<number> {
  const url = `${DATASET}?$select=count(1) as n&$where=${encodeURIComponent(where)}`;
  requestCount += 1;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    // A type-mismatch on outlet_naics_code arrives as a 400 with a SoQL error body. Print
    // it: "request failed" alone sent an earlier reader looking at the network.
    throw new Error(
      `refresh-outlet-counts: ${res.status} for ${where}\n${(await res.text()).slice(0, 400)}`,
    );
  }
  const body = (await res.json()) as Array<{ n?: string }>;
  const n = body[0]?.n;
  if (n === undefined) throw new Error(`refresh-outlet-counts: no count in response for ${where}`);
  return Number(n);
}

/** `lo` inclusive, `hi` exclusive — the same half-open form the seed types document. */
function naicsPredicate(ranges: Array<{ lo: number; hi: number }>): string {
  return (
    '(' +
    ranges
      .map((r) => `(outlet_naics_code >= ${r.lo} and outlet_naics_code < ${r.hi})`)
      .join(' or ') +
    ')'
  );
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
      const where = `outlet_county_code = ${quote(comptrollerCode(county.comptrollerCode))} and ${naics}`;
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
      `outlet_county_code = ${quote(comptrollerCode(county.comptrollerCode))}`,
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
      `outlet_county_code = ${quote(comptrollerCode(county.comptrollerCode))} and outlet_city in(${variants})`,
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

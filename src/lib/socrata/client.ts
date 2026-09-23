import { createHash } from 'node:crypto';

/**
 * The Texas Comptroller's Socrata datasets. ONE client, imported by
 * `scripts/refresh-outlet-counts.ts` (the seed counts) and by the Phase 3 ingest.
 *
 * LIFTED, NOT REWRITTEN (03-RESEARCH § Socrata Ingest Mechanics). `quote`, `naicsPredicate`,
 * the `000` sentinel and the error-body echo moved here verbatim from the counts script,
 * which had already paid for each of them. The one thing that did NOT survive the move
 * intact is the county formatter: it became two, because it is right for one dataset and
 * silently wrong for the other. See `paddedCountyCode` / `unpaddedCountyCode` below.
 *
 * 🔴 `outlet_naics_code` IS A SOCRATA *NUMBER*. SoQL's string-prefix function applied to it
 * returns HTTP 400 `query.soql.type-mismatch` — attempted live during research
 * (02-RESEARCH.md Pitfall 6), so this is a type error and not a deprecation that a retry
 * or a newer API version would fix. Only NUMERIC RANGE predicates are expressible against
 * that column, which is why `src/seed/types.ts` states NAICS ranges as half-open
 * `{lo, hi}` intervals in the first place and why `naicsPredicate()` below emits `>=` / `<`
 * comparisons. This directory is grepped for the absence of that prefix function
 * (`tests/unit/socrata.test.ts -t "naics prefix"`); do not reintroduce it, in code OR in a
 * comment quoting it, or the grep stops discriminating.
 * `outlet_county_code` and `outlet_city` ARE text and are compared as strings.
 *
 * 🔴 THE `000` SENTINEL. The dataset carries 255 distinct `outlet_county_code` values:
 * 001–254 plus a `000` belonging to no Texas county (1 outlet). Every statewide figure
 * filters `outlet_county_code between '001' and '254'` (`TEXAS_COUNTY_CODES` below),
 * because a statewide number that cannot be reproduced by summing the 254 seeded counties
 * is not usable by the "Texas (254 counties)" geo preset.
 *
 * NO `import 'server-only'` and NO `@/env` import, deliberately: this module is imported by
 * `tsx` scripts, where `server-only` resolves to its throwing entry and `src/env.ts` would
 * demand a Clerk key and a pool URL the counts script has never needed. The optional app
 * token is therefore read here with the same `||` normalisation `src/env.ts` applies, and
 * `src/env.ts` declares it so the deployed server validates it at boot.
 */

/** Hard-coded. T-3-05: no caller value ever reaches the host. */
const SOCRATA_HOST = 'https://data.texas.gov';

/** A Socrata four-by-four (`jrea-zgmq`). Refused otherwise, so a dataset argument can only
 *  ever be one path segment of the constant host — never a path, a query or a second host. */
const DATASET_ID = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

/** SoQL parameter names are `$` plus lowercase letters. The VALUES are percent-encoded; the
 *  names are checked, so a caller cannot smuggle `&` or `=` in through a key. */
const SOQL_PARAM = /^\$[a-z]+$/;

/** Measured 2026-09-22: `$limit=50000` returned all 34,928 RGV permit rows in 2,550 ms. */
export const SOCRATA_PAGE_LIMIT = 50_000;

/** A page loop that never shrinks is a server ignoring `$offset` (or a replay that does).
 *  100 pages is 5 M rows — three times the largest Comptroller dataset — so hitting it is
 *  a bug to report, not a dataset to keep reading. */
const MAX_PAGES = 100;

/** A 50,000-row page took 2.5 s. Bounded so a stalled socket fails the run instead of
 *  hanging it. */
const TIMEOUT_MS = 60_000;

/** 001–254. The `000` sentinel belongs to no county and is excluded everywhere. */
export const TEXAS_COUNTY_CODES = "outlet_county_code between '001' and '254'";

/** Socrata string literals are single-quoted; a quote inside one is doubled. */
export function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** `jrea-zgmq`.`outlet_county_code` is TEXT and ZERO-PADDED: county 31 is '031'. */
export function paddedCountyCode(code: number): string {
  return String(code).padStart(3, '0');
}

/** 🔴 `3kx8-uryv`.`loc_county` is TEXT and UNPADDED: county 31 is '31'. Measured live
 *  2026-09-22 — `loc_county = '031'` returns 0 rows, `'31'` returns 21,062. Using the padded
 *  form against this dataset returns 37,875 RGV rows instead of 58,937: a 36 % loss that
 *  looks like a plausible number. The two formatters exist separately, and
 *  `tests/unit/socrata.test.ts -t "unpadded county"` asserts they differ for 31. */
export function unpaddedCountyCode(code: number): string {
  return String(code);
}

/** `lo` inclusive, `hi` exclusive — the same half-open form the seed types document. */
export function naicsPredicate(ranges: Array<{ lo: number; hi: number }>): string {
  return (
    '(' +
    ranges
      .map((r) => `(outlet_naics_code >= ${r.lo} and outlet_naics_code < ${r.hi})`)
      .join(' or ') +
    ')'
  );
}

/**
 * The row identity BOTH Comptroller feeds share: `taxpayer_number-outlet_number` in
 * `jrea-zgmq`, `tp_number-loc_number` in `3kx8-uryv`. Verified on a real RGV row
 * (32006170057 / 5): exact string equality on both parts, no padding, no casting. One
 * function builds it for both feeds so the D-03 exact match cannot drift into two shapes.
 */
export function comptrollerExternalId(taxpayerNumber: string, outletNumber: string): string {
  return `${taxpayerNumber}-${outletNumber}`;
}

/** Deterministic JSON: object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
}

/**
 * `sha256` over the CANONICAL serialization of the selected fields — never
 * `JSON.stringify(row)`. Socrata's key order is stable today but it is not a contract; a
 * re-ordering would make every row hash differently and report the whole feed `changed`.
 */
export function payloadHash(selected: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(selected)).digest('hex');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  // Optional. No rate-limit headers were observed and 15+ unauthenticated requests in one
  // session were never throttled; a token only buys the app its own pool. `||` rather than
  // `??` for the same reason src/env.ts gives: an absent CI secret arrives as ''.
  const token = process.env.SOCRATA_APP_TOKEN || undefined;
  if (token) h['X-App-Token'] = token;
  return h;
}

function assertDataset(dataset: string): void {
  if (!DATASET_ID.test(dataset)) {
    throw new Error(`socrata: refusing dataset id ${JSON.stringify(dataset)} (expected xxxx-xxxx)`);
  }
}

function buildUrl(dataset: string, params: Record<string, string>): string {
  assertDataset(dataset);
  const query = Object.entries(params)
    .map(([k, v]) => {
      if (!SOQL_PARAM.test(k))
        throw new Error(`socrata: refusing parameter name ${JSON.stringify(k)}`);
      return `${k}=${encodeURIComponent(v)}`;
    })
    .join('&');
  return `${SOCRATA_HOST}/resource/${dataset}.json?${query}`;
}

async function getJson(url: string, context: string): Promise<unknown> {
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    // A type-mismatch on outlet_naics_code arrives as a 400 with a SoQL error body. Print
    // it: "request failed" alone sent an earlier reader looking at the network.
    throw new Error(`socrata: ${res.status} for ${context}\n${(await res.text()).slice(0, 400)}`);
  }
  return res.json();
}

/**
 * `select count(1)` under a `$where`. The counts script's request, unchanged: same
 * `$select`, same encoding of the predicate.
 */
export async function socrataCount(dataset: string, where: string): Promise<number> {
  const body = (await getJson(
    buildUrl(dataset, { $select: 'count(1) as n', $where: where }),
    where,
  )) as Array<{ n?: string }> | undefined;
  const n = Array.isArray(body) ? body[0]?.n : undefined;
  if (n === undefined) throw new Error(`socrata: no count in response for ${where}`);
  return Number(n);
}

/**
 * Every row matching `params`, paged.
 *
 * `$limit` (default 50,000) is the page size; `$offset` is owned here and refused from the
 * caller. The loop stops on the first page shorter than `$limit`. `$offset=30000` cost
 * 440 ms when measured, so there is no deep-offset cliff and keyset paging is unnecessary.
 *
 * 🔴 `$order` IS MANDATORY. Without it Socrata gives no stability guarantee across pages, so
 * an offset loop can skip or repeat rows between requests and nothing would notice. This
 * refuses to run without one.
 *
 * Rows come back UNVALIDATED — `T` is the caller's claim, not a check. Every caller parses
 * each row with its dataset's zod schema (`permitRowSchema`, `closureRowSchema`).
 */
export async function socrataQuery<T = unknown>(
  dataset: string,
  params: Record<string, string>,
): Promise<T[]> {
  if (!params.$order) {
    throw new Error('socrata: $order is required — offset paging without it is not stable');
  }
  if (params.$offset !== undefined) {
    throw new Error('socrata: $offset is owned by socrataQuery; pass $limit only');
  }
  const limit = params.$limit === undefined ? SOCRATA_PAGE_LIMIT : Number(params.$limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`socrata: $limit must be a positive integer, got ${params.$limit}`);
  }

  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * limit;
    const url = buildUrl(dataset, { ...params, $limit: String(limit), $offset: String(offset) });
    const body = await getJson(url, `${dataset} ${params.$where ?? ''} @${offset}`);
    if (!Array.isArray(body))
      throw new Error(`socrata: ${dataset} page @${offset} is not an array`);
    rows.push(...(body as T[]));
    if (body.length < limit) return rows;
  }
  throw new Error(`socrata: ${dataset} did not finish within ${MAX_PAGES} pages of ${limit}`);
}

/**
 * The dataset's `rowsUpdatedAt` as an ISO instant — the `source_version` every ingested
 * source record carries. Read from the metadata endpoint, not from the data request; the
 * data request's `Last-Modified` header is the same instant and serves as a cross-check.
 */
export async function socrataRowsUpdatedAt(dataset: string): Promise<string> {
  assertDataset(dataset);
  const body = (await getJson(
    `${SOCRATA_HOST}/api/views/${dataset}.json`,
    `${dataset} metadata`,
  )) as {
    rowsUpdatedAt?: unknown;
  };
  const epochSeconds = body?.rowsUpdatedAt;
  if (typeof epochSeconds !== 'number' || !Number.isInteger(epochSeconds) || epochSeconds <= 0) {
    throw new Error(`socrata: ${dataset} metadata carries no usable rowsUpdatedAt`);
  }
  return new Date(epochSeconds * 1000).toISOString();
}

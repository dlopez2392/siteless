import { z } from 'zod';

import { nameNorm } from '@/lib/normalize';
import { socrataQuery, TEXAS_COUNTY_CODES } from './client';
import { PERMITS_DATASET } from './permits';

/**
 * The ONE statewide request that makes D-11's "across Texas" honest.
 *
 * This phase's spine is the four RGV counties, so counting a name's outlets in the spine
 * alone would miss a national chain with two RGV outlets and 400 elsewhere: the badge would
 * say `Chain · 2 in Texas` about a business that has hundreds, or say nothing at all. One
 * grouped Socrata request over the whole state closes that gap without ingesting the other
 * ~850,000 outlets:
 *
 *   $select = outlet_name,count(1) as n
 *   $where  = outlet_county_code between '001' and '254'   (the `000` sentinel excluded)
 *   $group  = outlet_name
 *   $having = count(1)>=3
 *   $order  = outlet_name                                   (offset paging needs one)
 *
 * MEASURED LIVE 2026-09-22, while this plan was executed (three read-only GETs, no script
 * run): the request is valid SoQL and answers **11,647** groups covering **82,305** outlets
 * in ONE page of **548 KB** in **1.8 s** — `$offset=20000` already returns `[]`. So the
 * request is practical, and the "in the RGV" copy fallback 03-12-PLAN describes was NOT
 * needed. Largest group: `HRB TECHNOLOGY LLC` (H&R Block), 437 outlets.
 *
 * KEYED BY `nameNorm(outlet_name)`, never by the raw string, so the map joins against
 * `businesses.name_norm` — the same normalizer wrote both sides (D-12: TypeScript is the
 * single normalizer; SQL never normalizes). Several raw spellings can fold into one key
 * (`100 % ANTOJITOS MEXICANOS` and `..., INC` both become `100 antojitos mexicanos`); their
 * counts are SUMMED.
 *
 * ⚠ One known under-count, stated rather than hidden: `$having` filters RAW groups before
 * the fold, so a name whose every raw spelling has fewer than three outlets is absent even
 * if the spellings together reach three. Dropping the `$having` would mean paging the whole
 * ~600k-group result to recover the tail of a tail; the RGV-local count in
 * `chainDetectionSql` (03-10) still sees those rows.
 *
 * PURE apart from the one `socrataQuery` call, and NOT called from anything under `src/`:
 * `scripts/ingest-comptroller.ts` is the only caller (D-01). No `server-only`, no `@/env`,
 * for the same tsx reason `./client.ts` gives.
 */

/** A name needs this many statewide outlets to count as a chain (D-11). */
export const STATEWIDE_CHAIN_THRESHOLD = 3;

/** The grouped request, exactly. Every value is a literal — no caller input reaches SoQL
 *  (T-3-04). The `$where` is spelled out rather than imported so the file can be grepped
 *  for it; the load-time check below keeps it identical to the client's sentinel. */
export const STATEWIDE_NAMES_QUERY = {
  $select: 'outlet_name,count(1) as n',
  $where: "outlet_county_code between '001' and '254'",
  $group: 'outlet_name',
  $having: `count(1)>=${STATEWIDE_CHAIN_THRESHOLD}`,
  $order: 'outlet_name',
} as const satisfies Record<string, string>;

if (STATEWIDE_NAMES_QUERY.$where !== TEXAS_COUNTY_CODES) {
  throw new Error('statewide-names: the $where drifted from TEXAS_COUNTY_CODES (the 000 sentinel)');
}

/**
 * One grouped row. Socrata OMITS a null field rather than sending `null`, so a group whose
 * `outlet_name` is null arrives with no name at all — skipped, not refused (none observed in
 * the measured response). `n` arrives as a string (`"437"`).
 */
const groupRowSchema = z.object({
  outlet_name: z.string().max(200).optional(),
  n: z.coerce.number().int().positive(),
});

/**
 * The statewide outlet count per normalized name, for names with at least
 * `STATEWIDE_CHAIN_THRESHOLD` outlets. Every row is validated (T-3-03); a malformed one
 * throws rather than silently shrinking the map.
 */
export async function fetchStatewideNameFrequency(): Promise<Map<string, number>> {
  const rows = await socrataQuery(PERMITS_DATASET, { ...STATEWIDE_NAMES_QUERY });
  return foldStatewideRows(rows);
}

/** The fold, separated so a test can feed it rows without a request. */
export function foldStatewideRows(rows: readonly unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of rows) {
    const row = groupRowSchema.parse(raw);
    const key = nameNorm(row.outlet_name);
    if (key === null) continue;
    out.set(key, (out.get(key) ?? 0) + row.n);
  }
  return out;
}

import { TZDate } from '@date-fns/tz';
import { z } from 'zod';

import { APP_TZ } from '@/lib/time';
import { comptrollerExternalId, payloadHash, quote } from './client';

/**
 * `3kx8-uryv` — the closure feed for D-03.
 *
 * 🔴 THIS DATASET IS NOT WHAT ITS NICKNAME SAYS. It is not "the out-of-business dataset".
 * Its title is **All Permitted Sales Tax Locations and Local Sales Tax Responsibility**, it
 * holds **1,452,890** rows (queried live 2026-09-22), most of them OPEN locations, and it
 * carries a nullable `out_of_business_date`. D-03's intent — mark a business closed when
 * the Comptroller says it closed — survives intact; the field names and the county-code
 * format CONTEXT wrote down do not:
 *
 * | | `jrea-zgmq` (permits) | `3kx8-uryv` (this) |
 * |---|---|---|
 * | taxpayer / outlet | `taxpayer_number` / `outlet_number` | `tp_number` / `loc_number` |
 * | name | `outlet_name` | `loc_name` |
 * | county | `outlet_county_code`, zero-padded | `loc_county`, 🔴 UNPADDED |
 * | closure | — | `out_of_business_date`, nullable |
 *
 * 🔴 THE COUNTY CODES ARE UNPADDED. Measured live: `loc_county = '031'` returns **0 rows**;
 * `loc_county = '31'` returns **21,062**. Querying this dataset with the permits feed's padded
 * RGV list returns **37,875** rows instead of **58,937** — a silent 36 % loss that looks like
 * a perfectly plausible number, because Hidalgo/Starr/Willacy (three digits either way) still
 * match and only Cameron vanishes. Do not "fix" the list below back to the padded form, and
 * do not reuse `RGV_PADDED_COUNTY_CODES` here.
 *
 * Only the closures are fetched: `CLOSURES_RGV_WHERE` → **21,509** rows in one request
 * (measured). The other 1.4 M rows are never ingested.
 *
 * PURE, like `./permits`: no I/O in this module.
 */

export const CLOSURES_DATASET = '3kx8-uryv';

/** Cameron, Hidalgo, Starr, Willacy as `loc_county` spells them: TEXT, UNPADDED. */
export const RGV_UNPADDED_COUNTY_CODES = ['31', '108', '214', '245'] as const;

/** The D-03 closure request, assembled from the literal list above only (T-3-04). */
export const CLOSURES_RGV_WHERE =
  `loc_county in (${RGV_UNPADDED_COUNTY_CODES.map(quote).join(',')}) ` +
  'and out_of_business_date IS NOT NULL';

/**
 * Socrata's floating timestamp: no `Z`, no offset. Anything carrying a zone is refused
 * rather than reinterpreted — if the upstream ever starts sending instants, the Chicago
 * reading below would become wrong, and a refusal is how that gets noticed.
 */
const FLOATING_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;

/**
 * Exactly the fields the closure transform reads (T-3-03); zod strips the other ~28
 * columns, including the taxpayer's name and mailing address.
 *
 * `out_of_business_date` is REQUIRED here even though the dataset column is nullable: this
 * is the schema for the CLOSURE feed, whose request filters `IS NOT NULL`. An open location
 * reaching it means the request drifted, and refusing it keeps an open business from being
 * written as closed.
 */
export const closureRowSchema = z.object({
  tp_number: z.string().regex(/^\d{1,20}$/),
  loc_number: z.string().regex(/^\d{1,10}$/),
  // 🔴 B-WR-09: OPTIONAL, and not held to 200. The D-03 match reads only the key and the
  // date; the ingest never uses the name. Socrata omits a null column, and a required or
  // capped name rejected the row, leaving a closed business `active` and served as a lead.
  loc_name: z.string().max(500).optional(),
  // 🔴 UNPADDED: '31', never a zero-led form. A leading zero means a padded code was
  // written into this dataset's filter somewhere upstream.
  loc_county: z.string().regex(/^[1-9]\d{0,2}$/),
  out_of_business_date: z.string().regex(FLOATING_TIMESTAMP),
});

export type ClosureRow = z.infer<typeof closureRowSchema>;

export type ClosureSourceRecord = {
  sourceKey: 'tx_comptroller_closures';
  /** Same shape as the permits feed's key — that equality IS the D-03 exact match. */
  externalId: string;
  sourceVersion: string;
  retentionClass: 'durable';
  payload: ClosureRow;
  payloadHash: string;
  /** `null` when the feed sent no name, or a blank one (B-WR-09). */
  legalName: string | null;
  /** The Comptroller's integer county code (31), NOT the Census FIPS (48061). */
  countyCode: number;
  closedAt: Date;
};

/**
 * A Texas business date, read in the app zone (`APP_TZ`, America/Chicago).
 *
 * 🔴 `out_of_business_date` arrives as `"1993-03-03T00:00:00.000"` with NO zone suffix.
 * Parsed as UTC — or in the process zone, which on Vercel IS UTC — Chicago midnight becomes
 * 18:00 or 19:00 the evening before, and every closure lands a day early (on 31 December, a
 * year early). The wall-clock fields are handed to `TZDate` in the app zone, so the offset is
 * the one Chicago actually had on that date: 06:00Z in CST, 05:00Z in CDT.
 */
function texasBusinessDate(floating: string): Date {
  const m = FLOATING_TIMESTAMP.exec(floating);
  if (!m) throw new Error(`closures: not a floating timestamp: ${floating}`);
  const [, y, mo, d, h, mi, s, ms] = m.map(Number) as number[];
  const local = new TZDate(y!, mo! - 1, d!, h!, mi!, s!, ms!, APP_TZ);
  return new Date(local.getTime());
}

/**
 * One parsed closure row → one `tx_comptroller_closures` source record. Pure.
 *
 * The external id is built by the same `comptrollerExternalId` the permits transform uses,
 * so `tp_number-loc_number` here and `taxpayer_number-outlet_number` there cannot drift into
 * two shapes. Verified on a real RGV row: 32006170057 / 5 is the same business in both.
 */
export function closureRowToSourceRecord(
  row: ClosureRow,
  sourceVersion: string,
): ClosureSourceRecord {
  return {
    sourceKey: 'tx_comptroller_closures',
    externalId: comptrollerExternalId(row.tp_number, row.loc_number),
    sourceVersion,
    retentionClass: 'durable',
    payload: row,
    payloadHash: payloadHash(row),
    legalName: row.loc_name !== undefined && row.loc_name.trim() !== '' ? row.loc_name : null,
    countyCode: Number(row.loc_county),
    closedAt: texasBusinessDate(row.out_of_business_date),
  };
}

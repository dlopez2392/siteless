import { z } from 'zod';

import type { NaicsRange } from '@/seed/types';
import { comptrollerExternalId, payloadHash, quote } from './client';

/**
 * `jrea-zgmq` — Active Sales Tax Permit Holders (Texas Comptroller). One row per permitted
 * OUTLET: a taxpayer with three shops is three rows, keyed `taxpayer_number-outlet_number`.
 *
 * PURE. No I/O here: `socrataQuery` in `./client` fetches, `scripts/` orchestrates, and this
 * module turns one already-fetched row into one source record. That is what lets the test
 * feed it recorded rows with no network and no database in its import graph.
 *
 * 🔴 `outlet_address` IS THE LOCATION. The row also carries `taxpayer_address`, which is the
 * taxpayer's MAILING address — a PO box, an accountant, the owner's house (PITFALLS,
 * integration gotchas). It is not read, not parsed and not stored: the schema below does not
 * name it, so zod strips it before the payload is built.
 */

export const PERMITS_DATASET = 'jrea-zgmq';

/**
 * Cameron, Hidalgo, Starr, Willacy as `outlet_county_code` spells them: TEXT, ZERO-PADDED.
 * Measured 2026-09-22: the RGV filter returns **34,928** rows, all in one 50,000-row page.
 * 🔴 These are the WRONG codes for `3kx8-uryv`, which is unpadded — see `./closures`.
 */
export const RGV_PADDED_COUNTY_CODES = ['031', '108', '214', '245'] as const;

/** The whole-RGV permits `$where`, assembled from the literal list above only (T-3-04). */
export const PERMITS_RGV_WHERE = `outlet_county_code in (${RGV_PADDED_COUNTY_CODES.map(quote).join(',')})`;

/** Socrata's zoneless floating timestamp, e.g. `2002-05-09T00:00:00.000`. */
const FLOATING_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;

/**
 * EXACTLY the fields the transform reads, each bounded in type and length (T-3-03). zod
 * strips every other column — `taxpayer_name`, `taxpayer_address` and the rest — so the
 * payload's other fields never become ours by accident.
 *
 * Identity fields are required. Location fields are optional because Socrata OMITS a null
 * field rather than sending `null`; a row missing its address is still a real permit, and
 * rejecting it would hide the outlet rather than flag it.
 */
export const permitRowSchema = z.object({
  taxpayer_number: z.string().regex(/^\d{1,20}$/),
  outlet_number: z.string().regex(/^\d{1,10}$/),
  outlet_name: z.string().min(1).max(200),
  outlet_address: z.string().max(200).optional(),
  outlet_city: z.string().max(100).optional(),
  outlet_state: z.string().max(2).optional(),
  outlet_zip_code: z.string().max(10).optional(),
  // Zero-padded, always three digits in this dataset. An unpadded code here means the
  // wrong dataset's row reached this schema.
  outlet_county_code: z.string().regex(/^\d{3}$/),
  // 🔴 The Socrata column type is `number`, but the JSON payload sends it as a STRING
  // ("561311"). `z.number()` here would be a runtime failure on every row; coercing to a
  // string accepts both arrivals and keeps leading structure intact.
  outlet_naics_code: z.optional(z.coerce.string().regex(/^\d{2,6}$/)),
  outlet_permit_issue_date: z.string().regex(FLOATING_TIMESTAMP).optional(),
  outlet_first_sales_date: z.string().regex(FLOATING_TIMESTAMP).optional(),
});

export type PermitRow = z.infer<typeof permitRowSchema>;

/** A seeded cluster's NAICS ranges, as `industry_clusters` / `clusters.json` state them. */
export type ClusterNaicsRanges = { key: string; naicsRanges: NaicsRange[] };

export type ComptrollerSourceRecord = {
  sourceKey: 'tx_comptroller';
  externalId: string;
  sourceVersion: string;
  retentionClass: 'durable';
  payload: PermitRow;
  payloadHash: string;
  /** The Comptroller DBA — `legal_name`, never `display_name` (PROJECT.md § Data). */
  legalName: string;
  street: string | null;
  city: string | null;
  postal: string | null;
  /** The Comptroller's integer county code (31), NOT the Census FIPS (48061). */
  countyCode: number;
  naics: string | null;
  clusterKey: string | null;
};

/** `lo` inclusive, `hi` exclusive — the same half-open form `naicsPredicate` queries with. */
function clusterFor(naics: string | undefined, clusters: ClusterNaicsRanges[]): string | null {
  if (naics === undefined) return null;
  const code = Number(naics);
  for (const cluster of clusters) {
    if (cluster.naicsRanges.some((r) => code >= r.lo && code < r.hi)) return cluster.key;
  }
  return null;
}

/**
 * One parsed `jrea-zgmq` row → one `tx_comptroller` source record. Pure.
 *
 * `clusters` is passed in — the seeded ranges, never a table hard-coded here — so a
 * re-seeded cluster definition reaches the ingest without touching this file.
 */
export function comptrollerRowToSourceRecord(
  row: PermitRow,
  sourceVersion: string,
  clusters: ClusterNaicsRanges[],
): ComptrollerSourceRecord {
  return {
    sourceKey: 'tx_comptroller',
    externalId: comptrollerExternalId(row.taxpayer_number, row.outlet_number),
    sourceVersion,
    retentionClass: 'durable',
    payload: row,
    payloadHash: payloadHash(row),
    legalName: row.outlet_name,
    // outlet_address, never taxpayer_address: see the header.
    street: row.outlet_address ?? null,
    city: row.outlet_city ?? null,
    postal: row.outlet_zip_code ?? null,
    countyCode: Number(row.outlet_county_code),
    naics: row.outlet_naics_code ?? null,
    clusterKey: clusterFor(row.outlet_naics_code, clusters),
  };
}

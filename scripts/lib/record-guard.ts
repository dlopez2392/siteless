/**
 * The recorder's three walls (scripts/record-places-fixtures.ts), each checked BEFORE the script
 * loads a single `src/` module or opens a connection:
 *
 *   1. `parseRecordArgs` — the arguments, including the request cap (D-04: a recording is a handful
 *      of requests, never a sweep). `--ids-only` is 04-31's D-03 key verification: exactly ONE
 *      free call, and any other explicit `--max-requests` is refused rather than ignored.
 *   2. `assertLegalRecord` — D-01: no real Places call of any SKU before PROJECT.md's Key
 *      Decisions carries the legal gate's row, and that row says yes (counsel or danlo's written
 *      risk call). A `no` — or an answer this file cannot read — refuses.
 *   3. `assertLocalTarget` — the LOCAL database only (the scripts/db.ts rule, D-04): the owner URL
 *      AND the runtime pool the meter reserves through are both checked, so a recording can never
 *      reserve, ledger or plan against production.
 *
 * Pure: no I/O, no env reads — the caller passes the text and the URLs in, so every refusal is
 * unit-tested (tests/unit/anonymize-places.test.ts).
 */
import { isTableAType } from '@/lib/places/place-types';

/** The hard cap on requests per recorder invocation (D-04). One search is at most 3 pages. */
export const MAX_RECORD_REQUESTS = 10;

/** The default when `--max-requests` is omitted: one search's three pages. */
const DEFAULT_MAX_REQUESTS = 3;

export type RecordArgs = {
  /** `search_versions.id` of a LOCAL preset version; its org is the org the run is recorded in. */
  version: string;
  /** A Table A Places type (the request's `includedType`). */
  type: string;
  /** `<unitKind>:<unitId in its DB-safe form>`, e.g. `city:48215/McAllen`. */
  unit: string;
  /** A quadtree path below the unit's root, e.g. `r0`; absent = the root `r`. */
  quad?: string;
  maxRequests: number;
  /** Fixture basename: `places-recorded-<out>-p<N>.json`. Required unless `--ids-only`. */
  out?: string;
  /** 04-31's D-03 verification: one free IDs-only request, run kind change_check. */
  idsOnly: boolean;
};

const FLAGS = [
  '--version=',
  '--type=',
  '--unit=',
  '--quad=',
  '--max-requests=',
  '--out=',
  '--ids-only',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure. Refuses an unknown or repeated flag rather than ignoring it: a typo must never reach
 *  a billed request with a default the operator did not choose. */
export function parseRecordArgs(argv: readonly string[]): RecordArgs {
  const seen = new Set<string>();
  for (const arg of argv) {
    const flag = FLAGS.find((f) => (f.endsWith('=') ? arg.startsWith(f) : arg === f));
    if (!flag) {
      throw new Error(
        `record-places: unknown argument ${JSON.stringify(arg)} (expected ${FLAGS.join(' ')})`,
      );
    }
    if (seen.has(flag)) throw new Error(`record-places: ${flag.replace('=', '')} given twice`);
    seen.add(flag);
  }
  const value = (flag: string) => argv.find((a) => a.startsWith(flag))?.slice(flag.length);

  const version = value('--version=') ?? '';
  if (!UUID.test(version))
    throw new Error('record-places: --version=<search_versions uuid> is required');

  const type = value('--type=') ?? '';
  if (!isTableAType(type)) {
    throw new Error('record-places: --type must be a Table A Places type (e.g. plumber)');
  }

  const unit = value('--unit=') ?? '';
  if (!/^(city|county):[A-Za-z0-9 ./'-]{1,80}$/.test(unit)) {
    throw new Error('record-places: --unit=<city|county>:<unit id, DB-safe> is required');
  }

  const quad = value('--quad=');
  if (quad !== undefined && !/^r[0-3]{0,5}$/.test(quad)) {
    throw new Error('record-places: --quad must be a quadtree path such as r, r0 or r21');
  }

  const out = value('--out=');
  if (out !== undefined && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(out)) {
    throw new Error('record-places: --out must be a lower-case basename (a-z, 0-9, -)');
  }

  const idsOnly = argv.includes('--ids-only');
  const rawMax = value('--max-requests=');
  let maxRequests: number;
  if (rawMax === undefined) {
    maxRequests = idsOnly ? 1 : DEFAULT_MAX_REQUESTS;
  } else {
    if (!/^\d+$/.test(rawMax)) throw new Error('record-places: --max-requests must be an integer');
    maxRequests = Number(rawMax);
    if (maxRequests < 1 || maxRequests > MAX_RECORD_REQUESTS) {
      throw new Error(`record-places: --max-requests must be 1..${MAX_RECORD_REQUESTS}`);
    }
  }
  if (idsOnly && maxRequests !== 1) {
    throw new Error('record-places: --ids-only is exactly one request (--max-requests=1 or none)');
  }
  if (!idsOnly && out === undefined) {
    throw new Error(
      'record-places: a billed recording needs --out=<basename> (it exists to write)',
    );
  }

  return {
    version,
    type,
    unit,
    ...(quad === undefined ? {} : { quad }),
    maxRequests,
    ...(out === undefined ? {} : { out }),
    idsOnly,
  };
}

/** The Key Decisions section of PROJECT.md: from its heading to the next `## ` heading. */
function keyDecisions(projectMd: string): string {
  const lines = projectMd.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Key Decisions\s*$/.test(l));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * D-01. Throws unless PROJECT.md's Key Decisions table has a row naming `D-01` and `Places`
 * whose decision reads `D-01 Places legal gate — counsel-yes` or `— danlo-risk-call` (the
 * format 04-29 writes). A `— no`, a row this cannot read, or a mention outside the table refuses.
 */
export function assertLegalRecord(projectMd: string): void {
  const rows = keyDecisions(projectMd)
    .split('\n')
    .filter((l) => l.trimStart().startsWith('|') && l.includes('D-01') && l.includes('Places'));
  if (rows.length === 0) {
    throw new Error(
      'record-places: PROJECT.md Key Decisions has no D-01 Places row. D-01: no real Places call ' +
        'of any SKU before the legal gate (04-29) is recorded.',
    );
  }
  for (const row of rows) {
    const decision = row.split('|')[1] ?? '';
    if (/D-01 Places legal gate\s*[—–-]+\s*no\b/i.test(decision)) {
      throw new Error('record-places: D-01 is recorded as NO. No Places call may be made.');
    }
    if (/D-01 Places legal gate\s*[—–-]+\s*(counsel-yes|danlo-risk-call)\b/.test(decision)) return;
  }
  throw new Error(
    'record-places: the D-01 row does not read "D-01 Places legal gate — counsel-yes" or ' +
      '"— danlo-risk-call". Refusing rather than guessing.',
  );
}

/**
 * D-04, the scripts/db.ts rule: the recorder runs against the LOCAL test database only. `target`
 * must be `test`; `url` must be set, must not name a Supabase host, and its host must be
 * localhost / 127.0.0.1 / ::1. The URL is never echoed (it carries a password).
 */
export function assertLocalTarget(target: string, url: string | undefined): void {
  if (target !== 'test') {
    throw new Error(
      `record-places: target ${JSON.stringify(target)} refused — the local test database only (D-04)`,
    );
  }
  if (!url)
    throw new Error('record-places: the database URL is not set (see docs/local-postgres.md)');
  if (/supabase\.(co|com)|pooler\.supabase/i.test(url)) {
    throw new Error(
      'record-places: refuses a Supabase host. D-04: production is never a recording target.',
    );
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('record-places: the database URL does not parse');
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') {
    throw new Error(
      'record-places: the database host is not local. D-04: the local database only.',
    );
  }
}

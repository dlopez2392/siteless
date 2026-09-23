/**
 * 🔴🔴 THIS SCRIPT MAKES REAL, BILLED GOOGLE PLACES CALLS. Run it only at 04-32 (the D-04
 * recording), after danlo's D-01 legal gate (04-29) and the GCP key + quota setup (D-03, 04-31) —
 * and, in `--ids-only` mode, for 04-31's single free key-verification call. No test runs it.
 *
 *   pnpm record:places --version=<local search_versions uuid> --type=<Table A type>
 *                      --unit=<city|county>:<unit id, DB-safe> [--quad=r0] [--max-requests=3]
 *                      [--out=<basename>] [--ids-only]
 *   (= node --conditions=react-server --import tsx scripts/record-places-fixtures.ts …)
 *
 *   04-31:  pnpm record:places --ids-only --max-requests=1 --version=<id> --type=plumber --unit=city:48215/McAllen
 *   04-32:  pnpm record:places --version=<id> --type=plumber --unit=city:48215/McAllen --max-requests=3 --out=mcallen-plumber
 *
 * THE GUARDS, in order, BEFORE any `src/` module loads or any connection opens
 * (scripts/lib/record-guard.ts, unit-tested):
 *   1. the arguments — unknown or repeated flags refused; `--max-requests` 1..10 (default 3, one
 *      search's pages); `--ids-only` is exactly one request; a billed recording needs `--out`;
 *   2. D-01 — PROJECT.md's Key Decisions must carry "D-01 Places legal gate — counsel-yes" or
 *      "— danlo-risk-call";
 *   3. D-04 — `.env.local` is loaded, and BOTH the owner URL (TEST_DATABASE_URL) and the runtime
 *      pool the meter reserves through (SUPABASE_DB_POOL_URL) must be the local database.
 *
 * THEN, through the product's own primitives (scripts/lib/record-pages.ts):
 *   - as the owner, with the version's own org claim: a `running` run whose `ceiling_requests` is
 *     the cap (`full_sweep`, or `change_check` for `--ids-only`) and its one planned search;
 *   - per page: `reservePage` → `searchText` → `settleOrRelease` — reserved and ledgered like any
 *     product request (criterion 5) — and the parsed page is anonymized IN MEMORY at once
 *     (scripts/lib/anonymize-places.ts, D-20). The raw payload is never written, logged or thrown;
 *   - the run is closed (`complete` / `partial` / `failed`); the search is marked `stopped`, never
 *     `done`, because a recording writes no tile membership.
 *   - with `--out`: every page is anonymized AGAIN on the line that writes it (the anonymizer is a
 *     fixpoint), checked by `assertAnonymizedPage`, and written as
 *     `tests/unit/msw/fixtures/places-recorded-<out>-p<N>.json`; the sidecar entry says
 *     `synthetic: false, anonymized: true` with `recordedAt` and `requests`. An existing file is
 *     never overwritten.
 *   Prints the outcome, the request count, the ids seen and the ledgered cost.
 *
 * 🔴 KNOWN RISK FOR 04-32 (from 04-12): src/lib/places/response.ts parses `businessStatus` as a
 * strict three-value enum. A real page carrying any other value (e.g. BUSINESS_STATUS_UNSPECIFIED)
 * fails the whole page as `bad_shape` — charged, nothing recorded. The script names this if it
 * happens; the fix is in the schema, not here.
 *
 * Importable without side effects (the unit lane imports `writeRecording`); `main()` runs only
 * when this file is the process entry point.
 */
import * as fs from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { anonymizePage, assertAnonymizedPage, type AnonymizeContext } from './lib/anonymize-places';
import {
  assertLegalRecord,
  assertLocalTarget,
  parseRecordArgs,
  type RecordArgs,
} from './lib/record-guard';

const PROJECT_MD = new URL('../.planning/PROJECT.md', import.meta.url);
const ENV_FILE = new URL('../.env.local', import.meta.url);
export const FIXTURES_DIR = new URL('../tests/unit/msw/fixtures/', import.meta.url);
const SIDECAR_FILE = 'places-recordings.json';

type SidecarEntry = Record<string, unknown>;
type Sidecar = { files: Record<string, SidecarEntry> } & Record<string, unknown>;

/**
 * Writes the anonymized pages and their sidecar entries into `dir` (the msw fixtures directory by
 * default). Each page is anonymized again and checked on the way to the file. Refuses to overwrite.
 * Returns the file names written.
 */
export function writeRecording(
  a: {
    out: string;
    pages: Record<string, unknown>[];
    anonymize: Omit<AnonymizeContext, 'page'>;
    requests: number;
    truncatedByCap: boolean;
    recordedAt: string;
    purpose: string;
  },
  dir: URL = FIXTURES_DIR,
): string[] {
  const names = a.pages.map((_, i) => `places-recorded-${a.out}-p${i + 1}.json`);
  for (const name of names) {
    if (fs.existsSync(new URL(name, dir))) {
      throw new Error(`record-places: ${name} already exists — choose another --out`);
    }
  }
  const sidecarUrl = new URL(SIDECAR_FILE, dir);
  const sidecar = JSON.parse(fs.readFileSync(sidecarUrl, 'utf8')) as Sidecar;

  a.pages.forEach((page, i) => {
    const name = names[i] as string;
    // Anonymized again on the line that writes it: a fixpoint on an anonymized page, and a
    // wall if the loop ever handed over something else.
    const safe = anonymizePage(page, { ...a.anonymize, page: i + 1 });
    assertAnonymizedPage(safe, name);
    fs.writeFileSync(new URL(name, dir), JSON.stringify(safe, null, 2) + '\n');
    const count = Array.isArray(safe.places) ? safe.places.length : 0;
    sidecar.files[name] = {
      purpose: `${a.purpose}, page ${i + 1} of ${names.length}`,
      places: count,
      nextPageToken: typeof safe.nextPageToken === 'string',
      synthetic: false,
      anonymized: true,
      recordedAt: a.recordedAt,
      requests: a.requests,
      ...(a.truncatedByCap && i === names.length - 1 ? { truncatedByCap: true } : {}),
    };
  });
  sidecar.anonymized = true;
  sidecar.recordedFrom =
    'Places API (New) Text Search, via scripts/record-places-fixtures.ts, anonymized in memory (D-20)';
  fs.writeFileSync(sidecarUrl, JSON.stringify(sidecar, null, 2) + '\n');
  return names;
}

function dollars(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

async function main(argv: readonly string[]): Promise<void> {
  // 1–3. The guards. Nothing from src/ is loaded and nothing is connected until all pass.
  const args: RecordArgs = parseRecordArgs(argv);
  assertLegalRecord(fs.readFileSync(PROJECT_MD, 'utf8'));
  loadEnv({ path: fileURLToPath(ENV_FILE), override: false, quiet: true });
  const ownerUrl = process.env.TEST_DATABASE_URL;
  assertLocalTarget('test', ownerUrl);
  assertLocalTarget('test', process.env.SUPABASE_DB_POOL_URL || process.env.RUNTIME_DB_URL);

  // Only now the src graph: src/env.ts parses process.env at import, and the meter's pool opens
  // from the URL just checked.
  const lib = await import('./lib/record-pages');

  const c = new Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query('begin');
    let run: Awaited<ReturnType<typeof lib.openRecordingRun>>;
    try {
      run = await lib.openRecordingRun(c, {
        versionId: args.version,
        placesType: args.type,
        unit: args.unit,
        ...(args.quad === undefined ? {} : { quad: args.quad }),
        idsOnly: args.idsOnly,
        maxRequests: args.maxRequests,
      });
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
    console.log(
      `record-places: run ${run.runId} (${args.idsOnly ? 'change_check, ids-only' : 'full_sweep'}) · ` +
        `tile ${run.tileKey} · cap ${args.maxRequests} request(s)`,
    );

    const anonymize = { rect: run.rect, city: run.unitName, placesType: args.type };
    let result: Awaited<ReturnType<typeof lib.recordPages>> | undefined;
    try {
      result = await lib.recordPages(
        { clerkOrgId: run.clerkOrgId, runId: run.runId },
        {
          searchId: run.searchId,
          first: lib.firstRequest(run, args.type),
          mode: args.idsOnly ? 'ids_only' : 'enterprise',
          maxRequests: args.maxRequests,
          anonymize,
        },
      );
    } finally {
      await c.query('begin');
      await lib.closeRecordingRun(c, run, result?.outcome ?? 'crashed');
      await c.query('commit');
    }

    const ledger = await lib.ledgerOfRun(c, run.runId);
    console.log(
      `record-places: outcome ${result.outcome}${result.status === null ? '' : ` (HTTP ${result.status})`} · ` +
        `${result.requests} request(s) · ${result.idsSeen} id(s) · ${result.pages.length} page(s)` +
        (result.truncatedByCap ? ' · stopped by the cap with a next page offered' : ''),
    );
    console.log(
      `record-places: ledger ${ledger.rows} row(s) [${ledger.skus.join(', ')}] · cost ${dollars(ledger.microUsd)}`,
    );
    if (result.outcome === 'bad_shape') {
      console.log(
        'record-places: bad_shape — the response failed src/lib/places/response.ts (a strict enum such as businessStatus?). Charged; nothing recorded.',
      );
    }

    if (args.out === undefined) {
      console.log('record-places: no fixture written (--out not given)');
    } else if (result.pages.length === 0) {
      console.log('record-places: no page arrived; nothing written');
    } else {
      const names = writeRecording({
        out: args.out,
        pages: result.pages,
        anonymize,
        requests: result.requests,
        truncatedByCap: result.truncatedByCap,
        recordedAt: new Date().toISOString(),
        purpose: `Recorded (anonymized) ${args.type} search, ${run.tileKey}`,
      });
      console.log(`record-places: wrote ${names.join(', ')} and updated ${SIDECAR_FILE}`);
    }
    if (result.outcome !== 'ok') process.exitCode = 1;
  } finally {
    await c.end();
    await lib.closeMeterPool();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main(process.argv.slice(2));
}

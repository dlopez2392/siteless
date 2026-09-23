/**
 * The US Census BATCH geocoder. D-08: Comptroller outlet addresses are batch-geocoded at
 * ingest, so the geo gate, the distance feature, the 25 km rule and Phase 2's radius
 * presets can reach Comptroller-only businesses. Free, federal, keyless — the same D-02
 * choice `./census.ts` made for the one-line endpoint, now the batch endpoint.
 *
 * Probed live 2026-09-22 against real RGV Comptroller addresses (03-RESEARCH.md § The
 * Census Batch Geocoder); the five recorded bodies live in tests/unit/msw/fixtures/.
 *
 * 🔴 THE RESPONSE IS RAGGED. A `Match` line has 8 fields, a `No_Match` line 4 and a `Tie`
 * line 3. `parseBatchLine` branches on the status field BEFORE it reads anything past it;
 * a parser that indexed the coordinate field unconditionally would read `undefined` on
 * ~29 % of rows, and one that asserted a column count would reject them.
 *
 * 🔴 RESULT ORDER IS NOT INPUT ORDER. Measured at n=40, 1,000 and 3,000 — the 3,000-row
 * response began `"1462", "2793", "1461"`. Every line is rejoined on its ID column; nothing
 * here ever zips a response to a request by position. Zipping would give roughly every
 * business somebody else's location, and every one of them would still look plausible.
 *
 * 🔴 `Non_Exact` CAN FLIP A DIRECTION. Measured: `100 E CANO ST` → `100 W CANO ST`,
 * `2112 W UNIVERSITY DR` → `2112 E UNIVERSITY DR`, `500 N CLOSNER BLVD` → `500 S CLOSNER
 * BLVD`. The match type is therefore KEPT on every `Match`, and a `Non_Exact` is
 * location-only evidence: it may feed the distance feature but must never be promoted to
 * the `address_exact` signal. `promotesToAddressSignal` is the one place that decision is
 * made, and `locationMatchType` maps it onto the `'census_exact' | 'census_non_exact'`
 * values the scorer's `distance` weight reads (`locationMatchType !== 'census_non_exact'`).
 *
 * 🔴 DISPLAY `matchedAddress`, NEVER THE INPUT — the same rule `./census.ts` documents. The
 * service corrects and rewrites what it was sent (it drops suites and lots even on an
 * `Exact`: `2426 E TYLER AVE STE 1C` comes back `2426 E TYLER AVE`).
 *
 * 🔴 THE FAILURE MODE IS HTTP 200, again. The service answers 200 for everything,
 * including a total failure, so success is "a 200 whose line count equals the row count
 * and whose every line parses and names a submitted ID" — not the status code.
 *
 * NEVER REJECTS on anything the network does: every outcome, per row, is a named reason.
 * A chunk that fails three attempts is recorded as `ChunkFailed` for each of its rows and
 * the run carries on; those rows stay unlocated and fall back to text matching (D-08).
 * Only a caller's programming error — a malformed or duplicated ID — is refused, before
 * any request is built.
 *
 * Sizing: ~70.9 % match rate (n=1,000 and n=3,000), ~32 addr/s, linear. So ≈10,100 of the
 * 34,928 RGV Comptroller outlets will have NO location, and D-10 caps every one of their
 * pairs at the review band. That is the measured service, not a defect.
 *
 * NO `import 'server-only'`, deliberately, like `src/lib/socrata/client.ts`: the ingest
 * that calls this is a `tsx` desk script, where `server-only` resolves to the entry whose
 * whole body is an error. Nothing here reads an env var or a credential.
 */

/** Hard-coded. T-3-05: no caller-supplied value ever reaches the host, the path or a
 *  header — an address is a CSV field inside a multipart POST body, never a URL part. */
const CENSUS_HOST = 'https://geocoding.geo.census.gov';
/**
 * `locations`, NOT `geographies/addressbatch`: the county FIPS is already known from
 * `outlet_county_code`, and the geographies variant measured ~9× slower (4,448 ms vs
 * 488 ms for the same 8 rows) to return it again.
 */
const CENSUS_BATCH_PATH = '/geocoder/locations/addressbatch';
// No `vintage`: it is required only for the returntype that also returns geography.
const CENSUS_BENCHMARK = 'Public_AR_Current';

/** 26 s measured per 1,000 rows. 10,000 (the documented ceiling) would be a 5.2-minute
 *  held-open request. */
export const CENSUS_BATCH_CHUNK = 1000;

/** T-3-12: at most three chunks in flight. Vercel functions share 1,024 file descriptors
 *  and an unbounded fan-out over HTTP exhausts them; three gets 35k rows in ~6–8 min. */
export const CENSUS_BATCH_CONCURRENCY = 3;

/** Three attempts per chunk, then the chunk is recorded as failed. Free service: no budget
 *  is at stake, only wall clock. */
export const CENSUS_BATCH_ATTEMPTS = 3;

/**
 * Exponential backoff between attempts: 2 s after the first failure, 8 s after the second.
 * The research's schedule reads "2 s / 8 s / 30 s, three attempts"; with three attempts
 * there are only two gaps, so the 30 s step would only ever precede a fourth attempt,
 * which the ceiling above excludes. Kept here so raising the ceiling picks it up.
 */
export const CENSUS_BATCH_BACKOFF_MS = [2_000, 8_000, 30_000] as const;

/** 1,000 rows took 26 s and 3,000 took 93 s; three concurrent chunks share one service.
 *  Bounded so a stalled socket becomes a retry, never a hung ingest. */
const TIMEOUT_MS = 180_000;

/** IDs are rejoin keys, so they are held to a shape that cannot collide with the CSV
 *  quoting or be rewritten by the service: the Comptroller key `32006170057-5`, a UUID. */
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

export type BatchOutcome =
  | {
      kind: 'Match';
      /** 🔴 `Non_Exact` is location-only evidence — see `promotesToAddressSignal`. */
      matchType: 'Exact' | 'Non_Exact';
      /** What the service resolved. Display this, never the input. */
      matchedAddress: string;
      lat: number;
      lng: number;
    }
  | { kind: 'No_Match' }
  | { kind: 'Tie' }
  | { kind: 'ChunkFailed'; reason: 'unreachable' | 'bad_shape' | 'count_mismatch' };

export type BatchMatchType = Extract<BatchOutcome, { kind: 'Match' }>['matchType'];
export type ChunkFailureReason = Extract<BatchOutcome, { kind: 'ChunkFailed' }>['reason'];

/** One Comptroller outlet to locate. State is always `TX` and is not the caller's to set. */
export type BatchRow = { id: string; street: string; city: string; zip: string };

export type GeocodeBatchOptions = {
  /** Injected so tests can prove the backoff schedule without waiting it out. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

// ─── Parsing ─────────────────────────────────────────────────────────────────────────────

/**
 * Split one line of the service's quoted CSV. Every field arrives quoted, and two of them
 * carry commas inside the quotes (the echoed address and the `"lng,lat"` pair), so a plain
 * `split(',')` is wrong on every line. `""` inside a quoted field is a literal quote.
 * Returns `null` on an unbalanced quote rather than a best guess.
 */
function parseQuotedCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) return null;
  fields.push(field);
  return fields;
}

const badShape = (id: string): { id: string } & BatchOutcome => ({
  id,
  kind: 'ChunkFailed',
  reason: 'bad_shape',
});

/**
 * Parse one response line. Never raises: a line that is not one of the three documented
 * shapes comes back as `ChunkFailed`/`bad_shape` (T-3-03), never as an exception and never
 * as a `Match` carrying `undefined` or `NaN`.
 *
 * Positions (1-based, as the Census documentation numbers them): 1 ID · 2 input echoed ·
 * 3 `Match`/`No_Match`/`Tie` · 4 `Exact`/`Non_Exact` · 5 matched address · 6 `"lng,lat"` ·
 * 7 TIGER line id · 8 side. Only a `Match` has positions 4–8.
 */
export function parseBatchLine(line: string): { id: string } & BatchOutcome {
  const f = parseQuotedCsvLine(line.replace(/\r$/, ''));
  const id = f?.[0] ?? '';
  if (!f || f.length < 3 || !ID_SHAPE.test(id)) return badShape(id);

  // 🔴 Branch on the status BEFORE reading any later position. A `Tie` line has 3 fields
  // and a `No_Match` line 4; neither has a position 6 to read.
  if (f[2] === 'No_Match') return { id, kind: 'No_Match' };
  if (f[2] === 'Tie') return { id, kind: 'Tie' };
  if (f[2] !== 'Match') return badShape(id);

  const matchType = f[3];
  const matchedAddress = f[4];
  if (matchType !== 'Exact' && matchType !== 'Non_Exact') return badShape(id);
  if (!matchedAddress || f[5] === undefined || f[5].split(',').length !== 2) {
    return badShape(id);
  }

  // 🔴 LONGITUDE FIRST. Position 6 is `"longitude,latitude"` — `"-97.672649743751,
  // 26.189604634647"` for Harlingen — the same `x` = LONGITUDE, `y` = LATITUDE order
  // `./census.ts` pins for the one-line endpoint. The Census Geocoder does NOT return
  // `(lat, lng)`, and reading these in written order puts every RGV point in the Indian
  // Ocean. `census-batch.test.ts` pins it by SIGN (lng < -90, lat > 20), because a swap
  // still yields two finite numbers and would sail past any presence check.
  const [lng, lat] = f[5].split(',').map(Number);
  if (
    lng === undefined ||
    lat === undefined ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    // A latitude outside ±90 is what a swapped RGV pair looks like (-97.67 as a latitude),
    // so this range check turns a future axis swap upstream into `bad_shape`, not a point
    // in the Indian Ocean.
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return badShape(id);
  }

  return { id, kind: 'Match', matchType, matchedAddress, lat, lng };
}

/**
 * The ONE place a Census outcome is allowed to become the `address_exact` signal: an
 * `Exact` match only. A `Non_Exact` can flip `E` to `W` (see the header) and is
 * location-only evidence.
 */
export function promotesToAddressSignal(outcome: BatchOutcome): boolean {
  return outcome.kind === 'Match' && outcome.matchType === 'Exact';
}

/** The `location_match_type` value an outcome writes, or `null` for no location at all. */
export function locationMatchType(
  outcome: BatchOutcome,
): 'census_exact' | 'census_non_exact' | null {
  if (outcome.kind !== 'Match') return null;
  return outcome.matchType === 'Exact' ? 'census_exact' : 'census_non_exact';
}

// ─── Building the request ────────────────────────────────────────────────────────────────

/** Control characters would split a CSV line (CR/LF) or corrupt it; nothing legitimate in
 *  a street, city or ZIP needs one, so each becomes a space. */
function csvField(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim();
  return `"${cleaned.replace(/"/g, '""')}"`;
}

/**
 * The request CSV: no header row, exactly `Unique ID, Street address, City, State, ZIP`,
 * every field quoted, LF-terminated. The recorded fixtures were captured with exactly this
 * encoding, which is also what proves the service accepts it.
 */
export function buildBatchCsv(rows: ReadonlyArray<BatchRow>): string {
  return rows
    .map((r) => [r.id, r.street, r.city, 'TX', r.zip.trim().slice(0, 5)].map(csvField).join(','))
    .map((line) => `${line}\n`)
    .join('');
}

// ─── One chunk ───────────────────────────────────────────────────────────────────────────

type AttemptResult =
  { ok: true; outcomes: Map<string, BatchOutcome> } | { ok: false; reason: ChunkFailureReason };

async function postChunkOnce(
  chunk: ReadonlyArray<BatchRow>,
  timeoutMs: number,
): Promise<AttemptResult> {
  const form = new FormData();
  form.set('addressFile', new Blob([buildBatchCsv(chunk)], { type: 'text/csv' }), 'addresses.csv');
  form.set('benchmark', CENSUS_BENCHMARK);

  let body: string;
  try {
    const response = await fetch(`${CENSUS_HOST}${CENSUS_BATCH_PATH}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, reason: 'unreachable' };
    body = await response.text();
  } catch {
    // A timeout, a DNS failure, a reset connection, a body cut off mid-read.
    return { ok: false, reason: 'unreachable' };
  }

  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // 🔴 The service's own failure mode is a 200 with too few lines. Count first.
  if (lines.length !== chunk.length) return { ok: false, reason: 'count_mismatch' };

  const expected = new Set(chunk.map((r) => r.id));
  const outcomes = new Map<string, BatchOutcome>();
  for (const line of lines) {
    const { id, ...outcome } = parseBatchLine(line);
    // A malformed line, an ID nobody submitted, or an ID answered twice: the rejoin cannot
    // be trusted for this response, so none of it is used.
    if (outcome.kind === 'ChunkFailed' || !expected.has(id) || outcomes.has(id)) {
      return { ok: false, reason: 'bad_shape' };
    }
    outcomes.set(id, outcome);
  }
  return { ok: true, outcomes };
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function geocodeChunk(
  chunk: ReadonlyArray<BatchRow>,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
): Promise<Map<string, BatchOutcome>> {
  let reason: ChunkFailureReason = 'unreachable';
  for (let attempt = 1; attempt <= CENSUS_BATCH_ATTEMPTS; attempt += 1) {
    const result = await postChunkOnce(chunk, timeoutMs);
    if (result.ok) return result.outcomes;
    reason = result.reason;
    if (attempt < CENSUS_BATCH_ATTEMPTS) {
      await sleep(CENSUS_BATCH_BACKOFF_MS[attempt - 1] ?? CENSUS_BATCH_BACKOFF_MS[0]);
    }
  }
  const failed: BatchOutcome = { kind: 'ChunkFailed', reason };
  return new Map(chunk.map((r) => [r.id, failed]));
}

/**
 * Run `task` over `items` with at most `limit` in flight — the whole of what `p-limit`
 * would be used for here, without a dependency. Results keep `items` order.
 */
async function mapBounded<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── The batch ───────────────────────────────────────────────────────────────────────────

/**
 * Geocode `rows`, 1,000 per request, three requests at a time. Returns one outcome per
 * input ID, keyed by that ID — never by position.
 *
 * Refuses (before any request) only a caller error that would corrupt the rejoin: an ID
 * that is empty, oddly shaped, or repeated. Everything the network can do becomes an
 * outcome instead.
 */
export async function geocodeBatch(
  rows: ReadonlyArray<BatchRow>,
  opts: GeocodeBatchOptions = {},
): Promise<Map<string, BatchOutcome>> {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!ID_SHAPE.test(row.id)) {
      throw new TypeError(`geocodeBatch: row id ${JSON.stringify(row.id)} is not ${ID_SHAPE}`);
    }
    if (seen.has(row.id)) {
      throw new TypeError(`geocodeBatch: row id ${row.id} appears twice; results rejoin on it`);
    }
    seen.add(row.id);
  }

  const chunks: BatchRow[][] = [];
  for (let start = 0; start < rows.length; start += CENSUS_BATCH_CHUNK) {
    chunks.push(rows.slice(start, start + CENSUS_BATCH_CHUNK));
  }

  const sleep = opts.sleep ?? realSleep;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const perChunk = await mapBounded(chunks, CENSUS_BATCH_CONCURRENCY, (chunk) =>
    geocodeChunk(chunk, sleep, timeoutMs).catch(
      // Defence in depth: `geocodeChunk` already turns every network outcome into a value,
      // so this only catches a defect in it — and still records a reason, not a rejection.
      (): Map<string, BatchOutcome> =>
        new Map(chunk.map((r) => [r.id, { kind: 'ChunkFailed', reason: 'unreachable' }])),
    ),
  );

  const out = new Map<string, BatchOutcome>();
  for (const map of perChunk) for (const [id, outcome] of map) out.set(id, outcome);
  return out;
}

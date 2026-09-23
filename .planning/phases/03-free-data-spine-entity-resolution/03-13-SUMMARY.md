---
phase: 03-free-data-spine-entity-resolution
plan: 13
subsystem: ingest
tags: [overture, duckdb, etl, texas-side, criterion-5, fixture, DATA-02, DATA-04, M23]
requires:
  - phase: 03-01
    provides: "@duckdb/node-api devDependency, the ingest:overture package script"
  - phase: 03-06
    provides: "nameNorm / phoneE164 / addressKey"
  - phase: 03-08
    provides: "overture_category_map built-ins (70 rows), the unmapped-tail contract"
  - phase: 03-09
    provides: "upsertSourceRecord / upsertBusinessFromSource / startRun / countGone / finishRun, setEtlActor + resolveEtlOrg, _ingest-fixtures.ts"
provides:
  - "scripts/ingest-overture.ts: the DuckDB bbox range-read desk ingest (--org, --release, --target) and the --sample fixture cutter"
  - "src/lib/overture/transform.ts: overtureRowToSourceRecord (pure, zod, country-first Texas filter, .items reads, geometry coordinate, basic_category only), OVERTURE_RGV_BBOX, isSkipped"
  - "tests/unit/fixtures/overture-rgv-sample.json: 193 real rows of 2026-08-19.0 plus a _meta provenance entry"
  - "tests/unit/overture-transform.test.ts: the five named tests plus positive controls and branch tests (15 tests)"
  - "tests/db/_ingest-fixtures.ts: seedOvertureFixture now runs the production transform (toOvertureRow, OVERTURE_FIXTURE_RELEASE)"
affects: [03-10, 03-11, 03-14, 03-20, 03-21, overture-ingest, sources-page]
tech-stack:
  added: []
  patterns:
    - "Desk script does the I/O, a pure module does the transform; the committed fixture is the node-api getRowObjects() output frozen as JSON, so CI needs no native binary and no S3"
    - "inEtlTransaction: begin + setEtlActor + resolveEtlOrg at the top of EVERY transaction (run start, each 500-row batch, finish, failure record)"
    - "Transform the whole release before the first write; any malformed row aborts with nothing written"
    - "Fixture cut by md5(id) order, so a re-cut is byte-identical apart from the stamp"
key-files:
  created:
    - scripts/ingest-overture.ts
    - src/lib/overture/transform.ts
    - tests/unit/fixtures/overture-rgv-sample.json
    - tests/unit/overture-transform.test.ts
  modified:
    - tests/db/_ingest-fixtures.ts
    - tests/db/texas-side.test.ts
key-decisions:
  - "A bare-array list is refused as skipped 'malformed' (a third named skip reason beside not_texas / no_name), never read as 'no phones'. The script then aborts the whole run before any write, because a reader switched to a JSON-converting accessor would otherwise ingest ~51,000 phone-less rows"
  - "The emitted phone is the FIRST phones[] entry that normalises, not blindly phones[0]: a junk first entry must not hide a dialable second one. The raw list stays in the payload"
  - "cluster_key is resolved by the script from overture_category_map (built-ins, then the org's own rows, override wins), not by the pure transform; an unmapped basic_category leaves cluster_key NULL and is listed in stats.unmapped_basic_category with its count"
  - "The fixture carries the bbox struct (--sample only; the ingest never selects it) so 'geometry not bbox' can prove the two differ. zod strips it on the way in"
  - "--org is required for an ingest but not for --sample, which touches no database"
requirements-completed: [DATA-02, DATA-04]
metrics:
  duration: ~25min
  started: 2026-09-23T01:59:26Z
  completed: 2026-09-23T02:20:39Z
  tasks: 3
  files: 6
---

# Phase 3 Plan 13: Overture DuckDB ingest, pure transform and committed CI fixture Summary

**The Overture desk ingest now exists. It range-reads the naive RGV bbox from the public bucket through DuckDB, runs every row through a pure, zod-validated transform, and writes the Texas side through 03-09's shared path. A committed JSON fixture of 193 real rows exercises every branch in CI with no DuckDB and no S3. The Texas-side filter uses both halves (`country='US' AND region='TX'`), and mutation M23 on the production transform turns red one unit test and the criterion-5 DB test, each by name.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-23T01:59:26Z (base reset)
- **Completed:** 2026-09-23T02:20:39Z
- **Tasks:** 3 of 3
- **Files:** 4 created, 2 modified

## Accomplishments

- **`scripts/ingest-overture.ts`** (632 lines).
  - `--release` is validated against `^\d{4}-\d{2}-\d{2}\.\d+$` in `parseArgs`, and again in `placesPath`, the single place it is interpolated (T-3-05).
  - If `--release` is omitted, the script lists the bucket with a DuckDB `glob` and fails, naming what it found. If the release given is not in the bucket, it fails and lists the ones present.
  - `--org` is required for an ingest (T-3-01).
  - The `--target` gate is copied in shape from `seed.ts`.
  - The `bbox` struct is used only as the `where` predicate. The stored coordinate is `ST_X/ST_Y(geometry)`.
  - Stats per D-04: rows per 0.1 confidence band (in the 03-RESEARCH labels), `permanently_closed`, NULL `basic_category`, mapped rows, unmapped rows, and the full unmapped `basic_category` list with counts. Skip counts are broken down by reason.
- **`src/lib/overture/transform.ts`**. This module is pure. It has no `server-only` import, no `fetch`, and no DuckDB anywhere in its import graph; `BusinessDerived` is a type-only import.
  - The zod schema names exactly the 18 selected fields and renames the address fields `addr_*`.
  - The filter is `if (r.addr_country !== 'US' || r.addr_region !== 'TX')`.
  - Four `?.items` reads.
  - The GERS id is kept verbatim, and the record is marked `retentionClass: 'durable'`.
- **The fixture.** It was cut live from `2026-08-19.0`, which is still the only release in the bucket (listed 2026-09-22 21:0x CDT). Materialising the bbox took 9.96 s and 10.18 s, matching the 9.5 s measured in research.
  - 193 rows. Every required branch is present: all-fields ×4, NULL category ×4, `permanently_closed` ×4, no phone ×4, `+1…` ×3, bare-10 ×3, bare-11 ×3, other ×5.
  - The **215-place toll-free `8004879643` appears in both its forms**.
  - Junk postcodes ×4 (`""` ×3 and `"<<not-applicable>>"`).
  - Mexican side: **all 3 `country='MX' AND region='TX'` rows**, Reynosa ×6, Matamoros ×6, Río Bravo ×5, plus other MX regions ×4.
  - US rows with a missing region ×4 and another US state ×2.
  - Texas filler ×125.
  - The bbox struct differs from the geometry on 193 of 193 rows.
  - The file is pure UTF-8 with no NUL and no BOM. No line contains a host that the no-network gate treats as live.

## Task Commits

1. **Task 1: the desk script, plus the transform it imports.** `14e3c46` (feat)
2. **Task 2: cut the committed fixture.** `feabffe` (test)
3. **Task 3: the named tests, and the criterion-5 DB test on the real transform.** `3aa24a2` (test)

## Tests and mutation checks

**Unit.** `tests/unit/overture-transform.test.ts` has 15 tests, read by name. The five from the plan:

- `texas side filter`
- `texas side filter positive control: every named US/TX row is kept`
- `duckdb list shape`
- `geometry not bbox`
- `basic_category only`
- `release recorded`

Beyond the plan:

- `duckdb list shape: the four measured phone forms and the toll-free switchboard`
- `overture fixture carries its provenance and every branch`
- external id verbatim
- `permanently_closed` is stored, not skipped
- a junk postcode never becomes a ZIP5
- `no_name`
- malformed rows are named, never thrown
- the payload is exactly the selected fields
- no `src` module imports the DuckDB native binary. This check is two-sided: it also asserts the script does import it.

**Every named test was watched red under its own mutation, then reverted.** Implementation came first (see Deviations), so this is the RED evidence:

| Mutation (on `src/lib/overture/transform.ts`) | Red, by name | Revert |
|---|---|---|
| **M23**: `if (r.addr_region !== 'TX')` | unit **`texas side filter`** alone: `Reynosa e9644774…: expected { sourceKey: 'overture', …} to deeply equal { skipped: 'not_texas', … }` (the real MX/TX 7-Eleven row) | `git checkout` of the file; `git diff --stat` empty; `addr_country !== 'US'` re-grepped |
| **M23**, same mutation, DB | **`a naive-RGV-bbox radius search returns no Mexican-side row`**: `expected 10 to be 11` (the skipped guard). With that guard neutralised for one run (backup, then restore), the core assertion fails on `"display_name": "Carnicería La Frontera"` | test file restored from backup; `expect(skipped).toBe(` count = 1 |
| bare-array read: `Array.isArray(r.phones) ? r.phones : []` | `duckdb list shape` + `duckdb list shape: the four measured phone forms…` | diff empty |
| bbox as the coordinate: schema gains `bbox`, `lat: r.bbox.ymin`, `lng: r.bbox.xmin` | `geometry not bbox` alone (`expected -97.82411193847656 to be -97.82409965`) | diff empty |
| legacy fallback `?? row.categories?.primary` | `basic_category only` alone, naming `transform.ts:212` | diff empty |
| `sourceVersion: '2026-08-19.0'` hard-coded | `release recorded` alone (`expected '2026-08-19.0' to be '2031-01-07.3'`) | diff empty |

**Suites on `3aa24a2`:**

- `tsc --noEmit` 0 and `eslint .` 0.
- Full unit suite: **29 files, 208 tests, green**, including `CI never reaches the network` with the fixture now under `tests/`.
- DB: the three files that import `_ingest-fixtures.ts` (`texas-side`, `ingest-idempotency`, `external-key`) are **3 files, 18 tests, green**. They use the shared local DB and are rollback-only.
- `next build` 0. `git status` clean.

All verification used `npx vitest run <file> --reporter=verbose`, never `pnpm test:unit -- -t`, and the test names were read.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The transform landed in Task 1's commit, not Task 3's**
- **Found during:** Task 1
- **Issue:** The script imports `overtureRowToSourceRecord` statically, so it can neither typecheck nor run (and so cannot cut the fixture) until the module exists. The plan's order was script → fixture → transform (TDD).
- **Fix:** The transform was written with the script and committed in `14e3c46`. The tests came in Task 3. Instead of a test-first commit, TDD RED was demonstrated per test by the mutation table above: each named test red by name under its own mutation, then reverted.
- **Commit:** 14e3c46

**2. [03-09 handoff, outside files_modified] `seedOvertureFixture` runs the real transform**
- **Issue:** `tests/db/texas-side.test.ts` was proven against a fixture-side filter (`isTexasSide`), so M23 on the production transform could not reach it.
- **Fix:**
  - `tests/db/_ingest-fixtures.ts`: added `toOvertureRow` (the synthetic rows in the node-api shape) and `OVERTURE_FIXTURE_RELEASE`.
  - `overtureIngestInput` now goes through `overtureRowToSourceRecord` and returns `null` on a skip.
  - The `keep` parameter and `isTexasSide` are removed, so no fixture-side filter is left for a test to route around.
  - `texas-side.test.ts`: header comment only.
  - M23 now reds both tests, as shown above.
- **Files modified:** tests/db/_ingest-fixtures.ts, tests/db/texas-side.test.ts
- **Commit:** 3aa24a2

**3. [Rule 2] A third skip reason, `malformed`, plus an abort-before-write**
- **Issue:** The plan's signature named only `not_texas | no_name`. T-3-03 requires a named skip rather than a throw. A row that fails zod (for example a bare-array list) would otherwise be undefined behaviour.
- **Fix:** The transform returns `{ skipped: 'malformed', id }`. The script transforms the whole release before the first write and aborts if any row is malformed, naming the first ids. A schema drift then writes nothing, rather than half a release.
- **Commit:** 14e3c46

**4. [Rule 1] Fixture provenance stamp**
- **Issue:** The first cut wrote `cutDate: "2026-09-23"`, a UTC date on a 2026-09-22 CDT evening, which is exactly the zone trap CLAUDE.md warns about.
- **Fix:** It is now `cutAt`, a full ISO instant. The re-cut diff was the stamp line only, which proved the cut deterministic.
- **Commit:** feabffe

### Acceptance-command notes (measured, not changed)

- `grep -n "\\^\\\\d{4}-…"` as written in the plan does not match under Git Bash quoting. `grep -nF '^\d{4}-\d{2}-\d{2}'` matches `scripts/ingest-overture.ts:75`.
- `grep -rn "@duckdb/node-api" src/` returns **one pre-existing line**: `src/seed/data/overture-categories.json:4`, the `"source"` provenance string 03-08 wrote. It is text, not an import. My new test `no src module imports the DuckDB native binary` checks for imports, which is the property that matters. I did not touch the file, because it is out of scope.
- `grep -c resolveEtlOrg` = `grep -c setEtlActor` = **4** each: header, import, and the two calls. The calls are inside `inEtlTransaction`, which the batch loop, the run start, the finish and the failure path each call. Neither is ever called once at module scope.
- The `no_name` fixture group is empty. The bbox holds no row with a NULL or blank name, so that branch is covered by a unit test that blanks a real row's name.

## Measured facts the next plans should know

- **One of the three `country='MX' AND region='TX'` rows sits in Pharr**, a US city, with `locality='Pharr'`. It is a real US place that Overture tags MX, and the country half drops it. That is the same accepted 0.3 % trade as the 180 region-less US rows. The other two are in Reynosa: a 7-Eleven and a Sonic.
- The "other" phone class in the fixture is mostly `(956) 554-2000`-style formatted numbers, and libphonenumber parses all of them. `8004879643` / `+18004879643` both fold to `+18004879643` with `blockable: false`.
- **Not run end-to-end: the ingest mode.** It was not run against the database. The prompt forbade a full ingest into the shared local test DB (siblings 03-10/11/12 are testing there), and prod is 03-21's checkpoint. What is proven:
  - its transform path (unit tests and the script's pre-pass)
  - its write path (03-09's DB tests, driving the same `upsert*` / `run-report` helpers under `setEtlActor` + `resolveEtlOrg`)
  - its arg gate (executed: a bad release is refused, a missing `--org` is refused, a missing `--release` lists `2026-08-19.0`)
- **Not exercised by any run:** `inEtlTransaction`'s per-batch composition and `readCategoryMap`. The first desk run should use `--target=test` against a scratch org before `--target=prod`.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema. The one new network surface is the desk script's read-only S3 range-read. It is in the plan's threat model (T-3-05, T-3-12, T-3-14), and each mitigation is in the code: the regex is checked at both points, threads/memory are pinned, and DuckDB is imported only from `scripts/`.

## Self-Check: PASSED

- FOUND: scripts/ingest-overture.ts, src/lib/overture/transform.ts, tests/unit/fixtures/overture-rgv-sample.json, tests/unit/overture-transform.test.ts
- FOUND (modified): tests/db/_ingest-fixtures.ts, tests/db/texas-side.test.ts
- FOUND: commits 14e3c46, feabffe, 3aa24a2 in `git log`
- STATE.md / ROADMAP.md untouched

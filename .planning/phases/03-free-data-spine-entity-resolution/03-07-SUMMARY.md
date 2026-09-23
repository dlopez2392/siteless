---
phase: 03-free-data-spine-entity-resolution
plan: 07
subsystem: geocode
tags: [census, geocoder, batch, msw, fixtures, D-08]
requires:
  - 03-03 (msw conventions in tests/unit/msw/server.ts, fixtures README format)
provides:
  - src/lib/geocode/census-batch.ts (geocodeBatch, parseBatchLine, CENSUS_BATCH_CHUNK, BatchOutcome incl. ChunkFailed, promotesToAddressSignal, locationMatchType, buildBatchCsv)
  - five recorded Census batch fixtures + msw batch handler (failNextCensusBatches, RECORDED_BATCH_ROWS, CENSUS_BATCH_BODY)
affects:
  - 03-12 (ingest-comptroller geocode pass consumes geocodeBatch / BatchOutcome / locationMatchType)
  - 03-06 (no-network test allow-lists census-batch.ts; this plan adds no host literal outside the allow-list)
tech-stack:
  added: []
  patterns:
    - msw dispatch on the request CSV matched against each fixture's own (id, echoed address) set
    - test oracle reads fixtures with a local splitter, never the parser under test
    - hand-rolled bounded worker pool (3) in place of p-limit
key-files:
  created:
    - src/lib/geocode/census-batch.ts
    - tests/unit/census-batch.test.ts
    - tests/unit/msw/fixtures/census-batch-match.txt
    - tests/unit/msw/fixtures/census-batch-non_exact.txt
    - tests/unit/msw/fixtures/census-batch-tie.txt
    - tests/unit/msw/fixtures/census-batch-no_match.txt
    - tests/unit/msw/fixtures/census-batch-shuffled.txt
    - .gitattributes
  modified:
    - tests/unit/msw/server.ts
    - tests/unit/msw/fixtures/README.md
decisions:
  - "No_Match lines are 3 fields in the live 2026-09-22 recordings, not the 4 03-RESEARCH wrote; the parser accepts both and neither has a position 6"
  - "Concurrency bound is a 20-line in-module worker pool, not p-limit: p-limit is not a declared dependency and adding one would touch package.json/pnpm-lock.yaml outside the plan's file list while three sibling worktrees run"
  - "Three attempts means two backoff gaps (2 s, 8 s); the 30 s step is kept in CENSUS_BATCH_BACKOFF_MS but only a fourth attempt would reach it"
  - "Any unusable response (transport, non-200, line-count mismatch, malformed line, unknown or repeated id) fails the whole attempt and is retried; after 3 attempts every row in the chunk is ChunkFailed with the last reason"
  - "census-batch.ts has no import 'server-only' (like socrata/client.ts): its caller is a tsx desk script"
  - "Fixture .txt files are marked -text in .gitattributes so core.autocrlf=true cannot CRLF them on checkout; server.ts refuses a CR at load"
metrics:
  duration: ~45 min
  completed: 2026-09-22
  tasks: 3
  commits: 4
  tests_added: 10
---

# Phase 3 Plan 07: Census Batch Geocoder Summary

A client for the free, keyless US Census `locations/addressbatch` endpoint. It sends 1,000-row chunks with at most three in flight and matches every result back to its row by the ID column. It reads position 6 longitude first, and it retries a failed chunk up to three times before marking every row in it `ChunkFailed`. Five real responses were recorded as fixtures, and msw replays them in the tests.

## What was built

- **`src/lib/geocode/census-batch.ts`**
  - The host `https://geocoding.geo.census.gov` and the path `/geocoder/locations/addressbatch` are hard-coded constants (T-3-05). The benchmark is `Public_AR_Current`, with no `vintage`.
  - An address only ever travels as a quoted CSV field inside a multipart POST body, never in the URL.
  - `parseBatchLine` reads the status field before any later position. A `No_Match` or `Tie` line returns straight away, so position 6 is never read for them.
  - `Match` lines are destructured as `const [lng, lat] = f[5].split(',').map(Number)`. The result is then range-checked, so an upstream lat/lng swap becomes `bad_shape` instead of a point in the Indian Ocean.
  - Every malformed line becomes `ChunkFailed`/`bad_shape`.
  - `geocodeBatch(rows, { sleep?, timeoutMs? })` never rejects on anything the network does. It only refuses an ID that is badly shaped or repeated (a `TypeError`, the one `throw` in the module).
  - `promotesToAddressSignal` returns `true` only for an `Exact` match. `locationMatchType` maps an outcome to `'census_exact' | 'census_non_exact' | null` for 03-12.
- **Fixtures**
  - Five verbatim `text/plain` bodies recorded live on 2026-09-22. Their provenance is in the fixtures README: endpoint, benchmark, the exact input CSV, the capture time and the wall clock for each.
  - The 40-row shuffled response came back naturally out of order. Its first line is ID `"22"`, and it has not been hand-shuffled.
  - It also contains a second direction flip seen in real data: `2112 W UNIVERSITY DR` came back as `2112 E UNIVERSITY DR`.
- **msw batch handler**
  - Dispatches on the request CSV, matched against each fixture's own echo of `(id, "street, city, state, zip")`. No address is typed by hand, and an unrecorded request gets a 501.
  - `failNextCensusBatches(count, 'network' | 'status_500' | 'truncated')` is cleared by `resetCensus()`.
  - `onUnhandledRequest: 'error'` still appears exactly once.

## Tests (10, all green; full unit suite 22 files / 115 tests)

The plan names six tests: `census batch parses a ragged No_Match`, `census batch parses a ragged Tie`, `census batch rejoins by id`, `census batch pins the axis order`, `non_exact is location only`, and `census batch retries and then records the chunk as failed`. I added four more:

- `census batch never runs more than three chunks at once`: 6,500 rows go out as 7 requests, and at most 3 are ever in flight.
- `census batch sends an address only as a CSV field`: a URL-looking street and a CRLF injection both stay inside the body.
- `census batch refuses an id it could not rejoin on`
- `census batch turns a malformed line into bad_shape`

A load-time guard checks that the fixtures still contain what the tests read:
- a 3-field Tie
- short No_Match lines
- an 8-field Match
- a response of at least 20 lines that is out of order
- an E→W Non_Exact

**Mutation checks.** Each mutation below was run against its named test, the test failed by name, and the change was reverted with `git diff` clean afterwards:

| # | Mutation | Test that failed |
|---|---|---|
| M1 | `[lng, lat]` → `[lat, lng]` | `census batch pins the axis order` |
| M2 | results keyed by position (with the duplicate-ID guard removed) | `census batch rejoins by id` |
| M3 | a `No_Match` must have a position 6 | `census batch parses a ragged No_Match` |
| M4 | `promotesToAddressSignal` returns `true` for any `Match` | `non_exact is location only` |
| M5 | `CENSUS_BATCH_ATTEMPTS = 1` | `census batch retries and then records the chunk as failed` |
| M6 | concurrency = `chunks.length` | `census batch never runs more than three chunks at once` |

## Expected numbers carried forward (from research, not re-measured here)

- Match rate of about **70.9 %**, measured at n=1,000 and again at n=3,000.
- Throughput of about **32 addresses per second**, scaling linearly: 1,000 rows took about 26 s.
- So about **10,100 of the 34,928** RGV Comptroller outlets will have no location. D-10 limits every pair involving one of them to the review band.

The recordings in this plan are small, so they are not throughput data. The two cold calls took about 8 s each, and the next three took under 1 s.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong field count for No_Match in the research**
- **Found during:** Task 3, when the load-time guard failed.
- **Issue:** The plan and 03-RESEARCH say a `No_Match` line has 4 fields. All three `No_Match` lines recorded live on 2026-09-22 have **3** fields, like a `Tie`.
- **Fix:**
  - The tests pin the recorded count, which is 3.
  - A 4-field version of the line (the recorded line plus a trailing empty field) is also tested, and it parses the same way.
  - The module header and the fixtures README now describe the real shape.
  - The plan's actual property, that neither short shape has a position 6, is unchanged and tested.
- **Commit:** 4022eb2

**2. [Rule 3 - Blocking] `p-limit` is not installed**
- **Issue:** The plan asks for `p-limit(3)`, but `p-limit` is not in `package.json`. Adding it would change `package.json` and `pnpm-lock.yaml`, which are outside this plan's file list, while three sibling worktrees are running.
- **Fix:** A small in-module worker pool, `mapBounded`, with `CENSUS_BATCH_CONCURRENCY = 3`. The limit is proven by the peak-in-flight test and by mutation M6. The T-3-12 protection (a concurrency limit) is fully in place.
- **Commit:** 7ac4600

**3. [Rule 2 - Missing critical] Fixtures would change on Windows checkout**
- **Issue:** With `core.autocrlf=true` on this machine, a fresh checkout would convert the `.txt` fixtures to CRLF line endings, so they would no longer be the exact bodies the service sent.
- **Fix:** A new `.gitattributes` line, `tests/unit/msw/fixtures/*.txt -text`. `server.ts` now also refuses a CR, NUL or BOM when it loads the fixtures.
- **Commit:** 4395915

**4. [Clarification] Backoff schedule**
- **Issue:** The plan says "2 s / 8 s / 30 s" and also "three attempts". Three attempts only leave two waits between them.
- **Fix:** The waits are 2 s and then 8 s, and the test asserts `waits = [2000, 8000]`. The 30 s value stays in `CENSUS_BATCH_BACKOFF_MS`, so it takes effect only if the attempt limit is raised.

**5. [Clarification] No_Match fixture reachable only by exact CSV**
- **Issue:** `census-batch-no_match.txt` includes the Reynosa row with state `TM`. `geocodeBatch` always sends `TX`, so it can never produce that CSV.
- **Fix:** The No_Match test reads the fixture's lines directly with `parseBatchLine`. The handler still serves the file to any caller that sends exactly those two rows. The README documents this.

### Verification notes
- `-t "CI never reaches the network"` **could not be run**: that test (`tests/unit/no-network.test.ts`) is written by sibling plan 03-06 and is not in this branch's base. I checked the same thing by hand. `grep -rln geocoding.geo.census.gov src tests` finds only `src/lib/geocode/census.ts`, `src/lib/geocode/census-batch.ts` and files under `tests/unit/msw/`, which is exactly 03-06's allow-list. The new test file uses the constants exported from `server.ts` and never spells out the host.
- As the environment notes warn, `$PNPM test:unit -- -t` does not filter. Every filtered run above used `npx vitest run tests/unit/census-batch.test.ts -t "<name>" --reporter=verbose`, and the passing and failing test names were read from the output.

## Threat Flags

None. The only network surface is the planned constant-host POST (T-3-05), and it is covered by the tests above.

## Known Stubs

None.

## TDD Gate Compliance

RED `d0a022b` (test file failed with `ERR_MODULE_NOT_FOUND`) → GREEN `7ac4600` (5/5 passed) → the Task 3 test expansion is `4022eb2`. No refactor commit was needed.

## Commits

| Task | Commit | Message |
|---|---|---|
| 1 | 4395915 | test(03-07): record five Census batch geocoder fixtures and replay them in msw |
| 2 (RED) | d0a022b | test(03-07): add failing tests for the Census batch geocoder client |
| 2 (GREEN) | 7ac4600 | feat(03-07): Census batch geocoder client (locations/addressbatch) |
| 3 | 4022eb2 | test(03-07): named Census batch tests - ragged lines, id rejoin, axis pin, retry, bounds |

## Self-Check: PASSED

All 8 created files present; commits 4395915, d0a022b, 7ac4600, 4022eb2 present in `git log`.

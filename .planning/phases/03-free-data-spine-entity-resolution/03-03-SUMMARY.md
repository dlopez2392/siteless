---
phase: 03-free-data-spine-entity-resolution
plan: 03
subsystem: data-ingest
tags: [socrata, texas-comptroller, zod, msw, fixtures, timezone]
requires: []
provides:
  - "src/lib/socrata/client.ts: one Socrata client (quote, paddedCountyCode, unpaddedCountyCode, naicsPredicate, TEXAS_COUNTY_CODES, comptrollerExternalId, canonicalJson, payloadHash, socrataCount, socrataQuery, socrataRowsUpdatedAt)"
  - "src/lib/socrata/permits.ts: permitRowSchema, comptrollerRowToSourceRecord, RGV_PADDED_COUNTY_CODES, PERMITS_DATASET, PERMITS_RGV_WHERE"
  - "src/lib/socrata/closures.ts: closureRowSchema, closureRowToSourceRecord, RGV_UNPADDED_COUNTY_CODES, CLOSURES_DATASET, CLOSURES_RGV_WHERE"
  - "tests/unit/msw/server.ts: Socrata replay handlers, RECORDED_WHERE, RECORDED_ORDER, failNextSocrataWithTypeMismatch, resetSocrata, socrataRequests, startReplayServer"
  - "optional server-only SOCRATA_APP_TOKEN in src/env.ts"
affects: [scripts/refresh-outlet-counts.ts, the Comptroller ingest script (later plan), 03-06 network grep gate]
tech-stack:
  added: []
  patterns:
    - "sidecar recording file (socrata-recordings.json) written by the capture run, so msw dispatches on values read out of a fixture even when the payload is a bare array"
    - "msw handler emulates $offset/$limit paging and refuses (501) an unrecorded query or a read past a truncated page"
    - "floating Socrata timestamps parsed with TZDate in APP_TZ; a zone-suffixed value is refused"
key-files:
  created:
    - src/lib/socrata/client.ts
    - src/lib/socrata/permits.ts
    - src/lib/socrata/closures.ts
    - tests/unit/socrata.test.ts
    - tests/unit/msw/fixtures/socrata-jrea-page.json
    - tests/unit/msw/fixtures/socrata-3kx8-page.json
    - tests/unit/msw/fixtures/socrata-400-type-mismatch.json
    - tests/unit/msw/fixtures/socrata-recordings.json
  modified:
    - src/env.ts
    - scripts/refresh-outlet-counts.ts
    - tests/unit/msw/server.ts
    - tests/unit/msw/fixtures/README.md
decisions:
  - "client.ts reads SOCRATA_APP_TOKEN from process.env (normalised with ||) and does NOT import @/env: tsx scripts import the client, and src/env.ts throws there (server-only + required Clerk/pool vars)"
  - "The verified join row 32006170057-5 is an ACTIVE location, so the 3kx8 fixture ORs it into the recorded $where; the closure schema requires out_of_business_date and refuses it"
  - "closureRowSchema refuses a zero-led loc_county; permitRowSchema requires a 3-digit padded outlet_county_code — each schema rejects the other dataset's code format"
  - "comptrollerExternalId() is shared by both transforms so the D-03 exact-match key cannot drift into two shapes"
  - "countyCode on both source records is the Comptroller integer (31), never the Census FIPS"
metrics:
  duration: "~45m"
  completed: 2026-09-23
  tasks: 3
  files: 12
---

# Phase 3 Plan 03: Socrata client lift, dataset transforms and recorded fixtures Summary

The Socrata client moved out of `scripts/refresh-outlet-counts.ts` into `src/lib/socrata/client.ts`, and its county formatter is now two functions: `paddedCountyCode` (`'031'`, jrea-zgmq) and `unpaddedCountyCode` (`'31'`, 3kx8-uryv). Each dataset has a zod schema that rejects the other's county format, and each has a pure transform. Three real payloads were recorded, and msw replays them by dispatching on the recorded `$where`. A live re-run of the counts script reproduced every committed count.

## What was built

- **Task 1 — client lift (`edc7f65`).** `quote`, `naicsPredicate`, the `000` sentinel (`TEXAS_COUNTY_CODES`) and the error-body echo moved over word for word. Added `socrataQuery`, which pages: `$order` is required, the caller may set `$limit` (default 50,000), the client sets `$offset` itself, and it stops on the first short page, with a 100-page cap. Also added `socrataCount`, `socrataRowsUpdatedAt` (reads `/api/views/<id>.json` and converts `rowsUpdatedAt * 1000` to ISO), `comptrollerExternalId`, and `canonicalJson`/`payloadHash`. The host is a module-level constant. Dataset ids must match `xxxx-xxxx` and SoQL parameter names must match `$[a-z]+`, so a bad value is refused before any request is made (T-3-05). `src/env.ts` gained an optional server-only `SOCRATA_APP_TOKEN`, normalised with `|| undefined`. The counts script now imports the client. **I ran it live: 41 requests, every count identical, only `measuredAt`/`fetchedAt` moved (to the UTC date). I then restored the three seed files to HEAD.**
- **Task 2 — fixtures + handlers (`628b569`).** Recorded live on 2026-09-23T01:00:35Z. `rowsUpdatedAt` matched the plan exactly: jrea 2026-09-19T08:05:21Z, 3kx8 2026-09-21T15:48:35Z, and it did not change during the capture. Handlers dispatch on the recorded `$where`/`$order` and emulate `$offset`/`$limit`. An unrecorded query, or a read past the truncated 3kx8 page, gets a 501. The 400 envelope is checked when it loads and replayed as a one-shot, reset in `afterEach`. `onUnhandledRequest: 'error'` is still set in exactly one place.
- **Task 3 — transforms, TDD (RED `eafd117`, GREEN `0be1ea8`).** `permitRowSchema` / `comptrollerRowToSourceRecord` (`tx_comptroller`), and `closureRowSchema` / `closureRowToSourceRecord` (`tx_comptroller_closures`, with `closedAt` read in `APP_TZ`: 06:00Z in CST, 05:00Z in CDT).

## Tests

`tests/unit/socrata.test.ts` has 23 tests. Unit suite: 81 before this plan, 104 after, all passing. `typecheck` and `lint` pass. The plan's six required names all pass: `comptroller row` (5), `unpadded county` (2), `naics prefix` (2), `socrata 400 echoes the SoQL error body`, `canonical hash`, and `closure row parses in America/Chicago`.

**Mutation checks.** For each one I made a single change, confirmed the named test failed, then reverted. `git diff` was clean afterwards.

| Mutation | Test that failed |
|---|---|
| `starts_with` added to a comment in client.ts | naics prefix: the SoQL string-prefix function appears nowhere... |
| msw handler stops checking `$where` | socrata replay: an unrecorded $where is refused... |
| `TZDate(..., APP_TZ)` replaced with `new Date(floating)` | closure row parses in America/Chicago |
| `RGV_UNPADDED_COUNTY_CODES[0]` set to `'031'` | unpadded county: the two formatters differ... |
| `z.coerce.string()` replaced with `z.string()` on the NAICS field | comptroller row: every recorded row parses, and a numeric NAICS is coerced |
| `payloadHash` uses `JSON.stringify` instead of `canonicalJson` | canonical hash |
| SoQL body dropped from the error message | socrata 400 echoes the SoQL error body |

## Deviations from Plan

1. **[Rule 3 — Blocking] The `naics prefix` grep test did not exist.** The plan calls it "the existing grep test". No test file anywhere mentioned it; the grep was only a prose convention. I created it in Task 1 (`tests/unit/socrata.test.ts`), covering `src/lib/socrata/**` and the script, with a check that the scan actually reached both targets. Without this, Task 1's verify command would have matched no tests.
2. **[Rule 3 — Blocking] `client.ts` does not import `@/env`.** The counts script runs under `tsx`, where `import 'server-only'` resolves to the entry that throws. `src/env.ts` would also demand `CLERK_SECRET_KEY` and a pool URL the script never needed. So the client reads `process.env.SOCRATA_APP_TOKEN || undefined` directly. `src/env.ts` still declares the variable, so the deployed server validates it at boot. A test checks that the header is sent only when a token is present, and that `''` counts as absent.
3. **[Rule 1 — Plan contradiction] The 3kx8 fixture cannot contain the join row under the closure filter.** `(32006170057, 5)` has no `out_of_business_date`: it is an open location. So the recorded `$where` is `loc_county in ('31',...) and tp_number >= '32006170057' and (out_of_business_date IS NOT NULL or (tp_number='32006170057' and loc_number='5'))`. The fixture holds 49 real closures plus the active join row. That row now serves two tests: the join-key equality test, and a test that the closure schema refuses an open location.
4. **[Rule 1 — Plan contradiction] The jrea `$where` was widened.** With the plain RGV filter, `$order=taxpayer_number,outlet_number` and `$limit=50`, the first page has no `RIO GRANDE CY` variant and does not include the join row. The recorded `$where` covers two windows, and the README states both. **No accented `outlet_name` exists in the four RGV counties.** I checked seven accented characters live and got 0 rows, so the "if present" item does not apply. The page has 40 rows, which is the whole result of its `$where`.
5. **[Rule 2] Added a sidecar fixture, `tests/unit/msw/fixtures/socrata-recordings.json`, which is not in the plan's file list.** A Socrata page is a bare array, so it has no place to record its own `$where`. The capture run wrote this sidecar from the same variables it used for the requests, and `RECORDED_WHERE`/`RECORDED_ORDER` are read from it.
6. **Additions beyond the plan:** `socrataCount`, `comptrollerExternalId`, `canonicalJson`, `payloadHash` and `TEXAS_COUNTY_CODES` are exported from client.ts. The RGV `$where` literals are exported (`PERMITS_RGV_WHERE`, `CLOSURES_RGV_WHERE`). There is a 60-second fetch timeout and a 100-page loop cap. The `/api/views` handler answers `{ rowsUpdatedAt }` only, because the real metadata payload is too large to be worth recording. And `startReplayServer` is an alias of `startCensusServer`.
7. **The `onUnhandledRequest: 'error'` grep counted 2 at HEAD** (one in the header comment, one in the call). I reworded the comment, so the grep now matches exactly once. The only call site did not change.

## Observations for other plans

- **The plan's verification grep `grep -rn "data.texas.gov" src/ tests/ | grep -v client.ts | grep -v tests/unit/msw/` is not empty.** It matches three provenance `"source"` strings that were already committed in `src/seed/data/{cities,clusters,outlet-counts}.json`. They are descriptive text, not requests. **03-06's repo-wide network grep needs to exclude `src/seed/data/` or match only URL call sites.** I left the seed files untouched.
- **`$PNPM test:unit -- -t "<name>"` does not filter.** The `--` reaches vitest, the filter is ignored, and the whole suite runs green (85/85 in my first attempt). Use `$PNPM test:unit -t "<name>"`. Every verify listed above was run in that form, and I read the test names in the output.
- Downstream ingest should `safeParse` each row and count rejects rather than throw. `permitRowSchema` requires the identity fields and a padded county code. `closureRowSchema` requires the closure date and an unpadded county code.

## Known Stubs

None.

## Threat Flags

None. T-3-03 (zod bounds, stripped columns), T-3-04 (literal county lists, `quote()`), T-3-05 (constant host, validated dataset id and parameter names) and T-3-14 (a single `onUnhandledRequest: 'error'`) are all implemented and tested. T-3-02 (optional, server-only token) is accepted as planned.

## TDD Gate Compliance

Task 3: RED `eafd117` (`test(03-03)`; the suite failed with `ERR_MODULE_NOT_FOUND` for the transforms), then GREEN `0be1ea8` (`feat(03-03)`). No refactor commit was needed.

## Self-Check: PASSED

- Files: src/lib/socrata/{client,permits,closures}.ts, tests/unit/socrata.test.ts, and the four socrata fixture files all exist.
- Commits: edc7f65, 628b569, eafd117, 0be1ea8 are all present on `worktree-agent-a2fd498aa848a1f59`.
- No tracked file was deleted between d55bc15 and HEAD. STATE.md and ROADMAP.md were not touched.

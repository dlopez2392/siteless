---
phase: 04-places-transient-verifier
plan: 10
subsystem: test-harness
tags: [msw, places, fixtures, d-20, place-05]
requires: []
provides:
  - "tests/unit/msw/places.ts: PLACES_ENDPOINT, PLACES_ORIGIN, PLACES_PAGES, placesHandler, setPlacesRoutes, resetPlaces, onPlacesRequest, placesRequests, PLACES_SENTINELS, PlacesRoute, PlacesRequest"
  - "12 synthetic places-*.json fixtures + places-recordings.json sidecar (synthetic: true)"
  - "placesHandler registered in the shared setupServer (onUnhandledRequest: 'error' unchanged)"
affects: [04-12, 04-18, 04-19, and every later Places test in the unit, DB and workflow lanes]
tech-stack:
  added: []
  patterns:
    - "RegExp msw path for Google's colon-verb URLs (Pitfall 8)"
    - "501 refusal on a missing mask / key / includePureServiceAreaBusinesses"
    - "field-mask projection of every served place"
    - "load-time sidecar and envelope checks, file list read from disk"
key-files:
  created:
    - tests/unit/msw/places.ts
    - tests/unit/places-msw.test.ts
    - tests/unit/msw/fixtures/places-saturated-p1.json
    - tests/unit/msw/fixtures/places-saturated-p2.json
    - tests/unit/msw/fixtures/places-saturated-p3.json
    - tests/unit/msw/fixtures/places-child-12.json
    - tests/unit/msw/fixtures/places-empty.json
    - tests/unit/msw/fixtures/places-match-page.json
    - tests/unit/msw/fixtures/places-ids-only.json
    - tests/unit/msw/fixtures/places-429-daily.json
    - tests/unit/msw/fixtures/places-429-minute.json
    - tests/unit/msw/fixtures/places-400-invalid.json
    - tests/unit/msw/fixtures/places-503.json
    - tests/unit/msw/fixtures/places-recordings.json
  modified:
    - tests/unit/msw/server.ts
    - tests/unit/msw/fixtures/README.md
decisions:
  - "Child-tile phones are (956) 555-0161..0172, not 01..12, so they never collide with the saturated pages' 555-0101..0160 when a test serves both"
  - "The handler also 501s a wildcard or non-places.* field-mask entry (a wildcard would bill the top SKU)"
  - "Refused (501) requests are not logged in placesRequests; the log holds served requests only"
  - "resetPlaces() is called from both resetCensus() and resetSocrata(), so any file using the shared server clears Places state"
metrics:
  duration: "~35 min"
  completed: 2026-09-23
  tasks: 2
  files: 16
---

# Phase 4 Plan 10: Places replay harness Summary

This plan adds the msw replay for Google Places Text Search that every later Places test runs against. It has a RegExp-anchored handler that refuses requests without a field mask, an API key, or `includePureServiceAreaBusinesses: true`. Each served place is cut down to the fields the mask names. It is backed by 12 hand-written synthetic fixtures, whose sidecar marks them `synthetic: true` (D-20). The handler checks that sidecar when it loads.

## What was built

**Task 1: fixtures (commit `83f6b43`)**
- The saturated search is 3 pages of 20, ids `synthetic-sat-001…060`, all inside McAllen's bbox. p1 and p2 carry `saturated:p2` and `saturated:p3`; p3 has no token. `websiteUri` cycles through none, `.example`, `business.site`, facebook and wixsite.
- `places-child-12.json` has 12 places. `places-empty.json` is `{}`. `places-ids-only.json` has 10 `{ id }` places.
- `places-match-page.json` has the 7 places the plan specifies, with names, streets and phones copied exactly from the `PLACES_SPINE` contract. The two pure SABs (rio, valley) have no `formattedAddress` and no `location`.
- There are 4 `{ status, body: { error } }` envelopes: 429 daily (with `ErrorInfo` and `quota_limit: SearchTextRequestsPerDayPerProject`), 429 minute, 400 and 503. Their messages are prefixed `Synthetic:`, and none contains Google-authored wording.
- `places-recordings.json` is the sidecar: `synthetic: true`, `anonymized: false`, `recordedFrom: null`, and a per-file place count and token flag.
- The README gains a Places section covering the request shape, the file table, the D-20 rule and the spine contract.

**Task 2: handler (RED `8792578` → GREEN `d071a12`)**
- `PLACES_ENDPOINT = /^https:\/\/places\.googleapis\.com\/v1\/places:searchText$/`. The string path is not used anywhere, and the acceptance grep for it returns nothing.
- The handler runs in this order:
  1. Parse the body.
  2. Return 501 for a missing mask, a missing key, or an SAB flag that is not `true`. Each message names what is missing.
  3. Parse the mask. A wildcard or unknown entry also gets a 501.
  4. Log the request, then `await hook`.
  5. Remove `pageToken` from the body and match routes. An error route answers `times` times, 1 by default, and is skipped after that.
  6. Pick the page from the token's `:pN` suffix. A page that doesn't exist gets a 501.
  7. Cut the places down to the masked fields. `nextPageToken` is included only if the mask names it.
- Load-time checks:
  - The sidecar must say synthetic or anonymized.
  - Each envelope's `status` must equal `body.error.code`.
  - The set of `places-*.json` files on disk must equal the sidecar's file list, with matching place counts and token flags.
  - While `synthetic: true`, every id must start with `synthetic-`.
- `PLACES_SENTINELS` is built from every fixture on disk: display names, addresses, phones and websites, deduplicated and non-empty. There are more than 150.
- `PLACES_ORIGIN` and `PLACES_PAGES` are also exported. The test builds URLs from `PLACES_ORIGIN` so that no file outside `tests/unit/msw/` writes out the Places host, which keeps it safe once another plan adds that host to `no-network.test.ts`.

## Verification

- `npx vitest run tests/unit/places-msw.test.ts --reporter=verbose`: **8/8 pass**. The PASS list names all eight required tests.
- The msw-backed suites stay green: census, socrata, census-batch, ingest-comptroller, no-network and no-google-credential. Together with places-msw that is 7 files, 62 tests.
- Full unit lane `npx vitest run tests/unit`: **47 files, 348 tests, all pass**.
- `npx tsc --noEmit`: exit 0. `npx eslint . --ignore-pattern ".claude/**"`: exit 0. Prettier is clean on every file I touched.
- Mutation checks. Each mutation was applied to the committed file, the named test was read red, the file was reverted with `git checkout -- <file>`, and `git status` came back clean:

| # | Mutation | Red test |
|---|----------|----------|
| A | SAB-flag refusal removed | the places handler refuses a request without includePureServiceAreaBusinesses |
| B | RegExp replaced by the string path | the places handler never matches a look-alike path (reproduces Pitfall 8) |
| C | Mask projection disabled | the places handler serves only the masked fields |
| D | Mask-header refusal removed | the places handler refuses a request without the field mask header |
| E | Key-header refusal removed | the places handler refuses a request without the api key header |
| F | pageToken ignored (always page 1) | the places handler pages by token |
| G | Error route made sticky | the places handler serves the error envelopes |
| H | Sidecar `synthetic: true` set to false | module load throws the D-20 error (the file fails at import) |

The DB lane was not run. This plan touches no schema or DB code, and the shared local test database is being migrated at the same time by 04-09.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] 501 on a wildcard or unrecorded field-mask entry**
- **Found during:** Task 2
- **Issue:** The plan only lists 501s for a missing mask, key or SAB flag. A `*` mask would be served everything, and in production it would bill the highest SKU, so a builder that regressed to a wildcard would pass silently.
- **Fix:** Any mask entry that is not `nextPageToken` or `places.<field>` now gets a 501 naming the entry.
- **Files:** tests/unit/msw/places.ts. **Commit:** d071a12

**2. [Rule 3 - Blocking] Extra exports `PLACES_ORIGIN` and `PLACES_PAGES`**
- **Found during:** Task 2
- **Issue:** Tests need the page arrays to build routes, and a URL to fetch. Writing the host out in a test file outside `tests/unit/msw/` would trip `no-network.test.ts` as soon as the Places host is added to its `HOSTS` list, which a later plan does.
- **Fix:** Both are exported from `places.ts`. Everything the plan lists is exported as specified.
- **Commit:** d071a12

**3. [Minor] Child-tile phones use 555-0161..0172**
- The plan says "same shape". The obvious `555-01NN` with NN = 01..12 would duplicate the phones of `synthetic-sat-001..012`, so a dedupe test that serves both would see false phone matches. This is documented in the README and the sidecar.

**4. [Minor] `resetPlaces()` is also called from `resetSocrata()`**
- The plan says to call it "wherever the shared server resets its one-shot injections". Both `resetCensus` and `resetSocrata` do that, so both now call it.

**5. [Minor] Hook argument**
- `onPlacesRequest`'s hook receives the full `PlacesRequest` (`{ body, mask, hasKey }`), which includes the plan's `{ body }`. A hook written as `({ body }) => …` still type-checks.

## Known Stubs

None. The fixtures are synthetic on purpose, as D-20 requires until 04-19's recorder runs after the D-01 legal gate. The sidecar and README both say so.

## Notes for the orchestrator / merge

- `tests/unit/msw/server.ts` gains one import, one handler registration and one `resetPlaces()` call in each of `resetCensus` and `resetSocrata`. Any other wave-1 plan that edits `server.ts`'s `setupServer(...)` list will conflict on those lines. Keep both.
- 04-18 may adjust `synthetic-match-tentative` once to pin its 80–94 score. If it does, the sidecar count stays at 7.
- 04-19 must flip the sidecar to `anonymized: true` when it writes real recordings. The load-time id check only applies while `synthetic: true`.
- The Places host now appears in `tests/unit/msw/places.ts`, which is under the `ALLOWED_PREFIXES` of `no-network.test.ts`.
- No network call of any kind was made. Nothing was pushed, and production was not touched.

## Threat Flags

None. This plan adds test-only surface, and it matches the plan's threat register (T-4-05, T-4-09, T-4-10).

## Self-Check: PASSED

- The files exist: tests/unit/msw/places.ts, tests/unit/places-msw.test.ts, 12 `places-*.json` files and the README section.
- The commits exist: 83f6b43, 8792578 and d071a12.
- TDD gate: `test(04-10)` 8792578 (RED, the module was missing) comes before `feat(04-10)` d071a12 (GREEN).

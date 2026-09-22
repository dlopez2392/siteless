---
phase: 02-budget-governor-search-presets
plan: 07
subsystem: api
tags: [estimator, geocoding, census, msw, zod, pricing, copy, accessibility]

requires:
  - phase: 02-01
    provides: msw@2.15.0 in package.json and the vitest two-lane harness
  - phase: 02-02
    provides: the seeded cell lists (cities/counties/clusters/outlet-counts/geo-presets), the shared PresetSpec fixture, and the four recorded Census payloads
  - phase: 02-04
    provides: PRICE_BOOK, priceRequests, freeRemaining, formatUsd, formatPct and the Chicago budget period
provides:
  - "The estimator: cells, requests, dollars, expected businesses and percent of remaining budget, as pure arithmetic over the seed with zero paid calls"
  - "Three committed assumption constants (FAN_OUT, PAGES_LO/HI, RADIUS_REFERENCE_MILES) that every dollar figure scales off, each pinned by an exact-value test"
  - "texasMultiplier(), computed from the seeded cell lists rather than typed as a constant"
  - "The US Census Geocoder client: free, keyless, Texas-guarded, zod-parsed, four named failure reasons, never throws"
  - "tests/unit/msw/server.ts - the msw replay harness with onUnhandledRequest 'error', reusable by Places and Firecrawl in Phase 4"
  - "src/lib/ui/run-tone.ts and src/lib/ui/copy.ts - server-safe maps an RSC page can import"
affects: [02-09, 02-10, 02-11, 02-12, phase-04-places-verifier]

tech-stack:
  added: []
  patterns:
    - "Estimator purity: the caller supplies seed tables and budget context; the estimator imports no database module and has no clock"
    - "Sum exact, round once: cells carry both a rounded display count and an unrounded exact count, so a 1,016-cell total reconciles against the seeded statewide figure"
    - "msw replay: dispatch keyed on the address read OUT of each fixture, so no test restates a recorded string"
    - "A file inside a guarded tree must not spell the token its guard greps for (src/lib/time.ts precedent, now also src/lib/ui/* and src/lib/geocode/census.ts)"

key-files:
  created:
    - src/lib/estimate/assumptions.ts
    - src/lib/estimate/expand-cells.ts
    - src/lib/estimate/estimate.ts
    - src/lib/geocode/census.ts
    - src/lib/ui/run-tone.ts
    - src/lib/ui/copy.ts
    - tests/unit/msw/server.ts
    - tests/unit/estimate.test.ts
    - tests/unit/census.test.ts
    - tests/unit/ui-maps.test.ts
  modified:
    - tests/unit/fixtures/preset.ts
    - vitest.config.ts

key-decisions:
  - "Texas expected results are 552275, not the plan's 552278 - the sentinel-excluded figure plan 02-02 measured and committed"
  - "The 250 counties with no measured per-cluster breakdown take an apportioned share of the statewide row, so the Texas total reconciles to the seed exactly"
  - "PresetSpec/GeoSpec/CityRef are declared once in src/lib/estimate/expand-cells.ts and re-exported by the test fixture"
  - "The Census address guard is a control-character deny-list plus a length bound, not an allow-list - safety comes from POSITION, which a named test asserts"
  - "An address refused by the input guard reports reason 'no_match' rather than a fifth reason, because UI-SPEC's no-match copy is the right instruction for it"
  - "The vitest node lane resolves server-only to its no-op twin; the dom lane keeps the throw armed"

patterns-established:
  - "Exact-value cost-model tests over the real seeded cell list, never toBeCloseTo, with a two-sided assertion wherever a correction is applied"
  - "Every geocoder outcome is a named reason, never a throw - a thrown geocoder in a server action is a 500 with no copy"
  - "Colour is never the only signal: RUN_TONE and RUN_LABEL ship together and a test asserts refused/failed share a tone but not a word"

requirements-completed: [SRCH-04, SRCH-01, BUDG-01]

duration: 33min
completed: 2026-09-22
---

# Phase 02 Plan 07: Estimator, Census Geocoder and the Server-Safe UI Maps Summary

**A preset is priced before it runs — 68 cells, 204–612 requests, $0.00 while the monthly free allowance lasts and $21.42 after it — over the real seeded cell list with zero paid calls, plus a keyless Texas-guarded Census geocoder replayed from four recorded payloads.**

## Performance

- **Duration:** 33 min
- **Started:** 2026-09-22T14:12:38Z
- **Completed:** 2026-09-22T14:45:41Z
- **Tasks:** 3 of 3
- **Files created/modified:** 12 (10 created, 2 modified)

## Accomplishments

- **SRCH-04 is true without spending a cent.** `estimatePreset` returns a range in requests, dollars, expected businesses and percent of remaining budget, computed as pure arithmetic over the committed seed. No database import, no clock, no fetch — which is what makes D-08's recompute-as-you-type safe.
- **The free allowance is applied**, so an early-month RGV preset reads `$0.00` rather than `$2.38`. Both directions are pinned by one named test, because a test that only proves "not $2.38" is equally green on a calculation that returns zero for everything.
- **The Texas multiplier is computed, not typed.** 9144 / 612 = **14.941176470588236**, rendered `×14.9`. A test asserts the ratio exactly and scans `src/lib/estimate/` for a standalone `38`.
- **SRCH-01 / D-02: an address becomes a lat/lng and a county FIPS with no key and no cost.** All four outcomes return a named reason; the geocoder never throws.
- **CI cannot reach the network.** `onUnhandledRequest: 'error'` lives inside `startCensusServer()` so no test file can relax it.
- **The two UI maps are server-safe**, and both they and the geocoder now follow `src/lib/time.ts`'s precedent of not spelling the token their own guard greps for.

## Task Commits

1. **Task 1: The estimator — cells, committed assumptions, the free allowance, the computed Texas multiplier** — `9c017eb` (feat)
2. **Task 2: The US Census Geocoder client and its msw replay harness** — `33b5410` (feat)
3. **Task 3: The two server-safe UI maps** — `1748083` (feat)

**Plan metadata:** `7d01256` (docs: complete plan)
**Self-check fix:** `0e09399` (fix: raw NUL bytes made `expand-cells.ts` binary to git — deviation 7)

## Files Created/Modified

| File | What it does |
|---|---|
| `src/lib/estimate/assumptions.ts` | `FAN_OUT = 3.0`, `PAGES_LO = 1`, `PAGES_HI = 3`, `RADIUS_REFERENCE_MILES = 25`, `DEFAULT_MONTHLY_SWEEPS`, `ESTIMATE_SKU`, and the Comptroller under-count caveat |
| `src/lib/estimate/expand-cells.ts` | `expandCells(spec, seed)` → `Cell[]`; owns `PresetSpec`/`GeoSpec`/`CityRef`/`SeedTables`; D-09 city apportionment, radius-squared scaling, and the statewide apportionment for unmeasured counties |
| `src/lib/estimate/estimate.ts` | `estimatePreset`, `texasMultiplier`, `builtInSpec`, and the never-divide-by-zero percent helper |
| `src/lib/geocode/census.ts` | `geocodeAddress(address)` — server-only, hard-coded host/path, zod-bounded input, zod-parsed response, `AbortSignal.timeout(8000)`, Texas `'48'` guard |
| `src/lib/ui/run-tone.ts` | `RunStatus`, `BadgeTone`, `RUN_TONE`, `RUN_LABEL`, `RUN_STATUSES` |
| `src/lib/ui/copy.ts` | The strings UI-SPEC's Copy Table fixes, money formatted through `formatUsd` |
| `tests/unit/msw/server.ts` | The Census replay handler, the request log, the one-shot 503 and one-shot JSON helpers, and the starter that sets `onUnhandledRequest: 'error'` |
| `tests/unit/estimate.test.ts` | Ten named tests, exact values throughout |
| `tests/unit/census.test.ts` | The seven named `census …` tests |
| `tests/unit/ui-maps.test.ts` | The directive grep, the `runs_status_known` drift guard, and the copy assertions |
| `tests/unit/fixtures/preset.ts` *(modified)* | Now imports and re-exports the spec types instead of redeclaring them |
| `vitest.config.ts` *(modified)* | Node lane resolves `server-only` to its no-op twin |

## Verification Results

### `pnpm test:unit` — 16 files, **63 passed, 0 failed**

New tests, by name, all green:

```
tests/unit/estimate.test.ts
  ✓ cost model: the RGV baseline priced over the real seeded cell list
  ✓ cost model: the RGV county baseline
  ✓ cost model: Texas exceeds the cap and says so
  ✓ free allowance: 68 requests
  ✓ texas multiplier is computed, not a constant
  ✓ estimate: a city cell apportions from its county
  ✓ estimate: a radius cell scales by the square of the radius ratio
  ✓ estimate: percent of remaining budget never divides by zero
  ✓ estimate: an unseeded cluster-geography pair throws rather than estimating zero
  ✓ assumptions: the caveat names the under-count the numbers cannot show

tests/unit/census.test.ts
  ✓ census: a McAllen street address resolves to Hidalgo County
  ✓ census: a Rio Grande City address resolves to Starr County
  ✓ census: an empty addressMatches is a no_match, not an error
  ✓ census: a 503 is unreachable
  ✓ census texas only: a non-Texas match is rejected
  ✓ census: the address is only ever a query parameter
  ✓ census: an over-long or empty address is refused before any request

tests/unit/ui-maps.test.ts
  ✓ ui maps: no module under src/lib/ui carries a use client directive
  ✓ ui maps: RunStatus matches the runs_status_known CHECK constraint
  ✓ ui copy: money is formatted, never concatenated
  ✓ ui copy: the fixed strings are the ones UI-SPEC fixed
  ✓ ui copy: the version notice refuses a version with no predecessor
```

`pnpm test:unit -t "no google credential"` → **1 passed, 57 skipped**.
`pnpm typecheck` → clean. `pnpm lint` → clean.

### The four watched-red-first mutations

Each was applied, RUN, the failure output read, then reverted and the suite re-run green.

**Mutation 1 — `FAN_OUT = 3.0` → `6.0`.** Both predicted tests red, verbatim:

```
FAIL  cost model: the RGV baseline priced over the real seeded cell list
AssertionError: expected 408 to be 204 // Object.is equality
- Expected 204  + Received 408          (tests/unit/estimate.test.ts:93 — requestsLo)

FAIL  cost model: the RGV county baseline
AssertionError: expected 288 to be 144 // Object.is equality

FAIL  cost model: Texas exceeds the cap and says so
AssertionError: expected 18288 to be 9144 // Object.is equality
- Expected 9144  + Received 18288       (tests/unit/estimate.test.ts:128 — requestsHi)
```

Reverted; `grep -n "FAN_OUT = " src/lib/estimate/assumptions.ts` → `27:export const FAN_OUT = 3.0;`; `cost model` back to 3 passed.

**Mutation 2 — free allowance dropped at `priceRequests`'s caller** (`…, free)` → `…, 0)`):

```
FAIL  cost model: Texas exceeds the cap and says so
AssertionError: expected 320040000 to be 285040000 // Object.is equality

FAIL  free allowance: 68 requests
AssertionError: expected 21420000 to be +0 // Object.is equality
- Expected 0  + Received 21420000        (estimate.test.ts:162 — early.costMicroUsdHi)

FAIL  estimate: percent of remaining budget never divides by zero
AssertionError: expected 21420000 to be +0 // Object.is equality
- Expected 0  + Received 21420000        (estimate.test.ts:275 — free estimate at a spent-out cap)
```

The other 13 test files stayed green. Reverted; 58 passed.

**Mutation 3 — `x` and `y` swapped in the coordinate mapping.** Red on the SIGN assertion, exactly the intended catch:

```
FAIL  census: a McAllen street address resolves to Hidalgo County
AssertionError: expected -98.227818572894 to be greater than 0
   (tests/unit/census.test.ts:62 — expect(result.lat).toBeGreaterThan(0))

FAIL  census: a Rio Grande City address resolves to Starr County
AssertionError: expected -98.820694724603 to be 26.379140479117 // Object.is equality
```

Reverted.

**Mutation 4 — the `STATE === '48'` guard removed.** Red **ALONE** (1 of 63):

```
FAIL  census texas only: a non-Texas match is rejected
AssertionError: expected { Object (ok, lat, ...) } to deeply equal { ok: false, reason: 'not_texas' }
- { "ok": false, "reason": "not_texas" }
+ { "ok": true, "countyFips": "48215", "countyName": "Hidalgo County",
+   "lat": 26.216125532948, "lng": -98.227818572894,
+   "matchedAddress": "1400 N 10TH ST, MCALLEN, TX, 78501" }
```

The other six `census …` tests — including the McAllen success that is this test's positive control — stayed green. Reverted; 63 passed.

### The computed Texas multiplier

```
texas requestsHi 9144 / baseline requestsHi 612
multiplier = 14.941176470588236
rendered as x14.9
```

**Not the UI-SPEC's illustrative badge value.** Executor Rule 16 holds: the copy format stands, the number is computed.

### `grep -rln "America/Chicago" src/`

```
src/db/schema/orgs.ts
src/lib/time.ts
src/lib/ui/copy.ts
```

- `src/lib/time.ts` — the authority. Unchanged.
- `src/db/schema/orgs.ts` — pre-existing (Phase 1): `text('timezone').notNull().default('America/Chicago')`, a column default, not an `Intl` call.
- `src/lib/ui/copy.ts` — **NEW, and prose only.** The zone name appears inside two sentences a human reads (`BUDGET_100_BANNER`'s "…at 12:00 AM America/Chicago." and `BUDGET_CAP_HELP`'s "Resets at 12:00 AM on the 1st, America/Chicago."). Confirmed: `grep -n "Intl\|timeZone\|APP_TZ" src/lib/ui/copy.ts` matches only a comment line; the file's single import is `formatUsd` and it formats no dates. **Every formatting call site in the repo still resolves its zone from `src/lib/time.ts`.**

### Other criteria

| Check | Result |
|---|---|
| `grep -rc "from '@/db" src/lib/estimate/ \| grep -v ':0' \| wc -l` | `0` |
| `grep -rc "use client" src/lib/estimate/ \| grep -v ':0' \| wc -l` | `0` |
| `grep -rc "use client" src/lib/ui/ \| grep -v ':0' \| wc -l` | `0` |
| `grep -rnE "\b38\b" src/lib/estimate/` | no matches |
| `grep -rn "x38\|×38" src/` | no matches |
| `grep -rn 'googleapis\|GOOGLE' src/lib/geocode/` | no matches |
| `grep -c "toFixed" src/lib/ui/copy.ts` | `0` |
| `head -1 src/lib/geocode/census.ts` | `import 'server-only';` |
| `census.ts` contains `geocoding.geo.census.gov` / `Public_AR_Current` / `Current_Current` / `layers=Counties` / `AbortSignal.timeout` / `'48'` | 1 / 1 / 1 / 3 / 1 / 1 |
| `tests/unit/msw/server.ts` sets `onUnhandledRequest` | `server.listen({ onUnhandledRequest: 'error' })` |

## Decisions Made

1. **Texas expected results are 552275.** See deviation 1.
2. **Unmeasured counties take an apportioned share of the statewide row.** See deviation 2.
3. **`PresetSpec` is declared once, in `src/lib/estimate/expand-cells.ts`.** See deviation 3.
4. **The Census input guard is a control-character deny-list + a length bound, not a character allow-list.** Control characters are the only class that can corrupt an HTTP request (CRLF splitting). Everything else — including `../../evil?x=` and `https://evil.example/` — is permitted and made harmless by *position*: it can only become the value of the `address` query parameter of a constant host and a constant path, percent-encoded by `URLSearchParams`. An allow-list rejecting `:` or `/` would look stricter, protect nothing, and reject real addresses. `census: the address is only ever a query parameter` asserts the property that actually matters, and additionally asserts `url.searchParams.get('x')` is null — i.e. the `?x=` did not become a second parameter.
5. **A refused input reports `reason: 'no_match'`** rather than a fifth reason. To a user an unusable address *is* an address the geocoder could not find, and UI-SPEC's no-match copy ("Try a street address with a city and ZIP") is the right instruction. No new union member the screens would have to handle.
6. **`VERSION_NOTICE(n)` throws for `n < 2`.** "Runs … keep pointing at version 0" is a sentence about a row that does not exist. The new-preset screen has its own copy.
7. **Quotation marks in `GEOCODE_NO_MATCH` follow UI-SPEC, not the plan's transcription.** UI-SPEC renders `We couldn't find “{address}”.` with typographic quotes at both § States → Error and § Empty states; the plan's body restated it with straight quotes. UI-SPEC is the copy authority and the plan's own `<read_first>` points at it for exact copy. Flagged for 02-10/02-11: assert against the constant, not a retyped string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The Texas expected-result total is 552275, not the plan's 552278**

- **Found during:** Task 1
- **Issue:** The plan's `cost model: Texas exceeds the cap and says so` specifies `expectedResults === 552278`. The committed seed cannot produce that. `src/seed/data/outlet-counts.json` carries statewide rows of 45612 / 120748 / 23846 / 362069, summing to **552275**, and its own `statewideScope` field states why: the Comptroller dataset carries a 255th `outlet_county_code` sentinel `'000'` belonging to no Texas county, and RESEARCH's 552278 was measured without the mandated `between '001' and '254'` filter. Plan 02-02 measured both ways, isolated the delta to exactly 1 food_hospitality and 2 auto_retail rows, and committed the sentinel-excluded figures precisely so the `texas_254_counties` preset's arithmetic would reconcile. The plan carried RESEARCH's stale number forward.
- **Fix:** Asserted `552_275`, with the reasoning in a comment above the assertion. Added a second assertion that the total equals the sum of the four `scope: 'state'` rows read from the seed at test time, so this can never again be a typed constant that drifts from the data.
- **Files modified:** `tests/unit/estimate.test.ts`
- **Verification:** `cost model: Texas exceeds the cap and says so` passes; it also reds correctly under mutation 1.
- **Committed in:** `9c017eb`

**2. [Rule 3 — Blocking] The 250 non-RGV counties have no seeded per-cluster count, so the Texas preset could not be estimated at all**

- **Found during:** Task 1
- **Issue:** The plan's county rule is "read straight from the seed" plus "throw if a cluster or geography unit has no seeded count". `outlet-counts.json` carries per-cluster county rows for the **four RGV counties only**. Applied literally, `TEXAS_SPEC` (254 counties × 4 clusters) would throw on its 17th cell, and the plan's own Texas test could never pass. The two instructions are mutually unsatisfiable against the committed seed.
- **Fix:** A county with a measured `(county, cluster)` row uses it. A county that is **in `counties.json`** but has no measured row for that cluster takes an apportioned share of that cluster's statewide residual: `(state[cluster] − Σ measured county rows) / (254 − measured county count)`. The sum over all 254 counties is therefore the seeded statewide figure **exactly**, by construction — verified by the second assertion in deviation 1. The throw is preserved for the cases that matter: a county FIPS in no seed file, a city not in `cities.json`, and a cluster with neither a county row nor a statewide row, each with a message naming the missing key. Two supporting changes make the reconciliation exact rather than approximate:
  - `Cell` carries **both** `expectedOutlets` (rounded, what a cell displays) and `expectedOutletsExact` (unrounded). `expectedResults` sums the exact values and rounds **once** — rounding 1,016 cells first introduces drift that cannot be reconciled against the seed.
  - `indexSeed` throws if a cluster's measured county rows already exceed its statewide row, naming the cluster. Silently clamping would make the Texas total *look* reproducible and be wrong.
- **Files modified:** `src/lib/estimate/expand-cells.ts`
- **Verification:** `cost model: Texas exceeds the cap and says so` (552275, and equal to the statewide sum); `cost model: the RGV county baseline` (23978, all sixteen cells measured, no apportionment); `estimate: an unseeded cluster-geography pair throws rather than estimating zero` (three throw cases plus two positive controls).
- **Committed in:** `9c017eb`
- **🔴 Note for the assumptions drawer (02-11):** a *single* non-RGV county cell is a statewide average, not a measurement. The aggregate is sound; the per-cell figure for, say, Travis County is not a measured number and the drawer must say so. Module-level comment records this at the point of definition.

**3. [Rule 2 — Missing critical] `PresetSpec` was declared twice**

- **Found during:** Task 1
- **Issue:** `tests/unit/fixtures/preset.ts` declared `CityRef`/`GeoSpec`/`PresetSpec` inline (it predates `src/lib/estimate/`), and the estimator needs the same contract. `src` cannot import from `tests`, so shipping a second declaration would leave two structurally-identical types that type-check against each other while drifting in meaning — exactly the second-source-of-truth that fixture's own header warns about.
- **Fix:** The three types are declared once in `src/lib/estimate/expand-cells.ts`; the fixture imports and re-exports them, so every existing consumer keeps working unchanged. `cellCount` deliberately stays in the fixture as an independent re-derivation of the cell count, and `cost model: the RGV baseline …` asserts `expandCells`'s result against it.
- **Files modified:** `tests/unit/fixtures/preset.ts`, `src/lib/estimate/expand-cells.ts`
- **Verification:** `pnpm typecheck` clean; full suite green.
- **Committed in:** `9c017eb`

**4. [Rule 3 — Blocking] `import 'server-only'` made `census.ts` unimportable from the unit suite**

- **Found during:** Task 2
- **Issue:** `tests/unit/census.test.ts` failed before a single test ran: `Error: This module cannot be imported from a Client Component module.` The `server-only` package exports **two** modules — `empty.js` under the `react-server` condition and `index.js`, whose entire body is a `throw`, under every other. Next compiles server code with `react-server` set; Vitest does not. The plan requires line 1 of `census.ts` to be `import 'server-only';` **and** requires the unit suite to exercise it. No existing unit test imports a `server-only` module (`env-alias.test.ts` mocks around it), so this surfaced here first.
- **Fix:** The vitest **node lane only** aliases `server-only` to its no-op twin. Two wrong turns are recorded in the config comment so the next reader does not repeat them: (a) `resolve.conditions: ['react-server', …]` looks right and changes nothing, because Vitest **externalises** node_modules deps and Node's own resolver never sees Vite's conditions; (b) a bare `server-only/empty.js` specifier is refused, because the package's `exports` map does not expose that subpath — so the target is resolved via `require.resolve('server-only')` + `dirname` rather than a hard-coded `node_modules/…` path that pnpm does not promise. The **dom lane is deliberately untouched**: it simulates the client, where that throw is a real guard.
- **Files modified:** `vitest.config.ts`
- **Verification:** all seven `census …` tests pass; the dom lane's `jsdom lane renders a shadcn primitive` still passes; full suite 63/63.
- **Committed in:** `33b5410`
- **⚠️ Merge note:** `vitest.config.ts` is shared. If a sibling wave-2 plan also touched it, this is the conflict to expect — the change is two hunks (a `nodeAlias` const, and `resolve: { alias }` → `resolve: { alias: nodeAlias }` on the node project only).

**5. [Rule 1 — Bug] Three files spelled the token their own guard greps for**

- **Found during:** Tasks 2 and 3
- **Issue:** `src/lib/ui/run-tone.ts` and `src/lib/ui/copy.ts` explained the client-directive hazard by *naming the directive*, so `grep -rc "use client" src/lib/ui/` matched both files and `ui maps: no module under src/lib/ui carries a use client directive` failed, reporting the warnings as the violation. Independently, `src/lib/geocode/census.ts` wrote "WHY NOT GOOGLE" in a comment, tripping the criterion `grep -rn 'googleapis\|GOOGLE' src/lib/geocode/`. Both are the trap `src/lib/time.ts` documents: *a file inside a guarded tree must not spell the token the guard hunts for.*
- **Fix:** Reworded all three to describe the hazard without the token ("client-boundary directive", "WHY NOT THE PAID PATH"), each carrying a short note pointing at the precedent so the next author does not undo it. The guards stay bare token searches, matching the plan's acceptance criteria exactly. `tests/unit/ui-maps.test.ts` may spell the token freely — it lives under `tests/` and the walk covers only `src/lib/ui/` — and says so, mirroring `no-google-credential.test.ts`.
- **Files modified:** `src/lib/ui/run-tone.ts`, `src/lib/ui/copy.ts`, `src/lib/geocode/census.ts`
- **Verification:** both greps return 0 matches; `no google credential is read anywhere in src` still passes.
- **Committed in:** `33b5410`, `1748083`

**6. [Rule 2 — Missing critical] Task 3 had an acceptance criterion with nothing to check it**

- **Found during:** Task 3
- **Issue:** The criterion "`RunStatus` union matches the six values in `runs_status_known` from `drizzle/`" is a drift condition between a TypeScript union and a SQL CHECK constraint. `pnpm typecheck` — the task's only listed verification — cannot see it. A status the database allows but the tone map has never heard of renders as an unstyled badge with no word in it.
- **Fix:** Added `tests/unit/ui-maps.test.ts`: parses `runs_status_known` out of `drizzle/*.sql` and compares the extracted values to `RUN_STATUSES` in order, two-sided (asserts ≥1 constraint was found, so a rename makes the regex find nothing and fail rather than compare against an empty list). It also carries the directive grep and the copy assertions.
- **Files modified:** `tests/unit/ui-maps.test.ts` (new)
- **Verification:** 5 named tests, all green.
- **Committed in:** `1748083`

**7. [Rule 1 — Bug] `expand-cells.ts` contained two raw NUL bytes and git classified it as binary**

- **Found during:** self-check, after the SUMMARY commit
- **Issue:** `const SEP` — the separator used to build composite Map keys — was written as a *literal* U+0000 rather than an escape, and the doc comment above it quoted one too. Two raw NUL bytes in the file made git treat the whole module as **binary**: `git diff --stat` reported `src/lib/estimate/expand-cells.ts | Bin 0 -> 10333 bytes`, with no line diff at all. Every gate was green — `tsc`, `eslint` and all 63 tests — because the *character* is correct; only the encoding was. The cost is real and immediate: a binary-classified source file is invisible to review, produces no `git diff`, and cannot be three-way merged, and two sibling plans are merging into this branch's base.
- **Fix:** Replaced both with the escape `'\0'`, which denotes the same character. Behaviour is bit-identical.
- **Files modified:** `src/lib/estimate/expand-cells.ts`
- **Verification:** `NUL bytes in the COMMITTED blob: 0` (10,341 bytes); `git grep -n "const SEP" HEAD -- src/lib/estimate/expand-cells.ts` → `HEAD:src/lib/estimate/expand-cells.ts:69:const SEP = '\0';` — git only greps a file it reads as text. Full suite 63/63, typecheck and lint clean after the change.
- **Committed in:** `0e09399` (`fix`)
- **Note:** the one historical diff `1748083..0e09399` still prints `Bin`, because the *old* side is the binary blob. Everything from `0e09399` forward diffs as text.

### Deviations from stated criteria (not code changes)

**A. Mutation 1 reds three tests, not the two the criterion predicts.** The criterion names `cost model: the RGV baseline …` and `cost model: Texas exceeds the cap …`; `cost model: the RGV county baseline` also reds (`expected 288 to be 144`). Every dollar figure scales off `FAN_OUT` by design, so all three county/city cost models depend on it. More coverage of the mutation, not less; both predicted tests did red, with exact numbers.

**B. Mutation 2 does not red `free allowance: 68 requests` ALONE.** It reds three, and all three are genuine free-allowance assertions: the Texas cost (the free 1,000 × 35,000 µUSD = exactly the 35,000,000 delta), `free allowance: 68 requests`, and the "a free estimate at a spent-out cap is 0, not 100" half of the percent guard. The criterion is internally inconsistent with the plan's own Texas test, which it specifies to assert `freeRemaining === 1000` and a cost with the allowance already subtracted. The other 13 test files stayed green, so the mutation is still precisely localised.

---

**Total deviations:** 7 auto-fixed (3 bugs, 2 missing-critical, 2 blocking) + 2 criteria observations.
**Impact on plan:** No scope creep. Deviations 1 and 2 were required for the plan's own named tests to be satisfiable against the committed seed; 4 was required for the plan's own file to be testable. 3, 5 and 6 remove second sources of truth and add a guard the plan asked for but supplied no check for. 7 was caught only by the self-check — every gate was green on a file git could not diff. All three tasks completed as specified.

🔴 **The one worth carrying forward:** deviation 7 is the second time in this plan that *a file's own bytes defeated a check that was otherwise working* — the first being deviation 5, where three modules tripped their own greps by naming the token. Both were invisible to typecheck, lint and the test suite. A green suite proves nothing that an inspection of the artefact has not.

## Issues Encountered

- **`pnpm exec tsx -e` cannot be used on this machine** — `ERR_PNPM_CLI_EXEC_SPAWN: batch file arguments are invalid`. Only affected an ad-hoc confirmation script; the Texas multiplier is pinned by `texas multiplier is computed, not a constant` (which asserts `m === 9144 / 612` and `m.toFixed(1) === '14.9'`), so nothing was lost.
- **Two failed approaches to the `server-only` resolution** before the working one, both recorded in the `vitest.config.ts` comment so they are not retried. See deviation 4.
- **No database was touched.** No migration, no `db:migrate`, no `db:seed`, no `test:db` — safe beside the concurrently-executing 02-05 and 02-06.

## Known Stubs

None. Every export in this plan is wired to real data: the estimator reads the committed seed, the geocoder reads recorded payloads through msw, and both UI maps are complete constant tables. No placeholder values, no empty arrays flowing to a render path, no TODO/FIXME.

## Threat Flags

None. The plan's `<threat_model>` covers everything this plan introduces. No new network endpoint beyond the single hard-coded Census host, no new auth path, no new file access, no schema change. Register dispositions delivered:

| Threat ID | Disposition | Delivered by |
|---|---|---|
| T-2-13 (SSRF / injection) | mitigate | Constant host + path; zod length and control-character bound before the URL is built; address only ever a query-parameter value; zod-parsed response; `census: the address is only ever a query parameter` and `census: an over-long or empty address is refused before any request` |
| T-2-15 (credential disclosure) | mitigate | Keyless federal geocoder; `grep -rn 'googleapis\|GOOGLE' src/lib/geocode/` clean; `no google credential is read anywhere in src` re-run green |
| T-2-14 (compute oracle) | mitigate | Estimator is pure arithmetic over seeded tables, no paid call; auth and debounce land at the 02-09 / 02-11 boundaries |
| T-2-08 (estimate vs ledger divergence) | mitigate | Prices through the ledger's own `priceRequests` / `PRICE_BOOK` with the same free allowance; exact-value tests red on a constant change (mutations 1 and 2) |
| UI-SPEC Rule 5 (client directive on a data module) | mitigate | Neither `src/lib/ui/*` module carries it; `ui maps: no module under src/lib/ui carries a use client directive` greps two-sided |

## User Setup Required

None — no external service configuration. The Census Geocoder takes no API key, which is the entire point of D-02, and no test in this plan depends on a credential that does not exist.

## Next Phase Readiness

**Ready for 02-09 (server actions), 02-10 / 02-11 (screens), 02-12.**

- `estimatePreset(spec, ctx)` is the whole contract for 02-09: build `SeedTables` from `src/seed/data/*.json`, read `unitsUsedThisPeriod` / cap / spent / reserved from the ledger, call it. It cannot spend, reserve, or touch a row.
- `geocodeAddress(address)` returns a discriminated union with four named reasons; `src/lib/ui/copy.ts` already carries the matching sentence for `no_match` and `unreachable`.
- `tests/unit/msw/server.ts` generalises to Places and Firecrawl in Phase 4 — the shape is one handler plus `startCensusServer`'s `onUnhandledRequest: 'error'`.

**Carry forward:**

1. 🔴 **The assumptions drawer must state that a non-RGV county cell is a statewide average, not a measurement** (deviation 2). The Texas *total* is exact; a single Travis County figure is not measured.
2. 🔴 **Render the multiplier as `×{computed}`** — `×14.9` today. Never the UI-SPEC copy table's illustrative value (Executor Rule 16).
3. ⚠️ **02-10 / 02-11: import the copy constants, never retype a string.** `GEOCODE_NO_MATCH` uses UI-SPEC's typographic quotes (decision 7).
4. ⚠️ **`vitest.config.ts` merge hunk** — see deviation 4.
5. `FAN_OUT` and `RADIUS_REFERENCE_MILES` remain **unmeasured by design** and are due to be trued up against a real invoice at the Phase 6 gate.

---
## Self-Check: PASSED

- All 11 files listed under `key-files.created` exist on disk (`[ -f ]` each).
- All 5 commits resolve in `git log`: `9c017eb`, `33b5410`, `1748083`, `7d01256`, `0e09399`.
- `git status --short` clean; `.env.local` is covered by `.gitignore:4` (`.env.*`) and was never staged.
- `git diff --diff-filter=D --name-only 901bb7d..HEAD` empty — **no file deleted anywhere in this plan**.
- No write outside this worktree. `STATE.md` and `ROADMAP.md` untouched, per the parallel-execution contract.
- Re-ran every plan-level `<verification>` item after the final commit: 63/63 unit tests, typecheck clean, lint clean, all greps as tabulated above.
- One finding, fixed and committed before returning: deviation 7.

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*

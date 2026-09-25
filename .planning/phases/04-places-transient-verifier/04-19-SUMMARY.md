---
phase: 04-places-transient-verifier
plan: 19
subsystem: places-change-check-and-recorder
tags: [places, ids-only, change-detection, d-16, d-20, d-01, d-04, recorder, anonymizer, msw, place-04, place-02]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-03 diffTile / hostClass; 04-05 reducer SearchResult/PlannedSearch/FailReason; 04-09 _places-fixtures; 04-10 msw Places harness + sidecar; 04-12 buildFirstPage/buildNextPage/searchText/placesKeyConfigured; 04-15 app.record_change_check; 04-11 app.mark_run_search / app.plan_run_searches; 04-16 reservePage/settleOrRelease/settleInFlight"
provides:
  - "src/lib/places/check-tile.ts: runCheckTile, SweepInput, TileStepResult (structurally identical to 04-18's search-tile.ts types)"
  - "scripts/lib/anonymize-places.ts: anonymizePage, assertAnonymizedPage, AnonymizeContext"
  - "scripts/lib/record-guard.ts: MAX_RECORD_REQUESTS, parseRecordArgs, RecordArgs, assertLegalRecord, assertLocalTarget"
  - "scripts/lib/record-pages.ts: openRecordingRun, recordPages, firstRequest, closeRecordingRun, ledgerOfRun, closeMeterPool"
  - "scripts/record-places-fixtures.ts: the D-04 desk recorder (writeRecording, FIXTURES_DIR exported); package.json record:places"
  - "tests/unit/msw/places.ts: per-file anonymized load check"
affects: [04-22, 04-29, 04-31, 04-32]

tech-stack:
  added: []
  patterns:
    - "A part-way listing records nothing: the diff is written only after every page arrived"
    - "Anonymize in the loop AND on the write line: a fixpoint anonymizer makes the second pass free and a wall"
    - "Desk script guards before any src import: args → legal record → env → local target (both URLs) → dynamic import"
    - "The recorder's cap is also the run's ceiling_requests, so the meter refuses past it even if the loop regresses"

key-files:
  created:
    - src/lib/places/check-tile.ts
    - tests/db/places-check-tile.test.ts
    - scripts/lib/anonymize-places.ts
    - scripts/lib/record-guard.ts
    - scripts/lib/record-pages.ts
    - scripts/record-places-fixtures.ts
    - tests/unit/anonymize-places.test.ts
    - tests/db/places-recorder.test.ts
  modified:
    - package.json
    - tests/unit/msw/places.ts
    - tests/unit/msw/fixtures/README.md

key-decisions:
  - "A change check that fails or stops part-way records NO diff (a half listing would mark live members gone); the retry lists from page 1"
  - "The recorder finds its org from the --version row (search_versions.org_id → orgs.clerk_org_id), never 'the only org' (T-3-01)"
  - "assertLocalTarget is applied to BOTH the owner URL and the runtime pool the meter reserves through"
  - "assertLegalRecord accepts only 'D-01 Places legal gate — counsel-yes' or '— danlo-risk-call' inside Key Decisions; 'no' or an unreadable answer refuses"
  - "A recording's search is closed 'stopped', never 'done': it writes no membership and must not claim the tile was swept"
  - "--max-requests defaults to 3 (one search's pages); a billed recording requires --out; --ids-only is exactly one request"

requirements-completed: [PLACE-04, PLACE-02]

duration: ~40min
completed: 2026-09-23
---

# Phase 4 Plan 19: The IDs-only change check and the anonymizing recorder Summary

**The free change check now lists a leaf tile with the IDs-only mask through the product's own builder and meter. Every page is ledgered at $0 with units 1, and the diff is written by `app.record_change_check`: new ids are inserted, gone ids get `gone_at` and are never deleted. The D-04 recorder is built, guarded and proven against msw. It anonymizes real pages in memory before anything is written. It was not run: no Google call of any kind was made.**

## Performance

- **Duration:** about 40 min (21:00Z to 21:40Z)
- **Tasks:** 2, as 4 commits (TDD: test then feat for each)
- **Files:** 8 created, 3 modified

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 RED | `181a1c6` | test(04-19): add failing DB proofs for the IDs-only change check |
| 1 GREEN | `a68e3d5` | feat(04-19): runCheckTile - the free IDs-only change check |
| 2 RED | `d5a803c` | test(04-19): add failing unit tests for the anonymizer and the recorder guards |
| 2 GREEN | `bc5af76` | feat(04-19): the D-20 anonymizer, the recorder's guards and the D-04 desk recorder |

## Exported API

### `src/lib/places/check-tile.ts` (`server-only`; 04-22 wraps this)

```ts
export type SweepInput = { runId: string; clerkOrgId: string };
export type TileStepResult =
  | SearchResult
  | { kind: 'fail'; tileKey: string; reason: FailReason; retryable: boolean; retryAfterMs?: number };
export async function runCheckTile(
  input: SweepInput,
  search: PlannedSearch,
  deps: { mode: PlacesMode },
): Promise<TileStepResult>;
```

- `SearchResult`, `PlannedSearch` and `FailReason` come from `@/workflows/places-sweep/reducer`. `PlacesMode` comes from `@/lib/places/meter`.
- The two types are declared locally and are structurally identical to 04-18's `src/lib/places/search-tile.ts` exports. 04-22 may dedupe them. This worktree does not contain `search-tile.ts`.
- **Success returns** `{ kind: 'checked', tileKey, changed }`. `changed` is true for the verdicts `new`, `gone`, `both` and `saturated`, and false for `baseline` and `unchanged`.
- **Throws** `runCheckTile: <tileKey> is not an ids_only search` for any search whose kind is not ids-only. It throws before the meter or the network is touched.

**Order of operations:**
1. `settleInFlight`.
2. `buildFirstPage({ …, mode: 'ids_only' })`.
3. Per page, up to 3 pages: `reservePage` → `searchText` → `settleOrRelease`.
   - A served page is settled with `charged: true`, which writes a $0 row with units 1 and clears the cursor.
   - Errors follow 04-18's table exactly:
     - `daily_quota` → release → `stopped/google_daily_quota`
     - `rate_limited` → release → `fail places_unavailable`, retryable, with `retryAfterMs`
     - `unavailable` → release → `fail places_unavailable`, retryable
     - `rejected` → release → `fail places_request_rejected`
     - `no_key` → release → `fail places_key_missing`
     - `timeout` → charged → `fail places_unavailable`, retryable
     - `bad_shape` → charged → `fail places_unavailable`, not retryable
   - Reserve outcomes map the same way:
     - `stop` → `stopped/<reason>`
     - `not_running` → `fail places_unavailable`, not retryable
     - refused `places_key_missing` → `fail places_key_missing`
     - any other refusal → `fail places_request_rejected`
4. After every page has arrived, ONE `withWorkerOrg` transaction:
   - read the tile row (joined through the search) and its live members;
   - compute `hasBaseline = last_checked_at ∨ last_swept_run_id ∨ members > 0`;
   - run `diffTile`;
   - call `app.record_change_check(search, added, gone, verdict, ids.length)`;
   - call `app.mark_run_search(search, {status:'done', saturated: verdict==='saturated'})`.

### The recorder (04-31 and 04-32 run it; nothing here did)

**Invocation:**
```
pnpm record:places --version=<local search_versions uuid> --type=<Table A type> \
                   --unit=<city|county>:<unit id, DB-safe> [--quad=r0] [--max-requests=N] \
                   [--out=<basename>] [--ids-only]
# = node --conditions=react-server --import tsx scripts/record-places-fixtures.ts …

04-31: pnpm record:places --ids-only --max-requests=1 --version=<id> --type=plumber --unit=city:48215/McAllen
04-32: pnpm record:places --version=<id> --type=plumber --unit=city:48215/McAllen --max-requests=3 --out=mcallen-plumber
```

**Guards.** All of these run before any `src/` module loads or any connection opens.

1. **`parseRecordArgs`:**
   - Unknown or repeated flags are refused.
   - `--version` must be a uuid.
   - `--type` must be a Table A type.
   - `--unit` must be `city|county:<id>`.
   - `--quad` must match `^r[0-3]{0,5}$`.
   - `--out` must match `^[a-z0-9][a-z0-9-]{0,59}$`.
   - `--max-requests` must be 1..`MAX_RECORD_REQUESTS` (10). The default is 3.
   - `--ids-only` forces 1 request and refuses any other explicit value.
   - A billed recording (without `--ids-only`) requires `--out`.
2. **`assertLegalRecord(PROJECT.md)`:**
   - It reads only the `## Key Decisions` section.
   - A table row containing `D-01` and `Places` must read `D-01 Places legal gate — counsel-yes` or `— danlo-risk-call`. The separator may be an em dash, an en dash or a hyphen.
   - `— no` refuses, and so does anything it cannot read.
   - Today's PROJECT.md has no such row, so the recorder refuses.
3. **Local target:**
   - `.env.local` is loaded with `override: false`.
   - `assertLocalTarget('test', TEST_DATABASE_URL)` and `assertLocalTarget('test', SUPABASE_DB_POOL_URL || RUNTIME_DB_URL)` must both pass. The host must be localhost, 127.0.0.1 or ::1, and it must not be a Supabase host.
   - On this machine both URLs are local: the owner is `postgres` and the runtime user is `app_user`.

**Then it:**
- Dynamically imports `scripts/lib/record-pages.ts`.
- As the owner, using the version's org claim and actor `etl:record-places`, inserts a `running` run with `ceiling_requests = cap`. The run kind is `full_sweep`, or `change_check` for `--ids-only`.
- Plans the one search via `app.plan_run_searches`. The search is `enterprise`, or `ids_only` for `--ids-only`.
- Records up to 3 pages. Each page goes reserve → send → settle and is then anonymized in memory.
- Closes the run: `complete`, `partial` (for `budget_cap_reached`, `exceeded_estimate` or `daily_quota`), or `failed`. The search is marked `stopped`.
- Prints the outcome, HTTP status, request count, ids seen, pages, ledger rows, SKUs and cost.
- With `--out`, anonymizes each page again, checks it with `assertAnonymizedPage`, and writes `tests/unit/msw/fixtures/places-recorded-<out>-p<N>.json`. It never overwrites a file.
- Updates the sidecar:
  - top level: `anonymized: true` and `recordedFrom`;
  - each recorded file: `synthetic: false, anonymized: true, recordedAt, requests`, plus `truncatedByCap` on the last page when the cap stopped paging.
- Exits 1 on any outcome other than `ok`.

**For 04-31:** `--ids-only` prints `outcome ok · 1 request(s) · N id(s)`. It should leave exactly one local `cost_ledger` row: `sku ts_essentials, micro_usd 0, units 1`. This is proven against msw in `the recorder's ids-only mode ledgers one free call`. No fixture is written without `--out`.

## Verification

### Gates (final tree, HEAD `bc5af76` on `worktree-agent-aa05bb81ffcd132b8`, branch and sha printed after the DB gate)

- `npx tsc --noEmit`: exit 0.
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0.
- `prettier --check --end-of-line auto`: clean on all 11 touched files.
- `npx vitest run tests/unit`: **70 files, 527 tests passed.**
- Full DB lane (`npx vitest run --config vitest.db.config.ts --pool=forks --reporter=verbose`): **37 files, 327 tests passed** in 103 s, exit 0.
  - `places-check-tile` 12/12 and `places-recorder` 8/8 are in the pass list by name.
  - I saw no cross-plan noise on the shared DB.

**Task 1 names, read from verbose output, all passing.** The plan's seven:
- `a change check against a never-checked tile records a baseline`
- `a change check marks new and gone place ids`
- `an unchanged tile is not a paid-sweep candidate`
- `a change check flags a leaf that now returns 60 as saturated`
- `a change check never sends the Enterprise mask`
- `a change check ledgers every page at zero`
- `a change check stops at Google's daily quota`

Five more:
- `a change check that fails part-way records no diff`
- `a rejected change check fails without retry`
- `a change check timeout is settled as charged`
- `a change check refuses an enterprise search before any request`
- `a change check's result satisfies the reducer's contract`

**Task 2 unit names, all passing.** The plan's eight:
- `the anonymizer keeps structure and drops every Google string`
- `the anonymizer places every location inside the searched rectangle`
- `the anonymizer synthesizes ratings`
- `the anonymizer keeps a foreign listing foreign`
- `the recorder refuses without the D-01 record`
- `the recorder refuses any target but the local database`
- `the recorder caps its requests`
- `the recorder's ids-only mode is one free call`

Four more:
- `the anonymizer is a fixpoint, so the recorder can anonymize again as it writes`
- `the anonymizer's output passes the write-time check and a raw page does not`
- `the anonymizer refuses an id outside the place-id alphabet, without echoing it`
- `the recorder writes only anonymized pages and marks them in the sidecar` (writes to a temp directory, never the real fixtures)

**Task 2 DB names (`tests/db/places-recorder.test.ts`), all passing:**
- `the recorder opens a capped run in the version's own org`
- `the recorder reserves every page before it leaves and ledgers it`. An `onPlacesRequest` hook reads an OPEN reservation at request time for all 3 pages.
- `the recorder keeps only anonymized pages`
- `the recorder stops at its request cap`
- `the run ceiling refuses what the recorder cap would allow`
- `the recorder's ids-only mode ledgers one free call`
- `the recorder releases a refused page and names the reason`
- `the recorder closes its run without claiming the tile was swept`

### Acceptance greps

- `grep -n "mode: 'ids_only'" src/lib/places/check-tile.ts` matches at L87.
- `grep -n "'enterprise'" src/lib/places/check-tile.ts` finds nothing (exit 1).
- In the recorder, `grep -n "writeFileSync"` finds only L100 and L116. Both are inside `writeRecording`, after `anonymizePage(` at L98. Filesystem calls go through `fs.*`, so the import line does not match.
- `grep -n "console.log(raw\|JSON.stringify(raw"` finds nothing across the recorder and `scripts/lib`. `record-pages.ts` has no `console` at all.
- `grep -n '"record:places"' package.json` matches.

### Harness probe (manual, reverted)

- I wrote a made-up recording through `writeRecording` into the real fixtures directory. `places-msw` stayed at 8/8.
- I then changed one phone to a real-looking value. The module failed at load with `assertAnonymizedPage: places-recorded-harness-probe-p1.json place 2 nationalPhoneNumber is not synthetic (the value is not echoed)`.
- I restored the sidecar with `git checkout --`, deleted the probe file, and confirmed `git status` was clean.

### Desk invocation

- Under `node --conditions=react-server --import tsx -e …`, the module graph loads: `server-only` resolves to its no-op, and `@/` paths resolve. Both modules imported and listed their exports.
- `main()` did not run: `process.argv[1]` is undefined under `-e`.
- The recorder itself was **never executed**.

### Mutation checks

Each mutation was applied to the committed file and run on its test file. I read the red names, then restored with `git checkout --` and confirmed `git diff --stat` was clean.

| # | Mutation | Red (exact names) |
|---|---|---|
| M1 | `hasBaseline` ignores live members | `a change check marks new and gone place ids`, `an unchanged tile is not a paid-sweep candidate` |
| M2 | served page released, not charged | `a change check ledgers every page at zero`, `a change check that fails part-way records no diff` |
| M3 | daily quota settled as charged | `a change check stops at Google's daily quota` |
| M4 | `baseline` counted as changed | `a change check against a never-checked tile records a baseline` |
| M5 | a part-way listing is recorded (`break` out of the page loop on 503) | `a change check that fails part-way records no diff` |
| M6 | builder asked for the paid mask | 10/12 red, including `a change check never sends the Enterprise mask`. The meter's ids-only gate refuses the paid SKU, so no request leaves. The 400 test and the enterprise-refusal test stay green by construction. |
| A1 | display name kept verbatim | `…keeps structure and drops every Google string`, `…output passes the write-time check…`, `the recorder writes only anonymized pages…` |
| A2 | real pin kept | `…drops every Google string`, `…places every location inside the searched rectangle`, `…write-time check…`, `…writes only anonymized pages…` |
| A3 | rating kept | `…drops every Google string`, `the anonymizer synthesizes ratings`, `…write-time check…`, `…writes only anonymized pages…` |
| A4 | foreign address made domestic | `the anonymizer keeps a foreign listing foreign` |
| A5 | host class flattened to `other` | `the anonymizer keeps structure and drops every Google string` |
| G1 | a `— no` D-01 accepted | `the recorder refuses without the D-01 record` |
| G2 | any DB host accepted | `the recorder refuses any target but the local database` |
| G3 | no upper request cap | `the recorder caps its requests` |
| G4 | ids-only not forced to one call | `the recorder's ids-only mode is one free call` |
| W1 | the write line skips the second anonymize | `the recorder writes only anonymized pages and marks them in the sidecar` |
| R1 | the loop keeps the raw page | `the recorder keeps only anonymized pages` |
| R2 | the loop ignores its cap | `the recorder stops at its request cap` (the meter's ceiling refused, so the outcome became `exceeded_estimate`) |
| R3 | a served recording page is released | `…reserves every page before it leaves and ledgers it`, `…stops at its request cap`, `…ids-only mode ledgers one free call` |
| R4 | the recording closes its search `done` | `the recorder closes its run without claiming the tile was swept` |

## Deviations from Plan

### Auto-fixed / added

**1. [Rule 2 - Correctness] A change check that fails or stops part-way records no diff**
- **Issue:** The plan leaves open what happens to page 1's ids when page 2 fails. Diffing a half listing would stamp `gone_at` on every live member that sits on the missing pages.
- **Fix:** Every failure or stop returns before the diff transaction.
- **Proof:** `a change check that fails part-way records no diff`, killed by M5.
- **Commit:** `a68e3d5`

**2. [Rule 2 - Missing proof] The recorder's loop and DB legs were split into `scripts/lib/record-pages.ts` and proven in a new `tests/db/places-recorder.test.ts` (8 tests)**
- **Issue:** The plan tests only the anonymizer and the guards. The loop that spends real money, the run and search it opens, and the way it closes them would otherwise have no test until 04-32 runs them for real.
- **Fix:** I split out the loop so the DB lane can drive it against msw with the worker double. The recorder loads it by dynamic import after the guards.
- **Files:** two new files not listed in the plan's `files_modified`.
- **Commit:** `bc5af76`

**3. [Rule 2 - D-20] Per-file anonymized load check in the msw harness**
- **Issue:** The harness's `synthetic-` id rule applied to every file whenever the top-level sidecar said `synthetic: true`. The first real recording would therefore fail to load. Simply relaxing the rule would let a raw capture in.
- **Fix:**
  - `tests/unit/msw/places.ts` now checks each file. A file whose sidecar entry says `anonymized: true` (and `synthetic: false`) must pass `assertAnonymizedPage`. Every other file keeps the `synthetic-` id rule.
  - `assertAnonymizedPage` is exported from the anonymizer and is also the recorder's write-time check.
  - The fixtures README gained two short paragraphs, only in the Places load-check and re-recording text.
- **Proof:** the manual probe above.
- **Commit:** `bc5af76`

**4. [Rule 2 - D-04] `assertLocalTarget` checks both URLs**
- **Issue:** The meter reserves through `SUPABASE_DB_POOL_URL`, not the owner URL. `.env.local` also carries a remote `SUPABASE_DB_URL`. Checking only the owner URL could still let the meter reserve against a remote pool.
- **Fix:** Both URLs are checked.

**5. [Rule 2 - D-01] `assertLegalRecord` refuses `no` and unreadable answers**
- **Issue:** The plan's rule was "a row contains D-01 and Places". 04-29 writes `D-01 Places legal gate — <counsel-yes | danlo-risk-call | no>`, and its own verify step expects the guard to exit non-zero for `no`.
- **Fix:** The guard accepts only the two yes answers inside Key Decisions. A mention elsewhere in the file does not count.

**6. [Minor] Argument defaults**
- `--max-requests` defaults to **3**. The plan's `[--max-requests=6]` reads as an example, and one search is at most 3 pages.
- A billed recording without `--out` is refused, because it would spend and write nothing.
- The org comes from the `--version` row. `resolveEtlOrg` needs an explicit clerk org id and must never guess "the only org" (T-3-01). The version is an explicit, operator-given key that names exactly one org.

**7. [Minor] The recorder anonymizes twice**
- It anonymizes in the loop, and again on the line that writes the file. This is safe because the anonymizer is a fixpoint, which is tested.
- It satisfies the acceptance grep structurally: `writeFileSync` follows `anonymizePage(` in the same function. It is also a wall if the loop ever regresses (W1).

**8. [Process] Verify commands**
- Per the Windows notes, I ran `npx vitest run [--config vitest.db.config.ts --pool=forks] <file> --reporter=verbose` rather than `$PNPM test:* -t`, and read every name.
- Mutation helpers lived in the gitignored `coverage/` directory and were deleted before this SUMMARY.

**Total deviations:** 5 correctness or proof additions (Rule 2), 2 minor, 1 process. There were no architectural changes and no migration. The local DB journal is untouched at 30.

## Flags for downstream plans

- **04-32 (🔴 businessStatus):** `src/lib/places/response.ts` parses `businessStatus` as a strict 3-value enum (04-12).
  - A real page carrying `BUSINESS_STATUS_UNSPECIFIED`, or any other new value, fails the whole page as `bad_shape`. It is charged and nothing is recorded.
  - The recorder prints a pointer to this if it happens.
  - The fix belongs in the schema, for example `.catch(undefined)` or a wider enum. Decide before or at 04-32.
- **04-32 (cap truncation):** if the cap stops paging while Google offers a next page, the last written page still carries `recorded:p<N+1>`, but no p<N+1> file exists.
  - The sidecar marks it `truncatedByCap: true`, and the script prints a warning.
  - A replay would get msw's 501 on that page. Record the full ≤3 pages, or account for it in the replay test.
- **04-32 (formatting):** fixture files are written with `JSON.stringify(…, null, 2)`. Run prettier on them before committing if the repo's check covers JSON.
- **04-32 (inspection):** the plan's structural inspection list matches `assertAnonymizedPage` one for one. The harness and the recorder both enforce it, so a file that fails is refused at write time and again at load.
- **04-22:**
  - `runCheckTile` does not call `settleInFlight` on the retry path beyond its own step 0; it relies on step 0.
  - `record_change_check` writes `pages_done = greatest(pages_done, 1)` even for a 3-page listing. That is 04-15 behaviour. Correct it there if the report needs true page counts for change checks.
- **04-03 handoff:** unchanged. A never-checked tile that returns 60 is still `saturated` (it outranks `baseline`), and none of this plan's tests need otherwise.

## Merge notes

- **`tests/unit/msw/fixtures/README.md`:** 04-18 also edited this file (the spine table's near-miss row and `places-match-page.json`). My two edits are in the load-check paragraph just above "### The spine contract" and in "### Re-recording (Places)". The hunks do not overlap the spine table. Keep both.
- **`tests/unit/msw/places.ts`:** I changed the `SIDECAR_FILES` type, added one import, and replaced the per-file synthetic-id block. 04-18 does not touch this file.
- **`package.json`:** one script line, `record:places`, after `purge:places`. No dependency changed and the lockfile is untouched.
- **Search tile:** this worktree does not contain `src/lib/places/search-tile.ts`. `check-tile.ts` declares `SweepInput` and `TileStepResult` locally with 04-18's exact shape.
- **Not touched:** STATE.md, ROADMAP.md, migrations, and production. Nothing was pushed. **No Google request of any kind was made.** No Places key exists on this machine, and none was looked for.

## Known Stubs

None. `runCheckTile` has no production caller yet by design; 04-22's `checkTile` step is its first. The recorder is complete and deliberately unrun until 04-31 and 04-32.

## Threat Flags

None beyond the plan's threat model:
- **T-4-05** (anonymization, raw payload never written or logged): mitigated. A1–A5, W1, R1 and the harness probe cover it.
- **T-4-04** (coordinates re-drawn inside the rectangle): mitigated. A2 covers it.
- **T-4-02** for the recorder (reserved and ledgered, 10-request cap, local only, D-01): mitigated. G1–G4, R2 and R3 cover it, along with the ceiling test.
- **T-4-02** for the change check (IDs-only mask by construction, $0 ledger): mitigated. M2, M6 and the mask test cover it.

## TDD Gate Compliance

- **Task 1:** RED `181a1c6` failed with `Cannot find package '@/lib/places/check-tile'` (the module did not exist). GREEN `a68e3d5` passed 12/12.
- **Task 2:** RED `d5a803c` failed with `Cannot find module '../../scripts/lib/anonymize-places'`. I had written the implementation first, so I moved it aside for the RED run. GREEN `bc5af76` passed 12 unit and 8 DB tests.
- No refactor commit was needed.

## Self-Check: PASSED

- FOUND: src/lib/places/check-tile.ts, tests/db/places-check-tile.test.ts, scripts/lib/anonymize-places.ts, scripts/lib/record-guard.ts, scripts/lib/record-pages.ts, scripts/record-places-fixtures.ts, tests/unit/anonymize-places.test.ts, tests/db/places-recorder.test.ts
- FOUND commits: 181a1c6, a68e3d5, d5a803c, bc5af76

---
phase: 02-budget-governor-search-presets
plan: 09
subsystem: api
tags: [server-actions, clerk, rls, budget-meter, versioning, zod, guard-test]

requires:
  - phase: 02-03
    provides: searches / search_versions / runs, the circular FK, the append-only grant, unique (search_id, version)
  - phase: 02-05
    provides: app.ensure_budget_period, app.reserve_budget, app.set_budget_cap, app.current_org_role
  - phase: 02-06
    provides: the DB-level proofs for versioning, and the geo_payload shapes a version round-trips
  - phase: 02-07
    provides: estimatePreset, geocodeAddress, src/lib/ui/copy.ts, the committed seed
provides:
  - "Six server actions, each 'use server', each authenticating at its own front door, each returning a typed discriminated result"
  - "src/server/actions/_result.ts - the ActionResult union every screen switches on"
  - "src/server/actions/_pg.ts - SQLSTATE and constraint-name matching through drizzle's error wrapper"
  - "src/server/queries/budget.ts - getCurrentPeriod / getUnitsUsedThisPeriod / getSpendByProvider / getSpendByRun, with a tx-accepting half of each"
  - "src/server/queries/presets.ts - the wire spec schema, the reference index, the ids<->keys translation, listPresets / getPreset"
  - "tests/unit/server-actions-guard.test.ts - four named static guards over src/server/actions/"
affects: [02-10, 02-11, 02-12, 02-13, phase-04-places-verifier]

tech-stack:
  added: []
  patterns:
    - "Every query module ships a read*(tx, ...) half and a get*(claims, ...) half: withOrg nested inside withOrg deadlocks on the max:1 pool"
    - "Every expected refusal is a typed result; only a bug throws"
    - "One refused statement per transaction: a 23505 or a 23514 aborts it, so the number the error message quotes is read in a SECOND withOrg"
    - "Money crosses jsonb as a decimal string (JSON.stringify throws on a BigInt) and crosses the action boundary as a bigint (React Flight serializes one as $n)"

key-files:
  created:
    - src/server/actions/_result.ts
    - src/server/actions/_pg.ts
    - src/server/actions/estimate-preset.ts
    - src/server/actions/geocode-address.ts
    - src/server/actions/save-preset-version.ts
    - src/server/actions/duplicate-preset.ts
    - src/server/actions/queue-run.ts
    - src/server/actions/set-budget-cap.ts
    - src/server/queries/budget.ts
    - src/server/queries/presets.ts
    - tests/unit/server-actions-guard.test.ts
  modified:
    - src/lib/ui/copy.ts

key-decisions:
  - "getSeedTables() reads the COMMITTED JSON, not the database copy - a second source for one number is exactly what T-2-08 forbids, and SeedTables is typed as the file shapes including a provenance no column holds"
  - "A zero estimate still takes a one-microdollar reservation: reserve_budget raises 22023 on a zero, and cost_ledger.reservation_id is NOT NULL, so a free-tier call could otherwise never be settled"
  - "search_versions.geo_payload keeps the id-bearing shape 02-06 proved; the estimator's keys-and-names spec is produced by one translation through withOrg"
  - "SQLSTATE matching lives in _pg.ts because drizzle wraps every failure in DrizzleQueryError and the code is on .cause"
  - "duplicatePreset computes 'Copy of {name}' from the SOURCE row, so the dialog cannot own that string"
  - "The estimate snapshot is deliberately NOT copied by duplicate: a snapshot is what somebody was quoted against that month's allowance"

patterns-established:
  - "A guard test may spell every token it hunts for; the modules it guards may not"
  - "Two-sided walkers: assert the file count before looping, so a wrong glob cannot pass by scanning nothing"
  - "A control-character bound is a code-point comparison, never a hand-typed character class"

requirements-completed: [SRCH-01, SRCH-03, SRCH-04, BUDG-02]

duration: 46min
completed: 2026-09-22
---

# Phase 02 Plan 09: Server Actions and the Read Modules the Screens Call Summary

**Six server actions, each authenticating at its own front door before it touches anything, each returning a typed refusal instead of a 500 — including a `queueRun` that takes a real budget reservation, so the refusal at 100 % of the cap is reachable from a button and not only from a test.**

## Performance

- **Duration:** 46 min
- **Started:** 2026-09-22T14:38:00Z (approx — worktree reset and dependency install)
- **Completed:** 2026-09-22T15:24:00Z
- **Tasks:** 3 of 3
- **Files created/modified:** 12 (11 created, 1 modified)

## Accomplishments

- **T-2-01 is closed and it stays closed.** `requireOrg()` is the first statement of all six actions, and `tests/unit/server-actions-guard.test.ts` fails if a future action omits it *or* calls `withOrg` before it. Both halves were watched red first, against a deleted check and against a reordered one.
- **BUDG-02 is reachable from the UI.** `queueRun` inserts a `runs` row in status `queued` and calls `app.reserve_budget`. A denial is a NULL `reservation_id` — zero rows, no exception — and the run is kept with `stopped_reason = 'budget_cap_reached'`, because "we refused to start this" is spend history too.
- **SRCH-03's save conflict is detected by the unique constraint, never by a read.** The edit inserts at `loadedVersion + 1` and lets `search_versions_search_version_uniq` decide; the version number the message quotes is then read in a **second** transaction, because the `23505` aborted the first.
- **SRCH-04 spends nothing.** The estimate is pure arithmetic over the committed seed plus one read of the live budget row. `grep -rc "googleapis\|GOOGLE" src/server/` finds nothing.
- **Two failure modes were caught that no gate in this plan could have seen**, both described under Deviations: a zero-cost reservation that `app.reserve_budget` would have refused with `22023`, and an estimate snapshot whose bigint makes `JSON.stringify` throw at the moment of saving a preset.

## Task Commits

1. **Task 1: The result contract, the read modules, and the two read-only actions** — `f9d7dc6` (feat)
2. **Task 2: The write actions — save a version, duplicate a preset** — `c54157a` (feat)
3. **Task 3: The budget-touching actions, and the static guard** — `572b0aa` (feat)

## Files Created/Modified

| File | What it does |
|---|---|
| `src/server/actions/_result.ts` | `ActionResult<T>`, the eight-member `ActionErrorCode` union, `ok` / `fail` / `isOk`. Underscore-prefixed because a module with the server directive may export nothing but async functions |
| `src/server/actions/_pg.ts` | `pgFailure` walks the `cause` chain for a SQLSTATE; `isUniqueViolationOn`, `isCheckViolationOn`, `isInsufficientPrivilege` |
| `src/server/actions/estimate-preset.ts` | `estimatePreset(input) -> ActionResult<EstimateRange>` |
| `src/server/actions/geocode-address.ts` | `geocodeAddress(address) -> ActionResult<GeocodeHit>` |
| `src/server/actions/save-preset-version.ts` | `savePresetVersion(input) -> ActionResult<{ searchId, version }>` |
| `src/server/actions/duplicate-preset.ts` | `duplicatePreset(input) -> ActionResult<{ searchId, version }>` |
| `src/server/actions/queue-run.ts` | `queueRun(input) -> ActionResult<{ runId, reservationId, pctAfter, at80, notice }>` |
| `src/server/actions/set-budget-cap.ts` | `setBudgetCap(input) -> ActionResult<{ capMicroUsd: string }>` |
| `src/server/queries/budget.ts` | `Tx`, `rowsOf`, `pctUsedOf`, `periodWindow`, and the four D-14 reads in `read*`/`get*` pairs |
| `src/server/queries/presets.ts` | `presetSpecSchema`, `RADIUS_MILE_OPTIONS`, `GeocodeHit`, the estimate-snapshot converters, `readReferenceIndex`, `resolveSpec`, `specInputOfVersion`, `listPresets`, `getPreset`, `readCurrentVersionNumber` |
| `tests/unit/server-actions-guard.test.ts` | Four named static guards over `src/server/actions/` |
| `src/lib/ui/copy.ts` *(modified)* | The UI-SPEC § Error sentences a typed refusal carries, plus `COPY_OF` |

## The exported surface, for waves 4 and 5

**Actions** (all `'use server'`; every one takes `unknown` and zod-parses it, except `geocodeAddress`):

```ts
estimatePreset(input: unknown): Promise<ActionResult<EstimateRange>>
geocodeAddress(address: string): Promise<ActionResult<GeocodeHit>>
savePresetVersion(input: unknown): Promise<ActionResult<{ searchId: string; version: number }>>
  // input: { searchId?: uuid; displayName: string; spec: PresetSpecInput;
  //          loadedVersion?: number; estimateSnapshot?: EstimateRange }
duplicatePreset(input: unknown): Promise<ActionResult<{ searchId: string; version: number }>>
  // input: { fromVersionId: uuid; displayName?: string }   // absent = "Copy of {source name}"
queueRun(input: unknown): Promise<ActionResult<{
  runId: string; reservationId: string; pctAfter: number; at80: boolean; notice: string }>>
  // input: { searchVersionId: uuid }
setBudgetCap(input: unknown): Promise<ActionResult<{ capMicroUsd: string }>>
  // input: { provider: 'places'|'firecrawl'|'anthropic'; capUsd: string }
```

**Queries** (no server directive — an RSC page awaits these directly):

```ts
// src/server/queries/budget.ts
type Tx
rowsOf<T>(result: unknown): T[]
pctUsedOf(cap: bigint, spent: bigint, reserved: bigint): number
periodWindow(periodStartIso: string): { from: Date; to: Date }
readCurrentPeriod(tx, provider?, now?) / getCurrentPeriod(claims, provider?): Promise<BudgetPeriodRow>
readUnitsUsedThisPeriod(tx, sku, periodId) / getUnitsUsedThisPeriod(claims, sku, periodId): Promise<number>
readSpendByProvider(tx, periodId) / getSpendByProvider(claims, periodId): Promise<ProviderSpend[]>
readSpendByRun(tx, periodStartIso) / getSpendByRun(claims, periodId): Promise<RunSpend[]>

type BudgetPeriodRow = { id; periodStart: string; capMicroUsd: bigint; reservedMicroUsd: bigint;
                         spentMicroUsd: bigint; warned80At: Date | null; pctUsed: number }
type ProviderSpend  = { provider: Provider; microUsd: bigint; calls: number }
type RunSpend       = { runId; presetDisplayName; version; startedAt; finishedAt;
                        calls; microUsd: bigint; status; stoppedReason }

// src/server/queries/presets.ts
RADIUS_MILE_OPTIONS = [5, 10, 25, 50] as const
presetSpecSchema / type PresetSpecInput / type GeoInput / type GeoPayload / type GeocodeHit
estimateRangeSchema, toStoredEstimate, fromStoredEstimate
getSeedTables(): SeedTables
readReferenceIndex(tx) / getReferenceIndex(claims): Promise<ReferenceIndex>
geoPayloadOf(geo), resolveSpec(input, index, name), specInputOfVersion(clusterIds, kind, payload, index)
readPresets(tx) / listPresets(claims): Promise<PresetSummary[]>
readPreset(tx, id, index) / getPreset(claims, id): Promise<PresetDetail | null>
readCurrentVersionNumber(tx, searchId): Promise<number | null>
```

**The wire spec a picker sends** — this is the shape 02-11's editor must produce:

```ts
{ clusterKeys: ClusterKey[]                       // 1..4 of the seeded four
  geo: { kind: 'cities';   cityIds: uuid[] }      // 1..300
     | { kind: 'counties'; countyIds: uuid[] }    // 1..254
     | { kind: 'radius'; lat: number; lng: number; countyFips: '\d{5}';
         radiusMiles: 5|10|25|50; matchedAddress: string; countyName?: string } }
```

## Verification Results

Every command below was run through the store launcher in this worktree, after the final commit.

### `pnpm test:unit` — 17 files, **67 passed, 0 failed**

The four new tests, by name:

```
tests/unit/server-actions-guard.test.ts > server actions
  ✓ every server action declares use server
  ✓ every server action calls requireOrg
  ✓ every server action exports only async functions
  ✓ no server action reads a Google credential
```

`pnpm test:unit -t "every server action" --reporter=verbose`:

```
 ✓ |node| tests/unit/server-actions-guard.test.ts > server actions > every server action declares use server 8ms
 ✓ |node| tests/unit/server-actions-guard.test.ts > server actions > every server action calls requireOrg 3ms
 ✓ |node| tests/unit/server-actions-guard.test.ts > server actions > every server action exports only async functions 4ms
 ↓ |node| tests/unit/server-actions-guard.test.ts > server actions > no server action reads a Google credential
      Tests  3 passed | 64 skipped (67)
```

### The watched-red-first mutations

**Mutation 1 — the `requireOrg()` line deleted from `src/server/actions/estimate-preset.ts`.** Verbatim:

```
 FAIL  |node| tests/unit/server-actions-guard.test.ts > server actions > every server action calls requireOrg
AssertionError: these actions never authenticate (T-2-01): expected [ 'estimate-preset.ts' ] to deeply equal []

- []
+ [
+   "estimate-preset.ts",
+ ]
 ❯ tests/unit/server-actions-guard.test.ts:104:66

 Test Files  1 failed | 16 skipped (17)
      Tests  1 failed | 2 passed | 64 skipped (67)
```

Reverted with `git checkout --`; `git diff --stat` empty; `grep -n "await requireOrg" src/server/actions/estimate-preset.ts` → `40:  const { userId, orgId } = await requireOrg();`.

**Mutation 2 — a `withOrg(` call moved above `requireOrg(` in the same file.** The *other* assertion reds, alone:

```
 FAIL  |node| tests/unit/server-actions-guard.test.ts > server actions > every server action calls requireOrg
AssertionError: these actions query before they authenticate (T-2-01): expected [ 'estimate-preset.ts' ] to deeply equal []

- []
+ [
+   "estimate-preset.ts",
+ ]
 ❯ tests/unit/server-actions-guard.test.ts:105:81

 Test Files  1 failed | 16 skipped (17)
      Tests  1 failed | 2 passed | 64 skipped (67)
```

Reverted; `git diff --stat` empty.

**Mutation 3 (not in the plan — see deviation 4) — `export const QUEUE_RUN_PROBE = 1;` appended to `queue-run.ts`:**

```
 FAIL  |node| tests/unit/server-actions-guard.test.ts > server actions > every server action exports only async functions
AssertionError: Next refuses a non-async export from a server module: expected [ Array(1) ] to deeply equal []

+ [
+   "queue-run.ts: export const QUEUE_RUN_PROBE = 1;",
+ ]
```

Reverted by hand (the file was still untracked at that point); `grep -c QUEUE_RUN_PROBE` → 0, full suite back to 67/67.

### `pnpm typecheck` / `pnpm lint` / `pnpm build` — all exit 0

```
$ tsc --noEmit
$ eslint .
```

`pnpm build` route listing, unchanged and intact:

```
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /api/health
├ ƒ /no-access
└ ƒ /sign-in/[[...sign-in]]

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

🔴 **Read that listing honestly.** Every route is still server-rendered and the Proxy entry is intact — but **no route imports an action yet**, because the screens are plans 02-10 and 02-11. So `next build` compiled none of the eight modules in `src/server/actions/`, and the "only async exports" rule it enforces was never applied to them. That is the entire reason for the third guard test; see deviation 4.

### The plan's acceptance greps

| Check | Result |
|---|---|
| `head -1` of each of the six actions | `'use server';` ×6 |
| `grep -c "requireOrg" src/server/actions/estimate-preset.ts` | `2` |
| `grep -c "withOrg" src/server/actions/estimate-preset.ts` | `2` |
| `grep -rc "googleapis\|GOOGLE" src/server/ \| grep -v ':0' \| wc -l` | `0` |
| `budget.ts` contains `ensure_budget_period` / `coalesce(sum(units), 0)` | `3` / `2` |
| `budget.ts` values list names all three providers | `values ('places', 1), ('firecrawl', 2), ('anthropic', 3)` — 1 match |
| `presets.ts` computes `usedByRuns` with `count(*)` | `(select count(*)::int from runs r where r.search_version_id = v.id)` |
| `presets.ts` stored-counter column reference | none |
| `save-preset-version.ts` contains `search_versions_search_version_uniq` | `2` |
| `save-preset-version.ts` uses `loadedVersion` as `+ 1`, not compared | `107: let version = (loadedVersion ?? 0) + 1;` |
| `grep -cE "select .*version.* from search_versions.*(compare\|===)"` | `0` |
| `save-preset-version.ts` contains both `name_internal` and `display_name` | `2` / `3` |
| `duplicate-preset.ts` carries the `Copy of` constant | `COPY_OF` ×2 (imported from `src/lib/ui/copy.ts`) |
| `grep -c "form action" src/server/actions/*.ts` | `0` on all eight files |
| `queue-run.ts`: `app.reserve_budget` / `'queued'` / `'refused'` / `budget_cap_reached` | `4` / `2` / `3` / `1` |
| `queue-run.ts` denial path is a null check, not a catch | `158: if (meter.reservation_id === null) {` |
| `set-budget-cap.ts`: `org:admin` / `app.set_budget_cap` / `bp_not_over` / `parseUsdToMicro` | `2` / `3` / `2` / `2` |
| `grep -c "parseFloat\|Number(" src/server/actions/set-budget-cap.ts` | `0` |
| `'42501'` and `'23514'` and `'23505'` | in `src/server/actions/_pg.ts`, 1 each — see deviation 3 |

## Decisions Made

1. **`getSeedTables()` reads the committed JSON, not the database.** See deviation 1.
2. **A zero-cost run still takes a one-microdollar reservation.** See deviation 2.
3. **SQLSTATE matching is factored into `_pg.ts`.** See deviation 3.
4. **A fourth guard test asserts the export shape**, because `next build` cannot see these files yet. See deviation 4.
5. **`search_versions.geo_payload` keeps the id-bearing shape** `{ cityIds }` / `{ countyIds }` / the geocoded centre, exactly as `tests/db/versioned-presets.test.ts` (02-06) round-trips it. The estimator's keys-and-names vocabulary is produced by `resolveSpec` on the way in and `specInputOfVersion` on the way out, both through `withOrg`, so a foreign id simply does not resolve.
6. **`duplicatePreset` does not copy `estimate_snapshot`.** A snapshot records what somebody was quoted at a moment, against that month's free allowance and that month's remaining budget. Re-presenting it under a new preset's version 1 would be a quote nobody made; the editor recomputes on open (D-08).
7. **`duplicatePreset`'s default name is computed on the server** from the source row, so `Copy of {name}` cannot drift between the dialog and any other surface that duplicates.
8. **`queueRun` re-estimates from the version's spec, never from its snapshot.** The reservation must reflect this month's allowance, not last month's.
9. **`setBudgetCap` returns `capMicroUsd` as a decimal string**, exactly as the plan's signature specifies. Everything else in this plan returns `bigint`; the caller does `formatUsd(BigInt(capMicroUsd))`.
10. **`GEOCODE_NOT_TEXAS` quotes the address the user typed.** Not a choice so much as a consequence: `src/lib/geocode/census.ts` returns a bare reason on failure and keeps nothing else, deliberately, so a rejected out-of-state match's details are never ours to hold.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `getSeedTables(claims)` reading the reference tables through `withOrg` would have created a second source of truth for the price model, and could not have satisfied its own type**

- **Found during:** Task 1
- **Issue:** The plan specifies `getSeedTables(claims)` "read through `withOrg` so RLS applies". Two problems, either one fatal. (a) `SeedTables` (02-07, `src/lib/estimate/expand-cells.ts`) is typed as the **file** shapes, and `CitiesFile` requires `CityProvenance` — a measurement rule, a threshold, two coverage percentages, the next candidate cities. None of it has a column in `cities`. Satisfying the type from the database would mean fabricating a provenance on the one screen whose job is telling danlo where a number came from. (b) `scripts/seed.ts` loads these very JSON files into the reference tables, so the database holds a **copy**. Pricing from the copy means that on any machine where `pnpm db:seed` lagged a `scripts/refresh-outlet-counts.ts` run, the product quotes a dollar figure that `tests/unit/estimate.test.ts` — which asserts exact values against the files — says is impossible. That is the estimate-versus-ledger divergence T-2-08 exists to prevent, and no gate in this repo would see it.
- **Fix:** `getSeedTables()` returns the committed JSON, parsed once at module scope (strictly better than the per-request cache the plan asked for, on a path that recomputes per keystroke). Everything that is genuinely tenant-scoped still goes through `withOrg`: `readReferenceIndex(tx)` reads `industry_clusters`, `cities` and `counties` for the id↔key translation a version row needs, and `estimate-preset.ts` still contains two `withOrg` references as the acceptance criterion requires. The built-ins are `org_id IS NULL` rows every tenant reads identically (D-05), so RLS was never confining anything here.
- **Files modified:** `src/server/queries/presets.ts`
- **Verification:** `pnpm test:unit` 67/67 including the ten exact-value cost-model tests, which now describe the runtime path as well as the library path.
- **Committed in:** `f9d7dc6`
- **🔴 Carry forward:** a `tests/db` assertion that the seeded reference rows still equal the committed JSON would close this loop from the other side. It belongs in `tests/db/reference-rows.test.ts` and could not be added here — the sibling 02-08 was running 40-connection bursts against the shared local database for the whole of this plan.

**2. [Rule 2 — Missing critical] A run priced at $0.00 inside the free allowance would have been refused by the meter with `22023`**

- **Found during:** Task 3
- **Issue:** The plan says to "take `costMicroUsdHi` as the reservation amount". Early in a calendar month that figure is **exactly 0** — the first 1,000 Text Search Enterprise requests are free, which is the entire point of 02-07's free-allowance work, and the RGV baseline's 612 requests sit inside it. `app.reserve_budget` raises `22023 reserve_budget: non-positive estimate` on a zero, correctly: a caller that could reserve nothing could hold the meter open for free (T-2-07). So the most common run in the product's first month would have thrown, and `queueRun` would have returned `unexpected` with UI-SPEC's "something broke on our side" for a run that was perfectly fine.
- **Fix:** `const holdMicroUsd = estimateHi > 0 ? BigInt(estimateHi) : 1n;` — one micro-dollar, a ten-thousandth of a cent. Not a fudge: a free-tier call is still a paid-SKU call that **must** produce a ledger row (`micro_usd = 0`, `units` set) or the allowance stops being derivable and every early-month estimate is wrong; and `cost_ledger.reservation_id` is `NOT NULL` with an FK (T-2-03), so that row cannot exist without a reservation to settle against. The token hold is what keeps a free run inside the meter rather than outside it. Reasoned at the point of definition in a twelve-line comment.
- **Files modified:** `src/server/actions/queue-run.ts`
- **Verification:** static — Phase 2 has no `test:db` for this path and the sibling plan owned the database. 🔴 **Owed:** a `tests/db` case asserting that a zero-cost reserve succeeds and produces a reservation, and that the run is still refused at a spent-out cap. Flagged for 02-12 / 02-15.
- **Committed in:** `572b0aa`

**3. [Rule 3 — Blocking] Matching `err.code` would have matched nothing, silently, because drizzle wraps every failure**

- **Found during:** Task 2
- **Issue:** The plan's acceptance criteria expect `'23505'`, `'42501'` and `'23514'` in the action files. Written literally — `if (err.code === '23505')` — none of them would ever be true. drizzle's pg-core session wraps every failure in a `DrizzleQueryError` whose `cause` carries the postgres.js error `[VERIFIED: drizzle-orm@0.45.2 errors.d.ts declares `cause?: Error`; postgres.js 3.4.9 `src/connection.js` maps error field 110 to `constraint_name`]`. The result would have been that **every expected refusal in the phase becomes a 500 with no copy** — the save conflict, the non-admin cap change, the cap below spend — and every one of them would have looked like it worked in a manual smoke test, because the happy path is unaffected.
- **Fix:** `src/server/actions/_pg.ts` walks the `cause` chain (bounded at eight links) for the first error carrying a five-character SQLSTATE, and exposes `isUniqueViolationOn(err, constraint)`, `isCheckViolationOn(err, constraint)` and `isInsufficientPrivilege(err)`. The constraint name is part of the match, not decoration: `23505` means "some unique constraint", and reporting a duplicate built-in or a replayed request id as "this preset changed while you were editing" would send a user to reload a page that was never stale.
- **Files modified:** `src/server/actions/_pg.ts` (new), `save-preset-version.ts`, `set-budget-cap.ts`
- **Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; the SQLSTATE literals are greppable at `grep -c "'23505'\|'42501'\|'23514'" src/server/actions/_pg.ts` → 3, and the constraint names at their call sites.
- **Committed in:** `c54157a`
- **⚠️ Criteria note:** the plan's greps name `save-preset-version.ts` and `set-budget-cap.ts` as the files that should contain the SQLSTATE literals. They contain the **constraint names** and the predicate calls; the literals are one import away. Factoring them out was not a preference — `set-budget-cap.ts` needs the same unwrapping, and two copies of a `cause`-walk is two places to get the depth bound wrong.

**4. [Rule 2 — Missing critical] `next build` cannot see any of these modules, so the rule it enforces was never applied**

- **Found during:** Task 3
- **Issue:** The plan leans on `pnpm build` to "resolve the server/client boundary". It does — for code reachable from `src/app/`. **Nothing under `src/app/` imports a server action yet**; the screens are plans 02-10 and 02-11. So the eight modules in `src/server/actions/` were not compiled by `next build` at all, and Next's rule that a module with the server directive may export **only async functions** was never applied to them. A non-async export would have sailed through every gate in this plan and broken the first page to import it — in somebody else's wave, in somebody else's plan.
- **Fix:** a fourth named test, `every server action exports only async functions`, scanning each action file for an exported binding that is not `export async function` and not a type. Mutation-checked (mutation 3 above) rather than assumed: a guard nothing can kill is dead code, and the test over it is theatre.
- **Files modified:** `tests/unit/server-actions-guard.test.ts`
- **Verification:** red naming the offending file and line, reverted, 67/67 green.
- **Committed in:** `572b0aa`

**5. [Rule 1 — Bug] The estimate snapshot cannot be written to `jsonb`: `JSON.stringify` throws on a BigInt**

- **Found during:** Task 2
- **Issue:** `EstimateRange.remainingMicroUsd` is a `bigint`. `JSON.stringify` on one throws `TypeError: Do not know how to serialize a BigInt` — the same failure drizzle-kit hit on `runs.cost_micro_usd` in wave 1, where it emitted no migration at all while typecheck stayed green. Saving a preset with its estimate attached — the normal path, since the editor computes one before you press save — would have thrown on the single write this phase actually performs.
- **Fix:** a stored shape that carries the µUSD figure as a **decimal string** (lossless — a string holds every digit) and `freeRemaining` as `number | null` (`JSON.stringify(Infinity)` is `null` anyway, and a round trip that turned "unlimited" into "none left" would quote a cost for a free call). `toStoredEstimate` / `fromStoredEstimate` are the only two places that know, and an unreadable snapshot reads back as `null` rather than failing a page, because a snapshot is a convenience and never a correctness input.
- **Files modified:** `src/server/queries/presets.ts`, `src/server/actions/save-preset-version.ts`
- **Verification:** `pnpm typecheck` / `pnpm build` clean. Separately confirmed that the **action** boundary is not affected: React Flight serializes a BigInt as `"$n" + value.toString(10)` `[VERIFIED: read out of `react-server-dom-turbopack-server.node.production.js` in `node_modules`]`, so `estimatePreset` may keep returning a real `bigint` to the client. The boundary that cannot take one is JSON, not the action.
- **Committed in:** `c54157a`

**6. [Rule 1 — Bug] Two of my own files were written with raw control bytes and git classified one as binary**

- **Found during:** Task 1
- **Issue:** The address guard in `geocode-address.ts` was written as a regex character class spelling U+0000–U+001F **literally**. `grep | cat -A` answered `Binary file src/server/actions/geocode-address.ts matches`. This is deviation 7 of plan 02-07 recurring in a file written *by an agent that had just read that deviation* — a binary-classified source file produces no `git diff`, cannot be three-way merged, and is invisible to review, while every gate stays green because the character is correct and only the encoding is not.
- **Fix:** replaced the character class with a **code-point comparison** — `isControl(ch)` testing `codePointAt(0) < 0x20 || (>= 0x7f && <= 0x9f)`. A numeric bound cannot regress this way; a hand-typed character class can, and did, twice in one afternoon. The reasoning is recorded at the point of definition so the next author does not "simplify" it back into a regex.
- **Files modified:** `src/server/actions/geocode-address.ts`
- **Verification:** a byte scan over all eleven new files reports zero control bytes (CR excluded — `core.autocrlf` is `true` on this machine and the working tree is CRLF while the blobs are LF); `git grep -c "use server" HEAD -- src/server/actions/` returns a count for all six action files, which git only does for a file it reads as text.
- **Committed in:** `f9d7dc6`

**7. [Rule 3 — Blocking] A `withOrg` opened inside a `withOrg` would have hung the request, not failed it**

- **Found during:** Task 1
- **Issue:** The plan's query signatures all take `claims`, and `estimate-preset.ts` needs three of them (`readCurrentPeriod`, `readUnitsUsedThisPeriod`, the reference index) inside **one** transaction so the estimate is computed against a single consistent view of the meter. `src/db/client.ts` pools with `max: 1`. A second `withOrg` opened inside the first waits for a connection the outer transaction is holding — the request does not error, it **hangs** until the pool timeout, which reads on screen as a spinner that never resolves and in a log as nothing at all.
- **Fix:** every query ships two halves — `read*(tx, ...)` and `get*(claims, ...)` — with the second being a one-line `withOrg` around the first. Actions that need several reads in one transaction call the `read*` halves; an RSC page that needs one calls the `get*` half. Recorded in the header of `src/server/queries/budget.ts`, which is where the next person to add a query will look.
- **Files modified:** `src/server/queries/budget.ts`, `src/server/queries/presets.ts`
- **Verification:** static; `pnpm typecheck` / `pnpm build` clean. No database round trip was performed from this worktree — see Issues Encountered.
- **Committed in:** `f9d7dc6`

**8. [Rule 2 — Missing critical] `pctUsed` divides by the cap, and `BigInt` division by zero throws**

- **Found during:** Task 1
- **Issue:** The plan specifies `pctUsed = Number((spent + reserved) * 100n / cap)`. `cap_micro_usd` is constrained `>= 0`, not `> 0` — `app.set_budget_cap` refuses a non-positive cap with `22023`, but the column permits zero and the owner can write one. `BigInt` division by `0n` is a thrown `RangeError`, not `Infinity`, so a valid row would have 500'd the spend page and the budget settings page together.
- **Fix:** `pctUsedOf` returns 100 when anything is committed against a zero cap and 0 when nothing is — the same convention 02-07's `pctOfRemaining` already uses for the estimate line, and for the same reason: `NaN%` (or a blank page) is how a user stops believing the whole screen.
- **Files modified:** `src/server/queries/budget.ts`
- **Committed in:** `f9d7dc6`

**9. [Rule 2 — Missing critical] `getSpendByProvider` keyed on `periodId` can only ever return one provider**

- **Found during:** Task 1
- **Issue:** The plan's signature is `getSpendByProvider(claims, periodId)` with "one row per provider in `('places','firecrawl','anthropic')` even when zero". But `budget_periods` is keyed **(org, provider, month)**, so one period id belongs to exactly one provider, and every `cost_ledger` row for Firecrawl carries a different `budget_period_id`. Joining the ledger on `periodId` would have returned Places and nothing else — with the `values` list dutifully supplying two rows of `$0.00` that would never have moved, which is worse than an obvious bug because it looks right.
- **Fix:** the query resolves the period's **`period_start`** from the given id in an `anchor` CTE and joins `budget_periods` on `(provider, period_start)`, so all three providers' rows for that month are found. RLS confines both joined tables to the org. `getSpendByRun` takes the same anchor and additionally derives its two instants through `periodResetInstant` — which resolves the zone offset at the wall-clock moment, so it is right across a DST boundary and names no zone in `src/`.
- **Files modified:** `src/server/queries/budget.ts`
- **Committed in:** `f9d7dc6`

**10. [Rule 1 — Bug] A comment warning about the forbidden pattern tripped the grep that forbids it**

- **Found during:** Task 2
- **Issue:** `save-preset-version.ts`'s header explained the recorded BIS defect by naming it — and the plan's acceptance criterion is a bare `grep -c "form action" src/server/actions/*.ts` expecting 0. The warning would have been reported as the violation. Identical to 02-07's deviation 5.
- **Fix:** reworded to "a form's `action` prop", with a note pointing at the `src/lib/time.ts` precedent so the next author does not undo it. `grep -c "form action"` is 0 on all eight files.
- **Files modified:** `src/server/actions/save-preset-version.ts`
- **Committed in:** `c54157a`

---

**Total deviations:** 10 auto-fixed (4 bugs, 4 missing-critical, 2 blocking). No architectural change, no scope creep.

🔴 **The two worth carrying forward** are deviations 2 and 4, because both are cases where **the gates in this plan could not have caught the defect**. A zero-cost reservation fails only against a live database with a fresh budget period; a non-async export fails only once a page imports the module. Both were found by reasoning about the artefact rather than by running it, which is the same lesson 02-07 closed on.

## Issues Encountered

- **No database was touched.** No migration, no `db:migrate`, no `db:seed`, no `test:db`, no connection opened from this worktree. The sibling plan 02-08 was running 40-connection concurrency bursts against the shared local PostgreSQL for the whole of this plan, and every statement in these modules is therefore verified by `tsc` and by reading `drizzle/0013`, `drizzle/0015` and `drizzle/0016` rather than by execution. **That is a real gap and it is named in Next Phase Readiness.**
- **`next build` does not compile anything in `src/server/`** until a route imports it. See deviation 4.
- **The pnpm store launcher was used for every script**, per the machine notes; bare `pnpm` is a different global version here.

## Known Stubs

None. Every export is wired to real data: the actions read and write real tables through `withOrg`, the estimate comes from the committed seed and the live `budget_periods` row, and the geocoder is 02-07's real client. No placeholder values, no empty arrays flowing to a render path, no TODO and no FIXME.

The one thing that is *deliberately* not wired: `queueRun` creates a run in status `queued` and **nothing consumes it**. That is Phase 4's, it is D-12's stated design, and the action returns `PHASE4_RUN_NOTICE` in its payload so a screen cannot show a success state implying something is running right now.

## Threat Flags

None. No new network endpoint (the Census host is 02-07's and is unchanged), no new schema, no new file access. The register dispositions this plan owed:

| Threat ID | Disposition | Delivered by |
|---|---|---|
| T-2-01 | mitigate | `requireOrg()` first in all six actions; `tests/unit/server-actions-guard.test.ts` reds on a deleted check AND on a reordered one, both watched |
| T-2-02 | mitigate | `setBudgetCap` checks `auth().orgRole === 'org:admin'` for affordance; `app.set_budget_cap` re-checks `app.current_org_role()` in SQL and its `42501` is mapped to `forbidden`; `authenticated` holds no UPDATE grant on `budget_periods` |
| T-2-03 | mitigate | `queueRun` is the only action that can cause spend and it goes through `app.reserve_budget`; no action writes `cost_ledger` |
| T-2-10 | mitigate | Every read and write goes through `withOrg`; a foreign id returns `not_found` with copy that does not say which of "removed" or "another organisation" it was |
| T-2-13 | mitigate | The action bounds the address (length + control-character code points) before `census.ts` bounds it again |
| T-2-14 | mitigate | Authentication first; no paid call; `clusterKeys` capped at four and `cityIds` at 300, so the cell count an unauthenticated-adjacent caller can request is bounded |

## User Setup Required

None. No new environment variable, no credential, no external service. The Google Cloud project and the Places key still do not exist and nothing in this plan needs them.

## Next Phase Readiness

**Ready for 02-10 / 02-11 (the screens) and 02-12.** The exported surface is tabulated above, from source.

**Carry forward, in order of consequence:**

1. 🔴 **The database paths in this plan have never been executed.** Six actions' worth of SQL is `tsc`-clean and grant-checked by reading the migrations, and that is all. The highest-value additions, all for a plan that owns `tests/db`: a zero-cost `app.reserve_budget` succeeding (deviation 2); a save conflict producing `23505` on `search_versions_search_version_uniq` and the follow-up read succeeding in a fresh transaction; `app.set_budget_cap` refusing a member with `42501`; `bp_not_over` refusing at `spent + reserved` exactly.
2. 🔴 **02-11's estimate component must carry the monotonic sequence guard.** Server Actions are queued and uncancellable; a stale answer CAN land after a fresh one and nothing on the server side can prevent it.
3. 🔴 **The save path uses `onSubmit` + `useTransition`.** Never a form's `action` prop — React resets such a form even when the action FAILED, and a Radix `Select` drives its state backwards on that reset.
4. ⚠️ **Import the copy constants; never retype a string.** `src/lib/ui/copy.ts` now carries every error sentence an action can return, and `GEOCODE_NO_MATCH` uses UI-SPEC's typographic quotes.
5. ⚠️ **The wire spec is `presetSpecSchema`.** The editor must send `cityIds` / `countyIds`, not names — the ids are what a version row stores and what `tests/db/versioned-presets.test.ts` round-trips. `RADIUS_MILE_OPTIONS` is exported so the `Select` cannot invent a fifth radius.
6. ⚠️ **A reference-row drift test** would close deviation 1's loop from the database side.
7. `setBudgetCap` returns `capMicroUsd` as a **decimal string**; everything else returns `bigint`.

---
## Self-Check: PASSED

- All 11 files under `key-files.created` exist on disk (`[ -f ]` each) and the one modified file is `src/lib/ui/copy.ts`.
- All three task commits resolve in `git log`: `f9d7dc6`, `c54157a`, `572b0aa`.
- `git diff --diff-filter=D --name-only eff681b..HEAD` is empty — **no file deleted anywhere in this plan**.
- `git status --short` clean before this SUMMARY; `.env.local` is covered by `.gitignore` (`.env.*`) and was never staged.
- No write outside this worktree. `STATE.md` and `ROADMAP.md` untouched, per the parallel-execution contract.
- A byte scan of every new file reports zero control characters, and `git grep` reads all six action files as text — deviation 6's check, re-run after the final commit.
- Re-ran every plan-level `<verification>` item after the last task commit: 67/67 unit tests, typecheck clean, lint clean, build clean with the Proxy entry intact, and all the greps tabulated above.

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*

---
phase: 03-free-data-spine-entity-resolution
plan: 08
subsystem: database
tags: [overture, basic_category, seed, reference-rows, rls, nulls-not-distinct, D-02, DATA-02]
requires:
  - phase: 03-01
    provides: "@duckdb/node-api (used for the one-off live measurement only)"
  - phase: 03-05
    provides: "overture_category_map table, referencePolicies(), overture_category_map_org_category_uniq (NULLS NOT DISTINCT), TENANT_TABLES entry"
provides:
  - "src/seed/data/overture-categories.json: 70 basic_category -> cluster_key mappings measured on Overture 2026-08-19.0, with a _meta provenance entry (release, bbox, filter, totals, rule, 49 decided-unmapped categories with reasons, undecided tail)"
  - "src/seed/types.ts: OvertureCategorySeed / OvertureCategoryMeta / OvertureCategoriesFile + overtureCategorySeeds() / overtureCategoryMeta() helpers"
  - "scripts/seed.ts: OVERTURE_CATEGORY_UPSERT + upsertOvertureCategories(), in seedAll, the tally and MUST_BE_NON_EMPTY"
  - "70 built-in overture_category_map rows on the local test DB (NOT prod — 03-21 owns db:seed:prod)"
affects: [03-09, 03-11, 03-12, 03-20, 03-21, overture-ingest, cluster-tagging, funnel]
tech-stack:
  added: []
  patterns:
    - "Mapping rule = the cluster's Comptroller NAICS ranges: a basic_category maps where its businesses' NAICS would land (grocery/pharmacy/gas -> auto_retail because 44-45)"
    - "Decided-unmapped list with reasons in _meta, so a missing high-volume category reads as a decision, not an oversight"
    - "DDL mutations executed INSIDE the test's own transaction (rolled back with it) instead of against the shared DB"
    - "Non-vacuity guard: zero-row UPDATE/DELETE tests first assert the built-ins are present"
key-files:
  created:
    - src/seed/data/overture-categories.json
    - tests/unit/seed-data.test.ts
  modified:
    - src/seed/types.ts
    - scripts/seed.ts
    - tests/db/reference-rows.test.ts
key-decisions:
  - "Coverage floor is 55% of rows, not the plan's 70%: honest mapping covers 57.8% (32,890 / 56,944). About 42% of the slice is finance, worship, schools, government and parks, which belong to no cluster. Reaching 70% would mean guessing, which D-02 and the plan's own rule forbid"
  - "Mapping rule follows the clusters' NAICS ranges (23 / 721-723 / 8121+621 / 8111+44-45), so the Overture half tags like the Comptroller half: food_and_beverage_store, convenience_store, pharmacy_and_drug_store and gas_station -> auto_retail; hospital (622), senior_living (623), laundry (8123), pet services (8129) stay unmapped"
  - "sort_order = rank by measured row count (1 = restaurant)"
  - "upsertOvertureCategories resolves every cluster_key against the SEEDED built-in clusters and throws naming the category: cluster_key is text, not an FK, so the database would accept a key no cluster has"
requirements-completed: [DATA-02]
duration: ~50min
completed: 2026-09-22
---

# Phase 3 Plan 08: Overture basic_category -> cluster map Summary

**70 Overture `basic_category` values mapped to the four seeded clusters, measured live on release `2026-08-19.0` (56,944 Texas-side RGV rows). They load idempotently through `scripts/seed.ts` as `org_id IS NULL` built-ins, and the rules (readable, un-updatable, un-deletable, unforgeable, un-duplicable) are each proven by a named test that was watched red.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-09-22
- **Tasks:** 2 of 2
- **Files:** 2 created, 3 modified

## Accomplishments

- **Live measurement.** The bucket still holds one release, `2026-08-19.0` (listed via a DuckDB `glob`). A bbox range-read with the TX/US filter took 9.6 s and returned **56,944 rows, 1,223 NULL `basic_category`, 244 distinct**. That matches 03-RESEARCH to the row.
- **The mapping.** 70 categories: home_services 2, food_hospitality 21, personal_care_health 18, auto_retail 29. They cover **32,890 rows (57.8%)**. Another 49 categories of at least 100 rows are recorded as `decidedUnmapped` with a reason each (19,888 rows). With NULL included, **94.8% of rows are decided**. The undecided tail is 125 categories and 2,943 rows, all under 100 rows each; the ingest reports those by name.
- **The loader.** `OVERTURE_CATEGORY_UPSERT` names its constraint, returns `(xmax = 0)` and goes through `upsert()`, so the "affected no row" guard applies. `db:seed` prints `overture_category_map: N inserted, M updated`.
- **`db:seed` run twice on the test DB.** The first run printed `70 inserted, 0 updated` and the second `0 inserted, 70 updated`. `select count(*)` read 70 before and after the second run.

## Task Commits

1. **Task 1: Measure the live distribution and commit the mapping.** `b9b0ea1` (feat)
2. **Task 2: Load it through scripts/seed.ts and prove the reference-row rules.** `4224008` (feat)

## Tests

**Unit, `tests/unit/seed-data.test.ts`.** Five named tests: `overture category map covers the top categories`, `... uses only seeded cluster keys`, `... has no duplicate category`, `... closes its own arithmetic`, `... confirms the merge fixture auto_retail assumption`. Each was mutation-checked against a backup copy of the JSON, and the restore was verified byte-identical with `cmp`:

| Mutation | Red (and only these) |
|---|---|
| `gas_station` -> `cluster_key: 'retail'` | uses only seeded cluster keys |
| duplicate `restaurant` entry | has no duplicate category + closes its own arithmetic |
| drop last 20 entries (70 -> 50) | covers the top categories + closes its own arithmetic |
| `fashion_and_apparel_store` -> food_hospitality | confirms the merge fixture auto_retail assumption |
| drop both home_services entries | covers the top + uses only seeded keys (cluster unreachable) + arithmetic |

**DB, `tests/db/reference-rows.test.ts`, describe `built-in overture category map`.** Six named tests: `built-in overture categories are visible to a tenant`, `built-in overture category update is filtered to zero rows`, `built-in overture category delete is filtered to zero rows`, `a forged built-in overture category insert is refused`, `a duplicate built-in overture category is refused`, `built-in overture category seed is idempotent`.

RED before seeding, when the table was empty:
```
× built-in overture categories are visible to a tenant      → expected +0 to be 70
× built-in overture category update is filtered to zero rows → expected +0 to be 70
× built-in overture category delete is filtered to zero rows → expected +0 to be 70
✓ a forged built-in overture category insert is refused
× a duplicate built-in overture category is refused          → promise resolved "Result{ command: 'INSERT' }" instead of rejecting
✓ built-in overture category seed is idempotent
Tests  4 failed | 2 passed
```
RED after seeding came from DDL executed **inside each test's own transaction**. It rolled back with the transaction, so the shared DB was never altered. `pg_policy` and `pg_constraint` were re-read afterwards and are identical, with 70 built-ins and no stray rows:

| Mutation | Red |
|---|---|
| `alter policy overture_category_map_update ... using (true) with check (true)` | update test ALONE (`expected 70 to be +0`) |
| `alter policy overture_category_map_delete ... using (true)` | delete test ALONE (`expected 70 to be +0`) |
| `alter policy overture_category_map_insert ... with check (true)` | forged-insert test ALONE (promise resolved) |
| unique re-added as plain `unique (org_id, basic_category)` | duplicate test + idempotent test (`expected [Array(140)] to have a length of 70`: the loader doubled the table) |
| `alter policy overture_category_map_select ... using (org_id = current_org_id())` | visible + update + delete (their count guards see 0) |

**Final suites on `4224008`:** unit **27 files / 183 tests** green; DB **16 files / 120 tests** green. That includes `authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table`, `anon holds no privilege on any tenant table` and `every public table is org-scoped and has RLS enabled`, each read by name. `tsc --noEmit`, `eslint` and `prettier` are clean on every touched file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan contradiction] Coverage floor 70% -> 55%; must-have "covering about 80%" is not met as written**
- **Found during:** Task 1
- **Issue:** The plan asks for "the top 60 by rows (~80%) ... each mapped to one of the four clusters", a unit assertion that mapped rows are at least 70% of the total, and also "Map, do not invent ... do not map `christian_place_of_worship` or similar". The top 60 includes financial_service (2,950), christian_place_of_worship (1,533), real_estate_service (1,247), attorney, government, schools and parks. Every category that clearly belongs to a cluster adds up to 57.8%, so 70% is reachable only by guessing.
- **Fix:** The plan's own 🔴 rule wins. The floor is set at the honest level of 55% (measured 57.8%). A second assertion covers what "top categories" was really asking for: at least 90% of rows (measured 94.8%) are *decided*, either mapped or listed in `_meta.decidedUnmapped` with a reason. The reasoning is in the test file's header.
- **Files modified:** tests/unit/seed-data.test.ts, src/seed/data/overture-categories.json
- **Commit:** b9b0ea1

**2. [Rule 2 - Missing critical functionality] Decided-unmapped bookkeeping plus two extra unit tests**
- **Found during:** Task 1
- **Issue:** Without a record of what was looked at, an absent high-volume category can't be told apart from a forgotten one.
- **Fix:** Added `_meta.decidedUnmapped` (49 entries with reasons) and `_meta.undecidedTail`. The row and category arithmetic closes exactly against `totalRows` and `distinctCategories`. Added `overture category map closes its own arithmetic` and `... confirms the merge fixture auto_retail assumption`.
- **Commit:** b9b0ea1

**3. [Rule 2] Non-vacuity guard in the zero-row UPDATE/DELETE DB tests**
- **Found during:** Task 2
- **Issue:** Against an empty table, a zero-row UPDATE or DELETE of built-ins passes having proved nothing. Before seeding, both would have been green.
- **Fix:** Both tests first assert `countBuiltIn(...) === 70`. They went red before seeding (see the RED output above).
- **Commit:** 4224008

**4. [Rule 2] Loader validates `cluster_key` against the seeded clusters**
- **Issue:** `cluster_key` is text, not an FK, so the database accepts any string.
- **Fix:** `upsertOvertureCategories` calls `required(clusterIdsByKey, ...)` and throws naming the category, matching the loader's existing "a miss throws NAMING the ref" rule.
- **Commit:** 4224008

**5. [Rule 6-style bookkeeping] reference-rows.test.ts header claim updated**
- The header said the RLS message literal "appears exactly once in this file", which was 02-06's grep acceptance. The plan requires pinning the message on the new forged-insert test too, so the literal now appears twice, once per table. I reworded the header so it isn't false. **02-06's `grep -cF ... = 1` check no longer holds, deliberately.**
- **Commit:** 4224008

**6. Plan acceptance/verify commands adjusted**
- `c.map(x=>x.key)` in Task 1's acceptance doesn't match the shape of `clusters.json` (an object with `.clusters`). I ran it as `c.clusters.map(...)` and it printed `0`.
- `$PNPM test:unit -- -t` and `$PNPM test:db -- -t` don't filter under pnpm 12. I used `npx vitest run ... -t ... --reporter=verbose` and read every test name.
- The first acceptance command printed `70`; `grep restaurant` matched; the release string appears in the file twice; `git status` showed no untracked `.ts`. The throwaway probe, generator and mutation scripts lived in the OS temp dir and gitignored `node_modules/.cache`, and were deleted afterwards.

## Next plan must know

- **The 03-02 cross-plan check on P01 and P04 is CONFIRMED.** Read live from `2026-08-19.0` during this plan:
  - **P01**: Zorba, 516 S Main St, McAllen -> `basic_category = fashion_and_apparel_store` (taxonomy `shoe_store`) -> **auto_retail** ✅
  - **P04**: Firestone Complete Auto Care, 118 N 12th Ave, Edinburg -> `automotive_service` (taxonomy `tire_shop`) -> **auto_retail** ✅
  - **P03** (bonus): La Colmena Meat Martket & Food Store, 15701 Monte Bello Ln -> `food_and_beverage_store` -> **auto_retail** ✅ (both sides, as the fixture assumes)
  - A unit test now pins all three category -> cluster assignments, so a remap reds before 03-20's scores move.
  - ⚠️ **Caveat for 03-11 and 03-20:** another Firestone outlet (4111 S 23rd St, McAllen) is tagged `professional_service`, which is **unmapped**. Chain members can carry inconsistent categories, so a chain's cluster should not be read from one member. "Zorba inc" at 14 S Main St is `sporting_goods_store` (also auto_retail).
- **The loader is upsert-only.** Removing a category from the JSON leaves its built-in row mapped in the DB, the same as every other loader here. For this table that matters more, because a wrong mapping stays live until someone deletes it by hand. A future refresh should prune `org_id IS NULL` rows missing from the file, or the ingest should read the file instead of the table.
- **The ingest (03-09/03-12) must report** every non-NULL `basic_category` with no built-in row in `ingest_runs.stats.unmapped`. That includes the 49 `decidedUnmapped` categories; the list is documentation, not a load.
- **Release turnover:** `2026-09-23.0` lands tomorrow and will likely replace `2026-08-19.0`. The map keys on `basic_category` *names*; any new or renamed value in the new release shows up as unmapped in the run report. Re-measure then, not before.
- **Test DB state:** 70 built-in `overture_category_map` rows seeded. **Prod is NOT seeded**; `db:seed:prod` belongs to 03-21's human checkpoint.
- `sort_order` is the rank by measured rows (1 = `restaurant`, 4,556).

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema. T-3-07 is proven by the zero-rows / `42501` split plus the in-transaction mutations. For T-3-03, every value is a bound parameter and the JSON is a committed file pinned by five unit tests. T-3-01 is unchanged; only `--target=test` was run.

## Self-Check: PASSED

- FOUND: src/seed/data/overture-categories.json
- FOUND: tests/unit/seed-data.test.ts
- FOUND: src/seed/types.ts, scripts/seed.ts, tests/db/reference-rows.test.ts (modified)
- FOUND: commit b9b0ea1
- FOUND: commit 4224008

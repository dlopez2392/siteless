---
phase: 03-free-data-spine-entity-resolution
plan: 05
subsystem: database
tags: [drizzle-kit, rls, grants, provenance, pg_trgm, entity-resolution, schema]
requires:
  - phase: 03-01
    provides: "pg_trgm (gin_trgm_ops for businesses_name_trgm), unaccent, app.distance_m"
provides:
  - "Five org-scoped spine tables: ingest_runs, merge_candidates, business_merges, business_aliases, overture_category_map"
  - "businesses: comptroller_key, primary_source, external_key (NOT NULL, SL-XXXXXX, unique per org), name_norm/street_norm (INTERNAL), street/street_num/unit/postal, lat/lng, location_match_type, phone_blockable, basic_category, cluster_key, confidence, operating_status, chain_key, closed_at, merged_into_id"
  - "Three new durable provenance pairs with composite FKs: businesses_address_src_fk, businesses_location_src_fk (T-3-06), businesses_closed_at_src_fk"
  - "source_records.last_seen_at + source_version; sr_source_key_known admits tx_comptroller_closures and census_geocoder"
  - "Blocking indexes: businesses_name_trgm (GIN), phone, addr, chain, merged, comptroller_key; partial uniques source_records_ext_uniq (DATA-04 upsert target), business_aliases_key_uniq, business_merges_loser_uniq"
  - "tests/db/_fixtures.ts SQL_FRESH_EXTERNAL_KEY — the insert fragment every business-inserting DB test now needs"
affects: [03-06, 03-09, 03-11, 03-12, 03-13, 03-14, 03-15, 03-18, 03-19, 03-21, resolver, merge-functions, ingest, review-queue]
tech-stack:
  added: []
  patterns:
    - "SELECT-only grant + explicit revoke for every definer-written table (ingest_runs, merge_candidates, business_merges, business_aliases)"
    - "Per-column canaries in the leak fixture + a compile-time Extract<keyof PublicBusiness, ...> assertion pinning the Omit list"
    - "Positive control declared before its refusal, each in its own withRollback"
key-files:
  created:
    - src/db/schema/ingest-runs.ts
    - src/db/schema/merge-candidates.ts
    - src/db/schema/business-merges.ts
    - src/db/schema/business-aliases.ts
    - src/db/schema/overture-categories.ts
    - drizzle/0022_spine_tables.sql
    - drizzle/0023_spine_constraints_grants.sql
    - drizzle/meta/0022_snapshot.json
    - drizzle/meta/0023_snapshot.json
  modified:
    - src/db/schema/businesses.ts
    - src/db/schema/source-records.ts
    - src/db/schema/index.ts
    - src/lib/export/public-business.ts
    - drizzle/meta/_journal.json
    - tests/unit/fixtures/business.ts
    - tests/unit/no-internal-leak.test.ts
    - tests/db/_fixtures.ts
    - tests/db/grants-audit.test.ts
    - tests/db/event-trigger.test.ts
    - tests/db/retention.test.ts
    - tests/db/rls-isolation.test.ts
    - tests/db/events-append-only.test.ts
key-decisions:
  - "The sr_source_key_known CHECK swap lives in 0022, not 0023: drizzle-kit 0.31.10 emitted DROP + ADD itself because the CHECK is declared in the TS schema. Repeating it in 0023 would be a pointless drop-and-re-add"
  - "0022 generated with `--name=spine_tables` (a generate flag, not a rename) so the file matches the plan's files_modified"
  - "merge_candidates is SELECT-only for authenticated (not 'select, update' as 03-RESEARCH suggested): every decision goes through a 03-11 SECURITY DEFINER so decided_by cannot be forged (T-3-08); reasoning recorded beside the revoke in 0023"
  - "external_key NOT NULL with no default: businesses was empty locally (count 0), so no backfill migration was needed. Existing tests supply a fresh key via SQL_FRESH_EXTERNAL_KEY"
  - "nameNorm/streetNorm/phoneBlockable are INTERNAL; PublicBusiness = Omit<BusinessLike, 'internalNotes'|'nameNorm'|'streetNorm'|'phoneBlockable'>"
  - "Positive controls for location and closed_at cite census_geocoder and tx_comptroller_closures sources (the keys that really feed them), so they also depend on the widened CHECK — measured and recorded in the test header"
requirements-completed: [DATA-03, DATA-04, DEDUP-01, DEDUP-02, DEDUP-03]
duration: ~23min
completed: 2026-09-22
---

# Phase 3 Plan 05: Spine Tables, Constraints and Grants Summary

**Five new org-scoped tables and a wider `businesses`/`source_records`, plus two migrations: 0022 is drizzle-kit's, 0023 is hand-written. 0023 adds three composite provenance FKs (one of them the Places lat/lng legal boundary, T-3-06), the per-org `SL-XXXXXX` key with its Crockford shape check, a GIN trigram index and five partial blocking indexes, SELECT-only grants on the four definer-written tables, and `log_event` on `business_merges` only.**

## Performance

- **Duration:** about 23 min (20:09 to 20:32 CDT)
- **Tasks:** 3/3, plus one Rule 3 fix commit
- **Files:** 9 created, 13 modified

## Accomplishments

- **Every catalog claim was read from the live local DB (PG 18.6)**, not inferred from "the migration ran":
  - `pg_constraint`: exactly **six** `businesses_%_src_fk` rows. The three new ones are `businesses_address_src_fk`, `businesses_closed_at_src_fk` and `businesses_location_src_fk`, each `FOREIGN KEY (x_source_id, x_src_ret) REFERENCES source_records(id, retention_class)`.
  - `pg_indexes`: `businesses_name_trgm` = `USING gin (name_norm gin_trgm_ops)`. `businesses_external_key_uniq`, `_addr_idx`, `_chain_idx`, `_comptroller_key_idx`, `_merged_idx` and `_phone_idx` are all present. The three partial uniques carry their `WHERE` clauses.
  - `role_table_grants` for `authenticated`: the four definer-written tables hold `SELECT` only; `overture_category_map` holds `DELETE,INSERT,SELECT,UPDATE`. There are **zero** non-SELECT column grants on the four.
  - `pg_trigger`: `business_merges_event` (log_event) plus five `*_touch` triggers (touch_updated_at, BEFORE UPDATE). All six have `tgenabled = 'O'`.
  - RLS: `relrowsecurity = true` with 4 policies on each of the five tables. A `comment on table` sits on the four tables that deliberately have no `log_event`.
- **No drift:** `db:generate` after migrate printed "No schema changes, nothing to migrate".
- **`__drizzle_migrations`:** ids 25 and 26 were added (0022 at `1790126517622`, 0023 at `1790126545486`), and the journal is linear 0021 → 0022 → 0023.

## Task Commits

1. **Task 1: schema modules + extensions + leak sentinel** (`70b6aea`, feat)
2. **Task 2: migrations 0022 + 0023, applied locally** (`b746dd5`, feat)
3. **Rule 3 fix: `external_key` in existing business inserts** (`e63d9fc`, fix)
4. **Task 3: widened lists + cites-durable tests** (`bd2960f`, test)

## Verification (every command run, output read)

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 (after Task 1 and again after Task 3) |
| `eslint .` | exit 0 |
| `vitest run tests/unit` | **20 files, 82 tests passed** |
| `vitest run tests/unit/no-internal-leak.test.ts` | 2 passed, both names read |
| `db:migrate` (test target) | "migrations applied successfully" |
| `db:generate` | "No schema changes, nothing to migrate" |
| `test:db` (full) | **16 files, 114 tests passed** (was 105; +9 new) |
| `next build` | exit 0 |

The PASS list names every required test: `the four select-only spine tables hold no write privilege`; `positive control: address|location|closed_at cites durable source and is accepted`; `address|location|closed_at cites durable: an ephemeral google_places source is refused`; `source key known: the four Phase 3 keys are accepted`; `source key known: an unknown key is refused`.

### Watched red first (live-DB mutations, each reverted and the revert read back from the catalog)

| Mutation | Tests that went red (names read) | Revert verified by |
|---|---|---|
| Task 2 migrate, before Task 3's list edits | `authenticated holds no TRUNCATE…` (live catalog 21 vs array 16) and `every state-bearing table has an app.log_event…` (7 trigger rows vs 6) | n/a (the lists were widened) |
| **M18** `drop constraint businesses_location_src_fk` | **only** `location cites durable: …refused`; its positive control stayed green | `pg_constraint` def + `obj_description` present |
| `drop` address + closed_at FKs | **only** `address cites durable: …refused` and `closed_at cites durable: …refused` | all six `_src_fk` rows with correct defs |
| `sr_source_key_known` narrowed back to the Phase 1 list | `source key known: the four Phase 3 keys are accepted`, **plus** the location and closed_at positive controls, which cite `census_geocoder` / `tx_comptroller_closures` sources (23514 `sr_source_key_known`). The test header records this. | `pg_get_constraintdef` shows the 11-key list |
| `sr_source_key_known` dropped | **only** `source key known: an unknown key is refused` | same |
| **M22** `grant update on ingest_runs to authenticated` | **only** `the four select-only spine tables hold no write privilege` | `has_table_privilege` false, 0 column grants |
| `grant update (score) on merge_candidates` (column variant) | **only** the same test, on `col_u: true` (the half `has_table_privilege` alone cannot see) | `has_any_column_privilege` false, 0 column grants |
| `disable trigger business_merges_event` | **only** `every state-bearing table…` (`enabled: "D"`) | `tgenabled = 'O'` |
| `drop trigger business_merges_event` | **only** `every state-bearing table…` (length 6, expected 7) | `pg_get_triggerdef` identical, `tgenabled = 'O'` |
| TS: `'nameNorm'` removed from the `PublicBusiness` Omit | tsc exit 2 at `no-internal-leak.test.ts(37)`: `Type 'true' is not assignable to type 'never'` | re-applied (see deviation 4) |

`git diff --stat` stayed empty through every DB mutation, because the mutations touched only the database and never a migration file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `external_key NOT NULL` broke nine existing DB tests with 23502**
- **Found during:** Task 2 (first `test:db` after migrate)
- **Issue:** The plan expected `test:db` to be "green apart from the two list tests". In fact **11** failed: every test that inserts a `businesses` row without `external_key` failed with `23502 null value in column "external_key"`. The affected files were rls-isolation ×3, events-append-only ×2, event-trigger ×2 and retention ×2. One of these was the old `durable cites durable` refusal, which failed with `23502` instead of `23503`. Its SQLSTATE pin is the only reason that showed up as red rather than as a false pass.
- **Fix:** Added `SQL_FRESH_EXTERNAL_KEY` to `tests/db/_fixtures.ts`: `'SL-' || upper(substr(md5(random()::text),1,6))`. It is a fresh key per row, inline in the INSERT. Hex upper-cased is a subset of the Crockford class, so it always passes the shape CHECK, and multi-row tests cannot collide. Five inserts across four files now use it. After the fix, exactly the two list tests were red, which is the plan's intended state.
- **Files modified:** tests/db/_fixtures.ts, rls-isolation, events-append-only, event-trigger, retention
- **Commit:** `e63d9fc`
- **For 03-06 onward:** any new DB test that inserts a business must supply `external_key`. Use the fragment, or a literal when the test is *about* the key.

**2. [Plan inconsistency] The CHECK swap is in 0022, not 0023, so 0023 has 23 breakpoints, not the planned 25 or more**
- **Found during:** Task 2
- **Issue:** The plan says drizzle-kit's differ "does not emit table-level constraints". drizzle-kit 0.31.10 **did** emit the `sr_source_key_known` swap into 0022, because the CHECK is declared in `source-records.ts`: `ALTER TABLE "source_records" DROP CONSTRAINT "sr_source_key_known"` near the top and the widened `ADD CONSTRAINT` near the end. The plan's breakpoint count of 25 or more assumed those two statements would be in 0023.
- **Fix:** Section (a) was left out of 0023, and the header says why. 0023 has 24 statements with a breakpoint between every pair (23). I added two catalog comments that carry real information, `comment on constraint businesses_location_src_fk` (T-3-06) and `comment on column businesses.name_norm` (INTERNAL). I did not pad the file to reach 25. The criterion's intent, that every statement is separated, holds.
- **Commit:** `b746dd5`

**3. [Plan inconsistency] Verify commands whose filters are no-ops**
- `test:unit -- -t "no internal leak"`: no test has that name. Phase 1 pinned the names as `no registered payload builder emits an internal annotation` and `every module under src/lib/export…`, and `--` is passed literally under pnpm 12 anyway. I ran the file by path and read both PASS names.
- `test:db -- -t "cites durable"`: same `--` problem. I ran the full suite with `--reporter=verbose` and read the names.

**4. [Process slip, corrected] A mutation revert through `git checkout --` wiped an uncommitted edit**
- While mutation-checking the compile-time guard, I reverted `public-business.ts` with `git checkout --`. That restored HEAD and dropped the uncommitted Task 1 edit. I noticed immediately from the file-changed notice, re-applied the edit verbatim, then re-ran tsc (0), lint (0) and the unit suite (82 passed) before committing. Every later mutation was applied to the database, not to files.

**5. [Minor] The plan's `enableRLS()|withRLS()` grep would have matched a pre-existing comment**
- The original `businesses.ts` comment literally named `.enableRLS()` and `.withRLS()`. I reworded it while editing the file, and the grep now returns nothing.

### Scope additions (Rule 2 / required by the plan's own done criterion)

- `tests/unit/fixtures/business.ts` (not in files_modified) had to gain the three fields, otherwise tsc fails. Each internal column carries its **own** canary (`NAMENORM-CANARY-4c91e0`, `STREETNORM-CANARY-a82d57`), so a leak names the column that escaped. The sentinel now also scans payloads for the internal key spellings in both casings, and a compile-time `Extract<keyof PublicBusiness, …> extends never` assertion pins the Omit list (mutation-checked above).

## Notes for downstream plans

- **03-21 (prod apply):** 0022 adds `external_key text NOT NULL` with no default, so production `businesses` must be empty (the 03-21 plan already says so). 0022 also contains the CHECK swap. 0023 needs `pg_trgm`, so 0021 has to land first.
- **03-11 (merge definers):** all four definer-written tables hold no INSERT/UPDATE/DELETE for `authenticated`, at table level or column level. Every write must come from the definer. `app.log_event` on `business_merges` resolves the org from the row's own `org_id`, so it works without a Clerk claim. The actor falls back to the `app.actor_id` GUC and then to `'system'`.
- **Queue order for `/review`:** `decision='pending' order by skipped_at nulls first, score desc`. The index `merge_candidates_queue_idx` is `(org_id, decision, score desc)`. It covers the decision filter; `skipped_at` is a sort key outside the index.
- **CRLF:** git warns that it will convert the new `.sql` files to CRLF on checkout. 0021 has the same situation. Whether a CRLF checkout changes drizzle's migration hash is not re-examined here.

## Threat Flags

None. The only surface added is what the threat model already covers (T-3-01, -06, -07, -08, -09, -13). No endpoints and no auth paths.

## Known Stubs

None. The tables are empty by design; 03-12/03-13 (ingest), 03-14 (resolve) and the seed loader fill them.

## Self-Check: PASSED

- FOUND: src/db/schema/{ingest-runs,merge-candidates,business-merges,business-aliases,overture-categories}.ts, drizzle/0022_spine_tables.sql, drizzle/0023_spine_constraints_grants.sql, drizzle/meta/0022_snapshot.json, drizzle/meta/0023_snapshot.json
- FOUND commits: 70b6aea, b746dd5, e63d9fc, bd2960f
- STATE.md / ROADMAP.md untouched

---
phase: 04-places-transient-verifier
plan: 09
subsystem: database
tags: [postgres, drizzle, rls, grants, retention, places, security_invoker]

requires:
  - phase: 02-search-presets-budget
    provides: runs, search_versions, cost_reservations, the 0013 runs column grant
  - phase: 03-spine
    provides: businesses (the spine), seedOvertureSide, overture_category_map built-ins
provides:
  - "Eight org-scoped Places tables (drizzle/0026_places_tables.sql, generated)"
  - "runs: kind, partition_index, estimate lo/hi, ceiling_requests, workflow_run_id, requested_by, heartbeat_at"
  - "drizzle/0027_places_grants_triggers.sql: never_started data fix, runs_one_active_per_org, businesses_latlng_idx, SELECT-only grants, grant-less place_coordinates, append-only trigger, siteless_cron role, business_place_signal view"
  - "tests/db/_places-fixtures.ts: PLACES_SPINE, seedPlacesSpine, seedPlacesRun, seedRunSearch, seedAttachmentWithObservation, CLAIMS_A/B"
  - "tests/db/places-schema.test.ts: twelve named DB proofs + a fixture smoke test"
  - "D-09 amendment to PLACE-02, ROADMAP Phase 4 criterion 2, CONVENTIONS § Retention"
affects: [04-10, 04-11, 04-15, 04-18, 04-20, 04-22, 04-26, 04-30]

tech-stack:
  added: []
  patterns:
    - "Grant-less side table as a retention barrier (place_coordinates): no privilege for authenticated/anon; definer-only access"
    - "Belt-and-braces append-only: SELECT-only grant + BEFORE UPDATE OR DELETE raising trigger (55000) that also stops the owner"
    - "security_invoker view so RLS applies through it"
    - "Unique partial index for one-active-run-per-org, preceded by a data fix in the same migration"

key-files:
  created:
    - src/db/schema/place-attachments.ts
    - src/db/schema/place-observations.ts
    - src/db/schema/place-coordinates.ts
    - src/db/schema/place-tiles.ts
    - src/db/schema/place-tile-members.ts
    - src/db/schema/run-searches.ts
    - src/db/schema/run-place-outcomes.ts
    - src/db/schema/place-purge-runs.ts
    - drizzle/0026_places_tables.sql
    - drizzle/0027_places_grants_triggers.sql
    - drizzle/meta/0026_snapshot.json
    - drizzle/meta/0027_snapshot.json
    - tests/db/_places-fixtures.ts
    - tests/db/places-schema.test.ts
  modified:
    - src/db/schema/runs.ts
    - src/db/schema/index.ts
    - drizzle/meta/_journal.json
    - tests/db/grants-audit.test.ts
    - tests/db/event-trigger.test.ts
    - tests/db/_fixtures.ts
    - tests/db/versioned-presets.test.ts
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/CONVENTIONS.md

key-decisions:
  - "Coordinates live in a grant-less place_coordinates side table (research OQ 6); observations have zero UPDATE path"
  - "place_attachments log_event is the UPDATE arm only, narrowed to status changes; per-run INSERTs are audited at run level by 04-22"
  - "seedPlacesRun defaults to status 'running'; a second run in one org must be seeded non-active"
  - "Keys reaching the database are DB-safe: U+0000 cannot be stored in Postgres text (22021); fixture cellKey = clusterKey + '/' + unitId"

patterns-established:
  - "Every Places table: orgScoped + <t>_org_idx + orgPolicies + an explicit grant line in 0027 + a TENANT_TABLES row"
  - "Places grant matrix asserted at table AND column level, including has_any_column_privilege SELECT on place_coordinates"

requirements-completed: [PLACE-02]

duration: 38min
completed: 2026-09-23
---

# Phase 4 Plan 09: Places Schema Summary

**Eight org-scoped Places tables with append-only observations (grant + raising trigger), a grant-less 30-day coordinate table, a security_invoker signal view over attached listings only, and one-active-run-per-org, all applied locally and proven by named, mutation-checked DB tests.**

## Performance

- **Duration:** ~38 min
- **Started:** 2026-09-23T19:02Z
- **Completed:** 2026-09-23T19:40Z
- **Tasks:** 3 (5 commits)
- **Files:** 14 created, 10 modified

## Accomplishments

- **Migration 0026 (generated, real name `drizzle/0026_places_tables.sql`)**: `place_attachments`, `place_observations`, `place_coordinates`, `place_tiles`, `place_tile_members`, `run_searches`, `run_place_outcomes`, `place_purge_runs`. Each has RLS enabled and four policies (8 × `ENABLE ROW LEVEL SECURITY`), and all the plan's CHECKs are present (`pc_expiry_within_30_days`, `pc_expiry_after_observed`, `po_host_class_agrees`, `po_host_class_known`, `po_sku_known`, …). `runs` gains 10 columns plus `runs_kind_known` and `runs_partition_index_range`. A second `db:generate` reports "No schema changes".
- **Migration 0027 (custom, `drizzle/0027_places_grants_triggers.sql`, 22 statement breakpoints)**, in plan order:
  1. Fails stale queued runs as `never_started`.
  2. Creates `runs_one_active_per_org` and `businesses_latlng_idx`.
  3. Grants SELECT on the seven tables and revokes INSERT, UPDATE and DELETE.
  4. Runs `revoke all on place_coordinates from authenticated, anon`.
  5. Runs `grant update (heartbeat_at, workflow_run_id) on runs`. `ceiling_requests` appears only in a comment.
  6. Adds the touch-trigger loop over five tables and `place_attachments_event_upd`.
  7. Adds `app.refuse_place_observation_change` and `place_observations_append_only`.
  8. Creates the `siteless_cron` NOLOGIN role and grants it to `app_user`.
  9. Creates `business_place_signal` with `security_invoker = true`, grants SELECT on it and adds its comment.
  10. Adds one `comment on table` per table without `log_event`.
- **Audits widened:**
  - `TENANT_TABLES` gains 8 rows (21 → 29), each commented with its 0027 grant line. The view is not added, because every enumeration reads `relkind = 'r'`.
  - `schema-audit` also reads `relkind = 'r'` only, so it needed no `EXPECTED_VIEWS` exception.
  - `EVENT_LOGGED` gains `place_attachments`, and `LOG_EVENT_TRIGGER_ROWS` goes from 7 to 8.
  - `actAsRole` allow-lists `'siteless_cron'`.
- **D-09 amendment:** PLACE-02, ROADMAP criterion 2 and CONVENTIONS § Retention use the plan's exact wording (see Planning content edits below).

## Task Commits

1. **Task 1: Drizzle schema + generated 0026:** `54b7be5` (feat)
2. **Task 2: Custom 0027, applied locally, audits widened:** `011fb25` (feat)
3. **Task 3: DB proofs + shared fixtures:** `d68ce7d` (test). The D-09 amendment is `fc774f6` (docs).
4. **Deviation fix (Rule 1):** `7921297` (fix). Covers `versioned-presets` under the new unique index.

## Local database

- `drizzle.__drizzle_migrations`: **26 before → 28 after** (0026 and 0027 applied through `tsx scripts/db.ts migrate --target=test`). The local `app_user` password was re-set by the script as usual.
- `db:generate` after the apply reports no drift.
- No production command was run: no `db:migrate:prod` and no deploy.

## Gates run (final tree)

- `npx tsc --noEmit`: exit 0
- `npx eslint src tests scripts`: clean. Whole-repo `eslint . --ignore-pattern ".claude/**"` was also clean earlier in the plan.
- `vitest run tests/unit`: **46 files, 340 tests passed** (includes `pg17-compat`, 2/2)
- `vitest run --config vitest.db.config.ts --pool=forks` (full `test:db`): **31 files, 236 tests passed**, 84 s
- `places-schema.test.ts` names all twelve plan tests plus `fixtures: seedRunSearch shares one tile across runs and records one search per run`. All 13 passed.

## Mutation checks (live local DB, each reverted, state re-verified from the catalog)

| Mutation | Red (exact names) |
|---|---|
| `grant update, delete on place_observations to authenticated` | "place observations are append-only: update is refused", "… delete is refused" (only those 2 of 12) |
| `alter table place_observations disable trigger place_observations_append_only` | "the append-only trigger refuses even the owner" (only) |
| **M37** `grant select on place_coordinates to authenticated` | "authenticated cannot read place coordinates" + grants-audit "the eight places tables hold exactly their 0027 grants" (2 of 26) |
| M37 column variant `grant select (lat, lng) on place_coordinates` | grants-audit "the eight places tables hold exactly their 0027 grants" only. The `select *` test stays green by design, and the `has_any_column_privilege` half catches it. |
| drop `pc_expiry_within_30_days` + drop `po_host_class_agrees` | "a coordinate cannot be kept past 30 days", "an observation's host class agrees with its boolean" (one each) |
| drop `runs_one_active_per_org` + `grant update (ceiling_requests) on runs` + `alter table businesses add column had_website_uri boolean` | "one active run per org", "grants: runs heartbeat_at is updatable and ceiling_requests is not", "businesses gains no Places-derived column" (one each) |
| **M43** view `where a.status in ('attached','tentative')` | "a tentative attachment is excluded from the signal" (only) |
| view lateral `order by observed_at asc` + `security_invoker = false` | "the signal is true if any attached listing's latest observation is true", "the signal view is tenant-scoped" (one each) |

After the reverts, a catalog read confirmed:
- the view is `security_invoker=true` and keeps its comment and SELECT grant;
- both CHECKs exist;
- the trigger is enabled (`O`);
- the index exists;
- `ceiling_requests` UPDATE is false, and `place_coordinates` has no column SELECT and no observation UPDATE;
- `businesses.had_website_uri` is absent;
- the view definition has `status = 'attached'` and `observed_at DESC`.

No source file was touched by any mutation. The repo `git diff` stayed clean throughout.

## Decisions Made

- **Coordinates side table**: adopts research Open Question 6.
- **`place_attachments` audit**: a single UPDATE-arm trigger narrowed to status, with no insert/delete twin, as the plan specified.
- **`seedPlacesRun` default status**: `'running'`, because every Phase 4 definer requires queued/running and 04-18 seeds running runs.
- **`seedRunSearch` tile keys**: parsed from the key, which must be DB-safe.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] versioned-presets broke under `runs_one_active_per_org`**
- **Found during:** Task 3 (full `test:db`)
- **Issue:** "used by N runs is a live count, not a stored counter" inserted three default-status (`queued`) runs in one org. 0027's unique index refuses the second one with 23505.
- **Fix:** `makeRun` takes an optional `status` (default `'queued'`), and that test seeds the two extra runs as `'complete'`. The count assertion is unchanged.
- **Files modified:** tests/db/versioned-presets.test.ts
- **Commit:** 7921297

**2. [Rule 1 - Bug] U+0000 cannot reach Postgres `text`**
- **Found during:** Task 3 (the fixture smoke test)
- **Issue:** 04-RESEARCH Pattern 9 spells `cellKey = clusterKey + '\u0000' + unitId`. Inserting that into `run_searches.cell_key` fails with `22021 invalid byte sequence for encoding "UTF8": 0x00`.
- **Fix:** `seedRunSearch` writes the DB-safe form `clusterKey + '/' + unitId`, matching 04-05's `dbSafe`. It also refuses a tile key that contains U+0000.
- **Files modified:** tests/db/_places-fixtures.ts
- **Commit:** d68ce7d

**3. [Rule 2 - Missing proof] Extra tests beyond the plan's twelve**
- **Found during:** Tasks 2 and 3
- **grants-audit:** new test "the eight places tables hold exactly their 0027 grants" (table and column level, and the view).
  - `TENANT_TABLES` only checks non-DML privileges, so nothing else proved the SELECT-only grants or the empty grant on coordinates.
  - This is the test that catches the column-level variant of M37.
- **places-schema:** a smoke test for `seedRunSearch`, which none of the twelve proofs exercise. It is the test that found deviation 2.
- **Commits:** 011fb25, d68ce7d

---

**Total deviations:** 3 auto-fixed (2 Rule 1, 1 Rule 2). **Impact:** no scope creep. Both bugs would otherwise have surfaced in later plans.

## Planning content edits (orchestrator: preserve at merge)

- `.planning/REQUIREMENTS.md` L36 (PLACE-02 text only; the checkbox and traceability row are untouched): "System persists only `place_id` (indefinite), lat/lng (30-day TTL, enforced), and derived signals per business — a `had_website_uri` boolean, a host class computed from `websiteUri` at call time (`none | business_site_dead | social | directory | platform_subdomain | other`; the URL itself is discarded), and the `pureServiceAreaBusiness` flag; every other Places field is discarded after the call (amended by 04-CONTEXT D-09/D-13)"
- `.planning/ROADMAP.md` L192 (Phase 4 success criterion 2 text only; no progress table or plan checkbox was touched): "… and derived signals — the `had_website_uri` boolean, its host class (the URL itself discarded at call time), and the service-area flag — …"
- `.planning/CONVENTIONS.md` § Retention: one new paragraph, "Places observations (Phase 4, drizzle/0026 + 0027; D-09, D-10, D-12, D-13)". It covers:
  - append-only observations;
  - grant-less `place_coordinates` with `expires_at ≤ observed_at + 30 days`;
  - the purge deletes coordinates and never an observation;
  - no `google_places` `source_records`, and no Places column or provenance pair on `businesses`.

## Notes for downstream plans / merge

- **04-11:** `siteless_cron` exists with no privileges beyond membership in `app_user`. 04-11 must still grant `usage on schema app` and execute on the purge, as its plan says. `actAsRole(c, 'siteless_cron')` is already allow-listed.
- **04-26 (queue-run):** `src/server/actions/queue-run.ts` now hits `23505 runs_one_active_per_org` when an org queues a second run while one is active. Nothing in the current suite exercises that path. 04-26 owns the copy and handling.
- **04-30 (prod migration):** the data fix fails only **queued** rows older than 15 minutes. Before applying 0027, pre-flight production with this read: `select org_id, count(*) from runs where status = 'running' or (status = 'queued' and created_at >= now() - interval '15 minutes') group by 1 having count(*) > 1`. Any row it returns would make `runs_one_active_per_org` fail on apply. The 03-21 SUMMARY records only queued Phase 2 runs.
- **04-05 / 04-13 / 04-15:** every key written to the database must be DB-safe (no U+0000). This has been verified: Postgres refuses NUL with 22021.
- **Other worktrees in this wave:** the shared local DB now has 29 public tables. A worktree whose `grants-audit` still lists 21 will see "authenticated holds no TRUNCATE…" go red on the live-catalog set-equality check until it merges this plan. Its `versioned-presets` "used by N runs" will also go red until it merges 7921297.

## Known Stubs

None. The fixture `features` jsonb (`{"rule":"fixture","nameSim":1}`) is test data only.

## Threat Flags

None beyond the plan's threat model. The `siteless_cron` role is T-4-07 and is already registered.

## TDD Gate Compliance

Task 3 is `tdd="true"`, but its subject (the schema) was built in Tasks 1–2, so the tests passed on first run. The RED gate was therefore proven by live-DB mutation rather than by a pre-implementation commit: every refusal was watched red by name (table above), then reverted. There is a `test(04-09)` commit (d68ce7d). The `feat(04-09)` commits precede it by design of the plan's task order.

## Self-Check: PASSED

- All 14 created files exist on disk.
- Commits 54b7be5, 011fb25, 7921297, d68ce7d and fc774f6 are present in `git log`.

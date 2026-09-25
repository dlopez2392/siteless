---
phase: 04-places-transient-verifier
plan: 11
subsystem: database
tags: [postgres, plpgsql, security_definer, grants, retention, budget, places, cron]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-09: run_searches, place_tiles, place_coordinates, place_purge_runs, place_tile_members, place_attachments; siteless_cron role (no privileges)"
  - phase: 02-search-presets-budget
    provides: cost_reservations, budget_periods, cost_ledger, app.reserve_budget, app.settle_reservation
provides:
  - "app.release_reservation(uuid) returns bigint — frees an unsettled hold, no ledger row, idempotent, tenancy-checked"
  - "app.plan_run_searches(uuid, jsonb) returns table (search_id uuid, tile_key text) — idempotent per (run, tile_key)"
  - "app.mark_run_search(uuid, jsonb) returns void — allow-listed progress keys; status done updates the tile"
  - "app.purge_expired_place_coordinates(text default 'cron') returns table (purged_org uuid, purged_rows int) — siteless_cron only"
  - "app.places_transient_stats() returns table (place_ids_held bigint, coordinates_held bigint, oldest_coordinate_ms text, expired_awaiting_purge bigint, last_purge_ms text, last_rows_purged int)"
  - "src/db/with-cron-role.ts: withCronRole(fn)"
  - "tests/db/places-definers.test.ts: 19 named DB proofs"
affects: [04-15, 04-16, 04-17, 04-18, 04-19, 04-20, 04-22, 04-28, 04-30, 04-32]

tech-stack:
  added: []
  patterns:
    - "Cross-org definer gated by a dedicated NOLOGIN role: execute revoked from public/anon/authenticated/service_role by name, granted to siteless_cron only"
    - "Explicit release without ledger: conditional UPDATE on both timestamps + get diagnostics row_count before the balance moves"
    - "jsonb key allow-list in a definer (22023 on any other key, key not echoed)"
    - "#variable_conflict use_column + `on conflict on constraint <name>` in a RETURNS TABLE function whose OUT name shadows a column"

key-files:
  created:
    - drizzle/0028_places_meter_retention.sql
    - drizzle/meta/0028_snapshot.json
    - src/db/with-cron-role.ts
    - tests/db/places-definers.test.ts
  modified:
    - drizzle/meta/_journal.json
    - .planning/CONVENTIONS.md

key-decisions:
  - "release_reservation keeps settle_reservation's two refusals (22023 missing, 42501 foreign) as the plan specifies; plan_run_searches and mark_run_search use one 42501 message for foreign-or-missing (0020 precedent)"
  - "mark_run_search updates the tile whenever the call sets status 'done' (a replay re-stamps; harmless and self-consistent), not only on the transition"
  - "The purge's delete predicate (expires_at <= now()) is the exact complement of the stats' held predicate (expires_at > now())"

requirements-completed: [PLACE-02, PLACE-03]

duration: 25min
completed: 2026-09-23
---

# Phase 4 Plan 11: Places Meter Release and Retention Definers Summary

**Migration 0028 adds five SECURITY DEFINER functions:**
- **A release** that frees the admission hold without writing a phantom ledger row (M53).
- **Two writers** for the run-search progress tables.
- **A cross-org coordinate purge** that only `siteless_cron` can execute.
- **The `/sources` transient-stats function**, which reads coordinates without granting any read on them.

**Also added:**
- `withCronRole`, the one path that sets `siteless_cron`.
- 19 named DB proofs, checked with 14 mutations.

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-23T19:45Z
- **Completed:** 2026-09-23T20:10Z
- **Tasks:** 3, one commit each
- **Files:** 4 created, 2 modified

## Accomplishments

- **`drizzle/0028_places_meter_retention.sql`**:
  - Custom migration via `db:custom`, with 21 statement breakpoints.
  - All five functions are `security definer set search_path = public, pg_temp` (grep count = 5).
  - Each has one `comment on function`.
  - `cost_ledger` does not appear in the file.
  - Grants: the four tenant definers are revoked from `public, anon` and granted to `authenticated`. The purge is revoked from `public, anon, authenticated, service_role` and granted to `siteless_cron`, along with `grant usage on schema app to siteless_cron`.
  - Catalog after apply:
    - Tenant definers: `authenticated` true, `anon` false, `service_role` true (the schema default, as with every other `app.*` definer).
    - Purge: only `siteless_cron` true. `app_user` is false because it is NOINHERIT; it must `set local role`.
- **`src/db/with-cron-role.ts`**: the plan's code verbatim, plus a doc comment. `set local role` is built from a module constant, never a parameter.
- **CONVENTIONS § Database access**: one new bullet (text below).
- **`tests/db/places-definers.test.ts`**: all 15 tests the plan names, plus 4 more (see Deviations).

## Task Commits

1. **Task 1: Migration 0028, applied locally:** `1b644fa` (feat)
2. **Task 2: withCronRole + CONVENTIONS bullet:** `9143d5a` (feat)
3. **Task 3: DB proofs:** `4b24584` (test)

## Local database

- `drizzle.__drizzle_migrations`: **28 before → 29 after**, applied with `npx tsx scripts/db.ts migrate --target=test`. The script re-set the local `app_user` password, as it always does.
- `db:generate` after the apply reports "No schema changes, nothing to migrate".
- No production command was run: no `db:migrate:prod` and no deploy.

## Gates (final tree, HEAD `4b24584` on `worktree-agent-abef86e826325bb31`)

- `npx tsc --noEmit`: exit 0
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0
- `npx vitest run tests/unit`: **59 files, 433 tests passed**, including `pg17-compat` 2/2
- Full `test:db` (`vitest run --config vitest.db.config.ts --pool=forks`): **32 files, 255 tests passed** in 121 s. That is 04-09's 236 plus these 19.
- `places-definers.test.ts` alone: 19/19. Every name in the plan's list passed (read by name):
  - `release_reservation frees the hold and writes no ledger row`
  - `… is idempotent`
  - `… refuses another org's reservation`
  - `… will not release a settled reservation`
  - `plan_run_searches is idempotent per tile`
  - `… refuses another org's run`
  - `… refuses an ids_only search on a sweep run`
  - `mark_run_search refuses an unknown key`
  - `mark_run_search done marks the tile swept and non-leaf when subdivided`
  - `the purge removes expired coordinates and keeps the observation`
  - `the purge refuses a tenant session`
  - `the purge refuses an unknown trigger`
  - `siteless_cron can read no tenant table`
  - `transient stats count only what the org holds`
  - `transient stats never report an expired coordinate as held`

## Mutation checks (RED gate)

Each mutation was applied to the **live local DB**, never to the file. The whole file ran after each one (19 tests), and the red names below were read from the verbose output. Each was reverted by replaying 0028; every statement in it is idempotent. After the reverts, a `prosrc`/privilege catalog read confirmed:
- every guard string is back;
- `has_function_privilege('authenticated', purge)` is false and `siteless_cron` is true;
- `siteless_cron` holds 0 table grants and no SELECT on `runs`;
- all 5 comments are present.

`git diff --stat -- drizzle src` was empty throughout.

| Mutation | Red (exact names, only these) |
|---|---|
| **M53**: release body replaced by `app.settle_reservation(hold, …, 0, 1, …)` | "release_reservation frees the hold and writes no ledger row" (1/19) |
| release: drop the `v_res_org is distinct from v_org` refusal | "release_reservation refuses another org's reservation" (1/19) |
| plan: run lookup without `and r.org_id = v_org` | "plan_run_searches refuses another org's run" (1/19) |
| plan: drop the kind-vs-run check | "plan_run_searches refuses an ids_only search on a sweep run" (1/19) |
| plan: drop `on conflict … do nothing` on run_searches | "plan_run_searches is idempotent per tile" (1/19) |
| mark: disable the key allow-list | "mark_run_search refuses an unknown key" (1/19) |
| mark: disable the `done` → tile update | "mark_run_search done marks the tile swept and non-leaf when subdivided" (1/19) |
| mark: in-flight reservation check without org/run | "mark_run_search refuses an in-flight reservation that is not this run's" (1/19) |
| **M38**: purge predicate inverted (`expires_at > now()`) | "the purge removes expired coordinates and keeps the observation" (1/19) |
| purge: drop the trigger check (the CHECK then answers 23514) | "the purge refuses an unknown trigger" (1/19) |
| **M39**: `grant execute on … purge … to authenticated` | "the purge refuses a tenant session", "only siteless_cron may execute the purge" (2/19) |
| `grant select on runs to siteless_cron` | "siteless_cron can read no tenant table" (1/19) |
| stats: held/oldest counted without `expires_at > now()` | "transient stats never report an expired coordinate as held" (1/19) |
| stats: coordinates not filtered by org | "transient stats count only what the org holds" (1/19) |

Under M53, the idempotent and settled tests stay green by design. Both return 0 through the early `settled/released` guard, which the mutation leaves intact. The ledger assertion in the first test is what separates a release from a settle, and it is the one that went red.

## Decisions Made

- **Two different refusal shapes, both as planned:**
  - `release_reservation` keeps `settle_reservation`'s two distinct refusals (22023 for missing, 42501 for foreign).
  - The run- and search-ownership checks use one message for foreign or missing, so the error cannot reveal which ids exist.
- **When `mark_run_search` updates the tile:** whenever the call sets `status: 'done'`, rather than only on the transition. A replay re-stamps `last_swept_at`/`last_checked_at` from the row's final state, which is harmless.
- **`mark_run_search` does not echo a refused key** in its error message, so no caller-supplied text reaches a log through it (T-4-10).
- **`plan_run_searches`** uses `#variable_conflict use_column` and `on conflict on constraint <name>`. Its OUT column `tile_key` has the same name as a table column, and plpgsql would otherwise report an ambiguous reference.

## Deviations from Plan

### Auto-added (Rule 2: missing proof)

**1. Four tests beyond the plan's fifteen**
- **Found during:** Task 3
- **Tests:**
  - "plan_run_searches gives a missing run the same refusal as a foreign one". The plan's must-have requires that no error reveals which run ids exist, and nothing else proved the missing-run branch.
  - "mark_run_search refuses an in-flight reservation that is not this run's". The plan's action specifies this 42501 refusal but names no test for it.
  - "mark_run_search clears the in-flight pair on a JSON null". 04-16's `settleOrRelease` depends on this behaviour.
  - "only siteless_cron may execute the purge". A catalog check covering anon, service_role and app_user. The attempt test only covers authenticated, so a `service_role` grant would otherwise pass silently.
- **Commit:** `4b24584`

### Process notes (not code deviations)

- **Commands used:** the `$PNPM db:*`/`test:db` launcher forms from the plan were replaced by the direct `npx tsx scripts/db.ts …` / `npx vitest …` equivalents, as the orchestrator's Windows notes require.
- **How the RED gate was proven:** by live-DB mutation (table above), not by running the tests before the migration existed. The migration had to be applied in Task 1, before Task 3's tests were written, and a pre-apply run would only have shown "function does not exist" for all 19.
- **Scratch SQL helpers:** these lived in the gitignored, eslint-ignored `coverage/` directory and were deleted before the SUMMARY. No scratch file was ever tracked.

**Total deviations:** 1 (Rule 2, tests only). **Impact:** none on scope. No production file beyond the plan's list was touched.

## Planning content edits (orchestrator: preserve at merge)

`.planning/CONVENTIONS.md` § Database access: one bullet added directly after "The single exception is `/api/health`'s `select 1` …":

> - Two further non-`withOrg` paths exist since Phase 4, each allow-listed and narrow: `withCronRole()` (`set local role siteless_cron`; execute on the purge function only) and `withWorkerOrg()` (04-16; claims `{o:{id}}` + `app.actor_id` GUC, no `sub`, no role claim, for workflow steps).

No other `.planning` file was edited, apart from this SUMMARY. STATE.md and ROADMAP.md are untouched.

## Notes for downstream plans / merge

- **04-30 (prod migration):**
  - Apply 0028 after 0026 and 0027.
  - Its pre-flight should also confirm that `siteless_cron` exists, since 0027 creates it and 0028's `grant usage on schema app to siteless_cron` fails without it.
  - Post-apply checks are listed in 04-30 L139–140. Locally they all hold: five `prosecdef = t`, and `has_function_privilege('authenticated','app.purge_expired_place_coordinates(text)','EXECUTE') = false`.
  - Also check `service_role` false on the purge. 0028 revokes it by name, but the Supabase default ACL grants it.
  - 0028 is pure DDL, grants and comments: no data change, no lock on large tables.
- **04-15 / 04-16 / 04-18 / 04-19:**
  - `mark_run_search` accepts ONLY `status, saturated, subdivided, truncated, truncated_why, inflight_reservation_id, inflight_request_id`. `pages_done`, `results_count`, `change_verdict`, `new_ids` and `gone_ids` are NOT writable through it, and must be written by `record_places_page` / `record_change_check` (04-15), or the allow-list must be widened in a later migration.
  - `truncated_why: null` keeps the previous value (coalesce). Only the in-flight pair is cleared by a JSON null.
- **04-16:** the in-flight reservation must carry `run_id` = the search's run. A hold reserved with a null run is refused (42501). Pass the run id to `reserve_budget` for every page.
- **04-17:** `withCronRole` sets no claims. The purge returns one row per org, zero-count rows included, so the cron route's summary should sum `purged_rows` rather than count rows.
- **04-22:** release the admission hold with `app.release_reservation(id)`. It returns the µUSD freed (bigint), or `0` if the hold was already settled or released.
- **Pre-existing hazard, not introduced here:** `settle_reservation` (0019) reads the reservation without a lock, and its `settled_at` update does not check `released_at`. A release racing a settle of the **same** reservation could therefore decrement `reserved_micro_usd` twice. The Pattern 6 flow never does this: the admission hold is only released, and page holds are only settled. The same race already exists with the 0018 self-heal. Worth a `for update` in `settle_reservation` if a later plan ever settles a hold that might be released.
- **Other worktrees in this wave:** the shared local DB now has the five 0028 functions and journal 29. Nothing in 0028 changes a table or a table grant, so no other plan's audit sees a difference.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-4-02, T-4-04, T-4-06, T-4-07 and T-4-10 are each mitigated and have a named, mutation-checked test.

## TDD Gate Compliance

Task 3 is `tdd="true"`, but its subject (the migration) was built and applied in Task 1 by the plan's own order, so the `feat` commits precede the `test(04-11)` commit (`4b24584`). The RED gate was proven by the 14 live-DB mutations in the table (12 function-body, 2 grant). The Task 3 commit message says "13"; the table is the count. Every refusal and behaviour test went red by name and then back to green.

## Self-Check: PASSED

- Files exist: `drizzle/0028_places_meter_retention.sql`, `drizzle/meta/0028_snapshot.json`, `src/db/with-cron-role.ts`, `tests/db/places-definers.test.ts`.
- Commits `1b644fa`, `9143d5a` and `4b24584` are present in `git log`.

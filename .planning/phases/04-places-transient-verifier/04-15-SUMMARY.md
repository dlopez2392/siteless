---
phase: 04-places-transient-verifier
plan: 15
subsystem: database
tags: [postgres, plpgsql, security_definer, check_constraint, places, legal, retention]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-03 HostClass; 04-06 MatchDecision/PlaceFeatures/decide; 04-09 the eight Places tables, pa_* CHECKs, log_event on place_attachments, business_place_signal; 04-11 mark_run_search (allow-list excludes pages_done/results_count/change_verdict/new_ids/gone_ids)"
provides:
  - "src/lib/places/page-record.ts: FEATURE_KEYS, PageRecord, PageRecordPlace, PageRecordItem, toPageRecord"
  - "app.places_features_ok(jsonb) + CHECK pa_features_numeric on place_attachments"
  - "app.record_places_page(p_search uuid, p_record jsonb) returns jsonb"
  - "app.record_change_check(p_search uuid, p_added jsonb, p_gone jsonb, p_verdict text, p_seen int) returns void"
  - "app.decide_place_attachment(p_attachment uuid, p_decision text) returns table (business_id uuid, place_id text, status text)"
  - "tests/db/places-writer.test.ts: 32 named DB proofs; tests/unit/page-record.test.ts: 4"
affects: [04-18, 04-19, 04-20, 04-21, 04-22, 04-28, 04-30]

tech-stack:
  added: []
  patterns:
    - "Table-level content guard: an immutable SQL predicate over jsonb_each backing a CHECK, so a regressed caller cannot store text even through a definer"
    - "Sticky upsert: ON CONFLICT DO UPDATE … WHERE <not decided>, then re-select the existing row when RETURNING is empty"
    - "Producer→consumer DB tests: every record built by the real TS producer chain, the one deliberate bypass mutates its output"
    - "Outcome rank upsert: ON CONFLICT DO UPDATE … WHERE rank(excluded) > rank(existing)"

key-files:
  created:
    - src/lib/places/page-record.ts
    - drizzle/0029_places_writers.sql
    - drizzle/meta/0029_snapshot.json
    - tests/unit/page-record.test.ts
    - tests/db/places-writer.test.ts
  modified:
    - drizzle/meta/_journal.json
    - tests/db/_places-fixtures.ts

key-decisions:
  - "record_places_page writes pages_done, results_count and clears the in-flight pair; record_change_check writes change_verdict, new_ids, gone_ids, results_count, pages_done — covering every key 04-11's mark_run_search allow-list excludes"
  - "record_places_page refuses an ids_only search (22023) and record_change_check an enterprise one — each search kind has exactly one writer"
  - "A replayed page never moves a done/stopped search back: status goes planned -> searching only"
  - "Place ids crossing into any writer must match ^[A-Za-z0-9_-]+$ and be <= 512 chars (22023) — the one Google value kept forever cannot carry text"
  - "Execute on all four functions: authenticated only; public, anon AND service_role revoked by name"

requirements-completed: [PLACE-02, PLACE-04, PLACE-05]

duration: 45min
completed: 2026-09-23
---

# Phase 4 Plan 15: Places Result Writers Summary

**What survives a Places call is now written by one validated TypeScript contract (`toPageRecord`) and three SECURITY DEFINER writers. A table CHECK refuses Places text in attachment features even when the application's own refusal is bypassed. Stickiness, ties, the 30-day coordinate TTL, the never-delete membership diff and the pending-only decisions are each proven by a named, mutation-checked DB test.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-09-23T20:05Z
- **Completed:** 2026-09-23T20:50Z
- **Tasks:** 3 (5 commits)
- **Files:** 5 created, 2 modified

## Accomplishments

- **`src/lib/places/page-record.ts`** (pure, no server import):
  - `FEATURE_KEYS` (13 keys).
  - `toPageRecord` rebuilds every place, match and features object key by key.
  - Features: an unknown key throws `toPageRecord: feature <key> is not allow-listed`. A wrong-typed value throws `toPageRecord: feature <key> is not a permitted value`. The value is never echoed.
  - Validates `hostClass`, and refuses a `hadWebsiteUri` that disagrees with it (`po_host_class_agrees`).
  - `lat`/`lng` are passed through only when both are finite; otherwise both are null.
  - An outside listing carries `matches: []`.
- **`drizzle/0029_places_writers.sql`** (custom, 11 statements), applied locally:
  - `app.places_features_ok`, and `pa_features_numeric` on `place_attachments`.
  - `app.record_places_page`, `app.record_change_check`, `app.decide_place_attachment`.
  - Grants and one comment per function.
- **`tests/db/places-writer.test.ts`**: 32 tests. These are the plan's 21, plus 11 more (see Deviations).

## The contract downstream plans call (04-18 / 04-19 / 04-20 / 04-21 / 04-28)

```ts
export const FEATURE_KEYS = ['name','phone','address','distance','cluster','nameSim','distanceM',
  'signals','rule','city','sab','listingPhone','listingLocation'] as const;
export type PageRecordPlace = { placeId: string; outOfArea: boolean; pureSab: boolean;
  hadWebsiteUri: boolean; hostClass: HostClass; lat: number | null; lng: number | null;
  matches: MatchDecision['matches'] };
export type PageRecord = { page: 1 | 2 | 3; sku: 'ts_enterprise' | 'ts_essentials';
  resultsSoFar: number; places: PageRecordPlace[] };
export type PageRecordItem = { decision: MatchDecision; pureSab: boolean; hadWebsiteUri: boolean;
  hostClass: HostClass; lat: number | null; lng: number | null };
export function toPageRecord(i: { page: 1 | 2 | 3; sku: PageRecord['sku']; resultsSoFar: number;
  items: PageRecordItem[] }): PageRecord;
```

```sql
app.record_places_page(p_search uuid, p_record jsonb) returns jsonb
  -- returns {"attached":n,"tentative":n,"unmatched":n,"outside":n} for THIS page
app.record_change_check(p_search uuid, p_added jsonb, p_gone jsonb, p_verdict text, p_seen int) returns void
app.decide_place_attachment(p_attachment uuid, p_decision text)
  returns table (business_id uuid, place_id text, status text)   -- decision: confirm | reject | detach
app.places_features_ok(f jsonb) returns boolean   -- immutable; backs pa_features_numeric
```

### SQLSTATEs

**`record_places_page`**
- **42501:**
  - no org;
  - `record_places_page: search belongs to another org or does not exist`;
  - `… business belongs to another org or does not exist`;
  - `… tie business belongs to another org or does not exist`.
- **22023:**
  - `… search is not an enterprise search`;
  - malformed record or place;
  - page not in 1..3;
  - an unknown sku;
  - a negative resultsSoFar;
  - `… placeId is not a place id`;
  - a match status or reason outside its enum.
- **23514 `pa_features_numeric`:** text in features.

**`record_change_check`**
- **42501:** `record_change_check: search belongs to another org or does not exist`.
- **22023:**
  - `… search is not an ids_only change check`;
  - `… unknown verdict`;
  - arrays malformed;
  - negative seen;
  - an id that is not a place id.

**`decide_place_attachment`**
- **22023:** `decide_place_attachment: decision must be confirm, reject or detach`.
- **42501:** `… attachment belongs to another org or does not exist`.
- **55000:** `… already decided`. Confirm and reject require `tentative`; detach requires `attached`.

## Task Commits

1. **Task 1 (TDD):** RED `e4913f2` (test), then GREEN `d0bacda` (feat).
2. **Task 2, migration 0029 applied locally, plus the fixture fix:** `eaf4b93` (feat).
3. **Task 3 finding, fixed in Task 2's migration:** `0e12d8e` (fix). It is the place-id regex bound.
4. **Task 3, DB proofs:** `5489b4d` (test).

## Local database

- `drizzle.__drizzle_migrations`: **29 before → 30 after**, via `npx tsx scripts/db.ts migrate --target=test`. The script re-set the local `app_user` password as usual.
- Pre-flight read before the apply: `place_attachments` held 0 rows, so the new CHECK validated trivially.
- `0e12d8e` changed two function bodies after the apply. They were replayed on the local DB with `create or replace` from the file. The journal stays at 30.
- After all mutations, every function's live `prosrc` was compared with the file's body: all four are **identical**. `pa_features_numeric` is present and validated. The ACLs are `{postgres=X, authenticated=X}` on all four.
- `db:generate` reports "No schema changes, nothing to migrate".
- **No production command was run**: no `db:migrate:prod` and no deploy.

## Gates (final tree, HEAD `5489b4d` on `worktree-agent-ad2a64a94720d98fa`)

- `npx tsc --noEmit`: exit 0
- `npx eslint src tests scripts`: exit 0. The `--ignore-pattern ".claude/**"` form was refused by the sandbox's command guard.
- `npx vitest run tests/unit`: **64 files, 479 tests passed**. This includes `page-record` 4/4 and `pg17-compat` 2/2.
- Full `test:db` (`npx vitest run --config vitest.db.config.ts --pool=forks`): **33 files, 287 tests passed** in 117 s, exit 0. That is 04-11's 255 plus these 32.
  - `places-definers`: 19/19, and `places-schema`: 13/13. Both were read by name after the fixture fix (see Deviation 1).
- **Every named test passed.** The plan's 21:
  - `record_places_page attaches, observes and records outcomes`
  - `a second page for the same place does not duplicate its observation`
  - `a rejected pair never re-attaches`
  - `a confirmed attachment is not re-scored by a later run`
  - `a tie writes two tentative rows naming each other`
  - `a tentative match is observed but not a signal`
  - `an outside listing is a member and an outcome, never an attachment`
  - `an unmatched listing keeps only its place id`
  - `record_places_page refuses another org's search`
  - `record_places_page refuses a business of another org`
  - `a merged business is never attached`
  - `place attachments refuse text in features`
  - `record_places_page refuses Places text in features`
  - `record_change_check inserts new members and marks gone ones`
  - `record_change_check never deletes a member`
  - `decide_place_attachment confirms a tentative listing`
  - `… rejects a tentative listing`
  - `… detaches an attached listing`
  - `… refuses a decided listing`
  - `… refuses another org's attachment`
  - `a listing decision writes one event`

  The 11 extra tests are listed under Deviation 4.
- `grep -c toPageRecord tests/db/places-writer.test.ts` = 7 (plan: ≥ 5).

## Mutation checks

### Live-DB mutations (26)

Each mutation was applied to the **live local DB**, never to a tracked file, using `create or replace` built from the 0029 statement with one literal replacement. The whole file was run after each one, and the red names below were read from verbose output. The original statement was then replayed. `git diff --stat` stayed clean throughout.

| Mutation | Red (exact names, only these) |
|---|---|
| **M40**: upsert `where … <> 'rejected' and … <> 'confirmed'` → `where true` | "a rejected pair never re-attaches", "a confirmed attachment is not re-scored by a later run" |
| search lookup without `s.org_id = v_org` | "record_places_page refuses another org's search" |
| business lookup without `b.org_id = v_org` | "record_places_page refuses a business of another org" |
| tie lookup without org | "record_places_page refuses a tie naming a business of another org" |
| merged skip disabled | "a merged business is never attached" |
| observation `on conflict … do nothing` removed | "a second page for the same place does not duplicate its observation" |
| TTL `interval '30 days'` → `'29 days'` | "record_places_page attaches, observes and records outcomes" |
| outcome rank guard made always-true | "record_places_page keeps the higher outcome rank across pages" |
| outOfArea branch disabled | "an outside listing is a member and an outcome, never an attachment" |
| place-id shape check disabled | "record_places_page refuses a place id that is not a place id" |
| enterprise-kind check disabled | "record_places_page refuses an ids_only search" |
| `pages_done` not written | "…attaches, observes and records outcomes", "a second page … does not duplicate its observation" |
| matcher status ignored (always `attached`) | "a tie writes two tentative rows naming each other", "a tentative match is observed but not a signal" |
| change: the gone UPDATE → `delete from place_tile_members` | "record_change_check inserts new members and marks gone ones", "record_change_check never deletes a member" |
| change: `changed_at` always set | "record_change_check never deletes a member" (its `unchanged` half) |
| change: search lookup without org | "record_change_check refuses another org's search" |
| change: verdict check disabled | "record_change_check refuses an unknown verdict" |
| decide: confirm's `and a.status = 'tentative'` removed | "decide_place_attachment refuses a decided listing" |
| decide: reject's `and a.status = 'tentative'` removed | "decide_place_attachment will not reject an attached listing" |
| decide: detach's `and a.status = 'attached'` removed | "decide_place_attachment will not detach a tentative listing" |
| decide: lookup without org | "decide_place_attachment refuses another org's attachment" |
| decide: `decided_by = 'system'` | the confirm, reject and detach tests (3) |
| decide: decision enum check disabled | "decide_place_attachment refuses an unknown decision" |
| **M36**: `drop constraint pa_features_numeric` | "place attachments refuse text in features", "record_places_page refuses Places text in features" |
| `grant execute on record_places_page to anon` | "only authenticated may execute the Places writers" |
| `grant execute on places_features_ok to public` | "only authenticated may execute the Places writers" |

**The detach guard first survived.** Removing it left the suite green, because no test detached a non-attached listing. That is how "will not detach a tentative listing" and "will not reject an attached listing" came to exist. Each was then watched red under its own branch's mutation.

### Unit mutations (2)

| Mutation | Red |
|---|---|
| `toPageRecord` allow-list disabled (unknown key silently copied) | "page record drops feature keys outside the allow-list" (1/4) |
| score-key numeric check removed | "page record refuses a non-numeric feature value" (1/4) |

The Task 3 commit message says "27 live-DB mutations". The table is the count: 26 on the DB and 2 in unit.

## Decisions Made

- **Coverage of 04-11's handoff, so no deviation was needed for it:**
  - `pages_done`, `results_count` and the in-flight clear are written by `record_places_page`.
  - `change_verdict`, `new_ids`, `gone_ids`, `results_count` and `pages_done` are written by `record_change_check`.
- **Each search kind has exactly one writer:** `record_places_page` refuses `ids_only` and `record_change_check` refuses `enterprise`, both with 22023.
- **A replayed page cannot un-finish a search:** `status` moves `planned → searching` only; `done` and `stopped` stay.
- **Sticky confirmed attachments are still OBSERVED by later runs.** Their status is `attached`, so a fresh observation (website boolean, host class) is appended. Only the attachment row is frozen. This keeps a confirmed listing's website signal current.
- **Match status/reason** are validated in the definer (22023) as well as by the CHECK. A matcher must never write `rejected` through the page writer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The shared fixture wrote text into `features`**
- **Found during:** Task 2. This was pre-empted before the full lane ran. The orchestrator separately observed the 12 reds, from a run against the new CHECK with the old fixture.
- **Issue:** 04-09's `seedAttachmentWithObservation` wrote `features: {"rule":"fixture","nameSim":1}`. `'fixture'` is not a rule, so `pa_features_numeric` refuses it with 23514. That broke 3 `places-definers` and 9 `places-schema` tests.
- **Fix:** the fixture now writes `{"name":30,"nameSim":1}`, with a comment explaining why. The check was not weakened.
- **Files:** tests/db/_places-fixtures.ts
- **Commit:** eaf4b93
- **Verified:** full lane green, and all 19 `places-definers` + 13 `places-schema` names read.

**2. [Rule 1 - Bug] Postgres refuses a regex repetition bound over 255**
- **Found during:** Task 3. The first run failed 16 tests with `2201B invalid regular expression` from `{1,512}`.
- **Fix:** `length(x) > 512 or x !~ '^[A-Za-z0-9_-]+$'` in both writers. Replayed locally.
- **Commit:** 0e12d8e

**3. [Rule 2 - Missing critical] Guards beyond the plan's text in 0029**
- The tie business is re-read under the org (42501, T-4-06). Without this, a foreign uuid passes the FK.
- Place ids must match `^[A-Za-z0-9_-]+$` and be ≤ 512 characters (22023). This covers both writers and closes "text smuggled as an id" (T-4-05).
- `record_places_page` refuses an `ids_only` search.
- Contract keys are type-checked with `jsonb_typeof` before any cast (T-4-10).
- `status` is only advanced from `planned`.
- `service_role` execute is revoked by name. 0024/0028 leave it granted; the orchestrator's rule here is to name it.
- `toPageRecord` also validates `hostClass` and its agreement with `hadWebsiteUri`, plus score, status and reason.
- **Commits:** eaf4b93, d0bacda

**4. [Rule 2 - Missing proof] 11 tests beyond the plan's 21**
- `record_places_page keeps the higher outcome rank across pages`
- `… refuses a tie naming a business of another org`
- `… refuses an ids_only search`
- `… refuses a place id that is not a place id`
- `record_change_check refuses another org's search`
- `… refuses an unknown verdict`
- `… refuses an enterprise search`
- `decide_place_attachment will not detach a tentative listing`
- `… will not reject an attached listing`
- `… refuses an unknown decision`
- `only authenticated may execute the Places writers`

Each one kills a mutation that nothing else did.
- **Commit:** 5489b4d

### Process notes

- **Commands:** `$PNPM db:*` / `test:*` were replaced by direct `npx tsx scripts/db.ts …` / `npx vitest …` per the Windows notes.
- **Scratch helpers:** the statement replayer and the mutation loop lived in the gitignored, eslint-ignored `coverage/`. They were deleted before this SUMMARY.
- `drizzle/0029_places_writers.sql` is CRLF in this working copy after a `git checkout --` restore. Git normalises it on commit.

**Total deviations:** 4 (2 Rule 1, 2 Rule 2). **Impact:** no scope creep. Every addition is a guard or a proof on the plan's own files, plus the one shared fixture line.

## Notes for downstream plans / merge

- **Other worktrees in this wave (04-14, 04-16, 04-17):** the shared local DB now carries `pa_features_numeric`, and the journal is at 30. A worktree whose `_places-fixtures.ts` still writes `rule: 'fixture'` will see 12 reds in `places-definers`/`places-schema`, each 23514 `pa_features_numeric`, until it merges `eaf4b93`. The reds are expected and resolve at merge.
- **04-18:**
  - Build `hadWebsiteUri` as `hc !== 'none'`. `toPageRecord` throws on disagreement.
  - Pass `lat`/`lng` from `pfm`, which is null for SABs.
  - `record_places_page` needs an **enterprise** search.
  - It clears the in-flight pair itself, so do not also call `mark_run_search` with nulls after a recorded page.
  - M36's plan-mutation ("copy `p.displayName?.text` into a feature") is refused by `toPageRecord` with `feature <key> is not allow-listed` when the key is new. It is refused with `… is not a permitted value` when it overwrites a numeric key.
- **04-19:** call `record_change_check` on an **ids_only** search. Ids must be `[A-Za-z0-9_-]+`, which 04-10's synthetic fixtures satisfy.
  - An anonymized recording must keep that alphabet. `places/…`-style resource names would be refused.
- **04-21:** `decide_place_attachment` returns the row, or raises 55000 when the listing is not in the from-state:
  - confirm and reject require `tentative`;
  - detach requires `attached`.
  - Confirming one side of a tie does NOT touch the other tie row. That is left to the UI or a later plan.
- **04-20 / 04-28:** seed through `toPageRecord` + `record_places_page`. Counts come back per page, not per run.
- **04-30 (prod migration):**
  - Apply 0029 after 0028.
  - **Pre-flight read:** `select count(*) from place_attachments where not app.places_features_ok(features)` cannot run before the function exists. Instead, use `select count(*) from place_attachments`. The table has been empty since 0026 in prod (prod holds zero businesses), and the `add constraint` validates existing rows.
  - **Post-apply checks:**
    - four functions; three with `prosecdef = t` (`places_features_ok` is an invoker SQL function);
    - `has_function_privilege` true for `authenticated`, and false for `anon` and `service_role`, on all four;
    - `pa_features_numeric` present.
  - 0029 is DDL, grants and comments only. The `add constraint` scans `place_attachments`, which is empty in prod.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-4-04, T-4-05, T-4-06 and T-4-10 are each mitigated and have named, mutation-checked tests. The place-id shape check and the tie re-read tighten T-4-05 and T-4-06.

## TDD Gate Compliance

- **Task 1:** RED `e4913f2` (the module was missing, so the suite failed) came before GREEN `d0bacda`. No refactor was needed.
- **Task 3:** its subject was built in Task 2 by the plan's order, so the `test(04-15)` commit `5489b4d` follows the `feat` commits. The RED gate was proven by the 26 live-DB mutations above, each watched red by name and reverted.

## Self-Check: PASSED

- All 5 created files and both modified files exist on disk.
- Commits `e4913f2`, `d0bacda`, `eaf4b93`, `0e12d8e` and `5489b4d` are present in `git log`.

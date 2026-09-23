---
phase: 03-free-data-spine-entity-resolution
plan: 09
subsystem: ingest
tags: [etl, idempotency, payload-hash, emit-event, rls, external-key, criterion-5, postgres]
requires:
  - phase: 03-05
    provides: "ingest_runs, source_records_ext_uniq (partial), businesses_external_key_uniq + shape CHECK, SQL_FRESH_EXTERNAL_KEY"
  - phase: 03-06
    provides: "nameNorm / addressKey / phoneE164 normalizers"
  - phase: 03-02
    provides: "newExternalKey + EXTERNAL_KEY_PATTERN"
provides:
  - "src/lib/ingest/etl-actor.ts — setEtlActor + resolveEtlOrg: the desk tier's org context (transaction-local {o:{id}} claim, no sub, no o.rol, no role switch), EtlExecutor interface, EtlOrgRequiredError / EtlOrgNotFoundError"
  - "src/lib/ingest/upsert.ts — canonicalPayloadHash, upsertSourceRecord (idempotent by external id), upsertBusinessFromSource (hash-diff-gated business write, 5-attempt external-key retry), BusinessDerived"
  - "src/lib/ingest/run-report.ts — startRun / countGone / finishRun (exactly one app.emit_event per run), emptyTally / recordOutcome, IngestSourceKey"
  - "src/lib/instant.ts — instantOf / requireInstant moved out of the server-only budget module (re-exported there)"
  - "tests/db/_ingest-fixtures.ts — asEtlExecutor, COMPTROLLER_FIXTURE, OVERTURE_FIXTURE (Texas + Mexican side), isTexasSide, seedComptrollerFixture, seedOvertureFixture, seedCandidatePair, seedIngestRun, runFixtureIngest"
affects: [03-11, 03-12, 03-13, 03-14, 03-10, 03-15, 03-20, 03-22]
tech-stack:
  added: []
  patterns:
    - "Desk-script DB tests: owner connection, NO actAs, setEtlActor + resolveEtlOrg in the transaction — the connection shape the ETL really has"
    - "Previous-row state for ON CONFLICT via a `prev` CTE (pre-statement snapshot), never `excluded` in RETURNING and never PG18-only `returning old.*`"
    - "Partial-unique-index upsert target spells the index predicate: `on conflict (...) where external_id is not null`"
    - "'Not written' inside one transaction is proven by ctid, not updated_at (now() is the transaction start)"
key-files:
  created:
    - src/lib/ingest/etl-actor.ts
    - src/lib/ingest/upsert.ts
    - src/lib/ingest/run-report.ts
    - src/lib/instant.ts
    - tests/db/_ingest-fixtures.ts
    - tests/db/ingest-idempotency.test.ts
    - tests/db/external-key.test.ts
    - tests/db/texas-side.test.ts
  modified:
    - src/server/queries/budget.ts
key-decisions:
  - "resolveEtlOrg installs a transaction-local request.jwt.claims of exactly {o:{id}} — no sub (the run stays attributed etl:<script>), no o.rol (org context, not admin), no set role (stays owner, D-01). A p_org_id definer parameter was rejected in the file header (T-3-08)"
  - "upsertSourceRecord's conflict target carries `where external_id is not null` (the index is partial; without it PG refuses with 42P10) and reads the previous hash from a `prev` CTE (excluded is not in scope in RETURNING: 42P01)"
  - "startRun stamps started_at = date_trunc('milliseconds', clock_timestamp()), not now(): two runs in one transaction would otherwise share an instant and countGone could never see a row go missing; the returned Date is exactly the stored value, and is the seenAt every upsert of the run writes"
  - "finishRun's event action is the run's final status ('complete' for every successful run); a failed run is not recorded as 'complete'"
  - "The ingest executor is a narrow pg-style { query(text, params) } interface (the desk scripts connect like scripts/seed.ts); the tests drive the shipped helpers through asEtlExecutor"
  - "instantOf/requireInstant moved verbatim to src/lib/instant.ts rather than written a third time: budget.ts imports server-only and builds the app db client at import, which a tsx desk script cannot load"
requirements-completed: [DATA-04, DEDUP-03]
metrics:
  duration: 15min
  started: 2026-09-23T01:41:53Z
  completed: 2026-09-23T01:56:13Z
  tasks: 3
  files: 9
---

# Phase 3 Plan 09: Shared ingest write path, ETL org context, DATA-04 + criterion 5 proofs Summary

**Both desk ingests now have one shared write path. It is idempotent by external id, and one `payload_hash` diff gates both the `source_records` write and the `businesses` write, so a re-run with nothing changed writes zero `businesses` rows and zero events. The ETL tier also gets org context without Clerk claims. `resolveEtlOrg` installs a transaction-local `{o:{id}}` claim so that `app.emit_event` stops raising `42501` on the first desk run. Everything is proven on the live local database from the real desk-script connection shape.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-23T01:41:53Z
- **Completed:** 2026-09-23T01:56:13Z
- **Tasks:** 3
- **Files:** 8 created, 1 modified

## Accomplishments

- `etl-actor.ts` closes the org-context defect. An owner connection with no Clerk claims can now emit a run-level event, and the event is attributed `etl:<script>`. The claim carries no `sub` and no `o.rol` (T-3-02, T-3-15). The helper throws a named error rather than pick an org (T-3-01).
- `upsert.ts`: the idempotent `source_records` upsert, plus a business write that returns without writing when the payload is unchanged and the business already exists. On insert it draws an external key and retries up to 5 times.
- `run-report.ts`: `startRun` → `countGone` (a report line only, nothing deleted or status-changed) → `finishRun` with exactly one `app.emit_event`.
- DATA-04's four properties, the external key's three guarantees and criterion 5 are all proven by name on the live local DB, each with a positive control.

## Task Commits

1. **Task 1: src/lib/ingest: upsert, business write, ETL actor, run report.** Commit `6050798` (feat)
2. **Task 2: `_ingest-fixtures.ts` and the DATA-04 proofs.** Commit `f514b2c` (test)
3. **Task 3: `external-key.test.ts` and `texas-side.test.ts`.** Commit `1525d10` (test)

## How the ETL no-claims path is proven

`tests/db/ingest-idempotency.test.ts` has **no `actAs` anywhere**. Every test connects the way the desk scripts will:

- the owner connection
- `setEtlActor` + `resolveEtlOrg` called through `asEtlExecutor(c)`, so the tests run the shipped helper, not a re-typed copy of its SQL
- no Clerk claims and no `set role`

`emit_event succeeds from an owner connection with no claims` first asserts the shape it depends on. It checks that `request.jwt.claims` is unset and that `current_user` is not `authenticated` before calling the helper. `resolveEtlOrg installs org context, not admin and not a user` then pins the installed claim:

- the claim is exactly `{"o":{"id":"org_A"}}`
- `app.current_org_role()` is NULL
- `app.jwt()->>'sub'` is NULL
- the actor is `etl:ingest-overture`
- the connection is still the owner

**RED, watched first.** `resolveEtlOrg` was made to return before installing the claim, so it set only `app.actor_id`. Verbatim output:

```
 × ... > the ETL tier has org context without Clerk claims > emit_event succeeds from an owner connection with no claims 81ms
   → emit_event: no current org
 FAIL  tests/db/ingest-idempotency.test.ts > DATA-04: the ingest write path > re-run is idempotent
error: emit_event: no current org
Serialized Error: { length: 160, severity: 'ERROR', code: '42501', ... where: 'PL/pgSQL function app.emit_event(text,uuid,text,jsonb) line 9 at RAISE', ... routine: 'exec_stmt_raise' }
      Tests  7 failed | 2 passed (9)
```

**Verification mutation.** The `set_config('request.jwt.claims', …, true)` statement was deleted from `resolveEtlOrg`. The result was 7/9 red, each reading `→ emit_event: no current org` (42501):

- all five DATA-04 tests, because each ends in `finishRun`
- `emit_event succeeds…`
- the claim-shape test

The two tests that stayed green are the negative control (`…refuses an owner connection that skipped resolveEtlOrg`) and `…refuses a missing or unknown org`. Under the same mutation, the existing `actAs`-based `tests/db/events-append-only.test.ts` › `positive control: app.emit_event writes and stamps the actor itself` stayed **green (4/4)**. That is the masking this plan exists to close. The helper was restored from a backup and `git diff --stat` came back empty.

## Mutation checks (all reverted; revert verified)

| Mutation | Result, by test name | Revert check |
|---|---|---|
| RED probe: `resolveEtlOrg` returns before the claim | 7 red, 42501 `emit_event: no current org` (above) | `git diff --stat` empty |
| Claim statement deleted (plan § verification) | Same 7 red. Actas-based `events-append-only` stays 4/4 green | `git diff --stat` empty |
| **M20 literal**: `payload_hash` added to the conflict target | **All 5 DATA-04 tests red** with `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`, `payload hash diff` included | `git diff --stat` empty |
| **M20 as behaviour**: the businesses-write gate deleted | `re-run is idempotent` red (`expected 24 to be 12` businesses events) and `payload hash diff` red (`expected 24 to be 13`). `gone is not a delete`, `one run-level event` and `two zones` green | `git diff` of upsert.ts empty |
| **M17**: `drop index businesses_external_key_uniq` on the live local DB | `external key is unique per org` red (`promise resolved … instead of rejecting`). The shape-CHECK tests (`refuses the ambiguous glyphs`, `refuses lowercase`), the positive control and `is not a FK` stay green. **Also red** with 42P10: every test that inserts a business through the shipped path (both retry tests, the five DATA-04 tests, the texas-side search) | Recreated, then read back from `pg_indexes`: `CREATE UNIQUE INDEX businesses_external_key_uniq ON public.businesses USING btree (org_id, external_key)`, identical to the pre-drop capture |
| **M23 analog**: `isTexasSide` → `row.region === 'TX'` | `a naive-RGV-bbox radius search returns no Mexican-side row` red. It first fails on the skipped-count guard (`expected 10 to be 11`). With that guard neutralised, the core assertion fails on `{"city":"Reynosa","display_name":"Carnicería La Frontera"}`, the country=MX/region=TX row | Fixture and test restored from backup; `git diff --stat` empty; both greps confirm the original lines |

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The plan's upsert SQL is refused by PostgreSQL in two ways.** Found during Task 1, measured on PG 18.6 before writing any code.
- (a) `source_records_ext_uniq` is a *partial* index, so `on conflict (org_id, source_key, external_id)` without `where external_id is not null` fails with `42P10`.
- (b) `excluded` is not in scope in RETURNING, so `returning (… is distinct from excluded.payload_hash)` fails with `42P01 invalid reference to FROM-clause entry for table "excluded"`.
- Fix: added the predicate to the conflict target, and read the previous hash from a `prev` CTE. PG18's `returning old.*` would have worked locally and broken on production 17.6.
- Files: `src/lib/ingest/upsert.ts`. Commit: `6050798`.

**2. [Rule 1 - Bug] With `started_at = now()`, `gone` could not be counted inside one transaction.** Found during Task 1.
- `now()` is the transaction start, so two runs in one `withRollback` would share an instant.
- Fix: `date_trunc('milliseconds', clock_timestamp())`. The returned `Date` is the exact stored value and is the `seenAt` for the run.
- Commit: `6050798`.

**3. [Rule 3 - Blocking] `requireInstant`/`instantOf` could not be imported from `budget.ts`.** Found during Task 1.
- That module opens with `import 'server-only'` and builds the app db client at import time, so a tsx desk script cannot load it.
- Fix: moved both functions verbatim to `src/lib/instant.ts`; `budget.ts` re-exports them, so no import changed. This was a move, not a third copy.
- Files: `src/lib/instant.ts`, `src/server/queries/budget.ts`. Commit: `6050798`.

**4. [Rule 1 - Bug] My own header comment was wrong.** Found by the M20 run in Task 2.
- The comment claimed that deleting the gate would leave `payload hash diff` green. It goes red, because that test pins exactly one new event.
- Fix: corrected the comment to the executed outcome.
- Commit: `f514b2c`.

### Deliberate choices within plan latitude

- **`finishRun`'s event action.** It is the final status. For a complete run this is `'complete'`, exactly as planned; a failed run is not labelled `'complete'`.
- **The executor interface.** It is `{ query(text, params) }` (pg-style), because the desk scripts connect like `scripts/seed.ts`. 03-12/13/14 should pass their `pg` client, or an equivalent adapter.
- **Why 'not written' is proven by `ctid`.** The idempotency test proves "no businesses row written" by `ctid` as well as `updated_at`. Inside one transaction `updated_at` cannot move: `touch_updated_at` stamps `now()`.
- **`seedOvertureFixture` runs a fixture-local filter.** It uses `isTexasSide` (`country==='US' && region==='TX'`) because the production Overture transform ships in 03-13, a later wave. **Handoff to 03-13:** switch the seeder to `overtureRowToSourceRecord` so that M23 applied to the transform reds both tests.
- **Extra named tests beyond the plan.**
  - `resolveEtlOrg installs org context, not admin and not a user` (T-3-15)
  - `resolveEtlOrg refuses a missing or unknown org and never picks one` (T-3-01)
  - `external key shape refuses lowercase`
  - the two collision-retry tests
  - `the fixture puts Mexican-side places inside the bbox and inside the radius`: a positive control on the fixture geometry, which also binds three arrays as single parameters.

### Expectations in 03-VALIDATION that cannot hold, measured

- **M20 literal ("payload hash diff stays green").** Adding `payload_hash` to the conflict target leaves no unique index for the target to match, so every upsert is refused with 42P10 and all five tests go red. The behaviour-level form (deleting the gate) is the discriminating mutation, and it reds the events-count tests by name.
- **M17 ("reds 'external key is unique per org' only").** The plan's own insert path is `on conflict (org_id, external_key) do nothing`, which needs that exact index. Dropping it reds every test that inserts a business through the shipped path (42P10). The shape-CHECK tests do stay green, as predicted.
- **The plan's `<verify>` filter.** `-t "no Mexican-side result"` would match no test: the acceptance-named test is `…returns no Mexican-side row`. That filter would therefore exit green while running nothing. All verification here used explicit files with `--reporter=verbose`, and the test names were read.

## Test counts

- `tests/db/ingest-idempotency.test.ts`: 9/9. `tests/db/external-key.test.ts`: 7/7. `tests/db/texas-side.test.ts`: 2/2.
- Full `test:db`: **19 files, 132 tests, all green**. Full `test:unit`: **26 files, 178 tests, all green**.
- `typecheck` 0, `lint` 0, `build` 0.
- After all runs the shared DB is unchanged: `orgs`=2, no `org_A`/`org_B` rows, `ingest_runs`=0, no fixture source records, and the index definition is intact.

## Issues Encountered

None blocking. The worktree sandbox refuses writes outside the worktree, so scratch logs and mutation backups lived under the gitignored `node_modules/.cache/03-09/`. None were committed.

## Known Stubs

None. `comptrollerIngestInput` / `overtureIngestInput` / `isTexasSide` are test-side stand-ins for the 03-12 and 03-13 transforms; they are documented as such in the fixture file and never ship.

## Next Phase Readiness

- 03-11 / 03-14 can call `setEtlActor(asEtlExecutor(c), 'resolve')` + `resolveEtlOrg(asEtlExecutor(c), 'org_A')` exactly as their plans specify. `app.record_merge` inherits the same org resolution.
- 03-12 / 03-13 must call both helpers in **every** batch transaction, and must pass `startRun().startedAt` as `seenAt` to every `upsertSourceRecord` of the run.

## Self-Check: PASSED

- All 8 created files and 1 modified file are present on disk.
- Commits `6050798`, `f514b2c` and `1525d10` are all present in `git log`.

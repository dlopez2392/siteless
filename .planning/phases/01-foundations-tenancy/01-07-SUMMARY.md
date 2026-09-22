---
phase: 01-foundations-tenancy
plan: 07
subsystem: database
tags: [postgres, drizzle, retention, google-places, compliance, rls, check-constraint, foreign-key, mutation-testing]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 05)
    provides: 'src/db/schema/_helpers.ts (orgScoped, orgPolicies, tstz), businesses table, app.current_org_id(), the D-10 schema-audit enumeration, tests/db/_fixtures.ts usage patterns'
  - phase: 01-foundations-tenancy (plan 06)
    provides: 'src/lib/export/public-business.ts BusinessLike — the structural fixture shape this plan bridges to the real Drizzle row type'
provides:
  - 'source_records — the retention-class table where the Google Maps Platform Terms live in the schema; org-scoped, RLS-enabled and four-policied from the migration that creates it'
  - 'sr_google_is_ephemeral — Google Places content marked durable is refused 23514 by the database, not by a code review (criterion 3)'
  - 'sr_ephemeral_has_expiry — an equivalence CHECK: ephemeral means a TTL and durable means none; both directions refuse 23514'
  - 'sr_durable_uniq + businesses_{legal_name,display_name,phone}_src_fk — the composite-FK "durable cites durable" invariant; a durable field citing an ephemeral source is refused 23503 and the column simply stays NULL'
  - 'businesses.{legal_name,display_name,phone}_source_id + _src_ret GENERATED ALWAYS AS (durable) STORED — the provenance column contract Phases 3, 4 and 5 write to'
  - 'sr_expiry partial index on expires_at — Phase 4 purge job support, TTL 21 days not 30'
  - 'tests/db/retention.test.ts — six tests pinning 23514 x3 / 23503 x1 with constraint NAMES, plus a positive control and an index assertion'
  - 'businessLikeBridge — the compile-time assertion tying the FOUND-04 sentinel fixture to the real row type; renaming a column now fails tsc'
affects: [01-08-clerk-shell, 01-09-events, 01-10-prod-migrate, phase-03-entity-resolution, phase-04-places-verifier, phase-05-scoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'A legal constraint is expressed as a database constraint or it does not exist: retention_class + two CHECKs + a composite FK, never a convention in a code review'
    - 'A generated column (GENERATED ALWAYS AS (durable) STORED) as the second leg of a composite FK makes the retention class part of the reference itself'
    - 'A new table ships with org_id, its index, RLS and all four orgPolicies in the SAME migration that creates it — never un-scoped for even one commit'
    - 'Every SQLSTATE pin carries the constraint NAME: the name is what a future migration can rename out from under the test'
    - 'Every refusal test is paired with a positive control, and the mutation check asserts the control stays GREEN — that is what tells a working guard from one that refuses everything (01-05 M1)'
    - 'Constraints that drizzle-kit does not diff are written through generate --custom, so drizzle-kit stays the single migration authority (D-09)'

key-files:
  created:
    - src/db/schema/source-records.ts
    - drizzle/0005_retention.sql
    - drizzle/0006_retention_constraints.sql
    - drizzle/meta/0005_snapshot.json
    - drizzle/meta/0006_snapshot.json
    - tests/db/retention.test.ts
  modified:
    - src/db/schema/businesses.ts
    - src/db/schema/index.ts
    - drizzle/meta/_journal.json

key-decisions:
  - 'Assumption A4 HELD. drizzle-kit 0.31.10 emitted all three provenance twins as `GENERATED ALWAYS AS (durable) STORED` in 0005 without confusing its differ, so the fallback (moving those ALTER TABLE ADD COLUMN statements into 0006) was not needed and 0006 contains constraints only.'
  - "The test file header does not spell the RLS/grant SQLSTATE, because one of the plan's own acceptance criteria is `grep -c \"42501\" tests/db/retention.test.ts` returning 0 while the plan's prescribed header text contains that token twice. Reworded per 01-06's precedent: a comment naming the thing it forbids trips the guard it describes."
  - "The positive control is its own `it(` block rather than a second withRollback inside the FK test, so that the FK mutation reds exactly ONE test name. Sharing a test between a refusal and its control is the coupling that made 01-05's M1 red two tests."
  - 'The plan listed `-t "ephemeral"` as the filter for the ephemeral-TTL test, but that filter matches two tests and NOT the third CHECK case (`a durable source record with an expires_at is refused`, whose name contains no "ephemeral"). A fifth filtered red run was added for that test by its full name — a filter that silently covers a different set than intended is the same failure mode as one matching nothing.'
  - '0006 carries 6 `--> statement-breakpoint` markers for its 7 statements (one between each), matching the plan’s own SQL block; the acceptance criterion’s "at least 7" would require a trailing marker after the final statement, which emits an empty statement. Every statement applied — verified by 6 rows in pg_constraint and 1 in pg_indexes.'

patterns-established:
  - 'A mutation on the live database (never on the migration file) makes the revert provable: `git diff --stat` is empty by construction, and the restore is verified from pg_constraint / pg_get_constraintdef rather than from the fact that a script ran.'
  - 'Before trusting a compile-time bridge, mutate it: renaming displayName in the Drizzle schema must fail tsc (TS2344). An assertion that cannot fail is documentation, not a guard.'
  - 'Read the failing test NAME on every filtered run, and read the PASS list too — the tests that were green in the red state (the positive control) are as load-bearing as the reds.'

requirements-completed: [FOUND-05, FOUND-01, FOUND-04]

# Metrics
duration: 13 min
completed: 2026-09-22
---

# Phase 01 Plan 07: Places Retention as a Database Constraint Summary

**`source_records` with a `retention_class`, two CHECKs and a composite foreign key over a `GENERATED ALWAYS AS ('durable') STORED` column — so Google Places content in a durable field is refused by PostgreSQL with `23514`/`23503`, proven by five tests watched failing first and two mutations that each red exactly one named test while the positive control stays green.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-09-22T02:47:28Z
- **Completed:** 2026-09-22T03:00:30Z
- **Tasks:** 3 of 3
- **Files created:** 6 (3 modified)

## Accomplishments

- **Criterion 3 is now a property of the database.** `insert into source_records (…, 'google_places', 'durable', null)` raises `23514` on `sr_google_is_ephemeral`. There is no code path, no reviewer and no convention involved — the row cannot exist.
- **The TTL is not optional in either direction.** `sr_ephemeral_has_expiry` is an equivalence, so an ephemeral record without `expires_at` **and** a durable record carrying one both raise `23514`. The first would live forever past its purge window; the second would be purged out from under the fields citing it.
- **"A durable field cites a durable source" is enforced by referential integrity.** `businesses.phone_src_ret` is `GENERATED ALWAYS AS ('durable') STORED`, so the composite FK to `source_records(id, retention_class)` has nothing to point at when the source is ephemeral: `23503` on `businesses_phone_src_fk`. A phone number whose only source is a Google payload cannot be written at all — the column stays NULL, which is exactly the product behaviour ARCHITECTURE.md describes ("not stored").
- **Assumption A4 held.** drizzle-kit 0.31.10 emitted all three `GENERATED ALWAYS AS ('durable') STORED` columns correctly in `0005`, so the documented fallback was not needed and `0006` is constraints only.
- **D-10 never lapsed.** `source_records` shipped with `org_id`, its index, RLS and four policies in the same migration that created it; `every public table is org-scoped and has RLS enabled` was re-run immediately after the push and named in the output.
- **Two mutations, each reding exactly one named test, each leaving the positive control green** — the specific check 01-05 established as necessary after M1's literal recipe passed for the wrong reason.
- `pnpm test:db` is **19 passed (19)**; `db:migrate` exits 0 twice in a row; `db:generate --name=noop` reports *"No schema changes, nothing to migrate"* — no drift between the TypeScript schema and the live database, which Phase 3 will generate on top of.

## Task Commits

1. **Task 1: `source_records` + provenance columns, retention constraints deliberately absent** — `26b0385` (feat)
2. **Task 2: six retention tests, five watched failing first** — `e2ea292` (test)
3. **Task 3: the retention constraints, green, with both mutations recorded** — `f82f950` (feat)

## Files Created/Modified

- `src/db/schema/source-records.ts` — the retention-class table: `orgScoped` spread, both enum CHECKs (`sr_source_key_known`, `sr_retention_class_known`), the `org_id` index and `orgPolicies('source_records')`. Every timestamp goes through `tstz()` (`grep -c 'timestamp('` → 0).
- `src/db/schema/businesses.ts` — three provenance pairs plus `businessLikeBridge`, the compile-time subset assertion against `BusinessLike`.
- `src/db/schema/index.ts` — `source_records` added to the drizzle-kit entry point.
- `drizzle/0005_retention.sql` — generated: creates the table, enables RLS, four policies, the org index, six columns on `businesses` (three of them generated), two FKs.
- `drizzle/0006_retention_constraints.sql` — hand-written (`generate --custom`): `sr_ephemeral_has_expiry`, `sr_google_is_ephemeral`, `sr_durable_uniq`, the three composite provenance FKs, and the `sr_expiry` partial index.
- `tests/db/retention.test.ts` — six `it(` blocks, six `withRollback` wrappers, `23514` ×3, `23503` ×1, the RLS/grant code ×0, every code pin carrying its constraint name.

## Watched failing first

Every run below was made against the schema **with the columns but without the constraints** (Task 1 deliberately shipped them missing), and every run was read for the failing test **NAME** — a `-t` filter that matches nothing exits green, which is the easiest way to fake a red-then-green record.

Full suite in the pre-constraint state: **`Test Files 1 failed | 4 passed (5)` · `Tests 5 failed | 14 passed (19)`**, the five reds being exactly:

```
     × google content cannot be durable 110ms
     × an ephemeral source record without expires_at is refused 70ms
     × a durable source record with an expires_at is refused 68ms
     × durable cites durable: a durable field citing an ephemeral source is refused 67ms
     × source_records has a partial index on expires_at 72ms
```

### 1. `pnpm test:db -t "google content cannot be durable"` → exit **1**

```
 ❯ tests/db/retention.test.ts (6 tests | 1 failed | 5 skipped) 163ms
   ❯ Places retention is a database constraint (6)
     × google content cannot be durable 161ms

 FAIL  tests/db/retention.test.ts > Places retention is a database constraint > google content cannot be durable
AssertionError: promise resolved "Result{ command: 'INSERT', …(9) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ Result {
    …
+   "command": "INSERT",
    …
  }

 ❯ tests/db/retention.test.ts:47:28
     45|       // the caching restriction, so a Google payload may never become…
     46|       const attempt = c.query(INSERT_SOURCE_NO_TTL, [a, 'google_places…
     47|       await expect(attempt).rejects.toMatchObject({
       |                            ^
     48|         code: '23514',
     49|         constraint: 'sr_google_is_ephemeral',
 ❯ withRollback tests/db/_fixtures.ts:43:5

 Test Files  1 failed | 4 skipped (5)
      Tests  1 failed | 18 skipped (19)
```

The Google-durable insert **succeeded** (`command: "INSERT"`) — the predicted reason exactly. (The pg `Result` object dump is elided at the `…` marks; nothing load-bearing was removed.) This run was repeated verbatim after the header reword described under Deviations, with the same result.

### 2. `pnpm test:db -t "ephemeral"` → exit **1**

```
 ❯ tests/db/retention.test.ts (6 tests | 2 failed | 4 skipped) 268ms
   ❯ Places retention is a database constraint (6)
     × an ephemeral source record without expires_at is refused 199ms
     × durable cites durable: a durable field citing an ephemeral source is refused 67ms

 FAIL  … > an ephemeral source record without expires_at is refused
AssertionError: promise resolved "Result{ command: 'INSERT', …(9) }" instead of rejecting

 Test Files  1 failed | 4 skipped (5)
      Tests  2 failed | 17 skipped (19)
```

Note what this filter actually covers: **two** tests, and **not** the third CHECK case — see Deviation 2.

### 3. `pnpm test:db -t "a durable source record with an expires_at is refused"` → exit **1** (added filter)

```
 ❯ tests/db/retention.test.ts (6 tests | 1 failed | 5 skipped) 99ms
     × a durable source record with an expires_at is refused 98ms

 FAIL  … > a durable source record with an expires_at is refused
AssertionError: promise resolved "Result{ command: 'INSERT', …(9) }" instead of rejecting

      Tests  1 failed | 18 skipped (19)
```

### 4. `pnpm test:db -t "durable cites durable"` → exit **1**

```
 ❯ tests/db/retention.test.ts (6 tests | 1 failed | 5 skipped) 104ms
     × durable cites durable: a durable field citing an ephemeral source is refused 102ms

 FAIL  … > durable cites durable: a durable field citing an ephemeral source is refused
AssertionError: promise resolved "Result{ command: 'INSERT', …(9) }" instead of rejecting

 ❯ tests/db/retention.test.ts:92:28
     90|       // the composite FK has nothing to point at and the column stays…
     91|       const attempt = c.query(INSERT_BUSINESS_CITING, [a, 'Alpha Roofi…
     92|       await expect(attempt).rejects.toMatchObject({
       |                            ^
     93|         code: '23503',
     94|         constraint: 'businesses_phone_src_fk',

      Tests  1 failed | 18 skipped (19)
```

The business row citing an ephemeral source was **accepted** — there was no FK yet.

### 5. `pnpm test:db -t "partial index on expires_at"` → exit **1**

```
     × source_records has a partial index on expires_at 104ms

AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ tests/db/retention.test.ts:117:20
    115|         "select indexdef from pg_indexes where schemaname = 'public' a…
    117|       expect(rows).toHaveLength(1);
       |                    ^
```

### Green already, and correctly so

`positive control: a durable field citing a durable source is accepted` **passed in the red state**, which is the expected and necessary outcome:

```
 ✓ tests/db/retention.test.ts > Places retention is a database constraint > positive control: a durable field citing a durable source is accepted 102ms
      Tests  1 passed | 18 skipped (19)
```

A refusal test with no positive control passes when everything is broken; a positive control that is red before the constraints exist would mean the fixture, not the guard, is doing the work.

## Mutation check

Both mutations were applied **to the live local database and never to a migration file**, precisely so the revert is provable: `git diff --stat` is empty by construction, and the restore is verified from `pg_constraint`, not from the fact that a script ran. Each window was seconds — plan 01-08 runs read-only `withRollback` tests against this same database.

### M2 (VALIDATION.md): `alter table source_records drop constraint sr_google_is_ephemeral`

| | |
|---|---|
| **Constraint dropped** | `sr_google_is_ephemeral` (confirmed gone: `pg_constraint` count 0) |
| **Result** | `Test Files 1 failed | 4 passed (5)` · **`Tests 1 failed | 18 passed (19)`**, exit 1 |
| **The one red** | `tests/db/retention.test.ts > Places retention is a database constraint > google content cannot be durable` |
| **Total test count** | 19 |
| **Direction check (01-05's M1 lesson)** | `positive control: a durable field citing a durable source is accepted` stayed **✓ green** under the mutation, and the other four retention tests stayed green — so the guard is not "working" by refusing everything, and the mutation removed exactly one invariant |
| **After revert** | constraint re-added from 0006's exact statement; `pg_get_constraintdef` → `CHECK (((source_key <> 'google_places'::text) OR (retention_class = 'ephemeral'::text)))`; `pnpm test:db` → **19 passed (19)**, exit 0 |
| **`git diff --stat`** | **empty** (checked after the Task 3 commit; no file was touched by the mutation at any point) |

### Composite-FK mutation: `alter table businesses drop constraint businesses_phone_src_fk`

The phase validation map's literal **M3** belongs to plan 01-09 (`drop trigger businesses_event`) and is out of this plan's scope; the second mutation this plan owes is the composite-FK half of criterion 3, and it was run the same way.

| | |
|---|---|
| **Constraint dropped** | `businesses_phone_src_fk` (confirmed gone) |
| **Result** | **`Tests 1 failed | 18 passed (19)`**, exit 1 |
| **The one red** | `durable cites durable: a durable field citing an ephemeral source is refused` |
| **Direction check** | `positive control: a durable field citing a durable source is accepted` stayed **✓ green** — without the FK the citing insert simply succeeds, which is why the control cannot detect the mutation and the refusal test must |
| **After revert** | `pg_get_constraintdef` → `FOREIGN KEY (phone_source_id, phone_src_ret) REFERENCES source_records(id, retention_class)`, identical in form to its two untouched siblings; `pnpm test:db` → **19 passed (19)** |
| **`git diff --stat`** | **empty** |

### Supporting mutation — the compile-time bridge is not decorative

`businessLikeBridge` would be worthless if it could not fail. Renaming `displayName` → `displayNameRENAMED` in `src/db/schema/businesses.ts` (the script asserted the text actually changed before trusting the result):

```
src/db/schema/businesses.ts(43,61): error TS2344: Type 'keyof BusinessLike' does not satisfy the constraint
  '"id" | … | "displayNameRENAMED" | …'.
  Type '"displayName"' is not assignable to type …
[ELIFECYCLE] Command failed with exit code 2
```

Reverted; `pnpm typecheck` exit 0. The key-link `src/db/schema/businesses.ts → src/lib/export/public-business.ts` is live.

## Verification Evidence

Every exit code was read with a redirect (`cmd > log 2>&1; echo $?`), never through a pipe.

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test:unit` | exit 0 — `Test Files 4 passed (4)` · `Tests 11 passed (11)` |
| `pnpm test:db` | exit 0 — **`Test Files 5 passed (5)` · `Tests 19 passed (19)`**, output names all six retention tests plus every test from plans 05 and 06 |
| `pnpm db:migrate` (0005) ×2 | exit 0 both times |
| `pnpm db:migrate` (0006) ×2 | exit 0 both times |
| `pnpm db:generate --name=noop` | exit 0 — *"No schema changes, nothing to migrate"*; no file emitted, so nothing to delete |
| `git diff --stat pnpm-lock.yaml package.json` | **empty** — the launcher added no `@pnpm/exe` entry |
| `git diff --stat` after the mutations | **empty** |

`pnpm verify` was **not** run as one command: it chains nested bare `pnpm`, which on this machine resolves to global 11.9.0 with a broken 12.5.1 self-switch shim. All four constituents were run individually and each exited 0 (the same accommodation plan 05 recorded).

Live database after the plan:

```
migrations:        7                      (0005 and 0006 applied additively)
retention constraints: 6                  sr_google_is_ephemeral, sr_ephemeral_has_expiry,
                                          sr_durable_uniq, businesses_{legal_name,display_name,phone}_src_fk
sr_expiry:         CREATE INDEX sr_expiry ON public.source_records USING btree (expires_at)
                     WHERE (expires_at IS NOT NULL)
source_records:    relrowsecurity = true, 4 policies
generated columns: legal_name_src_ret / display_name_src_ret / phone_src_ret
                     is_generated = ALWAYS, generation_expression = 'durable'::text
```

Task acceptance greps:

| Criterion | Value |
|---|---|
| `CREATE TABLE "source_records"` in 0005 | 1 |
| `CREATE POLICY "source_records_*"` in 0005 | **4** |
| `GENERATED ALWAYS AS ('durable') STORED` in 0005 | **3** (assumption A4 held) |
| `sr_google_is_ephemeral` / `sr_ephemeral_has_expiry` / `sr_durable_uniq` in 0005 | **0** (they are Task 3's, after the tests were red) |
| `timestamp(` in `src/db/schema/source-records.ts` | 0 |
| `businessLikeBridge` in `src/db/schema/businesses.ts` | 1 |
| `it(` blocks / `withRollback` wrappers in `retention.test.ts` | 6 / 6 |
| `code: '23514'` / `code: '23503'` / the RLS-grant code in `retention.test.ts` | 3 / 1 / **0** |
| `constraint: 'sr_google_is_ephemeral'` / total `constraint:` pins | 1 / 4 (every `code` pin carries a `constraint`) |
| `--> statement-breakpoint` in 0006 | 6 separators between 7 statements (see Deviation 3) |

## Decisions Made

Recorded in `key-decisions` above. The three later plans must not re-derive:

- **Assumption A4 held** — drizzle-kit emits a generated column that is the second leg of a composite FK without confusing its differ, so Phase 3 can keep declaring provenance pairs in TypeScript.
- **The positive control is a separate `it(`** — coupling it into the refusal test would make the FK mutation red two tests, which is a failed mutation check.
- **`-t "ephemeral"` does not cover all three CHECK cases.** Filter by the full test name when the evidence matters.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's prescribed test-file header trips the plan's own acceptance grep**

- **Found during:** Task 2
- **Issue:** The plan specifies a header containing the RLS/grant SQLSTATE token twice ("The codes here are NOT 42501… 42501 is the RLS/grant family and appears nowhere in this file"), while its acceptance criteria require `grep -c "42501" tests/db/retention.test.ts` to return **0**. Written literally, the file fails its own criterion.
- **Fix:** The header was reworded to carry the same warning without spelling the token ("the RLS/grant one every other DB test in this repo pins… the insufficient-privilege code appears nowhere in this file, and an acceptance grep enforces that — which is why this comment does not spell it either"). This is 01-06's recorded precedent: a comment naming the thing it forbids trips the guard it describes.
- **Files modified:** `tests/db/retention.test.ts`
- **Verification:** `grep -c "42501"` → 0; the `google content cannot be durable` red run was re-executed verbatim after the reword and produced the identical failure, so the recorded red is the committed file's.
- **Committed in:** `e2ea292`

**2. [Rule 1 - Bug] The `-t "ephemeral"` filter does not cover the test the plan intends it to**

- **Found during:** Task 2
- **Issue:** The plan lists four filtered red runs and expects `-t "ephemeral"` to cover "both inserts" of the `sr_ephemeral_has_expiry` pair. It does not: the third CHECK case is named `a durable source record with an expires_at is refused` — no "ephemeral" in the name — so the filter matched the TTL test and, incidentally, the FK test. The durable-with-a-TTL case would have had no recorded red at all.
- **Fix:** A fifth filtered run was added by full test name and its red output recorded above. Test names themselves were left exactly as the plan's `<interfaces>` fixes them (VALIDATION.md filters on those substrings).
- **Files modified:** none — evidence only
- **Verification:** the added run exits 1 naming exactly `a durable source record with an expires_at is refused`
- **Committed in:** `e2ea292` (recorded here)

### Trivial

**3.** `drizzle/0006_retention_constraints.sql` carries **6** `--> statement-breakpoint` markers, not the "at least 7" its acceptance criterion asks for. The plan's own SQL block yields 6: seven statements need six separators, and a trailing marker after the final `create index` would emit an empty statement. Every statement demonstrably applied (6 rows in `pg_constraint`, 1 in `pg_indexes`), and the migration was not rewritten after being applied — drizzle hashes the SQL text, and the machine rule is that an applied migration is never edited.

**4.** `pnpm db:generate -- --name=retention` (with the `--` separator, as written in the plan) fails under pnpm 12.5.1: it forwards the separator literally and drizzle-kit reports *"Unrecognized options for command 'generate': --"*. Run without it, as plan 05 did.

**5.** `prettier --check` fails on every pre-existing file in the repo on this machine (CRLF in the working tree vs prettier's `endOfLine: 'lf'`), including files this plan never touched. Out of scope and deliberately not fixed; `prettier` is not part of `pnpm verify`. The three files this plan wrote pass `prettier --check`.

---

**Total deviations:** 2 auto-fixed (both defects in the plan's own verification recipe) + 3 trivial
**Impact on plan:** No scope change. Every interface the plan fixes as a contract — the `source_records` columns, the three provenance pairs, all six constraint names, the index name, and all the test names VALIDATION.md filters on — is exactly as specified. Both auto-fixes strengthened the evidence: without them the file would have failed its own grep, and one of the three CHECK cases would have had no recorded red.

## Issues Encountered

- The worktree was created from `0ee86c0`, behind the expected base `ba49b64`. The `<worktree_branch_check>` caught it: HEAD was on `worktree-agent-a79f6a591555bec97` (never a protected ref), the tree was clean, and `git reset --hard ba49b64` moved it forward. Same known `EnterWorktree` base-selection issue plans 04, 05 and 06 hit.
- `node_modules` is not shared between worktrees; `pnpm install --frozen-lockfile` was run first through the 12.5.1 launcher (18.9 s, exit 0). No lockfile drift.
- Both constraint mutations ran against the **shared** local `siteless_test` while plan 01-08 may have been running its read-only `withRollback` tests. Each window was one `pnpm test:db` run (~7 s), confined to a single constraint, and both were restored and verified from `pg_constraint`/`pg_get_constraintdef`. No migration was re-applied and `drizzle.__drizzle_migrations` was never touched by hand.

## User Setup Required

None — no external service configuration. Nothing in this plan reaches production Supabase; `scripts/db.ts --target=test` refuses a Supabase host and every statement ran against the local `siteless_test`.

## Threat Flags

None. Every mitigation in the plan's register was implemented and exercised:

| Threat | Status |
|---|---|
| T-1-08 (Information disclosure / retention, `source_records`) | `sr_google_is_ephemeral` and `sr_ephemeral_has_expiry` live in `pg_constraint`; three tests pin `23514` with the constraint names; M2 proves the first would be noticed if it disappeared |
| T-1-27 (Tampering, `businesses` provenance) | Three composite FKs over `GENERATED ALWAYS AS ('durable') STORED` columns; `23503` test plus a positive control; the FK mutation reds exactly that test |
| T-1-02 (Information disclosure, `source_records` RLS) | `org_id`, `source_records_org_idx`, `relrowsecurity = true` and four policies, all in `0005`; the D-10 enumeration re-run and named green immediately after the push |
| T-1-28 (Repudiation, constraint naming) | All four `toMatchObject` pins carry `constraint:` alongside `code:` |
| T-1-29 (DoS, TTL purge) | Accepted as planned: `sr_expiry` ships now (asserted by a test, including the `WHERE (expires_at IS NOT NULL)` predicate); the purge job is Phase 4's, and no Places call has been made so the retention exposure this phase is zero |

No security-relevant surface was introduced beyond the register.

## Known Stubs

None. Every column, constraint, index and test this plan declares is live and exercised.

Two deliberate deferrals, both owned by later phases and neither blocking this plan's goal:

- The **purge job** that deletes `where expires_at < now()` is Phase 4's; only the index ships here. Nothing can expire yet because no Places call has been made.
- `businesses.business_id`-style backfill of `source_records.business_id` and the `google_place_refs` table (the durable `place_id`-only record) are Phase 3/4 work; ARCHITECTURE.md holds their shapes.

## Next Phase Readiness

**Ready for plans 01-09 and 01-10, and for Phases 3 and 4.** They can rely on:

- `source_records` as the single landing place for every fetched payload, with `retention_class` deciding what may outlive the request — Phase 4's Places verifier must write `retention_class = 'ephemeral'` with `expires_at = now() + interval '21 days'`, and the database will refuse anything else for `source_key = 'google_places'`;
- the three provenance pairs on `businesses` as the contract for "where did this field come from" — **add pairs, never rename these**; each new durable field needs its own `*_source_id` + `*_src_ret` + composite FK, and the pattern is in `0006`;
- `sr_expiry` for the Phase 4 purge job;
- `businessLikeBridge`: adding a column to `BusinessLike` that does not exist on the Drizzle row now fails `tsc`, so the FOUND-04 sentinel can no longer scan a stale shape.

Notes for downstream:

- **Plan 01-09:** `source_records` is a fourth org-scoped table the D-10 enumeration now covers; an events trigger on it, if wanted, is a separate decision (RESEARCH A7 flags write amplification at Phase 3 ingest volumes).
- **Plan 01-10 (production migrate):** `0005` and `0006` apply additively and were exercised twice each locally. `0006` is a `--custom` migration — it is hand-written SQL and should be read once before it reaches production.
- **Phase 4:** the SQLSTATE contract for anything writing here is `23514` (CHECK) and `23503` (FK), never the RLS code. A write path that catches errors broadly will swallow a retention breach as "insert failed".

## Self-Check: PASSED

- All 6 files in `key-files.created` exist on disk (`[ -f ]` each → FOUND); all 3 modified files present.
- All 3 commits present in `git log`: `26b0385`, `e2ea292`, `f82f950`.
- `git diff --name-only ba49b64..HEAD` lists exactly the 9 files above — **no `STATE.md`, no `ROADMAP.md`, no `REQUIREMENTS.md`**, nothing belonging to plan 01-08 (`src/proxy.ts`, `src/db/client.ts`, `src/db/with-org.ts`, `src/lib/auth/require-org.ts`, `src/components/*`, `src/app/**`, `tests/db/with-org.test.ts`, `tests/e2e/*`), and nothing in the main working tree.
- `git status --short` is empty and `.env.local` never appeared in it.
- Live database re-probed after both mutation reverts: 7 migrations, 6 retention constraints, `sr_expiry` present, `source_records` RLS on with 4 policies.
- Every task's `<acceptance_criteria>` and the plan-level `<verification>` were re-run after the final edit; results are in the tables above.

---
*Phase: 01-foundations-tenancy*
*Completed: 2026-09-22*

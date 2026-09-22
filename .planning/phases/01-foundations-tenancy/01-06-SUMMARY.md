---
phase: 01-foundations-tenancy
plan: 06
subsystem: testing
tags: [vitest, timezone, intl, clerk, rls, export, sentinel, mutation-testing]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 01)
    provides: 'package.json script names (test:unit, test:db, typecheck, lint), tsconfig @/* alias, eslint flat config, prettier config'
  - phase: 01-foundations-tenancy (plan 03)
    provides: "vitest.config.ts pinned to UTC in the main process with pool:'forks'; vitest.db.config.ts serial with .env.local loaded; tests/db/_fixtures.ts withRollback"
provides:
  - 'src/lib/export/registry.ts — PAYLOAD_BUILDERS, the registry every future export/push builder joins, deliberately empty in Phase 1'
  - 'src/lib/export/public-business.ts — PublicBusiness = BusinessLike minus internalNotes, with zero imports so the sentinel stays a pure unit test'
  - 'tests/unit/no-internal-leak.test.ts — the canary scan over every registered builder PLUS the readdirSync enumeration that makes an unregistered builder module a failing suite'
  - 'src/lib/time.ts — APP_TZ / APP_LOCALE and explicit-zone formatters; the only file in src/ that names a zone'
  - 'tests/unit/time.test.ts — the discriminating pair, the Intl constructor spy pinning zone AND locale on every call, and the spread-order guard'
  - 'tests/db/time.test.ts — the same day-bucket claim in SQL, plus the two DST instants; also the first test file that makes pnpm test:db actually run'
  - 'src/lib/auth/sole-organization.ts — the pure decision behind Clerk active-organization trap, zero dependencies, ready for plan 08 to mount'
affects:
  [01-07, 01-08-clerk-shell, 01-09, 01-11-deploy, phase-02, phase-03, phase-07-triage, phase-08-bis-push]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'A registry plus a directory enumeration, not a hard-coded key list: a new module under src/lib/export that nobody registered fails the suite, so "I forgot the sentinel" is unreachable'
    - 'Payload builders accept PublicBusiness, so the internal annotation is not on the value they are handed and a leak has to be deliberate rather than convenient'
    - 'One exported APP_TZ and APP_LOCALE; every Intl.DateTimeFormat call pins both, with timeZone placed AFTER the options spread so a caller cannot override it'
    - 'One instant, two zones, opposite verdicts — asserted in TypeScript and again in SQL, because TypeScript proves the rendered label and SQL proves the GROUP BY'
    - 'One mutation per test: when a mutation killed two tests, the TEST was changed (explicit zone argument) rather than accepting an ambiguous signal'
    - 'A mutation script must assert it changed the file — a string replace that silently no-ops reports a live guard as unkillable'

key-files:
  created:
    - src/lib/export/public-business.ts
    - src/lib/export/registry.ts
    - src/lib/time.ts
    - src/lib/auth/sole-organization.ts
    - tests/unit/fixtures/business.ts
    - tests/unit/no-internal-leak.test.ts
    - tests/unit/time.test.ts
    - tests/unit/sole-organization.test.ts
    - tests/db/time.test.ts
  modified: []

key-decisions:
  - 'Doc comments in src/lib/time.ts and src/lib/auth/sole-organization.ts were reworded so they do not spell `toLocaleString`, `import` or `@clerk` — three acceptance criteria are bare token greps over those files, and a comment naming the thing it forbids trips the guard it describes'
  - "tests/unit/time.test.ts's spy test calls localDate with an EXPLICIT zone rather than its default, so the default-parameter mutation kills only the discriminating-pair test; calling it bare made one mutation kill two tests"
  - "tests/unit/sole-organization.test.ts has exactly five it() blocks per the acceptance criteria, not BIS's seven; BIS's undefined-active-org and empty-string-active-org cases are folded into the activation test as additional assertions so no coverage was dropped"
  - 'tests/db/time.test.ts formats dates to text with to_char IN SQL rather than comparing JS Date objects, because a date column round-tripped through pg becomes a Date at midnight — the very defect the test exists to catch'
  - 'tests/unit/no-internal-leak.test.ts builds the PublicBusiness projection as an explicit field-by-field object literal rather than a rest-destructure, so adding a column to BusinessLike stops it compiling and forces a public-or-internal decision'

patterns-established:
  - 'Guard the fixture before scanning it: the sentinel asserts each builder produced a string, asserts the DEFAULT fixture still carries the canary, and asserts the correct name DID go out — a scan that only proves absence passes when everything is broken'
  - 'Pin the two modules known to be in the directory before filtering it, so a right-but-empty readdirSync cannot pass vacuously'
  - 'Assert the Intl call count is > 0 BEFORE looping over the calls, otherwise zero calls satisfies every assertion inside the loop'
  - 'Record in the test header which mutation was RUN, not which was predicted — two of the predicted ones behaved differently from the reasoning'

requirements-completed: [FOUND-04, FOUND-06, FOUND-01]

# Metrics
duration: 14min
completed: 2026-09-22
---

# Phase 01 Plan 06: Sentinel Harness, Timezone Discipline & Sole-Organization Summary

**A payload registry whose directory listing is enforced, one exported `APP_TZ` proven to render one instant on opposite days in both TypeScript and SQL, and the pure half of Clerk's active-organization trap — eleven unit tests and two DB tests, each with a named killing mutation that was actually run.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-09-22T02:26Z
- **Completed:** 2026-09-22T02:40Z
- **Tasks:** 3 of 3
- **Files created:** 9 (0 modified)

## Accomplishments

- **FOUND-04 harness is real before there is anything to harness.** `PAYLOAD_BUILDERS` is empty and the enumeration test means a future `src/lib/export/csv-export-row.ts` that nobody registered is a red suite, not a silent gap. This is the half BIS's sentinel lacks — its registry pin is a hard-coded key list that catches a reorder but not a new file.
- **FOUND-06 is asserted twice, in the two places the answer can differ.** `2026-09-21T01:00:00.000Z` renders `2026-09-21` in UTC and `2026-09-20` in `America/Chicago` — in TypeScript through `localDate`, and in SQL through `at time zone`. The suite runs in UTC (plan 03), so a forgotten zone is a red assertion rather than a coincidence on a Chicago dev box.
- **Every `Intl.DateTimeFormat` call is proven to pin zone AND locale** by spying the constructor and inspecting every call, with the call count asserted `> 0` first so the loop cannot pass vacuously. The locale assertion is the one BIS omits.
- **`pnpm test:db` runs for the first time.** It previously exited 1 with "No test files found"; `tests/db/time.test.ts` is the first file under `tests/db/`, and both its tests pass. It needs no tables, so it stays green whether or not plan 01-05's migrations have landed.
- **`soleOrganizationToActivate` ported with its incident history intact**, including the meta-lesson that is the reason Siteless's e2e must never call `setActive` to make a test green.

## Task Commits

1. **Task 1: The internal-annotation sentinel harness (FOUND-04)** — `086de90` (feat)
2. **Task 2: Timezone discipline — one constant, explicit zones, a discriminating pair in TS and in SQL** — `6c36db7` (feat)
3. **Task 3: Port soleOrganizationToActivate and its unit test** — `d4f1044` (feat)

Commits 2 and 3 were amended once each before the plan closed, to fold in a test restructure and a corrected mutation list discovered by running the mutations (see Issues Encountered). No other rewriting.

## Files Created

- `src/lib/export/public-business.ts` — `BusinessLike` and `PublicBusiness = Omit<BusinessLike,'internalNotes'>`. Zero imports, structural on purpose; plan 07 adds the compile-time bridge to the real Drizzle row.
- `src/lib/export/registry.ts` — `PayloadBuilder` and the empty `PAYLOAD_BUILDERS`. Documents the `name` ↔ module-basename convention the enumeration depends on.
- `tests/unit/fixtures/business.ts` — `makeBusiness()` with the canary in `internalNotes` by default and all three name fields populated and different.
- `tests/unit/no-internal-leak.test.ts` — the two sentinel tests.
- `src/lib/time.ts` — `APP_TZ`, `APP_LOCALE`, `localDate`, `formatLocal`.
- `tests/unit/time.test.ts` — the discriminating pair, the constructor spy, the spread-order guard.
- `tests/db/time.test.ts` — the SQL day-bucket pair and the two DST instants.
- `src/lib/auth/sole-organization.ts` — the pure decision function, adapted from BIS.
- `tests/unit/sole-organization.test.ts` — all five branches.

## Verification

| Command                                       | Result                                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| `pnpm test:unit --reporter=verbose`           | **exit 0** — 11 passed (11), 4 files                        |
| `pnpm test:db --reporter=verbose`             | **exit 0** — 2 passed (2), 1 file                           |
| `pnpm test:db -t "two zones, opposite verdicts"` | **exit 0** — 1 passed, 1 skipped; test named in output   |
| `pnpm typecheck`                              | **exit 0**                                                  |
| `pnpm lint`                                   | **exit 0**                                                  |
| `prettier --check` on all nine files          | clean                                                       |
| `git diff --stat pnpm-lock.yaml package.json` | **empty** — the launcher added no `@pnpm/exe` entry this run |

The six test names the plan and `01-VALIDATION.md` filter on all appear in the output verbatim:
`no registered payload builder emits an internal annotation`, `every module under src/lib/export is represented in the registry`, `one instant renders on opposite days in UTC and America/Chicago`, `pins the zone and the locale on every Intl call`, `sole organization: activates when there is exactly one membership`, `one instant, two zones, opposite verdicts`.

Acceptance greps:

| Grep                                                | Required | Actual                     |
| --------------------------------------------------- | -------- | -------------------------- |
| `grep -c 'INTERNAL-CANARY-7f3a2b' tests/unit/no-internal-leak.test.ts` | ≥1 | 1 |
| `grep -c 'readdirSync' tests/unit/no-internal-leak.test.ts` | 1 | 1 |
| `grep -rc "America/Chicago" src/ --include=*.ts`    | only `time.ts` | only `src/lib/time.ts` (3); every other file 0 |
| `grep -c 'toLocaleString' src/lib/time.ts`          | 0        | 0                          |
| `grep -rc 'toLocaleString' src/`                    | 0        | 0                          |
| `grep -c '\.\.\.options, timeZone' src/lib/time.ts` | 1        | 1                          |
| `grep -c '@clerk' src/lib/auth/sole-organization.ts` | 0       | 0                          |
| `grep -c 'import' src/lib/auth/sole-organization.ts` | 0       | 0                          |
| `grep -c '  it(' tests/unit/sole-organization.test.ts` | 5     | 5                          |

## Sanity mutations

Every mutation below was **applied to the committed tree, run, observed, and reverted**, and the post-revert `git diff --stat` was empty each time. Failures were read by test NAME, never by exit code.

| # | Mutation                                                               | Test that went red                                             | Others red | Reverted, `git diff --stat` |
| - | ---------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- | --------------------------- |
| 1 | Add `{ name: 'leaky', build: (b) => ({ ...b, internalNotes: CANARY }) }` to `PAYLOAD_BUILDERS` | `no registered payload builder emits an internal annotation` | none | empty |
| 2 | `localDate` default parameter `APP_TZ` → `'UTC'`                       | `one instant renders on opposite days in UTC and America/Chicago` | none | empty |
| 3 | `localDate`'s `new Intl.DateTimeFormat(APP_LOCALE, …)` → `(undefined, …)` | `pins the zone and the locale on every Intl call`            | none | empty |
| 4 | `formatLocal`'s `{ ...options, timeZone }` → `{ timeZone, ...options }` | `formatLocal ignores a caller-supplied timeZone`                | none | empty |
| 5 | Delete `if (!input.signedIn) return null;`                             | `sole organization: returns null when not signed in`            | none | empty |
| 6 | Delete `if (input.activeOrgId) return null;`                           | `sole organization: returns null when an organization is already active` | none | empty |
| 7 | `memberships.length !== 1` → `< 1`                                     | `sole organization: returns null with two memberships`          | none | empty |
| 8 | `return memberships[0]!.organizationId` → `return null`                | `sole organization: activates when there is exactly one membership` | none | empty |

Two further mutations were run and are recorded because their result contradicted the prediction:

- **`memberships.length !== 1` → `=== 0`** kills `returns null with two memberships`, **not** the activation test. Two memberships also fail `=== 0`, so the function falls through and returns the first of them. It is therefore not an independent ninth mutation — #8 is what actually kills the activation test.
- **`memberships[0]` → `memberships.at(-1)`** survives all five sole-organization tests, and that is **correct**: with exactly one membership they are the same element. Nothing pins index 0 and nothing should — "the first of several" is a state the length guard forbids. Recorded so a future reader does not mistake the survivor for a coverage gap.

Mutation #1 in the required form (`grep`-visible in the test header) is the supporting mutation `01-VALIDATION.md` records for 01-06 T1.

## Decisions Made

1. **Two doc comments were reworded so they do not spell the token they warn about.** Three acceptance criteria are bare token greps: `grep -c 'toLocaleString' src/lib/time.ts` → 0, `grep -c 'import' src/lib/auth/sole-organization.ts` → 0, `grep -c '@clerk' …` → 0. The first drafts of both files explained the rule by naming the forbidden call, which made the file fail its own guard. The guards were kept and the prose changed; each file now says out loud that it is deliberately not spelling the token, so a future editor does not "fix" the wording and break the check.
2. **`readdirSync` is reached through a namespace import** (`import * as nodeFs from 'node:fs'`) rather than a named import, so the literal appears exactly once — `grep -c 'readdirSync'` counts lines and a named import plus a call site would return 2.
3. **The spy test calls `localDate` with an explicit zone.** One property per test, one mutation per test.
4. **The DB test formats with `to_char` inside SQL.** Comparing JS `Date` objects would assert through the exact defect the test exists to catch.
5. **`PAYLOAD_BUILDERS` is empty and the test says so out loud** (`expect(PAYLOAD_BUILDERS).toHaveLength(0)` on the empty branch), so the vacuous pass is a visible deliberate state rather than an accident.

## Deviations from Plan

### 1. [Rule 3 — Blocking] Doc comments tripped the plan's own acceptance greps

- **Found during:** Tasks 2 and 3
- **Issue:** `src/lib/time.ts` contained "NEVER `toLocaleString()` with one argument" and `src/lib/auth/sole-organization.ts` contained "zero Clerk imports". Both are exactly the text the plan's acceptance criteria forbid (`grep -c` → 0), so the files failed criteria that exist to prove the code does not do the thing the comments were warning against.
- **Fix:** Reworded both to "the single-argument `Date` locale formatters" and "nothing pulled in from Clerk's SDK", and added one sentence to each explaining that the token is deliberately unspelled because a bare grep enforces it.
- **Files:** `src/lib/time.ts`, `src/lib/auth/sole-organization.ts`
- **Verification:** all three greps return 0; suite still green.
- **Committed in:** `6c36db7`, `d4f1044`

### 2. [Rule 1 — Bug] One mutation killed two tests

- **Found during:** Task 2 sanity check
- **Issue:** The plan's action for `pins the zone and the locale on every Intl call` specifies only a `formatLocal` call. I had additionally called `fresh.localDate(INSTANT)` bare, to cover `localDate`'s locale pin. That coupled the spy test to `localDate`'s default parameter, so the plan's own sanity mutation (`APP_TZ` → `'UTC'`) turned **two** tests red instead of one — an ambiguous signal that no longer says which guard is doing the work.
- **Fix:** Call `fresh.localDate(INSTANT, APP_TZ)` with an explicit zone. Coverage of `localDate`'s locale pin is retained (mutation #3 above proves it), and the default-zone property stays owned solely by the discriminating-pair test.
- **Files:** `tests/unit/time.test.ts`
- **Verification:** mutations #2, #3 and #4 each now kill exactly one test.
- **Committed in:** `6c36db7` (amended)

### 3. [Rule 2 — Missing coverage] BIS's two extra sole-organization cases preserved inside five `it` blocks

- **Found during:** Task 3
- **Issue:** The plan's `read_first` says port BIS's test verbatim (7 `it` blocks) while its acceptance criterion requires **exactly five**. BIS's extra two — `activeOrgId: undefined` and `activeOrgId: ''` — are not decoration: they are what makes the truthiness check correct rather than a `!== null` check, and Clerk reports "not loaded" as `undefined`, so dropping them would leave a real branch untested.
- **Fix:** Both folded into `sole organization: activates when there is exactly one membership` as additional assertions — they are all the same case ("no active organization", spelled three ways). Five `it` blocks, zero branches lost.
- **Files:** `tests/unit/sole-organization.test.ts`
- **Committed in:** `d4f1044`

### 4. [Planned discretion] A second DB test for the DST fixtures

The plan asks for the two DST instants "as documented assertions". They are a second `it` in `tests/db/time.test.ts` rather than comments, so they actually execute. The named test the validation map filters on is unaffected.

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing coverage) + 1 discretionary expansion.
**Impact on plan:** No scope change. Every deviation made a guard stronger or a signal less ambiguous; nothing was dropped.

## Issues Encountered

1. **A mutation script silently no-opped and reported a live guard as unkillable.** After `git checkout -- <file>`, git rewrote the file with CRLF endings. My `String.replace` search string ended in `\n`, matched nothing, and the script printed "mutation applied" anyway — so deleting the `activeOrgId` guard appeared to leave the suite green. That is the "unkillable guard = dead code" signal, and it was false. Fixed by making the mutation script throw when the replacement is a no-op (`if (out === s) throw`); the real run then killed exactly the expected test. **Lesson: a mutation harness that does not assert it mutated is itself untested, and its most dangerous output is a false green.**
2. **A predicted mutation killed the wrong test.** `length !== 1` → `=== 0` was expected to kill the activation test; it kills the two-membership test instead, because two memberships also fail `=== 0` and fall through. The header comment in `tests/unit/sole-organization.test.ts` originally asserted the prediction. It now records what was run, plus both surprises. **Reasoning about which test a mutation kills is not evidence; running it is.**
3. **`prettier --check` failed on `tests/unit/time.test.ts`** after the first write (a wrapped assertion). `--write`, re-ran the suite, still green. `pnpm lint` does not cover formatting, so this would have reached CI otherwise.
4. **`pnpm verify` was not run as a unit** — per the machine brief it dies on a nested bare `pnpm`. Its four constituents (`typecheck`, `lint`, `test:unit`, `test:db`) were each run individually and each exited 0.

## Known Stubs

- **`PAYLOAD_BUILDERS` is an empty array.** This is not an unfinished stub — it is the plan's stated deliverable, and the enumeration test is what makes the empty registry load-bearing. Phase 8 adds `bis-contact-push` and `csv-export-row`; until then the canary loop is deliberately vacuous and the test asserts `toHaveLength(0)` so that state is visible in the output rather than silent.
- **`BusinessLike` is structural, not derived from the Drizzle schema.** Deliberate (the sentinel must not pull a database into its import graph). Plan 07 adds the compile-time bridge proving it stays a subset of the real row type; until that lands, a column added to `businesses` will not automatically appear here.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change was introduced; the four threats this plan carries (T-1-09, T-1-10, T-1-25, T-1-26) are all mitigated as the register specifies, each by a test with a named killing mutation that was run.

## Parallel-Execution Notes

- Ran in worktree `agent-ae3ecff06e0096b2c` on branch `worktree-agent-ae3ecff06e0096b2c`. The worktree was created one commit behind (`0ee86c0`) and was reset forward to the declared base `5434bbd` before any work.
- **No file outside this plan's `files_modified` was created or edited.** `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` are untouched — the orchestrator owns those. Plan 01-05's files (`src/db/schema/*`, `drizzle/*`, `tests/db/rls-isolation.test.ts`, `tests/db/schema-audit.test.ts`, `tests/db/ensure-org.test.ts`) were neither created nor modified.
- **No DDL, no migrations, no schema touched.** `tests/db/time.test.ts` runs entirely on SQL literals inside `withRollback`, so it neither depends on nor disturbs the tenancy tables 01-05 is applying to the shared `siteless_test`.
- `pnpm-lock.yaml` and `package.json` are byte-identical to the base commit after `install --frozen-lockfile`; the `@pnpm/exe` side effect seen in plan 01-03 did not recur.

## Next Phase Readiness

- **Plan 07** can add the compile-time bridge from `BusinessLike` to the Drizzle `businesses` row, and its `source_records` constraint work is unblocked by nothing here.
- **Plan 08** can mount `ActivateSoleOrganization` around `soleOrganizationToActivate` directly — the decision function is final and needs no Clerk mocking to test. Its e2e must not call `setActive`; the file header says why.
- **Phase 8's BIS push and CSV export** join `PAYLOAD_BUILDERS` by adding one entry and one same-named module. The enumeration test makes skipping the registration a build failure rather than a review comment.
- **Every future day bucket** goes through `localDate`/`APP_TZ` in TypeScript and `at time zone 'America/Chicago'` in SQL. `grep -rn "America/Chicago" src/` naming a second file is the signal that the discipline slipped.

## Self-Check: PASSED

- All 9 source/test files claimed above exist on disk.
- All 4 commits exist on `worktree-agent-ae3ecff06e0096b2c`: `086de90`, `6c36db7`, `d4f1044`, `8887604`.
- `git diff --name-only 5434bbd..HEAD` lists **exactly** this plan's nine files plus this SUMMARY — no `STATE.md`, no `ROADMAP.md`, no `REQUIREMENTS.md`, no plan 01-05 file, no lockfile.
- `git diff --diff-filter=D --name-only 5434bbd..HEAD` is empty: nothing was deleted.
- `git status --short` is empty: nothing left uncommitted.

---

_Phase: 01-foundations-tenancy_
_Plan: 06_
_Completed: 2026-09-22_

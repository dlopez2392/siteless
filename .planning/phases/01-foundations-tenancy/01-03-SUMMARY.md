---
phase: 01-foundations-tenancy
plan: 03
subsystem: testing
tags: [vitest, playwright, pg, github-actions, rls, timezone, ci, clerk-testing]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 01)
    provides: "package.json script names (test:unit, test:db, test:e2e, typecheck, lint), the pinned vitest/playwright/pg/dotenv dependency set, tsconfig's @/* alias and eslint flat config"
  - phase: 01-foundations-tenancy (plan 02)
    provides: "A live PostgreSQL 18.6 on localhost:5432 with siteless_test, and TEST_DATABASE_URL in .env.local proven to contain no `supabase` substring"
provides:
  - "vitest.config.ts — unit suite pinned to UTC in the MAIN process, pool 'forks', with a self-asserting and mutation-checked timezone test"
  - "vitest.db.config.ts — serial, single-process DB suite that loads the gitignored local env file with override:false so CI's job env stays authoritative"
  - "tests/db/_fixtures.ts — withRollback / actAs / actAsRole / actAsOwner / seedTwoOrgs and the v1|v2 Clerk Claims union, with a guard that refuses a Supabase host before it connects"
  - "playwright.config.ts + tests/e2e/_required-env.ts — an e2e run that throws, naming missing variable NAMES only, before a single test executes"
  - "tests/e2e/auth.setup.ts — password-free Clerk sign-in with NO active-organization workaround"
  - ".github/workflows/ci.yml — verify / db / e2e, postgres:18 service container, setup-node@v4, --frozen-lockfile, and no reference to the production project"
affects:
  [01-04-drizzle-bootstrap, 01-05-rls, 01-07, 01-08-clerk-shell, 01-09, 01-10-vercel, 01-11-deploy, phase-02, phase-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Timezone pinned by assigning process.env.TZ in the config file's main process, above every import, with pool:'forks' so worker children inherit it — never vitest's test.env.TZ, never a shell TZ= prefix"
    - "The suite runs in UTC, deliberately not America/Chicago, because the dev machine IS Chicago and a Chicago-pinned suite cannot discriminate"
    - "Every DB test goes through withRollback: begin/rollback in try/finally, one refused statement per transaction, never truncate-between-tests"
    - "D-04 is enforced at runtime, not documented: withRollback throws before connecting if TEST_DATABASE_URL matches a Supabase host or is unset"
    - "Fail-loudly env preambles report variable NAMES via join(', ') and never a value, because the text reaches CI logs"
    - "CI is greppably clean of the production project: a workflow that could reach it is a test, not a review comment"

key-files:
  created:
    - vitest.config.ts
    - vitest.db.config.ts
    - tests/unit/suite-zone.test.ts
    - tests/db/_fixtures.ts
    - playwright.config.ts
    - tests/e2e/_required-env.ts
    - tests/e2e/auth.setup.ts
    - .github/workflows/ci.yml
  modified:
    - .gitignore
    - package.json

key-decisions:
  - "vitest 5 deleted poolOptions.forks.singleFork and the matching CLI flag; serialisation is expressed as fileParallelism:false + isolate:false in vitest.db.config.ts, and package.json's test:db drops the now-fatal --poolOptions flag"
  - "tests/e2e/auth.setup.ts uses clerk.signIn's emailAddress (Backend-API ticket) overload rather than the plan's literal signInParams email_code strategy, which @clerk/testing documents as requiring a +clerk_test address and would otherwise wait on a real six-digit code"
  - "REQUIREMENTS.md checkboxes were deliberately NOT flipped for FOUND-01/02/06 — a test harness does not satisfy any of them; the evidence lands in plans 05 and 08"
  - "pnpm-lock.yaml was reverted after the pnpm launcher added an @pnpm/exe packageManagerDependencies entry as a side effect — an unrelated lockfile mutation is not this plan's work and would collide with the concurrent worktree"

patterns-established:
  - "Mutation check before claiming a pin works: the TZ assignment was removed, the suite went red naming America/Chicago, and the line was restored"
  - "Read the failing test's NAME, not the exit code — pnpm test:unit is run with --reporter=verbose so a -t filter matching nothing cannot pass silently"
  - "Guards are proven by firing them, not by reading them: both withRollback guards were triggered live and their messages captured"

requirements-completed: [FOUND-06, FOUND-02, FOUND-01]

# Metrics
duration: 14 min
completed: 2026-09-22
---

# Phase 01 Plan 03: Test Harness — vitest, DB Fixtures, Playwright and CI Summary

**The test harness every later plan in this phase writes into: a unit suite pinned to UTC in the main process (mutation-checked red without the pin), a serial DB suite whose `withRollback` refuses a Supabase host before it opens a socket, a Playwright config that aborts naming missing variables and nothing else, and a three-job CI workflow with a `postgres:18` service container and zero reach into the production project.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-22T02:02:40Z
- **Completed:** 2026-09-22T02:16:42Z
- **Tasks:** 3
- **Files modified:** 10 (8 created, 2 modified)

## Accomplishments

- The timezone pin is real and **proven discriminating**, not asserted. `node -e` reports this machine's default zone as `America/Chicago`; the suite reports `UTC`. Removing the line-1 assignment turns the suite red with `expected 'America/Chicago' to be 'UTC'`, and vitest's own "Start at" clock moved from `02:07` to `21:07` in the same run — two independent witnesses that the main-process assignment reaches the forked workers.
- **D-04 is unrunnable-if-violated.** Both `withRollback` guards were fired live: an unset `TEST_DATABASE_URL` throws naming the variable and pointing at `docs/local-postgres.md`; a `pooler.supabase.com` URL throws before `c.connect()` is ever called. A real connection through the configured URL reached `siteless_test` and read cleanly inside a rolled-back transaction — no DDL, no `orgs` reference, nothing left behind for the concurrent plan 01-04.
- The Playwright preamble was **executed, not inspected**: `playwright test --list` aborts with `e2e: missing environment variable(s): E2E_BASE_URL, E2E_ADMIN_EMAIL` — names only, no values, before a browser is touched.
- `.github/workflows/ci.yml` parses (validated with a one-off `js-yaml` run) into exactly three jobs, with `pnpm/action-setup@v4` immediately preceding `actions/setup-node@v4` in all three, `node-version: 24` three times, `--frozen-lockfile` three times, one `image: postgres:18`, and **zero** case-insensitive matches for the production project's vendor name.
- Four latent contradictions between the plan's verbatim code and the plan's own `grep -c` / `node -e` gates were found and closed rather than papered over (see Deviations 1, 2 and 5) — every acceptance criterion in all three tasks now passes as literally written.

## Task Commits

1. **Task 1: vitest configs with the timezone pinned in the main process** — `283d27e` (feat)
2. **Task 2: Port withRollback / actAs / actAsOwner and add seedTwoOrgs** — `dfbacae` (feat)
3. **Task 3: Playwright config, e2e auth setup, and the three-job CI workflow** — `d13f274` (feat)

**Plan metadata:** this SUMMARY (docs: complete plan)

## Files Created/Modified

- `vitest.config.ts` — `process.env.TZ='UTC'` and `LANG` as the first executable statements, above every import; `pool: 'forks'`; include `tests/unit/**`; `@ → ./src`; 15s timeout
- `vitest.db.config.ts` — loads the gitignored local env file with `override: false`; include `tests/db/**`; `pool:'forks'` + `fileParallelism:false` + `isolate:false`; 60s test and hook timeouts; **no** `globalSetup` sweep (D-04 removes BIS's reason for one)
- `tests/unit/suite-zone.test.ts` — the pin asserts itself, so a config regression is visible rather than silently vacuous
- `tests/db/_fixtures.ts` — `withRollback`, `actAs`, `actAsRole`, `actAsOwner`, `seedTwoOrgs`, `type Claims`; the header comment carries D-11a (filtered vs refused: `rowCount 0` for cross-org UPDATE/DELETE, `42501` only for a foreign-org INSERT) and Shared Pattern B (`25P02` on the statement after a refusal)
- `playwright.config.ts` — `assertRequiredEnv()` at module load; `baseURL` from `E2E_BASE_URL` with no fallback and no local-server block; serial, `workers: 1`, `trace: 'retain-on-failure'`
- `tests/e2e/_required-env.ts` — four required names, `missing.join(', ')`, values never interpolated
- `tests/e2e/auth.setup.ts` — `clerkSetup()` + password-free sign-in + `storageState`; carries a comment naming the active-organization workaround it deliberately omits
- `.github/workflows/ci.yml` — `verify` (typecheck/lint/unit), `db` (postgres:18 container → `db:migrate` → `test:db`), `e2e` (push-only, secrets guard, chromium, trace artifact on failure)
- `.gitignore` — added `tests/e2e/.auth/` (the storage state is a live Clerk session)
- `package.json` — `test:db` only: dropped the `--poolOptions.forks.singleFork` flag vitest 5 now rejects. Script **names** are untouched; the `<interfaces>` contract holds.

## Decisions Made

- **Serialisation moved from the CLI into the config.** vitest 5 removed `poolOptions` from `InlineConfig` and its CLI parser now aborts with `CACError: Unknown option --poolOptions`. `fileParallelism: false` (which vitest documents as forcing `maxWorkers` to 1) plus `isolate: false` (reuse the one forked child rather than spawn a fresh one per file) reproduce what `singleFork: true` meant. The token `singleFork` survives in the comment that records the migration.
- **`clerk.signIn`'s `emailAddress` overload, not the `email_code` strategy.** `@clerk/testing@2.2.36`'s own JSDoc: `email_code` "requires a user with a test email as an identifier (e.g. `your_email+clerk_test@example.com`)". `E2E_ADMIN_EMAIL` is a real address, so that path waits on a six-digit code from a real inbox — unattendable, and a recorded cost on this machine already. The `emailAddress` overload is the Backend-API ticket path the plan's own prose describes and the BIS analog the plan cites in `read_first` uses.
- **REQUIREMENTS.md left untouched.** See Deviation 6.
- **`pnpm-lock.yaml` reverted.** See Deviation 7.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Three `grep -c` acceptance criteria are unsatisfiable by the plan's own verbatim code**

- **Found during:** Tasks 1 and 2
- **Issue:** `grep -c` counts matching LINES. The plan supplies comment text that repeats the very token the criterion counts:
  - `grep -c "pool: 'forks'" vitest.config.ts` must return 1, but the supplied comment block contains `` `pool: 'forks'` `` on its own line → 2.
  - `grep -c "env.local" vitest.db.config.ts` must return 1, but the supplied comment names `.env.local` on two further lines → 3.
  - `grep -c 'SUPABASE_DB_URL' tests/db/_fixtures.ts` must return **0**, but the supplied doc comment reads "TEST_DATABASE_URL, never SUPABASE_DB_URL" → 1. The plan's own `<automated>` guard (`if(s.includes('SUPABASE_DB_URL'))throw`) therefore **throws on the plan's own code**.
- **Fix:** Reworded the three comments so the counted token appears exactly where the criterion intends and nowhere else, preserving every stated meaning (the forks comment now says "the forks pool declared below"; the env comment says "the gitignored local env file"; the fixture says "never the production Supabase connection variable"). No option, value or behaviour changed. This is the same class of plan-text defect 01-01 recorded as its deviation 4.
- **Files modified:** `vitest.config.ts`, `vitest.db.config.ts`, `tests/db/_fixtures.ts`
- **Verification:** `grep -c "pool: 'forks'" vitest.config.ts` → 1; `grep -c "env.local" vitest.db.config.ts` → 1; `grep -c 'SUPABASE_DB_URL' tests/db/_fixtures.ts` → 0 and the plan's `node -e` guard prints `ok`
- **Committed in:** `283d27e`, `dfbacae`

**2. [Rule 3 - Blocking] vitest 5 deleted `poolOptions`, so both the config and the `test:db` script were fatal**

- **Found during:** Task 1
- **Issue:** Two separate failures from one removal. (a) `pnpm typecheck` exited 2: `error TS2769 … 'poolOptions' does not exist in type 'InlineConfig'` — the option is absent from `vitest@5.0.1`'s declarations entirely. (b) `pnpm test:db`, exactly as plan 01 declared it, crashed before loading anything: `CACError: Unknown option --poolOptions`. The plan's own verification ("`pnpm test:db` runs and reports no test files") could not pass.
- **Fix:** Replaced the config key with `fileParallelism: false` + `isolate: false`, and removed the dead flag from `package.json`'s `test:db` value. The script **name** — the plan-01 `<interfaces>` contract — is unchanged, as is `--pool=forks`.
- **Files modified:** `vitest.db.config.ts`, `package.json`
- **Verification:** `pnpm typecheck` exits 0; `pnpm test:db` now runs, injects 11 vars from the local env file, and reports `No test files found`
- **Committed in:** `283d27e`
- **Carry-forward:** `package.json` is in neither this plan's nor plan 01-04's `files_modified`. The edit is a single line and should merge cleanly, but the merging agent should confirm it survived.

**3. [Rule 1 - Bug] `auth.setup.ts`'s literal sign-in call cannot authenticate this Clerk instance**

- **Found during:** Task 3
- **Issue:** The plan's snippet uses `signInParams: { strategy: 'email_code', identifier: email }` while its own prose one paragraph later says "`@clerk/testing` mints a sign-in token through the Backend API" — two different code paths. `@clerk/testing@2.2.36`'s type docs are explicit that `email_code` requires a `+clerk_test` identifier and auto-fills the fixed code; a real address makes it wait for a mail no automation can read. The plan's `read_first` BIS analog (`auth.setup.ts:57`) uses the `emailAddress` overload.
- **Fix:** Used the `emailAddress` overload — the one the prose, the BIS analog and the library all agree on — and recorded the whole reasoning in a comment above the call so nobody "restores" the broken form.
- **Files modified:** `tests/e2e/auth.setup.ts`
- **Verification:** `pnpm typecheck` exits 0 against the `PlaywrightClerkSignInParamsWithEmail` overload. End-to-end sign-in is **not** exercised in this plan (no `E2E_BASE_URL`, no deployment until plan 11).
- **Committed in:** `d13f274`

**4. [Rule 1 - Bug] The `setActive` acceptance criterion forbids naming the thing the plan asks to be named**

- **Found during:** Task 3
- **Issue:** The plan instructs "Do NOT call `window.Clerk.setActive()`… " and the natural way to keep that lesson with the code is a comment saying so — but the criterion is `grep -c setActive tests/e2e/auth.setup.ts` returns **0**, which any such comment breaks.
- **Fix:** Kept the warning (Shared Pattern C: the doc comment carries the incident) but phrased it as "any hand-rolled activation of the Clerk active organization through `window.Clerk`", so the lesson survives and the count is 0.
- **Files modified:** `tests/e2e/auth.setup.ts`
- **Verification:** `grep -c setActive tests/e2e/auth.setup.ts` → 0
- **Committed in:** `d13f274`

**5. [Rule 1 - Bug] The CI workflow's own comment trips the plan's `npm ci` guard**

- **Found during:** Task 3
- **Issue:** The plan's yaml carries `# never npm ci: a Windows-authored lockfile breaks it`. Its own `<automated>` guard is `if(s.includes('npm ci'))throw new Error('npm ci forbidden')`, and the criterion is `grep -c 'npm ci' .github/workflows/ci.yml` returns 0. Both fail on the comment, not on a real `npm ci` step — the guard cannot distinguish the warning from the offence.
- **Fix:** Reworded to "Always pnpm, never npm's clean-install: it is a documented, repeated failure against a Windows-authored lockfile."
- **Files modified:** `.github/workflows/ci.yml`
- **Verification:** the plan's `node -e` guard prints `ok`; `grep -c 'npm ci'` → 0
- **Committed in:** `d13f274`

**6. [Rule 2 - Missing Critical] REQUIREMENTS.md was NOT marked complete for FOUND-01/02/06**

- **Found during:** Plan close-out
- **Issue:** The standard close-out runs `requirements mark-complete` over the plan's frontmatter IDs. Run literally, it flipped FOUND-01, FOUND-02 and FOUND-06 to `[x]` / **Complete**. None is true after this plan: FOUND-02 requires *"a test that … pins SQLSTATE `42501` on the refused statement, and was watched failing first"* — plan 05 writes it; FOUND-01 requires org-scoped requests and RLS on every table — plans 05 and 08; FOUND-06 requires *"All timestamps are `timestamptz`"* — plan 05's schema. This plan builds the harness those proofs run in. A false **Complete** in the traceability table is the exact failure mode that lets a phase close without its evidence.
- **Fix:** Reverted `.planning/REQUIREMENTS.md` to HEAD with `git checkout -- .planning/REQUIREMENTS.md`. The plan's IDs are still recorded in this SUMMARY's `requirements-completed` frontmatter, so the traceability link is not lost — only the premature claim is.
- **Files modified:** none (the change was reverted before staging)
- **Verification:** `git status --short` is clean; the six FOUND rows all still read `Pending`
- **Committed in:** n/a
- **🔴 Action for the orchestrator / `/gsd-verify-work`:** flip FOUND-01, FOUND-02 and FOUND-06 when plans 05 and 08 land the evidence — not before, and not on the strength of this SUMMARY's frontmatter.

**7. [Rule 3 - Blocking] The pnpm launcher mutates `pnpm-lock.yaml` as a side effect**

- **Found during:** Plan close-out
- **Issue:** After the session's pnpm invocations, `git status` showed `M pnpm-lock.yaml`: an `@pnpm/exe@12.5.1` entry added under `importers['.'].packageManagerDependencies` plus its resolution and snapshot blocks (~30 lines). Nothing in this plan changed a dependency. Committing it would alter the lockfile that all three CI jobs validate with `--frozen-lockfile`, and the concurrent plan 01-04 worktree runs the same launcher, so both would carry the same unrelated hunk into the merge.
- **Fix:** `git checkout -- pnpm-lock.yaml`. `node_modules` is unaffected, and the original lockfile is the one that installed clean (`--frozen-lockfile`, exit 0, 21.1s).
- **Files modified:** none (reverted before staging)
- **Verification:** `git status --short` clean; the three task commits contain no lockfile hunk
- **Committed in:** n/a
- **Carry-forward:** every future plan on this machine should `git status` after running pnpm through the Node launcher and revert this hunk unless a dependency genuinely changed.

---

**Total deviations:** 7 auto-fixed (4 bugs in the plan text, 2 blocking toolchain failures, 1 missing-critical correctness guard).
**Impact on plan:** No scope creep and no weakened gate. Deviations 1, 4 and 5 changed comment wording only, to make the plan's own acceptance criteria satisfiable as literally written. Deviation 2 was forced by a major-version API removal and is confined to one config block and one script argument. Deviation 3 replaced a call that could not have worked with the one the plan's own prose and cited analog specify. Deviations 6 and 7 both *prevented* a write — a false requirement completion and an unrelated lockfile change.

## Authentication Gates

None. No task in this plan required credentials. `CLERK_TESTING_TOKEN`, `E2E_BASE_URL` and `E2E_ADMIN_EMAIL` are unset on this machine by design, and the Playwright preamble refusing to run because of it is the intended behaviour, verified above — not a gate.

## Verification Results

Plan-level `<verification>`, every command run through the pinned pnpm launcher (`node …/pnpm/12.5.1/…/bin/pnpm.mjs`, reports `12.5.1`):

| Check | Command | Exit | Result |
|---|---|---|---|
| Unit suite green and names the test | `pnpm test:unit --reporter=verbose` | 0 | `✓ tests/unit/suite-zone.test.ts > timezone pinning > the suite runs in a zone that can discriminate` |
| Unit suite with the plan's `-t` filter | `pnpm test:unit -t "suite runs in a zone that can discriminate"` | 0 | 1 passed |
| **Mutation check** on the pin | TZ line removed, suite re-run | 1 | `AssertionError: expected 'America/Chicago' to be 'UTC'` — restored immediately |
| Machine's own zone (proves the assertion discriminates) | `node -e "…resolvedOptions().timeZone"` | 0 | `America/Chicago` |
| DB suite runs, no test files yet | `pnpm test:db` | 1 | `injected env (11) from .env.local` → `No test files found` — **expected until plan 05** |
| Typecheck | `pnpm typecheck` | 0 | clean |
| Lint | `pnpm lint` | 0 | clean |
| Task 2 guard | plan's `node -e` over `_fixtures.ts` | 0 | `ok` |
| Task 3 guard | plan's `node -e` over `ci.yml` | 0 | `ok` |
| `withRollback` live smoke | connect through `TEST_DATABASE_URL`, read inside the tx | 0 | `connected to database: siteless_test | as role: postgres` |
| D-04 guard — Supabase host | `TEST_DATABASE_URL=…pooler.supabase.com…` | — | threw before connecting, naming D-04 |
| D-04 guard — unset | `TEST_DATABASE_URL` unset | — | threw, naming the variable and `docs/local-postgres.md` |
| Playwright preamble | `pnpm exec playwright test --list` | 1 | `missing environment variable(s): E2E_BASE_URL, E2E_ADMIN_EMAIL` — names only |
| CI yaml parses | one-off `npx js-yaml .github/workflows/ci.yml` | 0 | 3 jobs; `db.services.postgres.image = postgres:18`; guard script intact |

Acceptance criteria, all three tasks — every one PASS:

| Criterion | Result |
|---|---|
| TZ line (11) before first import (14) in `vitest.config.ts` | PASS |
| `grep -c "pool: 'forks'" vitest.config.ts` | 1 |
| `America/Chicago` in `vitest.config.ts`, comment only | 1 line, the "deliberately not Chicago" comment |
| `grep -c singleFork / testTimeout: 60000 / globalSetup / env.local` (db config) | 1 / 1 / 0 / 1 |
| `_fixtures.ts` exports the five functions + `type Claims` | PASS (plan's `node -e`) |
| `grep -c TEST_DATABASE_URL / SUPABASE_DB_URL / supabase` | 4 / 0 / 2 |
| `grep -c 'connectionTimeoutMillis: 10000'` | 1 |
| `grep -c "await c.query('rollback')"`, inside `finally` | 1, at line 45 inside the `} finally {` at 44 |
| header contains `25P02`, `42501`, `rowCount 0` | 1 / 3 / 2 |
| `Claims` contains `org_id: string` and `o: { id: string` | 1 / 1 |
| `grep -c 'actions/setup-node@v4'` / `setup-node@v5` | 3 / 0 |
| `grep -c 'pnpm/action-setup@v4'`, each before its `setup-node` | 3 — lines 11→12, 39→40, 56→57 |
| `grep -c 'npm ci'` / `'pnpm install --frozen-lockfile'` | 0 / 3 |
| `grep -c 'image: postgres:18'` / `grep -ci 'supabase'` | 1 / 0 |
| `grep -c 'node-version: 24'` | 3 |
| `playwright.config.ts` has `assertRequiredEnv()`, no local-server block | 1 / 0 |
| `grep -c setActive tests/e2e/auth.setup.ts` | 0 |
| `grep -c 'process.env\[k\]' tests/e2e/_required-env.ts` | 1 |
| `.gitignore` contains `tests/e2e/.auth/` | 1 |

### Two things NOT verified locally, stated plainly

- **The CI secrets guard body was not executed here.** The sandbox refuses bash indirect expansion (`${!name}`). The script is ported unchanged in shape from BIS's live `ci.yml:128-139` and survived YAML parsing verbatim, but its first real proof will be the first `push` run.
- **`pnpm verify` still does not work on this machine**, for exactly the reason 01-01's deviation 1 recorded: the composite script shells out to a bare `pnpm`, which resolves to the broken 12.5.1 self-switch shim and dies with `'…\node_modules\pnpm\pnpm' is not recognized`. It never reaches a single constituent. All four constituents were therefore run individually through the launcher, above. **CI on Linux is unaffected** — and `verify` is not a CI step; the `verify` *job* runs `typecheck`, `lint` and `test:unit` as separate `- run:` lines precisely so one broken composite cannot hide three gates.

## Threat Model Coverage

| Threat ID | Disposition | Evidence |
|---|---|---|
| T-1-15 (Tampering / Info Disclosure — `tests/db/_fixtures.ts`) | **mitigated, proven by firing it** | `withRollback` throws before `c.connect()` on both an unset `TEST_DATABASE_URL` and a `pooler.supabase.com` host; both messages captured live. The file greps 0 for the production URL variable name. |
| T-1-19 (Tampering — `ci.yml`) | **mitigated** | `grep -ci 'supabase' .github/workflows/ci.yml` → 0, asserted by the plan's own `node -e`. The only database in CI is the `postgres:18` service container; no paid-API key is referenced anywhere in the file. |
| T-1-10 (Information Disclosure — CI logs, env preamble) | **mitigated** | The preamble interpolates `missing.join(', ')` and nothing else — proven by running it: it printed two NAMES and no values. Every `${{ secrets.* }}` is assigned to `env:` and never echoed; the guard echoes `$missing`, which holds names. |
| T-1-14 (Tampering — supply chain) | **mitigated** | `setup-node@v4` ×3 and `@v5` ×0; `pnpm/action-setup@v4` precedes `setup-node` in all three jobs (line numbers above); `--frozen-lockfile` ×3 and `npm ci` ×0. The incidental lockfile mutation was reverted rather than shipped (Deviation 7). |
| T-1-20 (Repudiation — `auth.setup.ts`) | **mitigated** | `grep -c setActive` → 0. The file states in a comment that the omission is deliberate and that the fix for `/no-access` belongs in plan 08's app code. |

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file-access pattern and no schema — the one new outbound path is Playwright's sign-in, which is disabled by the missing-env guard and is already inside the plan's threat register as T-1-20.

## Known Stubs

| Stub | File | Reason / resolved by |
|---|---|---|
| `tests/db/` contains only `_fixtures.ts`; no test file exists, so `pnpm test:db` exits 1 with `No test files found` | `tests/db/` | Intentional and stated by the plan. **Plan 05** writes the first RLS test. `passWithNoTests` was deliberately NOT set — masking this would also mask a future suite that stopped being discovered. |
| `seedTwoOrgs` inserts into `orgs`, which does not exist yet | `tests/db/_fixtures.ts` | Intentional and stated by the plan; the file typechecks because every table reference is inside a SQL string. **Plan 05** creates the table. |
| `tests/e2e/` contains only the setup, no `*.spec.ts` | `tests/e2e/` | Intentional. **Plan 11** writes the first spec and supplies `E2E_BASE_URL` from the deployment. |

No unintentional stubs: no hardcoded empty collection feeds a UI, and there is no "coming soon" / TODO / FIXME placeholder in any file this plan created.

## Issues Encountered

- **CI's `db` job is EXPECTED to be red until plan 05 lands its first migration.** `pnpm db:migrate` has nothing to apply (plan 01-04 creates the runner and the bootstrap migration; the first schema migration is plan 05's), and `pnpm test:db` has no test files. **Do not disable the job to make it green** — the plan says so explicitly and it is repeated here because a red job is the pressure that gets plan 05 written.
- The `verify` and `e2e` jobs should be green on the first run once the four repository secrets/variables exist; `e2e` is `push`-only and will fail loudly by design until they do.
- Nothing was run against the shared `siteless_test` schema beyond one read inside a rolled-back transaction, so the concurrent plan 01-04 bootstrap was not disturbed.

## User Setup Required

None from this plan directly. Two items are owed by later plans and are recorded here because CI will name them:

- **Repository secrets** `E2E_ADMIN_EMAIL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and the repository **variable** `E2E_BASE_URL` must exist before the `e2e` job can pass (plan 11). Until then it fails with `::error::Missing repository secret(s): …`, which is the designed behaviour.
- `CLERK_TESTING_TOKEN` is minted by `clerkSetup()` from `CLERK_SECRET_KEY`; nothing needs to be set by hand.

## Next Phase Readiness

Ready for **01-05** (RLS), **01-07**, **01-09** — every one of them imports `withRollback` / `actAs` / `actAsRole` / `actAsOwner` / `seedTwoOrgs` and the `Claims` union from `tests/db/_fixtures.ts` by the names fixed in the `<interfaces>` contract, and writes `tests/db/*.test.ts` which `vitest.db.config.ts` already includes.

Carry-forwards:

- **Serial DB suite:** `fileParallelism: false` + `isolate: false`, not `poolOptions`. If a future plan needs to re-tune it, that is the vocabulary vitest 5 has.
- **One refused statement per `withRollback`.** The next statement after a refusal reports `25P02`, not its own reason. The header comment says so where a test author will read it.
- **Cross-org UPDATE/DELETE are filtered to 0 rows, not refused** (D-11a). Plan 05's criterion-2 proof needs BOTH the foreign-org INSERT (`42501`) and the zero-row assertions.
- **`package.json`'s `test:db` line changed** and `package.json` belongs to neither wave-1 plan's `files_modified`. Confirm it survives the merge.
- **Revert `pnpm-lock.yaml`** after running pnpm through the Node launcher unless a dependency genuinely changed.
- No blockers.

## Self-Check: PASSED

- All 8 created files verified present on disk with `ls -la`, and all 8 verified tracked with `git ls-files`. `.gitignore` and `package.json` verified modified and tracked.
- All three task commits verified in `git log`: `283d27e`, `dfbacae`, `d13f274`, each a child of the expected base `6777491`.
- `git diff --diff-filter=D HEAD~1 HEAD` empty for all three commits — no file was deleted.
- `git check-ignore -q .env.local` exits 0; `.env.local` never appeared in `git status --short` and is in no commit.
- `.planning/STATE.md`, `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` are unmodified (`git status --short` clean before this SUMMARY was written); no file belonging to plan 01-04 (`drizzle.config.ts`, `drizzle/0000_bootstrap.sql`, `scripts/db.ts`, `scripts/check-test-db.ts`, `src/db/schema/index.ts`) exists in this worktree.
- Branch `worktree-agent-ae2f47c3c34419ebc` throughout; never a protected ref, never `git clean`, never `git update-ref`.

---

_Phase: 01-foundations-tenancy_
_Completed: 2026-09-22_

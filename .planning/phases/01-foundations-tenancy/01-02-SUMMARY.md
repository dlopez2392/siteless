---
phase: 01-foundations-tenancy
plan: 02
subsystem: infra
tags: [postgres, postgresql-18, supabase, clerk, env-vars, local-dev, rls-harness]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 01)
    provides: "Repo scaffold and .gitignore with the !.env.example negation, which is what makes .env.example committable"
provides:
  - "A native PostgreSQL 18.6 server running on this machine with a `siteless_test` database at localhost:5432 — the target of every DB test in plans 04, 05, 07 and 09"
  - "`.env.example` — the complete list of variable NAMES this phase needs, values stripped"
  - "`docs/local-postgres.md` — the install + database-creation + connection-string recipe, including the 'do not install Supabase CLI' note (D-09)"
  - "`TEST_DATABASE_URL` in .env.local pointing at the local server, proven to contain no `supabase` substring (D-04)"
  - "`SUPABASE_DB_URL` in .env.local — Supabase session pooler on port 5432, not the IPv6-only direct address"
  - "`SUPABASE_DB_POOL_URL` in .env.local repointed at the local server for dev; the production value preserved as a comment for plan 10"
  - "Four dashboard facts confirmed by eye and recorded verbatim below (Clerk org creation OFF, membership required ON, one org with one membership, Supabase third-party auth ENABLED)"
affects:
  [
    01-03-test-harness,
    01-04-drizzle-bootstrap,
    01-05-rls,
    01-07,
    01-08-clerk-shell,
    01-09,
    01-10-vercel,
  ]

# Tech tracking
tech-stack:
  added:
    - "PostgreSQL 18.6 for Windows (EDB installer, native — not Docker, not WSL)"
  patterns:
    - "Three distinct database URL NAMES, never interchangeable: TEST_DATABASE_URL (tests + local migrations, owner role), SUPABASE_DB_POOL_URL (runtime), SUPABASE_DB_URL (migrations only, session pooler)"
    - "A production connection string that must not be active locally is kept in .env.local as a commented `# PROD (Vercel only, plan 10): ...` line rather than deleted — the value survives to plan 10 without being reachable by a test"
    - ".env.example carries NAMES only; every line ends at the `=`. Values live solely in the gitignored .env.local"
    - "Manual, CLI-less verifications are recorded verbatim in the SUMMARY with their provenance — that record is the artifact /gsd-verify-work reads"

key-files:
  created:
    - .env.example
    - docs/local-postgres.md
  modified: []

key-decisions:
  - "D-05a executed: PostgreSQL 18.6 installed natively on Windows via the EDB installer, because `docker` resolves nowhere and `wsl --status` reports 'not installed' on this machine. D-04's `supabase start` path is unavailable and D-05's ~$10/mo second-Supabase-project fallback is NOT used."
  - "SUPABASE_DB_POOL_URL was repointed at the local `siteless_test` database for dev; the production transaction-pooler value stays in .env.local as a commented `# PROD (Vercel only, plan 10):` line so plan 10 can lift it onto Vercel without a dashboard round trip."
  - "The Clerk and Supabase dashboard facts were read from the dashboards in Chrome by the orchestrator at danlo's request ('Check it for me in Chrome'), not asserted by danlo from memory and not read by any CLI — no CLI exists for any of them."

patterns-established:
  - "Checkpoint evidence discipline: every acceptance criterion is proven by a count (grep -c) or a boolean, never by printing a credential. No value from .env.local appears in this summary, in a commit, or in the transcript."

requirements-completed: [FOUND-01, FOUND-02]

# Metrics
duration: 21 min
completed: 2026-09-22
---

# Phase 01 Plan 02: Local PostgreSQL 18, Connection Strings and Dashboard Confirmations Summary

**A native PostgreSQL 18.6 server with a `siteless_test` database now answers on localhost:5432 — the RLS/grant/constraint suite has a target that is provably not the production Supabase project — plus `.env.example` and `docs/local-postgres.md` committed with zero values, three distinctly-named database URLs set in the gitignored `.env.local`, and the two Clerk organization settings and the Supabase third-party-auth state confirmed by reading the dashboards.**

## Performance

- **Duration:** 21 min wall clock (includes the two human-action checkpoints, which danlo answered in a single prompt)
- **Started:** 2026-09-22T01:39:00Z (Task 1, first executor)
- **Completed:** 2026-09-22T02:00:00Z
- **Tasks:** 3 (1 auto, 2 checkpoint:human-action)
- **Files modified:** 2 tracked files created; `.env.local` edited by danlo/orchestrator (gitignored, never staged)

## Accomplishments

- The phase's only hard blocker is cleared: PostgreSQL **18.6** is installed, the `postgresql-x64-18` service is RUNNING, TCP 5432 is LISTENING, and a read-only query issued through `TEST_DATABASE_URL` returned `siteless_test` from `pg_database`. Plans 04, 05, 07 and 09 can now run.
- D-04 is enforced by evidence, not intent: the `TEST_DATABASE_URL` line contains `localhost` and `siteless_test` and **zero** occurrences of the substring `supabase`. The production project `jahgeqshuesndyscnmjo` cannot be a test target by typo.
- D-02 is confirmed rather than assumed — 01-RESEARCH.md Assumptions Log A5 flagged the Clerk organization setting as never having been read from the dashboard. It has now been read: **"Allow user-created organizations" is OFF** (`name=create_organization`, `checked=false`) and **"Membership required" is SELECTED**. No Google sign-in can mint an empty tenant.
- `SUPABASE_DB_URL` is the **session** pooler on port **5432**, and is proven **not** to be the `db.jahgeqshuesndyscnmjo.supabase.co` direct address, which is IPv6-only without the IPv4 add-on and would make GitHub-hosted CI hang to vitest's ceiling instead of failing with one nameable error (T-1-18).
- Two committed files, zero secret values: every non-comment line in `.env.example` ends at the `=` (14 lines checked, 0 with anything after the `=`).

## Task Commits

1. **Task 1: Write `.env.example` and `docs/local-postgres.md`** — `ff2f83c` (docs)
2. **Task 2: [danlo] Install PostgreSQL 18 and set `TEST_DATABASE_URL`** — no commit (checkpoint; only the gitignored `.env.local` changed)
3. **Task 3: [danlo] Add `SUPABASE_DB_URL` and confirm the Clerk + Supabase dashboard settings** — no commit (checkpoint; only the gitignored `.env.local` changed)

**Plan metadata:** this SUMMARY (docs: complete plan)

## Files Created/Modified

- `.env.example` — every variable name this phase needs (Clerk, Supabase, the three database URLs, Playwright), each line ending at the `=`, with the comments that explain which pooler mode and port each URL is and the 🔴 D-04 warning on `TEST_DATABASE_URL`
- `docs/local-postgres.md` — the six-step recipe: EDB installer, `psql --version`, `create database siteless_test`, the two `.env.local` lines, why Docker/WSL are unavailable, and what this database must never be; plus the "do not install Supabase CLI / do not run `supabase db push`" note referencing D-09

## Verification Results

All commands were run from `C:\Users\danlo\prospector` on `main`. Counts only — no value from `.env.local` was printed at any point.

### Task 1 (re-verified this session)

| Check                                                    | Result                                          |
| -------------------------------------------------------- | ----------------------------------------------- |
| Task 1 commit `ff2f83c` present in `git log`              | PASS                                            |
| `.env.example` and `docs/local-postgres.md` exist on disk | PASS (1360 B / 3398 B)                          |
| `.env.example` non-comment lines with anything after `=`  | 0 of 14 — PASS                                  |
| `docs/local-postgres.md` contains `siteless_test`         | PASS                                            |
| contains `create database siteless_test`                  | PASS                                            |
| contains `app_user`                                       | PASS                                            |
| contains the `D-09` Supabase-CLI note                     | PASS                                            |
| `git check-ignore -q .env.example`                        | exit 1 — the file IS committable — PASS         |
| `git check-ignore -q .env.local`                          | exit 0 — still ignored — PASS                   |

### Task 2

Plan's automated verify, run literally — `grep -c '^TEST_DATABASE_URL=' .env.local | grep -qx 1 && grep -c '^SUPABASE_DB_POOL_URL=' .env.local | grep -qx 1 && test "$(grep '^TEST_DATABASE_URL=' .env.local | grep -c supabase)" -eq 0 && echo ok` → **`ok`**.

| Check                                                | Count | Verdict                      |
| ---------------------------------------------------- | ----- | ---------------------------- |
| `^TEST_DATABASE_URL=` lines                           | 1     | PASS                         |
| `^SUPABASE_DB_POOL_URL=` lines                        | 1     | PASS                         |
| `supabase` substring on the `TEST_DATABASE_URL` line  | 0     | PASS — D-04 holds            |
| `localhost` on the `TEST_DATABASE_URL` line           | 1     | PASS                         |
| `siteless_test` on the `TEST_DATABASE_URL` line       | 1     | PASS                         |
| `localhost` on the `SUPABASE_DB_POOL_URL` line        | 1     | PASS — repointed to local    |
| `^# PROD (Vercel only, plan 10): SUPABASE_DB_POOL_URL=` lines | 1 | PASS — prod value preserved |
| `git status --short` lists `.env.local`               | no (working tree clean) | PASS       |

Human-side evidence for Task 2, gathered on this machine by the orchestrator (2026-09-22) after danlo's "postgres ready":

- `"C:\Program Files\PostgreSQL\18\bin\psql" --version` → `psql (PostgreSQL) 18.6` (satisfies the plan's `psql (PostgreSQL) 18.x` criterion).
- Windows service `postgresql-x64-18` is **RUNNING**; TCP **5432** is **LISTENING**.
- A read-only query issued through `TEST_DATABASE_URL` returned `siteless_test` from `pg_database` and server version `PostgreSQL 18.6 on x86_64-windows` — this supersedes the plan's weaker `psql -U postgres -l` criterion by proving the configured URL actually reaches the database, not merely that the database exists.

### Task 3

Plan's automated verify, run literally — `grep -c '^SUPABASE_DB_URL=' .env.local | grep -qx 1 && grep '^SUPABASE_DB_URL=' .env.local | grep -q ':5432' && test "$(grep '^SUPABASE_DB_URL=' .env.local | grep -c 'db\.jahgeqshuesndyscnmjo\.supabase\.co')" -eq 0 && echo ok` → **`ok`**.

| Check                                                                 | Count | Verdict                         |
| --------------------------------------------------------------------- | ----- | ------------------------------- |
| `^SUPABASE_DB_URL=` lines                                              | 1     | PASS                            |
| `:5432` on that line                                                   | 1     | PASS — session pooler, not 6543 |
| `db.jahgeqshuesndyscnmjo.supabase.co` on that line                     | 0     | PASS — not the IPv6-only direct address |
| `git status --short` lists `.env.local`                                | no    | PASS                            |

## Manual verifications

The five-line status block the plan requires, **verbatim**:

```
SUPABASE_DB_URL: set (session pooler, 5432)
org creation: off
membership required: on
orgs: 1, danlo is a member of 1
third-party auth: enabled
```

Provenance of each line — **note for `/gsd-verify-work`: the `must_haves.truths` about the Clerk organization settings and the Supabase third-party-auth state were read from the vendor dashboards in Chrome by the orchestrator, not produced by any CLI. No CLI exists for any of them in this environment. There is no command a verifier can re-run to confirm them; the dashboard reads below are the record.**

| Line                                             | Source                                        | Detail                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_DB_URL: set (session pooler, 5432)`    | Orchestrator, grep against `.env.local`, 2026-09-22 | Exactly one `^SUPABASE_DB_URL=` line; contains `:5432`; contains zero occurrences of `db.jahgeqshuesndyscnmjo.supabase.co`. Value never printed.                                                                                                              |
| `org creation: off`                              | **Orchestrator dashboard read**, 2026-09-22 — danlo chose "Check it for me in Chrome" | Clerk Dashboard → app **Siteless** → **Development** instance → **Configure → Organizations → Settings**. The "Allow user-created organizations" switch (`name=create_organization`) read `checked=false`, i.e. OFF.                                            |
| `membership required: on`                        | **Orchestrator dashboard read**, 2026-09-22 — danlo chose "Check it for me in Chrome" | Same page. The "Membership required" radio was SELECTED. Also observed on that page: verified domains OFF, organization slugs OFF, create-first-org-automatically OFF, membership limit 5.                                                                      |
| `orgs: 1, danlo is a member of 1`                | **danlo's own answer**, 2026-09-22             | danlo answered "1 org exists, I'm a member of exactly 1". Exactly one membership is the precondition `ActivateSoleOrganization` (plan 08) depends on.                                                                                                          |
| `third-party auth: enabled`                      | **Orchestrator dashboard read**, 2026-09-22 — danlo chose "Check it for me in Chrome" | Supabase Dashboard → project **siteless** (ref `jahgeqshuesndyscnmjo`) → **Authentication → Sign In / Providers → Third-Party Auth**. Clerk is listed **ENABLED** with domain `https://equipped-newt-5148.clerk.accounts.dev`.                                  |

This closes **01-RESEARCH.md Assumptions Log A5**, which recorded the Clerk organization setting as assumed and never read from the dashboard. It is now read.

## Decisions Made

- **D-05a executed, D-05 not used.** PostgreSQL 18.6 installed natively on Windows through the EDB GUI installer. Docker Desktop and WSL were both verified absent (2026-09-20), so D-04's `supabase start` path does not exist here; the ~$10/mo second-Supabase-project fallback in D-05 is superseded and was **not** purchased.
- **`SUPABASE_DB_POOL_URL` points at local, with production preserved as a comment.** See the Rule 3 deviation below. Rationale: an active production transaction-pooler URL sitting in `.env.local` is one mistaken `--target` away from plan 04's migration runner writing to production, and plan 04's guard only inspects `TEST_DATABASE_URL`. Commenting it keeps the value for plan 10 while making it unreachable by any process that reads the environment.
- **The dashboard facts were read by the orchestrator, not asserted by danlo.** danlo was offered both "I'll check" and "Check it for me in Chrome" and picked the latter for the two vendor settings. This is strictly stronger evidence than a remembered answer, but it is still a human-eye read with no re-runnable command — hence the provenance table above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 1's `<verify><automated>` one-liner can never pass on a correct `.env.example`**

- **Found during:** Task 1 (first executor)
- **Issue:** The script strips comment lines, **joins the remainder with `\n`**, then tests the joined string with `/=\s*\S/`. Because `\s` matches `\n`, every `=` in a multi-variable file is "followed by whitespace then a non-space character" — namely the first character of the **next line**. Proven: `/=\s*\S/.test("A=\nB=")` → `true` (re-proven this session). Any `.env.example` with two or more variables therefore throws `.env.example has a value after an =`, regardless of whether any value is present. The bug is in the check, not in the file.
- **Fix:** The first executor ran the literal script first (it threw, as predicted), then verified the criterion's **stated intent** — "every non-comment line ends at the `=`" — per line rather than on the joined string. Result: **14 non-comment lines, 0 with any character after the `=`**. Re-run and reconfirmed this session. `PLAN.md` was **not** edited (a plan is a contract, not a scratchpad), and no code was changed — the file was already correct.
- **Files modified:** none (verification-method change only)
- **Verification:** `node -e "const lines=fs.readFileSync('.env.example','utf8').split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#'));const bad=lines.filter(l=>/=\s*\S/.test(l));"` → `non-comment lines: 14 | lines with anything after =: 0`
- **Committed in:** `ff2f83c` (Task 1 commit — the file, not the check)
- **🔴 Carry-forward for `/gsd-verify-work`:** re-running the plan's literal Task 1 one-liner **will throw again**. That throw is the known-broken regex above, not a regression. Judge Task 1 by the per-line check.

**2. [Rule 3 - Blocking] `SUPABASE_DB_POOL_URL` held a production value that would have been active locally**

- **Found during:** Task 2 (checkpoint resolution)
- **Issue:** `.env.local` already carried `SUPABASE_DB_POOL_URL` set to the production Supabase **transaction** pooler. The plan (Task 1 `.env.example` comments, Task 2 step 5, and `docs/local-postgres.md` step 4) requires the local value `postgres://app_user:app_user@localhost:5432/siteless_test`. Leaving production active would mean the local runtime, and anything in plans 04–09 that opens the runtime pool, transacts against the production database — the same class of failure D-04 exists to prevent, one variable over. Deleting the production value outright would lose it before plan 10 needs it on Vercel.
- **Fix:** With danlo's explicit approval ("Repoint to local (Recommended)"), the production line was commented as `# PROD (Vercel only, plan 10): SUPABASE_DB_POOL_URL=…` and an active local line was added below it. The production value survives in the file for plan 10 and is unreachable by any process reading the environment.
- **Files modified:** `.env.local` (gitignored — never staged, never committed; `git status --short` is clean of it)
- **Verification:** `grep '^SUPABASE_DB_POOL_URL=' .env.local | grep -c localhost` → `1`; `grep -c '^# PROD (Vercel only, plan 10): SUPABASE_DB_POOL_URL=' .env.local` → `1`; `grep -c '^SUPABASE_DB_POOL_URL=' .env.local` → `1` (exactly one active line)
- **Committed in:** no commit — the only changed file is gitignored by design

---

**Total deviations:** 2 auto-fixed (1 bug in a verification script, 1 blocking environment misconfiguration).
**Impact on plan:** No scope creep. Neither deviation changed a plan artifact: deviation 1 changed only *how* an already-correct file was checked, and deviation 2 touched only the gitignored `.env.local`. Both were necessary — deviation 1 to avoid recording a false failure, deviation 2 to keep a production database out of every subsequent plan's runtime path.

## Issues Encountered

- **Two blocking human-action checkpoints in one plan.** The plan was correct to stop: there is no scriptable path to a GUI installer, and no CLI in this environment reads Clerk organization settings or Supabase third-party-auth state. Both were presented together in a single prompt and answered together, so the plan cost one interruption rather than two.
- **Three of the four Task 3 facts are unverifiable by machine.** Mitigated by the provenance table under "Manual verifications" — each line names whether it came from danlo or from an orchestrator dashboard read, with the exact dashboard path and the date. A future verifier that finds these unprovable by CLI should read that table rather than mark them failed.

## Threat Model Coverage

| Threat  | Disposition | Evidence in this plan                                                                                                                                           |
| ------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1-15  | mitigated   | `TEST_DATABASE_URL` is a distinct NAME from `SUPABASE_DB_URL`; its line greps **0** for `supabase` and **1** each for `localhost` and `siteless_test`.             |
| T-1-17  | mitigated   | Clerk org creation read OFF and membership-required read ON from the dashboard 2026-09-22, recorded verbatim above. Closes research assumption A5.                 |
| T-1-10  | mitigated   | `.env.example` has 0 of 14 non-comment lines with anything after the `=`. `git status --short` is clean of `.env.local`. No value appears in any file or commit.   |
| T-1-18  | mitigated   | `SUPABASE_DB_URL` contains `:5432` and **0** occurrences of `db.jahgeqshuesndyscnmjo.supabase.co`.                                                                 |

## User Setup Required

Complete — this plan **was** the user setup. `user_setup` in the plan frontmatter named three services; all three are now configured:

- **postgresql-18-local** — installed (18.6), `siteless_test` created, `TEST_DATABASE_URL` and `SUPABASE_DB_POOL_URL` set.
- **supabase** — `SUPABASE_DB_URL` set to the session pooler; Clerk third-party auth confirmed ENABLED.
- **clerk** — membership required ON, user-created organizations OFF, one organization with danlo as its sole membership.

One item is deliberately deferred: the **production** `SUPABASE_DB_POOL_URL` (transaction pooler, port 6543, user `app_user.jahgeqshuesndyscnmjo`, driver `prepare: false`) must be set as a Vercel environment variable in **plan 10**. Its value is preserved in `.env.local` on the `# PROD (Vercel only, plan 10):` comment line.

## Next Phase Readiness

- **Plan 03 (test harness)** and **plan 04 (drizzle bootstrap)** are unblocked — `TEST_DATABASE_URL` resolves to a live PostgreSQL 18.6 server.
- **Plan 04** will create the `app_user` role and its local password via `drizzle/0000_bootstrap.sql`. Until it runs, the `SUPABASE_DB_POOL_URL` local line is syntactically correct but **cannot connect** — this is expected and documented in `docs/local-postgres.md` step 4. A connection failure from that URL before plan 04 is not a bug.
- **Plan 08** can rely on exactly one Clerk organization with exactly one membership, which is what `ActivateSoleOrganization` needs.
- **Plan 10** must set the production `SUPABASE_DB_POOL_URL` on Vercel; the value is in `.env.local` as a comment, not in git.
- No blockers.

## Self-Check

Claims verified against disk and git, 2026-09-22:

| Claim                                              | Command                                             | Result                       |
| -------------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| `.env.example` exists                               | `ls -la .env.example`                                | FOUND (1360 B)               |
| `docs/local-postgres.md` exists                     | `ls -la docs/local-postgres.md`                      | FOUND (3398 B)               |
| Task 1 commit exists                                | `git log --oneline -12 \| grep ff2f83c`              | FOUND                        |
| On `main`, working tree clean                       | `git rev-parse --abbrev-ref HEAD`, `git status --short` | `main`, empty             |
| Task 2 automated verify (plan literal)              | see Verification Results                             | `ok`                         |
| Task 3 automated verify (plan literal)              | see Verification Results                             | `ok`                         |
| No tracked file outside this SUMMARY changed        | `git status --short`                                 | empty before the SUMMARY write |

## Self-Check: PASSED

---

_Phase: 01-foundations-tenancy_
_Completed: 2026-09-22_

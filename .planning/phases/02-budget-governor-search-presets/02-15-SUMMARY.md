---
phase: 02-budget-governor-search-presets
plan: 15
subsystem: testing
tags: [playwright, vitest, mutation-testing, postgres, vercel, ci, grants, e2e]

# Dependency graph
requires:
  - phase: 02-14
    provides: production Supabase migrated 0000-0016 by drizzle-kit, seeded, and the BUDG-03 / Vercel Pro checkpoints answered
  - phase: 02-08
    provides: the meter proofs (40-way burst, thresholds, admin gate) and the first execution of M7-M10
  - phase: 02-06
    provides: the versioning proofs and the first execution of M12
  - phase: 01-11
    provides: the deploy-verify-smoke discipline and the 01-VALIDATION format precedent
provides:
  - A production deployment of a known commit with every e2e spec green against it
  - danlo's recorded design sign-off on the deployed app
  - M7-M12 recorded AS RUN, thirteen mutations, each direction-checked and reverted from a pre-mutation catalog capture
  - A closed 02-VALIDATION.md - status complete, nyquist_compliant true, 74 task rows with real statuses
  - The five ROADMAP success criteria closed, each citing named tests
  - A new column-privilege guard on search_versions, written because a mutation survived
  - PR #1, open and unmerged, with verify and db green on its head
affects: [phase-03-free-data-spine, phase-04-places-verification, gsd-verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A spec that writes to a database self-skips unless the target is backed by that same database, and names the test that carries its requirement instead"
    - "A gate mutation is applied to the live database, direction-checked against a positive control, and reverted against a capture taken BEFORE any mutation - never against a re-read"
    - "A mutation that survives is the most informative result: it is written up and answered with a new guard, not a note"
    - "Every generated/gitignored output directory belongs in eslint's ignores, not just gitignore"

key-files:
  created:
    - .planning/phases/02-budget-governor-search-presets/02-15-SUMMARY.md
  modified:
    - .planning/phases/02-budget-governor-search-presets/02-VALIDATION.md
    - .planning/phases/02-budget-governor-search-presets/deferred-items.md
    - tests/e2e/preset-detail.spec.ts
    - tests/db/grants-audit.test.ts
    - eslint.config.mjs
    - docs/deploy.md

key-decisions:
  - "danlo: e2e fixture option 3 - preset-detail.spec.ts self-skips unless E2E_BASE_URL is local; SRCH-03 is carried in CI by tests/db/versioned-presets.test.ts"
  - "danlo: design approved on the deployed app, seven screens, both themes, phone and desk"
  - "danlo: the four deployed state shots (80%, 100%, refused run, assumptions drawer) defer to Phase 4"
  - "BUDG-03 stays OPEN - blocked on a Google Cloud project that does not exist, carried to Phase 4, blocking nothing in Phase 2"
  - "M12b survived the suite and produced a real defect: a column-level UPDATE grant on search_versions was invisible to every test. Fixed rather than noted"

patterns-established:
  - "Read the red set against the prediction, never the exit code: a source mutation whose anchor misses under CRLF, and a DDL mutation that aborts leaving the previous one applied, both produce a run that lies about which mutation it measured"
  - "A permanently skipped test reads the same as a passing one in a summary line - name every skip, its reason, and when it stops skipping"

requirements-completed: [BUDG-01, BUDG-02, BUDG-04, SRCH-01, SRCH-02, SRCH-03, SRCH-04]

# Metrics
duration: 42min (this continuation; Task 1 ran in a prior dispatch)
completed: 2026-09-22
---

# Phase 2 Plan 15: Deploy, E2E on the Real URL, Gate Mutations M7–M12, Close VALIDATION Summary

**Every Phase 2 guard watched red under its own mutation against the live database — thirteen of them, one of which survived and produced a real column-grant defect — with the whole e2e suite green against the deployed app, danlo's design sign-off recorded, and the validation contract closed at unit 76 / db 90 / e2e 21.**

## Performance

- **Duration:** 42 min for this continuation (Task 1 and the Task 2 capture ran in a prior dispatch; the checkpoint wait is excluded)
- **Started:** 2026-09-22T18:20Z (continuation), Task 1 at ~2026-09-22T17:50Z
- **Completed:** 2026-09-22T18:50Z
- **Tasks:** 3 of 3
- **Files modified:** 6 (5 in this continuation + `docs/deploy.md` in Task 1)

## Accomplishments

- A production deployment of a **known** commit, smoked and proven, with all six new routes refusing a signed-out visitor.
- The full e2e suite green against that deployment — **15 passed, 6 skipped, 0 failed** — after danlo's decision resolved the cross-database fixture blocker.
- **Thirteen gate mutations** run against the live local database, every red set read by test NAME, every direction checked, every revert proven byte-for-byte from the catalog.
- A **surviving mutation** (M12b) found a column-level grant hole in SRCH-03's defence, now closed by a new assertion.
- `02-VALIDATION.md` closed: 74 task rows, no pending row, the five ROADMAP criteria each closed in a paragraph citing named tests.
- **PR #1 open and unmerged**, with `verify` and `db` green on its head.

---

## Task 1 — deploy, smoke, and run every e2e spec against the real URL

Committed in the prior dispatch as `9df3985`.

| Fact | Value |
|---|---|
| Pre-deploy sha | `6d6c52f742c2cb5552ea4af533fc5706f55e33c2` |
| Deployment | `dpl_Dk71EVmgcaav2NwhgWQNd65EJBRy`, state **READY** |
| Alias | `https://siteless-iota.vercel.app` |
| Commit the running code reports | **`6d6c52f742c2cb5552ea4af533fc5706f55e33c2`** — identical to the pre-deploy sha |

```
$ curl -fsS https://siteless-iota.vercel.app/api/health
{"ok":true,"db":"up","proxy":"up","commit":"6d6c52f742c2cb5552ea4af533fc5706f55e33c2"}
```

`"db":"up"` is the only proof that Vercel's `SUPABASE_DB_POOL_URL` is the **transaction**
pooler on 6543 as `app_user`; `"proxy":"up"` that `clerkMiddleware` is mounted. The body
carries none of `postgres://`, `password`, `sk_`, or the Supabase project ref.

🔴 **The build log names no sha for this project**, so the sha comparison is made from the
*running code* echoing `VERCEL_GIT_COMMIT_SHA`, not from the log. That is recorded in
`docs/deploy.md` so the next deploy does not look for a line that is not there.

Signed out, each of the six new routes answered `307 → /sign-in` and none carried
`data-testid="org-id"` in its body, followed or unfollowed.

**The blocker Task 1 hit, and why it was not the executor's to fix.** `preset-detail.spec.ts`
failed in `beforeAll` with `searches_org_id_orgs_id_fk` — deterministically, same test, same
line, 10 s solo vs 53 s in the full run. Cause: `withDb()` opens `TEST_DATABASE_URL` (the
**local** database) while `tenantId()` reads the org id from the **deployed** app. Against a
deployed target those are two different databases. Three ways out, each with a real cost, all
recorded in `deferred-items.md` — raised as **Deviation Rule 4** and answered by danlo.

## Task 2 — danlo's review of the seven screens on the deployed app

### danlo's replies, verbatim (2026-09-22)

```
design: approved
e2e fixture: 3: self-skip unless local
state shots: defer to Phase 4
```

And separately in chat: **"I have vercel pro"** — which closes the Phase 9 cron dependency
research could not verify (`vercel teams ls` returned an invalid token).

`design: approved` was given after working the **deployed** app at
`https://siteless-iota.vercel.app` @ `6d6c52f` on a phone and a desk, in both themes. **No
screen was listed as needing work, so there are no numbered follow-ups and nothing is
outstanding against the design bar.**

### Screenshot inventory — recorded as it actually is

🔴 **The 28 deployed base images the plan asks for were not captured, and zero image files
exist on this machine.** Stating that plainly rather than reporting a count nothing backs:

| Plan | Captures claimed | Written to | Alive today? |
|---|---|---|---|
| 02-10 | 8 (banner at both thresholds × 2 viewports × 2 themes) | session scratchpad `02-10-shots/` | ❌ |
| 02-11 | 16 (4 screen-states × 2 viewports × 2 themes) | `test-results/02-11-shots/` in a worktree | ❌ worktree destroyed |
| 02-12 | 16 | `test-results/shots/` in a worktree | ❌ worktree destroyed |
| 02-13 | 44 (screen × state × theme × viewport) | `coverage/shots/` | ❌ |
| 02-15 | 0 deployed captures | — | — |
| **Total** | **84**, all of the **BUILT** app via `next start`, never dev mode, never a styleguide page | all gitignored run evidence | **0 files remain** |

What survives — and is the evidence that actually discriminates — is each SUMMARY's
inventory table plus the **computed-style probes** recorded beside them. A screenshot cannot
prove which theme it was taken in; `getComputedStyle(document.body).backgroundColor`
returning `rgb(244, 246, 247)` light vs `rgb(14, 20, 22)` dark can, and 02-12 recorded exactly
that. 02-10 additionally recorded the cap before and after driving the banner states, read
back from `budget_periods`, and `window.innerHeight > 0` asserted before every capture.

The 28 deployed captures existed to let danlo judge the screens. **He judged the deployed
screens directly instead**, which is the stronger form of the same evidence. The four state
shots are formally **deferred to Phase 4** by his decision.

## Task 3 — the phase gate

### Applying danlo's decision 3, and the deployed e2e run

`tests/e2e/preset-detail.spec.ts` now carries a file-level `test.skip(!TARGET_IS_LOCAL, …)`
whose predicate parses `E2E_BASE_URL` and fires unless the hostname is `localhost`,
`127.0.0.1`, `::1` or `[::1]`. **No test was deleted and no assertion weakened.** The skip
reason names, in full, the test that carries SRCH-03 in CI:
`tests/db/versioned-presets.test.ts → run keeps its version after the preset moves on` —
watched red under 02-06's M12 grant mutation, and run by CI's `db` job on every push, which
this spec has never run in at all.

**Direction checked**, because a guard that fires unconditionally is indistinguishable from a
working one:

```
playwright test tests/e2e/preset-detail.spec.ts --list --reporter=json
  E2E_BASE_URL = production          -> all three SKIP-ANNOTATED
  E2E_BASE_URL = http://localhost:3000 -> all three WILL RUN
```

This also closes a hole nobody had observed: `TEST_DATABASE_URL` is undefined on a CI runner,
so this file would have thrown `preset-detail.spec: TEST_DATABASE_URL is not set` on the first
push of the branch.

### The full deployed e2e run — every test by NAME

`pnpm test:e2e` against `https://siteless-iota.vercel.app`, **43.2 s wall clock**
(the failing run was 53 s; the solo failing spec was 10 s):

```
✓  1 [setup]   authenticate (3.1s)
✓  2 budget banner: absent under 80 percent (1.5s)
-  3 budget banner: renders on every route at 80 percent
-  4 budget banner: is not dismissible
✓  5 no access: a signed-out visitor never reaches the org-scoped shell (1.9s)
✓  6 no access: /no-access renders the invite-only message (960ms)
-  7 preset detail: a saved edit shows two versions and the run keeps the old one
-  8 preset detail: duplicate creates a new preset at version 1
-  9 preset detail: run this preset queues a run
✓ 10 create preset: cities (5.7s)
✓ 11 create preset: county (3.6s)
✓ 12 create preset: radius (5.1s)
✓ 13 preset editor: the Texas row carries a computed multiplier, not a literal (1.5s)
✓ 14 signs in and is org-scoped (1.1s)
✓ 15 spend: month-to-date, the gauge and all three providers render (1.3s)
✓ 16 spend: the by-run tab reports its own state (1.0s)
- 17 spend: the by-run tab lists a queued run
✓ 18 theme tokens: the accent resolves in light (1.4s)
✓ 19 theme tokens: the accent resolves in dark (1.8s)
✓ 20 theme tokens: the page background matches the painted token (2.1s)
✓ 21 touch targets: every primary control clears 44px at 390x844 (2.5s)

  6 skipped
  15 passed (43.2s)
```

**Task 1's run, for comparison:** 15 passed / 1 failed / 3 skipped / 2 did not run — the
single failure being `preset detail: a saved edit shows two versions…` in `beforeAll`.

🔴 **Each of the six skips is named with its reason in `02-VALIDATION.md`**, because a skip
reads the same as a pass in a summary line. Three are the preset-detail decision above; the
other three (`budget banner: renders on every route at 80 percent`, `budget banner: is not
dismissible`, `spend: the by-run tab lists a queued run`) assert against **committed spend**,
and production spend is $0 until Phase 4 calls Places. All six stop skipping in Phase 4 or
against a local target.

### M7–M12, as run

Thirteen mutations, each applied to the **live local `siteless_test`** (PostgreSQL 18.6),
never to a migration file. Pre-mutation capture taken first: `reserve_budget` 5249 chars / 0
CR, `settle_reservation` 3103 / 0 CR, `current_org_role` 287 / 0 CR — **the same lengths
02-08 recorded**, which is itself a check that the database had not drifted between plans.

| # | Mutation as run | Red, by NAME | Direction check |
|---|---|---|---|
| **M7** | **Surgical** — only `app.reserve_budget`'s step-2 conditional UPDATE swapped for SELECT-then-UPDATE | all three `concurrent burst` tests (3) | **87 single-worker tests stayed green** — the property that proves the concurrency file is not redundant |
| **M7+M8** | both walls down | the same three | `granted=34 denied=6 errors=0 reserved=340` vs a cap of **100** — a **3.4× over-spend** |
| **M8** | `drop constraint bp_not_over` | `bp_not_over refuses a hand-written over-reserve`, `cap below current spend is refused` (2) | `cap at exactly spent plus reserved is accepted` ✓ green **by name** |
| **M8b** | narrower: `check (reserved_micro_usd <= cap_micro_usd)` — `spent` dropped from the sum | `cap below current spend is refused` (**1**) | `bp_not_over refuses a hand-written over-reserve` ✓ green — the two are not redundant |
| **M9** | `drop constraint cost_ledger_request_id_key` | `settlement idempotency`, `settlement: reserve the worst case`, `zero-cost paid-SKU`, `cost_cents` (**4**) | the index is the `on conflict` arbiter; without it every settlement raises `42P10` |
| **M9b** | surgical: delete only `on conflict (request_id) do nothing` | `settlement idempotency: settle twice with one request_id` (**1**), raising `duplicate key … cost_ledger_request_id_key` | the other three settlement tests green |
| **M10** | `current_org_role()` returns the literal `'admin'` | `current_org_role returns null for a member`, `set_budget_cap refuses a member` (2) | `set_budget_cap accepts an admin` ✓ green **by name** |
| **M10b** | resolver byte-identical, admin gate deleted from `set_budget_cap` | `set_budget_cap refuses a member` (**1**) | proves the gate and the resolver are **independent** |
| **M11** | append `places.reviews` to `PLACES_TEXT_SEARCH_FIELD_MASK` | `fieldMaskTier atmosphere…` **and** `price book atmosphere…` (2, two files) | see the CRLF note below |
| **M11b** | mask untouched; atmosphere price 40000 → 35000 | `price book atmosphere…` (**1**) | `fieldMaskTier atmosphere` ✓ green — the halves rest on **different objects** |
| **M12** | `grant update on public.search_versions to authenticated` | `versions immutable: UPDATE as authenticated is refused` **and** `authenticated holds exactly the DML each Phase 2 table needs` (2) | `run keeps its version after the preset moves on` ✓ green **by name** |
| **M12-delete** | `grant delete …` | `versions immutable: DELETE …` + the sentinel — **not** the UPDATE test | UPDATE and DELETE rest on **separate grants** |
| **M12b** | `grant update (geo_payload) on public.search_versions to authenticated` | 🔴 **NOTHING. 90 passed.** | see below |

Every revert verified **byte-for-byte against the pre-mutation capture** —
`pg_get_functiondef`, `pg_constraint`, `pg_indexes`,
`information_schema.role_table_grants` — all six objects `IDENTICAL`. `git diff --stat` empty
after every database mutation; the two source mutations (M11, M11b) reverted with
`git checkout --` and diffed back to empty.

### Three divergences from the planned recipes — the executed one is authoritative

1. **M7 alone does not over-spend.** `bp_not_over` is a second wall underneath the conditional
   UPDATE, so the naive body's unconditional UPDATE violates it and 28–30 workers get `23514`
   instead of a reservation. The meter's contract (*a denial is zero rows, never an
   exception*) is still broken and the burst test reds either way, but RESEARCH's measured
   over-spend only reproduces with **both** walls down. Matches 02-08's finding.
2. **M9 reds four tests, not one.** The UNIQUE index is the arbiter of `on conflict`. M9b is
   the one-test discriminator.
3. **M12 reds two, not one.** 02-06 recorded one because it ran only its own 12-test file,
   before 02-05's grants sentinel covered this table. Against the full 90-test suite the
   sentinel reds too. Not a coupling to fix — a sentinel doing its job.

### 🔴 M12b survived, and that is the most valuable result in this plan

`grant update (geo_payload) on public.search_versions to authenticated` left the **entire
90-test suite green** while
`has_column_privilege('authenticated','public.search_versions','geo_payload','UPDATE')` read
**TRUE**. A tenant could have rewritten a stored version's geography — precisely what SRCH-03
and T-2-12 forbid — because:

- the table-level row stays `[t,t,f,f]`: `has_table_privilege` is **blind to column grants**;
- `versions immutable: UPDATE as authenticated is refused` updates `geo_kind`, a column the
  grant did not name.

The standing question when a mutation survives is *what else is already doing the job*, not
*strengthen the test*. The answer was **nothing** — and the sentinel already carried this
exact check for `budget_periods`, `cost_reservations`, `cost_ledger` and `runs`, with its own
comment explaining why. It simply never covered `search_versions`. Extended there (`98d99ff`)
and watched **both ways**: green against the real grants → red under M12b → green after the
revoke.

### Two new ways a mutation run can lie, both paid for here

Both were caught by **reading the red set against the prediction**, and neither would have
been caught by an exit code:

1. **A source mutation whose anchor misses produces a green suite that looks like a surviving
   mutation.** M11's first attempt used an LF anchor against a CRLF file; nothing was applied
   and 76 tests passed. This is the CRLF lesson 02-08 recorded for function reverts, showing
   up on the *apply* side.
2. **A DDL mutation that aborts leaves the PREVIOUS mutation in place, and the run then
   reports the previous mutation's red set under the new one's name.** M8b's first attempt
   died on `42704` (M8 had already dropped the constraint) and the suite ran under M8 while
   the log said M8b.

### Final gate

All five constituents individually through the pinned store launcher:

| Constituent | Exit | Result |
|---|---|---|
| `typecheck` | 0 | clean |
| `lint` | 0 | clean |
| `test:unit` | 0 | **76 passed (76)**, 19 files |
| `test:db` | 0 | **90 passed (90)**, 15 files |
| `build` | 0 | route listing emitted |

**Branch and sha printed AFTER the run: `main` @ `98d99ff` — unchanged from before.**

### Final suite sizes against the Phase 1 baseline

| Suite | Phase 1 gate | Phase 2 gate | Growth |
|---|---|---|---|
| unit | 11 tests, 4 files | **76 tests, 19 files** | ×6.9 |
| db | 31 tests, 9 files | **90 tests, 15 files** | ×2.9 |
| e2e | 4 (3 specs + setup) | **21 (20 spec tests in 8 spec files + the auth setup)** | ×5.25 |

## The PR

| | |
|---|---|
| **URL** | **https://github.com/dlopez2392/siteless/pull/1** |
| Branch | `gsd/phase-02-budget-governor-search-presets` → `main` |
| State | **open, NOT merged**, 97 commits, 219 files changed |
| `origin/main` | **`7cec235`, unchanged** — never pushed |

CI on the PR head `d1c9412`, read via REST:

```
verify:                  completed / success
db:                      completed / success
e2e:                     completed / skipped
Vercel Preview Comments: completed / success
```

🔴 **`e2e` is skipped by design, not by failure:** the job carries
`if: github.event_name == 'push'` and the workflow's `push` trigger is `branches: [main]`. So
**the merge to `main` will be the first time CI has ever executed a Phase 2 e2e spec** — and
the `preset-detail` self-skip committed in `cad7c86` is precisely what stops that run going
red on `TEST_DATABASE_URL is not set`.

**The merge is danlo's**, on green CI on the current head. Not merged here.

## Production state left by the e2e runs

Read-only snapshot (`begin read only`), 2026-09-22T18:49Z:

| Table | Rows |
|---|---|
| `searches` | **6** — `e2e-1790100256747-{cities,county,radius}` (Task 1) and `e2e-1790101422158-{…}` (this run) |
| `search_versions` | 6 (one per search) |
| `runs` | **0** |
| `cost_reservations` | **0** |
| `cost_ledger` | **0** |
| `budget_periods` | 1 — places, 2026-09-01, cap 50,000,000 µUSD, spent 0, reserved 0 |
| `events` | 30 |

Nothing was written to production by this plan; every row above is the product's own doing
under an e2e run. **No money was reserved, held or spent.** The growth is logged as a Phase
3/4 follow-up in `deferred-items.md`: CI's e2e job will add three more presets on every push
to `main`, and Phase 2 ships no delete path by design.

## Files Created/Modified

- `tests/e2e/preset-detail.spec.ts` — the local-target self-skip, its predicate, and a long comment recording why the alternatives were refused and which test carries SRCH-03 instead.
- `tests/db/grants-audit.test.ts` — the column-privilege assertion for `search_versions`, written because M12b survived.
- `eslint.config.mjs` — `coverage/**` added to the ignores.
- `.planning/phases/.../02-VALIDATION.md` — closed: frontmatter, the M7–M12 as-run table, 74 task rows, the five criteria.
- `.planning/phases/.../deferred-items.md` — the Rule 4 blocker marked RESOLVED, plus the two deferrals and the `presets.spec.ts` follow-up.
- `docs/deploy.md` — the production URL and verified sha (Task 1).

## Task Commits

1. **Task 1: deploy, smoke, e2e against the real URL** — `9df3985` (docs; prior dispatch)
2. **Task 2 + Task 3 step A: apply danlo's e2e decision** — `cad7c86` (test)
3. **Task 3: the column-grant guard M12b found** — `98d99ff` (test)
4. **Task 3: close 02-VALIDATION.md** — `d1c9412` (docs)

## Decisions Made

- **BUDG-03 stays OPEN.** Blocked on a Google Cloud project that does not exist. Carried to Phase 4, runbook at `docs/runbooks/google-quota.md`. It blocks nothing here, and that is *enforced*: `no google credential is read anywhere in src`, `src/env.ts declares no Google variable` and `no server action reads a Google credential` are all green. Nothing in Phase 2 can spend at Google because nothing in Phase 2 can authenticate to Google.
- **The four deployed state shots defer to Phase 4** (danlo). Production committed spend is $0, so the states would be synthetic there; the local hex-probed captures from 02-10 and 02-12/02-13 stand in.
- **`preset-detail.spec.ts` self-skips against a deployed target** (danlo, option 3), with the SRCH-03 carrier named in the skip reason.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `pnpm lint` redded on a gitignored file that is not in the repo**

- **Found during:** Task 3, step A
- **Issue:** `eslint.config.mjs` ignores `.next/`, `node_modules/`, `drizzle/`, `playwright-report/` and `test-results/` — every gitignored build directory except `coverage/`, which `.gitignore` carries as `/coverage/`. The read-only production helper parked there failed `no-explicit-any` and blocked the phase gate on a file git does not track. Any `vitest --coverage` run would do the same to anyone.
- **Fix:** `coverage/**` added to the ignores, with a comment recording how it was found.
- **Verification:** `pnpm lint` exit **0**, read from `$?` after a redirect rather than through a pipe.
- **Committed in:** `cad7c86`

**2. [Rule 2 — Missing critical] `search_versions` append-only guard was blind to column grants**

- **Found during:** Task 3, by mutation M12b — not by reading
- **Issue:** A column-level `UPDATE` grant on `search_versions.geo_payload` let `authenticated` rewrite a stored version's geography, with the **entire 90-test suite green**. This is the mitigation for T-2-12 and the mechanism behind ROADMAP criterion 3.
- **Fix:** `has_any_column_privilege('authenticated','public.search_versions','UPDATE')` asserted false in the existing sentinel, which already carried the identical check for four other tables.
- **Verification:** green against the real grants → **red under M12b** → green after the revoke. A first version of the assertion also carried an `sv_any_delete` companion; it was **watched red** and removed, because PostgreSQL has no column-level DELETE and `has_any_column_privilege(...,'DELETE')` raises `unrecognized privilege type: "DELETE"` rather than returning false. The reason is recorded in the test so it is not re-added.
- **Committed in:** `98d99ff`

### Decided by danlo (Deviation Rule 4, escalated by Task 1)

**3. The cross-database e2e fixture** — raised as architectural/security in Task 1 because
option 1 required a production **owner** credential in GitHub Actions secrets (which
`docs/deploy.md` §3 forbids) and option 2 would have dropped the leg that proves SRCH-03.
danlo chose option 3. Applied in `cad7c86`, direction-checked both ways.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical) + 1 Rule 4 resolved by danlo.
**Impact on plan:** No scope change. Deviation 2 is a genuine security finding that the gate
existed to produce — the phase's validation contract paid for itself here.

## Issues Encountered

- **Two mutation runs measured the wrong thing before being caught** (M11's CRLF anchor miss, M8b's aborted DDL leaving M8 applied). Both found by reading the red set against the prediction; both now recorded in `02-VALIDATION.md` as standing lessons.
- **No screenshot files survive** from 02-10 through 02-13 — all were written to gitignored directories inside worktrees that were destroyed on return. Recorded as fact rather than reported as a count; the computed-style probes in each SUMMARY are the durable evidence, and danlo reviewed the deployed screens himself.
- **`e2e` has never run in CI.** It skips on `pull_request` by design and the `push` trigger is `main`-only. The merge will be its first execution; the self-skip is what keeps it green.

## Known Stubs

None introduced by this plan. Two items are **deferred with an owner and a date**, not stubbed: BUDG-03's Google quota (Phase 4) and the four deployed state shots (Phase 4).

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema. It is the *evidence* for T-2-01, T-2-04, T-2-15 and T-1-35 carried forward, and it **closed** a previously unguarded surface under T-2-12 (the `search_versions` column grant).

## User Setup Required

None new. One item remains outstanding from 02-14 and is carried to Phase 4: the Google Cloud project + Places API (New) key with billing and a 100/day quota — `docs/runbooks/google-quota.md`.

## Next Phase Readiness

- **Phase 2 is functionally complete and PR-ready.** `/gsd-verify-work 2` is the next step; the orchestrator closes the phase after the verifier runs. **This plan did NOT mark Phase 2 complete.**
- **Ready for Phase 3:** the RGV geography and cluster seed is settled and confirmed by danlo (`17 as measured`) — the Phase 2 ∥ Phase 3 shared contract.
- **Carried into Phase 4:** BUDG-03's quota; the four deployed state shots; the six self-skipping e2e tests, which all become real once anything calls Places; and a `presets.spec.ts` teardown or name-scoping before CI's e2e job accumulates presets on every push.
- **Merge is danlo's call**, on green CI on the current head of PR #1.

## Self-Check

- `tests/e2e/preset-detail.spec.ts` — **FOUND**, modified, self-skip verified both ways
- `tests/db/grants-audit.test.ts` — **FOUND**, modified, watched red under M12b
- `eslint.config.mjs` — **FOUND**, modified, `pnpm lint` exit 0
- `.planning/phases/02-budget-governor-search-presets/02-VALIDATION.md` — **FOUND**, `status: complete`, `nyquist_compliant: true`, `wave_0_complete: true`, 74 task rows, **0** rows reading `⬜ pending` or `_pending planner_`
- `.planning/phases/02-budget-governor-search-presets/deferred-items.md` — **FOUND**, modified
- Commits `cad7c86`, `98d99ff`, `d1c9412` — **FOUND** in `git log`
- Final gate: typecheck / lint / test:unit / test:db / build all exit **0**; branch + sha printed after and unchanged
- Catalog: all six objects byte-identical to the pre-mutation capture; `git diff --stat` empty
- PR #1 open, **not merged**; `origin/main` still `7cec235`

## Self-Check: PASSED

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*

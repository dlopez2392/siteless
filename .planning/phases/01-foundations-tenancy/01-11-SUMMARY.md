---
phase: 01-foundations-tenancy
plan: 11
subsystem: infra
tags:
  [vercel, deployment, clerk, playwright, e2e, health-check, phase-gate, mutation-testing, pending-session]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 10)
    provides: 'the linked Vercel project `siteless`, the six production environment variables, the production schema applied by drizzle-kit, and `docs/deploy.md` — the recipe this plan executed and corrected'
  - phase: 01-foundations-tenancy (plan 08)
    provides: '`src/proxy.ts`, `withOrg`/`requireOrg`, JIT `app.ensure_org`, `/no-access`, `/api/health`, and `ActivateSoleOrganization` — the app this plan deployed and then had to fix'
  - phase: 01-foundations-tenancy (plan 03)
    provides: '`playwright.config.ts`, `tests/e2e/_required-env.ts` and `tests/e2e/auth.setup.ts`, whose only pointer at a server is `E2E_BASE_URL`'
  - phase: 01-foundations-tenancy (plan 12)
    provides: 'the grant surface (M5/M6) that the phase-gate mutation cross-reference in this SUMMARY records alongside M1–M4'
provides:
  - 'A live production deployment at `https://siteless-iota.vercel.app` (deployment `dpl_AxqqohtjnoFzhfJxSvUSWYtrFHkm`, READY, target production, region `iad1`) whose running code identifies itself as commit `311e6b4574cc1973c6307b6d2b1dcb1f24dea876`'
  - '`vercel.json` declaring `"framework": "nextjs"` — without it a frameworkless Vercel project builds Next.js successfully and then fails the deploy on `No Output Directory named "dist" found`'
  - '`.vercelignore` excluding `playwright.config.ts`, `vitest.config.ts` and `vitest.db.config.ts` — a config that imports across an excluded directory is a build error that cannot reproduce locally'
  - 'A green e2e suite run twice against the DEPLOYED URL with no `setActive` workaround in any test'
  - 'The fix for a real product defect the e2e run found: a PENDING Clerk session made `ActivateSoleOrganization` a no-op for exactly the user it existed to rescue'
  - '`.planning/phases/01-foundations-tenancy/01-VALIDATION.md` complete and signed off — every row real, Wave 0 ticked, seven gate mutations recorded as RUN, `nyquist_compliant: true`, `wave_0_complete: true`'
  - 'The GitHub repository variable `E2E_BASE_URL`, set by automation, which is what unblocks the CI `e2e` job'
  - 'docs/deploy.md §§ 9-11 — the three deploy failures, the alias-vs-per-deployment-URL rule, and the two expected console warnings'
affects:
  [phase-02-budget-governor, phase-02-ui, phase-03-entity-resolution, phase-04-places-verifier, ci-e2e-job]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'The deployed commit is verified from the RUNNING CODE, not from the build log. Vercel''s build log names no sha here, so `/api/health` echoing `VERCEL_GIT_COMMIT_SHA` is the check — and it is compared against a `git rev-parse HEAD` taken BEFORE the deploy.'
    - 'A Clerk PENDING session reports as signed OUT by default. `useAuth({ treatPendingAsSignedOut: false })` is the client-side repair affordance; the SERVER keeps bare `auth()` so a pending session stays unauthorized. Seeing through pending is a UI concession, never an authorization decision.'
    - 'An exclusion is only as good as the files that still reference across it. `.vercelignore` excluding `tests/` while shipping `playwright.config.ts` is a build error that exists only on the deploy target.'
    - 'The final gate prints branch + sha AFTER the run, never before (T-1-35).'
    - 'When a success criterion is literally unsatisfiable, record the criterion as the bug and substitute a stronger, honest one — do not redeploy to chase a tautology.'

key-files:
  created:
    - vercel.json
  modified:
    - .vercelignore
    - docs/deploy.md
    - src/components/activate-sole-organization.tsx
    - .planning/phases/01-foundations-tenancy/01-VALIDATION.md

key-decisions:
  - '`vercel.json` declares `"framework": "nextjs"` in the REPOSITORY rather than fixing the dashboard preset, so the setting is reviewable in a diff and survives the project being recreated. Plan 10 recorded `Framework Preset: Other` as benign because `bis-platform` reports the same; this plan proved it is not benign on the CLI deploy path.'
  - '`requireOrg()` deliberately stays on bare `auth()`. A pending session is signed-out on the server and is redirected; only the client component was taught to see through pending.'
  - 'E2E runs point at the production ALIAS, never the per-deployment URL: the per-deployment URL is behind Vercel deployment protection and answers 302 even on `/api/health`.'
  - 'The Task 3 criterion "`git log --oneline -1` matches the deployed commit" was replaced with a byte-level diff of the application code, because documentation commits make the literal form unsatisfiable by construction.'
  - 'The Clerk "Create new organization" button seen on the task screen was recorded, not acted on — the dashboard was re-read and `create_organization` is still `false`. D-02 holds at the setting level.'

patterns-established:
  - 'Three deploy attempts, each failing differently, each recorded with its fix: a build error from an excluded directory, a deploy error from an undeclared framework, and a product defect found by the suite. "It built" is not "it works", and "it deployed" is not "it is the right commit".'
  - 'A component built to rescue a user state must be tested IN that state. The sole-organization unit tests were all green and mutation-checked while the caller never ran for the only user who needed it.'

requirements-completed: [FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06]

# Metrics
duration: 3h 52m wall clock (~40 min of execution; the balance is the blocking human-verify checkpoint)
completed: 2026-09-22
---

# Phase 01 Plan 11: Deploy, E2E Against the Real URL, and the Phase Gate Summary

**Siteless is live at `https://siteless-iota.vercel.app` on a commit its own `/api/health` route names back to us; three deploy attempts failed first — an excluded-directory build error, an undeclared-framework deploy error, and a PENDING Clerk session that made the sole-organization rescue a no-op for the only user it existed to rescue — and the phase closes with danlo signed in by hand, the e2e suite green twice against the deployed URL, and `01-VALIDATION.md` signed off with seven gate mutations recorded as they were RUN rather than as they were planned.**

## Performance

- **Duration:** 3h 52m wall clock; roughly 40 min of execution, the balance being the blocking `checkpoint:human-verify` waiting on danlo
- **Started:** 2026-09-22T04:20:00Z (first deploy attempt)
- **Completed:** 2026-09-22T08:12:00Z
- **Tasks:** 3 of 3 (2 `auto`, 1 `checkpoint:human-verify`, answered)
- **Files modified:** 5 tracked (1 created, 4 modified) + `.env.local` (gitignored, never staged)

## Accomplishments

- **Criterion 1 is closed by a human, not by a test.** danlo signed in at the deployed URL in a private window and landed on `/` showing his Clerk user id, his Clerk org id and the JIT-provisioned tenant uuid.
- **The e2e suite runs against the real deployment**, twice green, with `grep -rc setActive tests/e2e/` still **0**. The workaround that kept BIS's suite green while the product was broken was never added.
- **The suite earned its keep on its first real run.** It failed — and the failure was a genuine product defect, not a test problem: `@clerk/nextjs@7.9.4` implements "organization required" as a *session task*, `useAuth` reports a pending session as signed **out** by default, so `soleOrganizationToActivate` returned `null` and the component built to rescue a user with exactly one membership did nothing for exactly that user. The 2026-09-16 BIS incident in a new costume.
- **Deployment provenance is proven from the running code.** The Vercel build log names no sha and the REST API refused the CLI token (`403 invalidToken`); `/api/health` echoing `VERCEL_GIT_COMMIT_SHA` answered the question instead, and it equals the sha recorded before the deploy.
- **`01-VALIDATION.md` records the mutations that were RUN.** M1's planned recipe is documented as non-discriminating; M3 and M5 are documented as reding *two* tests each with independence proven by narrower mutations; M2b, M5 and M6 are added. A future gate re-running the planned wording would get a green suite and conclude the guard works.
- **The final gate is green on a printed commit:** typecheck 0, lint 0, unit **11/11**, db **31/31**, build 0 — then `main` / `ea1777f`, read *after* the run.

## Task Commits

| # | Task | Commits | Type |
|---|------|---------|------|
| 1 | Deploy to production, verify the deployment is THIS commit, smoke `/api/health` | `219acba`, `453c0c4`, `7fbf6ed` | fix, fix, docs |
| 2 | Run the e2e suite against the deployed URL | `311e6b4`, `d1b21f1` | fix, docs |
| 3 | [danlo] Sign in on the deployed app, then close the phase gate | `ea1777f` | test |

- `219acba` — keep the test-harness configs out of the deployment bundle (`.vercelignore`)
- `453c0c4` — declare the framework so Vercel builds this as Next.js (`vercel.json`, `docs/deploy.md`)
- `7fbf6ed` — record the live production deployment and its verified commit (`docs/deploy.md`)
- `311e6b4` — activate the sole organization through a PENDING Clerk session (`src/components/activate-sole-organization.tsx`) — **this is the deployed commit**
- `d1b21f1` — record the superseding deployment and the two expected warnings (`docs/deploy.md`)
- `ea1777f` — fill the validation map and sign off the phase gate (`01-VALIDATION.md`)

**Plan metadata:** this SUMMARY (`docs(01-11): complete deploy, e2e and phase gate`).

## Files Created/Modified

- `vercel.json` — **created.** `{"framework": "nextjs"}`. Without it the CLI deploy path fails after a successful build.
- `.vercelignore` — `playwright.config.ts`, `vitest.config.ts`, `vitest.db.config.ts` added to the exclusion list.
- `src/components/activate-sole-organization.tsx` — `useAuth({ treatPendingAsSignedOut: false })`.
- `docs/deploy.md` — §1 corrected (the framework preset is **not** benign), §9 (why the harness configs are excluded), §10 (the live deployment table, alias vs per-deployment URL, how the commit was verified), §11 (the two expected console warnings).
- `.planning/phases/01-foundations-tenancy/01-VALIDATION.md` — filled and signed off.
- `.env.local` — `E2E_BASE_URL` and `E2E_ADMIN_EMAIL` (gitignored; never staged, no value printed anywhere).

---

## Task 1 — deploy, provenance, health

**Three attempts failed before one stuck. Each failed differently and each is recorded.**

| Attempt | Commit | Outcome |
|---|---|---|
| 1 | `e40be15` | **Build failed.** `playwright.config.ts(3,35): error TS2307: Cannot find module './tests/e2e/_required-env'` — `tests/` is excluded by `.vercelignore` while `tsconfig.json` includes `**/*.ts` and `next build` type-checks. A build error that cannot reproduce locally, because locally `tests/` exists. Fixed by `219acba`: the three test-harness configs are excluded from the bundle too (nothing under `src/` imports them). |
| 2 | `219acba` | **Built clean, deploy failed.** `No Output Directory named "dist" found`. Cause: `Framework Preset: Other`, which plan 10 recorded as benign because `bis-platform` (a live Next.js deployment on the same team) reports the same. It is not benign on the CLI deploy path — a frameworkless project is assumed to emit a static directory. Fixed by `453c0c4`: `vercel.json` with `"framework": "nextjs"`. The next build log says `Detected Next.js version: 16.3.5` and `Applying modifyConfig from Vercel`, neither of which appears without it. |
| 3 | `453c0c4` | **READY.** `dpl_CAcqW8nAXa2nimyUp65kBsEcgMFQ`. Superseded the same day. |
| 4 | `311e6b4` | **READY — this is the live one**, deployed after Task 2's app fix. |

**The live deployment**

| Thing | Value |
|---|---|
| Deployment id | `dpl_AxqqohtjnoFzhfJxSvUSWYtrFHkm` |
| Production alias (**use this**) | `https://siteless-iota.vercel.app` = `$DEPLOY_URL` |
| Per-deployment URL | `https://siteless-dqfm2wzg8-danlopez508-8452s-projects.vercel.app` — behind deployment protection, answers **302 even on `/api/health`** |
| State | `readyState: READY`, `target: production`, region `iad1` |
| Verified commit | `311e6b4574cc1973c6307b6d2b1dcb1f24dea876` |

**Commit provenance — and its honest limits.** `/api/health` on the deployed URL returned
`commit = 311e6b4574cc1973c6307b6d2b1dcb1f24dea876`, **exactly the sha recorded by
`git rev-parse HEAD` before the deploy**. Two things could not be done and are recorded
rather than worked around:

- **The build log names no sha.** The provenance check therefore comes from the running code
  echoing `VERCEL_GIT_COMMIT_SHA`, which is strictly stronger evidence about *what is
  serving requests* but does not satisfy the plan's literal "read the build log" wording.
- **The Vercel REST API rejected the CLI token** with `403 invalidToken`, so the deployment
  record could not be read a second, independent way.

**Node version — also an honest limit.** `vercel project inspect` reports
`Node.js Version 24.x`, and the build log shows Vercel reading
`"engines": { "node": ">=24.0.0" }` from `package.json`. It prints no explicit
"Using Node.js 24.x" line, so the project setting is the evidence, not the build transcript.

**Health smoke, verbatim:**

```
$ curl -fsS https://siteless-iota.vercel.app/api/health
{"ok":true,"db":"up","proxy":"up","commit":"311e6b4574cc1973c6307b6d2b1dcb1f24dea876"}
```

HTTP **200**. `db:"up"` is the only proof that `SUPABASE_DB_POOL_URL` on Vercel is the
transaction pooler as `app_user` with a working password. `proxy:"up"` is the only proof
that `clerkMiddleware()` ran, i.e. that `src/proxy.ts` is level with `app/` **in
production** — the Pitfall-7 failure whose error text points at Clerk config rather than at
the file path. Leak scan clean: the body contains none of `postgres://`, `@`, `password`,
`sk_`, `jahgeqshuesndyscnmjo`.

**Signed-out path:**

```
$ curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' https://siteless-iota.vercel.app/
307 https://siteless-iota.vercel.app/sign-in
```

`data-testid="org-id"` — **0 occurrences**, both before and after following redirects.

**`E2E_BASE_URL` set by automation**, so the plan's Task 3 step 8 was already done when the
checkpoint was presented:
`gh variable set E2E_BASE_URL --repo dlopez2392/siteless --body https://siteless-iota.vercel.app`,
confirmed by `gh variable list` at **2026-09-22T04:27:31Z**.

---

## Task 2 — the e2e suite against the deployed URL, and the defect it found

`.env.local` gained `E2E_BASE_URL` and `E2E_ADMIN_EMAIL` (one line each, non-empty,
pre-existing lines intact, still gitignored — `git status --short` never listed it).
`playwright install chromium` exit 0 (Chrome for Testing 153.0.8010.12; `--with-deps`
dropped, it is Linux-only).

### Run 1 — FAILED, on a real product defect

```
[chromium] › tests\e2e\signed-in.spec.ts:10:1 › signs in and is org-scoped
1 failed, 3 passed — 10.8s for the test, 25 s wall clock
```

The page was Clerk's **"Choose an organization"** task at
`/sign-in/create/tasks/choose-organization`, with one org button, "BIS".

The plan enumerates three diagnoses in order and **(c) was the answer**: a **pending
session**. `@clerk/nextjs@7.9.4` / `@clerk/react@6.16.1` implement "organization required"
as a session *task*. A user without an active org has a pending session, and `useAuth`
reports pending as signed **OUT** by default —
`PendingSessionOptions.treatPendingAsSignedOut` defaults to `true`
(`@clerk/shared/dist/types/session.d.ts:16-23`). So `isSignedIn` was `false`,
`soleOrganizationToActivate` returned `null`, and **the component built to rescue this user
rescued nobody**.

The plan is explicit that the fix belongs in the app, never in the test. It went in the app.

**Fix — `311e6b4`:** `useAuth({ treatPendingAsSignedOut: false })` in
`src/components/activate-sole-organization.tsx`, so the client can see the pending state and
`setActive({ organization })` completes the task. **`requireOrg()` was deliberately left on
bare `auth()`**: a pending session stays signed-out on the server and is redirected. Seeing
through pending is a client-side repair affordance, never a server-side authorization
decision. typecheck 0, lint 0, prettier clean on that file.

### Runs A and B — both green, against the deployment

`tests/e2e/.auth/` was deleted before each run, so activation was re-proven from scratch
rather than replayed from a stored session.

| Run | Wall clock | Playwright | Result |
|---|---|---|---|
| A | 16 s | 15.1 s | 4 passed |
| B | 9 s | 8.3 s | 4 passed |

Passing: `authenticate` (setup), `signs in and is org-scoped`,
`no access: a signed-out visitor never reaches the org-scoped shell`,
`no access: /no-access renders the invite-only message` — against
`https://siteless-iota.vercel.app`, **not** localhost.

**Regression, not flake, judged by wall clock and by whether the failure moved:** 25 s
failing versus 16 s and 9 s passing, and it never moved between tests.

`grep -rc setActive tests/e2e/` → **0** in all four files.

### Observations recorded, not acted on

- **Clerk dev-keys warning**, verbatim and expected in Phase 1:
  `Clerk: Clerk has been loaded with development keys. Development instances have strict usage limits and should not be used when deploying your application to production. Learn more: https://clerk.com/docs/deployments/overview`
  The Vercel project carries the Clerk **development** instance keys, which is exactly what
  makes an unattended e2e sign-in possible. Moving to a production instance is its own work
  with its own DNS step (BIS's runbook: the app subdomain must be an **A** record).
- A signed-out page load logs `"useOrganizationList" requires an active user session`.
  Pre-existing and by design — plan 08 mounts the component in the root layout, so it is
  present on `/sign-in` where there is no session. Recorded in `docs/deploy.md` §11.
- `docs/deploy.md` fails `prettier --check`, and did at baseline. Prettier is not part of
  `verify`; it was not reformatted, to keep the diff reviewable.
- The Clerk task screen offered a **"Create new organization"** button. The dashboard was
  re-read on 2026-09-22 after the run: `create_organization` is still `false` and
  "Membership required" is still selected. The button is Clerk's task UI rendering
  regardless of the instance setting. **D-02 holds at the setting level**; a future phase may
  verify that clicking it is refused server-side.

---

## Task 3 — the checkpoint, and the phase gate

### Manual verifications

danlo signed in at `https://siteless-iota.vercel.app` in a private window on **2026-09-22**
and pasted, **verbatim**:

```
Signed in as user_3Jf37HgqXFh3Xr7scbCWSLTQ5F5

Org org_3Jf2trxDQzIC3yX4sgZki3kE3ky

Tenant 26491ff8-9755-4a98-b576-7dab6b00e314
```

He landed on `/` — not on the choose-organization screen, not on `/no-access`. He did not
answer the reload, `/no-access` and `/api/health` items; those were closed with objective
evidence instead, recorded here **with its provenance rather than as danlo's words**.

**The six-line block, with provenance per line:**

| Line | Provenance |
|---|---|
| `sign-in: ok` | **danlo, verbatim** |
| `org shown: org_3Jf2trxDQzIC3yX4sgZki3kE3ky` | **danlo, verbatim** — not blank, not "no access" |
| `tenant uuid stable on reload: yes (proven by a single orgs row across three sign-ins)` | **Production database read, orchestrator.** A read-only query (session pooler, as `postgres`) returned `orgs_rows: 1` — id `26491ff8-9755-4a98-b576-7dab6b00e314`, `clerk_org_id = org_3Jf2trxDQzIC3yX4sgZki3kE3ky`, `created 2026-09-22T04:35:20Z`, i.e. the row created during the **e2e** runs. After two automated sign-ins **plus** danlo's manual sign-in and page loads there is still exactly one row — a stronger idempotency proof (D-03) than a single reload. Also read: `events_rows: 9`, `businesses_rows: 0` |
| `no-access: ok` | **Orchestrator `curl`.** Signed-out → HTTP 200, body contains "No access" (1) and "Sign out" (1), `data-testid="org-id"` **0**. The signed-in rendering is asserted by the passing e2e test `no access: /no-access renders the invite-only message`, whose storageState is a signed-in session |
| `health: ok` | **Orchestrator `curl`** — `{"ok":true,"db":"up","proxy":"up","commit":"311e6b4574cc1973c6307b6d2b1dcb1f24dea876"}` |
| `E2E_BASE_URL: set` | **Automation, Task 1** — `gh variable set` + `gh variable list` confirmation at 2026-09-22T04:27:31Z |

### Final gate

🔴 **`pnpm verify` is unrunnable on this machine** and has been since plan 01-01: the
composite script shells out to a bare `pnpm`, which resolves to the global 11.9.0 with a
broken 12.5.1 self-switch shim and dies before reaching a single constituent. The four
constituents were run individually through the pinned Node launcher, plus the build:

| Gate | Exit | Result |
|---|---|---|
| `typecheck` | **0** | `tsc --noEmit`, clean |
| `lint` | **0** | `eslint .`, clean |
| `test:unit` | **0** | **Test Files 4 passed (4) · Tests 11 passed (11)** · 867 ms |
| `test:db` | **0** | **Test Files 9 passed (9) · Tests 31 passed (31)** · 8.01 s |
| `build` | **0** | `✓ Compiled successfully in 8.9s`; routes `/`, `/api/health`, `/no-access`, `/sign-in/[[...sign-in]]`, plus `ƒ Proxy (Middleware)` |

**Branch and sha, read AFTER the run** (T-1-35 — a parallel session has moved this machine's
tree mid-gate before, and a gate then goes silently green on the wrong commit):

```
POST-GATE branch: main
POST-GATE short sha: ea1777f
POST-GATE full sha:  ea1777f14f39a5a3eae9bab7bb9aa3e153c18fa7
git status --short:  (empty)
```

The plan's literal Task 3 automated verify, minus the `pnpm verify` prefix:

```
$ git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD \
  && grep -q 'nyquist_compliant: true' .planning/phases/01-foundations-tenancy/01-VALIDATION.md \
  && echo ok
main
ea1777f
ok
```

---

## Phase-gate mutation checks, cross-referenced

Each mutation was applied, the suite run, the failing test **names** read, and the mutation
reverted with `git diff --stat` proven empty. **Recorded as RUN, not as planned.**

| # | Plan / Task | Mutation as run | Test(s) that went red | Suite | Source |
|---|---|---|---|---|---|
| **M1** | 01-05 T3 | **CORRECTED** — `businesses_insert` recreated as `WITH CHECK (true)`. The planned "drop the `WITH CHECK` clause" does **not** discriminate: on PostgreSQL 18.6 an INSERT policy with neither `WITH CHECK` nor `USING` fails **closed**, the caller's own-org INSERT is refused too, and the suite stayed **green for the wrong reason** (11 passed). Diagnosed by probing the positive path (own-org INSERT → `42501 new row violates row-level security policy`). A second correction was needed first: the `25P02` test was decoupled onto its own `orgs` INSERT refusal (`ad0bede`), because sharing one refusal made the mutation red two tests | `org A cannot INSERT into org B, and the refusal is 42501` — **one**, 1 failed / 10 passed | 11 | `01-05-SUMMARY.md` |
| **M2** | 01-07 T3 | `alter table source_records drop constraint sr_google_is_ephemeral` — as written | `google content cannot be durable` — **one**, 1 failed / 18 passed; `positive control: a durable field citing a durable source is accepted` stayed **green** | 19 | `01-07-SUMMARY.md` |
| **M2b** | 01-07 T3 | Companion FK mutation: `alter table businesses drop constraint businesses_phone_src_fk` | `durable cites durable: a durable field citing an ephemeral source is refused` — **one**, 1 failed / 18 passed. The positive control cannot detect this mutation, which is why the refusal test must | 19 | `01-07-SUMMARY.md` |
| **M3** | 01-09 T3 | `drop trigger businesses_event on businesses` — as written | **TWO**, not the one the map predicted: `a direct write still produces an event` **and** `every state-bearing table has an app.log_event after-row trigger`. Independent properties sharing one object, **proven** independent: `disable trigger` reds only the behaviour test (coverage green), and collapsing `app.log_event()`'s actor chain to `'system'` also reds only the behaviour test with the trigger present and enabled | 25 | `01-09-SUMMARY.md` |
| **M4** | 01-08 T1 | `set_config('request.jwt.claims', $1, true)` → `false`, applied to the **committed** file so `git diff -U0` showed the `-`/`+` pair | `withOrg binds the tenant claims and they die with the transaction` — **one**, 1 failed / 13 passed at the time | 14 | `01-08-SUMMARY.md` |
| **M5** | 01-12 T3 | `grant truncate on public.events to authenticated` | **TWO**, as predicted: `a TRUNCATE of events as authenticated is refused with 42501` **and** `authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table` — 2 failed / 29 passed. `a cascading TRUNCATE of every tenant table as authenticated is refused with 42501` correctly stayed **green** (it names `orgs` first, where the grant was not made) | 31 | `01-12-SUMMARY.md` |
| **M6** | 01-12 T3 | `grant select on public.orgs to anon` | `anon holds no privilege on any tenant table` — **one**, 1 failed / 30 passed | 31 | `01-12-SUMMARY.md` |

**The standing lesson:** a mutation must be checked for **direction** — a guard that fails
*closed* is indistinguishable from a working guard by exit code alone. And a mutation that
reds **two** tests is acceptable only when the two properties are proven independent (M3,
M5); otherwise the tests are coupled and must be decoupled (M1).

---

## Criterion-by-criterion evidence, all five ROADMAP Phase 1 success criteria

| # | Criterion | Evidence | Verdict |
|---|---|---|---|
| **1** | danlo signs in with Clerk on a deployed Vercel app and every request is scoped to his org | danlo's verbatim three lines from `https://siteless-iota.vercel.app` (user id, org id, tenant uuid), landing on `/`; the e2e test `signs in and is org-scoped` green twice against the same URL with no `setActive`; signed-out `GET /` → `307 /sign-in` with `data-testid="org-id"` 0; `/api/health` `proxy:"up"` proving `clerkMiddleware()` runs in production; one `orgs` row across three sign-ins (D-03) | ✅ |
| **2** | A statement from a second seeded org against danlo's rows is refused — v2 claims, `42501` pinned, watched failing first, one refusal per rolled-back transaction | `01-05`: `org A cannot INSERT into org B, and the refusal is 42501` (+ `a token v2 nested claim resolves the same org as v1`, `a cross-org UPDATE and DELETE are filtered, not refused`, `a second statement in the same aborted transaction reports 25P02`), all watched red first against wide-open tables; **M1** reds exactly the 42501 test. Re-verified in production shape by 01-10's 12-policy side-by-side, and hardened by 01-12 (TRUNCATE is exempt from RLS and is now closed by grant — **M5**, **M6**) | ✅ |
| **3** | Google Places content in a durable field is refused by a database constraint, not a code review | `01-07`: `google content cannot be durable` (`23514` / `sr_google_is_ephemeral`), plus the ephemeral-expiry pair and the composite FK `durable cites durable`. **M2** and **M2b** each red exactly one; the positive control stays green | ✅ |
| **4** | Every state change shows which actor and when, all `timestamptz`, rendered in `America/Chicago` with zone and locale pinned | `01-09`: `a direct write still produces an event` (actor + `occurred_at`), `an UPDATE of only a domain column still moves updated_at and stamps updated_by`, `every state-bearing table has an app.log_event after-row trigger` (asserting `tgenabled`, not mere existence), `events are append-only` ×2. `01-05`: `every timestamp column in public is timestamptz`. `01-06`: `pins the zone and the locale on every Intl call`, `one instant renders on opposite days in UTC and America/Chicago`, `formatLocal ignores a caller-supplied timeZone`, `one instant, two zones, opposite verdicts` (SQL), plus the DST test. **M3** and four 01-06 mutations | ✅ |
| **5** | `legal_name`, `display_name` and internal annotations are three fields, and a test proves the internal one cannot reach an export or push payload | `01-05`: `businesses has three distinct name fields`. `01-06`: `no registered payload builder emits an internal annotation` (canary `INTERNAL-CANARY-7f3a2b`) and `every module under src/lib/export is represented in the registry` (`readdirSync`, so a new module cannot dodge the sentinel); a leaky builder added to `PAYLOAD_BUILDERS` reds exactly the first | ✅ |

`01-VALIDATION.md` is complete and signed off: `nyquist_compliant: true`,
`wave_0_complete: true`, **Approval: 2026-09-22**.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The Vercel build failed on a config that imports across an excluded directory**

- **Found during:** Task 1 (deploy attempt 1, at `e40be15`)
- **Issue:** `playwright.config.ts(3,35): error TS2307: Cannot find module './tests/e2e/_required-env'`. `.vercelignore` excludes `tests/`, `tsconfig.json` includes `**/*.ts`, and `next build` type-checks — so the config shipped while its import target did not. The error cannot reproduce locally, because locally `tests/` exists.
- **Fix:** Added `playwright.config.ts`, `vitest.config.ts` and `vitest.db.config.ts` to `.vercelignore`. Nothing under `src/` imports them. The two vitest configs reach `tests/` through string globs only and did not break; they are excluded with it because they are harness for an excluded directory just the same.
- **Files modified:** `.vercelignore`
- **Verification:** The next build compiled and printed every route.
- **Committed in:** `219acba`

**2. [Rule 3 - Blocking] `Framework Preset: Other` breaks the CLI deploy path after a successful build**

- **Found during:** Task 1 (deploy attempt 2, at `219acba`)
- **Issue:** `next build` succeeded and printed every route; the **deploy** then failed with `No Output Directory named "dist" found`. A frameworkless Vercel project is assumed to emit a static directory. Plan 10 recorded the preset as a benign auto-detect default because `bis-platform` — a live Next.js deployment on the same team — reports exactly the same thing. That inference was wrong.
- **Fix:** `vercel.json` with `"framework": "nextjs"`, which overrides the project setting. Kept in the repository rather than the dashboard so it is reviewable in a diff and survives the project being recreated. `docs/deploy.md` §1 corrected in the same commit.
- **Files modified:** `vercel.json` (created), `docs/deploy.md`
- **Verification:** The next build log says `Detected Next.js version: 16.3.5` and `Applying modifyConfig from Vercel`, neither of which appears without it; the deploy reached READY.
- **Committed in:** `453c0c4`

**3. [Rule 1 - Bug] `ActivateSoleOrganization` was a no-op for exactly the user it existed to rescue**

- **Found during:** Task 2 (e2e run 1 — the suite found it, which is the point of running it against the real deployment)
- **Issue:** `@clerk/nextjs@7.9.4` implements "organization required" as a session **task**. A user with no active org has a **pending** session, and `useAuth` reports pending as signed **out** by default (`PendingSessionOptions.treatPendingAsSignedOut` defaults to `true`, `@clerk/shared/dist/types/session.d.ts:16-23`). `isSignedIn` was `false`, `soleOrganizationToActivate` returned `null`, and the user sat on Clerk's choose-organization screen. The sole-organization unit tests were all green and mutation-checked — the **caller** never ran.
- **Fix:** `useAuth({ treatPendingAsSignedOut: false })`, so the client can see the pending state and `setActive({ organization })` completes the task. The fix is in the app, not the test; `grep -rc setActive tests/e2e/` is still 0.
- **Files modified:** `src/components/activate-sole-organization.tsx`
- **Verification:** Two full e2e runs against the deployed URL, 4 passed each, `tests/e2e/.auth/` deleted before both so activation was re-proven from scratch. typecheck 0, lint 0.
- **Committed in:** `311e6b4`

**4. [Rule 1 - Bug] The plan's commit-provenance and Node-version evidence could not be obtained as written**

- **Found during:** Task 1 (steps 3 and 4)
- **Issue:** The plan says to read the build log and confirm it names the sha. **Vercel's build log names no sha here.** The plan also asks to confirm the build used Node 24; the log shows Vercel reading `"engines": { "node": ">=24.0.0" }` but prints no explicit "Using Node.js 24.x" line. The REST API, which would have given an independent read of the deployment record, rejected the CLI token with `403 invalidToken`.
- **Fix:** Substituted evidence that is stronger about what is actually serving requests, and recorded the limits plainly rather than papering over them: `/api/health` echoes `VERCEL_GIT_COMMIT_SHA` and returned exactly the sha recorded before the deploy; `vercel project inspect` reports `Node.js Version 24.x`. No workaround was attempted for the 403.
- **Files modified:** `docs/deploy.md` §10 (states that the commit is verified from the running code, and why)
- **Verification:** Recorded above and in `docs/deploy.md`.
- **Committed in:** `7fbf6ed`, `d1b21f1`

**5. [Rule 1 - Bug] The acceptance criterion "`git log --oneline -1` matches the deployed commit" is unsatisfiable by construction**

- **Found during:** Task 3
- **Issue:** The criterion cannot be literally true once this plan's own documentation commits land — HEAD was already past `311e6b4` before Task 3 began. Chasing it would mean redeploying after every documentation commit, forever. **The criterion is the bug.**
- **Fix:** Replaced with a stronger, honest statement of the same intent — *the deployed application is byte-identical to HEAD's application code* — proven by diff rather than by sha equality. `docs/` and `.planning/` are excluded from the bundle by `.vercelignore`, so they cannot change what is deployed. **No redeploy.**

  ```
  $ git diff --stat 311e6b4 HEAD
   .../01-foundations-tenancy/01-VALIDATION.md | 233 +++++++++++++--------
   docs/deploy.md                              |  33 ++-
   2 files changed, 179 insertions(+), 87 deletions(-)

  $ git diff --stat 311e6b4 HEAD -- . ':!docs' ':!.planning'
  (empty — 0 bytes)
  ```

- **Files modified:** none (verification-method change only); recorded in `01-VALIDATION.md` and here
- **Verification:** The diff above, run at `ea1777f`.
- **Committed in:** no code commit — this is a criterion correction

**6. [Rule 3 - Blocking] The final gate could not be run as `pnpm verify`**

- **Found during:** Task 3
- **Issue:** Pre-existing and recorded since plan 01-01: `pnpm verify` chains nested bare `pnpm`, which on this machine resolves to the global 11.9.0 with a broken 12.5.1 self-switch shim and dies before reaching a single constituent. It has never been runnable here.
- **Fix:** Ran the four constituents individually through the pinned Node launcher, plus `build`. Each exit code was read directly, never through a pipe. This is the same method every previous plan in the phase used, and is recorded at the top of `01-VALIDATION.md` so a verifier does not mistake it for a skipped gate. CI on Linux is unaffected, and the CI `verify` job runs `typecheck`, `lint` and `test:unit` as separate `- run:` lines precisely so one broken composite cannot hide three gates.
- **Files modified:** none
- **Verification:** typecheck 0, lint 0, unit 11/11, db 31/31, build 0; branch + sha printed after.
- **Committed in:** no commit

### Recorded, not acted on

- **The Clerk "Create new organization" button** on the task screen. The dashboard was re-read on 2026-09-22 after the run: `create_organization` is still `false`, "Membership required" still selected. The button is Clerk's task UI rendering regardless of the instance setting. **D-02 holds at the setting level.** A future phase may verify that clicking it is refused server-side.
- **The Clerk development-keys console warning**, expected in Phase 1 and recorded verbatim in `docs/deploy.md` §11 — the dev instance is what makes an unattended e2e sign-in possible.
- **`"useOrganizationList" requires an active user session`** on signed-out page loads — pre-existing, by design (plan 08 mounts the component in the root layout), recorded in `docs/deploy.md` §11.
- **`docs/deploy.md` fails `prettier --check`**, and did at baseline. Prettier is not part of `verify`; not reformatted, to keep the diff reviewable.

---

**Total deviations:** 6 auto-fixed (3 × Rule 3 blocking, 3 × Rule 1 bug) + 4 observations recorded without action.
**Impact on plan:** No scope creep. Two of the three blockers were deployment configuration that only manifests on Vercel; the third was the pre-existing `pnpm verify` shim. The three Rule 1 items are one genuine product defect that the suite caught doing its job, and two cases where the plan's evidence recipe was wrong and the honest substitute is stronger. The plan's intent — deployed, provably this commit, proven by a human and by a suite against the real URL — is fully met.

## Issues Encountered

- **The e2e suite failed its first real run, and that was the plan working.** The plan forbids the `setActive` workaround and names three diagnoses in order; diagnosis (c) was correct and the fix went in the app. Had the suite been pointed at localhost, or had the workaround been added, the product would have shipped broken for the only user it has.
- **Deployment evidence had two hard limits** (no sha in the build log; `403 invalidToken` from the REST API). Both are recorded rather than worked around, and the substitute — the running code identifying itself — is stronger about what actually serves requests.
- **`pnpm verify` remains unrunnable on this machine.** This is a standing environment defect, not a phase-1 regression; every plan in the phase hit it and every one ran the constituents individually.

## Threat Model Coverage

| Threat | Disposition | Evidence |
|---|---|---|
| T-1-11 (EoP — deployed authorization) | mitigated | `/api/health` `proxy:"up"` in production; signed-out `GET /` → `307 /sign-in` with `data-testid="org-id"` 0; two e2e tests assert the same from a real browser against the deployment |
| T-1-12 (Info Disclosure — `/api/health` in production) | mitigated | Deployed body scanned for `postgres://`, `@`, `password`, `sk_`, `jahgeqshuesndyscnmjo` — none present. The route returns enum values plus a commit sha, never an error string |
| T-1-34 (Spoofing — deployment provenance) | mitigated, with a recorded limit | `/api/health` echoes `VERCEL_GIT_COMMIT_SHA` = `311e6b4574…`, equal to `git rev-parse HEAD` taken before the deploy. The build log names no sha and the REST API refused the token — both recorded |
| T-1-10 (Info Disclosure — CI secrets, `.env.local`) | mitigated | `E2E_BASE_URL` is a repository **variable** (a URL); Clerk credentials are repository **secrets**; `.env.local` never appeared in `git status --short`; no value from it is printed in this SUMMARY, in a commit, or in the transcript. danlo pasted only the three-line status block |
| T-1-20 (Repudiation — e2e trustworthiness) | mitigated | `grep -rc setActive tests/e2e/` → 0; the suite ran against the deployed URL, twice, with `tests/e2e/.auth/` deleted before each; both durations recorded and the failure judged by wall clock |
| T-1-35 (Tampering — gate run against the wrong tree) | mitigated | Branch `main` and sha `ea1777f` printed **after** the gate; `git status --short` empty |

## Threat Flags

None. This plan adds no new network endpoint, no new auth path, no file-access pattern and no schema change. The one app-code change narrows a **client** component's view of a pending session and explicitly does not touch the server-side authorization decision.

## Known Stubs

None introduced. The app shell is deliberately unstyled — the design system is Phase 2's — which the plan states and which is not a stub.

## User Setup Required

Complete. The plan's `user_setup` named one item: the GitHub repository variable
`E2E_BASE_URL`. It was set by automation in Task 1
(`gh variable set E2E_BASE_URL --repo dlopez2392/siteless --body https://siteless-iota.vercel.app`,
confirmed by `gh variable list` at 2026-09-22T04:27:31Z), so the CI `e2e` job is unblocked.

## Next Phase Readiness

- **Phase 1 is functionally complete.** All five ROADMAP success criteria are closed with the evidence cross-referenced above; `01-VALIDATION.md` is signed off.
- **Ready for `/gsd-verify-work 1`**, then Phase 2 (budget governor + search presets, the first phase with real screens) and Phase 3 in parallel.
- **Carry-forwards for Phase 2 and beyond:**
  - The production alias is `https://siteless-iota.vercel.app`. **Never point anything at the per-deployment URL** — it is behind deployment protection and answers 302 even on `/api/health`.
  - The Clerk **development** instance is what is deployed. A production Clerk instance is its own piece of work with a DNS step (the app subdomain must be an **A** record — a CNAME cannot have records beneath it, and the vendor's "configure automatically" resolves that by deleting the record the product lives on).
  - `pnpm verify` is unrunnable on this machine; run the four constituents through the pinned Node launcher.
  - A Clerk **pending** session reports as signed out. Any future client code that needs to see a user mid-task must opt in with `treatPendingAsSignedOut: false`; server-side authorization must not.
  - `docs/deploy.md` §§9-11 carry the three deploy failures and their fixes — read it before touching `.vercelignore` or the Vercel project settings.
- **No blockers.**

## Self-Check

Claims verified against disk and git at `ea1777f`, 2026-09-22:

| Claim | Command | Result |
|---|---|---|
| `vercel.json` exists | `[ -f vercel.json ]` | FOUND |
| `.vercelignore` exists | `[ -f .vercelignore ]` | FOUND |
| `docs/deploy.md` exists | `[ -f docs/deploy.md ]` | FOUND |
| `01-VALIDATION.md` exists | `[ -f .planning/phases/01-foundations-tenancy/01-VALIDATION.md ]` | FOUND |
| `src/components/activate-sole-organization.tsx` exists | `[ -f … ]` | FOUND |
| Commit `219acba` | `git log --oneline --all \| grep 219acba` | FOUND |
| Commit `453c0c4` | same | FOUND |
| Commit `7fbf6ed` | same | FOUND |
| Commit `311e6b4` | same | FOUND |
| Commit `d1b21f1` | same | FOUND |
| Commit `ea1777f` | same | FOUND |
| `nyquist_compliant: true` in VALIDATION | `grep -q` | FOUND |
| `wave_0_complete: true` in VALIDATION | `grep -q` | FOUND |
| No ⬜ pending rows left in the map | `grep -c '⬜'` | 1 — the legend line only |
| Deployed app code identical to HEAD | `git diff --stat 311e6b4 HEAD -- . ':!docs' ':!.planning'` | EMPTY |
| Branch / tree at the gate | `git rev-parse --abbrev-ref HEAD`, `git status --short` | `main`, empty |
| No `.env.local` in any commit | `git status --short` | never listed |

## Self-Check: PASSED

---

_Phase: 01-foundations-tenancy_
_Completed: 2026-09-22_

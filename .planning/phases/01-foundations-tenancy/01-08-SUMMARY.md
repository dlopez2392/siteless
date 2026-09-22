---
phase: 01-foundations-tenancy
plan: 08
subsystem: auth
tags: [clerk, nextjs, proxy, drizzle, postgres-js, rls, multi-tenancy, playwright, vitest]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 01)
    provides: src/env.ts with SUPABASE_DB_POOL_URL and CLERK_SECRET_KEY parsed at module load
  - phase: 01-foundations-tenancy (plan 03)
    provides: vitest.db.config.ts, playwright.config.ts, tests/e2e/_required-env.ts, tests/e2e/auth.setup.ts
  - phase: 01-foundations-tenancy (plan 05)
    provides: drizzle/0004_ensure_org.sql — app.ensure_org(text, text), and app.jwt()/app.current_org_id()
  - phase: 01-foundations-tenancy (plan 06)
    provides: src/lib/auth/sole-organization.ts — the pure soleOrganizationToActivate half
provides:
  - "src/proxy.ts — clerkMiddleware() for session context only, at src/ level with app/"
  - "src/db/client.ts — postgres.js + Drizzle as the non-owner app_user, prepare:false, max:1"
  - "src/db/with-org.ts — withOrg(), THE one runtime database entry point"
  - "src/lib/auth/require-org.ts — requireOrg(), orgClaims(), ensureOrgRow()"
  - "tests/db/with-org.test.ts — the persisted regression for T-1-04 and T-1-05 (gate M4)"
  - "The unstyled shell: /, /no-access, /sign-in/[[...sign-in]], /api/health"
  - "src/components/activate-sole-organization.tsx — the client half of the D-02 defence"
  - "tests/e2e/signed-in.spec.ts and tests/e2e/no-access.spec.ts — written for plan 11 to run"
affects: [01-10-vercel-deploy, 01-11-phase-verification, phase-02-ui, every later phase's server code]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "withOrg() is the single runtime database entry point; the only db call outside it is /api/health's select 1"
    - "Authorization lives next to the data (requireOrg), never in the proxy (CVE-2025-29927 class)"
    - "A token a grep enforces absent is never spelled in a comment next to it — the doctrine is described instead"

key-files:
  created:
    - src/proxy.ts
    - src/db/client.ts
    - src/db/with-org.ts
    - src/lib/auth/require-org.ts
    - tests/db/with-org.test.ts
    - src/components/activate-sole-organization.tsx
    - src/app/no-access/page.tsx
    - src/app/sign-in/[[...sign-in]]/page.tsx
    - src/app/api/health/route.ts
    - tests/e2e/signed-in.spec.ts
    - tests/e2e/no-access.spec.ts
  modified:
    - src/app/layout.tsx
    - src/app/page.tsx

key-decisions:
  - "Comments do not spell tokens that the plan's own acceptance greps require to be absent from the same file; the doctrine is described instead. This resolves four plan-internal contradictions and follows the house pattern already set by src/lib/auth/sole-organization.ts and tests/e2e/auth.setup.ts."
  - "next start was launched directly through node_modules/next/dist/bin/next rather than through the pnpm wrapper, so the recorded PID is the server itself and not a wrapper whose child would survive the kill."
  - "playwright test --list was proven twice: once with the E2E variables absent (the preamble refuses and names them) and once with placeholders supplied (three tests enumerated). The suite itself was not run — E2E_BASE_URL points at a deployment that does not exist until plan 10."

patterns-established:
  - "Pattern: withOrg(claims, fn) opens the transaction, binds the claims as a parameter, allow-lists the role against a Set, and uses the transaction-LOCAL set_config(..., true). Nothing else in src/ touches db."
  - "Pattern: an invariant invisible to typecheck is pinned by a test CI re-runs, not by a grep that ran once — and the mutation that must red it is named in the file's own doc comment."
  - "Pattern: a health route reports enum values only; the cause is logged by error NAME, never returned."

requirements-completed: [FOUND-01, FOUND-02, FOUND-03]

# Metrics
duration: 17min
completed: 2026-09-21
---

# Phase 1 Plan 08: Clerk-to-Database Wiring Summary

**`clerkMiddleware()` at `src/proxy.ts` for session context, `requireOrg()` next to the data for authorization, and `withOrg()` as the one runtime database entry point — with bound claims and transaction-local `set_config` pinned by a test CI re-runs rather than by a grep that ran once.**

## Performance

- **Duration:** ~17 min (first commit 21:53 CDT, last commit 22:00 CDT; context reading and install before that)
- **Started:** 2026-09-22T02:44Z
- **Completed:** 2026-09-22T03:01Z
- **Tasks:** 3 of 3
- **Files modified:** 13 (11 created, 2 modified)

## Accomplishments

- **The phase's two highest-probability silent failures are both closed.** `src/proxy.ts` sits level with `app/` — Next's build output prints `ƒ Proxy (Middleware)`, and the live `/api/health` probe returned `proxy: "up"`, which is what a misplaced proxy would have reported as `down`. And a session with no active organization is a *routing* decision in `requireOrg()`, so no page can render a query with a null org.
- **`withOrg()` is the only runtime path to the database**, connecting as the non-owner `app_user` with `prepare: false`. `grep -rn 'db.execute' src/` returns exactly one line — the health probe's `select 1`, which carries no claims and reads no table.
- **D-11b is executed, not grepped.** `tests/db/with-org.test.ts` runs the issued SQL through `PgDialect.sqlToQuery()` and asserts the text is exactly `select set_config('request.jwt.claims', $1, true)` with `params === [JSON.stringify(claims)]`, then calls `withOrg` twice on the same `max: 1` connection and asserts the GUC is empty between them and that the second transaction sees `org_B` and never `org_A`.
- **Gate mutation M4 executed and reverted** — see the dedicated section below.
- **Local production smoke passed**: `HTTP 200` with `{"ok":true,"db":"up","proxy":"up","commit":"local"}`, leaking nothing.

## Task Commits

1. **Task 1: proxy.ts, the postgres.js client, withOrg, requireOrg, and the withOrg regression test** — `3a91b31` (feat)
2. **Task 2: The unstyled shell — layout, activation, the signed-in page, /no-access, /sign-in and /api/health** — `8cd40f2` (feat)
3. **Task 3: E2E specs, and a local production smoke of /api/health** — `56c3d43` (test)

Base commit: `ba49b64`. Branch: `worktree-agent-a0c72b8a3096d0d18`.

_STATE.md, ROADMAP.md and REQUIREMENTS.md were deliberately NOT touched — the orchestrator owns those writes after the wave completes._

## Files Created/Modified

- `src/proxy.ts` — `clerkMiddleware()` and a matcher including `/__clerk/(.*)`. No route matcher, no protect call, no execution-environment declaration.
- `src/db/client.ts` — postgres.js on `env.SUPABASE_DB_POOL_URL` with `prepare: false, max: 1`, wrapped by Drizzle.
- `src/db/with-org.ts` — `withOrg()` and `OrgClaims`; the `ROLES` allow-list Set.
- `src/lib/auth/require-org.ts` — `requireOrg()` / `orgClaims()` / `ensureOrgRow()`; JIT provisioning through `app.ensure_org`.
- `tests/db/with-org.test.ts` — one named test, both halves of the same invariant, the D-04 Supabase-host guard, and a `db.$client.end()` teardown.
- `src/components/activate-sole-organization.tsx` — ported whole from BIS with the `attempted` ref, the full window navigation, and the non-destructive `.catch()`.
- `src/app/layout.tsx` — skeleton; activation mounted inside `ClerkProvider`, above `{children}`.
- `src/app/page.tsx` — user id, Clerk org id, provisioned tenant uuid, three `data-testid` hooks.
- `src/app/no-access/page.tsx` — D-02 landing, `SignOutButton` the only affordance.
- `src/app/sign-in/[[...sign-in]]/page.tsx` — created with the Write tool only.
- `src/app/api/health/route.ts` — `{ ok, db, proxy, commit }`.
- `tests/e2e/signed-in.spec.ts`, `tests/e2e/no-access.spec.ts` — written, enumerable, not run.

## Verification Evidence

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test:unit` | 4 files, 11 tests passed |
| `pnpm test:db` | 5 files, 14 tests passed — includes `tests/db/with-org.test.ts > withOrg binds the tenant claims and they die with the transaction` |
| `pnpm build` | exit 0; routes `/`, `/api/health`, `/no-access`, `/sign-in/[[...sign-in]]` + `ƒ Proxy (Middleware)` |
| `playwright test --list` | exit 0 with placeholders — 3 tests + the setup fixture |
| e2e env preamble | fails loudly with the vars absent, naming `E2E_BASE_URL, E2E_ADMIN_EMAIL`, printing no values |
| `git diff --stat pnpm-lock.yaml package.json` | empty |
| `ls src/app/proxy.ts` / `ls proxy.ts` | both fail; `ls src/proxy.ts` succeeds |

**Test names were read, not just exit codes.** The first `pnpm test:db -t "die with the transaction"` run exited 0 but the default reporter printed no test name — exactly the failure mode where a `-t` filter matching nothing exits green. It was re-run with `--reporter=verbose`, which named the test.

## Gate Mutation M4 — executed

- **Mutation:** in `src/db/with-org.ts`, the third argument of `set_config('request.jwt.claims', $1, true)` changed `true` → `false` (the non-local form).
- **Proof the mutation landed:** run against the *committed* file, so `git diff -U0` showed the `-`/`+` pair with `true)` → `false)`. (A mutation asserted only by "the file was edited" is the recorded trap; the diff was read.)
- **Result — exactly one named test red:** `tests/db/with-org.test.ts > withOrg binds the tenant claims and they die with the transaction`, at line 91: `Expected: "select set_config('request.jwt.claims', $1, true)"` / `Received: "...$1, false)"`.
- **Positive path intact:** the full DB suite was run under the mutation — **1 failed, 13 passed**. Every other test in `ensure-org`, `rls-isolation`, `schema-audit` and `time` stayed green, so the gate is specific to M4 and not a blast radius.
- **Reverted:** `git diff --stat` came back **empty** (byte-identical), and the named test was re-run green.

M4's wording *does* discriminate — unlike M1, which 01-05 found did not. Recorded as run.

## Local `/api/health` Smoke

- **Command:** `node node_modules/next/dist/bin/next start -p 3000`, launched directly rather than via `pnpm start` so the recorded PID is the server and not a wrapper.
- **Port 3000 was verified free first** (`netstat`), so the probe could not have hit somebody else's server.
- **PID started:** MSYS `1803` / Windows `74144`. Identity confirmed before stopping, three ways: `/proc/1803/cmdline` = `node.exe node_modules/next/dist/bin/next start -p 3000`, `/proc/1803/winpid` = `74144`, and `/proc/1803/cwd` → this worktree.
- **PID stopped:** `kill 1803` — **only** that PID. No `taskkill /IM node.exe`, no kill by name; danlo's other node processes were untouched and `ps` afterwards confirmed only the shell remained, with no listener on 3000.
- **Response:** `HTTP 200`

```json
{"ok":true,"db":"up","proxy":"up","commit":"local"}
```

- `db: "up"` proves `SUPABASE_DB_POOL_URL` resolves and `app_user` connects.
- `proxy: "up"` proves `clerkMiddleware()` ran, i.e. `src/proxy.ts` is in the right directory.
- **Leak scan clean** for all five forbidden strings: `postgres://`, `@localhost`, `password`, `sk_`, `jahgeqshuesndyscnmjo`.

## Environment Note

`NEXT_PUBLIC_CLERK_SIGN_IN_URL` was **already** `/sign-in` in `.env.local` — no local change was needed. Plan 10 must still set that exact value on Vercel, since `requireOrg()` redirects to `/sign-in` and a Clerk account-portal URL there would send users off-site instead.

## Decisions Made

1. **Comments do not spell tokens that a grep enforces absent from the same file.** The doctrine is described instead. See Deviations.
2. **`next start` launched directly, not through `pnpm`.** The recorded PID is then the server itself; the pnpm wrapper's child would have survived a kill of the wrapper (a recorded BIS lesson).
3. **The e2e specs were proven two ways rather than run.** Running them needs `E2E_BASE_URL`, which points at a deployment that does not exist until plan 10.
4. **Task 1 was committed before mutation M4 was run**, so that "revert byte-identical, `git diff` empty" is a real assertion against a tracked file. On untracked files `git diff` is empty no matter what, which would have made the check vacuous.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Four plan-internal contradictions between the prescribed file bodies and the plan's own acceptance greps**

- **Found during:** Tasks 1, 2 and 3.
- **Issue:** The plan prescribes verbatim code blocks whose *comments* spell tokens that the same task's acceptance criteria require to grep to zero over the same file. Written verbatim, the files fail the plan's own checks:

  | File | Token in the prescribed comment | Criterion |
  |---|---|---|
  | `src/proxy.ts` | `createRouteMatcher`, `runtime` | each must grep to 0 |
  | `src/db/with-org.ts` | `sql.raw(JSON.stringify` | must grep to 0 |
  | `src/lib/auth/require-org.ts` | `serviceDb` | must grep to 0 across `src/` |
  | `src/app/layout.tsx` | `ActivateSoleOrganization` a 3rd time | must be exactly 2 |
  | `src/components/activate-sole-organization.tsx` | `router.refresh` | must grep to 0 |
  | `tests/e2e/no-access.spec.ts` | `setActive` | must grep to 0 over `tests/e2e/` |

- **Fix:** Reworded each comment to carry the same doctrine without spelling the token, and said so in the comment. This is not an invention — it is the **house pattern already established in this repo**: `src/lib/auth/sole-organization.ts` (plan 06) ends *"Both of those are enforced by a bare token grep over this file, so this comment does not spell either token: naming them here would trip the guards it is describing,"* and `tests/e2e/auth.setup.ts` (plan 03) already avoids the `setActive` token the same way.
- **Files modified:** `src/proxy.ts`, `src/db/with-org.ts`, `src/lib/auth/require-org.ts`, `src/app/layout.tsx`, `src/components/activate-sole-organization.tsx`, `tests/e2e/no-access.spec.ts`
- **Verification:** every listed grep re-run and confirmed at its required count; `typecheck`, `lint` and `build` re-run green after each edit. **No behavioural change whatsoever** — comments only.
- **Committed in:** `3a91b31`, `8cd40f2`, `56c3d43` (within the respective task commits)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Comment text only; no behaviour, no scope creep. Every acceptance criterion in the plan is now satisfied as written.

## Issues Encountered

- **`pnpm test:db -t "…"` exits 0 without printing the test name** under the default reporter, which is precisely the condition the project's own hard lesson warns about (*"a `-t` filter that matches nothing exits green — read the failing test NAME"*). Resolved by adding `--reporter=verbose` to every gate run in this plan, and the name was read each time. **Worth carrying forward: the plan's acceptance criterion "its output prints the test name" is not satisfiable with the default reporter, so later plans should specify `--reporter=verbose` in the command itself.**
- No database schema was touched and `db:generate` / `db:migrate` were never run, per the parallel-execution boundary with plan 01-07. No lock contention was observed.

## Open Observations for the Verifier

- **The `proxy` field's discrimination is asserted but not mutation-proven.** `proxy: "up"` came back from a correctly-placed `src/proxy.ts`; it was not re-probed with the file moved into `app/` to confirm the field would report `down`. That would have required a second build-and-restart cycle outside the plan's single named mutation (M4). RESEARCH Pitfall 7's claim that `auth()` throws without the proxy is `[CITED]`, not executed here. Plan 10/11's post-deploy hit of this endpoint is the natural place to close it.
- The two e2e specs have never been executed against a running app. Their selectors match the `data-testid` values in `src/app/page.tsx` and `src/app/no-access/page.tsx` by inspection only.

## User Setup Required

None new in this plan. Carried forward for plan 10: `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `SUPABASE_DB_POOL_URL` and `CLERK_SECRET_KEY` must be set on the Vercel project.

## Next Phase Readiness

- The contract plans 10 and 11 depend on is in place: `withOrg`, `requireOrg`, the four routes, and `/api/health` as the deploy smoke target.
- `/api/health` is ready to be hit in CI after deploy; a missing proxy or an unreachable database shows up there immediately and without leaking either cause.
- Blocker for plan 11 only: `E2E_BASE_URL`, `E2E_ADMIN_EMAIL` and `CLERK_TESTING_TOKEN` are still unset, by design.

---
*Phase: 01-foundations-tenancy*
*Completed: 2026-09-21*

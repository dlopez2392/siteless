---
phase: 1
slug: foundations-tenancy
status: planned
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-21
updated: 2026-09-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` § Validation Architecture. The per-task map below was filled
> by `/gsd-plan-phase` on 2026-09-21; the executor updates **Status** only.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@5.0.1` (+ `vite@8.3.0`) for unit and DB-integration; `@playwright/test@1.63.0` for E2E |
| **Config file** | created by plan **01-03**: `vitest.config.ts` (TZ + locale pinned above the imports, `pool: 'forks'`), `vitest.db.config.ts` (`pool: 'forks'`, `singleFork`, `.env.local` loaded), `playwright.config.ts` |
| **Quick run command** | `pnpm test:unit` → `vitest run tests/unit` |
| **DB suite command** | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks --poolOptions.forks.singleFork` (serial: `withRollback` opens a real connection per test) |
| **Full suite command** | `pnpm verify` → `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db` |
| **E2E command** | `pnpm test:e2e` → `playwright test` against `E2E_BASE_URL` (the **deployed** URL, never localhost) |
| **Estimated runtime** | unit < 10 s · db ~30–60 s · verify ~2 min · e2e ~2 min against the deployed URL |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit` plus the single `-t "<name>"` filter for the test that task made green — and **read the test name in the output**: a `-t` filter that matches nothing exits green.
- **After every plan wave:** Run `pnpm verify` (typecheck + lint + unit + db).
- **Before `/gsd-verify-work`:** `pnpm verify` green, `pnpm test:e2e` green against the deployed URL, and the four recorded **mutation checks** below.
- **Max feedback latency:** 60 seconds (unit + one DB filter)

### The four phase-gate mutation checks (each must turn exactly ONE named test red, then be reverted and diffed back)

| # | Plan / Task | Mutation | The one test that must go red |
|---|-------------|----------|-------------------------------|
| M1 | **01-05 T3** | Drop the `WITH CHECK` clause from the `businesses_insert` policy | `org A cannot INSERT into org B, and the refusal is 42501` |
| M2 | **01-07 T3** | `alter table source_records drop constraint sr_google_is_ephemeral` | `google content cannot be durable` |
| M3 | **01-09 T3** | `drop trigger businesses_event on businesses` | `a direct write still produces an event` |
| M4 | **01-08 T1** | In `src/db/with-org.ts`, change the third argument of `set_config('request.jwt.claims', $1, true)` from `true` to `false` — the non-local form | `withOrg binds the tenant claims and they die with the transaction` |

Two supporting mutations are also recorded: **01-06 T1** (a leaky payload builder → `no registered payload builder emits an internal annotation`) and **01-09 T3** (`grant update, delete on events to authenticated` → `events are append-only: UPDATE as authenticated is refused`).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-03-T1 | 01-03 | 1 | FOUND-06 | — | zone + locale pinned in the main process; suite runs in a discriminating zone (UTC) | unit | `pnpm test:unit -t "suite runs in a zone that can discriminate"` | 01-03 T1 | ⬜ pending |
| 01-04-T3 | 01-04 | 1 | FOUND-01 | T-1-03 | bootstrap roles exist; `app_user` is login + NOINHERIT; `app.jwt()` reads the v2 claim | script | `pnpm db:check --bootstrap` | 01-04 T1/T3 | ⬜ pending |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-01 | T-1-02 | org A sees only org A rows (v1 flat claim) | DB-integration | `pnpm test:db -t "sees only its own org"` | 01-05 T2 | ⬜ pending |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-13 | token v2 `{o:{id}}` resolves the same org as v1 | DB-integration | `pnpm test:db -t "token v2"` | 01-05 T2 | ⬜ pending |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-02 | foreign-org INSERT → `42501` + "row-level security" | DB-integration | `pnpm test:db -t "42501"` | 01-05 T2 | ⬜ pending |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-02 | second statement in an aborted tx → `25P02` | DB-integration | `pnpm test:db -t "25P02"` | 01-05 T2 | ⬜ pending |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-02 | cross-org UPDATE/DELETE affect 0 rows (filtered, not refused) | DB-integration | `pnpm test:db -t "filtered, not refused"` | 01-05 T2 | ⬜ pending |
| 01-05-T2 | 01-05 | 2 | FOUND-01 | T-1-03 | a connection without `set local role` is refused `42501` | DB-integration | `pnpm test:db -t "without set local role"` | 01-05 T2 | ⬜ pending |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-01 | T-1-01 | `app.ensure_org` idempotent; refuses another org with `42501` | DB-integration | `pnpm test:db -t "ensure_org"` | 01-05 T2 | ⬜ pending |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-01 | T-1-02 | every public table has `org_id` + RLS + ≥1 policy (Set allow-list) | DB-integration | `pnpm test:db -t "every public table is org-scoped"` | 01-05 T2 | ⬜ pending |
| 01-05-T2 | 01-05 | 2 | FOUND-06 | — | every `timestamp` column in `public` is `timestamptz` | DB-integration | `pnpm test:db -t "timestamptz"` | 01-05 T2 | ⬜ pending |
| 01-05-T2 | 01-05 | 2 | FOUND-04 | T-1-09 | `legal_name`, `display_name`, `internal_notes` are three distinct columns | DB-integration | `pnpm test:db -t "three distinct name fields"` | 01-05 T2 | ⬜ pending |
| 01-06-T1 | 01-06 | 2 | FOUND-04 | T-1-09 | no registered payload builder emits the internal-notes canary | unit | `pnpm test:unit -t "internal annotation"` | 01-06 T1 | ⬜ pending |
| 01-06-T1 | 01-06 | 2 | FOUND-04 | T-1-09 | every module under `src/lib/export/` is in `PAYLOAD_BUILDERS` | unit | `pnpm test:unit -t "represented in the registry"` | 01-06 T1 | ⬜ pending |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | T-1-25 | `Intl.DateTimeFormat` called with `timeZone: 'America/Chicago'` + explicit locale, on every call | unit (spy) | `pnpm test:unit -t "pins the zone and the locale"` | 01-06 T2 | ⬜ pending |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | T-1-25 | one instant renders `2026-09-21` UTC / `2026-09-20` Chicago (TypeScript) | unit | `pnpm test:unit -t "opposite days"` | 01-06 T2 | ⬜ pending |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | T-1-25 | `formatLocal` ignores a caller-supplied `timeZone` (spread order is load-bearing) | unit (spy) | `pnpm test:unit -t "caller-supplied timeZone"` | 01-06 T2 | ⬜ pending |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | — | `2026-09-21T01:00Z` → `2026-09-21` UTC / `2026-09-20` Chicago (SQL) | DB-integration | `pnpm test:db -t "two zones, opposite verdicts"` | 01-06 T2 | ⬜ pending |
| 01-06-T3 | 01-06 | 2 | FOUND-01 | T-1-26 | `soleOrganizationToActivate` activates on exactly one membership; null on 0, >1, already-active, signed-out | unit | `pnpm test:unit -t "sole organization"` | 01-06 T3 | ⬜ pending |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-08 | `google_places` + `durable` → `23514` / `sr_google_is_ephemeral` | DB-integration | `pnpm test:db -t "google content cannot be durable"` | 01-07 T2 | ⬜ pending |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-08 | ephemeral without `expires_at`, and durable with one → `23514` / `sr_ephemeral_has_expiry` | DB-integration | `pnpm test:db -t "ephemeral"` | 01-07 T2 | ⬜ pending |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-27 | durable field citing an ephemeral source → `23503`; citing a durable source succeeds | DB-integration | `pnpm test:db -t "durable cites durable"` | 01-07 T2 | ⬜ pending |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-29 | `sr_expiry` partial index exists for Phase 4's TTL purge | DB-integration | `pnpm test:db -t "partial index on expires_at"` | 01-07 T2 | ⬜ pending |
| 01-08-T1 | 01-08 | 3 | FOUND-01 | T-1-11 | `proxy.ts` is at `src/`, contains no authorization; build is green | build | `pnpm build` | 01-08 T1 | ⬜ pending |
| 01-08-T1 | 01-08 | 3 | FOUND-01 | T-1-05 | `withOrg` issues `set_config('request.jwt.claims', $1, true)` with the claims as a BOUND parameter — text and params asserted separately through `PgDialect.sqlToQuery()` — and refuses a role outside the `Set` allow-list before any SQL is issued | DB-integration | `pnpm test:db -t "die with the transaction"` | 01-08 T1 | ⬜ pending |
| 01-08-T1 | 01-08 | 3 | FOUND-01 | T-1-04 | the claims do not survive COMMIT onto the pooled connection: between two `withOrg` calls on the same `max:1` client the GUC is empty, and the second transaction sees `org_B` and never `org_A` | DB-integration | `pnpm test:db -t "die with the transaction"` | 01-08 T1 | ⬜ pending |
| 01-08-T3 | 01-08 | 3 | Criterion 1 | T-1-12 | local production server answers `/api/health` 200 `{ok,db:up,proxy:up}` and leaks nothing | smoke | `curl -fsS http://localhost:3000/api/health` | 01-08 T3 | ⬜ pending |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | T-1-30 | a raw SQL write still produces an `events` row with actor + `occurred_at` | DB-integration | `pnpm test:db -t "direct write still produces an event"` | 01-09 T1 | ⬜ pending |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | T-1-06 | `update`/`delete` on `events` as authenticated → `42501` "permission denied for table events" | DB-integration | `pnpm test:db -t "append-only"` | 01-09 T1 | ⬜ pending |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | — | domain-column UPDATE moves `updated_at`, stamps `updated_by` | DB-integration | `pnpm test:db -t "updated_at"` | 01-09 T1 | ⬜ pending |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | T-1-30 | exactly `orgs` + `businesses` carry an `app.log_event` after-row trigger | DB-integration | `pnpm test:db -t "after-row trigger"` | 01-09 T1 | ⬜ pending |
| 01-10-T2 | 01-10 | 5 | FOUND-01/03/05 | T-1-21 | production schema matches local, count for count, applied only by drizzle-kit | script | `pnpm db:migrate:prod` (idempotent on the second run) | 01-10 T2 | ⬜ pending |
| 01-11-T1 | 01-11 | 6 | Criterion 1 | T-1-12 | `/api/health` on the DEPLOYED URL → 200 `{ok:true,db:'up',proxy:'up'}` with the expected commit | smoke | `curl -fsS "$DEPLOY_URL/api/health"` | 01-08 T2 | ⬜ pending |
| 01-11-T2 | 01-11 | 6 | Criterion 1 | T-1-11 | danlo signs in on the deployed URL and the page is org-scoped | E2E | `pnpm test:e2e -g "signs in and is org-scoped"` | 01-08 T3 | ⬜ pending |
| 01-11-T2 | 01-11 | 6 | FOUND-01 | T-1-11 | a signed-out visitor never reaches the shell; `/no-access` renders | E2E | `pnpm test:e2e -g "no access"` | 01-08 T3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*`A→B` in Task ID means the test is written RED in task A and turned green in task B.*

---

## Wave 0 Requirements

Wave numbering below matches the plan frontmatter. "Wave 0" in `01-RESEARCH.md` is realised as plans **01-01** and **01-02** (wave 0) plus **01-03** and **01-04** (wave 1), because the test harness and the bootstrap migration both depend on `package.json` existing.

- [ ] `package.json` + `pnpm-lock.yaml` + `"packageManager": "pnpm@12.5.1"` — **01-01 T1** (installed pnpm is 11.9.0; the field makes it self-switch)
- [ ] `tsconfig.json` / `next.config.ts` / `eslint.config.mjs` / placeholder shell — **01-01 T2**
- [ ] `src/env.ts` fail-loudly server env guard — **01-01 T3**
- [ ] A local PostgreSQL 18 for `TEST_DATABASE_URL` (D-05a; never a Supabase URL) — **01-02 T2** (danlo, checkpoint)
- [ ] `SUPABASE_DB_URL` / `SUPABASE_DB_POOL_URL` in `.env.local`; Clerk + Supabase dashboard settings confirmed — **01-02 T3** (danlo, checkpoint)
- [ ] `vitest.config.ts` (TZ + locale pinned above the imports) — **01-03 T1** — covers FOUND-06
- [ ] `vitest.db.config.ts` (`pool: 'forks'`, `singleFork`, `.env.local`) — **01-03 T1** — covers FOUND-01/02/03/05
- [ ] `tests/db/_fixtures.ts` (`withRollback`, `actAs`, `actAsRole`, `actAsOwner`, `seedTwoOrgs`) — **01-03 T2** — shared by every DB test
- [ ] `playwright.config.ts` + `tests/e2e/_required-env.ts` + `tests/e2e/auth.setup.ts` — **01-03 T3** — covers criterion 1
- [ ] `.github/workflows/ci.yml` with the `postgres:18` service container and `pnpm install --frozen-lockfile` — **01-03 T3**
- [ ] `drizzle.config.ts` + `scripts/db.ts` + `scripts/check-test-db.ts` — **01-04 T1**
- [ ] `drizzle/0000_bootstrap.sql` (roles `anon`/`authenticated`/`service_role`/`app_user`, `app` schema, `app.jwt()`) — **01-04 T2**, applied in **01-04 T3**
- [ ] `src/lib/export/registry.ts` — **01-06 T1** — the empty `PAYLOAD_BUILDERS` must exist so the leak sentinel is real from day one

> CI's `db` job is **expected red** between plan 01-03 and plan 01-05, because `pnpm db:migrate` has no application migrations to apply yet. Do not disable the job to make it green.

---

## Manual-Only Verifications

| Behavior | Requirement | Plan / Task | Why Manual | Test Instructions |
|----------|-------------|-------------|------------|-------------------|
| PostgreSQL 18 installed; `siteless_test` created; `TEST_DATABASE_URL` set | FOUND-02 | **01-02 T2** | Docker and WSL are both absent; the GUI installer has no scriptable path | `psql --version` reports 18.x; `psql -U postgres -l` lists `siteless_test` |
| Clerk: "users can create organizations" OFF, "Membership required" ON (D-02) | FOUND-01 | **01-02 T3** | Dashboard setting, no API in scope | Clerk → Configure → Organizations; record the two values in the SUMMARY |
| Clerk: exactly one organization, danlo a member of exactly one | FOUND-01 | **01-02 T3** | Dashboard state | Clerk → Organizations; this is what lets `ActivateSoleOrganization` activate |
| Supabase: Clerk third-party auth ENABLED for `equipped-newt-5148.clerk.accounts.dev` | FOUND-01 | **01-02 T3** | Dashboard setting | Supabase → Authentication → Sign In / Providers → Third-Party Auth |
| Production `app_user` password set | FOUND-01 | **01-10 T3** | Credential operation; the role has no password until one is set | Supabase SQL Editor: `alter role app_user with login password '...'` |
| Vercel env vars present for Production + Preview | Criterion 1 | **01-10 T3** | Secrets never in repo | `vercel env ls` shows all six names; no value printed |
| GitHub Actions secrets + `E2E_BASE_URL` variable | Criterion 1 | **01-10 T3**, **01-11 T3** | Repo settings | Repo → Settings → Secrets and variables → Actions |
| danlo signs in on the deployed URL and sees his org; tenant uuid stable on reload | Criterion 1 | **01-11 T3** | Human sign-in with an email code | See `01-11-PLAN.md` Task 3 `how-to-verify`, steps 1-7 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] The four phase-gate mutation checks (M1, M2, M3, M4) are recorded, each turning exactly one named test red, reverted and diffed back
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] `wave_0_complete: true` set in frontmatter

**Approval:** pending — set by **01-11 T3**

---
phase: 1
slug: foundations-tenancy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` § Validation Architecture (24 mapped tests). The planner fills the per-task map with real task IDs; the executor updates Status.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@5.0.1` (+ `vite@8.3.0`) for unit and DB-integration; `@playwright/test@1.63.0` for E2E |
| **Config file** | none — Wave 0 creates `vitest.config.ts` (TZ + locale pinned on line 1), `vitest.db.config.ts` (`pool: 'forks'`, `singleFork`, `dotenv/config`), `playwright.config.ts` |
| **Quick run command** | `pnpm test:unit` → `vitest run tests/unit` |
| **DB suite command** | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks --poolOptions.forks.singleFork` (serial: `withRollback` opens a real connection per test) |
| **Full suite command** | `pnpm verify` → `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db` |
| **Estimated runtime** | unit < 10 s · db ~30–60 s · verify ~2 min · e2e ~2 min against the deployed URL |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit` plus the single `-t "<name>"` filter for the test that task made green — and **read the test name in the output**: a `-t` filter that matches nothing exits green.
- **After every plan wave:** Run `pnpm verify` (typecheck + lint + unit + db).
- **Before `/gsd-verify-work`:** `pnpm verify` green, `pnpm test:e2e` green against the deployed URL, and a recorded **mutation check** for each of the three criterion tests — drop the `with check` clause (FOUND-02), drop `sr_google_is_ephemeral` (FOUND-05), drop the `after` trigger (FOUND-03) — each must turn exactly one named test red, then be reverted and diffed back.
- **Max feedback latency:** 60 seconds (unit + one DB filter)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | FOUND-06 | — | zone + locale pinned; suite runs in a discriminating zone | unit | `pnpm test:unit -t "suite runs in a zone that can discriminate"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-01 | T-1-tenant-isolation | org A sees only org A rows, both claim shapes | DB-integration | `pnpm test:db -t "sees only its own org"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-01 | T-1-tenant-isolation | every public table has org_id + RLS + ≥1 policy (allow-list) | DB-integration | `pnpm test:db -t "every public table is org-scoped"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-01 | T-1-role-leak | a connection without `set local role` is refused 42501 | DB-integration | `pnpm test:db -t "without set local role"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-01 | T-1-jit-org | `app.ensure_org` idempotent; refuses another org with 42501 | DB-integration | `pnpm test:db -t "ensure_org"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-02 | T-1-tenant-isolation | foreign-org INSERT → `42501` + "row-level security" | DB-integration | `pnpm test:db -t "42501"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-02 | T-1-tenant-isolation | second statement in aborted tx → `25P02` | DB-integration | `pnpm test:db -t "25P02"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-02 | T-1-tenant-isolation | cross-org UPDATE/DELETE affect 0 rows (filtered, not refused) | DB-integration | `pnpm test:db -t "filtered, not refused"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-02 | T-1-claim-shape | token v2 `{o:{id}}` resolves the same org as v1 | DB-integration | `pnpm test:db -t "token v2"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-03 | T-1-audit | raw SQL write still produces an `events` row with actor + occurred_at | DB-integration | `pnpm test:db -t "direct write still produces an event"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-03 | T-1-audit | `update`/`delete` on `events` as authenticated → 42501 | DB-integration | `pnpm test:db -t "append-only"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-03 | — | domain-column UPDATE moves `updated_at`, stamps `updated_by` | DB-integration | `pnpm test:db -t "updated_at"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-05 | T-1-retention | `google_places` + `durable` → `23514` / `sr_google_is_ephemeral` | DB-integration | `pnpm test:db -t "google content cannot be durable"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-05 | T-1-retention | ephemeral without `expires_at` (and durable with one) → `23514` | DB-integration | `pnpm test:db -t "ephemeral"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-05 | T-1-retention | durable field citing an ephemeral source → `23503` | DB-integration | `pnpm test:db -t "durable cites durable"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-04 | T-1-internal-leak | no registered payload builder emits the internal-notes canary | unit | `pnpm test:unit -t "internal annotation"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-04 | T-1-internal-leak | every module under `src/lib/export/` is in `PAYLOAD_BUILDERS` | unit | `pnpm test:unit -t "represented in the registry"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-04 | — | `legal_name`, `display_name`, `internal_notes` are three distinct columns | DB-integration | `pnpm test:db -t "three distinct name fields"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-06 | — | every `timestamp` column in `public` is `timestamptz` | DB-integration | `pnpm test:db -t "timestamptz"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-06 | — | `2026-09-21T01:00Z` → `2026-09-21` UTC / `2026-09-20` Chicago | DB-integration | `pnpm test:db -t "two zones, opposite verdicts"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | FOUND-06 | — | `Intl.DateTimeFormat` called with `timeZone: 'America/Chicago'` + explicit locale | unit (spy) | `pnpm test:unit -t "pins the zone and the locale"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | FOUND-01 | T-1-active-org | `soleOrganizationToActivate` activates on exactly one membership | unit | `pnpm test:unit -t "sole organization"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | FOUND-01 | T-1-no-access | signed-in user with no active org lands on `/no-access` | E2E | `pnpm test:e2e -g "no access"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | Criterion 1 | — | danlo signs in on the deployed URL and sees his org id | E2E | `pnpm test:e2e -g "signs in and is org-scoped"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 3 | Criterion 1 | — | `/api/health` → 200 `{ ok: true, db: 'up' }` on the deployed URL | smoke | `curl -fsS "$DEPLOY_URL/api/health"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` + `pnpm-lock.yaml` + `"packageManager": "pnpm@12.5.1"` — nothing exists yet (installed pnpm is 11.9.0; the field makes it self-switch)
- [ ] `vitest.config.ts` (TZ + locale pinned on line 1) — covers FOUND-06
- [ ] `vitest.db.config.ts` (`pool: 'forks'`, `singleFork`, `dotenv/config`) — covers FOUND-01/02/03/05
- [ ] `playwright.config.ts` + a storage-state auth setup — covers criterion 1
- [ ] `tests/db/_fixtures.ts` (`withRollback`, `actAs`, `actAsOwner`, `seedTwoOrgs`) — shared by every DB test
- [ ] `drizzle.config.ts` + `drizzle/0000_bootstrap.sql` (creates `anon` / `authenticated` / `service_role` / `app_user` roles and the `app` schema so a bare Postgres looks like Supabase) — nothing runs without these
- [ ] A local Postgres for `TEST_DATABASE_URL` — per the D-04 test-database decision (never a Supabase URL)
- [ ] `.github/workflows/ci.yml` with the `postgres:18` service container and `pnpm install --frozen-lockfile`
- [ ] `src/lib/export/registry.ts` — the empty `PAYLOAD_BUILDERS` registry must exist so the leak sentinel is real from day one

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clerk dashboard: "users can create organizations" is OFF (invite-only, D-02) | FOUND-01 | Dashboard setting, no API in scope | Clerk → Configure → Organizations → confirm creation disabled; screenshot into the phase SUMMARY |
| Supabase: Clerk third-party auth shows ENABLED with domain `equipped-newt-5148.clerk.accounts.dev` | FOUND-01 | Dashboard setting | Supabase → Authentication → Sign In / Providers → Third-Party Auth (already verified 2026-09-21; re-check before the first deploy) |
| Vercel env vars present for production + preview (names mirror `.env.local`) | Criterion 1 | Secrets never in repo | `vercel env ls` shows every required key; no value printed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

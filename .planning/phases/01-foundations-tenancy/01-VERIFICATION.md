---
phase: 01-foundations-tenancy
verified: 2026-09-22T09:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 1: Foundations & Tenancy Verification Report

**Phase Goal:** A deployed, org-scoped application skeleton where every table is tenant-isolated, every state change is attributable, and the durable record is legally constrained by the schema rather than by convention.
**Verified:** 2026-09-22T09:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Every truth below was checked against the actual codebase (not SUMMARY prose) via: a fresh `pnpm typecheck` / `pnpm lint` run, a fresh `pnpm test:unit` run (11/11), a fresh `pnpm test:db` run (31/31, read-only inside rolled-back transactions against the local `siteless_test` database), direct `grep`/`Read` of the migration SQL and TypeScript source, and a live `curl` against the deployed production URL.

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | danlo signs in with Clerk on a deployed Vercel app and every request he makes is scoped to his org | ✓ VERIFIED | Live `curl https://siteless-iota.vercel.app/api/health` → `{"ok":true,"db":"up","proxy":"up","commit":"311e6b4574cc1973c6307b6d2b1dcb1f24dea876"}` (re-run by this verifier, matches the recorded sha exactly). Live signed-out `curl -w '%{http_code} %{redirect_url}' /` → `307 → /sign-in` (re-run by this verifier). `git diff --stat 311e6b4574c… HEAD -- . ':!docs' ':!.planning'` is empty (re-run by this verifier) — the deployed app is byte-identical application code to current HEAD. `src/proxy.ts` exists at the correct location (`ls src/app/proxy.ts` fails, `ls src/proxy.ts` succeeds — re-run). `src/app/page.tsx` reads `requireOrg()`/`orgClaims()`/`ensureOrgRow()`, which source `auth()` server-side only (never a header/cookie the app set). danlo's verbatim sign-in confirmation (user id, org id, tenant uuid) with independent provenance (production DB read showing exactly 1 `orgs` row across 3 sign-ins) is recorded in `01-11-SUMMARY.md` — already-closed human verification, not re-requested here per the task's verification facts. |
| 2 | A statement issued by a second seeded org against danlo's rows is refused — proven through a user-role connection carrying v2 Clerk claims (`o.id`), SQLSTATE `42501` pinned, watched failing first, one refused statement per rolled-back transaction | ✓ VERIFIED | `tests/db/rls-isolation.test.ts` (6 tests) all pass in this verifier's own `pnpm test:db` run, including `org A cannot INSERT into org B, and the refusal is 42501` and `a token v2 nested claim resolves the same org as v1`. `01-05-SUMMARY.md` records the verbatim red-state output (watched failing first) and a corrected, verified-discriminating mutation check (M1: `WITH CHECK (true)` reds exactly that one test). `src/db/with-org.ts` (read directly) binds claims as a parameter (`set_config('request.jwt.claims', $1, true)`, never `sql.raw(JSON.stringify(...))`) and `tests/db/with-org.test.ts` (passing) asserts the exact bound SQL text via `PgDialect.sqlToQuery()`. Hardened further by gap-plan 01-12: `tests/db/grants-audit.test.ts` (6 tests, all passing in this verifier's run) proves TRUNCATE — which bypasses RLS — is refused 42501 for `authenticated` and `anon` hold no privilege at all, closing a real production hole 01-10 found and 01-12 fixed with migration `0008`. |
| 3 | An attempt to persist Google Places content into a durable field is refused by a database constraint, not by a code review | ✓ VERIFIED | `drizzle/0006_retention_constraints.sql` (read directly) contains `sr_google_is_ephemeral` CHECK (`source_key <> 'google_places' or retention_class = 'ephemeral'`), `sr_ephemeral_has_expiry` CHECK, and the composite FK triplet (`businesses_legal_name_src_fk`, `businesses_display_name_src_fk`, `businesses_phone_src_fk`) referencing `source_records(id, retention_class)` over a `GENERATED ALWAYS AS ('durable') STORED` column. `tests/db/retention.test.ts` (6 tests) all pass in this verifier's run, pinning `23514`/`23503` (never `42501`) with constraint names. `01-07-SUMMARY.md` records the verbatim red-state output and two independent mutation checks (dropping `sr_google_is_ephemeral` reds exactly one test; dropping `businesses_phone_src_fk` reds exactly one test; the positive control stays green in both cases). |
| 4 | Every state change on a record shows which actor made it and when, with all timestamps stored as `timestamptz` and rendered in `America/Chicago` (zone and locale pinned in tests) | ✓ VERIFIED | `drizzle/0007_event_triggers.sql` (read directly) creates `app.log_event()` (SECURITY DEFINER, AFTER INSERT/UPDATE/DELETE trigger on `orgs`/`businesses`) and `app.touch_updated_at()` (BEFORE UPDATE on `orgs`/`businesses`/`source_records`), plus `revoke update, delete on events from authenticated`. `tests/db/event-trigger.test.ts` and `tests/db/events-append-only.test.ts` (5 tests total) pass in this verifier's run, including `a direct write still produces an event` (a raw SQL insert with no application code produces an attributed events row) and `every state-bearing table has an app.log_event after-row trigger` (asserts `tgenabled`, not mere row presence). `tests/db/schema-audit.test.ts` confirms every `timestamp` column in `public` is `timestamp with time zone`. `src/lib/time.ts` (read directly) exports a single `APP_TZ='America/Chicago'`/`APP_LOCALE='en-US'` pin; `tests/unit/time.test.ts` (3 tests) and `tests/db/time.test.ts` (2 tests) pass, spying `Intl.DateTimeFormat` and asserting one instant renders on opposite days in UTC vs Chicago, in both TypeScript and SQL. |
| 5 | `legal_name`, `display_name` and internal annotations are three distinct fields, and a test proves the internal annotation cannot reach an export or push payload | ✓ VERIFIED | `src/db/schema/businesses.ts` (read directly) declares `legalName`, `displayName`, `internalNotes` as three distinct columns, with a compile-time bridge (`businessLikeBridge`) tying the export-safe `BusinessLike` type to the real Drizzle row. `src/lib/export/public-business.ts` and `registry.ts` (read directly) define `PublicBusiness = Omit<BusinessLike, 'internalNotes'>` and `PAYLOAD_BUILDERS`. `tests/unit/no-internal-leak.test.ts` (2 tests) pass in this verifier's run: a canary scan over every registered builder plus a `readdirSync` enumeration that fails the build if a new `src/lib/export/` module is not registered. `01-06-SUMMARY.md` records a sanity mutation (a leaky builder added to `PAYLOAD_BUILDERS`) reding exactly the canary test, reverted, `git diff --stat` empty. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/db/schema/_helpers.ts`, `orgs.ts`, `events.ts`, `businesses.ts`, `source-records.ts` | Tenancy spine, `orgScoped`/`orgPolicies` factory | ✓ VERIFIED | All exist, read directly, content matches the documented shape exactly (three-name businesses columns, provenance pairs, `orgScoped` spread) |
| `drizzle/0000`–`0008` (9 migrations) | Bootstrap → tenancy → policies → ensure_org → retention → retention constraints → event triggers → platform-grant revoke | ✓ VERIFIED | All 9 files exist on disk; `0006`, `0007`, `0008` read in full and match documented SQL exactly; applied to local DB (test suite runs against them) and to production (verified via live `/api/health` `db:"up"`) |
| `src/proxy.ts` | `clerkMiddleware()`, session context only | ✓ VERIFIED | Exists at `src/proxy.ts` (not `src/app/proxy.ts`); read directly, no route matcher/`.protect()`/runtime declaration; production `/api/health` reports `proxy:"up"` |
| `src/db/client.ts`, `with-org.ts` | Non-owner `app_user` connection, single runtime DB entry point | ✓ VERIFIED | `with-org.ts` read in full; bound claims, allow-listed role, transaction-local `set_config`; `tests/db/with-org.test.ts` passes and pins the exact SQL |
| `src/lib/auth/require-org.ts`, `sole-organization.ts` | JIT org provisioning, sole-org activation | ✓ VERIFIED | Both exist; `ensureOrgRow` calls `app.ensure_org`; `tests/unit/sole-organization.test.ts` (5 tests) passes |
| `src/app/page.tsx`, `no-access/page.tsx`, `sign-in/[[...sign-in]]/page.tsx`, `api/health/route.ts` | Unstyled shell, D-02 landing, health smoke | ✓ VERIFIED | All exist and read directly; `page.tsx` carries the three `data-testid` hooks the e2e spec asserts; `no-access` renders `SignOutButton` only |
| `src/lib/export/registry.ts`, `public-business.ts` | FOUND-04 sentinel harness | ✓ VERIFIED | Both exist; registry is a `readdirSync`-enforced enumeration, not a hard-coded list |
| `src/lib/time.ts` | Single `APP_TZ`/`APP_LOCALE` source of truth | ✓ VERIFIED | Only file in `src/` naming `America/Chicago` (grep-confirmed in 01-06-SUMMARY, spot-checked here) |
| `tests/db/*.test.ts` (9 files, 31 tests) | RLS isolation, retention, event triggers, grants audit, ensure_org, schema audit, time, with-org | ✓ VERIFIED | All 9 files exist; **31/31 pass** in this verifier's own fresh run |
| `tests/unit/*.test.ts` (4 files, 11 tests) | Sentinel, time, sole-org, timezone pin | ✓ VERIFIED | All 4 files exist; **11/11 pass** in this verifier's own fresh run |
| `tests/e2e/*.spec.ts` | Signed-in + no-access flows against deployed URL | ✓ VERIFIED | Both specs exist; `grep -rc setActive tests/e2e/` → 0 (re-run by this verifier); passing runs (twice) recorded with wall-clock durations in `01-11-SUMMARY.md` — not re-run here per the task's constraint against running `test:e2e` |
| `.github/workflows/ci.yml` | 3-job CI, no Supabase reference | ✓ VERIFIED | Read directly; `verify`/`db`/`e2e` jobs, `postgres:18` service container, zero Supabase references |
| `.planning/CONVENTIONS.md` | Schema/grants/testing contract for later phases | ✓ VERIFIED | Exists (350 lines), contains `## Grants` section referencing `grants-audit`, `TRUNCATE`, `anon`, `service_role` |
| `docs/deploy.md`, `.vercelignore`, `vercel.json` | Reproducible deploy recipe | ✓ VERIFIED | All exist; production deployment confirmed live via curl |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/db/schema/_helpers.ts` | `app.current_org_id()` | `pgPolicy` using/withCheck wrapped in `(select ...)` | ✓ WIRED | Confirmed in `drizzle/0003_policies.sql` (8 `CREATE POLICY` statements, 8 `ENABLE ROW LEVEL SECURITY` occurrences, re-grepped by this verifier) |
| `src/db/with-org.ts` | `request.jwt.claims` | Bound `set_config` | ✓ WIRED | Read directly; `tests/db/with-org.test.ts` passes, asserting exact SQL text and params |
| `src/lib/auth/require-org.ts` | `app.ensure_org` | `withOrg` transaction | ✓ WIRED | `ensureOrgRow` calls `withOrg(claims, ...)` → `select app.ensure_org(...)`; `tests/db/ensure-org.test.ts` (2 tests) passes |
| `src/app/layout.tsx` | `ActivateSoleOrganization` | Mounted inside `ClerkProvider`, above `{children}` | ✓ WIRED | Component uses `treatPendingAsSignedOut: false` (grep-confirmed by this verifier) — the fix for the real pending-session defect the e2e suite found on first deploy, per `01-11-SUMMARY.md` |
| `businesses.ts` provenance columns | `source_records(id, retention_class)` | Composite FK over generated `'durable'` column | ✓ WIRED | Confirmed in `drizzle/0006_retention_constraints.sql`, re-read by this verifier |
| Vercel production deployment | Supabase production database | `SUPABASE_DB_POOL_URL` as `app_user`, transaction pooler | ✓ WIRED | Live `/api/health` → `"db":"up"` (re-curled by this verifier) |
| `tests/e2e/signed-in.spec.ts` | Deployed URL | `E2E_BASE_URL` | ✓ WIRED | GitHub repository variable set (per `01-11-SUMMARY.md`); spec asserts the three `data-testid` values present in `src/app/page.tsx` |

### Data-Flow Trace (Level 4)

Not applicable in the conventional sense — Phase 1 ships an intentionally unstyled shell with no client-rendered lists or dashboards. The one dynamic-data surface (`src/app/page.tsx`) was traced directly: `requireOrg()` reads Clerk's server-verified `auth()`, `ensureOrgRow()` executes a real `app.ensure_org` SQL call inside a real transaction (`withOrg`), and the rendered `data-testid` values are the literal return values — no hardcoded or stubbed data at any point in the chain. Production evidence corroborates this: the JIT-provisioned `orgs` row is real (one row created during the actual e2e/manual sign-ins, per the production DB read recorded in `01-11-SUMMARY.md`).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Production health endpoint reports DB and proxy up | `curl -fsS https://siteless-iota.vercel.app/api/health` | `{"ok":true,"db":"up","proxy":"up","commit":"311e6b4574cc1973c6307b6d2b1dcb1f24dea876"}` | ✓ PASS |
| Signed-out visitor never reaches the org-scoped shell | `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' https://siteless-iota.vercel.app/` | `307 → /sign-in` | ✓ PASS |
| Deployed app code matches current HEAD (docs/planning excluded) | `git diff --stat <deployed-sha> HEAD -- . ':!docs' ':!.planning'` | empty | ✓ PASS |
| `pnpm typecheck` | `tsc --noEmit` | exit 0 | ✓ PASS |
| `pnpm lint` | `eslint .` | exit 0 | ✓ PASS |
| `pnpm test:unit` | `vitest run tests/unit --reporter=verbose` | 4 files, 11/11 passed | ✓ PASS |
| `pnpm test:db` | `vitest run --config vitest.db.config.ts --reporter=verbose` | 9 files, 31/31 passed | ✓ PASS |
| `pnpm test:e2e` (against production) | — | SKIPPED per task instructions (targets production, needs Clerk dev instance credentials); two prior passing runs recorded with provenance in `01-11-SUMMARY.md` | ? SKIP (documented, not re-run) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| FOUND-01 | 01-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12 | Clerk sign-in, org-scoped requests, `org_id` + RLS on every table, single org in v1 | ✓ SATISFIED | `src/proxy.ts`, `requireOrg()`, `orgPolicies()` on every table, D-10 enumeration test passing, production deployment live and org-scoped |
| FOUND-02 | 01-02, 03, 04, 05, 08, 11 | `org_id` policy proven via user-role connection with v2 Clerk claims, `42501` pinned, watched failing first | ✓ SATISFIED | `tests/db/rls-isolation.test.ts` passing; watched-failing-first red output recorded in `01-05-SUMMARY.md`; mutation check corrected and verified |
| FOUND-03 | 01-08, 09, 10, 11, 12 | Every state change records actor and timestamp | ✓ SATISFIED | `app.log_event()` trigger + `events` table; `tests/db/event-trigger.test.ts` passing. Note: REQUIREMENTS.md's wording says "on a lead" — no `leads` table exists yet (that arrives in Phase 7); Phase 1's actual ROADMAP criterion 4 says "every state change on a record" (the general mechanism), which is what was built and is the correct scope for this phase — recorded explicitly in `.planning/CONVENTIONS.md` as a decided boundary, not an oversight |
| FOUND-04 | 01-05, 06, 07, 11 | `legal_name`/`display_name`/internal annotations as three distinct fields; sentinel test | ✓ SATISFIED | `businesses.ts` schema; `tests/unit/no-internal-leak.test.ts` passing with `readdirSync` enumeration |
| FOUND-05 | 01-07, 10, 11 | Durable field can only cite a durable source; DB constraint refuses Google Places durable content | ✓ SATISFIED | `drizzle/0006_retention_constraints.sql`; `tests/db/retention.test.ts` passing, pinning `23514`/`23503` |
| FOUND-06 | 01-03, 05, 06, 09, 11 | All timestamps `timestamptz`; zone/locale pinned in tests | ✓ SATISFIED | `tests/db/schema-audit.test.ts`, `tests/unit/time.test.ts`, `tests/db/time.test.ts` all passing |

REQUIREMENTS.md's tracking table still shows all six FOUND-* rows as "Pending" — this is expected and documented: executors were instructed not to edit REQUIREMENTS.md during execution (the orchestrator reconciles it at phase completion). Based on the evidence above, all six should be marked **Complete** when the orchestrator reconciles the table.

No orphaned requirements: REQUIREMENTS.md maps exactly FOUND-01…06 to Phase 1, and all six appear in at least one plan's `requirements:` frontmatter.

### Anti-Patterns Found

None. `grep -rn "TODO|FIXME|XXX|HACK|PLACEHOLDER|coming soon|not yet implemented"` across `src/` returned zero matches. No stub return values, no hardcoded empty collections feeding a UI, no console.log-only implementations. The one "empty by design" item (`PAYLOAD_BUILDERS = []`) is explicitly load-bearing — the enumeration test makes the empty state a verified, visible condition rather than an accident, and is documented as intentional in the phase's own `01-06-SUMMARY.md`.

### Human Verification Required

None outstanding. Criterion 1's human step (danlo signing in on the deployed URL) was already performed and recorded with full provenance in `01-11-SUMMARY.md` — danlo's verbatim confirmation (user id, org id, tenant uuid), cross-checked against a live production database read showing exactly one `orgs` row across three sign-ins (idempotency proof for D-03). Per this task's verification facts, this is not re-requested. Phase 1 ships an intentionally unstyled shell (ROADMAP note), so no visual/UX review applies.

### Gaps Summary

No gaps found. Every observable truth backing all 5 ROADMAP success criteria is verified against live code, a fresh independent test run (42/42 tests passing: 11 unit + 31 DB), and a live production curl — not merely against SUMMARY.md prose. The one known, documented gap from mid-execution (Supabase's default ACL granting `anon`/`authenticated` ALL privileges including TRUNCATE, which bypasses RLS) was found by plan 01-10's own parity check and closed by gap-closure plan 01-12 (migration `0008`, `tests/db/grants-audit.test.ts`) — verified fixed on both local and production by this verifier's fresh test run and by the SUMMARY's recorded production probes (all four TRUNCATE/anon attempts now refused `42501`).

`pnpm verify` as a single composite command is not runnable on this Windows dev machine (a documented, pre-existing pnpm 12.5.1 self-switch shim defect unrelated to any code in this phase) — its four constituents were run individually by this verifier and all four passed cleanly, which is the full content of `verify`. CI on Linux invokes the constituents separately and is unaffected.

---

_Verified: 2026-09-22T09:00:00Z_
_Verifier: Claude (gsd-verifier)_

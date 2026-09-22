---
phase: 1
slug: foundations-tenancy
status: verified
threats_open: 0
asvs_level: 1
created: 2026-09-22
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> Verified against implemented code, applied migrations (`drizzle/0000_bootstrap.sql` …
> `drizzle/0011_events_no_caller_insert.sql`, 12 journal rows), and a read-only execution
> of both pinned suites: `pnpm test:unit` → **16/16 passed**, `pnpm test:db` → **37/37
> passed** (local PostgreSQL 18, `siteless_test`, rolled-back transactions). Evidence below
> is file:line, test name, or a migration/SQL fragment — never a SUMMARY claim taken on
> faith. Where 01-REVIEW.md found a gap in a mitigation this register already counted as
> closed (CR-01, CR-02, WR-01, WR-04), the evidence cites the fix commit and the current
> code, not the original (superseded) mitigation text.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| repository → git remote | Anything committed is permanently readable by anyone with repo access | credentials, connection strings |
| server module → client bundle | Next inlines any reachable `process.env.*` into the browser bundle | secrets, connection strings |
| npm registry → build | Every dependency version resolved at install time executes on the dev machine, CI and Vercel | supply chain |
| test suite → database | `TEST_DATABASE_URL` decides which database the RLS/grant/retention suite issues DDL against | schema, tenant data |
| CI runner → external services | A workflow that reaches the Supabase project or a paid API spends money and mutates production | production schema, budget |
| CI logs → public | Anything echoed in a step is readable by anyone with repo access | credentials |
| migration runner → database | `drizzle-kit migrate` runs as the owner and can alter any object; which database it reaches is decided by one env var | schema |
| runtime connection → tables | The role a request connects as decides whether RLS binds at all | tenant data |
| SQL function → caller privileges | A `SECURITY DEFINER` function without a pinned `search_path` runs attacker-supplied code as the owner | tenant data, schema |
| Clerk session token → database claims | `request.jwt.claims` is the only statement of who the caller is; everything downstream trusts it | identity, org membership |
| tenant A → tenant B | Two orgs share one database, one connection pool and one set of tables | tenant data |
| `authenticated` role → tables | RLS policies are the last thing between a signed-in user and every other tenant's rows | tenant data |
| caller argument → `app.ensure_org` | A text argument decides which org row gets created and who owns it | tenant identity |
| internal annotation → outbound payload | A CSV export row or a BIS push payload leaves the system and reaches a customer | `internal_notes` |
| process timezone → rendered date | The system zone silently substitutes for an explicit zone and the day is wrong by one | displayed dates |
| Clerk session → active organization | A session with no active org produces an empty, error-free product rather than an error | tenant scoping |
| Google Places API → durable storage | Maps Platform Terms forbid Places content becoming a business-listings database; only `place_id` is exempt indefinitely, lat/lng for 30 days | licensed third-party content |
| source record → canonical business field | A `businesses` column citing a source record inherits that source's legal status | licensed content, provenance |
| future phase → these tables | Phases 3-5 write here; anything the schema does not forbid, one of them will eventually do | schema evolution |
| browser → Next.js server | Everything the client sends, including any header, is attacker-controlled | requests |
| proxy → page/handler/server function | Server Functions are POSTs to the page's route; a matcher refactor can silently remove proxy coverage | authorization |
| Next.js server → Postgres | One pooled connection is reused across requests and tenants | tenant data, claims |
| health endpoint → public internet | `/api/health` is unauthenticated by design and reachable by anyone | liveness only |
| any writer → `events` | A trigger must fire for writes the application never made: psql, a migration, a future worker | audit log |
| `authenticated` → `events` rows | An attacker who can edit the audit log can erase their own actions | audit log |
| trigger function → caller privileges | A `SECURITY DEFINER` trigger runs as the owner on every write to the table it guards | tenant data |
| developer machine → production database | `pnpm db:migrate:prod` runs as the owner against the real project; there is no undo | production schema |
| Vercel runtime → production database | The credential Vercel holds decides whether RLS binds on every request in production | tenant data |
| repository / logs → credentials | A pasted connection string in a SUMMARY is as permanent as a committed one | credentials |
| public internet → deployed app | Everything in this phase is now reachable by anyone who finds the URL | full app surface |
| CI → deployed app | The e2e job signs in with a real Clerk credential held as a repository secret | session credential |
| deployment record → reality | A green build is not a working app, and a build of the wrong commit looks identical to a build of the right one | deployment provenance |
| user-role session → tables | `withOrg` runs every request as `authenticated`; TRUNCATE ignores RLS, so only grants stand between a session and every tenant's rows | every tenant's data |
| platform defaults → new tables | Supabase's `pg_default_acl` re-grants ALL to `anon`/`authenticated` on every table created later | future schema |

---

## Threat Register

61 rows across the twelve plans of this phase. The same Threat ID recurring across plans is
a separate row per (plan, threat) pair — later plans re-mitigate or strengthen an earlier
plan's threat as new surface is added. All are `status: closed`; `threats_open: 0`.

| Threat ID | Plan | Category | Component | Disposition | Evidence | Status |
|-----------|------|----------|-----------|-------------|----------|--------|
| T-1-10 | 01-01 | Information Disclosure | `.env.local`, `src/env.ts` | mitigate | `.gitignore:3-5` (`.env`, `.env.*`, `!.env.example`); `src/env.ts:1` `import 'server-only'`; boot error uses `Object.keys(parsed.error.flatten().fieldErrors)` (`src/env.ts:44`), never `.message` | closed |
| T-1-14 | 01-01 | Tampering (supply chain) | `package.json` / `pnpm-lock.yaml` | mitigate | `grep -n '[\^~]' package.json` → 0 matches; `.github/workflows/ci.yml:18` `pnpm install --frozen-lockfile`; `typescript: "6.0.3"` (`package.json:52`) | closed |
| T-1-16 | 01-01 | Information Disclosure | `src/app/**` | accept | Accepted Risks Log below | closed |
| T-1-15 | 01-02 | Tampering / Info Disclosure | `TEST_DATABASE_URL` | mitigate | `.env.example:28-30` names it distinctly from `SUPABASE_DB_URL`; 01-02-SUMMARY.md line 76 — grep of the line returns 0 `supabase` matches | closed |
| T-1-17 | 01-02 | Spoofing / EoP | Clerk organization settings | mitigate | 01-02-SUMMARY.md lines 161-162: dashboard read 2026-09-22, `create_organization: checked=false`, "Membership required" selected — recorded verbatim, provenance table included | closed |
| T-1-10 | 01-02 | Information Disclosure | `.env.local`, `.env.example` | mitigate | `.env.example` — all 14 non-comment lines end at `=` (verified by inspection); 01-02-SUMMARY.md line 79 confirms 0/14 with a value | closed |
| T-1-18 | 01-02 | Information Disclosure | Supabase direct connection address | mitigate | `.env.example:16-19` warns against `db.<ref>.supabase.co`; 01-02-SUMMARY.md line 78 — `SUPABASE_DB_URL` contains `:5432`, 0 occurrences of the direct host | closed |
| T-1-15 | 01-03 | Tampering / Info Disclosure | `tests/db/_fixtures.ts` | mitigate | `tests/db/_fixtures.ts:28-38` — `withRollback` throws before connecting if the URL matches `/supabase\.(co\|com)\|pooler\.supabase/` or is unset | closed |
| T-1-19 | 01-03 | Tampering | `.github/workflows/ci.yml` | mitigate | `grep -in supabase .github/workflows/ci.yml` → 0 matches (verified live); `db` job uses only the `postgres:18` service container (`ci.yml:46-51`) | closed |
| T-1-10 | 01-03 | Information Disclosure | CI logs, `tests/e2e/_required-env.ts` | mitigate | `tests/e2e/_required-env.ts:19-28` reports `missing.join(', ')`, never a value; `ci.yml:92-101` same pattern for the secrets guard | closed |
| T-1-14 | 01-03 | Tampering (supply chain) | CI toolchain | mitigate | `ci.yml:10-18` — `pnpm/action-setup@v4` before `actions/setup-node@v4`, `pnpm install --frozen-lockfile` | closed |
| T-1-20 | 01-03 | Repudiation | `tests/e2e/auth.setup.ts` | mitigate | `grep -rn setActive tests/` → present only in `src/components/activate-sole-organization.tsx` (app code); zero occurrences under `tests/e2e/`; `auth.setup.ts:22-26` documents the deliberate absence | closed |
| T-1-03 | 01-04 | Elevation of Privilege | runtime database role | mitigate | `drizzle/0000_bootstrap.sql:26-33` — `create role app_user login noinherit`, `grant authenticated to app_user`; proven live by `tests/db/rls-isolation.test.ts` "a connection without set local role authenticated is refused 42501" (37/37 pass) | closed |
| T-1-15 | 01-04 | Tampering | `scripts/db.ts` | mitigate | `scripts/db.ts:36-49` — `--target=test` throws before `spawnSync` (line 61) if the URL matches a Supabase host; `--target=prod` requires it AND port 5432 | closed |
| T-1-07 | 01-04 | Elevation of Privilege | `app.jwt()` | mitigate | `drizzle/0000_bootstrap.sql:41-44` — `language sql stable`, no `security definer` | closed |
| T-1-21 | 01-04 | Tampering | migration authority | mitigate | `ls supabase` → no such directory (verified live); `.planning/CONVENTIONS.md:76-92` § Migrations — "drizzle-kit is the single migration authority (D-09)... No Supabase CLI migrations. No MCP apply_migration." | closed |
| T-1-22 | 01-04 | Information Disclosure | `scripts/check-test-db.ts` | mitigate | `scripts/check-test-db.ts:37,48,65,70,78,88,97,146-150` — only `version()` banner and `ok` lines printed; no connection string, password or claims payload echoed | closed |
| T-1-02 | 01-05 | Information Disclosure | every org-scoped table | mitigate | `drizzle/0003_policies.sql:4-10` — select/insert/update/delete policies on `orgs`/`events`/`businesses`, `to authenticated`, all `org_id = (select app.current_org_id())`; `tests/db/rls-isolation.test.ts` "org A sees only its own org rows" + "filtered, not refused" (pass) | closed |
| T-1-01 | 01-05 | Spoofing | `app.ensure_org` | mitigate | `drizzle/0009_ensure_org_no_write.sql:31-53` raises `42501` when `p_clerk_org_id is distinct from v_claim`; `tests/db/ensure-org.test.ts` "app.ensure_org refuses another org with 42501" (pass) | closed |
| T-1-13 | 01-05 | Spoofing | `app.current_org_id()` | mitigate | `drizzle/0002_tenancy_functions.sql:5-9` — `coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')`; `tests/db/rls-isolation.test.ts` "a token v2 nested claim resolves the same org as v1" (pass) | closed |
| T-1-03 | 01-05 | Elevation of Privilege | runtime connection role | mitigate | Same as T-1-03/01-04; `tests/db/rls-isolation.test.ts` "a connection without set local role authenticated is refused 42501" (pass) | closed |
| T-1-07 | 01-05 | Elevation of Privilege | `app.current_org_id`, `app.ensure_org` | mitigate | `drizzle/0002_tenancy_functions.sql:6` and `drizzle/0009_ensure_org_no_write.sql:32` both `security definer set search_path = public` | closed |
| T-1-23 | 01-05 | Information Disclosure | `orgs` INSERT | mitigate | `drizzle/0003_policies.sql` — no `orgs_insert` policy exists (confirmed by full-file read); provisioning is only through `app.ensure_org` | closed |
| T-1-24 | 01-05 | Denial of Service | RLS predicate evaluation | mitigate | `src/db/schema/_helpers.ts:24,31,36,41,47` — every predicate wrapped `(select app.current_org_id())`; `businesses.ts:33` / `drizzle/0001_tenancy.sql:41-42` — `_org_idx` on every org-scoped table | closed |
| T-1-09 | 01-06 | Information Disclosure | `src/lib/export/**` | mitigate | `tests/unit/no-internal-leak.test.ts` — canary scan (line 61-62) + `readdirSync` enumeration (line 77-94), both pass; `public-business.ts:41` `PublicBusiness = Omit<BusinessLike,'internalNotes'>` | closed |
| T-1-25 | 01-06 | Tampering | day-bucket computation | mitigate | `src/lib/time.ts:21,42-51,60-62` — one `APP_TZ`, `timeZone` placed after options spread; `tests/unit/time.test.ts` all 3 tests pass, including constructor-spy assertions | closed |
| T-1-26 | 01-06 | Spoofing | active-organization activation | mitigate | `src/lib/auth/sole-organization.ts:63-72` — returns an org only for signed-in + no-active-org + exactly-one-membership; `tests/unit/sole-organization.test.ts` all 5 branches pass | closed |
| T-1-10 | 01-06 | Information Disclosure | `src/lib/export/public-business.ts` | mitigate | File imports nothing from `src/db/` (verified by read — only a type export) | closed |
| T-1-08 | 01-07 | Info Disclosure (legal/retention) | `source_records` | mitigate | `drizzle/0006_retention_constraints.sql:9-17` — `sr_ephemeral_has_expiry`, `sr_google_is_ephemeral` CHECK constraints; `tests/db/retention.test.ts` "google content cannot be durable" pins `23514` + constraint name (pass) | closed |
| T-1-27 | 01-07 | Tampering | `businesses` provenance | mitigate | `drizzle/0005_retention.sql:21,23,25` — `GENERATED ALWAYS AS ('durable') STORED`; `drizzle/0006_retention_constraints.sql:25-35` composite FKs; `tests/db/retention.test.ts` "durable cites durable" pins `23503` (pass) | closed |
| T-1-02 | 01-07 | Information Disclosure | `source_records` RLS | mitigate | `drizzle/0005_retention.sql:1,19,29-31` — table, `ENABLE ROW LEVEL SECURITY` and all four policies land in the same migration | closed |
| T-1-28 | 01-07 | Repudiation | constraint naming | mitigate | `tests/db/retention.test.ts` — every refusal asserts `constraint: '<name>'` alongside the SQLSTATE (lines 49,62,75,96) | closed |
| T-1-29 | 01-07 | Denial of Service | TTL purge | accept | Accepted Risks Log below | closed |
| T-1-11 | 01-08 | Elevation of Privilege | `src/proxy.ts` | mitigate | `grep -n "createRouteMatcher\|auth.protect\|runtime" src/proxy.ts` → 0 matches (verified live); file contains only `clerkMiddleware()` | closed |
| T-1-04 | 01-08 | Information Disclosure | `withOrg` on a pooled connection | mitigate | `src/db/with-org.ts:33` — `set_config(..., true)`; `tests/db/with-org.test.ts` asserts `setConfig.sql` ends `, true)` and pins claim locality across two sequential `withOrg` calls (pass) | closed |
| T-1-05 | 01-08 | Tampering (SQL injection) | `withOrg` claims/role | mitigate | `src/db/with-org.ts:31,33-34` — role allow-listed against a `Set` before any SQL, claims bound as `$1`; `tests/db/with-org.test.ts` asserts `setConfig.params === [JSON.stringify(A)]` and `sql` text excludes the claim value (pass) | closed |
| T-1-01 | 01-08 | Spoofing | org identity | mitigate | `src/lib/auth/require-org.ts:17` — `orgId` from `auth()` only; `src/app/page.tsx:14` — no header/cookie read | closed |
| T-1-03 | 01-08 | Elevation of Privilege | `src/db/client.ts` | mitigate | `src/db/client.ts:24` connects via `env.SUPABASE_DB_POOL_URL` (app_user); `grep -rn "db\.execute" src/` → exactly 1 match, `src/app/api/health/route.ts:27` (`select 1`, no table) | closed |
| T-1-15 | 01-08 | Tampering / Info Disclosure | `tests/db/with-org.test.ts` | mitigate | `tests/db/with-org.test.ts:38-59` — hoisted `vi.hoisted` block throws before any import if the resolved URL matches a Supabase host; never falls back to `TEST_DATABASE_URL` | closed |
| T-1-12 | 01-08 | Information Disclosure | `/api/health` | mitigate | `src/app/api/health/route.ts:23-45` — fixed enum shape + commit sha; `console.error` logs `e.name` only (line 30); no `e.message`/`String(e)`/`.stack` in the file | closed |
| T-1-26 | 01-08 | Spoofing | active organization | mitigate | `src/app/layout.tsx:22` mounts `<ActivateSoleOrganization/>` above `{children}`; `src/lib/auth/require-org.ts:19` `if (!orgId) redirect('/no-access?reason=none')` | closed |
| T-1-10 | 01-08 | Information Disclosure | server modules | mitigate | `src/db/client.ts:1`, `src/db/with-org.ts:1`, `src/lib/auth/require-org.ts:1` — all `import 'server-only'` as line 1 | closed |
| T-1-06 | 01-09 | Repudiation | `events` immutability | mitigate | `drizzle/0007_event_triggers.sql:71,73` — `grant select, insert`, `revoke update, delete`; `tests/db/events-append-only.test.ts` UPDATE/DELETE refusal tests pin `42501` + `/permission denied for table events/` (pass) | closed |
| T-1-30 | 01-09 | Repudiation | attribution coverage | mitigate | `drizzle/0007_event_triggers.sql:52-64` — `after insert or update or delete ... for each row execute function app.log_event()` on `orgs`,`businesses`; `tests/db/event-trigger.test.ts` "a direct write still produces an event" (raw SQL, pass) + "every state-bearing table has an app.log_event after-row trigger" (checks `tgenabled`, pass) | closed |
| T-1-07 | 01-09 | Elevation of Privilege | `app.log_event()` | mitigate | `drizzle/0007_event_triggers.sql:12-13` — `security definer set search_path = public` on the same statement | closed |
| T-1-31 | 01-09 | Tampering | actor spoofing | mitigate | `drizzle/0007_event_triggers.sql:25` — `coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system')`; no client-settable GUC path | closed |
| T-1-32 | 01-09 | Denial of Service | event write amplification | mitigate | `.planning/CONVENTIONS.md:176-193` § Audit and attribution — scope boundary decided and written down; `EVENT_LOGGED = new Set(['orgs','businesses'])` in `tests/db/event-trigger.test.ts:32`, `source_records` deliberately excluded | closed |
| T-1-03 | 01-10 | Elevation of Privilege | production runtime credential | mitigate | 01-10-SUMMARY.md lines 189-204 — `vercel env ls`: only `SUPABASE_DB_POOL_URL` (app_user) present on Production/Preview; `SUPABASE_DB_URL`/`TEST_DATABASE_URL` absent (re-verified at SUMMARY time) | closed |
| T-1-21 | 01-10 | Tampering | production schema | mitigate | 01-10-SUMMARY.md — pre-flight read + drizzle-kit-only apply + post-flight count parity (production vs local, count for count) | closed |
| T-1-10 | 01-10 | Information Disclosure | credentials in the repo or the SUMMARY | mitigate | 01-10-SUMMARY.md lines 236-268 — three-run credential grep, real-credential-shape probe returns "none"; no production credential in the repository | closed |
| T-1-33 | 01-10 | Tampering | build-time migration | mitigate | `.vercelignore:19-24` excludes `drizzle/`, with the reasoning recorded inline | closed |
| T-1-18 | 01-10 | Denial of Service | connection addressing | mitigate | `scripts/db.ts:45-49` — `--target=prod` requires `:5432` (session pooler); `docs/deploy.md:74-76` documents the transaction-pooler/session-pooler split | closed |
| T-1-11 | 01-11 | Elevation of Privilege | deployed authorization | mitigate | 01-11-SUMMARY.md lines 162-174 — `/api/health` `proxy:"up"` in production; signed-out `GET /` → `307 /sign-in`, `data-testid="org-id"` 0 occurrences; `tests/e2e/no-access.spec.ts` + `signed-in.spec.ts` assert the same from a real browser | closed |
| T-1-12 | 01-11 | Information Disclosure | `/api/health` in production | mitigate | 01-11-SUMMARY.md line 455 — deployed body scanned for `postgres://`, `@`, `password`, `sk_`, `jahgeqshuesndyscnmjo` — none present | closed |
| T-1-34 | 01-11 | Spoofing | deployment provenance | mitigate | 01-11-SUMMARY.md line 456 — `/api/health` echoes `VERCEL_GIT_COMMIT_SHA = 311e6b4574…`, equal to `git rev-parse HEAD` taken before the deploy; `src/app/api/health/route.ts:42` | closed |
| T-1-10 | 01-11 | Information Disclosure | CI secrets, `.env.local` | mitigate | `.github/workflows/ci.yml:80-83` — `E2E_BASE_URL` from `vars.*` (variable), Clerk credentials from `secrets.*`; 01-11-SUMMARY.md line 457 confirms `.env.local` never in `git status --short` | closed |
| T-1-20 | 01-11 | Repudiation | e2e trustworthiness | mitigate | 01-11-SUMMARY.md line 458 — `grep -rc setActive tests/e2e/` → 0; suite run twice against the deployed URL, both wall-clock durations recorded | closed |
| T-1-35 | 01-11 | Tampering | gate run against the wrong tree | mitigate | 01-11-SUMMARY.md line 459 — branch `main` and sha `ea1777f` printed AFTER the final `pnpm verify`, not before | closed |
| T-1-30 | 01-12 | Tampering / DoS | `public.*` tables, TRUNCATE | mitigate | `drizzle/0008_revoke_platform_grants.sql:50-51` — `revoke truncate, references, trigger, maintain ... from anon, authenticated`; `tests/db/grants-audit.test.ts` "a TRUNCATE of events..." and "a cascading TRUNCATE..." both refused `42501` (pass, live) | closed |
| T-1-31 | 01-12 | Elevation of Privilege | future tables via `pg_default_acl` | mitigate | `drizzle/0008_revoke_platform_grants.sql:68-69` — `alter default privileges ... revoke all on tables from anon, authenticated`; `tests/db/grants-audit.test.ts` "the public schema default ACL grants nothing to anon or authenticated on tables" (pass); `.planning/CONVENTIONS.md:114-123` § Grants makes explicit grants mandatory per table migration | closed |
| T-1-03 (revised) | 01-12 | Elevation of Privilege | RLS bypass (TRUNCATE) | mitigate | Same migration/test as T-1-30/01-12 — TRUNCATE closed by grant, not by policy | closed |

**61/61 rows closed. `threats_open: 0`.**

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|--------------|------|
| AR-01 | T-1-16 (01-01, Information Disclosure, `src/app/**`, low) | Phase 1's initial placeholder shell rendered two static strings and read no data — nothing sensitive was reachable because nothing was wired to a database at that point in the build sequence. Real authorization (`requireOrg()`) landed later in the same phase (plan 08) and is independently verified closed above; the accepted window was bounded and has since been superseded by code, not merely by time. | plan author (01-01-PLAN.md `<threat_model>`) | 2026-09-21 |
| AR-02 | T-1-29 (01-07, Denial of Service, TTL purge, low) | The `sr_expiry` partial index (`drizzle/0006_retention_constraints.sql:40`) ships in this phase but the purge job itself is Phase 4's. No Google Places call has been made anywhere in this phase's code (no Places client exists yet), so the retention exposure is zero until Phase 4 both makes the call and owes the purge job. | plan author (01-07-PLAN.md `<threat_model>`) | 2026-09-21 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|----------------|--------|------|--------|
| 2026-09-22 | 61 | 61 | 0 | gsd-security-auditor |

**Supporting evidence for this run:**
- `pnpm test:unit --reporter=verbose` → 5 files, **16/16 tests passed**
- `pnpm test:db --reporter=verbose` → 9 files, **37/37 tests passed** (local PostgreSQL 18, `siteless_test`)
- `01-REVIEW.md` (2026-09-22, status: fixed) — 2 BLOCKERs (CR-01, CR-02) and 6/7 WARNINGs fixed and committed (`b387cb2`, `32b1ebb`, `ef3ee7a`, `992a348`, `9145de3`, `1d0b374`, `0f1c2a5`, `1fce7da`); WR-07 deferred with a documented reason (the six retention constraints exist in applied SQL and are pinned by name in `tests/db/retention.test.ts` — only the Drizzle TS schema/snapshot lacks them, a known, non-blocking drift)
- All twelve plan SUMMARY.md files report `## Threat Flags: None` — no unregistered new attack surface was introduced anywhere in this phase; the one architectural finding that did surface (Supabase's default ACL / TRUNCATE gap, found in 01-10) was routed through a gap-closure plan (01-12) and is registered above as T-1-30/T-1-31/T-1-03(revised), not left informal

## Unregistered Flags

None. Every plan's `## Threat Flags` section reports "None" and cites the specific threat IDs already covering its new surface. No new network endpoint, auth path, file-access pattern or schema change was found without a corresponding register row.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-22

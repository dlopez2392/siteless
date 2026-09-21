# Phase 1: Foundations & Tenancy - Research

**Researched:** 2026-09-20
**Domain:** Multi-tenant Postgres (RLS on Supabase) + Clerk organizations + Next 16 App Router scaffold + Drizzle migration authority
**Confidence:** HIGH on the database layer (executed against real Postgres 18.3 during this session), HIGH on package versions and API surfaces (unpacked from the registry), MEDIUM on the Vercel-first-deploy sequence (documented, not executed)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tenancy model**
- **D-01:** One Siteless tenant = one Clerk organization — a **flat** model. No agency → accounts second level (that exists in BIS because BIS's customers have customers; Siteless's customer is the agency itself). An `orgs` table keyed by a unique `clerk_org_id`; every other table carries `org_id` (uuid FK to `orgs`).
- **D-02:** **Invite-only** in v1. Clerk's "users can create organizations" is OFF; danlo creates the org in the Clerk dashboard and invites BIS staff. A signed-in user with no org membership lands on a "no access" page — never an empty tenant.
- **D-03:** The `orgs` row is provisioned **just-in-time** on the first authenticated request that carries a Clerk org claim not yet seen (no Clerk webhook in this phase). One org exists in v1; the schema does not assume it.

**Test database**
- **D-04:** RLS / grant / constraint tests run against a **local Postgres** — Supabase CLI (`supabase start`, Docker) on the dev machine and a Postgres service container in CI. The cloud project `siteless` (`jahgeqshuesndyscnmjo`) is **production only** and is never a test target. This deliberately ends the BIS pattern of sharing one project between e2e and production.
- **D-05:** If Docker Desktop is not available on the dev machine (check at plan time, not assumed), the fallback is a second small Supabase project `siteless-dev` (~$10/mo on the Pro org). Under no fallback do tests touch the production project.

**Audit trail**
- **D-06:** An **append-only `events` table** is the record of truth for every state change: `org_id`, actor (Clerk user id), entity type + id, action, `before` / `after` (jsonb), `occurred_at timestamptz`. Immutable — UPDATE and DELETE grants revoked, not merely policied. This is what Phase 7's "status history with actor and timestamp" reads.
- **D-07:** **Plus** denormalized `created_at`, `updated_at`, `updated_by` on every mutable table, so lists can show "changed 2h ago by danlo" without a join.
- **D-08:** The mechanism that forces every write through the log (single write helper vs. database triggers) is Claude's discretion — but it must be **enforced**, not conventional; a test proves a direct write still produces an event.

**Schema tooling**
- **D-09:** **Drizzle ORM + drizzle-kit is the single migration authority.** RLS policies are declared in the schema next to their tables (`pgPolicy`, `authenticatedRole`), so the org-scoping guarantee is a compile-time artifact. The Supabase MCP `apply_migration` path and Supabase CLI SQL migrations are **not** used for schema changes in this repo (two migration systems against one database is a guaranteed drift bug).
- **D-10:** A shared `orgScoped()` table helper + a test that enumerates `information_schema` and **fails** on any table lacking `org_id` or with RLS disabled (explicit allow-list for the few global tables, e.g. `orgs` itself).
- **D-11:** Port BIS's `withRollback` / `actAs` / `actAsOwner` fixtures (plain `pg`, tool-agnostic). `actAs` claims become `{ org_id, role: 'authenticated' }` — and the test suite must also exercise the Clerk token-v2 shape `{ o: { id } }`. The DB helper reads `coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')`. One refused statement per rolled-back transaction (the next one reports `25P02`, not `42501`); pin the SQLSTATE; watch it fail first.

### Claude's Discretion
- The Places-content retention constraint: implement ARCHITECTURE.md's `retention_class` CHECK + composite-FK "durable field cites durable source" invariant as database constraints; exact shape is Claude's.
- What the unstyled shell shows after sign-in — a "signed in as X in org Y" page plus a health route is sufficient; a stubbed route skeleton (presets / queue / dashboard) is optional.
- When within the phase the Vercel project is created and linked to `dlopez2392/siteless` (deploy is success criterion 1; the team is already Pro — no purchase).
- Timezone/locale pinning mechanics in tests (one instant, two zones, opposite verdicts; spy the constructor).
- Env var names mirror BIS (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, …) — already populated in `.env.local` (gitignored); Vercel env vars set from those values, never committed.
- Auth placement per Next 16 guidance: `clerkMiddleware()` in `app/proxy.ts` for session context; authorization in layouts / route handlers / server actions — never in proxy alone.

### Deferred Ideas (OUT OF SCOPE)
- **Clerk production instance** (custom domain, no "(dev)" banner) — follow `bis-platform/docs/runbooks/clerk-setup.md` when the product name/domain is bought; not a Phase 1 concern.
- **Soft claim/lock on a lead for a second triager** — Phase 7 (Triage), per FEATURES research §M.
- **Per-org spend ledger key** `(org_id, provider, month)` — Phase 2, but the `orgs` shape decided here must support it.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **FOUND-01** | User signs in with Clerk; every request is org-scoped; every table carries `org_id` with RLS policies; v1 runs a single org | §Pattern 1 (`orgScoped()` + policy factory), §Pattern 3 (`rls()` transaction wrapper), §Pattern 5 (Clerk → active org → JIT `orgs` row), §Pitfall 2 (active-org silent failure), §Pitfall 4 (owner bypass) |
| **FOUND-02** | Every `org_id` policy is proven through a user-role connection carrying Clerk claims (v2 `o.id`), pins SQLSTATE `42501`, watched failing first | §Pattern 4 (`withRollback` / `actAs`), §Code Example 3 (executed: `42501` then `25P02`), §Pitfall 1 (**a cross-org UPDATE is filtered, not refused** — only INSERT/org-moving UPDATE raises), §Validation Architecture REQ FOUND-02 |
| **FOUND-03** | Every state change on a lead records actor and timestamp | §Pattern 6 (`SECURITY DEFINER` row trigger → `events`), §Code Example 5 (executed: a raw SQL INSERT produced an event with `actor_id`), §Pattern 7 (`touch_updated_at` for D-07) |
| **FOUND-04** | `legal_name`, `display_name`, internal annotations are separate; a test asserts the internal one never reaches an export or push payload | §Pattern 8 (payload-builder **registry + directory enumeration** sentinel harness), §Don't Hand-Roll |
| **FOUND-05** | Durable fields may only cite durable sources — a DB constraint prevents Google Places content being persisted | §Pattern 2 + §Code Example 2 (executed: `23514` on the CHECK, `23503` on the composite FK — **not** `42501`) |
| **FOUND-06** | All timestamps `timestamptz`; scheduling/windows computed in `America/Chicago`; zone and locale pinned in tests | §Pattern 9 (`timestamp({ withTimezone: true })`), §Pitfall 6 (vitest `env.TZ` does not work in the threads pool), §Code Example 6 (executed discriminating pair: same instant → `2026-09-21` UTC vs `2026-09-20` Chicago) |
</phase_requirements>

---

## Summary

This phase is 80% database and 20% scaffold, and the database part is the part that can be *silently* wrong. Three of the five success criteria are database invariants, and every one of them has a specific failure mode where the system looks correct and is not: an RLS policy that returns zero rows instead of raising; a Clerk token with no active organization so `org_id` is absent and every policy evaluates false; a connection that forgot `set local role` and therefore reads every tenant's rows because it owns the tables.

I did not take any of those on faith. I stood up a real PostgreSQL 18.3 in-process (PGlite 0.5.8) and executed the whole tenancy spine — the `retention_class` CHECK, the generated-column composite FK, the `app.jwt()` GUC helper under both Clerk claim shapes, the cross-org refusal, the second-statement `25P02`, the `revoke update, delete` on `events`, and a `SECURITY DEFINER` trigger that logged a raw SQL write. Everything in §Code Examples with an `[VERIFIED: executed …]` tag is output from that run, not recollection. Two results contradict what the phase documents currently assume, and the planner must build around them: **a cross-org `UPDATE` is silently filtered to zero rows, not refused** (only an `INSERT` carrying a foreign `org_id`, or an `UPDATE` that moves `org_id`, raises `42501`), and **the Places retention constraints refuse with `23514` / `23503`, not `42501`** — criterion 3's test must pin the check/FK codes.

Two environment facts change the plan's shape. **Docker Desktop is not installed and WSL is not installed on this machine** (verified — `docker` resolves nowhere, `wsl --status` reports "not installed"), so D-04's Supabase-CLI path is unavailable today and D-05's paid fallback is formally triggered. There is a third option that honours D-04's intent at $0 and makes dev identical to CI — a native Postgres 18 install plus a bootstrap migration that creates the `anon`/`authenticated`/`service_role` roles and the `app` schema, which CI's `postgres:18` service container needs anyway. That needs danlo's yes/no before planning. And **`proxy.ts` belongs at the project root or in `src/`, not in `app/`** — the Next 16 file-convention page is explicit ("so that it is located at the same level as `pages` or `app`"), so CONTEXT.md's "`app/proxy.ts`" and STACK.md's matching line are both wrong and would produce a build where `auth()` throws `auth_signature_invalid` on every request.

**Primary recommendation:** Build the database first and let it fail first. Order the phase as (0) scaffold + bootstrap migration, (1) tenancy spine with the RLS suite written *before* the policies, (2) retention constraints with the negative test written before the CHECK, (3) event triggers, (4) Clerk shell + JIT org, (5) Vercel deploy. Runtime DB access goes through one `rls()` transaction wrapper connecting as a **dedicated non-owner login role**, so a forgotten `set local role` fails loudly with `42501` instead of quietly returning every tenant's rows.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Session establishment, org membership, invitations | Clerk (external IdP) | — | D-02 is invite-only; Clerk owns the membership graph. Siteless stores only `clerk_org_id`. |
| Deciding *which* org a request is for | Clerk session token (`o.id`) → Next.js server | — | The claim is the only trustworthy source. The client never supplies `org_id`. |
| Tenant isolation enforcement | **Database (RLS)** | Next.js server (scoping queries) | RLS is the backstop that turns a missed scope into zero rows, not another tenant's data. Application-tier scoping is the *fast path*, never the guarantee. |
| Legal retention invariant (Places content) | **Database (CHECK + composite FK)** | — | Criterion 3 says "refused by a database constraint, not by a code review". No application tier participates. |
| Audit / attribution (`events`) | **Database (row triggers)** | Next.js server (supplies actor via claims) | D-08 requires enforcement, not convention. A trigger fires for writes the application never made. |
| Timestamp storage | Database (`timestamptz`) | — | One instant, no zone ambiguity in storage. |
| Timestamp *rendering* in `America/Chicago` | Next.js server + client (explicit IANA zone per call site) | — | Never the session/process zone. See Pitfall 6. |
| Internal-annotation containment | Next.js server (export/push builders) | TypeScript types | There is no DB mechanism for "must not appear in an outbound payload"; the guarantee is a registry + enumeration test. |
| JIT `orgs` provisioning | Database (`SECURITY DEFINER` function) | Next.js server (calls it) | The function validates the passed org against the caller's claim, so `authenticated` never needs blanket INSERT on `orgs`. |
| Schema migration | drizzle-kit (single authority, D-09) | — | Supabase CLI / MCP `apply_migration` are explicitly excluded. |
| Deployment + env | Vercel project linked to `dlopez2392/siteless` | — | |

**The line that matters:** Supabase's Clerk third-party-auth registration governs the **Data API** (PostgREST / Storage / Realtime), not direct Postgres connections. Because D-09 puts Drizzle over postgres.js on a pooler URL, the runtime authenticates to Postgres with a **database password** and manufactures the claims itself from Clerk's server-verified `auth()`. The third-party-auth registration is already done and stays available for any future supabase-js surface, but it is **not** on the Phase 1 critical path. Do not plan a task around it.

---

## Standard Stack

All versions below were queried from the npm registry on **2026-09-20** and match `.planning/research/STACK.md` unless noted.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.3.5` | App framework | Current stable. Proxy defaults to the **Node.js runtime** in v16. [VERIFIED: npm registry, modified 2026-09-19] |
| `react` / `react-dom` | `19.3.0` | UI | Satisfies Clerk 7.9.4's peer `~19.3.0-0`. [VERIFIED: unpacked peerDependencies] |
| `typescript` | **`6.0.3` — NOT 7.0.2** | Types | `typescript-eslint@8` peer is `>=4.8.4 <6.1.0`. npm `latest` is **7.0.2** as of today — an unpinned `typescript@latest` breaks the lint pipeline. [VERIFIED: npm registry] |
| `@clerk/nextjs` | `7.9.4` | Auth + organizations | Peers: `next ^16.1.0-0`, `react ~19.3.0-0`. [VERIFIED: unpacked package.json] |
| `drizzle-orm` | `0.45.2` | Schema, types, RLS policies | `drizzle-orm/supabase` exports `anonRole`, `authenticatedRole`, `serviceRole`, `postgresRole`, `supabaseAuthAdminRole`, `authUsers`. [VERIFIED: unpacked `supabase/rls.d.ts`] |
| `drizzle-kit` | `0.31.10` | Migration authority (D-09) | `generate`, `migrate`, `generate --custom`. [VERIFIED: npm registry] |
| `postgres` (postgres.js) | `3.4.9` | Runtime driver | Transaction-pooler URL **with `prepare: false`**. |
| `pg` | `8.23.0` | Test-fixture driver | BIS's `withRollback`/`actAs` are plain `pg` (D-11) — keep them tool-agnostic. `@types/pg@8.23.1`. |
| `@supabase/supabase-js` | `2.116.0` | *Optional* — auth/session plumbing only | **Not required for Phase 1.** Add only if a PostgREST/Storage surface appears. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `4.6.5` | Env-var parsing at boot | One `src/env.ts` that parses `process.env` and throws at startup. Cheapest possible fix for "the deploy is green and `SUPABASE_DB_URL` is missing". |
| `dotenv` | `18.0.1` | `.env.local` into the test process | BIS's `withRollback` does `import "dotenv/config"`. |
| `date-fns` + `@date-fns/tz` | `4.4.0` / `1.5.0` | Explicit-zone formatting | Every call site names the zone. |
| `pino` | `10.3.1` | Structured logs | Optional in Phase 1; cheap to add now. |

### Development

| Tool | Version | Notes |
|------|---------|-------|
| `vitest` | `5.0.1` | Requires `vite ^8` (`8.3.0`) and `@types/node >=24`. |
| `@playwright/test` | `1.63.0` | One E2E spec in this phase (criterion 1). |
| `typescript-eslint` + `eslint` | `8.70.0` / `10.11.0` | Constrains TypeScript `<6.1.0`. |
| `prettier` | `3.9.8` | |
| `tsx` | `4.23.15` | Seed/bootstrap scripts. |
| `pnpm` | `12.5.1` | ⚠️ **Locally installed pnpm is `11.9.0`.** Do not upgrade globally — put `"packageManager": "pnpm@12.5.1"` in `package.json` and pnpm ≥9.7 self-switches. [VERIFIED: `pnpm --version` → 11.9.0] |
| `@electric-sql/pglite` | `0.5.8` | **Optional, recommended.** Real Postgres 18.3 in-process, zero install — ideal for constraint/DDL unit tests that need no extensions. Not a full substitute (see Alternatives). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Drizzle `rls()` wrapper over postgres.js | `supabase-js` + `accessToken` (PostgREST) | PostgREST verifies the Clerk JWT natively (already registered). But it cannot express Phase 3's trigram / `ST_DWithin` / `FOR UPDATE` SQL, and D-09 already makes Drizzle the schema authority. **Rejected for the primary path**; keep as the fallback if pooler access ever fails. |
| Native Postgres 18 for the test DB | Docker Desktop + `supabase start` (D-04 as written) | Requires installing WSL2 + Docker Desktop (~4 GB, reboot). Gives the full Supabase stack. |
| Native Postgres 18 | PGlite in-process | $0, no install, runs in CI unchanged, and I already proved the whole Phase 1 DDL runs on it. **But**: single connection (BIS's per-test `pg.Client` needs `@electric-sql/pglite-socket@0.2.11`), and `pg_trgm` / `unaccent` / `fuzzystrmatch` / `postgis` are **not** in the default bundle — Phase 3 dedupe cannot run on it. [VERIFIED: executed — all six `create extension` calls returned "extension is not available"] |
| Native Postgres 18 | Second Supabase project `siteless-dev` (D-05 fallback) | ~$10/mo, needs network for every test run, and reintroduces a cloud dependency in the inner loop. |
| Row triggers for `events` | A single TypeScript write helper | A helper is convention — D-08 demands enforcement and a test proving a *direct* write still logs. |

**Installation (Phase 1 only):**

```bash
pnpm add next@16.3.5 react@19.3.0 react-dom@19.3.0 @clerk/nextjs@7.9.4 \
  drizzle-orm@0.45.2 postgres@3.4.9 zod@4.6.5 date-fns@4.4.0 @date-fns/tz@1.5.0

pnpm add -D typescript@6.0.3 @types/node@26.6.2 @types/react@19 @types/react-dom@19 \
  drizzle-kit@0.31.10 pg@8.23.0 @types/pg@8.23.1 dotenv@18.0.1 tsx@4.23.15 \
  vitest@5.0.1 vite@8.3.0 @playwright/test@1.63.0 \
  eslint@10.11.0 typescript-eslint@8.70.0 prettier@3.9.8
```

---

## Architecture Patterns

### System Architecture Diagram

```
  Browser (unstyled shell)
      │  cookie: __session (Clerk JWT, v2 claims)
      ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Vercel — Next.js 16 App Router (Node runtime)                        │
 │                                                                      │
 │  src/proxy.ts  ── clerkMiddleware()  ── session context ONLY         │
 │         │          (no authorization decisions here — CVE-2025-29927)│
 │         ▼                                                            │
 │  layout / page / route handler / server action                       │
 │         │                                                            │
 │         ├── await auth()  ──► { userId, orgId, orgSlug, getToken }   │
 │         │        │                                                   │
 │         │        ├─ orgId == null ──────────────► redirect /no-access│
 │         │        │                                 (+ client-side    │
 │         │        │                                  ActivateSole-    │
 │         │        │                                  Organization)    │
 │         │        ▼                                                   │
 │         └── withOrg(async (tx) => …)      ← the ONLY db entry point  │
 │                   │                                                  │
 └───────────────────┼──────────────────────────────────────────────────┘
                     │  postgres.js, transaction pooler :6543, prepare:false
                     │  connects as app_user  (NOINHERIT, owns nothing)
                     ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ BEGIN                                                                │
 │   select set_config('request.jwt.claims', $1, true)   ← bound param  │
 │   set local role authenticated                        ← allow-listed │
 │   … queries …                                                        │
 │ COMMIT   (set local + set_config(..., true) both die with the tx)    │
 └───────────────────┬──────────────────────────────────────────────────┘
                     ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Supabase Postgres  (project: siteless / jahgeqshuesndyscnmjo)        │
 │                                                                      │
 │  app.jwt()             reads request.jwt.claims GUC                  │
 │  app.current_org_id()  coalesce(jwt->'o'->>'id', jwt->>'org_id')     │
 │         │              SECURITY DEFINER, search_path = public        │
 │         ▼                                                            │
 │  RLS policies on every org-scoped table:                             │
 │      using (org_id = (select app.current_org_id()))                  │
 │                                                                      │
 │  source_records ──(id, retention_class)──┐  composite FK             │
 │    CHECK google_places ⇒ ephemeral       │                           │
 │    CHECK ephemeral ⇔ expires_at NOT NULL │                           │
 │  businesses ─ *_source_id + generated ───┘  "durable cites durable"  │
 │    legal_name | display_name | internal_notes                        │
 │                                                                      │
 │  AFTER INSERT/UPDATE/DELETE row trigger  ──► events (append-only:    │
 │    app.log_event() SECURITY DEFINER            UPDATE/DELETE revoked)│
 └──────────────────────────────────────────────────────────────────────┘
                     ▲
                     │  drizzle-kit migrate  (session pooler :5432, role postgres = owner)
                     │
              drizzle/0000_bootstrap.sql … 000N_*.sql   ← single authority (D-09)
```

### Recommended Project Structure

```
siteless/
├── .github/workflows/ci.yml       # verify (typecheck/lint/unit) + db (postgres service) + e2e
├── drizzle/                       # generated SQL — committed, never hand-edited except --custom
│   ├── 0000_bootstrap.sql         #   --custom: roles, app schema, app.jwt(), grants
│   ├── 0001_tenancy.sql           #   generated: orgs/users/memberships/events + policies
│   ├── 0002_retention.sql         #   generated: source_records/businesses + constraints
│   └── 0003_event_triggers.sql    #   --custom: app.log_event(), app.touch_updated_at(), attach
├── drizzle.config.ts              # entities.roles.provider = 'supabase'
├── proxy.ts                       # ⚠ ROOT or src/ — NEVER app/. clerkMiddleware()
├── src/
│   ├── app/
│   │   ├── layout.tsx             # <ClerkProvider> + <ActivateSoleOrganization/>
│   │   ├── page.tsx               # "signed in as X in org Y" (unstyled)
│   │   ├── no-access/page.tsx     # D-02 landing for zero-membership users
│   │   └── api/health/route.ts    # dynamic; { ok, commit, db: 'up' }
│   ├── db/
│   │   ├── schema/
│   │   │   ├── _helpers.ts        # orgScopedColumns, orgPolicies(), currentOrgId
│   │   │   ├── orgs.ts  users.ts  memberships.ts  events.ts
│   │   │   ├── source-records.ts  businesses.ts
│   │   │   └── index.ts           # re-export — the audit test reads this
│   │   ├── client.ts              # import 'server-only'; postgres.js pool
│   │   └── with-org.ts            # import 'server-only'; THE rls() wrapper
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── sole-organization.ts   # ported from BIS, pure + unit-tested
│   │   │   └── require-org.ts         # server guard → orgId or redirect('/no-access')
│   │   ├── export/
│   │   │   ├── registry.ts        # PAYLOAD_BUILDERS — every outbound builder registers here
│   │   │   └── public-business.ts # the type that omits internal fields
│   │   └── time.ts                # APP_TZ = 'America/Chicago'; explicit-zone formatters
│   └── components/activate-sole-organization.tsx   # "use client", ported from BIS
├── tests/
│   ├── db/                        # pg + withRollback — the RLS/grant/constraint suite
│   │   ├── _fixtures.ts           # withRollback, actAs, actAsOwner, seedTwoOrgs
│   │   ├── rls-isolation.test.ts        # FOUND-01/02
│   │   ├── schema-audit.test.ts         # D-10 enumeration
│   │   ├── retention.test.ts            # FOUND-05
│   │   ├── events-append-only.test.ts   # FOUND-03/D-06
│   │   └── event-trigger.test.ts        # D-08 "a direct write still logs"
│   ├── unit/                      # sole-organization, time, export sentinel
│   └── e2e/                       # Playwright: sign in → org-scoped page
└── vitest.config.ts               # process.env.TZ pinned at the TOP of the file
```

---

### Pattern 1 — `orgScoped()`: columns + policy factory (D-01, D-07, D-10)

Drizzle 0.45.2 has no "table helper" primitive; the idiom is a spread-able column object plus a policy factory returned from the table's extra-config callback. Adding *any* policy auto-enables RLS — `.enableRLS()` is only needed for a table you want default-deny with no policies. [CITED: orm.drizzle.team/docs/pg/rls — "If you add a policy to a table, RLS will be enabled automatically"]

```ts
// src/db/schema/_helpers.ts
import { sql } from 'drizzle-orm';
import { pgPolicy, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { orgs } from './orgs';

/** D-01 + D-07. Spread into every org-scoped table. */
export const orgScoped = {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
};

/**
 * Wrapped in `(select …)` so Postgres runs it as an InitPlan once per
 * statement instead of once per row.
 */
const CURRENT_ORG = sql`(select app.current_org_id())`;

export function orgPolicies(t: string) {
  return [
    pgPolicy(`${t}_select`, { for: 'select', to: authenticatedRole, using: sql`org_id = ${CURRENT_ORG}` }),
    pgPolicy(`${t}_insert`, { for: 'insert', to: authenticatedRole, withCheck: sql`org_id = ${CURRENT_ORG}` }),
    pgPolicy(`${t}_update`, { for: 'update', to: authenticatedRole,
                              using: sql`org_id = ${CURRENT_ORG}`, withCheck: sql`org_id = ${CURRENT_ORG}` }),
    pgPolicy(`${t}_delete`, { for: 'delete', to: authenticatedRole, using: sql`org_id = ${CURRENT_ORG}` }),
  ];
}
```

```ts
// src/db/schema/businesses.ts  (usage)
export const businesses = pgTable('businesses', {
  ...orgScoped,
  legalName: text('legal_name'),
  displayName: text('display_name'),
  internalNotes: text('internal_notes'),
  // …
}, (t) => [
  index('businesses_org_idx').on(t.orgId),      // Pitfall 5: RLS predicates get no index for free
  ...orgPolicies('businesses'),
]);
```

`drizzle.config.ts` must exclude Supabase's own roles or `drizzle-kit` will try to drop them:

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.SUPABASE_DB_URL! },  // SESSION pooler, not transaction
  entities: { roles: { provider: 'supabase' } },
  breakpoints: true,
  verbose: true, strict: true,
});
```
[CITED: orm.drizzle.team/docs/drizzle-config-file — `entities.roles.provider: 'supabase'`]

---

### Pattern 2 — The retention invariant as two database constraints (FOUND-05)

```sql
create table source_records (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  source_key      text not null check (source_key in
                    ('overture','tx_comptroller','osm','google_places',
                     'firecrawl','http_probe','dns_probe','manual')),
  external_id     text,
  payload         jsonb,
  retention_class text not null check (retention_class in ('durable','ephemeral')),
  fetched_at      timestamptz not null default now(),
  expires_at      timestamptz,

  constraint sr_ephemeral_has_expiry
    check ((retention_class = 'ephemeral') = (expires_at is not null)),
  constraint sr_google_is_ephemeral
    check (source_key <> 'google_places' or retention_class = 'ephemeral'),
  constraint sr_durable_uniq unique (id, retention_class)   -- the FK target
);
```

```sql
alter table businesses
  add column phone_source_id uuid,
  add column phone_src_ret   text generated always as ('durable') stored,
  add constraint businesses_phone_src_fk
    foreign key (phone_source_id, phone_src_ret)
    references source_records (id, retention_class);
```

One `*_source_id` + `*_src_ret` pair per durable field (`legal_name`, `display_name`, `phone_e164`, `addr_line`, `location`). A field whose only source is a Google payload **cannot be set** — the FK has nothing to point at, so the column stays NULL and the UI says "not stored".

Expressing this in Drizzle 0.45.2:
- `generatedAlwaysAs(sql\`'durable'\`)` — `generatedAlwaysAs` exists on the column builder. [VERIFIED: unpacked `pg-core/columns/common.d.ts:49`]
- `check(name, sql)` and composite `foreignKey({ columns, foreignColumns })` both exist. [VERIFIED: unpacked `pg-core/checks.d.ts`, `pg-core/foreign-keys.d.ts`]
- If a generated column in an FK trips drizzle-kit's differ, emit these two constraints from `drizzle-kit generate --custom` and keep the plain columns in the TS schema. The invariant lives in the migration either way.

**TTL:** ARCHITECTURE.md's 21-day (not 30) purge window for `expires_at` is a Phase 4 job, but `expires_at` and the partial index `on source_records (expires_at) where expires_at is not null` ship now.

---

### Pattern 3 — `withOrg()`: the one runtime database entry point

The Drizzle docs' Supabase recipe is directionally right and **must not be copied verbatim** — it interpolates the JSON claims with `sql.raw(JSON.stringify(token))`, which breaks (or injects) the moment any claim value contains a single quote. Bind the claims; allow-list the role.

```ts
// src/db/with-org.ts
import 'server-only';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Transaction pooler → prepare:false is mandatory.
const client = postgres(process.env.SUPABASE_DB_POOL_URL!, { prepare: false, max: 1 });
const db = drizzle({ client, schema });

const ROLES = new Set(['authenticated', 'anon']);   // never interpolate an unvalidated role

export type OrgClaims = { o: { id: string }; sub: string; role: 'authenticated' };

export async function withOrg<T>(claims: OrgClaims, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  if (!ROLES.has(claims.role)) throw new Error(`withOrg: refusing role ${claims.role}`);
  return db.transaction(async (tx) => {
    // `true` = set_config is LOCAL: it dies with the transaction. Non-local leaks
    // across a pooled connection to the next tenant. (Verified, §Pitfall 4.)
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
    await tx.execute(sql.raw(`set local role ${claims.role}`));   // safe: allow-listed above
    return fn(tx);
  });
}
```

Build the claims from Clerk's server-verified `auth()` — never from a token the client handed you:

```ts
// src/lib/auth/require-org.ts
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export async function requireOrg() {
  const { userId, orgId } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/no-access');                    // D-02, and Pitfall 2
  return { userId, orgId };
}

export async function orgClaims(): Promise<OrgClaims> {
  const { userId, orgId } = await requireOrg();
  return { o: { id: orgId }, sub: userId, role: 'authenticated' };
}
```

**Connect as a dedicated non-owner role.** `drizzle-kit migrate` runs as `postgres`, which *owns* the tables — and a table owner bypasses RLS. If the runtime also connects as `postgres`, a code path that forgets `withOrg` reads every tenant's rows and nothing complains. Create a login role instead:

```sql
-- drizzle/0000_bootstrap.sql  (--custom)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login noinherit;
  end if;
end $$;
grant authenticated to app_user;
grant usage on schema public, app to app_user;
```

`SUPABASE_DB_POOL_URL` then uses `app_user.jahgeqshuesndyscnmjo` as the username — the shared pooler accepts custom roles in `[ROLE].[PROJECT-REF]` form. [CITED: supabase.com/docs/guides/troubleshooting/tenant-or-user-not-found — "If you connect as a custom role through the shared pooler, the username is [ROLE].[PROJECT-REF]"] A forgotten `set local role` then raises `42501 permission denied for table …` [VERIFIED: executed].

---

### Pattern 4 — `withRollback` / `actAs`, ported and upgraded (D-11)

```ts
// tests/db/_fixtures.ts
import { Client } from 'pg';
import 'dotenv/config';

export async function withRollback(fn: (c: Client) => Promise<void>) {
  const c = new Client({
    connectionString: process.env.TEST_DATABASE_URL,   // NEVER the production URL
    connectionTimeoutMillis: 10_000,                   // BIS's lesson: fail in 10s, not at vitest's 60s ceiling
  });
  await c.connect();
  try { await c.query('begin'); await fn(c); }
  finally { await c.query('rollback'); await c.end(); }
}

/** Clerk token v1 (flat) and v2 (nested `o`) — the suite must exercise BOTH. */
export type Claims =
  | { org_id: string; sub?: string; role?: 'authenticated' }
  | { o: { id: string; rol?: string; slg?: string }; sub?: string; role?: 'authenticated' };

export async function actAs(c: Client, claims: Claims) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query('set local role authenticated');
}

export async function actAsOwner(c: Client) { await c.query('reset role'); }

export async function seedTwoOrgs(c: Client) {
  const { rows: [a] } = await c.query(
    "insert into orgs (clerk_org_id, name_internal, display_name) values ('org_A','Alpha (test)','Alpha') returning id");
  const { rows: [b] } = await c.query(
    "insert into orgs (clerk_org_id, name_internal, display_name) values ('org_B','Bravo (test)','Bravo') returning id");
  return { a: a.id as string, b: b.id as string };
}
```

Three upgrades over BIS's version, each earned:
1. `TEST_DATABASE_URL`, not `SUPABASE_DB_URL` — a separate name makes "the suite pointed at production" a typo you can *see*, and D-04 forbids it structurally.
2. The `Claims` union forces every test author to pick a shape; the v2 shape is the one production will actually send.
3. `seedTwoOrgs` exists so no test can prove isolation against a single tenant (Pitfall 13 in PITFALLS.md: "with one org, every RLS bug is invisible").

---

### Pattern 5 — Clerk shell: proxy, active organization, JIT `orgs` row

**`proxy.ts` location.** Project root, or `src/` if you use a src dir — *at the same level as `app`*, never inside it. [CITED: nextjs.org/docs/app/api-reference/file-conventions/proxy — "Create a `proxy.ts` (or `.js`) file in the project root, or inside `src` if applicable, so that it is located at the same level as `pages` or `app`"] Proxy defaults to the **Node.js runtime** in v16 and setting `runtime` in a proxy file throws.

```ts
// src/proxy.ts   (NOT src/app/proxy.ts)
import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
```

**No authorization in proxy.** `createRouteMatcher` is marked `@deprecated` in 7.9.4 itself: *"Use resource-based auth checks instead. Move auth checks into each page, layout, API route, or Server Function that accesses protected data."* [VERIFIED: unpacked `server/routeMatcher.d.ts`] Next's own docs add that Server Functions are POSTs to the page's route, so a matcher refactor can silently remove proxy coverage — authorize inside each function.

**Active organization.** `orgId` is `null` until an organization is *activated on the session*. BIS shipped this bug on 2026-09-16 and its fix is directly portable — `apps/web/src/lib/auth/sole-organization.ts` (a pure function: activate only when signed in, no active org, and exactly one membership) plus `components/activate-sole-organization.tsx` (a render-nothing client component mounted in the root layout). Port both verbatim; the pure function is unit-testable with no Clerk dependency.

Belt and braces, in this order:
1. Dashboard: confirm **Organizations → Membership required** is on (it is the default for instances created after 2025-08-22) and "users can create organizations" is **off** (D-02).
2. `ActivateSoleOrganization` in the root layout, for the case where the task flow leaves the session unactivated.
3. `requireOrg()` server-side → `/no-access` when `orgId` is still null. This is the one that must never be skipped.

**JIT `orgs` provisioning (D-03)** as a `SECURITY DEFINER` function, so `authenticated` never gets blanket INSERT on `orgs` and the org it provisions is *proved* to be its own:

```sql
create or replace function app.ensure_org(p_clerk_org_id text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_claim text;
begin
  v_claim := coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id');
  if p_clerk_org_id is distinct from v_claim then
    raise exception 'ensure_org: org does not match the caller claim'
      using errcode = '42501';
  end if;
  insert into orgs (clerk_org_id, name_internal, display_name)
       values (p_clerk_org_id, p_display_name, p_display_name)
  on conflict (clerk_org_id) do update set clerk_org_id = excluded.clerk_org_id
  returning id into v_id;
  return v_id;
end $$;
grant execute on function app.ensure_org(text, text) to authenticated;
```
Test it both ways: the caller's own org is created idempotently; a caller asking for someone else's org gets `42501`.

---

### Pattern 6 — `events` enforced by trigger, not by convention (D-06, D-08) — **recommended**

```sql
create or replace function app.log_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := coalesce(new.org_id, old.org_id);
  insert into events (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (
    v_org,
    coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system'),
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;
```

Attach it per table from a loop in the migration, and make coverage a test rather than a memory:

```sql
do $$ declare t text;
begin
  foreach t in array array['businesses','source_records'] loop
    execute format(
      'create trigger %I_event after insert or update or delete on %I
         for each row execute function app.log_event()', t, t);
  end loop;
end $$;
```

Why triggers beat a write helper here: D-08's acceptance test is literally *"a direct write still produces an event"*. A helper cannot pass that test; a trigger does, and I ran it — a raw `insert into leads …` issued as `authenticated` produced `{ actor_id: 'user_danlo', entity_type: 'leads', action: 'insert', after.title: 'direct-write' }` [VERIFIED: executed].

Three design notes the planner must carry:
- **`SECURITY DEFINER` is required** so the trigger can insert into `events` regardless of the caller's grants, and `set search_path = public` is required with it (a `SECURITY DEFINER` function without a pinned search_path is a privilege-escalation vector — ASVS V4).
- **Actor fallback chain**: Clerk `sub` → `app.actor_id` GUC (set by workers/ETL) → `'system'`. `current_setting(..., true)` returns NULL rather than erroring on an unset GUC [VERIFIED: executed].
- **Scope the triggers deliberately.** Phase 3 ingests ~10k Comptroller/Overture rows; a row trigger there writes 10k event rows with full `before`/`after` payloads. Attach row triggers to *decision/state* tables (`businesses`, `leads` in Phase 7, `source_records` while volume is low) and let bulk ingest write one run-level event. Record this boundary in CONVENTIONS.md so Phase 3 does not have to re-derive it.

`events` immutability is grants, not policy (D-06):
```sql
grant select, insert on events to authenticated;
revoke update, delete on events from authenticated;
```
An `update events …` as `authenticated` then fails `42501 permission denied for table events` — **and note the message differs from the RLS refusal**, so the test should assert both code and message. [VERIFIED: executed]

---

### Pattern 7 — `updated_at` / `updated_by` by trigger (D-07)

```sql
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system');
  return new;
end $$;
-- before update on every table carrying orgScoped columns
```
Test: an `UPDATE` that sets *only* a domain column still moves `updated_at` and stamps `updated_by`. Without this, D-07's denormalized columns are a lie the first time someone writes SQL by hand.

---

### Pattern 8 — The internal-annotation sentinel harness (FOUND-04)

No export or push builder exists yet, so the deliverable is the *harness the later phases extend* — and it only works if adding a builder without registering it **fails**. Two halves:

```ts
// src/lib/export/registry.ts
export type PayloadBuilder = { name: string; build: (b: BusinessFixture) => unknown };

/** Every outbound payload builder — CSV export, BIS push, webhook — registers here. */
export const PAYLOAD_BUILDERS: PayloadBuilder[] = [
  // Phase 8 adds: { name: 'bis-contact-push', build: buildBisContact },
  // Phase 8 adds: { name: 'csv-export-row',   build: buildCsvRow },
];
```

```ts
// tests/unit/no-internal-leak.test.ts
import { readdirSync } from 'node:fs';
import { PAYLOAD_BUILDERS } from '@/lib/export/registry';

const CANARY = 'INTERNAL-CANARY-7f3a2b';

it('no registered payload builder emits an internal annotation', () => {
  const fixture = makeBusiness({
    legalName: 'RIO ROOFING LLC',
    displayName: 'Rio Roofing',
    internalNotes: `${CANARY} owner is hostile, do not call before 10am`,
  });
  for (const b of PAYLOAD_BUILDERS) {
    expect(JSON.stringify(b.build(fixture)), b.name).not.toContain(CANARY);
  }
});

// The half that makes it non-optional: a new file in the directory that nobody
// registered fails here, so "I forgot the sentinel" is not reachable.
it('every module under src/lib/export is represented in the registry', () => {
  const modules = readdirSync('src/lib/export')
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_') && f !== 'registry.ts' && f !== 'public-business.ts');
  const registered = new Set(PAYLOAD_BUILDERS.map((b) => `${b.name}.ts`));
  expect(modules.filter((m) => !registered.has(m))).toEqual([]);
});
```

Reinforce it at the type level: builders accept `PublicBusiness = Omit<Business, 'internalNotes' | 'nameInternal'>`, so a leak has to be *deliberate*. Keep the runtime sentinel anyway — a `JSON.stringify(row)` of a wider object typechecks fine.

Naming, reconciled across the three source documents: `businesses.legal_name` (Comptroller DBA, often mistyped) · `businesses.display_name` (what the card shows) · `businesses.internal_notes` (operator annotation). At the org level ARCHITECTURE.md's convention holds: `orgs.name_internal` is the operator's label, `orgs.display_name` is the only one a human outside could see. **BIS leaked `accounts.name` to customers three times** — the split is worth the extra column.

---

### Pattern 9 — `timestamptz` in Drizzle, and zone handling

```ts
createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
```
[VERIFIED: unpacked `pg-core/columns/timestamp.d.ts` — `PgTimestampConfig` has `mode`, `precision`, `withTimezone`]

`mode: 'date'` returns a JS `Date` (one instant, no zone) — correct. `mode: 'string'` hands back a formatted string whose zone depends on the session, which is how "it looked right locally" happens.

Day buckets are **always** explicit:
```sql
(created_at at time zone 'America/Chicago')::date
```
One exported constant `APP_TZ = 'America/Chicago'` in `src/lib/time.ts`; every `Intl.DateTimeFormat` call passes `{ timeZone: APP_TZ, ... }` and an explicit locale.

---

### Anti-Patterns to Avoid

- **Auth decisions in `proxy.ts`.** Next renamed middleware partly in response to CVE-2025-29927; Clerk deprecated `createRouteMatcher` for the same reason. Proxy establishes session context; layouts/handlers/actions authorize.
- **`supabase-js` service-role client anywhere near a user-facing path.** If `SUPABASE_SERVICE_ROLE_KEY` is ever added, it belongs in exactly one file with `import 'server-only'` and a CI grep that fails on a second occurrence.
- **Testing RLS through a service-role or owner connection.** The recorded BIS lesson: service-role fixtures are blind to grants. I reproduced the owner half — connected as the table owner without `set local role`, a `select` returned **both** orgs' rows [VERIFIED: executed].
- **`sql.raw(JSON.stringify(claims))`** (the shape the Drizzle docs publish). Bind the parameter.
- **A non-local `set_config`/`SET`** on a pooled connection. `set_config(..., false)` persists past commit and the next request on that connection inherits the previous tenant's claims [VERIFIED: executed].
- **`timestamp` without `withTimezone`.** No exceptions (PROJECT.md constraint).
- **Two migration systems.** drizzle-kit only (D-09). No `supabase db push`, no MCP `apply_migration` for schema.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant isolation | `WHERE org_id = ?` discipline in every query | Postgres RLS policies + a non-owner runtime role | One missed `WHERE` is a cross-tenant read. The policy is a property of the table, not of the caller's memory. |
| "Which org is this request for?" | A header, a query param, a cookie you set | The Clerk session-token claim via `auth()` | Anything the client can set, the client can change. |
| Places retention compliance | A code-review checklist / a lint rule | `CHECK` + composite `FOREIGN KEY` | Criterion 3 is literally "refused by a database constraint, not by a code review". |
| Attribution | Remembering to call `emit()` at every write site | `AFTER … FOR EACH ROW` trigger | BIS had **five byte-identical copies** of `emit()` and a fix reached only one of them. |
| JWT parsing in SQL | Custom `split_part` / regex on the token | `current_setting('request.jwt.claims', true)::jsonb` + `app.jwt()` | Works identically on Supabase and bare-pg, which is exactly what makes the test suite portable. |
| Org activation logic | An ad-hoc `useEffect` in one page | Port BIS's `soleOrganizationToActivate` + `ActivateSoleOrganization` | Already debugged against a real incident; the decision function is pure and unit-testable. |
| Timezone conversion | `new Date(x).toLocaleString()` with no zone | `at time zone 'America/Chicago'` in SQL, explicit `timeZone` in `Intl` | `Intl` formats in the *system* zone; `Date.UTC` anchors UTC midnight. Americas render the previous day. |
| Test transaction isolation | Truncate-between-tests | `begin` / `rollback` (`withRollback`) | Parallel-safe, leaves no fixture rows behind when a run is killed. BIS still sweeps orphan `Fixture Co` rows because a helper without rollback lost that property. |
| Schema drift detection | Reading migrations by eye | The `pg_class` / `pg_policy` enumeration test (D-10) | A table added in Phase 5 without `org_id` fails a Phase 1 test. That is the whole point. |

**Key insight:** in this phase every hand-rolled alternative fails *silently and in the safe-looking direction* — zero rows, a missing event, an un-refused insert. The database-enforced version fails loudly with a SQLSTATE you can pin in a test. Choose the loud one every time.

---

## Common Pitfalls

### Pitfall 1 — "Refused" is only true for some statements (CRITICAL — changes criterion 2's test)

**What goes wrong:** Criterion 2 says *"A statement issued by a second seeded org against danlo's rows is refused."* Under RLS, most such statements are not refused — they are filtered.

| Statement by org B against org A's rows | Result | SQLSTATE |
|---|---|---|
| `select * from leads` | org B's rows only | — (no error) |
| `update leads set title=… where <A's row>` | **0 rows affected** | — (no error) [VERIFIED: executed] |
| `delete from leads where <A's row>` | 0 rows affected | — (no error) |
| `insert into leads (org_id, …) values ('<A's org>', …)` | **refused** | **`42501`** — "new row violates row-level security policy" [VERIFIED: executed] |
| `update leads set org_id = '<A's org>' where <B's row>` | refused | `42501` (WITH CHECK) |
| Any statement on `events` needing UPDATE/DELETE | refused | `42501` — "permission denied for table events" (a *grant* refusal, different message) [VERIFIED: executed] |

**How to avoid:** criterion 2's refused statement is the **INSERT carrying a foreign `org_id`**. Assert the zero-row cases separately and explicitly — `expect(rows).toHaveLength(0)` *is* the isolation proof for reads; `expect(res.rowCount).toBe(0)` for the cross-org update. Pin `code: '42501'` **and** match the message, since `42501` covers both "RLS policy" and "permission denied for table".

### Pitfall 2 — No active organization: zero rows, no error (CRITICAL)

**What goes wrong:** Clerk keeps the active organization on the **session**, not the user. A user who accepted a valid invitation and signed in can have no active org; the token then carries no `o.id`, `app.current_org_id()` returns NULL, every policy evaluates false, and the app shows an empty, error-free product. ARCHITECTURE.md calls the claim-path version of this "the single highest-probability silent failure in the whole build"; BIS shipped the activation version of it on 2026-09-16.

**How to avoid:** the three-layer defence in Pattern 5. And a `requireOrg()` server guard that treats `orgId === null` as a *routing* decision, so it can never render a page that queries with a null org.

**Related:** Clerk's session-task flow can leave a session **pending**, and `auth()` treats a pending session as signed-out by default (`treatPendingAsSignedOut` exists in `@clerk/backend` [VERIFIED: unpacked `tokens/authObjects.d.ts:176`]). If sign-in "works" but `userId` is null in a server component, this is the first thing to check.

**Warning signs:** an empty list with a 200; `auth()` returning `orgId: null` for a user you can see in the Clerk dashboard as a member; a test suite that calls `setActive()` by hand (that is the workaround living in the test instead of the app — exactly how BIS's suite stayed green while the product was broken).

### Pitfall 3 — The BIS helper copied verbatim returns NULL under Clerk v2

**What goes wrong:** BIS's `app.current_account_id()` reads `app.jwt()->>'org_id'`. Clerk session-token v2 nests org claims under `o` (`{"o":{"id":"org_…","rol":"admin","slg":"…"}}`) and the `o` claim is only present when an organization is **active**. Copying the helper yields NULL → zero rows, no error.

**How to avoid:** `coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')` — verified working against both shapes [VERIFIED: executed]. danlo's instance also has the custom claim `{"org_id":"{{org.id}}","role":"authenticated"}`, so both paths are live today; the coalesce means neither one being removed breaks the app. Test both shapes explicitly (D-11).

### Pitfall 4 — The table owner bypasses RLS, and a pooled `SET` leaks

**What goes wrong:** two separate ways the isolation quietly evaporates.
1. `drizzle-kit migrate` runs as `postgres`, which owns the tables. A table owner bypasses RLS. If the runtime also connects as `postgres` and any path skips `set local role`, it reads every tenant's rows — I reproduced exactly that [VERIFIED: executed].
2. `set_config('request.jwt.claims', …, false)` or a bare `SET ROLE` **survives the transaction**, and on a transaction-mode pooler the connection is handed to the next request with the previous tenant's claims still set [VERIFIED: executed].

**How to avoid:** a dedicated `app_user` login role for the runtime (Pattern 3) and `set local` / `set_config(…, true)` everywhere, never the non-local form. Add a test asserting that a connection which *skips* the wrapper gets `42501`.

**Note on `FORCE ROW LEVEL SECURITY`:** my probe ran as a superuser, where FORCE has no effect, so my measurement of it is **inconclusive**. Supabase's `postgres` is not a superuser, so FORCE *would* bind it there — but it would also block `drizzle-kit` seeds. The non-owner role is the mechanism to rely on; treat FORCE as optional hardening to evaluate against the real project.

### Pitfall 5 — RLS performance and the missing index

**What goes wrong:** `app.current_org_id()` unwrapped is re-evaluated **per row**; and an RLS predicate on `org_id` does not get an index for free.

**How to avoid:** `using (org_id = (select app.current_org_id()))` — the `(select …)` promotes it to an InitPlan cached per statement — and `index('<table>_org_idx').on(t.orgId)` on every org-scoped table, leading with `org_id` on every composite.

### Pitfall 6 — `test.env.TZ` does not pin the timezone (CRITICAL for FOUND-06)

**What goes wrong:** setting `TZ` via vitest's `test.env` does **not** change the zone in the `threads`/`vmThreads` pools — Node worker threads lock `Intl`'s zone at thread creation. The tests then run in the dev machine's zone (which, on this machine, *is* `America/Chicago`) and cannot discriminate: code that forgot to pass a zone looks correct locally and is wrong in CI. [CITED: vitest.dev/config/env] On Windows, `TZ=x pnpm test` also does nothing in PowerShell.

**How to avoid (recommended, and this is Claude's discretion per CONTEXT.md):**
1. Set the zone in the **main process before workers spawn** — line 1 of `vitest.config.ts`:
   ```ts
   process.env.TZ = 'UTC';               // deliberately NOT Chicago
   process.env.LANG = 'en_US.UTF-8';
   ```
   Running the suite in **UTC** is what makes it discriminating: any code that forgot an explicit zone renders UTC, and the Chicago assertion goes red. A suite pinned to `America/Chicago` on a Chicago dev box proves nothing.
2. Assert the pin itself, once, so a config regression is visible:
   ```ts
   it('the suite runs in a zone that can discriminate', () => {
     expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
   });
   ```
3. Spy the constructor where the zone must reach a formatter:
   ```ts
   const spy = vi.spyOn(Intl, 'DateTimeFormat');
   renderLocalTime(instant);
   expect(spy.mock.calls[0]?.[1]).toMatchObject({ timeZone: 'America/Chicago' });
   expect(spy.mock.calls[0]?.[0]).toBe('en-US');     // locale pinned too
   ```
4. One instant, two zones, opposite verdicts — the executed pair is in Code Example 6.

**Warning signs:** a test file with no zone pin; `toLocaleString()` with one argument; a "today" count that changes after 6 PM.

### Pitfall 7 — `proxy.ts` in the wrong directory

**What goes wrong:** placed in `app/`, Next never loads it, `clerkMiddleware()` never runs, and every `auth()` call throws *"Unable to verify request, this usually means the Clerk middleware did not run"* (`auth_signature_invalid`) — an error whose text points at Clerk config, not at the file path. Both CONTEXT.md and STACK.md currently say `app/proxy.ts`.

**How to avoid:** root or `src/`, level with `app`. Add `/api/health` returning `{ ok, orgId: <boolean> }` and hit it in CI after deploy — a missing proxy shows up there immediately.

### Pitfall 8 — drizzle-kit and hand-written PL/pgSQL

**What goes wrong:** custom migrations carrying `$$ … $$` function bodies can be split on `;` by a naive SQL splitter, producing a syntax error mid-function.

**How to avoid:** keep `breakpoints: true` (the default) and separate every statement in a `--custom` migration with an explicit `--> statement-breakpoint` line; keep each function body as one statement. Prove it by running `drizzle-kit migrate` against the local database as the very first executable step of the phase, before anything depends on it. [CONFIDENCE: MEDIUM — documented behaviour, not executed here]

### Pitfall 9 — `actions/setup-node@v5` + pnpm

**What goes wrong:** setup-node v5 auto-caches when `packageManager` is present in `package.json`, which collides with `pnpm/action-setup`'s own caching and with `actions/cache`; there is an open report of v5 failing immediately with pnpm.

**How to avoid:** `pnpm/action-setup@v4` **before** `actions/setup-node@v4` with `cache: 'pnpm'`, and no third cache step. And `pnpm install --frozen-lockfile` — never `npm ci`, which is the documented, repeated failure with a Windows-authored lockfile. [CONFIDENCE: MEDIUM — community reports + action READMEs]

---

## Code Examples

> Examples tagged `[VERIFIED: executed]` are output from a real PostgreSQL 18.3 run performed during this research session (PGlite 0.5.8, `select version()` confirmed). They are not recalled.

### Example 1 — The tenancy helper (bootstrap migration)

```sql
create schema if not exists app;

create or replace function app.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function app.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.orgs
   where clerk_org_id = coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')
$$;

grant usage on schema app to authenticated, anon, service_role;
grant execute on all functions in schema app to authenticated, anon, service_role;
alter default privileges in schema app grant execute on functions to authenticated, anon, service_role;
```
`grant usage on schema app` is not optional — without it policies raise *"permission denied for schema app"* instead of evaluating (BIS learned this in migration `0002`).

On a bare Postgres (local + CI) the Supabase roles do not exist, so migration `0000` creates them idempotently — safe to run against Supabase too:
```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')         then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin bypassrls; end if;
end $$;
```

### Example 2 — The retention constraints, exercised

```
REFUSED  google durable            sqlstate=23514  constraint=sr_google_is_ephemeral
REFUSED  google ephemeral, no TTL  sqlstate=23514  constraint=sr_ephemeral_has_expiry
INSERTED google ephemeral + TTL
INSERTED overture durable
REFUSED  business.phone citing the EPHEMERAL google source
                                   sqlstate=23503  constraint=businesses_phone_src_fk
INSERTED business.phone citing the DURABLE overture source
INSERTED business with NULL provenance  (the column simply stays null)
```
[VERIFIED: executed]

**Criterion 3's test pins `23514` (check_violation) and `23503` (foreign_key_violation) — not `42501`.** Assert `constraint` by name too; the constraint name is the thing a future migration could rename out from under you.

### Example 3 — The refused cross-org statement, and the second one

```
--- v1 flat claim { org_id: 'org_A' } ---
visible leads: [ 'A-lead' ]
REFUSED  org A inserting into org B   sqlstate=42501
         "new row violates row-level security policy for table \"leads\""
REFUSED  a SECOND statement in the same tx
         sqlstate=25P02  "current transaction is aborted, commands ignored until end of transaction block"

--- v2 nested claim { o: { id: 'org_B' } } ---
visible leads: [ 'B-lead' ]
cross-org UPDATE rows affected: 0        ← filtered, NOT refused
```
[VERIFIED: executed]

```ts
it('org A cannot INSERT into org B, and the refusal is 42501', () =>
  withRollback(async (c) => {
    const { b } = await seedTwoOrgs(c);
    await actAs(c, { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' });
    await expect(
      c.query('insert into businesses (org_id, display_name) values ($1,$2)', [b, 'pwned'])
    ).rejects.toMatchObject({ code: '42501' });
  }));   // one refused statement per transaction — the next reports 25P02
```

**"Watched failing first", as a plan step:** write this test while the table has `using (true)` (or no policy at all), run `pnpm test:db -t "42501"`, paste the red output into the task's verification notes, *then* add the policy and re-run. Read the failing **test name** — a `-t` filter that matches nothing exits green (recorded BIS lesson). Mutation check for the review: delete the `with check` clause from `businesses_insert` and confirm this named test, and only this one, goes red.

### Example 4 — D-10's schema audit

```ts
const ALLOW_NO_ORG_ID = new Set(['orgs', 'users', '__drizzle_migrations']);

it('every public table is org-scoped and has RLS enabled', () =>
  withRollback(async (c) => {
    const { rows } = await c.query(`
      select c.relname as table_name,
             c.relrowsecurity as rls_enabled,
             exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'org_id'
                        and a.attnum > 0 and not a.attisdropped) as has_org_id,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname`);
    const bad = rows.filter((r) =>
      !r.rls_enabled || r.policy_count === 0 ||
      (!r.has_org_id && !ALLOW_NO_ORG_ID.has(r.table_name)));
    expect(bad).toEqual([]);
  }));
```
[VERIFIED: executed — the query returns the expected `{table_name, rls_enabled, has_org_id, policy_count}` shape]

The allow-list is a **set literal in the test**, not a config file: adding to it is a diff a reviewer sees.

### Example 5 — A direct SQL write still produces an event

```
event produced by a DIRECT sql write:
  { actor_id: 'user_danlo', entity_type: 'leads', action: 'insert', after.title: 'direct-write' }
```
[VERIFIED: executed] — no application code involved; the trigger read the actor from `app.jwt()->>'sub'`.

### Example 6 — The discriminating timezone pair

```
instant:        2026-09-21T01:00:00.000Z     (= 2026-09-20 20:00 America/Chicago)
utc_bucket:     2026-09-21                   ← the wrong answer
chicago_bucket: 2026-09-20                   ← the right answer

DST gap        2026-03-08 02:30 America/Chicago → 2026-03-08T08:30:00Z  (the hour does not exist)
DST ambiguous  2026-11-01 01:30 America/Chicago → 2026-11-01T07:30:00Z  (the hour happens twice)
```
[VERIFIED: executed]

One instant, two zones, opposite day verdicts. Use this exact instant as the fixture — it is 8 PM in the RGV, the hour danlo is most likely to open the dashboard.

### Example 7 — CI workflow skeleton

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4              # BEFORE setup-node
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile     # never npm ci (Windows lockfile)
      - run: pnpm typecheck && pnpm lint && pnpm test:unit

  db:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: siteless_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/siteless_test
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate        # drizzle-kit migrate against TEST_DATABASE_URL
      - run: pnpm test:db
```
[CITED: docs.github.com/actions/guides/creating-postgresql-service-containers]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Clerk ↔ Supabase **JWT template** (share the Supabase JWT secret with Clerk) | Supabase **native third-party auth** for Clerk | Deprecated **2025-04-01** | Copying BIS blindly risks copying the deprecated path. Already configured correctly on the `siteless` project. [CITED: supabase.com/docs/guides/auth/third-party/clerk] |
| `middleware.ts` at the root, Edge runtime by default | `proxy.ts` at the root, **Node.js runtime** by default; `export function proxy()` | Next **16.0.0** | Codemod: `npx @next/codemod@canary middleware-to-proxy .` |
| `createRouteMatcher()` + `auth.protect()` in middleware | Resource-based checks in each page / layout / route handler / Server Function | `@clerk/nextjs` 7.x | `createRouteMatcher` carries an explicit `@deprecated` tag in 7.9.4 [VERIFIED: unpacked] |
| Clerk session token **v1** (flat `org_id`) | **v2** (`o: { id, rol, slg, per, fpm }`), present only when an org is active | Clerk changelog 2025-04-14 | The coalesce helper; and "active organization" becomes a first-class failure mode. |
| Organizations optional, personal accounts on | **Membership required** is the default; personal accounts off when Organizations are enabled | **2025-08-22** | Aligns with D-02. Confirm the setting rather than assuming it. |
| `pgTable(...).enableRLS()` | `pgTable.withRLS(...)` | drizzle-orm **v1 beta** | **We are on 0.45.2 — use `.enableRLS()`.** `withRLS` does not exist in 0.45.2 [VERIFIED: unpacked `pg-core/table.d.ts:22`]. Context7 returns v1-beta snippets; do not copy them. |
| `postgres` superuser for everything | A non-owner `app_user` login role for the runtime | — | The only reliable guard against owner-bypass. |

**Deprecated / outdated for this phase:**
- `@supabase/auth-helpers-nextjs` → `@supabase/ssr` (and neither is needed here).
- `npm ci` in CI from this repo's lockfile → `pnpm install --frozen-lockfile`.
- `typescript@7.0.2` (npm `latest` today) → `6.0.3`.

---

## Environment Availability

Probed on the dev machine on **2026-09-20**.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | **24.13.0** | — |
| pnpm | build + CI | ✓ (wrong version) | **11.9.0** (STACK pins 12.5.1) | `"packageManager": "pnpm@12.5.1"` — pnpm self-switches |
| git | repo | ✓ | 2.53.0.windows.2 | — |
| `gh` | PRs, CI checks | ✓ | 2.89.0 | — |
| Vercel CLI | criterion 1 deploy | ✓ | **54.20.1**; `vercel link`, `vercel git connect`, `vercel env`, `vercel project add` all present [VERIFIED: `--help` executed] | dashboard |
| **Docker / Docker Desktop** | **D-04 local Supabase** | ✗ | — | see below |
| **WSL** | Docker Desktop prerequisite | ✗ ("not installed") | — | `wsl --install` + reboot |
| Supabase CLI | D-04 `supabase start` | ✗ | — | `npx supabase` (still needs Docker) |
| `psql` | manual DB inspection | ✗ | — | `tsx` script over `pg` |
| PostgreSQL server (local) | the RLS/grant/constraint suite | ✗ | — | **decision required — see below** |
| GitHub repo `dlopez2392/siteless` | CI + Vercel git link | ✓ | `origin`, `main`, 3 commits | — |
| `.env.local` | Clerk + Supabase keys | ✓ | 8 keys present (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `CLERK_FRONTEND_API_URL`, `CLERK_JWKS_URL` | — |

**Missing dependencies with no fallback:** none — but one **blocking decision**.

**Missing env vars this phase must add** (values from the Supabase dashboard; never committed):
- `SUPABASE_DB_URL` — shared pooler **session** mode, `aws-<idx>-us-east-1.pooler.supabase.com:5432`, user `postgres.jahgeqshuesndyscnmjo`. For `drizzle-kit generate/migrate`. IPv4 on all plans; prepared statements supported.
- `SUPABASE_DB_POOL_URL` — shared pooler **transaction** mode, port `6543`, user `app_user.jahgeqshuesndyscnmjo`. For the runtime, `prepare: false`.
- `TEST_DATABASE_URL` — local/CI Postgres only. Never a Supabase URL.

> Do **not** use the direct `db.<ref>.supabase.co:5432` address from Vercel or GitHub Actions — it is IPv6-only without the IPv4 add-on, and GitHub-hosted runners have no IPv6. This is the exact comment BIS left in `packages/db/src/test/db.ts`. [CITED: supabase.com/docs/guides/database/connecting-to-postgres]

### 🔴 Decision required before planning: the test database (D-04 / D-05)

D-05 says to check Docker at plan time. **Docker Desktop is not installed and WSL is not installed**, so D-04 as written cannot run today and D-05's paid fallback is formally triggered. There is a third option that honours D-04's intent, and the planner should not pick silently:

| Option | Cost | Setup | Extensions | Matches CI | Honours D-04 intent |
|---|---|---|---|---|---|
| **A. Native PostgreSQL 18 for Windows** (EDB installer) + bootstrap migration | $0 | ~10 min, one time, no reboot | contrib (`pg_trgm`, `unaccent`, `fuzzystrmatch`) included; PostGIS via StackBuilder | **Yes** — CI's `postgres:18` container needs the same bootstrap | Yes (local Postgres, never production) |
| B. Install WSL2 + Docker Desktop, then `supabase start` (D-04 literal) | $0 | ~30–60 min + reboot, ~4 GB | full Supabase stack | Partly (CI still uses a plain container) | Yes |
| C. PGlite in-process | $0 | `pnpm add -D` | ⚠️ **no** contrib extensions in the default bundle [VERIFIED: executed]; no PostGIS; single connection (needs `@electric-sql/pglite-socket` for `pg` fixtures) | Yes | Yes, but breaks in Phase 3 |
| D. Second Supabase project `siteless-dev` (D-05 fallback) | ~$10/mo | dashboard | full | No (CI would need it too, or a second setup) | Yes (production untouched) |

**Recommendation: A**, with C as a bonus for pure-DDL unit tests. The bootstrap migration that makes a bare Postgres look like Supabase has to exist for CI regardless, so A costs the phase nothing extra and makes dev and CI byte-identical. **This is a change to a locked decision's implementation — surface it to danlo before planning.**

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@5.0.1` (+ `vite@8.3.0`), `@playwright/test@1.63.0` |
| Config file | **none — Wave 0 creates `vitest.config.ts` (TZ pinned on line 1), `vitest.db.config.ts`, `playwright.config.ts`** |
| Quick run command | `pnpm test:unit` → `vitest run tests/unit` |
| DB suite command | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks --poolOptions.forks.singleFork` |
| Full suite command | `pnpm verify` → `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db` |

> `singleFork` for the DB suite: `withRollback` opens a real connection per test and a local Postgres default `max_connections=100` is easy to exhaust when vitest fans out. Serial is also what makes a `rollback` failure attributable.

### Phase Requirements → Test Map

| Req | Behaviour | Type | Automated command | File exists? |
|-----|-----------|------|-------------------|--------------|
| FOUND-01 | Two seeded orgs; org A's `select` returns only org A's rows, under **both** claim shapes | DB-integration | `pnpm test:db -t "sees only its own org"` | ❌ Wave 0 |
| FOUND-01 | Every `public` table has `org_id` + RLS + ≥1 policy (allow-list: `orgs`, `users`, `__drizzle_migrations`) | DB-integration | `pnpm test:db -t "every public table is org-scoped"` | ❌ Wave 0 |
| FOUND-01 | A connection that skips `withOrg` (no `set local role`) is refused `42501` | DB-integration | `pnpm test:db -t "without set local role"` | ❌ Wave 0 |
| FOUND-01 | `app.ensure_org` creates the caller's org idempotently and refuses another org with `42501` | DB-integration | `pnpm test:db -t "ensure_org"` | ❌ Wave 0 |
| **FOUND-02** | **INSERT carrying a foreign `org_id` rejects with `code: '42501'` + "row-level security" in the message** | DB-integration | `pnpm test:db -t "42501"` | ❌ Wave 0 |
| FOUND-02 | The second statement in the same aborted tx reports `25P02` | DB-integration | `pnpm test:db -t "25P02"` | ❌ Wave 0 |
| FOUND-02 | Cross-org `UPDATE`/`DELETE` affect **0 rows** (filtered, not refused) | DB-integration | `pnpm test:db -t "filtered, not refused"` | ❌ Wave 0 |
| FOUND-02 | A v2-shape token (`{ o: { id } }`) resolves the same org as a v1-shape token | DB-integration | `pnpm test:db -t "token v2"` | ❌ Wave 0 |
| FOUND-03 | A **raw SQL** insert/update/delete produces an `events` row with actor + `occurred_at` | DB-integration | `pnpm test:db -t "direct write still produces an event"` | ❌ Wave 0 |
| FOUND-03 | `update events` / `delete from events` as `authenticated` → `42501` ("permission denied for table") | DB-integration | `pnpm test:db -t "append-only"` | ❌ Wave 0 |
| FOUND-03 | An UPDATE touching only a domain column still moves `updated_at` and stamps `updated_by` | DB-integration | `pnpm test:db -t "updated_at"` | ❌ Wave 0 |
| **FOUND-05** | `source_key='google_places'` + `retention_class='durable'` → `23514` / `sr_google_is_ephemeral` | DB-integration | `pnpm test:db -t "google content cannot be durable"` | ❌ Wave 0 |
| FOUND-05 | `ephemeral` without `expires_at` (and `durable` with one) → `23514` / `sr_ephemeral_has_expiry` | DB-integration | `pnpm test:db -t "ephemeral"` | ❌ Wave 0 |
| FOUND-05 | A durable business field citing an ephemeral source → `23503` / `businesses_*_src_fk` | DB-integration | `pnpm test:db -t "durable cites durable"` | ❌ Wave 0 |
| FOUND-04 | No registered payload builder emits the internal-notes canary | unit | `pnpm test:unit -t "internal annotation"` | ❌ Wave 0 |
| FOUND-04 | Every module under `src/lib/export/` appears in `PAYLOAD_BUILDERS` | unit | `pnpm test:unit -t "represented in the registry"` | ❌ Wave 0 |
| FOUND-04 | `legal_name`, `display_name`, `internal_notes` are three distinct columns | DB-integration | `pnpm test:db -t "three distinct name fields"` | ❌ Wave 0 |
| **FOUND-06** | Every `timestamp` column in `public` is `timestamptz` (`information_schema.columns.data_type`) | DB-integration | `pnpm test:db -t "timestamptz"` | ❌ Wave 0 |
| FOUND-06 | `2026-09-21T01:00Z` buckets to `2026-09-21` in UTC and `2026-09-20` in Chicago | DB-integration | `pnpm test:db -t "two zones, opposite verdicts"` | ❌ Wave 0 |
| FOUND-06 | `Intl.DateTimeFormat` is called with `{ timeZone: 'America/Chicago' }` and an explicit locale | unit (spy) | `pnpm test:unit -t "pins the zone and the locale"` | ❌ Wave 0 |
| FOUND-06 | The suite's own zone is the pinned discriminating zone | unit | `pnpm test:unit -t "suite runs in a zone that can discriminate"` | ❌ Wave 0 |
| FOUND-01 (UI) | `soleOrganizationToActivate` activates on exactly one membership; returns null on 0, >1, or already-active | unit | `pnpm test:unit -t "sole organization"` | ❌ Wave 0 |
| FOUND-01 (UI) | A signed-in user with no active org lands on `/no-access` | E2E | `pnpm test:e2e -g "no access"` | ❌ Wave 0 |
| **Criterion 1** | danlo signs in on the deployed Vercel URL and sees his org id | E2E (against the preview/prod URL) | `pnpm test:e2e -g "signs in and is org-scoped"` | ❌ Wave 0 |
| Criterion 1 | `/api/health` returns 200 with `{ ok: true, db: 'up' }` on the deployed URL | smoke (`curl`) | `curl -fsS "$DEPLOY_URL/api/health"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:unit` (< 10 s) plus the single `-t` filter for the test that task made green — and **read the test name in the output**, because a `-t` filter that matches nothing exits green.
- **Per wave merge:** `pnpm verify` (typecheck + lint + unit + db).
- **Phase gate:** `pnpm verify` green, `pnpm test:e2e` green against the deployed URL, and a recorded mutation check for each of the three criteria tests — drop the `with check` clause (FOUND-02), drop `sr_google_is_ephemeral` (FOUND-05), drop the `after` trigger (FOUND-03) — each must turn exactly one named test red, then be reverted and diffed back.

### Wave 0 Gaps

- [ ] `package.json` + `pnpm-lock.yaml` + `"packageManager": "pnpm@12.5.1"` — nothing exists yet
- [ ] `vitest.config.ts` (TZ + locale pinned on line 1) — covers FOUND-06
- [ ] `vitest.db.config.ts` (`pool: 'forks'`, `singleFork`, `dotenv/config`) — covers FOUND-01/02/03/05
- [ ] `playwright.config.ts` + a storage-state auth setup — covers criterion 1
- [ ] `tests/db/_fixtures.ts` (`withRollback`, `actAs`, `actAsOwner`, `seedTwoOrgs`) — shared by every DB test
- [ ] `drizzle.config.ts` + `drizzle/0000_bootstrap.sql` — nothing runs without these
- [ ] A local Postgres to point `TEST_DATABASE_URL` at (see the decision above)
- [ ] `.github/workflows/ci.yml` with the `postgres:18` service container
- [ ] `src/lib/export/registry.ts` — the empty registry must exist so the sentinel test is real from day one

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control in this phase |
|---|---|---|
| V2 Authentication | **yes** | Clerk hosted sign-in (email code + Google). No password handling in-repo. `CLERK_SECRET_KEY` server-only, never `NEXT_PUBLIC_`. |
| V3 Session Management | **yes** | Clerk session cookie + `clerkMiddleware()`. Session state (including the active org) is Clerk's; the app never mints or extends a session. Pending sessions are treated as signed-out. |
| V4 Access Control | **yes** | Two layers: `requireOrg()` in every layout/handler/action (deny by default), and RLS as the backstop. `SECURITY DEFINER` functions all pin `set search_path = public`. `app.ensure_org` validates its argument against the caller's claim. |
| V5 Input Validation | **yes** | `zod@4.6.5` for env parsing; all DB parameters bound (`$1`), never string-interpolated. The one unavoidable interpolation — `set local role` — is allow-listed against a `Set`. |
| V6 Cryptography | **no** (this phase) | No signing/encryption in Phase 1. Clerk verifies JWTs; Supabase/Postgres auth is TLS + password. HMAC arrives in Phase 8. |
| V7 Error Handling & Logging | **yes** | `events` is the security-relevant audit log: append-only by grant, actor-attributed, `timestamptz`. Never log a token, a DB URL or a claim payload. |
| V8 Data Protection | **yes** | `.env.local` is gitignored and verified untracked. Vercel env vars set from those values, never committed. The retention constraints are a data-protection control expressed as schema. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---|---|---|
| Cross-tenant read via a missed `WHERE org_id` | Information Disclosure | RLS on every table + the D-10 enumeration test |
| Cross-tenant read via a forgotten `set local role` on an owner connection | Elevation of Privilege | Dedicated non-owner `app_user` runtime role → `42501` [VERIFIED: executed] |
| Claim leakage across a pooled connection | Information Disclosure | `set local` / `set_config(…, true)` only; never the non-local form [VERIFIED: executed] |
| SQL injection through JSON claims (`sql.raw(JSON.stringify(token))`) | Tampering | Bound parameters; role allow-list [VERIFIED: executed — a quote in a claim value would break/inject the raw form] |
| Tampered `org_id` supplied by the client | Spoofing | `org_id` derived only from Clerk's server-verified `auth()`; `app.ensure_org` re-checks against the claim |
| Middleware auth bypass (CVE-2025-29927 class) | Elevation of Privilege | No authorization in `proxy.ts`; checks live next to the data. `createRouteMatcher` deprecated. |
| Audit-log tampering | Repudiation | `revoke update, delete on events from authenticated` — a grant, not a policy [VERIFIED: executed] |
| `SECURITY DEFINER` search_path hijack | Elevation of Privilege | `set search_path = public` on `app.current_org_id`, `app.log_event`, `app.ensure_org` |
| Service-role key exposure | Information Disclosure | Do not introduce `SUPABASE_SERVICE_ROLE_KEY` in this phase. If ever needed: one file, `import 'server-only'`, CI grep on a second occurrence. |
| Secret in a client bundle | Information Disclosure | Only `NEXT_PUBLIC_*` may cross the boundary; a lint rule / CI grep on `process.env.` in `"use client"` modules |

---

## Project Constraints (from CLAUDE.md)

Actionable directives the plan must satisfy:

- **Own Supabase project** — `jahgeqshuesndyscnmjo`, never BIS's `tlbkbmlrfafquucsmsmm`. Own Vercel project.
- **Clerk v2 token gotcha** — BIS's `app.current_account_id()` must be adapted with `coalesce(jwt->'o'->>'id', jwt->>'org_id')`.
- **`typescript@6.x`, not 7** — `typescript-eslint` peer range.
- **Every table carries `org_id` with RLS from the first migration**; every assertion tested through a user-role connection with Clerk claims, pinning `42501`, watched failing first, one refused statement per rolled-back transaction.
- **`legal_name` vs `display_name` vs internal annotations** — three fields, never interchangeable, with a test asserting the internal one never reaches an export or push payload.
- **`America/Chicago`** — tests pin zone **and** locale.
- **Carried-over BIS gotchas** — painted values not CSS custom properties for anything a test pins; Tailwind v4 `[var(--x)]` not `[--x]`; a `"use client"` module's exports are client references inside a server component. (Phase 1 ships unstyled, so the first two are dormant; the third is live the moment `ActivateSoleOrganization` is imported into `layout.tsx` — import the **component**, never a data object, across that boundary.)
- **Process** — GSD, maximal parallel agents, PR-only once CI exists, **no autonomous merges**.
- **GSD workflow enforcement** — no direct repo edits outside a GSD command.
- Vercel Pro (~$20/mo) is **infrastructure**, separate from the $50 **data** cap — never merge the two numbers.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | Supabase's `postgres` role can `SET ROLE authenticated` (needed by `drizzle-kit`-owned connections and by the local fixtures) | Pattern 4, Pattern 3 | `[ASSUMED]` — universal in Supabase practice but not stated on the roles page. If wrong, the test fixtures need an explicit `grant authenticated to postgres`. Cheap to verify: `set role authenticated;` in the SQL editor. |
| A2 | The shared pooler accepts a custom role as `app_user.<project-ref>` on this project | Pattern 3, Env | `[CITED]` from Supabase troubleshooting docs, not executed against `jahgeqshuesndyscnmjo`. If wrong, fall back to `postgres.<ref>` + `alter table … force row level security` and a CI grep that every DB call goes through `withOrg`. |
| A3 | drizzle-kit's SQL splitter handles `$$`-quoted PL/pgSQL bodies when statements are separated by `--> statement-breakpoint` | Pitfall 8 | `[ASSUMED]` from documented breakpoint behaviour. If wrong, the function bodies move into a `tsx` bootstrap script run before `drizzle-kit migrate`. Detected on the very first migrate. |
| A4 | drizzle-kit `generate` emits a composite FK whose second column is `GENERATED ALWAYS AS ('durable') STORED` without confusing its differ | Pattern 2 | `[ASSUMED]` — the **DDL itself is verified** (executed on PG 18.3); only drizzle-kit's *generation* of it is unverified. Mitigation is a one-line fallback: emit those two constraints from `generate --custom`. |
| A5 | The Clerk "Siteless" instance has **Membership required** on and org creation off | Pattern 5, D-02 | `[ASSUMED]` — it is the post-2025-08-22 default and matches D-02's intent, but was not read from the dashboard in this session. If off, a signed-in user can reach a session with no org and only `requireOrg()` catches it. Verify in the dashboard as a plan step. |
| A6 | Vercel supports Node 24 for builds and functions | Env, deploy | `[CITED]` — Vercel changelog "Node.js 24 LTS is now generally available for builds and functions", linked from the Node runtime docs. Not exercised. |
| A7 | Row triggers on `businesses`/`source_records` are affordable at Phase 3's ~10k-row ingest | Pattern 6 | `[ASSUMED]` — write amplification is real but the volume is small. The mitigation (run-level events for bulk ingest) is stated; decide the boundary in this phase and record it in CONVENTIONS.md. |
| A8 | `actions/setup-node@v5` + pnpm caching is currently unreliable | Pitfall 9 | `[ASSUMED]` from an open issue + community posts. The recommended v4 ordering is safe regardless. |

---

## Open Questions (RESOLVED)

> All five were resolved during `/gsd-discuss-phase` and `/gsd-plan-phase` on 2026-09-21.
> Each carries the decision or plan task that closed it. Nothing below is still open.

1. **Which test-database option (A/B/C/D)?**
   - What we know: Docker and WSL are both absent [VERIFIED]; D-05's literal fallback is the ~$10/mo second Supabase project; a bootstrap migration for a bare Postgres is required for CI in every option.
   - What's unclear: whether danlo prefers $0 + a 10-minute native install (A) over $10/mo + zero local setup (D).
   - Recommendation: **A**, and ask before planning. Do not let the planner pick this silently — it changes the Wave-0 task list.
   - **RESOLVED:** option **A**, by **CONTEXT.md D-05a** (asked, not assumed — native PostgreSQL 18 for Windows, EDB installer, `TEST_DATABASE_URL` never a Supabase URL). Realised by **plan 01-02 Task 2** (the install-verification checkpoint) and **plan 01-04 Task 2** (`drizzle/0000_bootstrap.sql`, the same bootstrap CI's `postgres:18` service container runs).

2. **Does Phase 1 create `businesses` and `source_records`, or only the tenancy spine?**
   - What we know: FOUND-04 needs the three-name split and FOUND-05 needs the composite FK — both require real tables. CONTEXT.md's Integration Points say Phases 2 ∥ 3 need these shapes agreed *here*.
   - Recommendation: yes — a **minimal** `source_records` (full retention constraints) and a **minimal** `businesses` (three names, provenance FK pairs for `legal_name`/`display_name`/`phone_e164`, `org_id`, `orgScoped` columns). Phase 3 adds geometry, normalization columns and indexes. Record the agreed shape in CONVENTIONS.md so Phase 2 and Phase 3 can run concurrently.
   - **RESOLVED:** yes, minimal. `businesses` (three distinct name fields, `org_id`, RLS) lands in **plan 01-05**; `source_records` with the full retention CHECKs and the durable-cites-durable composite FK lands in **plan 01-07**. The agreed shape is written to CONVENTIONS.md by **plan 01-09 Task 3** so Phases 2 and 3 can run concurrently.

3. **Supabase `postgres` + `SET ROLE` and custom-role pooler access (A1, A2).**
   - Recommendation: make these the first two verification steps of the phase's first DB task, against the real project, before the runtime wiring depends on them. Both have stated fallbacks.
   - **RESOLVED:** **plan 01-10 Task 2, step 2** probes both against the real project before the runtime wiring depends on them, and records the outcome (and any fallback taken) in the SUMMARY.

4. **`events` write amplification boundary (A7).**
   - Recommendation: decide it here — row triggers on state-bearing tables, one run-level event for bulk ingest — and write it down. Re-deriving it in Phase 3 means re-reading every call site.
   - **RESOLVED:** decided as recommended — after-row triggers on the state-bearing tables only (`orgs`, `businesses`), one run-level event for bulk ingest. Written down in CONVENTIONS.md by **plan 01-09 Task 3**, and pinned by the DB-integration test `exactly orgs + businesses carry an app.log_event after-row trigger` (**plan 01-09**).

5. **Which Clerk claim survives?**
   - What we know: the instance has a *custom* claim `{"org_id":"{{org.id}}","role":"authenticated"}` **and** v2's default `o.id`. The `role: 'authenticated'` claim is required only by Supabase's Data API path, which Phase 1 does not use.
   - Recommendation: keep both (the coalesce costs nothing and keeps the supabase-js path open) and test both shapes (D-11). Do not remove the custom claim — Storage/Realtime would need it later.
   - **RESOLVED:** keep both. `app.current_org_id()` reads `coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')`, and **plan 01-05 Task 2** exercises both shapes — the v1 flat claim in `sees only its own org` and the v2 nested claim in the `token v2` test, which asserts the two resolve the same org. The custom claim is not removed.

---

## Sources

### Primary (HIGH confidence)
- **Executed during this session** — PostgreSQL **18.3** via PGlite 0.5.8: retention CHECKs (`23514`), composite FK on a generated column (`23503`), `app.jwt()` under v1 and v2 claim shapes, cross-org INSERT (`42501`) and the follow-on `25P02`, cross-org UPDATE affecting 0 rows, owner-bypass without `set local role`, `42501` for a non-owner role that skips `set role`, `revoke update, delete on events`, a `SECURITY DEFINER` trigger logging a raw SQL write, `set local` vs non-local `set_config` leakage, the `pg_class`/`pg_policy` audit query, and the two-zone day-bucket pair.
- **Unpacked from the npm registry** — `drizzle-orm@0.45.2` (`pg-core/table.d.ts` → `.enableRLS()` and **no** `withRLS`; `supabase/rls.d.ts` role exports; `pg-core/policies.d.ts` `pgPolicy` config; `pg-core/checks.d.ts`; `pg-core/foreign-keys.d.ts`; `pg-core/columns/timestamp.d.ts`; `generatedAlwaysAs`), `@clerk/nextjs@7.9.4` (peer ranges; `createRouteMatcher` `@deprecated`; `auth()` → `SessionAuthObject`), `@clerk/backend@3.18.1` (`orgId`/`orgRole`/`orgSlug`/`getToken`/`sessionClaims`, `treatPendingAsSignedOut`).
- `npm view` for every version and publish date, 2026-09-20.
- Local tool probes: `node`, `pnpm`, `git`, `gh`, `vercel --help`, `docker`, `wsl --status`.
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy — proxy location, Node runtime default, Server Function warning (page version 16.3.5, updated 2026-09-07)
- https://nextjs.org/docs/messages/middleware-to-proxy — codemod, rename rationale
- https://clerk.com/docs/reference/nextjs/clerk-middleware — Next 16 filename, matcher, resource-based auth guidance
- https://supabase.com/docs/guides/auth/third-party/clerk — native third-party auth; `role` claim; JWT template deprecated 2025-04-01
- https://supabase.com/docs/guides/database/connecting-to-postgres — the three connection types, ports, username formats, IPv4/IPv6, "transaction mode does not support prepared statements"
- https://supabase.com/docs/guides/troubleshooting/tenant-or-user-not-found — `[ROLE].[PROJECT-REF]` for custom roles on the shared pooler
- https://orm.drizzle.team/docs/pg/rls and /docs/drizzle-config-file — `pgPolicy`, `authenticatedRole`, the Supabase RLS transaction wrapper, `entities.roles.provider: 'supabase'`
- https://vercel.com/docs/cli/project and `vercel --help` (local) — project/link/git/env commands
- https://vercel.com/docs/functions/runtimes/node-js — pnpm detection from `pnpm-lock.yaml`, corepack, Node 24 GA changelog
- https://docs.github.com/actions/guides/creating-postgresql-service-containers — service container + `pg_isready` health check
- **BIS source, read directly** — `packages/db/supabase/migrations/0001_tenancy.sql`, `packages/db/src/test/db.ts`, `packages/db/src/test/rls.test.ts`, `packages/db/src/test/sites-grants.test.ts`, `packages/db/src/events.ts`, `packages/db/src/user-client.ts`, `packages/db/src/timezone.ts`, `apps/web/src/lib/db.ts`, `apps/web/src/lib/auth/sole-organization.ts`, `apps/web/src/components/activate-sole-organization.tsx`

### Secondary (MEDIUM confidence)
- https://clerk.com/changelog/2025-04-14-session-token-jwt-v2 and /docs/guides/sessions/session-tokens — the `o` claim (`id`/`slg`/`rol`/`per`/`fpm`), present only with an active organization
- https://clerk.com/docs/guides/configure/session-tasks, /docs/guides/organizations/configure — "Membership required" default since 2025-08-22; `TaskChooseOrganization`
- https://vitest.dev/config/env + vitest issues #1575 / discussion #1718 — `env.TZ` ineffective in the threads pool
- https://orm.drizzle.team/docs/kit-custom-migrations — `generate --custom`, statement breakpoints

### Tertiary (LOW confidence — flagged)
- `actions/setup-node` issue #1357 (v5 + pnpm) — community report; the recommended v4 ordering sidesteps it either way
- drizzle-kit's handling of a generated column inside a composite FK — no authoritative source found; mitigation stated (A4)

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every version queried from the registry today; the three load-bearing API surfaces (`drizzle-orm/supabase`, `pgPolicy`, Clerk `auth()`) read from the unpacked packages rather than from docs.
- Database architecture (RLS, retention constraints, events, triggers): **HIGH** — executed end to end on PostgreSQL 18.3 during this session. Two documented assumptions remain about *Supabase-specific* role behaviour (A1, A2), both with stated fallbacks.
- Clerk / Next scaffold: **MEDIUM-HIGH** — file location, runtime, deprecations and peer ranges verified from primary sources; the active-org flow is corroborated by BIS's own post-incident fix. STACK.md rated this MEDIUM and asked for re-verification; that is now done, and it produced a correction (`proxy.ts` location).
- Vercel first deploy: **MEDIUM** — CLI surface verified locally, the sequence documented but not executed. Criterion 1 is the only criterion with no offline proof.
- CI: **MEDIUM** — standard pattern, one known pnpm/setup-node interaction flagged.
- Pitfalls: **HIGH** — eight of nine reproduced or read from primary sources; Pitfall 8 is documented-only.

**Research date:** 2026-09-20
**Valid until:** 2026-10-20 for the database layer (stable). **2026-10-04** for Next 16 / Clerk 7 — both are moving weekly (`next@16.3.5` published 2026-09-19, `@clerk/nextjs@7.9.4` 2026-09-19). Re-check the `proxy.ts` convention and Clerk's org-activation defaults if this phase has not started within two weeks.

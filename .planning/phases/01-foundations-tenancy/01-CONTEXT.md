# Phase 1: Foundations & Tenancy - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

A deployed, org-scoped application skeleton: Clerk sign-in on a Vercel deployment where every request is scoped to the caller's org; `org_id` + RLS on every table, proven by a *refused* cross-org statement (SQLSTATE `42501`) issued through a user-role connection carrying Clerk claims; actor + timestamp recorded on every state change; `legal_name` / `display_name` / internal annotations as three separate fields with a test proving the internal one never reaches an export or push payload; and a database constraint (not a code review) that refuses Google Places content in any durable field. All timestamps `timestamptz`, computed and rendered in `America/Chicago` with zone and locale pinned in tests.

Ships an **unstyled shell only** — the design system is born in Phase 2's `/gsd-ui-phase`. No presets, no ingest, no leads, no budget ledger in this phase (Phases 2 and 3).

</domain>

<decisions>
## Implementation Decisions

### Tenancy model
- **D-01:** One Siteless tenant = one Clerk organization — a **flat** model. No agency → accounts second level (that exists in BIS because BIS's customers have customers; Siteless's customer is the agency itself). An `orgs` table keyed by a unique `clerk_org_id`; every other table carries `org_id` (uuid FK to `orgs`).
- **D-02:** **Invite-only** in v1. Clerk's "users can create organizations" is OFF; danlo creates the org in the Clerk dashboard and invites BIS staff. A signed-in user with no org membership lands on a "no access" page — never an empty tenant.
- **D-03:** The `orgs` row is provisioned **just-in-time** on the first authenticated request that carries a Clerk org claim not yet seen (no Clerk webhook in this phase). One org exists in v1; the schema does not assume it.

### Test database
- **D-04:** RLS / grant / constraint tests run against a **local Postgres** — Supabase CLI (`supabase start`, Docker) on the dev machine and a Postgres service container in CI. The cloud project `siteless` (`jahgeqshuesndyscnmjo`) is **production only** and is never a test target. This deliberately ends the BIS pattern of sharing one project between e2e and production.
- **D-05:** If Docker Desktop is not available on the dev machine (check at plan time, not assumed), the fallback is a second small Supabase project `siteless-dev` (~$10/mo on the Pro org). Under no fallback do tests touch the production project.
- **D-05a (decided 2026-09-21 — Docker Desktop and WSL verified absent):** the local test database is a **native PostgreSQL 18 for Windows install** (EDB installer, contrib extensions included), plus a `drizzle/0000_bootstrap.sql` migration that creates the `anon` / `authenticated` / `service_role` / `app_user` roles and the `app` schema so a bare Postgres looks like Supabase — the same bootstrap CI's `postgres:18` service container runs, making dev and CI byte-identical. Tests read `TEST_DATABASE_URL` (never a Supabase URL). PGlite may additionally be used for pure-DDL unit tests that need no extensions. danlo runs the installer himself (GUI); the plan includes a verification task (`psql`/`pg` connect + `select version()`), not the install.

### Audit trail
- **D-06:** An **append-only `events` table** is the record of truth for every state change: `org_id`, actor (Clerk user id), entity type + id, action, `before` / `after` (jsonb), `occurred_at timestamptz`. Immutable — UPDATE and DELETE grants revoked, not merely policied. This is what Phase 7's "status history with actor and timestamp" reads.
- **D-07:** **Plus** denormalized `created_at`, `updated_at`, `updated_by` on every mutable table, so lists can show "changed 2h ago by danlo" without a join.
- **D-08:** The mechanism that forces every write through the log (single write helper vs. database triggers) is Claude's discretion — but it must be **enforced**, not conventional; a test proves a direct write still produces an event.

### Schema tooling
- **D-09:** **Drizzle ORM + drizzle-kit is the single migration authority.** RLS policies are declared in the schema next to their tables (`pgPolicy`, `authenticatedRole`), so the org-scoping guarantee is a compile-time artifact. The Supabase MCP `apply_migration` path and Supabase CLI SQL migrations are **not** used for schema changes in this repo (two migration systems against one database is a guaranteed drift bug).
- **D-10:** A shared `orgScoped()` table helper + a test that enumerates `information_schema` and **fails** on any table lacking `org_id` or with RLS disabled (explicit allow-list for the few global tables, e.g. `orgs` itself).
- **D-11:** Port BIS's `withRollback` / `actAs` / `actAsOwner` fixtures (plain `pg`, tool-agnostic). `actAs` claims become `{ org_id, role: 'authenticated' }` — and the test suite must also exercise the Clerk token-v2 shape `{ o: { id } }`. The DB helper reads `coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')`. One refused statement per rolled-back transaction (the next one reports `25P02`, not `42501`); pin the SQLSTATE; watch it fail first.
- **D-11a (research correction, 2026-09-21, executed on real Postgres 18):** under RLS a cross-org `SELECT` / `UPDATE` / `DELETE` is **silently filtered to zero rows, not refused**; only an `INSERT` carrying a foreign `org_id` (or an `UPDATE` that moves `org_id`) raises `42501`. Success criterion 2 is therefore proven by BOTH: the foreign-org INSERT → `42501`, AND the cross-org UPDATE/DELETE → `rowCount: 0` / SELECT sees only its own rows. The Places retention constraints (criterion 3) refuse with `23514` (CHECK) and `23503` (FK) — pin those codes, not `42501`.
- **D-11b (research correction):** runtime RLS queries run as a dedicated `NOINHERIT` login role (`app_user`) that does not own the tables, so a connection that forgets `set local role` fails loudly with `42501` instead of reading every tenant; tenant claims are set with `set_config(..., true)` (transaction-local) — a non-local `set_config` survives commit and leaks the previous tenant's claims on a pooled connection.

### Claude's Discretion
- The Places-content retention constraint: implement ARCHITECTURE.md's `retention_class` CHECK + composite-FK "durable field cites durable source" invariant as database constraints; exact shape is Claude's.
- What the unstyled shell shows after sign-in — a "signed in as X in org Y" page plus a health route is sufficient; a stubbed route skeleton (presets / queue / dashboard) is optional.
- When within the phase the Vercel project is created and linked to `dlopez2392/siteless` (deploy is success criterion 1; the team is already Pro — no purchase).
- Timezone/locale pinning mechanics in tests (one instant, two zones, opposite verdicts; spy the constructor).
- Env var names mirror BIS (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, …) — already populated in `.env.local` (gitignored); Vercel env vars set from those values, never committed.
- Auth placement per Next 16 guidance: `clerkMiddleware()` in **`proxy.ts` at the project root (or `src/proxy.ts` — the same level as `app/`, never inside `app/`)** for session context; authorization in layouts / route handlers / server actions — never in proxy alone. (Research correction 2026-09-21: `app/proxy.ts` never runs and every `auth()` throws `auth_signature_invalid`.) Port BIS's `lib/auth/sole-organization.ts` + `activate-sole-organization.tsx` for the Clerk active-org trap.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition
- `.planning/ROADMAP.md` §"Phase 1: Foundations & Tenancy" — goal, the five success criteria (the refused-statement proof is criterion 2; the Places constraint is criterion 3), `/gsd-secure-phase` applies
- `.planning/REQUIREMENTS.md` — FOUND-01 … FOUND-06 (the six requirements this phase owns)
- `.planning/PROJECT.md` — Constraints (Legal, Data, Tech stack, Timezone, Process) and the Key Decisions table

### Research (already done — do not re-research these)
- `.planning/research/ARCHITECTURE.md` — data-model sketch; `retention_class` CHECK and composite-FK durable-source invariant; the Clerk session-token-v2 `o.id` gotcha and the `coalesce(...)` helper; why Postgres is the work queue (later phases)
- `.planning/research/STACK.md` — pinned versions (`typescript@6.0.3` NOT 7, `next@16.3.5`, `@clerk/nextjs@7.9.4`, `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10`, `postgres@3.4.9` with `prepare: false` on the transaction-pooler URL, `vitest@5.0.1`, `pnpm@12.5.1`); the `proxy.ts` auth-placement note; TZ + locale test rules
- `.planning/research/PITFALLS.md` — multi-tenant RLS pitfalls (service-role blindness to grants, `42501` vs `25P02`, `timestamptz`), Clerk claim shape
- `.planning/research/SUMMARY.md` — cross-cutting findings and the phase map
- `docs/IDEA.md` — kickoff brief with the carried-over BIS gotchas

### BIS patterns to port (outside this repo — read-only reference, never modify)
- `C:\Users\danlo\bis-platform\packages\db\supabase\migrations\0001_tenancy.sql` — `app.jwt()` GUC-backed helper (works on Supabase and bare-pg tests), tenancy spine, append-only `events` log
- `C:\Users\danlo\bis-platform\packages\db\src\test\db.ts` — `withRollback` (10 s connect timeout, begin/rollback), `actAs` (sets `request.jwt.claims` + `set local role authenticated`), `actAsOwner`
- `C:\Users\danlo\bis-platform\apps\web\src\lib\db.ts` — `dbForRequest()`: Clerk session token passed as the Supabase bearer; RLS as the backstop
- `C:\Users\danlo\bis-platform\docs\runbooks\clerk-setup.md` — the two "silent failures" (missing claims → zero rows; Supabase not trusting the instance) and the session-token JSON

### External accounts (exist as of 2026-09-21; no secrets in this file)
- Supabase project **`siteless`**, ref `jahgeqshuesndyscnmjo`, us-east-1, org "dlopez2392's Org" (Pro); Clerk registered as third-party auth with domain `https://equipped-newt-5148.clerk.accounts.dev` (ENABLED)
- Clerk application **"Siteless"**, Development instance `ins_3JcNkBxWJb8R3WxRni4a4Aq9TdK`; Organizations enabled; session token customised to `{"org_id":"{{org.id}}","role":"authenticated"}`; sign-in = Email code + Google
- GitHub **`dlopez2392/siteless`** (private, `origin`, `main`)
- Vercel team `team_8zjV46sJxQDsVzikNQa1JaO2` — **Pro (verified)**; the Siteless project is created in this phase
- `.env.local` (gitignored, verified untracked) holds Supabase URL + publishable/anon keys and both Clerk keys; service-role key and direct DB URL still to be fetched from the Supabase dashboard when needed

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No application code exists in this repo yet (only `CLAUDE.md`, `docs/`, `.planning/`).
- From BIS (port, don't import): `withRollback` / `actAs` / `actAsOwner` test fixtures; the `app.jwt()` helper pattern; the `dbForRequest()` shape (Clerk token → RLS-scoped client); the append-only `events` table idea.

### Established Patterns
- BIS proves the Clerk-token-as-Supabase-bearer pattern works with custom claims; Siteless keeps the pattern but adds the token-v2 `o.id` fallback.
- BIS's RLS lesson: service-role fixtures are blind to grants — only a user-role connection with claims sees `42501`. Siteless's suite is user-role by default.
- BIS uses raw SQL migrations via the Supabase CLI; Siteless deliberately diverges to Drizzle (D-09) — do not copy BIS's migration workflow.

### Integration Points
- None yet. Phase 2 (budget governor + presets) and Phase 3 (free-data spine) both build on this phase's `orgs`, `events`, `orgScoped()` helper and the retention-class constraint; agree those shapes here so 2 ∥ 3 can run concurrently.

</code_context>

<specifics>
## Specific Ideas

- "Unstyled shell only" is deliberate (ROADMAP.md Phase 1 note) — resist styling; Phase 2's UI pass establishes the design system on the first real screens.
- The refused-statement test must be **watched failing first** (BIS hard lesson): write the policy after the test is red.
- Keep the same env-var names as BIS so danlo can move between the two repos without re-learning them.

</specifics>

<deferred>
## Deferred Ideas

- **Clerk production instance** (custom domain, no "(dev)" banner) — follow `bis-platform/docs/runbooks/clerk-setup.md` when the product name/domain is bought; not a Phase 1 concern.
- **Soft claim/lock on a lead for a second triager** — Phase 7 (Triage), per FEATURES research §M.
- **Per-org spend ledger key** `(org_id, provider, month)` — Phase 2, but the `orgs` shape decided here must support it.

</deferred>

---

*Phase: 01-foundations-tenancy*
*Context gathered: 2026-09-21*

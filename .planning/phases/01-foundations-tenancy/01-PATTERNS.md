# Phase 1: Foundations & Tenancy - Pattern Map

**Mapped:** 2026-09-21
**Files analyzed:** 42 (all NEW — this repo has zero application code)
**Analogs found:** 31 / 42 (11 have no analog anywhere and must come from RESEARCH.md)

---

## Read This First — Where the Analogs Live

This repo (`C:\Users\danlo\prospector`) contains only `CLAUDE.md`, `docs/` and `.planning/`. Verified: no `package.json`, no `src/`, no `drizzle/`. **There is no in-repo analog for anything.** Patterns come from exactly two sources:

| Source | Status | How the planner treats it |
|---|---|---|
| **BIS repo** — `C:\Users\danlo\bis-platform` | Outside this repo. **READ-ONLY. Never modify, never import, never add as a dependency.** | Port the *shape*, not the file. Every port below names what changes. |
| **RESEARCH.md § Code Examples** — blocks tagged `[VERIFIED: executed …]` | Output from a real PostgreSQL 18.3 run | **Authoritative.** Where a BIS file and a `[VERIFIED]` block disagree, the `[VERIFIED]` block wins. |

### 🔴 Five places BIS is the WRONG pattern (copy these and the phase is wrong)

| BIS does | Siteless must do | Why |
|---|---|---|
| Raw SQL migrations applied by **Supabase CLI** (`supabase db push`, `packages/db/supabase/migrations/NNNN_*.sql`) | **drizzle-kit is the single migration authority** (D-09). Schema + `pgPolicy` in TypeScript; `drizzle/*.sql` is *generated*, and hand-written PL/pgSQL only via `drizzle-kit generate --custom` | Two migration systems against one database is a guaranteed drift bug. **Do not copy BIS's `db:push` script or its migrations directory layout.** BIS has no drizzle dependency at all — verified. |
| Two-level tenancy: `agencies` → `accounts`, policies keyed on `app.is_agency() or account_id = app.current_account_id()` | **Flat**: one `orgs` table, every table carries `org_id`, policies are `org_id = (select app.current_org_id())` (D-01) | BIS's customers have customers. Siteless's customer *is* the agency. Copying `is_agency()` imports a role tier that does not exist here. |
| `app.current_account_id()` reads `app.jwt()->>'org_id'` | `coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')` | Clerk session-token v2 nests org claims under `o`. Verbatim copy returns NULL → zero rows, no error (RESEARCH Pitfall 3). |
| Writes events through a TypeScript helper `emit()` | **Row triggers** (`app.log_event()`, `SECURITY DEFINER`) | D-08 demands enforcement. BIS's own comment records the cost: `emit()` existed as *five byte-identical copies* and a fix reached one of them (`packages/db/src/events.ts:5-13`). A helper cannot pass D-08's acceptance test ("a direct write still produces an event"). |
| Runtime DB access via `supabase-js` with the Clerk token as bearer, connecting through PostgREST | **postgres.js + Drizzle over the transaction pooler**, connecting as a dedicated non-owner `app_user`, claims set with bound `set_config(..., true)` | PostgREST cannot express Phase 3's trigram / `ST_DWithin` / `FOR UPDATE`. `dbForRequest()` is a *shape* analog only — the mechanism is different. |

Sixth, process-level: **BIS shares one Supabase project between e2e and production.** D-04 ends that deliberately. Do not copy `SUPABASE_DB_URL` as the test variable name — the fixture uses `TEST_DATABASE_URL`.

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `package.json` | config | — | `bis-platform/package.json` + `apps/web/package.json` (scripts) | role-match |
| `tsconfig.json`, `next.config.ts`, `eslint.config.mjs` | config | — | BIS `apps/web/*` equivalents | role-match |
| `src/env.ts` | config | boot validation | `bis-platform/apps/web/playwright.config.ts:37-63` (fail-loudly env guard) | partial |
| `drizzle.config.ts` | config | — | **none** (BIS has no drizzle) → RESEARCH Pattern 1 | none |
| `vitest.config.ts` | config / test | — | `bis-platform/apps/web/vitest.config.ts` | role-match |
| `vitest.db.config.ts` | config / test | — | `bis-platform/packages/db/vitest.config.ts` | exact |
| `playwright.config.ts` | config / test | — | `bis-platform/apps/web/playwright.config.ts` | exact |
| `.github/workflows/ci.yml` | config / CI | — | `bis-platform/.github/workflows/ci.yml` | role-match |
| `drizzle/0000_bootstrap.sql` | migration | DDL | `bis-platform/packages/db/supabase/migrations/0001_tenancy.sql:1-12` + `0002_app_schema_grants.sql` | exact |
| `drizzle/0001_tenancy.sql` | migration | DDL | `…/0001_tenancy.sql:15-106` | role-match |
| `drizzle/0002_retention.sql` | migration | DDL | **none** → RESEARCH Pattern 2 / Example 2 | none |
| `drizzle/0003_event_triggers.sql` | migration | event-driven | **none** (BIS is app-tier `emit()`) → RESEARCH Patterns 6 + 7 | none |
| `src/db/schema/_helpers.ts` | model / utility | — | RESEARCH Pattern 1; semantics from `…/0001_tenancy.sql:99-104` | partial |
| `src/db/schema/orgs.ts` | model | CRUD | `…/0001_tenancy.sql:21-30` (`accounts`) | role-match |
| `src/db/schema/users.ts`, `memberships.ts` | model | CRUD | `…/0001_tenancy.sql:32-55` | role-match |
| `src/db/schema/events.ts` | model | append-only | `…/0001_tenancy.sql:58-68, 99-106` | exact |
| `src/db/schema/source-records.ts` | model | CRUD + retention | **none** → RESEARCH Pattern 2 | none |
| `src/db/schema/businesses.ts` | model | CRUD | `…/0001_tenancy.sql` policy shape only; columns are new | partial |
| `src/db/schema/index.ts` | barrel | — | — | n/a |
| `src/db/client.ts` | service | connection | `bis-platform/apps/web/src/lib/db.ts` (doc + `server-only` intent) | partial |
| `src/db/with-org.ts` | service | request-response | `bis-platform/apps/web/src/lib/db.ts` (role) + `packages/db/src/test/db.ts:22-25` (mechanism) | partial |
| `src/proxy.ts` | middleware | request-response | `bis-platform/apps/web/src/middleware.ts` | role-match ⚠ |
| `src/lib/auth/sole-organization.ts` | utility (pure) | — | `bis-platform/apps/web/src/lib/auth/sole-organization.ts` | **exact — verbatim port** |
| `src/components/activate-sole-organization.tsx` | component (client) | event-driven | `bis-platform/apps/web/src/components/activate-sole-organization.tsx` | **exact — verbatim port** |
| `src/lib/auth/require-org.ts` | middleware / guard | request-response | `bis-platform/apps/web/src/lib/auth.ts:7-13, 22-40, 107-119` | role-match |
| `src/app/layout.tsx` | component / layout | — | `bis-platform/apps/web/src/app/(dashboard)/layout.tsx:79-152` | partial ⚠ unstyled |
| `src/app/page.tsx` | component / page | request-response | — | none |
| `src/app/no-access/page.tsx` | component / page | request-response | `bis-platform/apps/web/src/app/(dashboard)/no-access/page.tsx` | partial ⚠ unstyled |
| `src/app/api/health/route.ts` | route handler | request-response | BIS `apps/web/src/app/api/**/route.ts` (shape only) | partial |
| `src/lib/export/registry.ts` | utility / registry | transform | `bis-platform/apps/web/src/lib/automations/registry.ts` (via `sentinel.test.ts:39,146`) | partial |
| `src/lib/export/public-business.ts` | model / type | transform | **none** → RESEARCH Pattern 8 | none |
| `src/lib/time.ts` | utility | transform | `bis-platform/apps/web/src/lib/zone.ts` (call-site discipline) | partial |
| `tests/db/_fixtures.ts` | test fixture | — | `bis-platform/packages/db/src/test/db.ts` | **exact — port + 3 upgrades** |
| `tests/db/rls-isolation.test.ts` | test (DB) | — | `bis-platform/packages/db/src/test/rls.test.ts` + `sites-grants.test.ts:64-82` | exact |
| `tests/db/schema-audit.test.ts` | test (DB) | — | `sites-grants.test.ts:17-29` (information_schema) → RESEARCH Example 4 | partial |
| `tests/db/retention.test.ts` | test (DB) | — | **none** → RESEARCH Example 2 | none |
| `tests/db/events-append-only.test.ts` | test (DB) | — | `rls.test.ts:61-68` ⚠ must be *strengthened* | role-match |
| `tests/db/event-trigger.test.ts` | test (DB) | — | **none** → RESEARCH Example 5 | none |
| `tests/db/time.test.ts` | test (DB) | — | **none** → RESEARCH Example 6 | none |
| `tests/unit/no-internal-leak.test.ts` | test (unit) | — | `bis-platform/apps/web/src/lib/automations/sentinel.test.ts` | role-match |
| `tests/unit/sole-organization.test.ts` | test (unit) | — | `bis-platform/apps/web/src/lib/auth/sole-organization.test.ts` | **exact — verbatim port** |
| `tests/unit/time.test.ts` | test (unit) | — | `bis-platform/apps/web/src/lib/booking/slots.test.ts:59-73` (Intl spy) | exact |
| `tests/e2e/auth.setup.ts` + `*.spec.ts` | test (e2e) | — | `bis-platform/apps/web/e2e/auth.setup.ts:52-82` | role-match |

---

## Pattern Assignments

### `drizzle/0000_bootstrap.sql` (migration, DDL) — `--custom`

**Analog:** `C:\Users\danlo\bis-platform\packages\db\supabase\migrations\0001_tenancy.sql` (lines 1-12, 71-74) and `0002_app_schema_grants.sql` (lines 1-7)

**The `app.jwt()` helper — copy this verbatim** (`0001_tenancy.sql:1-7`). It works identically on Supabase and on bare Postgres, which is exactly what makes the test suite portable:
```sql
create schema if not exists app;

create or replace function app.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
```

**The org resolver — DO NOT copy verbatim.** BIS (`0001_tenancy.sql:71-74`):
```sql
-- ⚠ BIS — returns NULL under a Clerk v2 token. Reference only.
create or replace function app.current_account_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts where clerk_org_id = app.jwt()->>'org_id'
$$;
```
Siteless version (RESEARCH Example 1, `[VERIFIED: executed]` against both claim shapes):
```sql
create or replace function app.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.orgs
   where clerk_org_id = coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')
$$;
```

**The grants that are not optional** — copy `0002_app_schema_grants.sql:1-7` wholesale, including its comment. BIS shipped `0001` without them and every policy raised *"permission denied for schema app"* instead of evaluating:
```sql
grant usage on schema app to authenticated, anon, service_role;
grant execute on all functions in schema app to authenticated, anon, service_role;
alter default privileges in schema app
  grant execute on functions to authenticated, anon, service_role;
```

**New, no BIS analog** (RESEARCH Example 1 + Pattern 3): idempotent `anon`/`authenticated`/`service_role` role creation so a bare Postgres looks like Supabase, plus the `app_user login noinherit` runtime role. Also new: `--> statement-breakpoint` between every statement (Pitfall 8 — a naive `;` splitter cuts `$$ … $$` bodies in half).

---

### `drizzle/0001_tenancy.sql` + `src/db/schema/*.ts` (model, CRUD)

**Analog:** `C:\Users\danlo\bis-platform\packages\db\supabase\migrations\0001_tenancy.sql:15-106`

**Tenant root table** (`:21-30`). Port the columns, drop `agency_id`, keep the `timezone` default:
```sql
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),   -- ⚠ DROP: Siteless is flat (D-01)
  clerk_org_id text not null unique,                        -- ✅ KEEP: the tenancy key
  name text not null,                                       -- ⚠ RENAME: name_internal + display_name (see below)
  timezone text not null default 'America/Chicago',         -- ✅ KEEP
  status text not null default 'active' check (status in ('active','paused','archived')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()             -- ✅ KEEP: timestamptz, always
);
```
🔴 **`accounts.name` is the single column BIS leaked to customers three times.** That is the entire reason D-01/FOUND-04 splits it. Siteless `orgs` carries `name_internal` **and** `display_name`; `businesses` carries `legal_name`, `display_name`, `internal_notes`.

**Append-only events table** (`:58-68`) — port the shape, change `account_id` → `org_id`, add the D-06 columns (`entity_type`, `entity_id`, `action`, `before`, `after`, `occurred_at`):
```sql
create table public.events (
  id bigint generated always as identity primary key,
  account_id uuid references public.accounts(id),
  type text not null,
  actor_type text not null check (actor_type in ('user','system','ai')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_account_created on public.events (account_id, created_at desc);
```

**Immutability is a grant, not a policy** (`:105-106`) — copy the comment too:
```sql
-- append-only: no update/delete policies, and belt-and-suspenders:
revoke update, delete on public.events from authenticated;
```

**Policy shape** (`:99-104`) — BIS's `app.is_agency() or account_id = …` collapses to one clause in Siteless, and the `(select …)` wrapper is *added* (RESEARCH Pitfall 5 — unwrapped, the function re-evaluates per row):
```sql
-- BIS:      using (app.is_agency() or account_id = app.current_account_id())
-- Siteless: using (org_id = (select app.current_org_id()))
```

**Drizzle expression of all of the above:** RESEARCH Pattern 1 (`orgScoped` column spread + `orgPolicies(t)` factory returning four `pgPolicy` calls with `authenticatedRole`). Note `.enableRLS()`, **not** `.withRLS()` — `withRLS` does not exist in drizzle-orm 0.45.2 (RESEARCH § State of the Art, verified from the unpacked package). Every org-scoped table also gets `index('<table>_org_idx').on(t.orgId)`.

---

### `src/db/with-org.ts` (service, request-response)

**Analog for the role it plays:** `C:\Users\danlo\bis-platform\apps\web\src\lib\db.ts` (whole file, 16 lines)
**Analog for the claim mechanics:** `C:\Users\danlo\bis-platform\packages\db\src\test\db.ts:22-25`

**Copy the doctrine, not the implementation.** BIS's `lib/db.ts:4-16` — the comment is the thing worth porting:
```ts
/**
 * The Supabase client for anything a signed-in human can reach.
 *
 * RLS applies. Do NOT reach for serviceDb() on the in-account surface — the
 * database backstop is what turns a missed account scope into zero rows
 * instead of another tenant's data.
 */
export async function dbForRequest(): Promise<SupabaseClient> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new Error("dbForRequest: no Clerk token on this request");
  return userDb(token);
}
```
Three things carry over: (1) **one** request-scoped DB entry point, named; (2) it throws rather than degrading when the token is missing; (3) the doc comment states the RLS-as-backstop rule out loud so the next reader does not reach around it.

What changes: Siteless never hands a token to PostgREST. It opens a transaction on postgres.js and sets the claims itself — the `set_config` call is *identical in form* to BIS's test fixture, which is the point (`packages/db/src/test/db.ts:22-25`):
```ts
export async function actAs(c: Client, claims: { org_id?: string; app_role?: string }) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query("set local role authenticated");
}
```
Siteless's `withOrg()` is that pair, bound, inside `db.transaction()` — full code in RESEARCH Pattern 3. Three non-negotiables it adds, each `[VERIFIED: executed]` in RESEARCH Pitfall 4:
- `set_config(..., **true**)` — the local form. Non-local survives commit and leaks the previous tenant's claims to the next request on a pooled connection.
- The role is **allow-listed against a `Set`**, never interpolated from input. (The Drizzle docs' own Supabase recipe does `sql.raw(JSON.stringify(token))` — that is the injection, do not copy it.)
- The connection is `app_user`, **not** `postgres`. A table owner bypasses RLS; a forgotten `set local role` on an owner connection returns every tenant's rows silently.

---

### `src/proxy.ts` (middleware, request-response) — ⚠ port-with-deletion

**Analog:** `C:\Users\danlo\bis-platform\apps\web\src\middleware.ts` (whole file, 11 lines)

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)"]);   // ⚠ DELETE

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();                  // ⚠ DELETE
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],       // ✅ keep the shape, widen it
};
```

Two corrections the planner must carry:

1. **The authorization lines come out.** `createRouteMatcher` is `@deprecated` in `@clerk/nextjs@7.9.4` itself — *"Move auth checks into each page, layout, API route, or Server Function that accesses protected data."* Siteless's proxy is `export default clerkMiddleware();` and nothing more. Authorization is `requireOrg()` next to the data (CVE-2025-29927 class).
2. 🔴 **The filename and its directory.** Next 16 renamed `middleware.ts` → `proxy.ts`, and it belongs at the **project root or `src/` — level with `app`, never inside `app/`**. CONTEXT.md § Claude's Discretion and STACK.md both say `app/proxy.ts`; both are wrong (RESEARCH Pitfall 7). Placed in `app/` Next never loads it and every `auth()` throws `auth_signature_invalid` — an error whose text points at Clerk config, not at the path.

Matcher to use instead (RESEARCH Pattern 5) — BIS's `.*\\..*` exclusion is too broad for Clerk's handshake routes:
```ts
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
```

---

### `src/lib/auth/sole-organization.ts` (utility, pure) — **verbatim port**

**Analog:** `C:\Users\danlo\bis-platform\apps\web\src\lib\auth\sole-organization.ts` (52 lines — copy the whole file including both doc comments, then adjust the incident references)

```ts
/** One membership, reduced to the only field this decision needs. */
export interface Membership {
  organizationId: string;
}

export function soleOrganizationToActivate(input: {
  signedIn: boolean;
  activeOrgId: string | null | undefined;
  memberships: readonly Membership[];
}): string | null {
  if (!input.signedIn) return null;
  if (input.activeOrgId) return null;
  if (input.memberships.length !== 1) return null;
  return input.memberships[0]!.organizationId;
}
```
Zero dependencies, zero Clerk imports — which is why it is unit-testable and why it ports cleanly. The file's header comment records the real incident (956 Woodworks, 2026-09-16: accepted a valid invitation, signed in, told they had no company) **and** the meta-lesson worth keeping: *"The e2e client fixture has always called `setActive` by hand to get past this… The suite therefore passed while the product was broken — the workaround was in the test rather than in the app."* Keep that paragraph. It is the reason Siteless's e2e must not call `setActive` to make a test green.

---

### `src/components/activate-sole-organization.tsx` (component, client) — **verbatim port**

**Analog:** `C:\Users\danlo\bis-platform\apps\web\src\components\activate-sole-organization.tsx` (63 lines — port whole)

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { soleOrganizationToActivate } from "@/lib/auth/sole-organization";

export function ActivateSoleOrganization() {
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth();
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: true,
  });
  const router = useRouter();
  // Once per mount. `setActive` resolving does not guarantee the next render
  // sees an `orgId` — the session token has to come back first — and without
  // this the effect would fire again on that in-between render and loop.
  const attempted = useRef(false);
  …
      .then(() => { window.location.assign("/"); })   // full navigation, not router.refresh()
```

Three details that are load-bearing and easy to drop in a re-implementation:
- `attempted` ref — without it the effect loops on the in-between render.
- `window.location.assign("/")` rather than `router.refresh()` — the new claim arrives in a **re-issued session cookie**.
- `.catch()` logs and leaves the page alone — a failure here must not replace one confusing screen with a blank one.

Mount it in the root layout, inside `<ClerkProvider>`, above `{children}` — see the layout excerpt below.

---

### `src/lib/auth/require-org.ts` (middleware / guard, request-response)

**Analog:** `C:\Users\danlo\bis-platform\apps\web\src\lib\auth.ts` — three functions, three shapes to copy

**Page/layout guard — redirect, never throw** (`:7-13`):
```ts
export async function requireAgency(): Promise<{ userId: string }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const claims = sessionClaims as AppClaims;
  if (claims.app_role !== "agency_admin") redirect("/");
  return { userId };
}
```

**The `/no-access` routing decision with a `reason`** (`:31-34`) — Siteless keeps the redirect + reason idea, drops the client-access flag:
```ts
  if (!claims.org_id) redirect("/no-access?reason=none");
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account) redirect("/no-access?reason=none");
  if (!account.client_access_enabled) redirect("/no-access?reason=off");
```

**Route-handler variant returns null instead of redirecting** (`:100-119`) — copy this split and its comment: *"never 403/401 with substance: don't confirm to a wrong-tenant caller that the resource exists."*

Siteless's version (RESEARCH Pattern 3) reads `orgId` from `auth()` directly rather than from `sessionClaims`, and is the *only* place org identity enters the system:
```ts
export async function requireOrg() {
  const { userId, orgId } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/no-access');       // D-02, and RESEARCH Pitfall 2
  return { userId, orgId };
}
```
⚠ Siteless must **not** copy BIS's `serviceDb()` usage here. BIS uses the service role in the guard deliberately (it runs before the caller is trusted) and its own `lib/zone.ts:25-48` carries a 24-line argued exception for doing so again. Siteless has no service-role key in this phase and should not acquire one (RESEARCH § Security Domain).

---

### `src/app/layout.tsx` (component / layout) — ⚠ strip to the two lines that matter

**Analog:** `C:\Users\danlo\bis-platform\apps\web\src\app\(dashboard)\layout.tsx:107-152`

BIS's layout is 153 lines of fonts, theme derivation, tenant branding and portal-surface reasoning. **Phase 1 is an unstyled shell (ROADMAP note) — take the skeleton and nothing else:**
```tsx
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning className="h-full antialiased">
        <body suppressHydrationWarning className="min-h-full flex flex-col">
          {/* Renders nothing. Inside ClerkProvider and above every page, so
              it covers each surface a client can reach signed-in but with no
              active organization — /, /no-access and /sign-in — instead of
              only whichever one someone remembered. */}
          <ActivateSoleOrganization />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
```
The comment at `:139-144` is the placement rationale and should survive the port. Everything else — `next/font`, `ThemeProvider`, `Toaster`, `deriveTheme`, `themeStyle`, `data-tenant-theme` — is Phase 2's `/gsd-ui-phase` and must **not** appear in Phase 1.

---

### `src/app/no-access/page.tsx` (component / page) — ⚠ structure only

**Analog:** `C:\Users\danlo\bis-platform\apps\web\src\app\(dashboard)\no-access\page.tsx` (36 lines)

Take three things: the `searchParams: Promise<{ reason?: string }>` signature with `await searchParams` (Next 16), the two-message branch on `reason`, and `<SignOutButton>` as the only affordance:
```tsx
import { SignOutButton } from "@clerk/nextjs";

export default async function NoAccess({
  searchParams,
}: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  …
        <SignOutButton>…</SignOutButton>
```
Leave behind: `AuthShell`, `Button`, `lucide-react`, the `m[...]` message catalogue, and every class name. Plain HTML in Phase 1.

---

### `tests/db/_fixtures.ts` (test fixture) — **port + three named upgrades**

**Analog:** `C:\Users\danlo\bis-platform\packages\db\src\test\db.ts` (whole file, 29 lines)

```ts
import { Client } from "pg";
import "dotenv/config";

export async function withRollback(fn: (c: Client) => Promise<void>) {
  // Ten seconds, not pg's default of "forever": an unreachable host (the
  // direct db.<ref>.supabase.co address is IPv6-only, and GitHub-hosted
  // runners have no IPv6) otherwise hangs every test here to vitest's 60s
  // ceiling and the suite reports a wall of timeouts instead of one
  // connection error naming the cause. CI uses the Session-pooler URL.
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  await c.connect();
  try {
    await c.query("begin");
    await fn(c);
  } finally {
    await c.query("rollback");
    await c.end();
  }
}

/** Simulate an RLS caller. Claims mirror Clerk session-token custom claims. */
export async function actAs(c: Client, claims: { org_id?: string; app_role?: string }) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query("set local role authenticated");
}

export async function actAsOwner(c: Client) {
  await c.query("reset role");
}
```
Keep the 10-second timeout **and its comment** verbatim — it is a recorded BIS cost. Keep `begin`/`rollback` in `try`/`finally` (BIS still sweeps orphan `Fixture Co` rows from a helper that lost this property).

Upgrades, each earned (RESEARCH Pattern 4):
1. `process.env.TEST_DATABASE_URL`, **not** `SUPABASE_DB_URL` — D-04 forbids testing against production, and a separate name makes the mistake a typo you can see.
2. `Claims` becomes a **union** of the v1 flat shape and the v2 nested `{ o: { id } }` shape, so every test author must pick one and the suite exercises both (D-11).
3. Add `seedTwoOrgs(c)` — modelled on BIS's `seedTwoAccounts` (`rls.test.ts:9-19`) minus the agency lookup. Pitfall 13: with one org, every RLS bug is invisible.

---

### `tests/db/rls-isolation.test.ts` (test, DB integration)

**Analogs:** `C:\Users\danlo\bis-platform\packages\db\src\test\rls.test.ts` (structure) and `sites-grants.test.ts:64-82` (the SQLSTATE pin — **this is the better of the two**)

**Seed-two-tenants helper** (`rls.test.ts:9-19`):
```ts
async function seedTwoAccounts(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_A','Alpha',true) returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_B','Bravo',true) returning id", [agency.id]);
  …
  return { a: a.id as string, b: b.id as string };
}
```

**Isolation assertion shape** (`rls.test.ts:22-39`):
```ts
  it("account member sees only their own account", () =>
    withRollback(async (c) => {
      await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query("select clerk_org_id from accounts");
      expect(rows.map((r: any) => r.clerk_org_id)).toEqual(["org_A"]);
    }));
```

🔴 **Copy the refusal assertion from `sites-grants.test.ts:64-73`, not from `rls.test.ts:38`.** `rls.test.ts` asserts `.rejects.toThrow(/row-level security/)` — a message match, which a policy rename or a Postgres upgrade silently loosens. The newer file pins the code *and* documents the one-refusal-per-transaction rule:
```ts
  // One refused statement per transaction (a refusal aborts it; the next
  // statement reports 25P02, not its own reason).
  it("a client cannot INSERT a site, and the refusal is insufficient_privilege (42501)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoSites(c);
      await actAs(c, { org_id: "org_SITE_A" });
      await expect(
        c.query("insert into sites (account_id, vercel_project_id, domain) values ($1,'prj_X','x.example')", [a]),
      ).rejects.toMatchObject({ code: "42501" });
    }));
```

🔴 **The one thing no BIS test knows** (RESEARCH Pitfall 1, `[VERIFIED: executed]`): under RLS a cross-org `SELECT`/`UPDATE`/`DELETE` is **filtered to zero rows, not refused**. Only an `INSERT` carrying a foreign `org_id` (or an `UPDATE` that moves `org_id`) raises `42501`. Criterion 2 therefore needs **both** halves:
```ts
// the refusal half
await expect(
  c.query('insert into businesses (org_id, display_name) values ($1,$2)', [b, 'pwned'])
).rejects.toMatchObject({ code: '42501' });

// the filtered half — separate test, separate transaction
expect(res.rowCount).toBe(0);            // cross-org UPDATE
expect(rows).toHaveLength(0);            // cross-org SELECT
```
Pin `code` **and** match the message: `42501` covers both "new row violates row-level security policy" and "permission denied for table" (a grant refusal), and the events tests depend on telling them apart.

**Watched-failing-first, as a plan step** (RESEARCH Example 3): write this test while the table has `using (true)` or no policy, run `pnpm test:db -t "42501"`, paste the red output into the task's verification notes, *then* add the policy. 🔴 **Read the failing test NAME** — a `-t` filter matching nothing exits green (recorded BIS lesson).

**Mutation-check comment header** — `sites-grants.test.ts:4-12` does this and it should become the house style:
```ts
/**
 * … Mutation: drop the `revoke insert, update, delete …` line for `sites` in
 * 0029 — the first test's row list grows past SELECT.
 */
```

---

### `tests/db/schema-audit.test.ts` (test, DB — D-10)

**Analog for the query style:** `sites-grants.test.ts:17-29` (enumerates `information_schema.role_table_grants` and asserts an exact array)
```ts
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1
            and grantee in ('authenticated', 'anon')
          order by grantee, privilege_type`, [table]);
      expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
```
**The Phase-1 version is `pg_class` / `pg_policy`, not `information_schema`** — RESEARCH Example 4 (`[VERIFIED: executed]`), which returns `{table_name, rls_enabled, has_org_id, policy_count}` in one query and filters to `bad`, asserting `expect(bad).toEqual([])`. Keep the allow-list as a **`Set` literal inside the test file** (`['orgs','users','__drizzle_migrations']`) so adding to it is a diff a reviewer sees.

---

### `tests/db/events-append-only.test.ts` (test, DB) — ⚠ analog must be strengthened

**Analog:** `rls.test.ts:61-68`
```ts
  it("events are append-only even for agency", () =>
    withRollback(async (c) => {
      const ids = await seedTwoAccounts(c);
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query("update events set type='hacked'")).rejects.toThrow();
      await expect(c.query("delete from events")).rejects.toThrow();
      void ids; void actAsOwner;
    }));
```
Two defects to fix in the port: (1) `.rejects.toThrow()` with no argument passes on *any* error including a typo in the SQL — pin `{ code: '42501' }` and assert the message contains `permission denied for table events` (RESEARCH Pattern 6 notes the message differs from the RLS refusal, and that difference is the proof it is a grant and not a policy); (2) **two refusals in one `withRollback`** — the second reports `25P02`, not its own reason. Split into two transactions.

---

### `tests/unit/no-internal-leak.test.ts` (test, unit — FOUND-04)

**Analog:** `C:\Users\danlo\bis-platform\apps\web\src\lib\automations\sentinel.test.ts` — the closest thing either repo has to FOUND-04, and it exists for the identical reason

Its header (`:1-15`) is the requirement restated:
```ts
/**
 * THE SENTINEL. `accounts.name` is the agency's internal label for a company
 * ("Rio Roofing — trial") and it has reached customers three times. Every
 * registered pass is run here and every argument of every send — email and
 * SMS, plus the SMS message row — is scanned for it.
 * …
 * Mutation: in passes/reminders.ts send `INTERNAL_LABEL` as `fromName`.
 */
```

The scan itself (`:139-142`) — four moves to copy exactly:
```ts
    // Guard the fixture: every pass actually sent, so the scan has teeth.
    expect(results.reminders?.sent).toBe(1);
    …
    const everything = [...emailSend.mock.calls, ...smsSend.mock.calls, ...dbMocks.createMessage.mock.calls]
      .map((args) => JSON.stringify(args)).join("\n");
    expect(everything).not.toContain("— trial");
    expect(everything).not.toContain(INTERNAL_LABEL);
    expect(everything).toContain(BRAND);   // and the brand name DID go out, in its place
```
1. **Guard the fixture first** — assert every builder actually produced output, or the negative scan is vacuous.
2. `JSON.stringify` the *whole* payload and scan the string, not the typed fields.
3. Assert a **distinctive substring** of the internal value as well as the whole thing.
4. Assert the *correct* value **did** go out — a scan that only proves absence passes when everything is broken.

⚠ **One half of BIS's harness is weaker than Siteless needs.** Its registry pin is a hard-coded list (`:146`):
```ts
    expect(PASSES.map((p) => p.key)).toEqual(["reminders", "followups", "reviewRequests", …]);
```
That catches a reorder; it does **not** catch a new builder file nobody registered. RESEARCH Pattern 8 upgrades it to a `readdirSync('src/lib/export')` enumeration asserting every module appears in `PAYLOAD_BUILDERS` — so "I forgot the sentinel" is unreachable. Use the upgraded form; the empty `PAYLOAD_BUILDERS: []` must exist in Phase 1 so the harness is real from day one.

---

### `tests/unit/time.test.ts` + `src/lib/time.ts` (utility + test — FOUND-06)

**Analog for the spy:** `C:\Users\danlo\bis-platform\apps\web\src\lib\booking\slots.test.ts:59-73`
```ts
  it("pins timeZone on every Intl call — the system zone must never leak in", async () => {
    // … module-level formatter cache means a warm import would make the
    // ">0" assertion vacuous. Force a cold cache by loading fresh.
    vi.resetModules();
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    const fresh = await import("./slots");
    fresh.computeSlots(CFG, [], NOW);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect((call[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone).toBe(CFG.timezone);
    }
  });
```
Copy all four moves: `vi.resetModules()` against a memoized formatter, spy the **constructor**, assert the call count is `> 0` *before* asserting the options (otherwise zero calls passes vacuously), and loop over **every** call. Siteless adds one assertion BIS omits — pin the **locale** too: `expect(spy.mock.calls[0]?.[0]).toBe('en-US')` (recorded hard lesson: an unpinned `es-*` locale causes an SSR hydration mismatch).

**Analog for the boundary fixtures:** `apps/web/src/lib/dashboard/day-label.test.ts:1-10` — its header explains *why* each fixture exists (month boundary, year boundary, leap day) rather than listing dates. Siteless's discriminating pair is RESEARCH Example 6 (`[VERIFIED: executed]`): `2026-09-21T01:00:00.000Z` → `2026-09-21` in UTC, `2026-09-20` in `America/Chicago`. One instant, two zones, opposite verdicts — Chicago only ever as half a pair.

🔴 **`vitest.config.ts` must set the zone on line 1 of the config file, in the main process** — `test.env.TZ` does not work in the `threads` pool (Node worker threads lock `Intl`'s zone at creation), and `TZ=x pnpm test` does nothing in PowerShell. Pin it to **`UTC`, deliberately not Chicago**: this dev machine *is* Chicago, so a Chicago-pinned suite cannot discriminate (RESEARCH Pitfall 6). Add the self-check test: `expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')`.

For `src/lib/time.ts` the discipline to port from `apps/web/src/lib/zone.ts` is *one* exported constant and one resolver that every call site goes through — BIS's file documents what happens otherwise: *"Five screens each grew their own answer… four clamped silently to UTC, the work queue omitted the date, and the account dashboard did BOTH, fifty lines apart."* Siteless: `export const APP_TZ = 'America/Chicago'` plus explicit-zone formatters, and never `toLocaleString()` with one argument.

---

### `vitest.db.config.ts` / `vitest.config.ts` (config, test)

**Analog:** `C:\Users\danlo\bis-platform\packages\db\vitest.config.ts` (23 lines) and `apps/web/vitest.config.ts` (30 lines)

```ts
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test/global-setup.ts"],
    exclude: [… "src/**/*.integration.test.ts"],
    // 20s left no headroom under contention, so the gate was failing on wall
    // clock (`Test timed out in 20000ms`) rather than on behaviour — and
    // which file lost the race moved between runs.
    testTimeout: 60000,
  },
});
```
Port: the two-config split (unit vs DB), a raised `testTimeout` for the DB suite, and the `resolve.alias` `@ → ./src` from the web config. **Do not port `globalSetup`'s fixture sweep** — that exists because BIS's suite shares a project with production; D-04 removes the need. Add instead (RESEARCH § Test Framework): `--pool=forks --poolOptions.forks.singleFork` for the DB suite, since `withRollback` opens a real connection per test and serial execution is what makes a rollback failure attributable.

---

### `playwright.config.ts` + `tests/e2e/auth.setup.ts` (config + test, e2e)

**Analog:** `C:\Users\danlo\bis-platform\apps\web\playwright.config.ts` and `apps\web\e2e\auth.setup.ts`

**Config skeleton** (`playwright.config.ts:95-147`):
```ts
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  expect: { timeout: 10_000 },
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, teardown: "teardown" },
    { name: "teardown", testMatch: /auth\.teardown\.ts/ },
    { name: "chromium", testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"] },
  ],
  webServer: { command: USE_DEV_SERVER ? "pnpm dev" : "pnpm build && pnpm start", … },
});
```
Note `E2E_BASE_URL` — criterion 1 runs this suite against the **deployed Vercel URL**, which this override already supports.

**The fail-loudly env preamble** (`:37-63`) is worth more than the config. Copy the mechanism: a `REQUIRED_ENV` list checked against `process.env` **or** a parsed `.env.local`, throwing before a single test runs, with an error naming each missing variable. Its comment records the exact cost: a missing `NEXT_PUBLIC_SUPABASE_ANON_KEY` made every in-account page 500, which read on screen as an empty table, and the conclusion drawn was *"main is red and the e2e gate is untrustworthy"*. The same mechanism is the model for `src/env.ts` (zod-parsed, throws at boot).

**Sign-in without a password** (`e2e/auth.setup.ts:52-82`):
```ts
setup("authenticate as agency_admin", async ({ page }) => {
  await clerkSetup();
  const email = process.env.E2E_ADMIN_EMAIL ?? "danlopez508@gmail.com";
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
  …
  await page.context().storageState({ path: AUTH_FILE });
});
```
Uses `@clerk/testing/playwright` with a Backend-API-minted sign-in token — no password, no email code, no user created or modified. Siteless needs exactly this (its Clerk instance is Email-code + Google, so there is no password to type).

🔴 **Do not port the org-selection workaround** at `:60-76`, and do not port the client fixture's `window.Clerk.setActive()` at `:243-249`. That is the workaround-in-the-test that `sole-organization.ts`'s own header names as the reason BIS's suite stayed green while the product was broken. If a Siteless e2e run lands on `/no-access`, the fix is `ActivateSoleOrganization` in the app, not `setActive` in the setup.

---

### `.github/workflows/ci.yml` (config, CI)

**Analog:** `C:\Users\danlo\bis-platform\.github\workflows\ci.yml` (257 lines)

**Port the secrets guard verbatim** (`:128-139`) — a gate that quietly skips when it cannot run is how the pre-CI state came about:
```yaml
      - name: Check that the repository secrets are configured
        run: |
          missing=""
          for name in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY …; do
            if [ -z "${!name}" ]; then missing="$missing $name"; fi
          done
          if [ -n "$missing" ]; then
            echo "::error::Missing repository secret(s):$missing — …"
            exit 1
          fi
```

**Port the setup order** (`:141-148`) — `pnpm/action-setup` **before** `setup-node`, `cache: pnpm`, and `pnpm install --frozen-lockfile` (never `npm ci`, which is a documented repeated failure from a Windows-authored lockfile):
```yaml
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
```
⚠ Two corrections: `node-version: 24` (STACK pins Node 24 LTS; vitest 5 wants `@types/node >= 24`), and **`actions/setup-node@v4`, not `v5`** — v5 auto-caches when `packageManager` is present in `package.json` and collides with `pnpm/action-setup`'s own caching (RESEARCH Pitfall 9). Siteless *will* have `"packageManager": "pnpm@12.5.1"`; BIS's `@v5` works because its risk profile differs. Also port `actions/upload-artifact@v4` with `if: failure()` for Playwright traces (`:229-237`).

**Do not port the concurrency block** (`:66-125`, ~60 lines of comments). Its entire premise — *"pnpm check runs 423 live tests against the one Supabase project that also serves production"* — is the problem D-04 eliminates. Siteless's `db` job runs against a `postgres:18` **service container**, so there is nothing to serialize. Use RESEARCH Example 7's three-job shape (`verify`, `db`, `e2e`) with:
```yaml
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
```

**`package.json` scripts** — BIS's root/`apps/web` split maps onto a single-package repo:
```jsonc
// BIS root:            "check": "pnpm typecheck && pnpm lint && pnpm test"
// BIS apps/web:        "typecheck": "tsc --noEmit", "test": "vitest run", "test:e2e": "playwright test"
// Siteless (RESEARCH § Test Framework):
"verify":    "pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db",
"test:unit": "vitest run tests/unit",
"test:db":   "vitest run --config vitest.db.config.ts --pool=forks --poolOptions.forks.singleFork",
"db:migrate":"drizzle-kit migrate"     // ⚠ NOT BIS's "db:push": "supabase db push …"
```

---

## Shared Patterns

### Shared Pattern A — SQLSTATE pinning in every DB test
**Source:** `C:\Users\danlo\bis-platform\packages\db\src\test\sites-grants.test.ts:64-82`
**Apply to:** `tests/db/rls-isolation.test.ts`, `retention.test.ts`, `events-append-only.test.ts`, `event-trigger.test.ts`
```ts
  // One refused statement per transaction (a refusal aborts it; the next
  // statement reports 25P02, not its own reason).
  await expect(c.query(…)).rejects.toMatchObject({ code: "42501" });
```
**Per-file code table** (RESEARCH Examples 2-3, all `[VERIFIED: executed]`) — these differ, and using `42501` everywhere is wrong:

| Test | Code | Constraint / message |
|---|---|---|
| Cross-org INSERT (FOUND-02) | `42501` | `new row violates row-level security policy` |
| Second statement in the same aborted tx | `25P02` | `current transaction is aborted…` |
| `update`/`delete` on `events` (FOUND-03) | `42501` | `permission denied for table events` — a **grant**, different message |
| Google Places content marked durable (FOUND-05) | **`23514`** | `sr_google_is_ephemeral` |
| `ephemeral` with no `expires_at` (FOUND-05) | **`23514`** | `sr_ephemeral_has_expiry` |
| Durable field citing an ephemeral source (FOUND-05) | **`23503`** | `businesses_*_src_fk` |
| Connection that skipped `set local role` | `42501` | `permission denied for table …` |

Assert the **constraint name** as well as the code where one exists — the name is the thing a future migration can rename out from under the test.

### Shared Pattern B — `withRollback` wraps every DB test, one refusal per transaction
**Source:** `C:\Users\danlo\bis-platform\packages\db\src\test\db.ts:4-19`
**Apply to:** every file under `tests/db/`
`begin`/`rollback` in `try`/`finally`, parallel-safe, leaves nothing behind when a run is killed. Never truncate-between-tests. **One refused statement per rolled-back transaction** — a refusal aborts the tx and the next statement reports `25P02`. Split refusals across tests.

### Shared Pattern C — the doc comment carries the incident
**Source:** every BIS file read for this map
BIS's convention, and it should be Siteless's: when a line exists because something broke, the comment says what broke, when, and what it cost — `db.ts:5-9` (IPv6 / 10s timeout), `sole-organization.ts:1-19` (956 Woodworks, 2026-09-16), `sentinel.test.ts:1-15` (three leaks of `accounts.name`), `0002_app_schema_grants.sql:1-3` (permission denied for schema app), `vitest.config.ts:14-21` (wall-clock timeouts under contention). Each also names its **mutation**: *"Mutation: drop the `revoke insert, update, delete …` line — the first test's row list grows past SELECT."* That line is what makes the phase-gate mutation check mechanical instead of inventive.

### Shared Pattern D — deny by default, redirect not 403
**Source:** `C:\Users\danlo\bis-platform\apps\web\src\lib\auth.ts:35-37, 100-106`
**Apply to:** `src/lib/auth/require-org.ts`, `src/app/**`, `src/app/api/health/route.ts`
Pages redirect; route handlers return null and the caller answers 404. *"Never 403/401 with substance: don't confirm to a wrong-tenant caller that the resource exists."*

### Shared Pattern E — `import 'server-only'` on anything holding a connection or a secret
**Apply to:** `src/db/client.ts`, `src/db/with-org.ts`, `src/lib/auth/require-org.ts`
Recorded BIS lesson (2 occurrences): a `"use client"` module's exports become client *references* inside a server component — even plain data objects — yielding `undefined` at runtime with typecheck, lint and build all green. Mark the server-only modules explicitly. Only `NEXT_PUBLIC_*` may cross the boundary.

### Shared Pattern F — `timestamptz`, no exceptions
**Source:** `C:\Users\danlo\bis-platform\packages\db\supabase\migrations\0001_tenancy.sql:18, 29, 37, 48, 65`
Every BIS table's `created_at` is `timestamptz not null default now()`. Siteless extends it to `updated_at`/`updated_by` on every mutable table (D-07) and adds the enumeration test (`information_schema.columns.data_type`) so a future phase cannot slip a naked `timestamp` in. In Drizzle: `timestamp('created_at', { withTimezone: true, mode: 'date' })` — `mode: 'date'` returns a JS `Date` (one instant); `mode: 'string'` hands back a session-zone-dependent string, which is how "it looked right locally" happens.

---

## No Analog Found

These have no match in BIS or anywhere else. The planner must build them from RESEARCH.md, and every one of them is new *because it is a Siteless-specific guarantee BIS never made*.

| File | Role | Data Flow | Reason | Build from |
|---|---|---|---|---|
| `drizzle.config.ts` | config | — | BIS has no drizzle dependency (verified) | RESEARCH Pattern 1 (`entities.roles.provider: 'supabase'`, session-pooler URL) |
| `drizzle/0002_retention.sql` | migration | DDL | No retention class exists in BIS; this is a legal constraint unique to Siteless (FOUND-05) | RESEARCH Pattern 2 + Example 2 `[VERIFIED]` |
| `drizzle/0003_event_triggers.sql` | migration | event-driven | BIS logs events from the **application tier** (`emit()`), which is the pattern D-08 rejects | RESEARCH Patterns 6 + 7, Example 5 `[VERIFIED]` |
| `src/db/schema/source-records.ts` | model | CRUD | New table; `retention_class` + `expires_at` + the `unique (id, retention_class)` FK target | RESEARCH Pattern 2 |
| `src/db/schema/_helpers.ts` | utility | — | Drizzle idiom (spread-able column object + policy factory); no TS schema exists in BIS at all | RESEARCH Pattern 1 |
| `src/lib/export/public-business.ts` | model / type | transform | `Omit<Business, 'internalNotes' \| 'nameInternal'>` — BIS never built the type-level half | RESEARCH Pattern 8 |
| `src/app/page.tsx` | component | request-response | "signed in as X in org Y", unstyled — BIS's landing is a styled dashboard router | CONTEXT § Claude's Discretion |
| `src/app/api/health/route.ts` | route handler | request-response | BIS has no health route; this is criterion 1's smoke target | RESEARCH Pitfall 7 (`{ ok, orgId: <boolean>, db }`) |
| `tests/db/retention.test.ts` | test | — | Pins `23514` / `23503`, codes no BIS test uses | RESEARCH Example 2 |
| `tests/db/event-trigger.test.ts` | test | — | D-08's "a direct write still produces an event" — impossible to write against a helper | RESEARCH Example 5 |
| `tests/db/time.test.ts` | test | — | `(created_at at time zone 'America/Chicago')::date` discriminating pair in SQL | RESEARCH Example 6 |

Also **no analog for the JIT `orgs` provisioning function** `app.ensure_org(text, text)` (D-03) — BIS creates accounts through an agency-admin server action, never just-in-time from a claim. RESEARCH Pattern 5 has the full `SECURITY DEFINER` body, including the `p_clerk_org_id is distinct from v_claim → raise … using errcode = '42501'` check that stops a caller provisioning someone else's org. Its `set search_path = public` is mandatory (ASVS V4).

---

## Open Items the Planner Inherits (not pattern questions, but they gate Wave 0)

1. 🔴 **The test database is undecided.** Docker Desktop and WSL are both absent from this machine (verified), so D-04 as written cannot run and D-05's paid fallback is formally triggered. RESEARCH recommends a third option — native PostgreSQL 18 + the bootstrap migration CI needs anyway, $0, dev byte-identical to CI. **This changes a locked decision's implementation and needs danlo's yes/no before planning.** Whatever is chosen, `TEST_DATABASE_URL` never points at `jahgeqshuesndyscnmjo`.
2. `proxy.ts` placement contradicts CONTEXT.md § Claude's Discretion and STACK.md, both of which say `app/proxy.ts`. CONTEXT.md carries the correction inline; STACK.md does not. **Root or `src/`, level with `app`.**
3. Criterion 2's wording ("a statement … is refused") is satisfied by the INSERT half only; the UPDATE/DELETE half is `rowCount: 0`. Both are required (D-11a).

---

## Metadata

**Analog search scope:**
- `C:\Users\danlo\prospector\**` — confirmed empty of application code
- `C:\Users\danlo\bis-platform\packages\db\supabase\migrations\` (34 files; read `0001`, `0002`)
- `C:\Users\danlo\bis-platform\packages\db\src\test\` (48 files; read `db.ts`, `rls.test.ts`, `sites-grants.test.ts`, `vitest.config.ts`)
- `C:\Users\danlo\bis-platform\apps\web\src\lib\` (read `db.ts`, `auth.ts`, `auth/sole-organization.ts`, `auth/sole-organization.test.ts`, `zone.ts`, `automations/sentinel.test.ts`, `booking/slots.test.ts`, `dashboard/day-label.test.ts`)
- `C:\Users\danlo\bis-platform\apps\web\src\app\` (read `(dashboard)/layout.tsx`, `(dashboard)/no-access/page.tsx`)
- `C:\Users\danlo\bis-platform\apps\web\` (read `middleware.ts`, `vitest.config.ts`, `playwright.config.ts`, `e2e/auth.setup.ts`, `package.json`)
- `C:\Users\danlo\bis-platform\.github\workflows\ci.yml`

**Files scanned:** 21 BIS source files read in full or in targeted ranges; ~140 enumerated
**Verified read-only:** no file outside `.planning/phases/01-foundations-tenancy/` was modified
**Pattern extraction date:** 2026-09-21

---

*Phase: 01-foundations-tenancy*

# Siteless Conventions

The schema and process contract Phases 2 and 3 read **instead of re-deriving**. Written in
Phase 1 plan 09 from `src/db/schema/*.ts` and the applied migrations `drizzle/0000`–`0007`,
cross-checked against `information_schema.columns` on the live test database — not from
memory.

Anything here that later changes changes **here first**. Phases 2 and 3 are planned to run
concurrently on these shapes; a shape re-derived in one of them is a merge conflict with
teeth.

---

## Tenancy

One Siteless tenant is one Clerk **organization** (D-01 — flat, no agency tier above it).

- Every table carries `org_id uuid not null references orgs(id)` **except `orgs` itself**,
  which is the tenant root and keys on its own `id`.
- Every org-scoped table gets `...orgPolicies('<table>')` and `index('<table>_org_idx').on(t.orgId)`
  in the **same migration that creates it**. Not in a follow-up: the D-10 enumeration
  (`tests/db/schema-audit.test.ts`) reads the live database and fails otherwise, and a table
  must never exist un-scoped even for one commit.
- An RLS predicate on `org_id` gets **no index for free**. The `_org_idx` is not optional.
- `orgPolicies(t)` (in `src/db/schema/_helpers.ts`) emits four policies — `<t>_select`,
  `<t>_insert`, `<t>_update`, `<t>_delete` — all `to authenticatedRole`.
- Adding any `pgPolicy` **auto-enables RLS** in drizzle-orm 0.45.2. Never also call
  `.enableRLS()`; `.withRLS()` does not exist in this version.
- `orgs` deliberately has **no INSERT policy** for `authenticated`. The only creation path is
  the `SECURITY DEFINER` function `app.ensure_org(text, text)`, so `authenticated` never
  holds blanket INSERT on the tenant root (T-1-23).

## Claims

Org identity comes **only** from Clerk's server-verified `auth()`. Never from a header, a
query parameter, a cookie the client can write, or a request body.

In SQL the org claim is
`coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')` — Clerk session token v2 nests org
claims under `o` and only while an organization is ACTIVE, while v1 is flat; danlo's instance
emits both today, so both shapes are resolved and both are exercised by the suite (D-11).

That coalesce lives in `app.current_org_id()`, and every policy calls it wrapped:

```sql
org_id = (select app.current_org_id())
```

The `(select …)` is load-bearing. Wrapped, Postgres runs it as an **InitPlan** once per
statement; unwrapped it is re-evaluated once per row.

The actor is `app.jwt()->>'sub'`, falling back to the `app.actor_id` GUC (for workers and
ETL, which have no Clerk session) and then to the literal `'system'`. A client can set
neither GUC.

## Database access

`withOrg()` in `src/db/with-org.ts` is **the** runtime entry point. Everything a request
touches goes through it.

- The single exception is `/api/health`'s `select 1`, which needs no claims and reads no
  table.
- The claims are a **bound parameter**, never interpolated into the statement text (T-1-05).
- `set_config('request.jwt.claims', $1, true)` — the third argument is `true`, the
  transaction-**LOCAL** form. The non-local form survives the COMMIT, and on a
  transaction-mode pooler the connection is handed to the next request with the previous
  tenant's claims still set (T-1-04).
- The runtime connects as **`app_user`**: `NOINHERIT`, owns nothing. It holds `authenticated`
  but does not use those privileges until it explicitly `set local role`s, so a code path
  that forgets the wrapper raises `42501` instead of silently reading every tenant. A table
  **owner bypasses RLS**, which is why the runtime is never the owner.
- Migrations connect as the owner, through `scripts/db.ts` — the single gate that decides
  which database any migration reaches (`--target=test` refuses a Supabase host; `--target=prod`
  demands the session pooler on port 5432).

## Migrations

**drizzle-kit is the single migration authority (D-09).** Two migration systems against one
database is a guaranteed drift bug.

- Generated SQL is committed and **never hand-edited**. drizzle-kit hashes the SQL text; an
  applied migration file that changes is a broken checksum.
- Hand-written PL/pgSQL, grants, triggers and table-level constraints go through
  `pnpm db:custom --name=<name>` (`generate --custom`), with an explicit
  `--> statement-breakpoint` between **every** statement and each function body kept as one
  statement. A naive splitter otherwise cuts a `$$ … $$` body on its first internal `;`.
- The `meta/NNNN_snapshot.json` that `generate` writes is committed alongside the `.sql`.
  It is the diff base for the next `generate`; omitting it makes drizzle-kit re-emit
  everything.
- After any schema change, `pnpm db:generate` must report **no drift**. Triggers, functions
  and grants are not in the Drizzle TS schema, so drizzle-kit must not try to remove them.
- **No Supabase CLI migrations. No MCP `apply_migration`.** The Supabase CLI is installed for
  `supabase start` only.

## Audit and attribution

The audit trail is **enforced, not conventional** (D-06 + D-08). A raw SQL write that no
application code made still produces an `events` row with an actor and a timestamp, because
the mechanism is an `AFTER … FOR EACH ROW` trigger and not a write helper. BIS logged events
from the application tier through `emit()`, which existed as five byte-identical copies, and
a fix reached exactly one of them.

**The event-scope boundary — DECIDED, do not re-derive (resolves RESEARCH assumption A7):**

| Function | Timing | Attached to |
|---|---|---|
| `app.log_event()` | `after insert or update or delete … for each row` | `orgs`, `businesses` |
| `app.touch_updated_at()` | `before update … for each row` | `orgs`, `businesses`, `source_records` |

- **Row-level `log_event` triggers go on state-bearing tables only.** Phase 7 adds `leads`.
- **`source_records` is deliberately excluded from `log_event`.** Phase 3 loads ~10k
  Comptroller and Overture rows per run; a row trigger there would write 10k event rows each
  carrying a full `before`/`after` payload of the source document. **Bulk ingest writes ONE
  run-level event per run instead.** Phase 3 must honour this rather than re-derive it.
- Adding a state-bearing table means adding it to `EVENT_LOGGED` in
  `tests/db/event-trigger.test.ts` — a `Set` literal in the test file, never a config file, so
  widening it is a diff a reviewer sees. The enumeration asserts set equality in **both**
  directions and asserts each trigger is **enabled** (`tgenabled`), because
  `alter table … disable trigger` leaves the `pg_trigger` row in place and a row-counting
  enumeration would report full coverage while attribution was silently off.
- `app.touch_updated_at()` goes on **every mutable table**, and it must be `before update`.
  An `after` attachment recurses — it mutates `NEW` and returns it.
- `events` is **immutable by GRANT, not by policy**: `grant select, insert on events to
  authenticated` and `revoke update, delete on events from authenticated`. A missing policy
  denies by default today, but a later `for all` policy would silently re-open it. The grant
  refusal is `42501 permission denied for table events` — a different message from the RLS
  refusal (`new row violates row-level security policy`) and impossible to mistake for the
  silent zero-row filter an RLS-only setup produces. **Pin the message, not only the code.**
- Every `SECURITY DEFINER` function pins `set search_path = public` on the same statement. A
  definer function whose search_path is attacker-influenced runs as the owner (ASVS V4). Today
  that is `app.current_org_id()`, `app.ensure_org()` and `app.log_event()`.

## Naming — three fields, never interchangeable

`accounts.name` in BIS was the agency's internal label ("Rio Roofing — trial") and it reached
customers three times. That is the entire reason these are separate columns.

| Table | Internal | Outbound / display | Source-of-record |
|---|---|---|---|
| `orgs` | `name_internal` | `display_name` | — |
| `businesses` | `internal_notes` | `display_name` | `legal_name` (Comptroller DBA, often mistyped) |

- `businesses.display_name` is what the triage card shows. `businesses.legal_name` is the
  Comptroller DBA. `businesses.internal_notes` is operator annotation and is **never
  outbound** — not in an export, not in a push payload, not in a webhook body.
- Every outbound builder registers in `PAYLOAD_BUILDERS` and accepts `PublicBusiness`
  (`src/lib/export/`). The FOUND-04 sentinel (`tests/unit/no-internal-leak.test.ts`) scans
  every registered builder and separately asserts that **every module under `src/lib/export`
  is represented in the registry** — so adding a builder without registering it fails.
- `businessLikeBridge` in `src/db/schema/businesses.ts` is a compile-time assertion tying the
  sentinel's structural fixture to the real Drizzle row type. Renaming a column fails `tsc`
  instead of letting the sentinel quietly scan a stale shape.

## Retention

Where the Google Maps Platform Terms live in the schema (FOUND-05).

- Every `source_records` row carries `retention_class`, constrained to `'durable' | 'ephemeral'`.
- **Google Places content can only ever be `ephemeral`** — `sr_google_is_ephemeral` refuses
  `source_key = 'google_places'` with any other class (`23514`). `place_id` is the only field
  exempt from the caching restriction; lat/lng may be cached 30 days; everything else goes.
- **Ephemeral requires `expires_at`, and durable forbids it** — `sr_ephemeral_has_expiry` is an
  equivalence and bites in both directions (`23514`). **TTL is 21 days, not 30**, so a missed
  purge run is not a breach.
- **A durable field can only cite a durable source.** Each provenance pair on `businesses` is
  `<field>_source_id` plus `<field>_src_ret`, the latter `generated always as ('durable') stored`,
  and the composite FK `(<field>_source_id, <field>_src_ret) → source_records (id, retention_class)`
  makes the retention class part of the reference itself. A field whose only source is a Google
  payload **cannot be set at all** — the column stays NULL and the UI says "not stored" rather
  than the row quietly becoming durable Google content. Violation is `23503` on
  `businesses_{legal_name,display_name,phone}_src_fk`.
- `sr_expiry` is a partial index on `expires_at where expires_at is not null` — Phase 4's purge
  job deletes on it.

## Time

- **Every timestamp is `timestamptz`.** Use `tstz(name)` from `src/db/schema/_helpers.ts`
  (`mode: 'date'`). A naked `timestamp` fails the schema audit. `mode: 'string'` hands back a
  session-zone-dependent string, which is how "it looked right locally" happens.
- Day buckets are **always** `at time zone 'America/Chicago'` in SQL and `APP_TZ` in
  TypeScript (`src/lib/time.ts`). A bare `created_at::date` silently buckets in UTC and moves
  every evening lead into tomorrow.
- Tests run with `TZ=UTC` (pinned on line 1 of both vitest configs, in the main process before
  any worker spawns) so a forgotten zone is a red assertion rather than an accident of the dev
  machine. **Zone AND locale are pinned** — an unpinned locale is an SSR hydration mismatch for
  `es-*`.
- Assert **one instant in two zones with opposite verdicts**. A fixture zone equal to the dev
  zone cannot discriminate; `America/Chicago` only ever as half a pair.
- Compare timestamps **in SQL** (`extract(epoch from …)`), not as JS `Date` objects round-tripped
  through `pg`. And note `now()` is `transaction_timestamp()` — constant for the whole
  transaction, so inside one `withRollback` an insert and a later update carry the **same**
  `updated_at` unless the baseline is deliberately aged.

## Testing

- **`withRollback` wraps every DB test.** It refuses a `TEST_DATABASE_URL` pointing at a
  Supabase host (D-04: the cloud project is production only and is never a test target).
- **Two orgs, always** (`seedTwoOrgs`). With one org, a policy that returns everything and a
  policy that returns the caller's rows are the same result set — every isolation bug is
  invisible.
- **One refused statement per transaction.** A refusal aborts the transaction and the next
  statement reports `25P02` ("current transaction is aborted"), not its own reason. Split
  refusals across tests, and make each test's refusal rest on a **different invariant** — two
  tests sharing one refusal means one mutation reds both, which is exactly how a mutation check
  stops telling you which guard you broke.
- **Pin the SQLSTATE and the constraint name**, and pin the message where two invariants share
  a code. `42501` covers both an RLS refusal and a grant refusal; only the message tells them
  apart. A bare `.rejects.toThrow` with no argument passes on a typo in the SQL.
- Under RLS, a cross-org `select`/`update`/`delete` is **filtered to zero rows, not refused**;
  only an `insert` carrying a foreign `org_id` (or an `update` that MOVES `org_id`) raises
  `42501`. Assert the zero-row cases with `rowCount`.
- **Watch every isolation, constraint and trigger test fail first**, and record the red output
  in the plan's SUMMARY. A test that has never been red proves nothing.
- **One named mutation per criterion test, reverted and diffed back.** Apply mutations to the
  **live database**, never to the migration file — then the revert is provable by construction
  (`git diff --stat` is empty) and is verified from `pg_trigger` / `pg_constraint` /
  `pg_get_functiondef` / `information_schema.role_table_grants` rather than from the fact that a
  script ran.
- **Read the failing test NAME on every filtered run, and read the PASS list too.** A vitest
  `-t` filter that matches nothing exits 0 green, and the positive control staying green is what
  distinguishes a working guard from one that refuses everything.
- Every refusal test is paired with a **positive control**.

---

## The tables, as they exist

Read from `information_schema.columns` after `drizzle/0007` was applied. `org_id` on every
table but `orgs`; `created_at` / `updated_at` / `updated_by` come from the `orgScoped` spread.

**`orgs`** — the tenant root. RLS on; `orgs_select`, `orgs_update` only.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | `default gen_random_uuid()` — the tenant key |
| `clerk_org_id` | `text not null` | unique; what the Clerk claim resolves against |
| `name_internal` | `text not null` | operator's label — never outbound |
| `display_name` | `text not null` | |
| `timezone` | `text not null` | default `'America/Chicago'` |
| `created_at` / `updated_at` | `timestamptz not null` | default `now()` |
| `updated_by` | `text` | stamped by `app.touch_updated_at()` |

**`events`** — append-only. RLS on; `events_select`, `events_insert` only; UPDATE/DELETE revoked.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` pk | generated always as identity |
| `org_id` | `uuid not null` | → `orgs(id)` |
| `actor_id` | `text not null` | Clerk `sub` → `app.actor_id` GUC → `'system'` |
| `entity_type` | `text not null` | `tg_table_name` |
| `entity_id` | `uuid` | |
| `action` | `text not null` | `lower(tg_op)` — `insert` / `update` / `delete` |
| `before` / `after` | `jsonb` | `before` on UPDATE/DELETE, `after` on INSERT/UPDATE |
| `occurred_at` | `timestamptz not null` | default `now()`; indexed `(org_id, occurred_at)` |

**`businesses`** — RLS on, four policies, `businesses_org_idx`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `org_id` | `uuid not null` | → `orgs(id)` |
| `created_at` / `updated_at` | `timestamptz not null` | |
| `updated_by` | `text` | |
| `legal_name` | `text` | Comptroller DBA |
| `display_name` | `text not null` | what the triage card shows |
| `internal_notes` | `text` | **never outbound** |
| `phone_e164` | `text` | |
| `city` | `text` | |
| `status` | `text not null` | default `'active'` |
| `legal_name_source_id` / `legal_name_src_ret` | `uuid` / `text` | `_src_ret` **generated always as `'durable'` stored** |
| `display_name_source_id` / `display_name_src_ret` | `uuid` / `text` | same |
| `phone_source_id` / `phone_src_ret` | `uuid` / `text` | same |

Phase 3 adds geometry, normalization columns (`name_norm`, `street_num`, `street_norm`, `geom`)
and their indexes. It may **ADD**; it may not rename.

**`source_records`** — RLS on, four policies, `source_records_org_idx`, `sr_expiry`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `org_id` | `uuid not null` | → `orgs(id)` |
| `created_at` / `updated_at` / `updated_by` | `timestamptz` / `timestamptz` / `text` | |
| `source_key` | `text not null` | `sr_source_key_known`: `overture`, `tx_comptroller`, `osm`, `county_dba`, `google_places`, `firecrawl`, `http_probe`, `dns_probe`, `manual` |
| `external_id` | `text` | |
| `business_id` | `uuid` | → `businesses(id)` |
| `payload` | `jsonb` | |
| `payload_hash` | `text` | |
| `retention_class` | `text not null` | `'durable' \| 'ephemeral'`; `unique (id, retention_class)` as `sr_durable_uniq` |
| `fetched_at` | `timestamptz not null` | default `now()` |
| `expires_at` | `timestamptz` | required iff `ephemeral`; TTL 21 days |

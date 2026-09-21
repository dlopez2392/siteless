# Phase 1: Foundations & Tenancy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-21
**Phase:** 1-Foundations & Tenancy
**Areas discussed:** Tenancy model, Test database, Audit trail, Schema tooling

**Format note:** danlo asked "What do you recommend?" instead of selecting areas one by one. All four gray areas were presented as recommendations with the alternatives named, and accepted together through a single gate ("Yes, all four — write the context"). No per-area deep dive was requested.

---

## Tenancy model

| Option | Description | Selected |
|--------|-------------|----------|
| Flat: one tenant = one Clerk organization, invite-only | `orgs` keyed by `clerk_org_id`; Clerk org creation OFF; danlo creates the org and invites BIS staff; org row provisioned JIT on first authenticated request | ✓ |
| BIS-style two-level agency → accounts | Mirrors `0001_tenancy.sql` (agencies, accounts, memberships) | |
| Self-serve org creation on first sign-in | Any Google sign-in could create an empty tenant | |

**User's choice:** Flat, invite-only (recommended)
**Notes:** Rationale accepted: BIS needs the second level because BIS's customers have customers; Siteless's customer is the agency itself.

---

## Test database

| Option | Description | Selected |
|--------|-------------|----------|
| Local Postgres (Supabase CLI / Docker) for tests; cloud project is prod-only | Zero extra cost; ends the BIS shared-project pattern; CI uses a Postgres service container; fallback = a second small cloud project if Docker is unavailable | ✓ |
| Supabase preview branches | Pro feature, per-branch cost | |
| One shared cloud project (BIS pattern) | e2e shares production; wipes a calendar by design in BIS | |

**User's choice:** Local Postgres for tests (recommended)
**Notes:** Docker availability to be checked at plan time, not assumed.

---

## Audit trail

| Option | Description | Selected |
|--------|-------------|----------|
| Both: append-only `events` table + `updated_at`/`updated_by` columns | Events = record of truth (Phase 7 status history reads it); columns for cheap display | ✓ |
| Append-only events log only | History without denormalized convenience | |
| Columns only (`updated_by`/`updated_at`) | Loses history; Phase 7 would have nothing to render | |

**User's choice:** Both (recommended)
**Notes:** Enforcement mechanism (write helper vs. triggers) left to Claude, but must be enforced and tested.

---

## Schema tooling

| Option | Description | Selected |
|--------|-------------|----------|
| Drizzle + drizzle-kit as single migration authority, RLS in schema; port BIS test fixtures | `orgScoped()` helper + `information_schema` test; `withRollback`/`actAs` port unchanged (plain `pg`) | ✓ |
| Raw SQL migrations via Supabase CLI (BIS pattern) | Familiar; 45 migrations in BIS; convention-based org scoping | |

**User's choice:** Drizzle with BIS fixtures ported (recommended)
**Notes:** Supabase MCP `apply_migration` and CLI migrations explicitly not used for schema in this repo.

---

## Claude's Discretion

- Places-content retention constraint mechanics (`retention_class` CHECK + composite FK per ARCHITECTURE.md)
- Post-sign-in shell contents (minimal "signed in as X in org Y" + health route)
- Vercel project creation timing within the phase
- Timezone/locale pinning mechanics in tests
- Audit-log enforcement mechanism (helper vs. triggers)
- Auth placement details per Next 16 (`proxy.ts` for session context only)

## Deferred Ideas

- Clerk production instance (custom domain) — after the product domain is bought; follow the BIS runbook
- Soft claim/lock for a second triager — Phase 7
- Per-org spend ledger key `(org_id, provider, month)` — Phase 2

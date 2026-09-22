-- Close the production-only authorization gap 01-10's privilege side-by-side found.
--
-- Supabase ships `alter default privileges ... grant all on tables to anon, authenticated,
-- service_role` for schema public, so every table drizzle-kit created as `postgres`
-- inherited FULL privileges for `anon` and `authenticated`. Row-level security does not
-- help: TRUNCATE is exempt from RLS by design, so a policy-scoped session could erase
-- every tenant's rows and the audit log. Proven on production inside rolled-back
-- transactions (01-10 Rule 4): `truncate public.events` as `authenticated` SUCCEEDED, and
-- so did `truncate orgs, businesses, source_records, events cascade` as both
-- `authenticated` and `anon`. Migration 0007's events revoke landed correctly and never
-- touched `anon` and never touched TRUNCATE. This contradicts D-06 and T-1-03.
--
-- Steps 1-2 REPRODUCE that platform default, so a bare Postgres (dev machine, CI's
-- postgres:18 container) reaches the same starting state production is already in. That is
-- what D-09 parity means here: without it the revoke below is a no-op on every database
-- except the one nobody can watch fail. Steps 3-6 are the fix. Idempotent end to end, and
-- the end state is identical whether the platform default was present or absent.
--
-- MAINTAIN is revoked alongside TRUNCATE/REFERENCES/TRIGGER and is not in the plan text.
-- It is a PostgreSQL 17+ table privilege that `grant all` includes, and the production
-- pre-flight found `anon` and `authenticated` already holding it on all four tables
-- (`arwdDxtm`). It carries VACUUM FULL, CLUSTER and REINDEX, each of which takes an ACCESS
-- EXCLUSIVE lock on a tenant table — the same denial-of-service class as TRUNCATE
-- (T-1-30), reachable by any session that reaches the grant layer.
--
-- NOT revoked, deliberately:
--   * service_role — bypassrls, server-side only, never held by a browser session.
--   * usage/select on SEQUENCES from authenticated — events.id is an identity column and
--     an INSERT needs the sequence. Migration 0002 grants it; the events insert test is
--     what would catch its loss.
--   * the supabase_admin-owned default ACL for schema public. It exists on production
--     alongside the postgres-owned one, and `postgres` is not a member of supabase_admin:
--     `alter default privileges for role supabase_admin ...` is refused with "permission
--     denied to change default privileges" (attempted on production, rolled back,
--     2026-09-22). It is also inert for this repo — it governs only tables created BY
--     supabase_admin, which owns zero tables in public, while every table here is created
--     by drizzle-kit as `postgres`. tests/db/grants-audit.test.ts therefore asserts the
--     default ACL of the roles that actually own tables in public.

-- 1. Reproduce the platform default for FUTURE tables (no-op on production).
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
--> statement-breakpoint

-- 2. Reproduce it for the tables that already exist (no-op on production).
grant all on all tables in schema public to anon, authenticated, service_role;
--> statement-breakpoint

-- 3. The fix. Nothing a browser session reaches may hold a privilege that ignores RLS.
revoke truncate, references, trigger, maintain
  on all tables in schema public from anon, authenticated;
--> statement-breakpoint

-- 4. anon is never a Siteless caller — app_user holds authenticated and nothing else.
revoke all on all tables in schema public from anon;
--> statement-breakpoint

-- 5. Re-assert 0007 after step 2's blanket grant. D-06: events is immutable by GRANT, and
-- a revoke that is not replayed here would be silently undone by this very migration.
revoke update, delete on public.events from authenticated;
--> statement-breakpoint

-- 6. Stop the next table drizzle-kit creates from inheriting anything. This also retires
-- migration 0002's own `alter default privileges ... grant select, insert, update, delete
-- on tables to authenticated`: from here on, a table-creating migration grants the DML its
-- policies need EXPLICITLY, in the same migration. See .planning/CONVENTIONS.md § Grants.
-- service_role's default privileges are left in place (see the note above).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

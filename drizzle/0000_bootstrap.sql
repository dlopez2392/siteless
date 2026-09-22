-- 0000_bootstrap.sql — make a bare PostgreSQL 18 look like Supabase.
--
-- Runs in three places and must be identical in all of them: the dev machine's native
-- PostgreSQL 18 (D-05a, because Docker Desktop and WSL are both absent), CI's postgres:18
-- service container, and the real Supabase project — where these roles already exist,
-- which is why every statement is conditional.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
--> statement-breakpoint

-- The runtime connects as this role, NOT as the owner. A table owner bypasses RLS, so a
-- code path that forgets `set local role` on an owner connection reads every tenant's
-- rows and nothing complains (reproduced on PostgreSQL 18.3). NOINHERIT means app_user
-- holds `authenticated` but does not use its privileges until it explicitly SET ROLEs —
-- so a forgotten `set local role` raises 42501 permission denied instead. D-11b.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login noinherit;
  end if;
end $$;
--> statement-breakpoint

grant authenticated to app_user;
--> statement-breakpoint

create schema if not exists app;
--> statement-breakpoint

-- Verbatim from BIS 0001_tenancy.sql:1-7. Works identically on Supabase and on bare
-- Postgres, which is exactly what makes the test suite portable.
create or replace function app.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
--> statement-breakpoint

-- Not optional. BIS shipped 0001 without these and every policy raised
-- "permission denied for schema app" instead of evaluating — which reads as an error,
-- not as a security hole, and cost a migration to find.
grant usage on schema app to authenticated, anon, service_role, app_user;
--> statement-breakpoint
grant execute on all functions in schema app to authenticated, anon, service_role;
--> statement-breakpoint
alter default privileges in schema app grant execute on functions to authenticated, anon, service_role;
--> statement-breakpoint

grant usage on schema public to authenticated, anon, service_role, app_user;

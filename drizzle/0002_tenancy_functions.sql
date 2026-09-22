-- BIS reads app.jwt()->>'org_id'. Copied verbatim that returns NULL under a Clerk v2
-- token, because v2 nests org claims under `o` and only when an organization is ACTIVE —
-- which yields zero rows and no error, the single highest-probability silent failure in
-- this build. The coalesce serves both shapes; danlo's instance emits both today.
create or replace function app.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.orgs
   where clerk_org_id = coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')
$$;
--> statement-breakpoint

-- On bare Postgres `authenticated` has no table privileges at all, so without these every
-- RLS test would fail on the GRANT layer and never reach the policy it is meant to prove.
grant select, insert, update, delete on all tables in schema public to authenticated;
--> statement-breakpoint
grant usage, select on all sequences in schema public to authenticated;
--> statement-breakpoint
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
--> statement-breakpoint
alter default privileges in schema public grant usage, select on sequences to authenticated;

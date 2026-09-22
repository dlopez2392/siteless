-- CR-01. Make the already-provisioned path a READ.
--
-- 0004 resolved the conflict with `on conflict (clerk_org_id) do update set clerk_org_id =
-- excluded.clerk_org_id`. PostgreSQL executes the DO UPDATE arm as a real row UPDATE — a
-- same-value SET is not a no-op — so migration 0007's `orgs_touch` (BEFORE UPDATE) and
-- `orgs_event` (AFTER INSERT OR UPDATE OR DELETE) both fired on the conflicting row. And
-- src/app/page.tsx calls ensureOrgRow() on EVERY render, so the cost was per signed-in page
-- view, not per provision:
--
--   * one fabricated `update` row in the append-only audit log per request, whose before/
--     after differ only in updated_at/updated_by, attributed to whoever loaded the page.
--     D-06 calls events "the record of truth for every state change"; this recorded a state
--     change that never happened.
--   * updated_at/updated_by moved to the viewer, so D-07's "changed 2h ago by danlo" meant
--     "last VIEWED by". The denormalized columns were a lie from the first page load.
--   * a row lock on the tenant's orgs row per render, serialising concurrent requests for
--     the same tenant.
--   * tests/e2e/signed-in.spec.ts loads / against the production alias on every push to
--     main, so CI wrote one of these into production per run.
--
-- The function is SECURITY DEFINER and runs as the owner, so the leading SELECT bypasses
-- RLS and always finds the row — the caller's own claim has already been proved equal to
-- p_clerk_org_id by the guard above it, so the definer read is scoped by that check and not
-- by a policy. The `do nothing` arm still takes the insert path only when the row is
-- genuinely absent; the follow-up select covers losing a race to a concurrent first request,
-- where DO NOTHING returns zero rows.
--
-- The claim guard and `set search_path = public` are reproduced verbatim from 0004 — this is
-- a CREATE OR REPLACE of the whole body, and dropping either would be a silent regression of
-- T-1-01 and of the ASVS V4 definer rule.
create or replace function app.ensure_org(p_clerk_org_id text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_claim text;
begin
  v_claim := coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id');
  if p_clerk_org_id is distinct from v_claim then
    raise exception 'ensure_org: org does not match the caller claim'
      using errcode = '42501';
  end if;
  select id into v_id from orgs where clerk_org_id = p_clerk_org_id;
  if v_id is not null then
    return v_id;
  end if;
  insert into orgs (clerk_org_id, name_internal, display_name)
       values (p_clerk_org_id, p_display_name, p_display_name)
  on conflict (clerk_org_id) do nothing
  returning id into v_id;
  if v_id is null then
    -- Lost the race to a concurrent first request: DO NOTHING returned no row.
    select id into v_id from orgs where clerk_org_id = p_clerk_org_id;
  end if;
  return v_id;
end $$;

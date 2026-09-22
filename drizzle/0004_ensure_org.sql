-- D-03: the orgs row is provisioned on the first authenticated request carrying a Clerk
-- org claim not yet seen. SECURITY DEFINER so `authenticated` never needs blanket INSERT
-- on the tenant root, and the passed org is PROVED to be the caller's own — otherwise a
-- member of org A could provision (and then own) a row for org B.
-- set search_path = public is mandatory on a SECURITY DEFINER function: without it the
-- search_path is attacker-controlled and the body runs as the owner (ASVS V4).
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
--> statement-breakpoint
grant execute on function app.ensure_org(text, text) to authenticated;

-- WR-01. Append-only protected the PAST and left the present writable.
--
-- 0007 revoked update and delete on events and granted select, insert. The insert half is
-- the hole: `events_insert` (0003) admits any row whose org_id matches the caller, so a
-- tenant session could write
--
--   insert into events (org_id, actor_id, entity_type, entity_id, action, before, after)
--   values (<own org>, 'user_someone_else', 'businesses', <id>, 'delete', ...)
--
-- and D-06's "record of truth for every state change" then recorded a state change that
-- never happened, attributed to somebody who never acted. Its integrity rested on the
-- application tier never issuing that statement — which is exactly the assumption the
-- trigger design (D-08) was chosen to stop relying on. app.log_event() is SECURITY DEFINER
-- and has never needed the grant.
--
-- The grant existed to anticipate Phase 3's run-level event (.planning/CONVENTIONS.md: bulk
-- ingest writes ONE event per run, not one per row). That use case does not need a
-- caller-controlled actor_id or org_id, so app.emit_event takes neither: it reads both out
-- of the transaction-local claims itself, as the owner.
--
-- NOT changed here, deliberately:
--   * the events_insert POLICY stays. It is unreachable while the grant is gone — the grant
--     layer refuses first — and it is the scope that would still apply if a later migration
--     ever re-granted INSERT. Removing it would make that re-grant unscoped.
--   * `usage, select on sequences` for authenticated (0002). events.id is an identity
--     column, but the only writer is now a definer running as the owner, so the grant is
--     merely inert rather than wrong. Retiring it is its own migration with its own test.
-- set search_path = public on the same statement, as every SECURITY DEFINER in this schema
-- does: without it the search_path is attacker-controlled and the body runs as the owner
-- (ASVS V4).
create or replace function app.emit_event(
  p_entity_type text, p_entity_id uuid, p_action text, p_after jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_org uuid;
begin
  -- Resolved and checked BEFORE the insert. Left to the insert, a null org would surface as
  -- 23502 on a not-null column, which reads as a schema bug rather than as "this session
  -- has no tenant".
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'emit_event: no current org' using errcode = '42501';
  end if;
  insert into events (org_id, actor_id, entity_type, entity_id, action, after)
  values (
    v_org,
    -- Clerk sub, then the GUC workers/ETL set, then 'system'. Identical to app.log_event()'s
    -- resolution so a run-level event and a row-level event attribute the same way. A client
    -- can set neither, and neither is a parameter of this function.
    coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system'),
    p_entity_type, p_entity_id, p_action, p_after
  )
  returning id into v_id;
  return v_id;
end $$;
--> statement-breakpoint

grant execute on function app.emit_event(text, uuid, text, jsonb) to authenticated;
--> statement-breakpoint

-- The fix. Everything above exists so that this line costs nothing legitimate.
revoke insert on public.events from authenticated;

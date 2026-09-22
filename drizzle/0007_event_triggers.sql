-- D-06 + D-08. Attribution is a property of the database, not of anybody's memory.
-- BIS logged events from the application tier through emit() — which existed as five
-- byte-identical copies, and a fix reached one of them. D-08's acceptance test is
-- literally "a direct write still produces an event"; a helper cannot pass it.

-- SECURITY DEFINER so the trigger can insert into events regardless of the caller's
-- grants (authenticated has no UPDATE/DELETE there, and after the revoke below it has
-- less still). Pinning the search_path on the SAME statement is mandatory alongside it:
-- a definer function whose search_path is attacker-influenced runs as the owner
-- (ASVS V4). The pin is not spelled twice in this file — an acceptance grep counts its
-- occurrences, and a comment naming the thing it describes trips that count.
create or replace function app.log_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_org uuid;
begin
  v_row := to_jsonb(coalesce(new, old));
  -- orgs IS the tenant root, so its own id is the org id.
  v_org := coalesce((v_row->>'org_id')::uuid,
                    case when tg_table_name = 'orgs' then (v_row->>'id')::uuid end);
  insert into events (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (
    v_org,
    -- Clerk sub, then a GUC workers/ETL can set, then 'system'. current_setting with the
    -- missing_ok flag returns NULL rather than erroring on an unset GUC.
    coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system'),
    tg_table_name,
    (v_row->>'id')::uuid,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;
--> statement-breakpoint

-- D-07. Without this, the denormalized columns are a lie the first time someone writes
-- SQL by hand. BEFORE, never AFTER: it mutates NEW and returns it, and an AFTER
-- attachment would recurse.
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system');
  return new;
end $$;
--> statement-breakpoint

-- The DECIDED scope boundary (see .planning/CONVENTIONS.md). Row triggers go on
-- state-bearing tables. source_records is bulk-ingest: Phase 3 loads ~10k Comptroller and
-- Overture rows, and a row trigger there would write 10k event rows carrying full
-- before/after payloads. Bulk ingest writes ONE run-level event instead.
do $$ declare t text;
begin
  foreach t in array array['orgs','businesses'] loop
    execute format(
      'create trigger %I_event after insert or update or delete on %I
         for each row execute function app.log_event()', t, t);
  end loop;
  foreach t in array array['orgs','businesses','source_records'] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
--> statement-breakpoint

-- Immutability is a GRANT, not a policy. With only an RLS filter, an UPDATE is silently
-- filtered to zero rows and reads as "nothing happened"; with the grant revoked it is
-- 42501 "permission denied for table events" — a refusal the caller cannot mistake for
-- an empty result, and a different message from the RLS refusal.
grant select, insert on events to authenticated;
--> statement-breakpoint
revoke update, delete on events from authenticated;

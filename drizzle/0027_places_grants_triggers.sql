-- Phase 4 plan 09. The half of the Places schema drizzle-kit cannot emit: a data fix, two
-- hand-written indexes, the grants, the triggers, the cron role and the signal view.
--
-- Why each part exists:
--   * D-15 / T-4-02 — one ACTIVE run per org, as a unique partial index. Stale Phase 2
--     queued rows are failed as never_started FIRST, or creating the index fails on apply.
--   * D-10 — place_observations is append-only twice over: SELECT-only by grant, and a
--     BEFORE UPDATE OR DELETE trigger that raises even for the owner.
--   * D-12 / T-4-04 — place_coordinates carries NO privilege for authenticated or anon at
--     all, so any tenant read is `42501 permission denied for table place_coordinates`.
--     Counts come from a SECURITY DEFINER (04-11); the purge (04-11) DELETES coordinate rows
--     and never an observation.
--   * D-05 / D-08 — business_place_signal is a security_invoker view over ATTACHED listings
--     only; tentative and rejected are never a verdict input.
--   * 04-RESEARCH Pattern 8 — every other new table is SELECT-only; every write is a
--     SECURITY DEFINER that resolves org and actor from the claims.
--
-- 🔴 PG17-compatible SQL only (tests/unit/pg17-compat.test.ts): production is 17.6.

-- 1. DATA FIX BEFORE THE UNIQUE INDEX.
--
-- Production holds Phase 2 queued rows that never ran (03-21 SUMMARY: 5 runs) — there was no
-- executor until this phase. Without this, `runs_one_active_per_org` below fails on apply the
-- moment one org holds two of them. 15 minutes: nothing legitimately sits queued that long
-- once the Phase 4 executor exists, and a run queued seconds before the migration is left
-- alone. finished_at keeps any value it already has.
update runs
   set status = 'failed',
       stopped_reason = 'never_started',
       finished_at = coalesce(finished_at, now())
 where status = 'queued'
   and created_at < now() - interval '15 minutes';
--> statement-breakpoint

-- 2. ONE ACTIVE RUN PER ORG (D-15, T-4-02). A second queued/running run in the same org is
-- `23505 duplicate key value violates unique constraint "runs_one_active_per_org"`. Two
-- concurrent sweeps against one monthly cap is how a budget gets spent twice as fast as the
-- estimate promised.
create unique index runs_one_active_per_org on runs (org_id) where status in ('queued','running');
--> statement-breakpoint

-- 3. THE PROXIMITY BLOCKER'S INDEX (04-RESEARCH Pattern 7, B4). No spatial index exists on
-- businesses; the matcher's ±150 m box is a range on lat inside the org, over live rows only.
create index businesses_latlng_idx on businesses (org_id, lat) where lat is not null and merged_into_id is null;
--> statement-breakpoint

-- 4. EXPLICIT DML GRANTS. A new table inherits NOTHING (migration 0008; CONVENTIONS § Grants).
-- Seven of the eight new tables are SELECT-only for authenticated: every writer is a SECURITY
-- DEFINER (04-11, 04-15) that reads its own org and actor, so decided_by / first_seen_run_id /
-- an observation's verdict cannot be forged by a tenant session.
grant select on place_attachments, place_observations, place_tiles, place_tile_members, run_searches, run_place_outcomes, place_purge_runs to authenticated;
--> statement-breakpoint

-- Belt and braces, the 0015 / 0023 precedent: a later blanket `grant all on all tables in
-- schema public` would silently re-open all seven, and a revoke that is not written down
-- cannot be re-asserted.
revoke insert, update, delete on place_attachments, place_observations, place_tiles, place_tile_members, run_searches, run_place_outcomes, place_purge_runs from authenticated;
--> statement-breakpoint

-- 5. D-12's DATABASE-LEVEL PROOF. place_coordinates gets NO grant at all — not SELECT, not
-- anything. Any tenant read is `42501 permission denied for table place_coordinates`
-- (named test "authenticated cannot read place coordinates", mutation M37). The /sources
-- counts come from a SECURITY DEFINER (04-11); the only cross-org reader is the purge,
-- executable only by siteless_cron.
revoke all on place_coordinates from authenticated, anon;
--> statement-breakpoint

-- 6. RUNS: THE COLUMN GRANT GROWS BY TWO (drizzle/0013 L90 is the rest of it).
-- heartbeat_at is stamped by every workflow step and workflow_run_id is recorded at start.
-- 🔴 ceiling_requests is deliberately NOT granted: it is immutable after insert (T-4-12), so a
-- tenant session cannot raise its own run's ceiling mid-flight. kind, partition_index, the
-- estimates and requested_by are also insert-only — a column added to runs inherits nothing
-- from 0013's grant and must be named here to be writable.
grant update (heartbeat_at, workflow_run_id) on runs to authenticated;
--> statement-breakpoint

-- 7. app.touch_updated_at on the five MUTABLE new tables. BEFORE, never AFTER: it mutates NEW
-- and returns it, and an AFTER attachment recurses. None on place_observations and
-- place_coordinates (append-only / insert-then-purge) or place_purge_runs (a purge record is
-- never updated) — the cost_ledger precedent (0015).
do $$ declare t text;
begin
  foreach t in array array['place_attachments','place_tiles','place_tile_members','run_searches','run_place_outcomes'] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
--> statement-breakpoint

-- 8. app.log_event on place_attachments, UPDATE ARM ONLY, NARROWED TO A STATUS CHANGE.
-- Status changes are the state-bearing events (confirm / reject / detach / re-score to or
-- from attached). The matcher's per-run INSERT volume is audited at run level by 04-22's
-- finishRun step via app.emit_event — the budget_periods precedent (0015): an unnarrowed
-- trigger would write an events row, with a full before/after payload, for every
-- last_seen_run_id bump on every run. `is distinct from`, never `<>`, per 0015.
create trigger place_attachments_event_upd after update on place_attachments
  for each row when (old.status is distinct from new.status)
  execute function app.log_event();
--> statement-breakpoint

-- 9. place_observations IS APPEND-ONLY, EVEN FOR THE OWNER (D-10).
-- The grant refusal (SELECT-only above) is the primary proof and the Phase 1 standard; this
-- trigger is the second wall, for the owner-tier desk scripts and every SECURITY DEFINER,
-- which bypass grants but not triggers. Not SECURITY DEFINER: it touches nothing.
-- SQLSTATE 55000 (object_not_in_prerequisite_state).
create or replace function app.refuse_place_observation_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'place_observations is append-only' using errcode = '55000';
end $$;
--> statement-breakpoint

create trigger place_observations_append_only before update or delete on place_observations
  for each row execute function app.refuse_place_observation_change();
--> statement-breakpoint

-- 10. THE CRON ROLE (T-4-07). The one role that may run the cross-org coordinate purge; 04-11
-- grants it schema usage and EXECUTE on exactly that function and nothing else. NOLOGIN, and
-- held only by app_user — which is NOINHERIT (0000), so the runtime must `set local role
-- siteless_cron` explicitly (withCronRole, 04-11) to use it. Conditional, per 0000 L26–33:
-- roles are cluster-wide and survive a database re-create.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'siteless_cron') then
    create role siteless_cron nologin;
  end if;
end $$;
--> statement-breakpoint

grant siteless_cron to app_user;
--> statement-breakpoint

-- 11. THE CURRENT SIGNAL (D-05, D-08; M43).
-- Per business: the latest observation of each ATTACHED listing, then true if ANY of those is
-- true. security_invoker = true (PG15+, production 17.6) so the caller's RLS on
-- place_attachments and place_observations applies THROUGH the view — without it a view runs
-- as its owner and would hand every tenant every tenant's signal. It never selects
-- coordinates.
create view business_place_signal with (security_invoker = true) as
select a.org_id, a.business_id,
       bool_or(o.had_website_uri) as had_website_uri,
       (array_agg(o.host_class order by o.had_website_uri desc, o.observed_at desc, o.id desc))[1] as host_class,
       max(o.observed_at) as observed_at,
       count(*)::int as listings
  from place_attachments a
  join lateral (
    select po.id, po.had_website_uri, po.host_class, po.observed_at
      from place_observations po
     where po.org_id = a.org_id and po.business_id = a.business_id and po.place_id = a.place_id
     order by po.observed_at desc, po.id desc
     limit 1
  ) o on true
 where a.status = 'attached'
 group by a.org_id, a.business_id;
--> statement-breakpoint

grant select on business_place_signal to authenticated;
--> statement-breakpoint

comment on view business_place_signal is
  'D-05/D-08: tentative and rejected attachments are never a verdict input. True if ANY attached listing''s LATEST observation lists a website — leans against a false "no website" lead. security_invoker: the caller''s RLS applies through the view. Never selects coordinates. SELECT only for authenticated.';
--> statement-breakpoint

-- 12. WHAT DELIBERATELY HAS NO app.log_event TRIGGER, AND WHY.
-- EVENT_LOGGED in tests/db/event-trigger.test.ts asserts set equality in BOTH directions, so
-- these comments are where a future reader learns each exclusion was a decision.
comment on table place_observations is
  'Append-only (D-10): authenticated holds SELECT only, and place_observations_append_only raises 55000 on any UPDATE or DELETE, even for the owner. One row per (run, business, place): had_website_uri, host_class (D-09, URL discarded at call time), sku, pure_sab. No app.log_event: per-run volume; audited at run level. Coordinates live in place_coordinates.';
--> statement-breakpoint

comment on table place_coordinates is
  'D-12 retention barrier. authenticated and anon hold NO privilege (42501 on any read). expires_at <= observed_at + 30 days by CHECK; the daily purge (siteless_cron only) DELETES expired rows and never an observation. No app.log_event and no touch trigger: inserted, then purged, never updated.';
--> statement-breakpoint

comment on table place_tiles is
  'No app.log_event by design: tiling geometry we computed, rewritten by every sweep (saturation, last_swept_*) — the write-amplification argument. The run that changed it is the audit record. SELECT-only for authenticated; written by a SECURITY DEFINER.';
--> statement-breakpoint

comment on table place_tile_members is
  'No app.log_event by design: one row per place per leaf, touched by every change check (last_seen_at). gone_at is history, never a delete. place_id only (D-06). SELECT-only for authenticated.';
--> statement-breakpoint

comment on table run_searches is
  'No app.log_event by design: one row per tile per run, updated per page — the run IS the event. No page-token column: tokens stay in memory. SELECT-only for authenticated; written by a SECURITY DEFINER.';
--> statement-breakpoint

comment on table run_place_outcomes is
  'No app.log_event by design: one row per place per cluster per run — the run-level event covers it. place_id only, no Places text. SELECT-only for authenticated.';
--> statement-breakpoint

comment on table place_purge_runs is
  'No app.log_event by design: the row IS the purge''s audit record, one per org per purge (zero-count included). Never updated, so no touch trigger. SELECT-only for authenticated.';

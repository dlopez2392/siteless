-- Phase 4 plan 11. The first definer migration of the phase: the meter's missing RELEASE, the
-- run-search progress writers the executor needs, and the two retention functions behind
-- D-12's observable purge.
--
--   * D-15 / Pattern 6 / M53 — app.release_reservation. There was no explicit release: only
--     app.settle_reservation, which refuses units <= 0 and writes a ledger row. "Settling" the
--     queue-time admission hold would record a phantom ts_enterprise request that
--     readUnitsUsedThisPeriod counts against the free 1,000. The release writes nothing to the
--     ledger; it frees the hold and nothing else.
--   * D-15 / D-16 — app.plan_run_searches and app.mark_run_search: run_searches and
--     place_tiles are SELECT-only for authenticated (drizzle/0027), so the executor writes
--     them through these, org and run re-read from the claims (T-4-06), keys allow-listed
--     (T-4-10).
--   * D-12 / Pattern 10 / M38 / M39 — app.purge_expired_place_coordinates is cross-org by
--     nature, so it takes no org claim and is executable ONLY by siteless_cron (0027), which
--     holds no table privilege. app.places_transient_stats gives /sources its counts without
--     any read grant on place_coordinates.
--
-- Definer discipline (0024, 0025): search_path = public, pg_temp on the same statement; the
-- org from app.current_org_id(), never a parameter; every caller-supplied uuid re-read with
-- org_id = v_org; an explicit `if not found` after every `select … into` (plpgsql does not
-- raise when it matches nothing). 🔴 `revoke … from public` alone does nothing useful here:
-- 0000_bootstrap's default privileges hand every new app.* function an EXPLICIT execute grant
-- for authenticated, anon and service_role, so every role is named (0024 L129–139).
--
-- 🔴 PG17-compatible SQL only (tests/unit/pg17-compat.test.ts): production is 17.6.

-- ===========================================================================
-- 1. app.release_reservation — free an unsettled hold, write no ledger row.
-- ===========================================================================
--
-- The 0018 release (release_expired_reservations) for exactly one reservation, by id, whether
-- or not it has expired. Tenancy re-checked like settle_reservation (0019 L55–72): loaded as
-- the owner, so RLS does not hide it, then compared EXPLICITLY — 22023 when there is no such
-- reservation, 42501 when it is another org's.
--
-- Idempotent: a settled or already-released reservation frees 0 and moves nothing. The UPDATE
-- is conditional on both timestamps still being null and the balance moves only when it
-- updated a row, so two concurrent releases free the hold once. `for update` serialises them
-- at the read, too.
create or replace function app.release_reservation(p_reservation uuid)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_res_org uuid; v_period uuid; v_est bigint;
        v_settled timestamptz; v_released timestamptz; v_n int;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'release_reservation: no current org' using errcode = '42501';
  end if;

  select r.org_id, r.budget_period_id, r.est_micro_usd, r.settled_at, r.released_at
    into v_res_org, v_period, v_est, v_settled, v_released
    from cost_reservations r
   where r.id = p_reservation
     for update of r;
  if not found then
    raise exception 'release_reservation: no such reservation' using errcode = '22023';
  end if;
  if v_res_org is distinct from v_org then
    raise exception 'release_reservation: reservation belongs to another org'
      using errcode = '42501';
  end if;

  if v_settled is not null or v_released is not null then
    return 0;
  end if;

  update cost_reservations set released_at = now()
   where id = p_reservation and settled_at is null and released_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 0;
  end if;

  update budget_periods set reserved_micro_usd = reserved_micro_usd - v_est
   where id = v_period and org_id = v_org;
  return v_est;
end $$;
--> statement-breakpoint

revoke execute on function app.release_reservation(uuid) from public, anon;
--> statement-breakpoint

grant execute on function app.release_reservation(uuid) to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 2. app.plan_run_searches — record each planned (type × tile) search, idempotently.
-- ===========================================================================
--
-- One element per search: keys tileKey, cellKey, clusterKey, unitKind, unitId, placesType,
-- quadPath, depth, south, west, north, east, parentTileKey, kind. Every key is DB-safe
-- (jsonb cannot carry U+0000 at all).
--
-- The run is re-read under the caller's org, and "another org's" and "does not exist" get the
-- SAME refusal (0020 L46–50): a different message would be an existence oracle on run ids.
-- The run must be active (55000 otherwise), and each search's kind must agree with the run's:
-- a change_check run plans ids_only searches only, every other kind enterprise only (22023) —
-- an enterprise search on a change check is a paid request the estimate never priced.
--
-- place_tiles is upserted per (org, tile_key): tiles are shared across runs and presets. The
-- `do update set updated_at` exists to make RETURNING yield the existing row. run_searches is
-- `do nothing` per (run, tile_key), so a replayed plan returns the SAME search ids.
create or replace function app.plan_run_searches(p_run uuid, p_searches jsonb)
returns table (search_id uuid, tile_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_org uuid; v_status text; v_run_kind text; v_expected text;
        el jsonb; v_tile uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'plan_run_searches: no current org' using errcode = '42501';
  end if;

  select r.status, r.kind into v_status, v_run_kind
    from runs r where r.id = p_run and r.org_id = v_org;
  if not found then
    raise exception 'plan_run_searches: run belongs to another org or does not exist'
      using errcode = '42501';
  end if;
  if v_status not in ('queued', 'running') then
    raise exception 'plan_run_searches: run is not active' using errcode = '55000';
  end if;

  if p_searches is null or jsonb_typeof(p_searches) <> 'array' then
    raise exception 'plan_run_searches: searches must be a json array' using errcode = '22023';
  end if;

  v_expected := case when v_run_kind = 'change_check' then 'ids_only' else 'enterprise' end;

  for el in select e.value from jsonb_array_elements(p_searches) e loop
    if jsonb_typeof(el) <> 'object' or el->>'tileKey' is null then
      raise exception 'plan_run_searches: each search needs a tileKey' using errcode = '22023';
    end if;
    if (el->>'kind') is distinct from v_expected then
      raise exception 'plan_run_searches: search kind does not match the run'
        using errcode = '22023';
    end if;

    insert into place_tiles as t (org_id, tile_key, unit_kind, unit_id, places_type, quad_path,
                                  depth, south, west, north, east)
         values (v_org, el->>'tileKey', el->>'unitKind', el->>'unitId', el->>'placesType',
                 el->>'quadPath', (el->>'depth')::int,
                 (el->>'south')::double precision, (el->>'west')::double precision,
                 (el->>'north')::double precision, (el->>'east')::double precision)
    on conflict on constraint place_tiles_key do update set updated_at = now()
    returning t.id into v_tile;

    insert into run_searches (org_id, run_id, tile_id, tile_key, cell_key, cluster_key,
                              places_type, kind, depth, parent_tile_key)
         values (v_org, p_run, v_tile, el->>'tileKey', el->>'cellKey', el->>'clusterKey',
                 el->>'placesType', el->>'kind', (el->>'depth')::int, el->>'parentTileKey')
    on conflict on constraint run_searches_key do nothing;

    return query
      select rs.id, rs.tile_key from run_searches rs
       where rs.run_id = p_run and rs.org_id = v_org and rs.tile_key = el->>'tileKey';
  end loop;
end $$;
--> statement-breakpoint

revoke execute on function app.plan_run_searches(uuid, jsonb) from public, anon;
--> statement-breakpoint

grant execute on function app.plan_run_searches(uuid, jsonb) to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 3. app.mark_run_search — move one search's progress through an allow-listed key set.
-- ===========================================================================
--
-- Keys: status, saturated, subdivided, truncated, truncated_why, inflight_reservation_id,
-- inflight_request_id. Anything else is 22023 (T-4-10): progress rows hold our enums, flags
-- and ids, and no Places text can be smuggled into them through this door. The key is not
-- echoed in the message.
--
-- Each key applies as coalesce(new, old), so a caller names only what changed. The two
-- in-flight keys are the exception: a JSON null CLEARS them (the step that settled its page
-- releases the durable cursor, 04-RESEARCH Pattern 2). An in-flight reservation must be a
-- cost_reservations row of THIS org for THIS search's run (42501 otherwise), so a cursor can
-- never point at somebody else's hold.
--
-- When the call sets status 'done', the tile follows: is_leaf = not subdivided, saturated,
-- truncated, and last_swept_run_id/at for an enterprise search or last_checked_at for an
-- ids_only change check (D-16).
create or replace function app.mark_run_search(p_search uuid, p_state jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_run uuid; v_tile uuid; v_kind text; v_res uuid;
        v_status text; v_saturated boolean; v_subdivided boolean; v_truncated boolean;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'mark_run_search: no current org' using errcode = '42501';
  end if;

  select s.run_id, s.tile_id, s.kind into v_run, v_tile, v_kind
    from run_searches s where s.id = p_search and s.org_id = v_org
     for update of s;
  if not found then
    raise exception 'mark_run_search: search belongs to another org or does not exist'
      using errcode = '42501';
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'mark_run_search: state must be a json object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_state) k
              where k not in ('status', 'saturated', 'subdivided', 'truncated', 'truncated_why',
                              'inflight_reservation_id', 'inflight_request_id')) then
    raise exception 'mark_run_search: state carries a key that is not allowed'
      using errcode = '22023';
  end if;

  if p_state ? 'inflight_reservation_id' and jsonb_typeof(p_state->'inflight_reservation_id') <> 'null' then
    v_res := (p_state->>'inflight_reservation_id')::uuid;
    perform 1 from cost_reservations r
     where r.id = v_res and r.org_id = v_org and r.run_id = v_run;
    if not found then
      raise exception 'mark_run_search: reservation is not this run''s'
        using errcode = '42501';
    end if;
  end if;

  update run_searches s set
         status        = coalesce(p_state->>'status', s.status),
         saturated     = coalesce((p_state->>'saturated')::boolean, s.saturated),
         subdivided    = coalesce((p_state->>'subdivided')::boolean, s.subdivided),
         truncated     = coalesce((p_state->>'truncated')::boolean, s.truncated),
         truncated_why = coalesce(p_state->>'truncated_why', s.truncated_why),
         inflight_reservation_id = case when p_state ? 'inflight_reservation_id'
                                        then v_res else s.inflight_reservation_id end,
         inflight_request_id     = case when p_state ? 'inflight_request_id'
                                        then p_state->>'inflight_request_id'
                                        else s.inflight_request_id end
   where s.id = p_search and s.org_id = v_org
  returning s.status, s.saturated, s.subdivided, s.truncated
       into v_status, v_saturated, v_subdivided, v_truncated;

  if (p_state->>'status') = 'done' then
    update place_tiles t set
           is_leaf           = not v_subdivided,
           saturated         = v_saturated,
           truncated         = v_truncated,
           last_swept_run_id = case when v_kind = 'enterprise' then v_run else t.last_swept_run_id end,
           last_swept_at     = case when v_kind = 'enterprise' then now() else t.last_swept_at end,
           last_checked_at   = case when v_kind = 'ids_only' then now() else t.last_checked_at end
     where t.id = v_tile and t.org_id = v_org;
  end if;
end $$;
--> statement-breakpoint

revoke execute on function app.mark_run_search(uuid, jsonb) from public, anon;
--> statement-breakpoint

grant execute on function app.mark_run_search(uuid, jsonb) to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 4. app.purge_expired_place_coordinates — the cross-org D-12 purge.
-- ===========================================================================
--
-- No org claim: cross-org by nature. Deletes EVERY expired coordinate row and never an
-- observation (place_observations is append-only and its trigger would refuse anyway), then
-- writes one place_purge_runs row per org — zero included, so "last purge" on /sources is per
-- tenant and true. Idempotent reconciliation ("delete everything expired"): Vercel Cron may
-- duplicate or skip a delivery (Pattern 10), and a second call purges 0 and records 0.
--
-- The predicate `expires_at <= now()` is the exact complement of places_transient_stats'
-- "held" (`expires_at > now()`), so a row is always one or the other.
create or replace function app.purge_expired_place_coordinates(p_trigger text default 'cron')
returns table (purged_org uuid, purged_rows int)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_trigger is null or p_trigger not in ('cron', 'desk') then
    raise exception 'purge_expired_place_coordinates: unknown trigger' using errcode = '22023';
  end if;

  return query
  with purged as (delete from place_coordinates pc where pc.expires_at <= now() returning pc.org_id),
  counts as (select o.id as oid, count(p.org_id)::int as n
               from orgs o left join purged p on p.org_id = o.id group by o.id),
  ins as (insert into place_purge_runs (org_id, rows_purged, trigger)
          select c.oid, c.n, p_trigger from counts c
          returning place_purge_runs.org_id, place_purge_runs.rows_purged)
  select ins.org_id, ins.rows_purged from ins;
end $$;
--> statement-breakpoint

-- T-4-07 / M39. siteless_cron (0027, NOLOGIN, held only by app_user) needs the schema to name
-- the function, and EXECUTE on exactly this one. Every other role is refused by name — the
-- schema default grants authenticated, anon and service_role explicitly. The migration owner
-- owns the function and can always run it (the desk script, 04-17).
grant usage on schema app to siteless_cron;
--> statement-breakpoint

revoke execute on function app.purge_expired_place_coordinates(text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

grant execute on function app.purge_expired_place_coordinates(text) to siteless_cron;
--> statement-breakpoint

-- ===========================================================================
-- 5. app.places_transient_stats — /sources' five figures, counts only.
-- ===========================================================================
--
-- authenticated holds NO privilege on place_coordinates (0027), and that stays true: this
-- definer returns counts and two epoch-ms timestamps for the caller's org, never a row. An
-- expired, not-yet-purged coordinate is never "held" (T-4-04) — it is counted only in
-- expired_awaiting_purge. place_ids_held is the distinct union of tile-member and attachment
-- place ids. The last purge is nulls when the org has never been purged.
create or replace function app.places_transient_stats()
returns table (place_ids_held bigint, coordinates_held bigint, oldest_coordinate_ms text,
               expired_awaiting_purge bigint, last_purge_ms text, last_rows_purged int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'places_transient_stats: no current org' using errcode = '42501';
  end if;

  return query
  select ids.n, co.held, co.oldest, co.expired, lp.ms, lp.rows_purged
    from (select count(*)::bigint as n
            from (select m.place_id from place_tile_members m where m.org_id = v_org
                  union
                  select a.place_id from place_attachments a where a.org_id = v_org) u) ids
   cross join (select count(*) filter (where pc.expires_at > now())::bigint as held,
                      floor(extract(epoch from min(pc.observed_at) filter (where pc.expires_at > now())) * 1000)::bigint::text as oldest,
                      count(*) filter (where pc.expires_at <= now())::bigint as expired
                 from place_coordinates pc where pc.org_id = v_org) co
    left join lateral (select floor(extract(epoch from r.ran_at) * 1000)::bigint::text as ms,
                              r.rows_purged
                         from place_purge_runs r where r.org_id = v_org
                        order by r.ran_at desc, r.id desc limit 1) lp on true;
end $$;
--> statement-breakpoint

revoke execute on function app.places_transient_stats() from public, anon;
--> statement-breakpoint

grant execute on function app.places_transient_stats() to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 6. One comment per definer.
-- ===========================================================================
comment on function app.release_reservation(uuid) is
  'D-15 / 04-RESEARCH Pattern 6 / M53. Frees ONE unsettled, unreleased hold of the caller''s org and returns the amount freed; 0 when already settled or released (idempotent). Writes no ledger row — settling the admission hold instead would record a phantom Enterprise request against the free 1,000. 22023 no such reservation, 42501 another org''s.';
--> statement-breakpoint

comment on function app.plan_run_searches(uuid, jsonb) is
  'D-15 / D-16 / T-4-06. Records each planned (type x tile) search for an active run of the caller''s org: upserts place_tiles per (org, tile_key), inserts run_searches do-nothing per (run, tile_key), returns (search_id, tile_key) — a replay returns the same ids. 42501 foreign-or-missing run (one message), 55000 inactive run, 22023 a kind that disagrees with the run (change_check <=> ids_only).';
--> statement-breakpoint

comment on function app.mark_run_search(uuid, jsonb) is
  'D-15 / D-16 / T-4-10. Moves one search''s progress through an allow-listed key set (status, saturated, subdivided, truncated, truncated_why, inflight_reservation_id, inflight_request_id; anything else 22023), coalesce(new, old) per key; JSON null clears the in-flight pair. An in-flight reservation must be this org''s and this run''s (42501). Status done updates the tile: is_leaf = not subdivided, saturated, truncated, and last_swept_* (enterprise) or last_checked_at (ids_only).';
--> statement-breakpoint

comment on function app.purge_expired_place_coordinates(text) is
  'D-12 / 04-RESEARCH Pattern 10 / M38 / M39. Cross-org by nature: deletes every place_coordinates row with expires_at <= now(), never an observation, and writes one place_purge_runs row per org (zero included). Executable ONLY by siteless_cron (execute revoked from public, anon, authenticated, service_role); the owner runs it from the desk. Trigger cron|desk, else 22023. Idempotent.';
--> statement-breakpoint

comment on function app.places_transient_stats() is
  'D-12 / T-4-04. The /sources transient figures for the caller''s org — place ids held, coordinates held, oldest held coordinate (epoch ms text), expired awaiting purge, last purge (epoch ms text) and its row count — without any read grant on place_coordinates. An expired coordinate is never counted as held. Counts only; no row-level coordinate read exists.';

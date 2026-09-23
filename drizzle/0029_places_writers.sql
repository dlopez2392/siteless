-- Phase 4 plan 15. The result writers: where the matcher's in-memory decisions (04-06) become
-- rows, and the ONLY place Google-derived data touches disk.
--
--   * T-3-11 / T-4-05 / M36 — app.places_features_ok + the pa_features_numeric CHECK: a
--     place_attachments.features value holds allow-listed keys with numbers, null, the
--     signal-name array and the rule enum — never text — even if the application regresses.
--   * D-05 / D-06 / D-08 / D-10 / PLACE-02 — app.record_places_page: tile membership, the
--     per-cluster outcome, attachments (sticky reject / confirm, ties naming each other),
--     append-only observations and 30-day coordinates, and the run-search progress keys
--     app.mark_run_search deliberately cannot write (pages_done, results_count; 04-11).
--   * D-16 — app.record_change_check: the ids-only membership diff; gone members get gone_at,
--     never a delete; change_verdict / new_ids / gone_ids / results_count on the search.
--   * D-05 — app.decide_place_attachment: confirm / reject / detach, the pending-only 55000
--     rule of record_candidate_decision (0024).
--
-- Definer discipline (0024, 0025, 0028): search_path = public, pg_temp; the org from
-- app.current_org_id(), never a parameter; every caller-supplied uuid re-read with
-- org_id = v_org, with "another org's" and "does not exist" given ONE message (no existence
-- oracle); an explicit `if not found` after every `select … into` (plpgsql does not raise when
-- it matches nothing). Refusal messages never echo a caller-supplied value — it may be exactly
-- the Places text being refused. 🔴 `revoke … from public` alone does nothing useful: the
-- 0000_bootstrap default privileges hand every new app.* function an EXPLICIT execute grant for
-- authenticated, anon and service_role, so each role is named.
--
-- 🔴 PG17-compatible SQL only (tests/unit/pg17-compat.test.ts): production is 17.6.

-- ===========================================================================
-- 1. app.places_features_ok + pa_features_numeric — T-3-11 made a database fact.
-- ===========================================================================
--
-- The 13 keys are src/lib/places/page-record.ts FEATURE_KEYS: the Phase 3 scorer's Features
-- (name, phone, address, distance, cluster, nameSim, distanceM, signals, rule) plus the
-- matcher's 0|1 flags (city, sab, listingPhone, listingLocation). Nested CASE, never AND:
-- SQL does not promise AND short-circuits, and jsonb_array_elements on a scalar raises.
create or replace function app.places_features_ok(f jsonb) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
    when f is null or jsonb_typeof(f) <> 'object' then false
    else not exists (
      select 1 from jsonb_each(f) e
       where not (
         case
           when e.key in ('name', 'phone', 'address', 'distance', 'cluster', 'nameSim')
             then jsonb_typeof(e.value) = 'number'
           when e.key = 'distanceM'
             then jsonb_typeof(e.value) in ('number', 'null')
           when e.key = 'signals'
             then case
                    when jsonb_typeof(e.value) <> 'array' then false
                    else not exists (
                      select 1 from jsonb_array_elements(e.value) s
                       where jsonb_typeof(s) <> 'string'
                          or (s #>> '{}') not in ('name', 'phone', 'address', 'distance'))
                  end
           when e.key = 'rule'
             then case
                    when jsonb_typeof(e.value) <> 'string' then false
                    else (e.value #>> '{}') in ('phone_locality_name', 'phone_locality_review',
                                                'over_25km', 'sab_phone_city')
                  end
           when e.key in ('city', 'sab', 'listingPhone', 'listingLocation')
             then e.value in ('0'::jsonb, '1'::jsonb)
           else false
         end))
  end
$$;
--> statement-breakpoint

-- T-3-11 made a database fact — Places text cannot be stored in features even if the
-- application regresses. The writer below is the only production path, and toPageRecord
-- refuses the same shapes first; this is the wall behind both (M36).
alter table place_attachments add constraint pa_features_numeric check (app.places_features_ok(features));
--> statement-breakpoint

-- ===========================================================================
-- 2. app.record_places_page — one Enterprise page, persisted.
-- ===========================================================================
--
-- p_record is src/lib/places/page-record.ts PageRecord: { page, sku, resultsSoFar, places[] },
-- each place { placeId, outOfArea, pureSab, hadWebsiteUri, hostClass, lat, lng, matches[] },
-- each match { businessId, score, status, reason, tieBusinessId, features }. Only ids,
-- numbers, enums and booleans cross this boundary; every value is read with a typed cast.
--
-- Per place:
--   a. membership: upserted on (tile_id, place_id); a re-seen member is revived (gone_at null).
--   b. outOfArea → outcome 'outside', never an attachment (D-06); its matches are ignored.
--   c. each match: the business (and a tie's other business) re-read under this org (42501);
--      a merged business is skipped (the candidate query excludes merged rows — this is the
--      race). The attachment is upserted, and the upsert's WHERE is the stickiness (D-05,
--      M40): a rejected pair and a human-confirmed attachment are never re-scored. A final
--      attached/tentative status appends ONE observation per (run, business, place) — a second
--      page carrying the place again inserts nothing — and, when that insert happened and the
--      listing had a pin, its coordinate with expires_at = observed_at + 30 days exactly (D-10).
--   d. the outcome per (run, place, cluster) keeps the higher rank: attached 3 > tentative 2 >
--      unmatched 1 > outside 0. A rejected pair is 'unmatched' (only its place id is kept).
-- Then the search: pages_done = greatest(pages_done, page), results_count = resultsSoFar, the
-- in-flight pair cleared (the page settled; 04-RESEARCH Pattern 2). Returns this page's counts.
create or replace function app.record_places_page(p_search uuid, p_record jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_run uuid; v_tile uuid; v_cluster text; v_kind text;
  v_page int; v_sku text; v_results int;
  pl jsonb; m jsonb; v_place text; v_host text; v_had boolean; v_pure boolean;
  v_lat double precision; v_lng double precision;
  v_biz uuid; v_tie uuid; v_merged uuid; v_status text; v_reason text; v_score int;
  v_att uuid; v_final text; v_obs uuid; v_obs_at timestamptz;
  v_any_att boolean; v_any_ten boolean; v_outcome text;
  n_att int := 0; n_ten int := 0; n_unm int := 0; n_out int := 0;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'record_places_page: no current org' using errcode = '42501';
  end if;

  select s.run_id, s.tile_id, s.cluster_key, s.kind into v_run, v_tile, v_cluster, v_kind
    from run_searches s where s.id = p_search and s.org_id = v_org
     for update of s;
  if not found then
    raise exception 'record_places_page: search belongs to another org or does not exist'
      using errcode = '42501';
  end if;
  -- An ids-only search is a change check: its page is a membership diff
  -- (app.record_change_check), and carries no fields to attach or observe.
  if v_kind <> 'enterprise' then
    raise exception 'record_places_page: search is not an enterprise search' using errcode = '22023';
  end if;

  if p_record is null or jsonb_typeof(p_record) <> 'object'
     or jsonb_typeof(p_record->'page') is distinct from 'number'
     or jsonb_typeof(p_record->'resultsSoFar') is distinct from 'number'
     or jsonb_typeof(p_record->'places') is distinct from 'array' then
    raise exception 'record_places_page: record must carry page, sku, resultsSoFar and places'
      using errcode = '22023';
  end if;
  v_page := (p_record->>'page')::int;
  if v_page not between 1 and 3 then
    raise exception 'record_places_page: page must be 1, 2 or 3' using errcode = '22023';
  end if;
  v_sku := p_record->>'sku';
  if v_sku is null or v_sku not in ('ts_enterprise', 'ts_essentials') then
    raise exception 'record_places_page: unknown sku' using errcode = '22023';
  end if;
  v_results := (p_record->>'resultsSoFar')::int;
  if v_results < 0 then
    raise exception 'record_places_page: resultsSoFar must be non-negative' using errcode = '22023';
  end if;

  for pl in select e.value from jsonb_array_elements(p_record->'places') e loop
    if jsonb_typeof(pl) <> 'object'
       or jsonb_typeof(pl->'placeId') is distinct from 'string'
       or jsonb_typeof(pl->'outOfArea') is distinct from 'boolean'
       or jsonb_typeof(pl->'pureSab') is distinct from 'boolean'
       or jsonb_typeof(pl->'hadWebsiteUri') is distinct from 'boolean'
       or jsonb_typeof(pl->'hostClass') is distinct from 'string'
       or jsonb_typeof(pl->'matches') is distinct from 'array' then
      raise exception 'record_places_page: a place is missing a contract key' using errcode = '22023';
    end if;
    v_place := pl->>'placeId';
    -- A Places id is URL-safe base64-ish. Anything else — a space, a comma — is not an id, and
    -- this column is the one Google value kept indefinitely (PLACE-02). The length is its own
    -- test: a regex repetition bound above 255 is itself an error (2201B) in Postgres.
    if length(v_place) > 512 or v_place !~ '^[A-Za-z0-9_-]+$' then
      raise exception 'record_places_page: placeId is not a place id' using errcode = '22023';
    end if;
    v_host := pl->>'hostClass';
    v_had := (pl->>'hadWebsiteUri')::boolean;
    v_pure := (pl->>'pureSab')::boolean;
    if jsonb_typeof(pl->'lat') = 'number' and jsonb_typeof(pl->'lng') = 'number' then
      v_lat := (pl->>'lat')::double precision;
      v_lng := (pl->>'lng')::double precision;
    else
      v_lat := null;
      v_lng := null;
    end if;

    -- a. Membership. D-06: the place id is all an unmatched listing leaves behind.
    insert into place_tile_members as t (org_id, tile_id, place_id)
         values (v_org, v_tile, v_place)
    on conflict (tile_id, place_id) do update set last_seen_at = now(), gone_at = null;

    if (pl->>'outOfArea')::boolean then
      -- b. Outside the US: a member and an outcome, never an attachment.
      v_outcome := 'outside';
    else
      v_any_att := false;
      v_any_ten := false;
      for m in select e.value from jsonb_array_elements(pl->'matches') e loop
        if jsonb_typeof(m) <> 'object' then
          raise exception 'record_places_page: a match must be an object' using errcode = '22023';
        end if;
        v_status := m->>'status';
        v_reason := m->>'reason';
        if v_status is null or v_status not in ('attached', 'tentative') then
          raise exception 'record_places_page: match status must be attached or tentative'
            using errcode = '22023';
        end if;
        if v_reason is null or v_reason not in ('score', 'tie') then
          raise exception 'record_places_page: match reason must be score or tie'
            using errcode = '22023';
        end if;
        v_score := (m->>'score')::int;

        -- c. The business, re-read under this org (T-4-06).
        select b.merged_into_id into v_merged
          from businesses b where b.id = (m->>'businessId')::uuid and b.org_id = v_org;
        if not found then
          raise exception 'record_places_page: business belongs to another org or does not exist'
            using errcode = '42501';
        end if;
        v_biz := (m->>'businessId')::uuid;

        v_tie := null;
        if jsonb_typeof(m->'tieBusinessId') = 'string' then
          v_tie := (m->>'tieBusinessId')::uuid;
          perform 1 from businesses b where b.id = v_tie and b.org_id = v_org;
          if not found then
            raise exception 'record_places_page: tie business belongs to another org or does not exist'
              using errcode = '42501';
          end if;
        end if;

        -- Merged away between the candidate query and this write: never attach a merged row.
        if v_merged is not null then
          continue;
        end if;

        v_att := null;
        v_final := null;
        insert into place_attachments (org_id, business_id, place_id, status, reason, score,
                                       features, tie_business_id, first_seen_run_id,
                                       last_seen_run_id)
             values (v_org, v_biz, v_place, v_status, v_reason, v_score, m->'features', v_tie,
                     v_run, v_run)
        on conflict (org_id, business_id, place_id) do update
               set status = excluded.status, reason = excluded.reason, score = excluded.score,
                   features = excluded.features, tie_business_id = excluded.tie_business_id,
                   last_seen_run_id = excluded.last_seen_run_id
             where place_attachments.status <> 'rejected' and place_attachments.reason <> 'confirmed'
        returning place_attachments.id, place_attachments.status into v_att, v_final;

        if v_att is null then
          -- Sticky (D-05, M40): a rejected pair or a confirmed attachment, left as it was.
          select pa.id, pa.status into v_att, v_final
            from place_attachments pa
           where pa.org_id = v_org and pa.business_id = v_biz and pa.place_id = v_place;
          if not found then
            raise exception 'record_places_page: attachment vanished' using errcode = '55000';
          end if;
        end if;

        if v_final in ('attached', 'tentative') then
          v_obs := null;
          v_obs_at := null;
          insert into place_observations as po (org_id, business_id, place_id, run_id,
                                                attachment_id, had_website_uri, host_class, sku,
                                                pure_sab)
               values (v_org, v_biz, v_place, v_run, v_att, v_had, v_host, v_sku, v_pure)
          on conflict (run_id, business_id, place_id) do nothing
          returning po.id, po.observed_at into v_obs, v_obs_at;

          if v_obs is not null and v_lat is not null and v_lng is not null then
            insert into place_coordinates (org_id, observation_id, lat, lng, observed_at, expires_at)
                 values (v_org, v_obs, v_lat, v_lng, v_obs_at, v_obs_at + interval '30 days');
          end if;
        end if;

        if v_final = 'attached' then
          v_any_att := true;
        elsif v_final = 'tentative' then
          v_any_ten := true;
        end if;
      end loop;

      v_outcome := case when v_any_att then 'attached'
                        when v_any_ten then 'tentative'
                        else 'unmatched' end;
    end if;

    -- d. The outcome for this place in this cluster; a second page keeps the higher rank.
    insert into run_place_outcomes as o (org_id, run_id, place_id, cluster_key, outcome)
         values (v_org, v_run, v_place, v_cluster, v_outcome)
    on conflict (run_id, place_id, cluster_key) do update set outcome = excluded.outcome
     where (case excluded.outcome when 'attached' then 3 when 'tentative' then 2
                                  when 'unmatched' then 1 else 0 end)
         > (case o.outcome when 'attached' then 3 when 'tentative' then 2
                           when 'unmatched' then 1 else 0 end);

    if v_outcome = 'attached' then n_att := n_att + 1;
    elsif v_outcome = 'tentative' then n_ten := n_ten + 1;
    elsif v_outcome = 'unmatched' then n_unm := n_unm + 1;
    else n_out := n_out + 1;
    end if;
  end loop;

  -- The progress keys app.mark_run_search cannot write (04-11). A planned search starts
  -- searching; a done or stopped one is never moved back by a replayed page.
  update run_searches s
     set status = case when s.status = 'planned' then 'searching' else s.status end,
         pages_done = greatest(s.pages_done, v_page),
         results_count = v_results,
         inflight_reservation_id = null,
         inflight_request_id = null
   where s.id = p_search and s.org_id = v_org;

  return jsonb_build_object('attached', n_att, 'tentative', n_ten, 'unmatched', n_unm,
                            'outside', n_out);
end $$;
--> statement-breakpoint

-- ===========================================================================
-- 3. app.record_change_check — the ids-only membership diff (D-16).
-- ===========================================================================
--
-- p_added / p_gone are json arrays of place ids (04-19's diffTile); p_seen is how many ids the
-- check saw. Added ids are inserted (a returning member is revived), gone ids get gone_at —
-- 🔴 never a delete: membership history is what the next diff reads. The tile's
-- last_checked_at always moves; changed_at only for a verdict that means the set changed.
create or replace function app.record_change_check(p_search uuid, p_added jsonb, p_gone jsonb,
                                                   p_verdict text, p_seen int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_tile uuid; v_kind text;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'record_change_check: no current org' using errcode = '42501';
  end if;

  select s.tile_id, s.kind into v_tile, v_kind
    from run_searches s where s.id = p_search and s.org_id = v_org
     for update of s;
  if not found then
    raise exception 'record_change_check: search belongs to another org or does not exist'
      using errcode = '42501';
  end if;
  if v_kind <> 'ids_only' then
    raise exception 'record_change_check: search is not an ids_only change check'
      using errcode = '22023';
  end if;
  if p_verdict is null
     or p_verdict not in ('baseline', 'unchanged', 'new', 'gone', 'both', 'saturated') then
    raise exception 'record_change_check: unknown verdict' using errcode = '22023';
  end if;
  if p_added is null or jsonb_typeof(p_added) <> 'array'
     or p_gone is null or jsonb_typeof(p_gone) <> 'array' then
    raise exception 'record_change_check: added and gone must be json arrays' using errcode = '22023';
  end if;
  if p_seen is null or p_seen < 0 then
    raise exception 'record_change_check: seen must be non-negative' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_added || p_gone) e
              where jsonb_typeof(e.value) <> 'string'
                 or length(e.value #>> '{}') > 512
                 or (e.value #>> '{}') !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'record_change_check: an id is not a place id' using errcode = '22023';
  end if;

  insert into place_tile_members as t (org_id, tile_id, place_id)
  select v_org, v_tile, x.id from jsonb_array_elements_text(p_added) as x(id)
  on conflict (tile_id, place_id) do update set gone_at = null, last_seen_at = now();

  update place_tile_members t set gone_at = now()
   where t.tile_id = v_tile and t.org_id = v_org and t.gone_at is null
     and t.place_id in (select jsonb_array_elements_text(p_gone));

  update place_tiles pt
     set last_checked_at = now(),
         changed_at = case when p_verdict in ('new', 'gone', 'both', 'saturated') then now()
                           else pt.changed_at end
   where pt.id = v_tile and pt.org_id = v_org;

  update run_searches s
     set change_verdict = p_verdict,
         new_ids = jsonb_array_length(p_added),
         gone_ids = jsonb_array_length(p_gone),
         results_count = p_seen,
         pages_done = greatest(s.pages_done, 1),
         inflight_reservation_id = null,
         inflight_request_id = null
   where s.id = p_search and s.org_id = v_org;
end $$;
--> statement-breakpoint

-- ===========================================================================
-- 4. app.decide_place_attachment — a human's listing decision (D-05).
-- ===========================================================================
--
-- confirm: tentative → attached / confirmed. reject: tentative → rejected / rejected.
-- detach: attached → rejected / detached. Each UPDATE is conditional on the state it moves
-- FROM, so a decided listing is 55000 'already decided' (the record_candidate_decision rule),
-- and two reviewers racing the same listing decide it once. The actor is read from the claims,
-- never passed. place_attachments_event_upd (0027) writes the one events row per status change.
create or replace function app.decide_place_attachment(p_attachment uuid, p_decision text)
returns table (business_id uuid, place_id text, status text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_org uuid; v_actor text; v_id uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'decide_place_attachment: no current org' using errcode = '42501';
  end if;
  v_actor := coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system');

  if p_decision is null or p_decision not in ('confirm', 'reject', 'detach') then
    raise exception 'decide_place_attachment: decision must be confirm, reject or detach'
      using errcode = '22023';
  end if;

  select a.id into v_id from place_attachments a where a.id = p_attachment and a.org_id = v_org;
  if not found then
    raise exception 'decide_place_attachment: attachment belongs to another org or does not exist'
      using errcode = '42501';
  end if;

  if p_decision = 'confirm' then
    return query
      update place_attachments a
         set status = 'attached', reason = 'confirmed', decided_by = v_actor, decided_at = now()
       where a.id = v_id and a.org_id = v_org and a.status = 'tentative'
      returning a.business_id, a.place_id, a.status;
  elsif p_decision = 'reject' then
    return query
      update place_attachments a
         set status = 'rejected', reason = 'rejected', decided_by = v_actor, decided_at = now()
       where a.id = v_id and a.org_id = v_org and a.status = 'tentative'
      returning a.business_id, a.place_id, a.status;
  else
    return query
      update place_attachments a
         set status = 'rejected', reason = 'detached', decided_by = v_actor, decided_at = now()
       where a.id = v_id and a.org_id = v_org and a.status = 'attached'
      returning a.business_id, a.place_id, a.status;
  end if;
  if not found then
    raise exception 'decide_place_attachment: already decided' using errcode = '55000';
  end if;
end $$;
--> statement-breakpoint

-- ===========================================================================
-- 5. Grants. Each role named (see the header): authenticated executes; public, anon and
-- service_role do not. The owner (migrations, desk scripts) needs no grant.
-- ===========================================================================
revoke execute on function
  app.places_features_ok(jsonb),
  app.record_places_page(uuid, jsonb),
  app.record_change_check(uuid, jsonb, jsonb, text, integer),
  app.decide_place_attachment(uuid, text)
  from public, anon, service_role;
--> statement-breakpoint

grant execute on function
  app.places_features_ok(jsonb),
  app.record_places_page(uuid, jsonb),
  app.record_change_check(uuid, jsonb, jsonb, text, integer),
  app.decide_place_attachment(uuid, text)
  to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 6. One comment per function.
-- ===========================================================================
comment on function app.places_features_ok(jsonb) is
  'T-3-11 / T-4-05 / M36. True iff a place_attachments.features value is an object whose keys are the 13 allow-listed feature keys (src/lib/places/page-record.ts FEATURE_KEYS) with numbers (distanceM also null), a signals array of name|phone|address|distance, a rule enum, and 0|1 flags. Backs the pa_features_numeric CHECK: Places text cannot be stored in features even if the application regresses.';
--> statement-breakpoint

comment on function app.record_places_page(uuid, jsonb) is
  'D-05 / D-06 / D-08 / D-10 / PLACE-02. The one writer of an Enterprise page (a PageRecord from toPageRecord): tile membership, attachments (a rejected pair and a confirmed attachment are sticky), one observation per (run, business, place) and its coordinate expiring exactly 30 days after observed_at, the per-cluster outcome (highest rank kept), and pages_done / results_count with the in-flight pair cleared. Merged businesses are skipped. Returns this page''s outcome counts. 42501 foreign-or-missing search or business, 22023 malformed record or non-enterprise search.';
--> statement-breakpoint

comment on function app.record_change_check(uuid, jsonb, jsonb, text, integer) is
  'D-16. The ids-only change check''s membership diff: added ids inserted (revived when returning), gone ids marked gone_at (never deleted), the tile''s last_checked_at moved and changed_at set for new|gone|both|saturated, and change_verdict / new_ids / gone_ids / results_count / pages_done on the search with the in-flight pair cleared. 42501 foreign-or-missing search, 22023 non-ids_only search, unknown verdict or malformed ids.';
--> statement-breakpoint

comment on function app.decide_place_attachment(uuid, text) is
  'D-05. A reviewer''s listing decision: confirm (tentative -> attached/confirmed), reject (tentative -> rejected/rejected) or detach (attached -> rejected/detached), decided_by from the claims. Pending-only: a listing not in the from-state is 55000 already decided. 22023 unknown decision, 42501 foreign-or-missing attachment. The status change writes one events row (place_attachments_event_upd).';

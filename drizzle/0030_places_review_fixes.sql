-- Phase 4 code review (04-REVIEW-partA / partB), slice A: the SQL half of the fixes. Every
-- section names the finding it closes. Hand-written via `pnpm db:custom` (generate --custom);
-- drizzle-kit stays the single migration authority (D-09). No column is added or dropped, so
-- the 0030 snapshot equals 0029's.
--
-- 🔴 RE-RUNNABLE ON PURPOSE. Every statement is `create or replace`, `drop … if exists` then
-- create, or a revoke/grant — so the migration applies cleanly to a database where a section
-- was already applied by hand while it was being written (the local test database), and
-- identically to production, where none of it exists yet.
--
-- Definer discipline (0024, 0025, 0028, 0029), restated for every function this file touches:
-- search_path = public, pg_temp on the same statement; the org from app.current_org_id(),
-- never a parameter; every caller-supplied uuid re-read with org_id = v_org; an explicit
-- `if not found` after every `select … into`; refusal messages never echo a caller value.
-- 🔴 `revoke … from public` alone does nothing useful: 0000_bootstrap's default privileges hand
-- every new app.* function an EXPLICIT execute grant for authenticated, anon and service_role,
-- so each role is named, and the grants are re-asserted for every function replaced here.
--
-- 🔴 PG17-compatible SQL only (tests/unit/pg17-compat.test.ts): production is 17.6.

-- ===========================================================================
-- 1. A-WR-06 — app.places_features_ok is the legal line: 11 keys, integer points.
-- ===========================================================================
--
-- Since 2026-09-23 the persisted feature set is src/lib/places/page-record.ts FEATURE_KEYS (11):
-- name, phone, address, distance, cluster (INTEGER points — cluster may be negative, -10 for a
-- different cluster), signals, rule, city, sab, listingPhone, listingLocation. The continuous,
-- Google-derived nameSim and distanceM are memory-only and are now refused here too (`else
-- false`), so a regression in toPageRecord can no longer persist them silently. A non-integer
-- under a points key is refused: a continuous similarity cannot hide under `name`.
--
-- The constraint is DROPPED and RE-ADDED around the new body so existing rows are re-validated
-- against it (a bare `create or replace` would leave any old row unchecked). Production held
-- zero place_attachments rows at 0029 (no Places call has been made); the pre-flight read in
-- the fix report confirms it before apply.
alter table place_attachments drop constraint if exists pa_features_numeric;
--> statement-breakpoint

create or replace function app.places_features_ok(f jsonb) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
    when f is null or jsonb_typeof(f) <> 'object' then false
    else not exists (
      select 1 from jsonb_each(f) e
       where not (
         case
           when e.key in ('name', 'phone', 'address', 'distance', 'cluster')
             then case
                    when jsonb_typeof(e.value) <> 'number' then false
                    else (e.value #>> '{}')::numeric = trunc((e.value #>> '{}')::numeric)
                  end
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

alter table place_attachments add constraint pa_features_numeric check (app.places_features_ok(features));
--> statement-breakpoint

revoke execute on function app.places_features_ok(jsonb) from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.places_features_ok(jsonb) to authenticated;
--> statement-breakpoint

comment on function app.places_features_ok(jsonb) is
  'T-3-11 / T-4-05 / M36 / A-WR-06. True iff a place_attachments.features value is an object whose keys are drawn from the 11 persisted feature keys (src/lib/places/page-record.ts FEATURE_KEYS): name, phone, address, distance, cluster as INTEGER points; signals, an array of name|phone|address|distance; rule, one of four enums; city, sab, listingPhone, listingLocation as 0|1. The continuous nameSim / distanceM are memory-only and refused. Backs the pa_features_numeric CHECK: the legal line (D-13) holds at the table even if the application regresses.';
--> statement-breakpoint

-- ===========================================================================
-- 2. app.record_places_page — the Enterprise page writer, re-issued.
-- ===========================================================================
--
-- The 0029 body, with these changes (each named where it lands):
--   * A-WR-07 — an enterprise search records ts_enterprise pages only. An Essentials (IDs-only)
--     page carries no websiteUri, so every observation written from one would be a false
--     had_website_uri = false in an append-only table (D-10). 22023.
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
  -- A-WR-07. The one combination that writes false "no website" observations: an IDs-only
  -- page carries no websiteUri. Only the Enterprise SKU is a page this writer may record.
  if v_sku is distinct from 'ts_enterprise' then
    raise exception 'record_places_page: an enterprise search records ts_enterprise pages only'
      using errcode = '22023';
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

revoke execute on function app.record_places_page(uuid, jsonb) from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.record_places_page(uuid, jsonb) to authenticated;
--> statement-breakpoint

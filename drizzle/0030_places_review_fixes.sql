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
--   * A-WR-01 — the attachment upsert never downgrades an auto-attached listing to tentative.
--     The scorer's cluster feature compares the business's cluster with the SEARCH's, so one
--     pair scores differently in two clusters' searches; last-writer-wins made the status
--     depend on step order, wrote an events row per flip and dropped the listing from
--     business_place_signal. Rejected and confirmed rows stay sticky exactly as before (M40).
--   * A-WR-03 (3) — a tie is always tentative and always names its other business, and a score
--     match never names one (D-08). 0029 validated status and reason independently, so
--     (attached, tie) was accepted. 22023.
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
        -- A-WR-03 (3). D-08: a tie is always tentative and always names its other business;
        -- a score match never carries a tie pointer. Status and reason are no longer
        -- validated independently.
        if v_reason = 'tie' and v_status <> 'tentative' then
          raise exception 'record_places_page: a tie is always tentative' using errcode = '22023';
        end if;
        if (v_reason = 'tie') <> coalesce(jsonb_typeof(m->'tieBusinessId') = 'string', false) then
          raise exception 'record_places_page: a tie names its other business, and only a tie does'
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
        -- A-WR-01. NEVER A DOWNGRADE. An auto-attached row (status attached, reason score) keeps
        -- its status, reason, score, features and tie pointer when a later match of the same
        -- pair comes in tentative — e.g. the same place found by another cluster's search,
        -- which scores the cluster feature against a different cluster. Only a human moves an
        -- attached row down (decide_place_attachment 'detach'). Every other case takes the new
        -- match as one unit, so status, reason, score, features and tie never disagree.
        on conflict (org_id, business_id, place_id) do update
               set status = case when place_attachments.status = 'attached'
                                  and excluded.status <> 'attached'
                                 then place_attachments.status else excluded.status end,
                   reason = case when place_attachments.status = 'attached'
                                  and excluded.status <> 'attached'
                                 then place_attachments.reason else excluded.reason end,
                   score = case when place_attachments.status = 'attached'
                                 and excluded.status <> 'attached'
                                then place_attachments.score else excluded.score end,
                   features = case when place_attachments.status = 'attached'
                                    and excluded.status <> 'attached'
                                   then place_attachments.features else excluded.features end,
                   tie_business_id = case when place_attachments.status = 'attached'
                                           and excluded.status <> 'attached'
                                          then place_attachments.tie_business_id
                                          else excluded.tie_business_id end,
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

-- ===========================================================================
-- 3. A-WR-03 — app.decide_place_attachment decides a tie as a PAIR.
-- ===========================================================================
--
-- D-08: a tie is decided, not duplicated. In 0029, confirming one side of a tie moved only that
-- row; the other side stayed tentative/tie in /review ("ties with <the business just
-- confirmed>"), a second reviewer could confirm it too, and one place_id was then attached to
-- two businesses — business_place_signal attributing that listing's website to both.
--
-- Now, when the row being confirmed is a tentative tie, its other side — the row for the SAME
-- place and the business its tie_business_id names, re-read under this org — is:
--   * rejected (reason 'rejected', decided_by the same reviewer) in the same statement when it
--     is tentative or auto-attached (reason score/tie): a later run may have matched the place
--     to that side alone and rewritten it to attached/score while this row still names it
--     (A-WR-03 part 2 — the stale pointer is resolved here, at the human decision);
--   * a 55000 'already decided' refusal when a human already CONFIRMED it: the tie was decided
--     the other way, and confirming this side would attach the place twice;
--   * left alone when it is already rejected or does not exist.
-- Both rows are locked (for update) before either is judged, so two reviewers confirming the
-- two sides at once serialise and the second is refused.
--
-- reject and detach are unchanged: rejecting one side leaves the other for its own decision.
-- The return value is still the ONE row the caller decided. The rejection of the other side
-- writes its own events row through the status-change trigger.
create or replace function app.decide_place_attachment(p_attachment uuid, p_decision text)
returns table (business_id uuid, place_id text, status text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_org uuid; v_actor text; v_id uuid; v_place text; v_status text; v_reason text;
        v_tie uuid; v_other uuid; v_other_status text; v_other_reason text;
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

  select a.id, a.place_id, a.status, a.reason, a.tie_business_id
    into v_id, v_place, v_status, v_reason, v_tie
    from place_attachments a
   where a.id = p_attachment and a.org_id = v_org
     for update of a;
  if not found then
    raise exception 'decide_place_attachment: attachment belongs to another org or does not exist'
      using errcode = '42501';
  end if;

  if p_decision = 'confirm' then
    v_other := null;
    if v_status = 'tentative' and v_reason = 'tie' and v_tie is not null then
      select o.id, o.status, o.reason into v_other, v_other_status, v_other_reason
        from place_attachments o
       where o.org_id = v_org and o.place_id = v_place and o.business_id = v_tie
         for update of o;
      if found and v_other_status = 'attached' and v_other_reason = 'confirmed' then
        raise exception 'decide_place_attachment: already decided' using errcode = '55000';
      end if;
    end if;

    return query
      update place_attachments a
         set status = 'attached', reason = 'confirmed', decided_by = v_actor, decided_at = now()
       where a.id = v_id and a.org_id = v_org and a.status = 'tentative'
      returning a.business_id, a.place_id, a.status;
    if not found then
      raise exception 'decide_place_attachment: already decided' using errcode = '55000';
    end if;

    if v_other is not null and v_other_status <> 'rejected' then
      update place_attachments o
         set status = 'rejected', reason = 'rejected', decided_by = v_actor, decided_at = now()
       where o.id = v_other and o.org_id = v_org
         and o.status <> 'rejected' and o.reason <> 'confirmed';
    end if;
  elsif p_decision = 'reject' then
    return query
      update place_attachments a
         set status = 'rejected', reason = 'rejected', decided_by = v_actor, decided_at = now()
       where a.id = v_id and a.org_id = v_org and a.status = 'tentative'
      returning a.business_id, a.place_id, a.status;
    if not found then
      raise exception 'decide_place_attachment: already decided' using errcode = '55000';
    end if;
  else
    return query
      update place_attachments a
         set status = 'rejected', reason = 'detached', decided_by = v_actor, decided_at = now()
       where a.id = v_id and a.org_id = v_org and a.status = 'attached'
      returning a.business_id, a.place_id, a.status;
    if not found then
      raise exception 'decide_place_attachment: already decided' using errcode = '55000';
    end if;
  end if;
end $$;
--> statement-breakpoint

revoke execute on function app.decide_place_attachment(uuid, text) from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.decide_place_attachment(uuid, text) to authenticated;
--> statement-breakpoint

comment on function app.decide_place_attachment(uuid, text) is
  'D-05 / D-08 / A-WR-03. A reviewer''s listing decision: confirm (tentative -> attached/confirmed), reject (tentative -> rejected/rejected) or detach (attached -> rejected/detached), decided_by from the claims. Confirming one side of a tentative tie rejects the other side''s row for the same place in the same statement (55000 when a human already confirmed that side). Pending-only: a listing not in the from-state is 55000 already decided. 22023 unknown decision, 42501 foreign-or-missing attachment. Returns the one row decided; each status change writes one events row.';
--> statement-breakpoint

-- ===========================================================================
-- 4. A-WR-02 / B-WR-03 — app.record_change_check: a saturated listing proves nothing gone.
-- ===========================================================================
--
-- A saturated IDs-only listing is Google's top 60 (Text Search's cap). A stored member that is
-- merely past the cap is hidden, not gone — and saturation is the normal state of exactly the
-- dense tiles change checks exist for. 0029 applied p_gone whatever the verdict, writing
-- gone_at onto members that still exist; the next check re-saw some as `added`, and the
-- membership history (what the next diff and overlapWithParent read) went wrong.
--
-- The writer now REFUSES gone ids on a saturated check (22023) rather than quietly dropping
-- them: a caller that sends them holds a wrong belief about what the listing proved, and
-- swapping its values underneath it would leave that belief intact (the 0019 WR-03 rule).
-- src/lib/places/change-detect.ts diffTile returns gone = [] for a saturated listing (fixer B,
-- same review); both halves ship together. Otherwise the 0029 body, unchanged.
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
  -- A-WR-02 / B-WR-03. The 60-result cap hides; it does not delete.
  if p_verdict = 'saturated' and jsonb_array_length(p_gone) > 0 then
    raise exception 'record_change_check: a saturated listing cannot prove a member gone'
      using errcode = '22023';
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

revoke execute on function app.record_change_check(uuid, jsonb, jsonb, text, integer)
  from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.record_change_check(uuid, jsonb, jsonb, text, integer) to authenticated;
--> statement-breakpoint

comment on function app.record_change_check(uuid, jsonb, jsonb, text, integer) is
  'D-16 / A-WR-02. The ids-only change check''s membership diff: added ids inserted (revived when returning), gone ids marked gone_at (never deleted), the tile''s last_checked_at moved and changed_at set for new|gone|both|saturated, and change_verdict / new_ids / gone_ids / results_count / pages_done on the search with the in-flight pair cleared. A saturated listing (the 60 cap) cannot prove a member gone: gone ids with verdict saturated are 22023. 42501 foreign-or-missing search, 22023 non-ids_only search, unknown verdict or malformed ids.';
--> statement-breakpoint

-- ===========================================================================
-- 5. A-WR-04 — business_place_signal resolves LIVE ROOTS, so a merge strands nothing.
-- ===========================================================================
--
-- No merge definer (0024 / 0025) touches place_attachments, and record_places_page refuses to
-- attach to an already-merged business — but a listing that attached BEFORE its business was
-- merged away stayed keyed to the loser. The survivor's signal omitted it, so a survivor whose
-- only website-bearing listing came from the loser read "no website": a false positive in the
-- verdict input Phase 6 reads.
--
-- The view now groups by coalesce(b.merged_into_id, b.id). The merge definers keep
-- merged_into_id pointing at a LIVE root (0024 L29–30: a chain is re-pointed to the winner), so
-- one hop is the whole resolution. Nothing is re-pointed or copied: an unmerge (merged_into_id
-- back to null) restores the loser's own row by itself. The per-listing observation lookup is
-- unchanged (keyed to the attachment's own business_id). The loser, hidden everywhere once
-- merged, has no row of its own. Same columns, names and types as 0027, so `create or replace
-- view` applies; security_invoker stays on, so the caller's RLS on place_attachments,
-- businesses and place_observations still applies through it.
create or replace view business_place_signal with (security_invoker = true) as
select a.org_id, coalesce(b.merged_into_id, b.id) as business_id,
       bool_or(o.had_website_uri) as had_website_uri,
       (array_agg(o.host_class order by o.had_website_uri desc, o.observed_at desc, o.id desc))[1] as host_class,
       max(o.observed_at) as observed_at,
       count(*)::int as listings
  from place_attachments a
  join businesses b on b.id = a.business_id and b.org_id = a.org_id
  join lateral (
    select po.id, po.had_website_uri, po.host_class, po.observed_at
      from place_observations po
     where po.org_id = a.org_id and po.business_id = a.business_id and po.place_id = a.place_id
     order by po.observed_at desc, po.id desc
     limit 1
  ) o on true
 where a.status = 'attached'
 group by a.org_id, coalesce(b.merged_into_id, b.id);
--> statement-breakpoint

grant select on business_place_signal to authenticated;
--> statement-breakpoint

comment on view business_place_signal is
  'D-05/D-08/A-WR-04: tentative and rejected attachments are never a verdict input. True if ANY attached listing''s LATEST observation lists a website — leans against a false "no website" lead. Keyed by the LIVE ROOT business (coalesce(merged_into_id, id)), so a merged-away business''s attached listings count toward its survivor and an unmerge restores them with no data moved. security_invoker: the caller''s RLS applies through the view. Never selects coordinates. SELECT only for authenticated.';
--> statement-breakpoint

-- ===========================================================================
-- 6. A-WR-05 — the place_attachments audit copies ids and status, never score or features.
-- ===========================================================================
--
-- 0027 attached the generic app.log_event to place_attachments (UPDATE arm, status changes
-- only). app.log_event writes to_jsonb(old) and to_jsonb(new) — the WHOLE row, including the
-- Google-derived score and features — into `events`, which is immutable by grant (0007/0011):
-- those copies could never be purged, and the D-01 enumeration (docs/legal/
-- places-persistence.md) did not list them.
--
-- A dedicated trigger function now writes an ALLOW-LISTED payload: the row's ids, its status,
-- reason and tie pointer, and who decided when. No score, no features. place_id IS kept — it
-- is the one Google value the Maps Service Specific Terms (§A.3) permit caching, and an audit
-- row that cannot name the listing is useless — and the legal doc now lists `events` as a
-- place_id sink with indefinite retention. Append-only semantics are unchanged: it only ever
-- INSERTs into events, through the same actor resolution as app.log_event (Clerk sub, then the
-- app.actor_id GUC, then 'system'). The trigger keeps 0027's shape exactly: AFTER UPDATE, FOR
-- EACH ROW, WHEN the status changed.
--
-- SECURITY DEFINER for the same reason as app.log_event (authenticated holds no INSERT on
-- events, 0011). A trigger function cannot be called directly, and EXECUTE is revoked from
-- every role by name anyway; firing a trigger does not check EXECUTE.
--
-- Rows already in `events` are not rewritten (events is immutable; the fix report's
-- pre-flight read confirms production holds none for place_attachments).
create or replace function app.log_place_attachment_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'log_place_attachment_event: update trigger only' using errcode = '55000';
  end if;
  insert into events (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (
    new.org_id,
    coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system'),
    tg_table_name,
    new.id,
    'update',
    jsonb_build_object('id', old.id, 'org_id', old.org_id, 'business_id', old.business_id,
                       'place_id', old.place_id, 'status', old.status, 'reason', old.reason,
                       'tie_business_id', old.tie_business_id, 'decided_by', old.decided_by,
                       'decided_at', old.decided_at, 'last_seen_run_id', old.last_seen_run_id),
    jsonb_build_object('id', new.id, 'org_id', new.org_id, 'business_id', new.business_id,
                       'place_id', new.place_id, 'status', new.status, 'reason', new.reason,
                       'tie_business_id', new.tie_business_id, 'decided_by', new.decided_by,
                       'decided_at', new.decided_at, 'last_seen_run_id', new.last_seen_run_id)
  );
  return new;
end $$;
--> statement-breakpoint

revoke execute on function app.log_place_attachment_event()
  from public, anon, authenticated, service_role;
--> statement-breakpoint

drop trigger if exists place_attachments_event_upd on place_attachments;
--> statement-breakpoint

create trigger place_attachments_event_upd after update on place_attachments
  for each row when (old.status is distinct from new.status)
  execute function app.log_place_attachment_event();
--> statement-breakpoint

comment on function app.log_place_attachment_event() is
  'A-WR-05. The place_attachments audit trigger (AFTER UPDATE, status changes only): inserts ONE events row whose before/after carry an allow-list — id, org_id, business_id, place_id, status, reason, tie_business_id, decided_by, decided_at, last_seen_run_id — and never the Google-derived score or features. place_id is the Terms-exempt id and is retained indefinitely in events (docs/legal/places-persistence.md).';
--> statement-breakpoint

-- ===========================================================================
-- 7. A-WR-11 / B-CR-03 — app.plan_run_searches refreshes a tile's stored geometry.
-- ===========================================================================
--
-- place_tiles is keyed per (org, tile_key) and shared across runs and presets, and the key
-- names the unit, type and quad path — NOT the rectangle. 0028's `do update set updated_at`
-- kept the FIRST rectangle ever written, so:
--   * a re-run of scripts/fetch-geo-shapes.ts (TIGERweb or the city list changed) made sweeps
--     search the new rectangle while change checks, which read the rectangle from place_tiles,
--     searched the old one and diffed a different area (A-WR-11);
--   * two radius presets in one county with the same radius share a key (the centre is not in
--     the radius unit id), so preset B's change checks read preset A's ground (B-CR-03 — the
--     key itself is fixer B's half: src/lib/estimate/expand-cells.ts puts the centre in it).
--
-- The upsert now writes the incoming geometry (bounds, depth, quad path, unit and type) over
-- the stored one. Membership is left as history: the first check after a geometry change
-- diffs the new rectangle against members recorded for the old one, reports the churn once,
-- and flags the tile changed — which is what a moved tile should do (re-sweep candidate).
-- Refusing on a mismatch (the review's alternative) would leave an operator no path forward
-- short of hand-deleting tiles. Otherwise the 0028 body, unchanged.
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
    -- A-WR-11 / B-CR-03: the incoming geometry wins; the key does not encode it.
    on conflict on constraint place_tiles_key do update
       set updated_at = now(),
           unit_kind = excluded.unit_kind, unit_id = excluded.unit_id,
           places_type = excluded.places_type, quad_path = excluded.quad_path,
           depth = excluded.depth,
           south = excluded.south, west = excluded.west,
           north = excluded.north, east = excluded.east
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

revoke execute on function app.plan_run_searches(uuid, jsonb) from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.plan_run_searches(uuid, jsonb) to authenticated;
--> statement-breakpoint

comment on function app.plan_run_searches(uuid, jsonb) is
  'D-15 / D-16 / T-4-06 / A-WR-11. Records each planned (type x tile) search for an active run of the caller''s org: upserts place_tiles per (org, tile_key) — writing the incoming rectangle, depth, quad path, unit and type over the stored ones, so a re-fetched outline or a re-keyed preset never leaves change checks on stale geometry — inserts run_searches do-nothing per (run, tile_key), returns (search_id, tile_key); a replay returns the same ids. 42501 foreign-or-missing run (one message), 55000 inactive run, 22023 a kind that disagrees with the run (change_check <=> ids_only).';
--> statement-breakpoint

-- ===========================================================================
-- 8. A-WR-10 / B-WR-04 — app.mark_run_search retires a leaf's stale descendants.
-- ===========================================================================
--
-- 0028 set only the closing search's own tile: is_leaf = not subdivided. When a root that an
-- older sweep had split (children r0..r3 stored with is_leaf = true) is re-swept and no longer
-- saturates, the root became a leaf AND the old children stayed leaves. storedLeaves selects
-- every is_leaf tile under the root, so a change check listed the root and all four children:
-- overlapping rectangles, extra requests against the 100/day quota and the run ceiling, and
-- spurious new/gone verdicts from members recorded by the older sweep.
--
-- Now, when an ENTERPRISE search closes `done` with subdivided = false, every stored
-- descendant of its tile in this org — same unit_kind, unit_id and places_type, a quad path
-- that extends this one — is set is_leaf = false in the same call. Only the sweep defines the
-- tree: an ids_only change check lists an existing leaf and retires nothing. A subdivided close
-- retires nothing either (its children are this run's own, planned after it closes).
-- Otherwise the 0028 body, unchanged.
create or replace function app.mark_run_search(p_search uuid, p_state jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_run uuid; v_tile uuid; v_kind text; v_res uuid;
        v_status text; v_saturated boolean; v_subdivided boolean; v_truncated boolean;
        v_unit_kind text; v_unit_id text; v_type text; v_quad text;
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
     where t.id = v_tile and t.org_id = v_org
    returning t.unit_kind, t.unit_id, t.places_type, t.quad_path
         into v_unit_kind, v_unit_id, v_type, v_quad;

    -- A-WR-10 / B-WR-04. This tile is now a leaf of the current tree: no stored descendant of
    -- it may stay one. Same org, unit and type; a quad path that strictly extends this one.
    if v_kind = 'enterprise' and not v_subdivided and v_quad is not null then
      update place_tiles d set is_leaf = false
       where d.org_id = v_org and d.id <> v_tile and d.is_leaf
         and d.unit_kind = v_unit_kind and d.unit_id = v_unit_id and d.places_type = v_type
         and starts_with(d.quad_path, v_quad) and length(d.quad_path) > length(v_quad);
    end if;
  end if;
end $$;
--> statement-breakpoint

revoke execute on function app.mark_run_search(uuid, jsonb) from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.mark_run_search(uuid, jsonb) to authenticated;
--> statement-breakpoint

comment on function app.mark_run_search(uuid, jsonb) is
  'D-15 / D-16 / T-4-10 / A-WR-10. Moves one search''s progress through an allow-listed key set (status, saturated, subdivided, truncated, truncated_why, inflight_reservation_id, inflight_request_id; anything else 22023), coalesce(new, old) per key; JSON null clears the in-flight pair. An in-flight reservation must be this org''s and this run''s (42501). Status done updates the tile: is_leaf = not subdivided, saturated, truncated, and last_swept_* (enterprise) or last_checked_at (ids_only); an enterprise search closing unsubdivided also retires (is_leaf = false) every stored descendant of its tile, so an older, deeper tree never overlaps the new leaf.';
--> statement-breakpoint

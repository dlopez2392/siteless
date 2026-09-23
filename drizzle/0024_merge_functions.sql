-- Merge, unmerge and candidate decisions (D-14, D-19, D-20, DEDUP-02): the ONLY write path to
-- business_merges, business_aliases and merge_candidates. authenticated holds SELECT only on
-- all three (0023), so every write in this phase goes through one of the three definers below,
-- and each reads its own org and its own actor: neither is ever a parameter (T-3-08).
--
-- Hand-written via `pnpm db:custom --name=merge_functions` (generate --custom). drizzle-kit
-- remains the single migration authority; the schema itself does not change here.
--
-- READ THIS BEFORE EDITING ANY OF THE THREE. SECURITY DEFINER runs as the owner, so RLS does
-- not apply inside these bodies. Every one of them takes a caller-supplied uuid, and the
-- org predicate on every read and every write is the only thing standing between that uuid
-- and a cross-tenant write (T-3-10, T-3-16). A missing predicate is NOT a filtered no-op
-- here: it is a successful write into another tenant. Every select-into is followed by an
-- explicit not-found guard, because a plpgsql select-into that matches nothing leaves the
-- variable NULL and does not raise.
--
-- Two callers, one org resolution. The app tier arrives through withOrg (real Clerk claims);
-- the desk resolve pass (03-14) through resolveEtlOrg (03-09), which installs a
-- transaction-local request.jwt.claims of exactly {o:{id}}. app.current_org_id() reads that
-- GUC and nothing else, so there is no third way in and no p_org_id parameter.
--
-- Every parent survives, structurally: NOTHING HERE WRITES source_records. Each source record
-- keeps pointing at the business it created; only the winner's *_source_id provenance pairs
-- move, and the winner's pre-merge pairs are kept in business_merges.winner_fields_before.
-- The loser's fields are re-derived on unmerge from its own source records through the same
-- survive() the merge used (src/lib/resolve/survivorship.ts).
--
-- Clusters are flattened. A merge re-points both sides to their roots through
-- coalesce(merged_into_id, id) (mutation M25 removes that), and any business already merged
-- into the loser is re-pointed to the winner, so merged_into_id never points at a row that is
-- itself merged. Unmerge reverses exactly one merge, last-in-first-out, and puts every
-- business whose live merge chain runs through the loser back under the loser.

-- 1. THE SURVIVORSHIP-OWNED COLUMNS, IN ONE PLACE.
--
-- The snapshot a merge stores and the columns a merge or an unmerge may write are the same
-- fixed list. It is written once, here, so the snapshot can never cover fewer columns than the
-- apply writes. status, merged_into_id, org_id, external_key, name_norm and chain_key are NOT
-- on it: a caller-supplied jsonb can never reach them.
--
-- Both helpers are SECURITY INVOKER with execute revoked from PUBLIC: they are reached only
-- from inside the three definers (which run as the owner), never directly by a session.
create or replace function app.survivorship_snapshot(p_org uuid, p_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'legal_name', b.legal_name, 'legal_name_source_id', b.legal_name_source_id,
    'display_name', b.display_name, 'display_name_source_id', b.display_name_source_id,
    'phone_e164', b.phone_e164, 'phone_blockable', b.phone_blockable,
    'phone_source_id', b.phone_source_id,
    'street', b.street, 'street_num', b.street_num, 'street_norm', b.street_norm,
    'unit', b.unit, 'postal', b.postal, 'city', b.city,
    'address_source_id', b.address_source_id,
    'lat', b.lat, 'lng', b.lng, 'location_match_type', b.location_match_type,
    'location_source_id', b.location_source_id,
    'closed_at', b.closed_at, 'closed_at_source_id', b.closed_at_source_id,
    'basic_category', b.basic_category, 'cluster_key', b.cluster_key,
    'confidence', b.confidence, 'operating_status', b.operating_status)
    from businesses b
   where b.id = p_id and b.org_id = p_org
$$;
--> statement-breakpoint

-- Applies a survivorship jsonb to one business. A key that is absent keeps its current value
-- (jsonb_populate_record over the row itself); a key present as null writes NULL. Unknown keys
-- are refused, and every cited source record must belong to the same org: the composite
-- provenance FKs check durability, not tenancy, so without this read a caller could make a
-- business cite another tenant's source record. (A read of the provenance target, never a
-- write: see the header.)
create or replace function app.apply_survivorship(
  p_org uuid, p_id uuid, p_fields jsonb, p_caller text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_bad text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception '%: survivorship fields must be a json object', p_caller using errcode = '22023';
  end if;

  select k into v_bad
    from jsonb_object_keys(p_fields) k
   where k not in (
     'legal_name', 'legal_name_source_id', 'display_name', 'display_name_source_id',
     'phone_e164', 'phone_blockable', 'phone_source_id',
     'street', 'street_num', 'street_norm', 'unit', 'postal', 'city', 'address_source_id',
     'lat', 'lng', 'location_match_type', 'location_source_id',
     'closed_at', 'closed_at_source_id',
     'basic_category', 'cluster_key', 'confidence', 'operating_status')
   limit 1;
  if v_bad is not null then
    raise exception '%: % is not a survivorship field', p_caller, v_bad using errcode = '22023';
  end if;

  select cited.id::text into v_bad
    from (
      select (p_fields ->> k)::uuid as id
        from unnest(array['legal_name_source_id', 'display_name_source_id', 'phone_source_id',
                          'address_source_id', 'location_source_id', 'closed_at_source_id']) k
       where p_fields ->> k is not null
    ) cited
   where not exists (
     select 1 from source_records sr where sr.id = cited.id and sr.org_id = p_org)
   limit 1;
  if v_bad is not null then
    raise exception '%: cited source record not in this org', p_caller using errcode = '42501';
  end if;

  update businesses b
     set (legal_name, legal_name_source_id, display_name, display_name_source_id,
          phone_e164, phone_blockable, phone_source_id,
          street, street_num, street_norm, unit, postal, city, address_source_id,
          lat, lng, location_match_type, location_source_id,
          closed_at, closed_at_source_id,
          basic_category, cluster_key, confidence, operating_status)
       = (select r.legal_name, r.legal_name_source_id, r.display_name, r.display_name_source_id,
                 r.phone_e164, r.phone_blockable, r.phone_source_id,
                 r.street, r.street_num, r.street_norm, r.unit, r.postal, r.city,
                 r.address_source_id,
                 r.lat, r.lng, r.location_match_type, r.location_source_id,
                 r.closed_at, r.closed_at_source_id,
                 r.basic_category, r.cluster_key, r.confidence, r.operating_status
            from jsonb_populate_record(b, p_fields) r)
   where b.id = p_id and b.org_id = p_org;
  if not found then
    raise exception '%: business not in this org', p_caller using errcode = '42501';
  end if;
end $$;
--> statement-breakpoint

-- 🔴 `from public` ALONE DOES NOTHING USEFUL HERE. 0000_bootstrap sets
-- `alter default privileges in schema app grant execute on functions to authenticated, anon,
-- service_role`, so every new app.* function arrives with three EXPLICIT grants besides
-- PUBLIC's. Measured on the first apply: after `revoke ... from public`, both roles still
-- held execute. Each role is named.
revoke execute on function app.survivorship_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

revoke execute on function app.apply_survivorship(uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

-- 2. app.record_merge — one pair, winner keeps its key, the loser's key becomes an alias.
--
-- The winner's pre-merge snapshot is read HERE, under the row lock, from the row itself —
-- never taken as a parameter. Unmerge restores the winner from it, so a caller-supplied
-- snapshot could be forged or stale, and either would be written back into the winner.
--
-- Returns the business_merges id, or NULL when both sides already resolve to one business
-- (the third edge of a three-way cluster): the candidate is then marked 'merged', because its
-- two businesses ARE one cluster, and nothing else is written.
create or replace function app.record_merge(
  p_winner_id uuid, p_loser_id uuid, p_candidate_id uuid, p_reason text, p_score int,
  p_features jsonb, p_winner_fields_after jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_actor text;
  v_winner uuid;
  v_loser uuid;
  v_candidate uuid;
  v_decision text;
  v_left uuid;
  v_right uuid;
  v_before jsonb;
  v_loser_key text;
  v_merge_id uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'record_merge: no current org' using errcode = '42501';
  end if;
  -- The actor is read, never passed: Clerk sub, then the ETL GUC, then 'system' — the same
  -- resolution as app.emit_event and app.log_event, so the merge row and its events agree.
  v_actor := coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system');

  if p_winner_id = p_loser_id then
    raise exception 'record_merge: winner and loser are the same business' using errcode = '22023';
  end if;

  -- Every caller-supplied id is re-read under this org before anything is touched. The
  -- coalesce is the cluster re-point (M25): a side that was already merged away stands for
  -- its winner, so a second merge can never write a merged_into_id at a merged row.
  select coalesce(merged_into_id, id) into v_winner
    from businesses where id = p_winner_id and org_id = v_org;
  if v_winner is null then
    raise exception 'record_merge: winner not in this org' using errcode = '42501';
  end if;

  select coalesce(merged_into_id, id) into v_loser
    from businesses where id = p_loser_id and org_id = v_org;
  if v_loser is null then
    raise exception 'record_merge: loser not in this org' using errcode = '42501';
  end if;

  select id, decision, left_id, right_id into v_candidate, v_decision, v_left, v_right
    from merge_candidates where id = p_candidate_id and org_id = v_org;
  if v_candidate is null then
    raise exception 'record_merge: candidate not in this org' using errcode = '42501';
  end if;

  -- D-20: an unmerged pair is 'distinct' and the automatic pass never merges it again. A
  -- reviewer may still say "same" deliberately; the resolve pass may not.
  if v_decision = 'distinct' and p_reason = 'auto' then
    raise exception 'record_merge: pair was marked distinct' using errcode = '55000';
  end if;

  -- The candidate must name this pair, after the same re-point.
  select coalesce(merged_into_id, id) into v_left
    from businesses where id = v_left and org_id = v_org;
  select coalesce(merged_into_id, id) into v_right
    from businesses where id = v_right and org_id = v_org;
  if v_left is null or v_right is null
     or least(v_left, v_right) <> least(v_winner, v_loser)
     or greatest(v_left, v_right) <> greatest(v_winner, v_loser) then
    raise exception 'record_merge: candidate does not name this pair' using errcode = '22023';
  end if;

  if v_winner = v_loser then
    update merge_candidates
       set decision = 'merged', decided_by = v_actor, decided_at = now()
     where id = v_candidate and org_id = v_org and decision = 'pending';
    return null;
  end if;

  -- Lock both roots, then confirm they are still roots: a concurrent merge between the read
  -- above and this lock would otherwise chain one merge onto another.
  perform 1 from businesses
    where id in (v_winner, v_loser) and org_id = v_org
    for update;
  if exists (select 1 from businesses
              where id in (v_winner, v_loser) and org_id = v_org
                and merged_into_id is not null) then
    raise exception 'record_merge: a concurrent merge moved this pair; retry' using errcode = '40001';
  end if;

  v_before := app.survivorship_snapshot(v_org, v_winner);
  if v_before is null then
    raise exception 'record_merge: winner not in this org' using errcode = '42501';
  end if;

  perform app.apply_survivorship(v_org, v_winner, p_winner_fields_after, 'record_merge');

  update businesses
     set status = 'merged', merged_into_id = v_winner
   where id = v_loser and org_id = v_org
   returning external_key into v_loser_key;
  if v_loser_key is null then
    raise exception 'record_merge: loser not in this org' using errcode = '42501';
  end if;

  -- Flatten: whatever had been merged into the loser now resolves to the winner, and so do
  -- the live aliases that pointed at the loser.
  update businesses
     set merged_into_id = v_winner
   where merged_into_id = v_loser and org_id = v_org;
  update business_aliases
     set business_id = v_winner
   where business_id = v_loser and released_at is null and org_id = v_org;

  -- merged_at is clock_timestamp(), not now(): unmerge is last-in-first-out, and two merges in
  -- one transaction would otherwise share an instant and have no order.
  insert into business_merges (org_id, winner_id, loser_id, candidate_id, reason, score,
                               features, merged_by, merged_at, winner_fields_before)
  values (v_org, v_winner, v_loser, v_candidate, p_reason, p_score,
          p_features, v_actor, clock_timestamp(), v_before)
  returning id into v_merge_id;

  -- D-19: the loser's key resolves to the winner — an alias row, never a rewrite.
  insert into business_aliases (org_id, external_key, business_id, source_business_id)
  values (v_org, v_loser_key, v_winner, v_loser);

  update merge_candidates
     set decision = 'merged', decided_by = v_actor, decided_at = now()
   where id = v_candidate and org_id = v_org;

  perform app.emit_event('businesses', v_loser, 'merge', jsonb_build_object(
    'merge_id', v_merge_id, 'winner_id', v_winner, 'loser_id', v_loser,
    'candidate_id', v_candidate, 'reason', p_reason, 'score', p_score));

  return v_merge_id;
end $$;
--> statement-breakpoint

-- 3. app.undo_merge — one merge reversed, in one transaction. The business_merges row is
-- never deleted: it gains undone_by / undone_at.
--
-- p_loser_fields is survive() over the loser's own parents (src/lib/resolve/merge.ts), the
-- same function the merge used. Every id below comes from the re-read merge row, never from a
-- parameter.
create or replace function app.undo_merge(p_merge_id uuid, p_loser_fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_actor text;
  v_merge business_merges%rowtype;
  v_loser_parent uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'undo_merge: no current org' using errcode = '42501';
  end if;
  v_actor := coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system');

  -- Step 0 (T-3-10). NOT optional: SECURITY DEFINER means RLS does not apply here, and without
  -- the org predicate a foreign p_merge_id silently splits another tenant's businesses.
  select * into v_merge
    from business_merges
   where id = p_merge_id
     and org_id = v_org;
  if not found then
    raise exception 'undo_merge: merge not in this org' using errcode = '42501';
  end if;

  if v_merge.undone_at is not null then
    raise exception 'undo_merge: merge already undone' using errcode = '55000';
  end if;

  perform 1 from businesses
    where id in (v_merge.winner_id, v_merge.loser_id) and org_id = v_org
    for update;

  -- Last in, first out. winner_fields_before is exact only while nothing later has merged
  -- into the winner, and the loser must still hang directly off this winner (a later merge
  -- of the winner itself would have flattened it elsewhere).
  select merged_into_id into v_loser_parent
    from businesses where id = v_merge.loser_id and org_id = v_org;
  if v_loser_parent is distinct from v_merge.winner_id then
    raise exception 'undo_merge: undo the later merge first' using errcode = '55000';
  end if;
  if exists (select 1 from business_merges m
              where m.org_id = v_org and m.winner_id = v_merge.winner_id
                and m.undone_at is null and m.id <> v_merge.id
                and m.merged_at > v_merge.merged_at) then
    raise exception 'undo_merge: undo the later merge first' using errcode = '55000';
  end if;

  -- 1. The winner, back to exactly what it was.
  perform app.apply_survivorship(v_org, v_merge.winner_id, v_merge.winner_fields_before, 'undo_merge');

  -- 2. The loser, live again, with its fields re-derived from its own source records.
  update businesses
     set status = 'active', merged_into_id = null
   where id = v_merge.loser_id and org_id = v_org;
  perform app.apply_survivorship(v_org, v_merge.loser_id, p_loser_fields, 'undo_merge');

  -- 2b. Un-flatten: every business whose live merge chain runs through the loser goes back
  -- under the loser, and so do their live aliases.
  with recursive under_loser(id) as (
    select m.loser_id from business_merges m
     where m.org_id = v_org and m.winner_id = v_merge.loser_id and m.undone_at is null
    union
    select m.loser_id from business_merges m
      join under_loser u on m.winner_id = u.id
     where m.org_id = v_org and m.undone_at is null
  )
  update businesses b
     set merged_into_id = v_merge.loser_id
    from under_loser u
   where b.id = u.id and b.org_id = v_org and b.merged_into_id = v_merge.winner_id;

  with recursive under_loser(id) as (
    select m.loser_id from business_merges m
     where m.org_id = v_org and m.winner_id = v_merge.loser_id and m.undone_at is null
    union
    select m.loser_id from business_merges m
      join under_loser u on m.winner_id = u.id
     where m.org_id = v_org and m.undone_at is null
  )
  update business_aliases a
     set business_id = v_merge.loser_id
    from under_loser u
   where a.source_business_id = u.id and a.org_id = v_org
     and a.released_at is null and a.business_id = v_merge.winner_id;

  -- 3. The loser's key is the loser's again.
  update business_aliases
     set released_at = now()
   where source_business_id = v_merge.loser_id and released_at is null and org_id = v_org;

  -- 4. D-20's "never auto-re-merges" IS this row (mutation M21).
  update merge_candidates
     set decision = 'distinct', decided_by = v_actor, decided_at = now(), skipped_at = null
   where org_id = v_org
     and (id = v_merge.candidate_id
          or (left_id = least(v_merge.winner_id, v_merge.loser_id)
              and right_id = greatest(v_merge.winner_id, v_merge.loser_id)));

  -- 5. The row is never deleted.
  update business_merges
     set undone_by = v_actor, undone_at = now()
   where id = v_merge.id and org_id = v_org;

  -- 6.
  perform app.emit_event('businesses', v_merge.loser_id, 'unmerge', jsonb_build_object(
    'merge_id', v_merge.id, 'winner_id', v_merge.winner_id, 'loser_id', v_merge.loser_id));
end $$;
--> statement-breakpoint

-- 4. app.record_candidate_decision — 'distinct', or a skip. Merges go through record_merge.
--
-- D-13: "Skip leaves it pending and moves on". A skip stamps skipped_at and leaves
-- decision='pending'; the queue orders skipped pairs last. There is no third decision value.
create or replace function app.record_candidate_decision(p_candidate_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_actor text;
  v_candidate uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'record_candidate_decision: no current org' using errcode = '42501';
  end if;
  v_actor := coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system');

  if p_decision is null or p_decision not in ('distinct', 'skip') then
    raise exception 'record_candidate_decision: decision must be distinct or skip' using errcode = '22023';
  end if;

  select id into v_candidate
    from merge_candidates where id = p_candidate_id and org_id = v_org;
  if v_candidate is null then
    raise exception 'record_candidate_decision: candidate not in this org' using errcode = '42501';
  end if;

  if p_decision = 'distinct' then
    update merge_candidates
       set decision = 'distinct', decided_by = v_actor, decided_at = now()
     where id = v_candidate and org_id = v_org and decision = 'pending';
  else
    update merge_candidates
       set skipped_at = now()
     where id = v_candidate and org_id = v_org and decision = 'pending';
  end if;
  if not found then
    raise exception 'record_candidate_decision: candidate already decided' using errcode = '55000';
  end if;
end $$;
--> statement-breakpoint

-- 5. GRANTS. These three are for sessions with an org; the owner (the desk ETL) needs no
-- grant. PUBLIC and anon lose the execute the schema default handed them (see section 1);
-- service_role keeps its default grant, as it does on every other app.* function. Nothing
-- else changes: 0023 already holds authenticated to SELECT on business_merges,
-- business_aliases and merge_candidates.
revoke execute on function
  app.record_merge(uuid, uuid, uuid, text, integer, jsonb, jsonb),
  app.undo_merge(uuid, jsonb),
  app.record_candidate_decision(uuid, text)
  from public, anon;
--> statement-breakpoint

grant execute on function
  app.record_merge(uuid, uuid, uuid, text, integer, jsonb, jsonb),
  app.undo_merge(uuid, jsonb),
  app.record_candidate_decision(uuid, text)
  to authenticated;

-- Phase 3 code-review fixes, slice A (03-REVIEW-partA.md). Hand-written via
-- `pnpm db:custom --name=review_fixes_spine`; drizzle-kit remains the single migration
-- authority and the schema does not change here — functions and grants only.
--
-- 🔴 EVERY STATEMENT IN THIS FILE IS RE-RUNNABLE (create or replace, drop ... if exists,
-- revoke, grant, alter function ... set). It was developed section by section against the
-- local test database and then applied whole by `pnpm db:migrate`; production receives it
-- whole, once, through `pnpm db:migrate:prod` — a human-gated step, never run by a fixer.
--
-- READ 0024's HEADER BEFORE EDITING ANY DEFINER HERE. SECURITY DEFINER runs as the owner, so
-- RLS does not apply inside these bodies, and the org predicate on every read and write is
-- the only thing between a caller-supplied uuid and another tenant.

-- 1. A-CR-01. app.record_merge is the lock-holder, and a non-pending candidate is refused for
-- BOTH reasons.
--
-- The race it closes needed no precise timing. `decideCandidate` checks `decision = 'pending'`
-- with a plain SELECT under RLS and cannot lock (authenticated holds SELECT only, and FOR
-- UPDATE needs UPDATE). The old definer read the candidate with no lock, refused a 'distinct'
-- pair only when p_reason = 'auto', and closed with an UPDATE that had no `decision =
-- 'pending'` predicate. So reviewer B's "Same business", arriving after reviewer A's
-- "Different" committed, merged the pair and overwrote the candidate to 'merged' — A's
-- decision lost with no trace in business_merges or events.
--
-- Now: the candidate row is read FOR UPDATE (serialising against record_candidate_decision,
-- whose UPDATE takes the same row lock), 'distinct' and 'merged' are refused whatever the
-- reason, and the closing UPDATE is pending-only with a FOUND check. A deliberate re-merge of
-- a pair ruled distinct is NOT reintroduced here: if it is ever wanted it is an explicit,
-- attributed re-open decision, never a loophole in this function.
--
-- Lock order, shared with app.undo_merge below: the candidate row(s) first, then the
-- businesses. Two definers that lock the same rows in opposite orders deadlock (40P01).
create or replace function app.record_merge(
  p_winner_id uuid, p_loser_id uuid, p_candidate_id uuid, p_reason text, p_score int,
  p_features jsonb, p_winner_fields_after jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
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

  -- 🔴 FOR UPDATE: the lock record_candidate_decision's UPDATE also takes. Whichever commits
  -- second re-reads the other's decision, never a stale 'pending'.
  select id, decision, left_id, right_id into v_candidate, v_decision, v_left, v_right
    from merge_candidates where id = p_candidate_id and org_id = v_org
    for update;
  if v_candidate is null then
    raise exception 'record_merge: candidate not in this org' using errcode = '42501';
  end if;

  -- D-20: a pair ruled 'distinct' (a reviewer's "Different", or an unmerge) is never merged
  -- again through this function — by the resolve pass OR by a reviewer.
  if v_decision = 'distinct' then
    raise exception 'record_merge: pair was marked distinct' using errcode = '55000';
  end if;
  if v_decision <> 'pending' then
    raise exception 'record_merge: candidate already decided' using errcode = '55000';
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

  -- Pending-only, and a miss is a refusal: under the row lock above it cannot miss, and if a
  -- future edit ever lets it, the merge rolls back rather than overwriting a decision.
  update merge_candidates
     set decision = 'merged', decided_by = v_actor, decided_at = now()
   where id = v_candidate and org_id = v_org and decision = 'pending';
  if not found then
    raise exception 'record_merge: candidate already decided' using errcode = '55000';
  end if;

  perform app.emit_event('businesses', v_loser, 'merge', jsonb_build_object(
    'merge_id', v_merge_id, 'winner_id', v_winner, 'loser_id', v_loser,
    'candidate_id', v_candidate, 'reason', p_reason, 'score', p_score));

  return v_merge_id;
end $$;
--> statement-breakpoint

-- 2. A-CR-01's follow-up (lock order) and A-IN-07 (stale merge read).
--
-- app.undo_merge updates merge_candidates AFTER it locks businesses, while the fixed
-- record_merge above locks the candidate FIRST: two definers taking the same rows in opposite
-- orders deadlock. The candidate row(s) are now locked before the businesses. And the
-- business_merges row itself is read FOR UPDATE, so of two concurrent unmerges of one merge
-- the second waits and then reads `undone_at` — "merge already undone" — instead of a stale
-- row that fails with the wrong message ("undo the later merge first").
--
-- A-WR-05 (same function). The winner used to be restored from `winner_fields_before`, which is
-- exact only while nothing but merges touched it — and the LIFO check covers merges only. A
-- closures run (or a Census answer, or a re-ingest) that changed the winner after the merge was
-- erased by the restore: the review's case was a winner whose OWN closure record set closed_at
-- after the merge, reopened by the unmerge. The caller (src/lib/resolve/merge.ts) now re-derives
-- the winner the way it re-derives the loser — survive() over the winner's remaining cluster,
-- every member minus the loser's subtree — and passes it as p_winner_fields. The snapshot is
-- kept, and still applied when p_winner_fields is NULL (a raw two-argument call), so the audit
-- trail and the old behaviour both survive.
--
-- The signature grows a third, defaulted argument, so the two-argument function is DROPPED
-- first — two overloads would make every two-argument call ambiguous — and the grants that
-- belonged to it are re-issued below the create.
drop function if exists app.undo_merge(uuid, jsonb);
--> statement-breakpoint

create or replace function app.undo_merge(
  p_merge_id uuid, p_loser_fields jsonb, p_winner_fields jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
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
     and org_id = v_org
   for update;
  if not found then
    raise exception 'undo_merge: merge not in this org' using errcode = '42501';
  end if;

  if v_merge.undone_at is not null then
    raise exception 'undo_merge: merge already undone' using errcode = '55000';
  end if;

  -- The lock order record_merge uses: the candidate row(s), then the businesses.
  perform 1 from merge_candidates
    where org_id = v_org
      and (id = v_merge.candidate_id
           or (left_id = least(v_merge.winner_id, v_merge.loser_id)
               and right_id = greatest(v_merge.winner_id, v_merge.loser_id)))
    order by id
    for update;

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

  -- 1. The winner: re-derived from its remaining cluster when the caller supplied it (A-WR-05),
  -- else the pre-merge snapshot.
  perform app.apply_survivorship(v_org, v_merge.winner_id,
                                 coalesce(p_winner_fields, v_merge.winner_fields_before),
                                 'undo_merge');

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

-- The grants 0024 gave the two-argument function, re-issued for the three-argument one. The
-- schema default (0000) hands a new app.* function to anon as well; it is taken back, as 0024
-- took it back.
revoke execute on function app.undo_merge(uuid, jsonb, jsonb) from public, anon;
--> statement-breakpoint

grant execute on function app.undo_merge(uuid, jsonb, jsonb) to authenticated;
--> statement-breakpoint

-- 3. A-WR-01. businesses and source_records become SELECT-only for authenticated.
--
-- 0023 made the four new spine tables SELECT-only and 0024 says merges happen "only" through
-- the definers — but the merge state lives on businesses (merged_into_id, status,
-- external_key, the six *_source_id pairs), and authenticated still held full DML there from
-- 0008's blanket grant, as it did on source_records. An org session reaching the grant layer
-- (0008's own premise: Supabase third-party auth plus the Data API) could set merged_into_id
-- with no business_merges row and no attributed actor (T-3-08), or point location_source_id at
-- ANOTHER tenant's durable record: the composite FK checks (id, retention_class), not org, and
-- bypasses RLS. Nothing in the app writes either table — the only writers are the owner-tier
-- desk scripts (ingest, resolve, rederive) and the SECURITY DEFINER merge functions.
--
-- The org policies on both tables stay: they still govern SELECT, and they are the second wall
-- if a grant is ever re-added.
revoke insert, update, delete on businesses, source_records from authenticated;
--> statement-breakpoint

-- 4. A-WR-02. Every definer searches pg_temp LAST.
--
-- When pg_temp is not named in a function's search_path, PostgreSQL searches it FIRST for
-- relations, so a session able to create a temp table called `businesses` or
-- `merge_candidates` and then call one of these would have the definer read and write the
-- temp table as the owner (the documented SECURITY DEFINER pitfall). Exploiting it needs
-- arbitrary SQL as authenticated, which the app does not hand out — hygiene, applied in one
-- sweep to every earlier definer and to the two invoker helpers only definers call.
--
-- Only a function whose config is EXACTLY `search_path=public` is rewritten: that is every
-- definer this repo has written. Anything else is left alone and named, and
-- tests/db/grants-audit.test.ts 'every SECURITY DEFINER function searches pg_temp last' fails
-- on it by name rather than this migration guessing what a different path meant.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as fn, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public')
       and (p.prosecdef
            or p.oid in ('app.survivorship_snapshot(uuid,uuid)'::regprocedure,
                         'app.apply_survivorship(uuid,uuid,jsonb,text)'::regprocedure))
  loop
    if f.proconfig = array['search_path=public'] then
      execute format('alter function %s set search_path = public, pg_temp', f.fn);
    elsif f.proconfig is distinct from array['search_path=public, pg_temp'] then
      raise notice 'A-WR-02: % has search_path config %, left unchanged', f.fn, f.proconfig;
    end if;
  end loop;
end $$;
--> statement-breakpoint

-- 5. A-CR-02 / A-WR-06. app.apply_survivorship_if_changed — the write-gated re-derivation.
--
-- A changed source record whose business belongs to a merge cluster no longer writes its own
-- single-record columns onto "its" business (which reverted D-14 on the winner, or landed on a
-- dead loser). The desk tier re-derives the cluster ROOT from every member's parents through
-- the same survive() a merge uses and hands the result here. So does scripts/rederive.ts, which
-- re-derives every business when a derivation rule changes.
--
-- 🔴 WRITE-GATED, because businesses carries app.log_event and a no-op UPDATE still writes an
-- event: DATA-04's "an unchanged re-run writes zero events" must survive a re-derivation that
-- changes nothing. The comparison is made on the TYPED row — the fields populated into the
-- business's own row type, `is distinct from` the row — so a timestamp spelled 'Z' in the
-- jsonb and '+00:00' in the column, or a double that round-trips, is not a phantom change.
-- Only when something differs does it call app.apply_survivorship, which validates the keys
-- and the cited records' org exactly as a merge does. Returns whether it wrote.
--
-- SECURITY INVOKER with execute revoked from every API role: only the owner-tier desk scripts
-- (and nothing a session can reach) call it, like the two helpers in 0024.
create or replace function app.apply_survivorship_if_changed(
  p_org uuid, p_id uuid, p_fields jsonb, p_caller text)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_changed boolean;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception '%: survivorship fields must be a json object', p_caller using errcode = '22023';
  end if;

  select row(r.legal_name, r.legal_name_source_id, r.display_name, r.display_name_source_id,
             r.phone_e164, r.phone_blockable, r.phone_source_id,
             r.street, r.street_num, r.street_norm, r.unit, r.postal, r.city, r.address_source_id,
             r.lat, r.lng, r.location_match_type, r.location_source_id,
             r.closed_at, r.closed_at_source_id,
             r.basic_category, r.cluster_key, r.confidence, r.operating_status)
         is distinct from
         row(b.legal_name, b.legal_name_source_id, b.display_name, b.display_name_source_id,
             b.phone_e164, b.phone_blockable, b.phone_source_id,
             b.street, b.street_num, b.street_norm, b.unit, b.postal, b.city, b.address_source_id,
             b.lat, b.lng, b.location_match_type, b.location_source_id,
             b.closed_at, b.closed_at_source_id,
             b.basic_category, b.cluster_key, b.confidence, b.operating_status)
    into v_changed
    from businesses b
   cross join lateral jsonb_populate_record(b, p_fields) r
   where b.id = p_id and b.org_id = p_org;
  if v_changed is null then
    raise exception '%: business not in this org', p_caller using errcode = '42501';
  end if;
  if not v_changed then
    return false;
  end if;

  perform app.apply_survivorship(p_org, p_id, p_fields, p_caller);
  return true;
end $$;
--> statement-breakpoint

revoke execute on function app.apply_survivorship_if_changed(uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

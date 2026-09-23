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
create or replace function app.undo_merge(p_merge_id uuid, p_loser_fields jsonb)
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

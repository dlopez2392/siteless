-- WR-01. NOTHING RELEASED AN EXPIRED RESERVATION EXCEPT THE NEXT app.reserve_budget.
--
-- 02-CONTEXT names a sweeper beside the self-heal; only the self-heal shipped, and it ran
-- solely inside the meter. Phase 2 has no executor, so nothing settles a reservation: every
-- "Run this preset" is a hold of the estimate's high end that expires after ten minutes and
-- then sits in reserved_micro_usd until somebody queues another run. Counted, all that time,
-- by the 80 %/100 % banner, the spend gauge, the /spend header — which explains it as
-- "reserved by runs in flight", a sentence that is simply false about a worker that died an
-- hour ago — and by the floor bp_not_over holds an admin's cap change to.
--
-- 🔴 THE RELEASE NOW EXISTS ONCE, AS A FUNCTION, AND THE READ PATH CALLS IT. Not copied into
-- ensure_budget_period, not duplicated in set_budget_cap: one body, three callers. Two copies
-- of a balance adjustment is how reserved_micro_usd drifts, and the drift is invisible until
-- the month it refuses a run nobody is making.
--
-- Deliberately NOT a cron job in this migration. The CONTEXT permits pg_cron for housekeeping
-- but rates its availability on this Supabase plan LOW-confidence, and a sweeper on a
-- schedule is a sweeper that stops when the project pauses. Calling it from the get-or-create
-- every read already goes through takes the scheduler off the correctness path entirely; the
-- Vercel Cron sweeper the CONTEXT names is then an optimisation for an idle month, and lands
-- with Phase 4.
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09). Every function below is a definer with the search_path pinned
-- on the same statement, resolves its own tenant from the transaction-local Clerk claims, and
-- takes neither an org nor an actor as an argument — migration 0016's rules, unchanged.

-- ===========================================================================
-- 1. app.release_expired_reservations — step 1 of the old app.reserve_budget,
--    lifted out whole and given a name.
-- ===========================================================================
--
-- Returns the total freed, so a caller can tell "nothing had expired" from "I released
-- something" without a second read.
--
-- `skip locked` because a concurrent healer releasing the same row is doing our job for us:
-- waiting on its lock would serialise every read behind it for no gain, and double-counting
-- the freed total would corrupt reserved_micro_usd. Backed by the cost_reservations_open
-- partial index (migration 0015), so the scan is empty-cheap in the common case where nothing
-- has expired — which is what makes this affordable on a path every page view takes.
--
-- 🔴 THE TENANT COMES FROM THE CLAIMS, NEVER FROM AN ARGUMENT, so a caller can only ever
-- release its own dead holds. The provider and period ARE arguments, and that is safe for the
-- same reason: they only narrow a set already confined to the caller's org.
create or replace function app.release_expired_reservations(p_provider text, p_period date)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_freed bigint;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'release_expired_reservations: no current org' using errcode = '42501';
  end if;

  with expired as (
    select r.id, r.est_micro_usd from cost_reservations r
      join budget_periods b on b.id = r.budget_period_id
     where b.org_id = v_org and b.provider = p_provider and b.period_start = p_period
       and r.settled_at is null and r.released_at is null and r.expires_at < now()
     for update of r skip locked
  ), rel as (
    update cost_reservations r set released_at = now()
      from expired e where r.id = e.id returning e.est_micro_usd
  ) select coalesce(sum(est_micro_usd), 0) into v_freed from rel;

  if v_freed > 0 then
    update budget_periods set reserved_micro_usd = reserved_micro_usd - v_freed
     where org_id = v_org and provider = p_provider and period_start = p_period;
  end if;
  return v_freed;
end $$;
--> statement-breakpoint

grant execute on function app.release_expired_reservations(text, date) to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 2. app.ensure_budget_period — unchanged, except that it now sweeps first.
-- ===========================================================================
--
-- This is the get-or-create EVERY read goes through (src/server/queries/budget.ts
-- readCurrentPeriod calls it before it selects), which is exactly why the release belongs
-- here: the banner, the gauge, the spend header and the estimate's "remaining" all become
-- honest in one place, rather than four screens each remembering to net out dead holds.
--
-- 🔴 THE SWEEP RUNS BEFORE THE EARLY RETURN. The already-provisioned path is the COMMON path
-- — that is the whole point of migration 0009's select-then-do-nothing shape — so a release
-- placed after `return v_id` would run only on the first page view of each month, which is
-- the one moment there is nothing to release.
--
-- It is still a read in the common case: with nothing expired the sweep matches no rows,
-- writes nothing, fires no trigger and takes no lock. It writes exactly when there is
-- something to correct.
--
-- 🔴 THE PREVIOUS PERIOD'S CAP IS STILL CARRIED FORWARD. Without it, an edited cap silently
-- reverts to the 50,000,000 µUSD ($50) default on the first call of every month.
create or replace function app.ensure_budget_period(p_provider text, p_period date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_cap bigint;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'ensure_budget_period: no current org' using errcode = '42501';
  end if;
  if p_period is null then
    raise exception 'ensure_budget_period: period is required' using errcode = '22023';
  end if;
  if p_provider is null or p_provider not in ('places','firecrawl','anthropic') then
    raise exception 'ensure_budget_period: unknown provider %', p_provider
      using errcode = '22023';
  end if;

  -- WR-01. A no-op when the period row does not exist yet: there is nothing to have expired.
  perform app.release_expired_reservations(p_provider, p_period);

  select id into v_id from budget_periods
   where org_id = v_org and provider = p_provider and period_start = p_period;
  if v_id is not null then
    return v_id;
  end if;

  select b.cap_micro_usd into v_cap from budget_periods b
   where b.org_id = v_org and b.provider = p_provider and b.period_start < p_period
   order by b.period_start desc
   limit 1;

  insert into budget_periods (org_id, provider, period_start, cap_micro_usd)
       values (v_org, p_provider, p_period, coalesce(v_cap, 50000000::bigint))
  on conflict (org_id, provider, period_start) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from budget_periods
     where org_id = v_org and provider = p_provider and period_start = p_period;
  end if;
  return v_id;
end $$;
--> statement-breakpoint

-- ===========================================================================
-- 3. app.reserve_budget — THE METER, byte-for-byte as migration 0016 left it
--    except that step 1 is now a call instead of a copy.
-- ===========================================================================
--
-- 🔴 THE ENTIRE CONCURRENCY CONTROL IS STILL THE SINGLE UPDATE IN STEP 2, and nothing reads a
-- budget total before it. That was not reasoned about, it was EXECUTED on PostgreSQL 18.6 with
-- 40 concurrent connections against a cap that fits exactly 10: the naive read-then-decide
-- body granted 40 and reserved four times the cap. tests/db/budget-concurrency.test.ts is the
-- standing proof and must stay green across this migration.
--
-- Denial is ZERO ROWS, not an exception. The caller reads at_100 from the returned row.
create or replace function app.reserve_budget(
  p_provider text, p_period date, p_micro bigint, p_run uuid, p_sku text,
  p_ttl interval default '10 minutes')
returns table (reservation_id uuid, pct_after numeric, at_80 boolean, at_100 boolean)
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_bp uuid; v_res uuid; v_r bigint; v_s bigint; v_c bigint;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'reserve_budget: no current org' using errcode = '42501';
  end if;
  if p_micro is null or p_micro <= 0 then
    raise exception 'reserve_budget: non-positive estimate' using errcode = '22023';
  end if;

  perform app.ensure_budget_period(p_provider, p_period);

  -- 1. SELF-HEAL (T-2-06), now shared with every read path. A crashed worker's claim is
  -- reclaimed by the next caller rather than by a scheduler, which is what keeps the sweeper
  -- off the correctness path and means a paused project cannot strand the budget forever.
  -- Called explicitly rather than left to ensure_budget_period above: the meter's correctness
  -- must not depend on another function's internals, and the second call is a no-op scan over
  -- the partial index.
  perform app.release_expired_reservations(p_provider, p_period);

  -- 2. THE METER. ONE statement. No read of a budget total precedes it.
  update budget_periods
     set reserved_micro_usd = reserved_micro_usd + p_micro
   where org_id = v_org and provider = p_provider and period_start = p_period
     and spent_micro_usd + reserved_micro_usd + p_micro <= cap_micro_usd
  returning id, reserved_micro_usd, spent_micro_usd, cap_micro_usd
       into v_bp, v_r, v_s, v_c;

  if v_bp is null then
    -- DENIED. Zero rows is the refusal. This read happens only on the denial path, after the
    -- decision, purely to REPORT utilisation — it is not part of the concurrency control.
    select b.reserved_micro_usd, b.spent_micro_usd, b.cap_micro_usd into v_r, v_s, v_c
      from budget_periods b
     where b.org_id = v_org and b.provider = p_provider and b.period_start = p_period;
    return query select null::uuid, round(100.0*(v_s+v_r)/nullif(v_c, 0), 1),
                        (v_s+v_r)*100 >= v_c*80, (v_s+v_r) >= v_c;
    return;
  end if;

  insert into cost_reservations (org_id, budget_period_id, run_id, sku, est_micro_usd, expires_at)
       values (v_org, v_bp, p_run, p_sku, p_micro, now() + p_ttl)
  returning id into v_res;

  -- 3. THE 80 % CROSSING, DECIDED FROM THE SAME ROW VERSION (D-12). v_s/v_r/v_c came back
  -- from the UPDATE that granted, so the threshold is derived from the row version that made
  -- the decision; a follow-up SELECT would let two workers crossing 80 % simultaneously both
  -- miss it. (s+r)*100 >= c*80, never c*80/100 — the latter overflows int4 at a $50 cap.
  -- Emitted once per period: the conditional UPDATE on warned_80_at is itself the lock.
  if (v_s+v_r)*100 >= v_c*80 then
    update budget_periods set warned_80_at = now()
     where id = v_bp and warned_80_at is null;
    if found then
      perform app.emit_event('budget_periods', v_bp, 'budget_80_percent',
                             jsonb_build_object(
                               'pct_after', round(100.0*(v_s+v_r)/nullif(v_c, 0), 1),
                               'provider', p_provider,
                               'period_start', p_period));
    end if;
  end if;

  return query select v_res, round(100.0*(v_s+v_r)/nullif(v_c, 0), 1),
                      (v_s+v_r)*100 >= v_c*80, (v_s+v_r) >= v_c;
end $$;
--> statement-breakpoint

comment on function app.release_expired_reservations(text, date) is
  'WR-01. Releases THIS caller''s expired, unsettled reservations for one (provider, period) and returns the total freed. Called by app.ensure_budget_period — the get-or-create every read goes through — and by app.reserve_budget. The release exists once so reserved_micro_usd cannot drift between two copies of it.';

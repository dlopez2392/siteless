-- BUDG-02. The meter, as five functions.
--
-- 🔴 EVERY ONE IS A DEFINER FUNCTION WITH THE search_path PINNED ON THE SAME STATEMENT.
-- Without the pin, the search_path is attacker-influenced and the body runs as the owner
-- (ASVS V4, CONVENTIONS). The pin is not spelled twice anywhere in this file: an
-- acceptance grep counts the lines carrying it, and a comment repeating it verbatim would
-- trip that count. Same reason the phrase naming the privilege model is written in capitals
-- in prose and in lower case only where it is real SQL.
--
-- 🔴 NONE OF THEM TAKES AN ORG OR AN ACTOR AS A PARAMETER. Each resolves the caller from
-- the transaction-local Clerk claims itself, exactly as app.emit_event does (migration
-- 0011), so neither tenancy nor attribution can be forged by an argument.
--
-- 🔴 PostgreSQL 17 COMPATIBLE ONLY. Production is 17.6 while this machine and CI are 18:
-- no RETURNING over the old/new row aliases, no v7 UUID generator, no virtual generated
-- columns. tests/unit/pg17-compat.test.ts greps this directory and is the guard.
--
-- That guard strips comments before matching, precisely so a file may WARN about the
-- syntax it forbids. This paragraph still avoids spelling the forbidden tokens literally:
-- the plan's acceptance criterion is a raw grep with no stripper, and a comment that trips
-- it sends the next reader hunting for a defect that is not there.
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09). Functions are not in the Drizzle TS schema, so `db:generate`
-- after this must still report no drift rather than trying to remove them.

-- ===========================================================================
-- 1. app.current_org_role() — the Clerk role trap, normalised.
-- ===========================================================================
--
-- Clerk session token v2 nests the BARE role under o.rol ('admin'). v1 carries the
-- PREFIXED form flat ('org:admin'), and @clerk/shared builds auth().orgRole as
-- `org:${o.rol}` — so the TypeScript side sees 'org:admin' while SQL sees 'admin' from
-- the very same token. Read out of danlo's real stored session token and out of
-- @clerk/shared/dist/jwtPayloadParser.mjs in node_modules, 2026-09-22.
--
-- A naive coalesce(app.jwt()->'o'->>'rol', app.jwt()->>'org_role') compares 'admin' to
-- 'org:admin' and the admin gate then silently PASSES or silently FAILS depending on which
-- side of the comparison you wrote first. This is the exact sibling of Phase 1's D-11, the
-- single highest-probability silent failure in that build, and it is why both spellings
-- are normalised here rather than at any call site.
--
-- Normalise to the BARE form in SQL; the TypeScript side keeps using the prefixed one.
-- The nullif collapses the empty string the replace produces from an absent claim, so a
-- token carrying neither shape returns NULL and not ''.
create or replace function app.current_org_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(app.jwt()->'o'->>'rol',
                  nullif(replace(coalesce(app.jwt()->>'org_role',''), 'org:', ''), ''))
$$;
--> statement-breakpoint

grant execute on function app.current_org_role() to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 2. app.ensure_budget_period — get-or-create, in migration 0009's shape.
-- ===========================================================================
--
-- Select-then-do-nothing, copied from app.ensure_org: the already-provisioned path is a
-- READ, so the common case writes nothing, fires no trigger and takes no row lock. 0009
-- exists because the `do update set x = excluded.x` form executes as a real row UPDATE —
-- a same-value SET is not a no-op — and fabricated one events row per page view.
--
-- 🔴 THE PREVIOUS PERIOD'S CAP IS CARRIED FORWARD. Without it, an edited cap silently
-- reverts to the 50,000,000 µUSD ($50) default on the first call of every month, which is
-- the kind of defect that is invisible until an invoice arrives.
create or replace function app.ensure_budget_period(p_provider text, p_period date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_cap bigint;
begin
  -- Resolved and checked BEFORE the insert. Left to the insert, a null org would surface
  -- as 23502 on a not-null column, which reads as a schema bug rather than as "this
  -- session has no tenant".
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'ensure_budget_period: no current org' using errcode = '42501';
  end if;
  if p_period is null then
    raise exception 'ensure_budget_period: period is required' using errcode = '22023';
  end if;
  -- Checked here as well as by bp_provider_known: the constraint would refuse with 23514
  -- at INSERT time only, so a typo'd provider on the READ path would otherwise return
  -- NULL and read as "no budget" rather than as a bad argument.
  if p_provider is null or p_provider not in ('places','firecrawl','anthropic') then
    raise exception 'ensure_budget_period: unknown provider %', p_provider
      using errcode = '22023';
  end if;

  select id into v_id from budget_periods
   where org_id = v_org and provider = p_provider and period_start = p_period;
  if v_id is not null then
    return v_id;
  end if;

  -- The most recent EARLIER period for the same (org, provider). Ordered and limited
  -- rather than aggregated so the cap comes from one identifiable row.
  select b.cap_micro_usd into v_cap from budget_periods b
   where b.org_id = v_org and b.provider = p_provider and b.period_start < p_period
   order by b.period_start desc
   limit 1;

  insert into budget_periods (org_id, provider, period_start, cap_micro_usd)
       values (v_org, p_provider, p_period, coalesce(v_cap, 50000000::bigint))
  on conflict (org_id, provider, period_start) do nothing
  returning id into v_id;
  if v_id is null then
    -- Lost the race to a concurrent first call: DO NOTHING returned no row.
    select id into v_id from budget_periods
     where org_id = v_org and provider = p_provider and period_start = p_period;
  end if;
  return v_id;
end $$;
--> statement-breakpoint

grant execute on function app.ensure_budget_period(text, date) to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 3. app.reserve_budget — THE METER. One conditional UPDATE, and nothing before it.
-- ===========================================================================
--
-- 🔴 THE ENTIRE CONCURRENCY CONTROL IS THE SINGLE UPDATE IN STEP 2. There is NO read of a
-- budget total anywhere before it. This was not reasoned about, it was EXECUTED on
-- PostgreSQL 18.6 on 2026-09-22 with 40 concurrent connections against a cap that fits
-- exactly 10:
--
--     naive SELECT -> decide -> UPDATE   granted 40/40, reserved 400 vs cap 100  (4x over)
--     SELECT ... FOR UPDATE -> UPDATE    granted 10/40, reserved 100             (correct)
--     single conditional UPDATE          granted 10/40, reserved 100             (correct)
--
-- It cannot race because PostgreSQL READ COMMITTED re-evaluates the WHERE clause against
-- the committed NEW version of a row it had to wait for. Any SELECT of a budget total that
-- is not inside the same statement as the UPDATE is the defect (T-2-04).
--
-- Denial is ZERO ROWS, not an exception: there is nothing to catch, and the caller reads
-- at_100 from the returned row.
create or replace function app.reserve_budget(
  p_provider text, p_period date, p_micro bigint, p_run uuid, p_sku text,
  p_ttl interval default '10 minutes')
returns table (reservation_id uuid, pct_after numeric, at_80 boolean, at_100 boolean)
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_bp uuid; v_res uuid; v_r bigint; v_s bigint; v_c bigint; v_freed bigint;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'reserve_budget: no current org' using errcode = '42501';
  end if;
  if p_micro is null or p_micro <= 0 then
    raise exception 'reserve_budget: non-positive estimate' using errcode = '22023';
  end if;

  -- The caller never has to create the period itself, so there is no path where a first
  -- call of the month is refused for the wrong reason.
  perform app.ensure_budget_period(p_provider, p_period);

  -- 1. SELF-HEAL (T-2-06). Release THIS budget row's expired, unsettled reservations
  -- before metering, so a crashed worker's claim is reclaimed by the next caller rather
  -- than by a scheduler. That is what takes the sweeper off the correctness path entirely
  -- and means a paused project cannot strand the budget forever.
  --
  -- `skip locked` because a concurrent healer releasing the same row is doing our job for
  -- us: waiting on its lock would serialise every reserve behind it for no gain, and
  -- double-counting the freed total would corrupt reserved_micro_usd. Backed by the
  -- cost_reservations_open partial index (migration 0015), so this scan is empty-cheap in
  -- the common case where nothing has expired.
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

  -- 2. THE METER. ONE statement. No read of a budget total precedes it.
  update budget_periods
     set reserved_micro_usd = reserved_micro_usd + p_micro
   where org_id = v_org and provider = p_provider and period_start = p_period
     and spent_micro_usd + reserved_micro_usd + p_micro <= cap_micro_usd
  returning id, reserved_micro_usd, spent_micro_usd, cap_micro_usd
       into v_bp, v_r, v_s, v_c;

  if v_bp is null then
    -- DENIED. Zero rows is the refusal. Re-read purely to REPORT utilisation — this read
    -- happens only on the denial path, after the decision, and so is not part of the
    -- concurrency control.
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

  -- 3. THE 80 % CROSSING, DECIDED FROM THE SAME ROW VERSION (D-12).
  --
  -- v_s/v_r/v_c came back from the UPDATE that granted, so the threshold is derived from
  -- the row version that made the decision. A follow-up SELECT would let two workers
  -- crossing 80 % simultaneously both miss it, or both emit from a stale read.
  --
  -- 🔴 (s+r)*100 >= c*80, never c*80/100: the latter's intermediate overflows int4 at a
  -- $50 cap ((50*1000000)*80/100 raises 22003), and integer division would truncate the
  -- threshold besides. Every literal here rides a bigint column.
  --
  -- Emitted ONCE per period: the conditional UPDATE on warned_80_at is itself the lock, so
  -- only the session that actually flips it from NULL emits. Otherwise every reserve past
  -- 80 % writes another events row.
  --
  -- 🔴 Through app.emit_event, never a direct insert: `authenticated` holds no INSERT on
  -- events (migration 0011) and emit_event takes neither org nor actor, so attribution
  -- cannot be forged (T-2-11).
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

grant execute on function app.reserve_budget(text, date, bigint, uuid, text, interval) to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 4. app.settle_reservation — idempotent on request_id (T-2-05).
-- ===========================================================================
--
-- 🔴 RESERVE THE WORST CASE, SETTLE THE ACTUAL. Reserving one page and discovering three
-- is the only way to breach the cap, so the estimate is the pessimistic one and the
-- true-up returns the difference here.
--
-- 🔴 p_actual_micro = 0 IS LEGITIMATE AND REQUIRED. The ledger records EVERY paid-SKU call
-- including the ones inside the monthly free allowance; without those rows the allowance
-- is untrackable and every early-month estimate is wrong (RESEARCH Pitfall 4).
--
-- The idempotency is the UNIQUE on request_id plus `do nothing` plus `get diagnostics`: a
-- replayed settlement inserts no row, returns false, and moves NO balance. Checking
-- "does a ledger row exist" first would be the same check-then-act race the meter exists
-- to avoid.
create or replace function app.settle_reservation(
  p_reservation uuid, p_request_id text, p_actual_micro bigint, p_units integer,
  p_sku text, p_provider text, p_lead uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_res_org uuid; v_period uuid; v_est bigint; v_run uuid;
        v_settled timestamptz; v_released timestamptz; v_hold bigint; v_ins int;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'settle_reservation: no current org' using errcode = '42501';
  end if;
  if p_actual_micro is null or p_actual_micro < 0 then
    raise exception 'settle_reservation: negative actual' using errcode = '22023';
  end if;
  if p_units is null or p_units <= 0 then
    raise exception 'settle_reservation: non-positive units' using errcode = '22023';
  end if;

  -- Loaded as the owner, so RLS does not hide it — which is exactly why the org is then
  -- compared EXPLICITLY. A definer that reads without re-checking tenancy is how a
  -- cross-tenant write gets written (T-2-10).
  select r.org_id, r.budget_period_id, r.est_micro_usd, r.run_id, r.settled_at, r.released_at
    into v_res_org, v_period, v_est, v_run, v_settled, v_released
    from cost_reservations r where r.id = p_reservation;
  if v_res_org is null then
    raise exception 'settle_reservation: no such reservation' using errcode = '22023';
  end if;
  if v_res_org is distinct from v_org then
    raise exception 'settle_reservation: reservation belongs to another org'
      using errcode = '42501';
  end if;

  -- 🔴 HOW MUCH BUDGET THIS RESERVATION IS STILL HOLDING — not, blindly, its estimate.
  --
  -- The self-heal in app.reserve_budget may already have released this row (a slow call
  -- that outlived its TTL) and decremented reserved_micro_usd by est. Subtracting est a
  -- second time here would drive reserved_micro_usd negative and abort the settle with
  -- 23514 on bp_non_negative, losing the ledger row for a call that really was billed.
  -- The same applies to a second settle of an already-settled reservation under a
  -- different request_id. Pattern 2 and Pattern 4 only compose if this is conditional.
  v_hold := case when v_settled is null and v_released is null then v_est else 0::bigint end;

  insert into cost_ledger (org_id, budget_period_id, reservation_id, run_id, lead_id,
                           provider, sku, units, micro_usd, request_id)
       values (v_org, v_period, p_reservation, v_run, p_lead,
               p_provider, p_sku, p_units, p_actual_micro, p_request_id)
  on conflict (request_id) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    -- A replay. Nothing moves, nothing is double-counted.
    return false;
  end if;

  update cost_reservations set settled_at = now()
   where id = p_reservation and settled_at is null;

  update budget_periods
     set reserved_micro_usd = reserved_micro_usd - v_hold,
         spent_micro_usd    = spent_micro_usd + p_actual_micro
   where id = v_period;
  return true;
end $$;
--> statement-breakpoint

grant execute on function app.settle_reservation(uuid, text, bigint, integer, text, text, uuid) to authenticated;
--> statement-breakpoint

-- ===========================================================================
-- 5. app.set_budget_cap — D-10, admin-gated in the DATABASE.
-- ===========================================================================
--
-- In migration 0004's claim-check-then-write shape. `authenticated` holds no UPDATE grant
-- on budget_periods at all (migration 0015), so this is the ONLY door, and a direct write
-- is refused one layer earlier with `42501 permission denied for table budget_periods` —
-- a different message from this function's own refusal, and plan 02-08 pins both.
--
-- 🔴 LOWERING A CAP BELOW spent + reserved IS REFUSED BY bp_not_over WITH 23514, verified
-- boundary-exact: with spent 1200 and reserved 400, 5000 -> 1600 is accepted and -> 1599
-- is refused. Note this floor is TIGHTER than the UI-SPEC's copy ("at least {spent + $1}")
-- — the true floor is spent + reserved, and the reserved half is invisible to that copy.
create or replace function app.set_budget_cap(p_provider text, p_cap_micro bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_period date; v_bp uuid; v_cap bigint;
begin
  -- The role check comes FIRST so a member without the role always gets the role message,
  -- never a provider or an org error that would leak which of the two gates it failed.
  if app.current_org_role() is distinct from 'admin' then
    raise exception 'set_budget_cap: admin role required' using errcode = '42501';
  end if;
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'set_budget_cap: no current org' using errcode = '42501';
  end if;
  if p_cap_micro is null or p_cap_micro <= 0 then
    raise exception 'set_budget_cap: cap must be positive' using errcode = '22023';
  end if;

  -- 🔴 The Chicago month, derived HERE rather than passed in. CONVENTIONS section Time
  -- forbids a bare cast to date, which buckets in UTC and hands the last five or six hours
  -- of every month to the next one — for RGV that is a real edit landing in the wrong
  -- period, silently.
  v_period := (date_trunc('month', now() at time zone 'America/Chicago'))::date;
  v_bp := app.ensure_budget_period(p_provider, v_period);

  update budget_periods set cap_micro_usd = p_cap_micro
   where id = v_bp
  returning cap_micro_usd into v_cap;
  return v_cap;
end $$;
--> statement-breakpoint

grant execute on function app.set_budget_cap(text, bigint) to authenticated;

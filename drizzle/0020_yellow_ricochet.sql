-- WR-04. app.reserve_budget accepted a p_run from ANY org.
--
-- The definer inserts cost_reservations.run_id = p_run as the owner. RLS does not apply to
-- that insert, and the foreign key to `runs` is a referential check, which PostgreSQL
-- evaluates with the referenced table owner's privileges — so nothing in the database asked
-- whose run it was. A caller could attach its reservation, and through it a ledger row, to
-- another tenant's run id. `readSpendByRun` joins under the victim's RLS, so the victim would
-- never see the row it was hung on; that makes the defect quieter, not smaller.
--
-- 🔴 IT IS THE SAME SHAPE app.settle_reservation ALREADY GUARDS AGAINST for a reservation id,
-- and the guard is written the same way: resolve the tenant from the claims, compare
-- explicitly, and give "belongs to somebody else" and "does not exist" the SAME refusal, or
-- the message becomes an existence oracle on run ids (T-2-10).
--
-- 42501, matching the tenancy refusal in settle_reservation rather than the 22023 this file
-- uses for a malformed argument: a foreign run id is a permission answer, not a syntax one,
-- and CLAUDE.md pins 42501 for every org_id assertion.
--
-- Everything else is migration 0018's body unchanged, including the one thing this file is
-- most at risk of breaking: THE ENTIRE CONCURRENCY CONTROL IS STILL THE SINGLE UPDATE IN
-- STEP 2, with no read of a budget total before it. That was executed, not reasoned about —
-- 40 concurrent connections against a cap that fits 10, where the naive read-then-decide body
-- granted all 40 and reserved four times the cap. tests/db/budget-concurrency.test.ts is the
-- standing proof and must stay green across this migration.
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09).
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

  -- WR-04. Null is legitimate and stays legitimate: a reservation need not name a run, and
  -- the db suite reserves with a null run throughout. What is refused is a run id that is
  -- not this tenant's.
  if p_run is not null
     and not exists (select 1 from runs where id = p_run and org_id = v_org) then
    raise exception 'reserve_budget: run belongs to another org or does not exist'
      using errcode = '42501';
  end if;

  perform app.ensure_budget_period(p_provider, p_period);

  -- 1. SELF-HEAL (T-2-06), shared with every read path since migration 0018. A crashed
  -- worker's claim is reclaimed by the next caller rather than by a scheduler, which is what
  -- keeps the sweeper off the correctness path. Called explicitly rather than left to
  -- ensure_budget_period above: the meter's correctness must not depend on another function's
  -- internals, and the second call is a no-op scan over the partial index.
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

comment on function app.reserve_budget(text, date, bigint, uuid, text, interval) is
  'BUDG-02, the meter. The whole concurrency control is the single conditional UPDATE, executed under a 40-way burst rather than reasoned about. WR-04: p_run is re-checked against the caller''s org, because RLS does not apply to a definer''s insert and a referential check bypasses it by design.';

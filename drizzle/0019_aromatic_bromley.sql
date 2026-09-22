-- WR-03. The one definer that writes the ledger had two gaps.
--
-- (1) IT TRUSTED p_sku AND p_provider AND COMPARED THEM TO NOTHING. Both were written into
-- cost_ledger verbatim. `readUnitsUsedThisPeriod` derives the monthly free allowance by
-- summing `units` for one sku, so a mismatched sku silently moves a call out of the allowance
-- it actually consumed and every estimate for the rest of that month is wrong — in the cheap
-- direction, which is the direction nobody investigates. And cost_ledger.provider is BUDG-01's
-- external contract, free to disagree with the provider of the budget period the same row
-- points at.
--
-- DERIVE, NEVER ACCEPT. The sku comes off the reservation and the provider off the period it
-- points at; both are then written from those values. The caller's arguments are still
-- CHECKED rather than quietly ignored, because a caller passing the wrong sku holds a wrong
-- belief about what it just bought, and swapping its values underneath it would leave that
-- belief intact and un-investigated.
--
-- (2) A LATE SETTLE AFTER A SELF-HEAL COULD ABORT AND LOSE THE LEDGER ROW ENTIRELY. When the
-- reservation has already been released, there is no hold left to offset: the function adds
-- the actual to `spent` with nothing coming off `reserved`. If the freed budget was re-reserved
-- in between — which is exactly what the self-heal exists to allow — then spent + reserved
-- passes the cap, bp_not_over raises 23514, and the WHOLE function aborts, taking with it the
-- ledger row for a call Google really billed. The meter then under-reports actual spend
-- permanently, and nothing is left behind to notice it by. That is precisely the shape
-- migration 0016's own header warns about, one branch further along.
--
-- 🔴 THE LEDGER ROW MUST SURVIVE, AND THE PERIOD IS ALLOWED TO REFUSE TO FOLLOW IT. The insert
-- happens first and OUTSIDE the block below, so the subtransaction that the exception handler
-- creates cannot roll it back. The balance update is attempted; if the cap refuses it, the
-- money is still recorded where /spend reads it and an audit event says the period row could
-- not follow. Recording the spend and raising the alarm beats both alternatives: silently
-- dropping a real charge, and dropping the cap constraint that is the second wall (T-2-07).
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09). Definer, search_path pinned on the same statement, tenant and
-- actor resolved from the transaction-local claims and never from an argument — 0016's rules.
create or replace function app.settle_reservation(
  p_reservation uuid, p_request_id text, p_actual_micro bigint, p_units integer,
  p_sku text, p_provider text, p_lead uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_res_org uuid; v_period uuid; v_est bigint; v_run uuid;
        v_settled timestamptz; v_released timestamptz; v_hold bigint; v_ins int;
        v_sku text; v_provider text;
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
  -- cross-tenant write gets written (T-2-10). The join is what makes `provider` derivable:
  -- budget_periods is keyed (org, provider, month), so the period a reservation points at
  -- names exactly one provider.
  select r.org_id, r.budget_period_id, r.est_micro_usd, r.run_id, r.settled_at, r.released_at,
         r.sku, b.provider
    into v_res_org, v_period, v_est, v_run, v_settled, v_released, v_sku, v_provider
    from cost_reservations r
    join budget_periods b on b.id = r.budget_period_id
   where r.id = p_reservation;
  if v_res_org is null then
    raise exception 'settle_reservation: no such reservation' using errcode = '22023';
  end if;
  if v_res_org is distinct from v_org then
    raise exception 'settle_reservation: reservation belongs to another org'
      using errcode = '42501';
  end if;

  -- Checked against the derived values, and the message names neither side's value: a
  -- refusal here is a caller bug, not a fact about another tenant's data.
  if p_sku is distinct from v_sku then
    raise exception 'settle_reservation: sku does not match the reservation'
      using errcode = '22023';
  end if;
  if p_provider is distinct from v_provider then
    raise exception 'settle_reservation: provider does not match the reservation'
      using errcode = '22023';
  end if;

  -- 🔴 HOW MUCH BUDGET THIS RESERVATION IS STILL HOLDING — not, blindly, its estimate. The
  -- self-heal may already have released this row and decremented reserved_micro_usd by est;
  -- subtracting est a second time would drive it negative and abort on bp_non_negative. Same
  -- for a second settle of an already-settled reservation under a different request_id.
  v_hold := case when v_settled is null and v_released is null then v_est else 0::bigint end;

  -- 🔴 THE LEDGER ROW GOES IN FIRST AND OUTSIDE THE BLOCK BELOW. The idempotency is the
  -- UNIQUE on request_id plus `do nothing` plus `get diagnostics`: a replayed settlement
  -- inserts no row, returns false, and moves NO balance.
  --
  -- v_provider and v_sku, never the parameters: the values checked above are the values
  -- written, so the row cannot disagree with the reservation it settles even if this
  -- function's guards are later loosened.
  insert into cost_ledger (org_id, budget_period_id, reservation_id, run_id, lead_id,
                           provider, sku, units, micro_usd, request_id)
       values (v_org, v_period, p_reservation, v_run, p_lead,
               v_provider, v_sku, p_units, p_actual_micro, p_request_id)
  on conflict (request_id) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    -- A replay. Nothing moves, nothing is double-counted.
    return false;
  end if;

  update cost_reservations set settled_at = now()
   where id = p_reservation and settled_at is null;

  begin
    update budget_periods
       set reserved_micro_usd = reserved_micro_usd - v_hold,
           spent_micro_usd    = spent_micro_usd + p_actual_micro
     where id = v_period;
  exception when check_violation then
    -- The cap refused to absorb a charge that has already happened. The ledger row above
    -- stands — it is what /spend and every provider total are summed from — and the period
    -- row stays inside its constraint, with the divergence on the record rather than in
    -- nobody's hands. Through app.emit_event, never a direct insert: `authenticated` holds no
    -- INSERT on events (migration 0011) and emit_event takes neither org nor actor, so
    -- attribution cannot be forged (T-2-11).
    perform app.emit_event('budget_periods', v_period, 'budget_overrun',
                           jsonb_build_object(
                             'micro_usd', p_actual_micro,
                             'reservation_id', p_reservation,
                             'request_id', p_request_id));
  end;
  return true;
end $$;
--> statement-breakpoint

comment on function app.settle_reservation(uuid, text, bigint, integer, text, text, uuid) is
  'WR-03. provider and sku are DERIVED from the reservation and its period and written from those values; the caller''s own are checked and refused with 22023 on a mismatch. The ledger insert precedes the balance update and sits outside its exception block, so a late settle after a self-heal records the charge and emits budget_overrun instead of aborting and losing a row for money that was really spent.';

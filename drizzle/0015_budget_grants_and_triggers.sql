-- The half of migration 0014 that drizzle-kit's differ cannot emit: the partial index the
-- self-healing reserve depends on, the SELECT-only grants that make D-10 a grant-layer
-- fact, and the audit trigger narrowed to a cap change.
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09) — nothing here was applied by any other tool, and no
-- generated file was hand-edited.

-- 1. THE PARTIAL INDEX BEHIND THE SELF-HEALING RESERVE (T-2-06).
--
-- app.reserve_budget releases THIS budget row's expired, unsettled reservations on every
-- call, before it meters. That scan runs on the hot path of every paid call, so it is
-- indexed on exactly the predicate it uses and is empty-cheap in the common case where
-- nothing has expired. A partial index, mirroring `sr_expiry` from migration 0006.
--
-- This is what takes the sweeper OFF the correctness path: a crashed worker's reservation
-- is reclaimed by the next caller, not by a scheduler, so a paused project cannot strand
-- the budget forever.
create index cost_reservations_open on cost_reservations (budget_period_id, expires_at)
  where settled_at is null and released_at is null;
--> statement-breakpoint

-- 2. GRANTS. 🔴 `authenticated` GETS SELECT AND NOTHING ELSE ON ALL THREE TABLES.
--
-- Migration 0008 retired the platform default ACL, so a new table inherits NOTHING and the
-- migration that creates it grants the DML its policies need explicitly. Here that DML is
-- SELECT alone: every WRITE to the meter is a SECURITY DEFINER function (0016), and each
-- one resolves the caller from the transaction-local claims rather than taking an org or
-- an actor as a parameter.
--
-- This is why D-10 needs no COLUMN grant on budget_periods.cap_micro_usd, the way
-- migration 0013 needed one on runs.search_version_id: `authenticated` holds no UPDATE on
-- budget_periods AT ALL, so a direct `update budget_periods set cap_micro_usd = ...` is
-- refused at the grant layer with `42501 permission denied for table budget_periods`. That
-- message is DISTINCT from app.set_budget_cap's own `42501 set_budget_cap: admin role
-- required`, and plan 02-08 pins the two separately — a member who cannot reach the
-- function and a member who reaches it without the role are different failures.
--
-- T-2-03 is the same mechanism on cost_ledger: with no INSERT grant, the only writer is
-- app.settle_reservation, which loads the reservation first. Combined with
-- `reservation_id NOT NULL` + its FK, no code path can spend a cent outside the meter.
--
-- The revoke is not redundant with "a new table inherits nothing". It is the same
-- belt-and-braces migration 0008 step 5 applies to events: a later migration that re-runs
-- a blanket `grant all on all tables in schema public` would silently re-open all three,
-- and a revoke that is not written down cannot be re-asserted.
grant select on budget_periods, cost_reservations, cost_ledger to authenticated;
--> statement-breakpoint

revoke insert, update, delete on budget_periods, cost_reservations, cost_ledger from authenticated;
--> statement-breakpoint

-- 3. TRIGGERS, NARROWED ON PURPOSE.
--
-- app.touch_updated_at goes on both MUTABLE tables. BEFORE, never AFTER: it mutates NEW
-- and returns it, and an AFTER attachment would recurse. cost_ledger is absent — it is
-- append-only and carries no updated_at/updated_by pair at all.
create trigger budget_periods_touch before update on budget_periods
  for each row execute function app.touch_updated_at();
--> statement-breakpoint

create trigger cost_reservations_touch before update on cost_reservations
  for each row execute function app.touch_updated_at();
--> statement-breakpoint

-- app.log_event on budget_periods as TWO triggers rather than one, because PostgreSQL
-- forbids a WHEN clause referencing both OLD and NEW on a combined insert/update/delete
-- trigger: OLD is not available to an INSERT and NEW is not available to a DELETE, so a
-- single `after insert or update or delete ... when (old.x is distinct from new.x)` is
-- rejected at CREATE time. Splitting it is the only way to narrow the UPDATE arm while
-- still auditing the INSERT and DELETE arms unconditionally.
create trigger budget_periods_event_ins_del after insert or delete on budget_periods
  for each row execute function app.log_event();
--> statement-breakpoint

-- 🔴 WHY THE UPDATE ARM IS NARROWED TO THE CAP.
--
-- D-10 makes a CAP CHANGE an audited state change, and T-2-11 makes its actor
-- unforgeable: app.log_event resolves the actor from app.jwt()->>'sub' inside the definer,
-- never from a parameter, and `authenticated` holds no INSERT on events (migration 0011).
--
-- But a reserve and a settle ALSO update this row — reserved_micro_usd on the way in,
-- reserved+spent on the way out. At Phase 4 volumes an unnarrowed trigger would write
-- roughly TWO events rows per paid call, each carrying a full before/after payload whose
-- only difference is a balance moving by design. That is precisely the source_records
-- write-amplification mistake CONVENTIONS already decided against (T-1-32), and the
-- reservation and the ledger row ARE the audit record for spend.
--
-- `is distinct from` rather than `<>`: cap_micro_usd is NOT NULL today, but `<>` yields
-- NULL (and so does not fire) the moment a nullable column is ever compared this way.
create trigger budget_periods_event_upd after update on budget_periods
  for each row when (old.cap_micro_usd is distinct from new.cap_micro_usd)
  execute function app.log_event();
--> statement-breakpoint

-- 4. WHAT DELIBERATELY HAS NO app.log_event TRIGGER, AND WHY (RESEARCH Pitfall 9).
--
-- cost_reservations and cost_ledger. One row per paid call each, so a row trigger there is
-- the same write-amplification shape as above — and worse, it would duplicate a record
-- that already exists: the ledger row IS the spend audit record, and it is append-only by
-- grant. EVENT_LOGGED in tests/db/event-trigger.test.ts asserts set equality in BOTH
-- directions, so adding one later is as red as dropping one.
comment on table cost_ledger is
  'Append-only. reservation_id is NOT NULL with an FK (T-2-03): a ledger row cannot exist without a reservation, so no code path can spend outside the meter. authenticated holds SELECT only; the sole writer is app.settle_reservation, idempotent on request_id. cost_cents is generated from micro_usd and is BUDG-01''s external contract.';
--> statement-breakpoint

comment on table budget_periods is
  'The cap lives here and is edited ONLY through app.set_budget_cap (D-10): authenticated holds no UPDATE grant at all, so a direct write is 42501 permission denied for table budget_periods. bp_not_over is the second wall under the conditional UPDATE in app.reserve_budget, and also refuses lowering a cap below spent + reserved with 23514.';

---
phase: 02-budget-governor-search-presets
plan: 05
subsystem: budget-governor
tags: [database, migrations, security-definer, concurrency, rls, grants, money]
requires:
  - 02-03 (searches/runs schema, orgScoped + orgPolicies helpers, widened grant tests)
  - Phase 1 migrations 0002/0004/0007/0008/0009/0011 (app.current_org_id, app.log_event,
    app.touch_updated_at, app.emit_event, the retired default ACL)
provides:
  - budget_periods / cost_reservations / cost_ledger
  - app.current_org_role, app.ensure_budget_period, app.reserve_budget,
    app.settle_reservation, app.set_budget_cap
  - the BUDG-01 ledger contract column cost_cents
affects:
  - 02-07 (estimator reads the price book and will reserve through app.reserve_budget)
  - 02-08 (the meter's tests: concurrency burst, admin gate, idempotent settle)
  - Phase 3/4 (every paid call must reserve then settle)
tech-stack:
  added: []
  patterns:
    - one conditional UPDATE as the entire concurrency control (no read before it)
    - self-healing reserve under `for update ... skip locked` (no sweeper on the correctness path)
    - idempotency by UNIQUE + `on conflict do nothing` + `get diagnostics`
    - micro-USD bigint internally, generated numeric(12,2) for the external contract
key-files:
  created:
    - src/db/schema/budget.ts
    - drizzle/0014_brown_phantom_reporter.sql
    - drizzle/0015_budget_grants_and_triggers.sql
    - drizzle/0016_budget_meter_functions.sql
  modified:
    - src/db/schema/index.ts
    - tests/db/grants-audit.test.ts
    - tests/db/event-trigger.test.ts
decisions:
  - "The audit trigger on budget_periods is SPLIT IN TWO because PostgreSQL forbids a WHEN clause over both OLD and NEW on a combined insert/update/delete trigger; the UPDATE arm is narrowed to a cap change so a reserve and a settle write no events row"
  - "app.settle_reservation subtracts what the reservation is still HOLDING, not blindly its estimate — otherwise the self-heal and an idempotent settle cannot compose without driving reserved negative"
  - "REQUIREMENTS.md left untouched: BUDG-01/02 have their database mechanism but no instrumented outbound call yet (Phase 3/4) and no tests yet (plan 02-08)"
metrics:
  tasks: 2
  commits: 2
  duration: ~45 min
  completed: 2026-09-22
---

# Phase 02 Plan 05: Budget Meter Schema & Functions Summary

The spend meter exists as a database fact: three tables, five `SECURITY DEFINER`
functions, and one conditional `UPDATE` that is the entire concurrency control — verified
under a 12-way sequential burst to grant exactly the cap and refuse the rest, with the
80 % warning emitted exactly once.

## What Was Built

### Task 1 — the three tables (`b30f433`)

`budget_periods`, `cost_reservations`, `cost_ledger`, every money column `bigint`
micro-USD. The two constraints that carry the threat model:

- **`cost_ledger.reservation_id` is `NOT NULL` with an FK** and `authenticated` holds no
  INSERT on the table at all. That pair is T-2-03: a ledger row cannot exist without a
  reservation, so no code path can spend a cent outside the meter.
- **`bp_not_over`** (`spent + reserved <= cap`) is the second wall under the conditional
  UPDATE, and is also what refuses lowering a cap below what is already committed.

`authenticated` gets **SELECT and nothing else** on all three. This is why D-10 needed no
column grant the way `runs.search_version_id` did: there is no UPDATE to narrow.

### Task 2 — the five functions (`4098e86`)

`app.current_org_role`, `app.ensure_budget_period`, `app.reserve_budget`,
`app.settle_reservation`, `app.set_budget_cap`. Each pins its `search_path` on the same
statement, each is granted explicitly, and **none takes an org or an actor as a
parameter** — every one resolves the caller from the transaction-local Clerk claims.

## Verification (actual output)

### Migration file names — drizzle-kit named the generated one itself

The plan's frontmatter anticipated `0014_budget_schema.sql` and
`0015_budget_meter_functions.sql`. drizzle-kit names generated files itself and renaming
one breaks its checksum, so the real names are:

| # | File | Kind |
|---|------|------|
| 0014 | `drizzle/0014_brown_phantom_reporter.sql` | generated (`db:generate`) |
| 0015 | `drizzle/0015_budget_grants_and_triggers.sql` | custom (`db:custom`) |
| 0016 | `drizzle/0016_budget_meter_functions.sql` | custom (`db:custom`) |

The meter functions therefore live in **0016**, not 0015.

### Pre-flight read (before any write)

```
check-test-db: ok — PostgreSQL 18.6 on x86_64-windows
--- migrations (1)
    {"applied":14}
--- public tables (1)
    {"tables":"businesses, cities, counties, events, geo_presets, industry_clusters,
     industry_terms, orgs, outlet_counts, runs, search_versions, searches, source_records"}
--- app functions (6)
    current_org_id/0, emit_event/4, ensure_org/2, jwt/0, log_event/0, touch_updated_at/0
```

### `app` schema functions — before and after

| Before (6) | After (11) |
|---|---|
| `current_org_id/0` | `current_org_id/0` |
| `emit_event/4` | **`current_org_role/0`** |
| `ensure_org/2` | `emit_event/4` |
| `jwt/0` | **`ensure_budget_period/2`** |
| `log_event/0` | `ensure_org/2` |
| `touch_updated_at/0` | `jwt/0` |
| | `log_event/0` |
| | **`reserve_budget/6`** |
| | **`set_budget_cap/2`** |
| | **`settle_reservation/7`** |
| | `touch_updated_at/0` |

The plan said "alongside Phase 1's five"; there are in fact **six** Phase 1 functions
(`app.jwt` was not counted). All five new ones are present.

### `db:migrate` idempotent, `db:generate` reports no drift — verbatim

```
$ tsx scripts/db.ts migrate --target=test
Using 'pg' driver for database querying
[✓] migrations applied successfully!scripts/db.ts: local app_user password set (dev/CI only).

=== db:generate (drift check) ===
cost_ledger 13 columns 2 indexes 4 fks
cost_reservations 12 columns 1 indexes 3 fks

No schema changes, nothing to migrate 😴
```

Journal reconciliation after the last migration:

```
ok — drizzle.__drizzle_migrations holds the 0000_bootstrap row and all 17 journal entries
```

Migrations applied to the shared local `siteless_test`: **0014, 0015, 0016** (14 rows
before → 17 after). Nothing was dropped or truncated; the Supabase MCP was never used.

### `pg_get_functiondef('app.reserve_budget'::regproc)` — verbatim

The acceptance criterion is that **no read of a budget total precedes the conditional
UPDATE**. It holds: the only pre-UPDATE reads are of `cost_reservations` (the self-heal
CTE). The re-read of `budget_periods` sits *inside* the `if v_bp is null` denial branch —
after the decision, purely to report utilisation.

```sql
CREATE OR REPLACE FUNCTION app.reserve_budget(p_provider text, p_period date, p_micro bigint, p_run uuid, p_sku text, p_ttl interval DEFAULT '00:10:00'::interval)
 RETURNS TABLE(reservation_id uuid, pct_after numeric, at_80 boolean, at_100 boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_bp uuid; v_res uuid; v_r bigint; v_s bigint; v_c bigint; v_freed bigint;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'reserve_budget: no current org' using errcode = '42501';
  end if;
  if p_micro is null or p_micro <= 0 then
    raise exception 'reserve_budget: non-positive estimate' using errcode = '22023';
  end if;

  perform app.ensure_budget_period(p_provider, p_period);

  -- 1. SELF-HEAL (T-2-06).
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
    -- DENIED. Zero rows is the refusal.
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
end $function$
```

(Comment blocks elided above for length; the file carries them in full.)

### Behavioural smoke — executed, then rolled back

Not required by the plan, but a migration that applies is not a meter that works.

```
set_budget_cap -> 100
reserve x12 @10 vs cap 100 -> granted 10, denied 2
  8th (crosses 80%): {"reservation_id":"0270c58f-...","pct_after":"80.0","at_80":true,"at_100":false}
  last (denied):     {"reservation_id":null,"pct_after":"100.0","at_80":true,"at_100":true}
  budget row: {"reserved_micro_usd":"100","spent_micro_usd":"0","cap_micro_usd":"100","warned":true}
  events: [{"action":"budget_80_percent","n":1},{"action":"insert","n":2},{"action":"update","n":1}]
settle first=true replay=false
  after settle: {"reserved_micro_usd":"90","spent_micro_usd":"7","ledger_rows":1}
  lower cap below spent+reserved -> 23514 (bp_not_over)
  non-admin set_budget_cap -> 42501: set_budget_cap: admin role required
  current_org_role [v2 nested bare o.rol]   -> "admin"
  current_org_role [v1 flat prefixed org_role] -> "admin"
  current_org_role [neither]                -> null
```

Three things this pins that a passing migration would not:

1. **Reserved lands exactly on the cap** (100 of 100), granting 10 and refusing 2. Denial
   is zero rows with `at_100: true`, not an exception.
2. **`events` shows `update: 1`** — eleven-plus UPDATEs hit `budget_periods` (ten reserves,
   one settle, one cap change) and only the **cap change** wrote an audit row. That is the
   narrowed trigger working; an unnarrowed one would have written a dozen.
3. **`budget_80_percent: 1`** — five reserves sat at or past 80 % and exactly one event was
   emitted, through `app.emit_event`.

BUDG-01's contract by value: `35000` µUSD →
`{"provider":"places","sku":"ts_enterprise","units":1,"micro_usd":"35000","cost_cents":"3.50","run_id":null,"lead_id":null}`.

### `pnpm test:db` — 9 files, 39 tests, all passing, by NAME

```
✓ tests/db/grants-audit.test.ts > authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table
✓ tests/db/grants-audit.test.ts > anon holds no privilege on any tenant table
✓ tests/db/grants-audit.test.ts > a TRUNCATE of events as authenticated is refused with 42501
✓ tests/db/grants-audit.test.ts > a cascading TRUNCATE of every tenant table as authenticated is refused with 42501
✓ tests/db/grants-audit.test.ts > the public schema default ACL grants nothing to anon or authenticated on tables
✓ tests/db/grants-audit.test.ts > authenticated keeps the DML the policies rely on
✓ tests/db/grants-audit.test.ts > authenticated holds exactly the DML each Phase 2 table needs
✓ tests/db/grants-audit.test.ts > a finished run cannot be re-pointed at another search version
✓ tests/db/grants-audit.test.ts > authenticated can update an orgs label but not its clerk_org_id
✓ tests/db/rls-isolation.test.ts > org A sees only its own org rows under a v1 flat claim
✓ tests/db/rls-isolation.test.ts > a token v2 nested claim resolves the same org as v1
✓ tests/db/rls-isolation.test.ts > org A cannot INSERT into org B, and the refusal is 42501
✓ tests/db/rls-isolation.test.ts > a second statement in the same aborted transaction reports 25P02
✓ tests/db/rls-isolation.test.ts > a cross-org UPDATE and DELETE are filtered, not refused
✓ tests/db/rls-isolation.test.ts > a tenant cannot re-key its own clerk_org_id
✓ tests/db/rls-isolation.test.ts > positive control: a tenant can still rename itself, and the touch trigger still fires
✓ tests/db/rls-isolation.test.ts > a connection without set local role authenticated is refused 42501
✓ tests/db/ensure-org.test.ts > app.ensure_org is idempotent for the caller own org
✓ tests/db/ensure-org.test.ts > app.ensure_org writes nothing on an already-provisioned org
✓ tests/db/ensure-org.test.ts > app.ensure_org refuses another org with 42501
✓ tests/db/retention.test.ts > google content cannot be durable
✓ tests/db/retention.test.ts > an ephemeral source record without expires_at is refused
✓ tests/db/retention.test.ts > a durable source record with an expires_at is refused
✓ tests/db/retention.test.ts > durable cites durable: a durable field citing an ephemeral source is refused
✓ tests/db/retention.test.ts > positive control: a durable field citing a durable source is accepted
✓ tests/db/retention.test.ts > source_records has a partial index on expires_at
✓ tests/db/events-append-only.test.ts > events are append-only: UPDATE as authenticated is refused
✓ tests/db/events-append-only.test.ts > events are append-only: DELETE as authenticated is refused
✓ tests/db/events-append-only.test.ts > a caller cannot author its own audit row
✓ tests/db/events-append-only.test.ts > positive control: app.emit_event writes and stamps the actor itself
✓ tests/db/event-trigger.test.ts > a direct write still produces an event
✓ tests/db/event-trigger.test.ts > an UPDATE of only a domain column still moves updated_at and stamps updated_by
✓ tests/db/event-trigger.test.ts > every state-bearing table has an app.log_event after-row trigger
✓ tests/db/schema-audit.test.ts > every public table is org-scoped and has RLS enabled
✓ tests/db/schema-audit.test.ts > every timestamp column in public is timestamptz
✓ tests/db/schema-audit.test.ts > businesses has three distinct name fields
✓ tests/db/time.test.ts > one instant, two zones, opposite verdicts
✓ tests/db/time.test.ts > DST: the offset is not a constant, so "subtract six hours" is wrong twice a year
✓ tests/db/with-org.test.ts > withOrg binds the tenant claims and they die with the transaction

Test Files  9 passed (9)
     Tests  39 passed (39)
```

The three names the plan asked for are present: **`every public table is org-scoped and
has RLS enabled`**, **`every state-bearing table has an app.log_event after-row trigger`**,
**`authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table`**.

### Other gates

| Gate | Result |
|---|---|
| `pnpm test:unit` | 13 files, 41 tests, all passing |
| `pnpm test:unit -t "pg17"` | 2 passed, 39 skipped |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |

`pnpm verify` was not run as a whole — it shells out to bare `pnpm`, which on this machine
is the wrong global 11.9.0 (RESEARCH Pitfall 12). Its parts were run individually above;
`pnpm build` was not run (no source outside `src/db/schema` changed).

### Acceptance greps

| Criterion | Result |
|---|---|
| exact constraint names in `budget.ts` | `bp_not_over`, `bp_non_negative`, `cr_est_positive`, `cl_micro_non_negative`, `cost_ledger_request_id_key` — 1 each |
| `micro_usd / 10000.0` + `precision: 12` + `scale: 2` | 1 each |
| `reservationId` carries `.notNull()` **and** `.references(` | yes (T-2-03) |
| custom migration literals | `cost_reservations_open`, `where settled_at is null and released_at is null`, `revoke insert, update, delete on budget_periods`, `budget_periods_event_upd`, `old.cap_micro_usd is distinct from new.cap_micro_usd` — 1 each |
| `log_event` on `cost_ledger`/`cost_reservations` | **0** across all migrations (Pitfall 9) |
| `TENANT_TABLES` | **16** entries |
| `EVENT_LOGGED` | **5** entries; excludes `cost_ledger`, `cost_reservations`, `runs` |
| `security definer` / `set search_path = public` / `grant execute on function app.` in 0016 | **5 / 5 / 5** |
| required 0016 literals | `spent_micro_usd + reserved_micro_usd + p_micro <= cap_micro_usd`, `for update of r skip locked`, `on conflict (request_id) do nothing`, `warned_80_at`, `app.emit_event(`, `app.current_org_role() is distinct from 'admin'` — all present |
| both Clerk spellings | `o'->>'rol'` 2, `replace(coalesce(app.jwt()->>'org_role'` 1 |
| PG18-only syntax in 0016 | **0** |
| Chicago month derivation / bare `now()::date` | **1 / 0** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The `app.log_event` trigger enumeration could not tolerate two triggers on one table**

- **Found during:** Task 1.
- **Issue:** The plan's `read_first` instructed me to "confirm it builds a Set of table
  names and therefore tolerates TWO `app.log_event` trigger rows on one table". **It does
  not.** `tests/db/event-trigger.test.ts` compared `rows.map((r) => r.table_name).sort()`
  against `[...EVENT_LOGGED].sort()` — a plain array over one row *per trigger*. Splitting
  the `budget_periods` trigger in two (which the plan itself mandates, because PostgreSQL
  forbids a `WHEN` clause over both `OLD` and `NEW` on a combined trigger) would have
  produced `['budget_periods','budget_periods',…]` and turned the test red.
- **Fix:** compare the **distinct** table names, and add a separate
  `LOG_EVENT_TRIGGER_ROWS = 6` assertion so the new tolerance stays bounded. Without that
  count, a second *unnarrowed* update trigger on `budget_periods` — the exact defect the
  split exists to avoid — would slip through while the name set stayed identical. The
  existing `tgenabled` filter already runs over all six rows, satisfying the plan's "and
  `tgenabled` must be asserted on both rows".
- **Files modified:** `tests/db/event-trigger.test.ts`
- **Commit:** `b30f433`

**2. [Rule 2 — Missing critical functionality] `settle_reservation` double-subtracted a released reservation**

- **Found during:** Task 2.
- **Issue:** The plan's body subtracts `v_est` from `reserved_micro_usd` unconditionally.
  But the self-heal in `app.reserve_budget` (Pattern 2, also mandated) may already have
  released that reservation and decremented `reserved_micro_usd` by the same amount — the
  ordinary case of a call that outlives its 10-minute TTL. Subtracting a second time drives
  `reserved_micro_usd` negative, `bp_non_negative` aborts the transaction with `23514`, and
  the ledger row for a call that really was billed is lost. Pattern 2 and Pattern 4 do not
  compose unless this is conditional.
- **Fix:** capture `settled_at`/`released_at` with the reservation and subtract
  `case when both are null then est else 0 end`.
- **Files modified:** `drizzle/0016_budget_meter_functions.sql`
- **Commit:** `4098e86`

**3. [Rule 2] `has_any_column_privilege` added to the grants audit**

- **Found during:** Task 1.
- **Issue:** `must_haves` truth D-10 is "`authenticated` holds no UPDATE grant on
  `budget_periods` **at all**". `has_table_privilege(...,'UPDATE')` cannot state that — it
  returns `false` for `runs` and `orgs` too, and both hold *column-level* UPDATE. Migration
  0015 could later be softened to `grant update (cap_micro_usd) on budget_periods`,
  restoring exactly the direct-write path `app.set_budget_cap` exists to be the only door
  to, and every assertion would stay green.
- **Fix:** added an `has_any_column_privilege` block asserting no any-column UPDATE on
  `budget_periods`/`cost_reservations` and no any-column INSERT on `cost_ledger`, with
  `runs` any-column UPDATE = `true` as the positive control.
- **Files modified:** `tests/db/grants-audit.test.ts`
- **Commit:** `b30f433`

**4. [Rule 1] Division-by-zero guard on the utilisation percentage**

`round(100.0*(v_s+v_r)/v_c, 1)` raises `22012` if a cap is ever `0` — permitted by
`bp_non_negative` (`>= 0`), reachable by owner-level SQL though not by `set_budget_cap`.
Wrapped the divisor in `nullif(v_c, 0)` so utilisation reports `NULL` instead of aborting a
reserve. Commit `4098e86`.

**5. [Rule 3] A warning comment tripped the plan's own raw grep**

The 0016 header warned against PG-18-only syntax and, in doing so, contained the literal
token the plan's acceptance grep searches for. `tests/unit/pg17-compat.test.ts` strips
comments and stayed green, but the plan's criterion is a raw `grep` with no stripper — this
is the self-invalidating grep gate that test's own header documents. Reworded the comment to
warn without spelling the token; both the test and the literal grep now return 0.
Commit `4098e86`.

### Plan Text vs Reality (no code change)

- **Migration numbering.** Task 2's file is `0016_budget_meter_functions.sql`, not `0015`.
  drizzle-kit named the generated schema migration `0014_brown_phantom_reporter.sql`
  itself; renaming a generated file breaks its checksum, so the custom migrations took 0015
  and 0016.
- **The money-column grep is unsatisfiable as literally written.**
  `grep -cE "bigint\('(cap|reserved|spent|est|cost)_micro_usd'"` returns **4**, not "at
  least 5" — because the plan's own column spec names the ledger column `micro_usd`, with
  no `cost_` prefix, so its own regex cannot match it. The underlying property
  ("no money column is an integer") **does** hold: all five are `bigint` —
  `cap_micro_usd`, `reserved_micro_usd`, `spent_micro_usd`, `est_micro_usd`, `micro_usd`.
- **"Phase 1's five" `app` functions are six** — `app.jwt/0` was not counted.

## Notes for the Orchestrator

- **`STATE.md` and `ROADMAP.md` were not touched**, per the worktree contract.
- **`REQUIREMENTS.md` was deliberately not marked complete.** BUDG-01 says "*every outbound
  paid API call* writes a cost-ledger row — instrumented before the first billable call",
  and BUDG-02 names an enforced cap "gating both enumeration and verification". This plan
  ships the **mechanism**; no outbound paid call is instrumented yet (Phase 3/4) and the
  meter's own tests are plan **02-08**'s. Marking them done here would overclaim, and it
  would also collide with the sibling worktrees on the same file. Recommend marking them
  after 02-08 lands.
- **Shared local Postgres:** migrations **0014, 0015, 0016** applied to `siteless_test`
  (14 → 17 journal rows). Additive only; nothing dropped or truncated. Supabase MCP never
  used; `db:migrate:prod` never run.

## Threat Flags

None. Every surface added is in the plan's `<threat_model>` (T-2-02 through T-2-07, T-2-10,
T-2-11) and each disposition is `mitigate`, implemented as described above.

## Known Stubs

None.

## Self-Check: PASSED

Files verified present:

```
FOUND: src/db/schema/budget.ts
FOUND: drizzle/0014_brown_phantom_reporter.sql
FOUND: drizzle/0015_budget_grants_and_triggers.sql
FOUND: drizzle/0016_budget_meter_functions.sql
FOUND: drizzle/meta/0014_snapshot.json
FOUND: drizzle/meta/0015_snapshot.json
FOUND: drizzle/meta/0016_snapshot.json
```

Commits verified in `git log`:

```
FOUND: b30f433  feat(02-05): budget meter tables, select-only grants, narrowed audit trigger
FOUND: 4098e86  feat(02-05): the meter as five SECURITY DEFINER functions
```

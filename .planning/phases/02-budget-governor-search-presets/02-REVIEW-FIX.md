---
phase: 02-budget-governor-search-presets
fixed_at: 2026-09-22T20:05:00Z
review_path: .planning/phases/02-budget-governor-search-presets/02-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-09-22
**Source review:** `.planning/phases/02-budget-governor-search-presets/02-REVIEW.md`
**Iteration:** 1
**Branch / HEAD after:** `main` @ `90aa202` (base `e504252`, clean tree)

**Summary:**

- Findings in scope: 10 (CR-01, WR-01…WR-09; the ten Info findings were out of scope)
- Fixed: 10
- Skipped: 0

Every fix was committed on its own, after its test was watched RED by name. Four new
migrations were applied to the **local `siteless_test` database only** — see *Production
owed* at the bottom.

## Commits

| Finding | Commit | What changed |
|---|---|---|
| CR-01 | `6b1bfd7` | composite `(search_id, org_id)` FK + ownership read in `savePresetVersion` |
| WR-01 | `a6139bc` | `app.release_expired_reservations`, called from every read path |
| WR-03 | `498008c` | `settle_reservation` derives provider/sku; the ledger row survives a late settle |
| WR-04 | `01f9afe` | `reserve_budget` re-checks `p_run` against the caller's org |
| WR-02 | `d2bc23f` | `BUDGET_CAP_HELP` tells the truth; the architectural half deferred with an owner |
| WR-05 | `3d05833` | the estimate snapshot is priced on the server, from the spec being saved |
| WR-06 | `c3acb46` | the estimate clears when the selection stops being estimable |
| WR-07 | `98931a3` | `presets.ts` timestamps cast at the boundary; the page's private copy deleted |
| WR-08 | `2db5d1a` | `src/lib/ids.ts`, called by both `[id]` routes, proven by a route walk |
| WR-09 | `90aa202` | the queued-run spend spec fixed **and executed** |

## Gate

Each exit code read directly, from the store launcher (`pnpm verify` does not run on this
machine, so the five constituents were run individually):

| Gate | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | clean |
| `pnpm test:unit` | 0 | **81 passed** (20 files) — baseline was 76 |
| `pnpm test:db` | 0 | **102 passed** (15 files) — baseline was 90 |
| `pnpm build` | 0 | compiled successfully |

`pnpm test:e2e` against a local `next start` on port 3111: **19 passed, 2 skipped** (the
two remaining skips are `budget-banner`'s threshold tests, which self-skip on real
committed spend and are already recorded in `deferred-items.md`).

Branch and sha after the gate: `main` @ `90aa202`, tree clean.

## Fixed Issues

### CR-01: `savePresetVersion` writes a version onto another tenant's preset

**Files:** `drizzle/0017_strange_mathemanic.sql`, `src/server/actions/save-preset-version.ts`,
`tests/db/versioned-presets.test.ts` · **Commit:** `6b1bfd7`

Fixed in two places, because the application read alone would have been a promise rather
than a guarantee:

- **Database.** A composite FK `search_versions (search_id, org_id) → searches (id, org_id)`,
  plus the same shape from `runs` to `search_versions`. Only a composite key carries the
  tenant into a referential check — and referential checks are evaluated with the referenced
  table owner's privileges, by design, which is precisely why RLS could never refuse this. The
  `unique (id, org_id)` keys are the prerequisite and add no row-level restriction whatsoever:
  `id` is already the primary key, so they cannot refuse an insert the primary key admits.
- **Action.** One ownership `select` under RLS before the insert on the edit path, returning
  the typed `not_found`. A foreign id and a deleted id are the same answer (T-2-10) — never an
  `exists`, never a count.

**Watched red first:** `tests/db/versioned-presets.test.ts` › `tenancy: a version cannot be
attached to another org's search`. The INSERT came back with `rowCount: 1` and a real row id
where `23503` was demanded — the defect reproduced exactly as CR-01 describes it, as tenant A
writing onto tenant B's preset.

**Control, written in the same commit and green throughout:** `tenancy: a version on the
caller's OWN search is still accepted`. A composite FK written against the wrong columns would
refuse every version and break the product while the cross-tenant test stayed green.

### WR-01: expired reservations are never released except by the next `reserve_budget`

**Files:** `drizzle/0018_condemned_luke_cage.sql`, `tests/db/budget-meter.test.ts`,
`tests/db/budget-admin-gate.test.ts` · **Commit:** `a6139bc`

Step 1 of the meter was lifted out whole into `app.release_expired_reservations(provider,
period)` and is now called from `app.ensure_budget_period` — the get-or-create every read
already goes through — and from `app.reserve_budget`. One body, three callers: two copies of a
balance adjustment is how `reserved_micro_usd` drifts. `set_budget_cap` needed no change; it
goes through `ensure_budget_period` before it touches the cap, so its floor is live too.

No cron job: the CONTEXT rates `pg_cron` LOW-confidence on this Supabase plan, and a scheduled
sweeper stops when the project pauses. Calling it from the read path keeps the scheduler off
the correctness path entirely, which is what the self-heal was already for.

**Watched red first, both by name:**
- `budget-meter.test.ts` › `a read after the TTL no longer counts the expired hold`
- `budget-admin-gate.test.ts` › `set_budget_cap: an expired hold no longer holds the cap floor up`

**Controls green before and after:** `a read does not release a live hold`, and
`set_budget_cap: a LIVE hold still holds the cap floor up`. Money promised to a call happening
right now is committed spend, and a release that ignored the TTL would breach the cap for real
on the read path.

**Mutation check** (live database only; `git diff --stat drizzle/` empty throughout, and the
definition read back out of `pg_get_functiondef` rather than trusting that a script ran):
replacing the function body with `return 0` reds exactly four tests — the two above plus
`self-heal: a crashed worker's expired reservations are released by the next reserve` and
`concurrent burst survives a crashed worker holding the whole cap` — and leaves both live-hold
controls green. Reverted from the migration file.

The meter itself is unchanged where it matters: the 40-way burst re-executed at
`granted=10 denied=30 reserved=100` against a cap of 100.

Note on the copy the review flagged as false: `period-header.tsx`'s "reserved by runs in
flight" needed no edit — it is now a true sentence, because only live holds are counted.

### WR-02: the cap is per provider in the database, `places`-only in the UI, "all three together" in the copy

**Files:** `src/lib/ui/copy.ts`, `tests/unit/ui-maps.test.ts`, `deferred-items.md` ·
**Commit:** `d2bc23f`

**The choice, documented because it is a choice.** `budget_periods` is keyed
`(org_id, provider, period_start)` and `app.reserve_budget`'s conditional UPDATE matches one
such row. That single statement is the entire concurrency control and it is atomic *because*
it touches one row — a ceiling spanning three rows cannot be enforced by it at all. So the
copy was the part that was wrong, and it is the part fixed here. The number on screen is not
wrong today: Places is the only provider that reserves anything in Phase 2.

Honouring D-13 as one **org-wide** ceiling means a provider-less meter row, or aggregating on
read (which loses the atomic guarantee that is ROADMAP success criterion 5), or three explicit
inputs (which contradicts D-13). All three change the meter, the burst proof and four screens
together. That is architecture with an owner, so it is recorded in `deferred-items.md` under
danlo with the trap it leaves named explicitly: Phase 5's first Firecrawl reservation would
otherwise meter against a lazily-created $50 row nobody set and no screen displays.

**Guard:** `tests/unit/ui-maps.test.ts` › `ui copy: the cap help claims only the scope the
meter enforces` reads `budget_periods_org_provider_period_uniq` out of `drizzle/` and the
sentence out of `copy.ts` and compares them — copy and schema are otherwise never compared,
which is why this survived every gate.

**Mutation check:** restoring the old sentence reds that test alone
(`expected 'Applies to Places, Firecrawl and Anth…' not to match /together/i`); reverted and
green.

### WR-03: `settle_reservation` trusts caller-supplied `provider`/`sku`, and a late settle can lose the ledger row

**Files:** `drizzle/0019_aromatic_bromley.sql`, `tests/db/budget-meter.test.ts` ·
**Commit:** `498008c`

- **Derive, never accept.** `sku` comes off the reservation and `provider` off the period it
  points at, through a join, and both are *written* from the derived values. The caller's own
  arguments are still checked and refused with `22023` rather than silently swapped: a caller
  passing the wrong sku holds a wrong belief, and overwriting it underneath them leaves that
  belief intact and un-investigated.
- **The ledger row survives.** The insert now precedes the balance update and sits *outside*
  its exception block, so a late settle after a self-heal records the charge and emits a
  `budget_overrun` event instead of aborting on `bp_not_over` and dropping a row for money
  Google really billed. The alternative — dropping the constraint — would remove the second
  wall (T-2-07).

**Watched red first, all three by name:**
- `settle after release does not lose the ledger row` →
  `new row for relation "budget_periods" violates check constraint "bp_not_over"`
- `settle_reservation refuses a sku that is not the reservation's` → accepted
- `settle_reservation refuses a provider that is not the period's` → accepted

**Controls:** the three existing settlement tests (idempotency on `request_id`,
reserve-the-worst-case, and the zero-cost free-tier row) stayed green, so a derivation that
refused every settle could not pass for a fix.

**Deviation from the review text, deliberate:** the errcode is `22023`, not the `P0001` the fix
brief suggested. `settle_reservation` already raises `22023` for every bad argument (negative
actual, non-positive units, no such reservation) and `42501` for tenancy; a sku/provider
mismatch is an argument disagreement, so it takes the file's own argument errcode. Both are
pinned in the tests by code *and* by message.

### WR-04: `reserve_budget` accepts a `p_run` from any org

**Files:** `drizzle/0020_yellow_ricochet.sql`, `tests/db/budget-meter.test.ts` ·
**Commit:** `01f9afe`

The same check `settle_reservation` already carries for a reservation id, written the same
way: tenant from the claims, compared explicitly, with "belongs to somebody else" and "does not
exist" given the **same** refusal so the message is not an existence oracle on run ids. A null
run stays legitimate.

**Watched red first:** `reserve_budget refuses a run belonging to another org` — the reserve
was accepted where `42501` was demanded.

**Control, written in the same commit:** `reserve_budget accepts the caller's own run`. Every
other test in the file reserves with a null run and would have stayed green through a check
written against the wrong side of the comparison — which would refuse every run `queueRun`
makes, i.e. all of them.

**Deviation from the review text, deliberate:** `42501` rather than the `22023` the review's
snippet used. This is a tenancy answer, matching `settle_reservation`'s sibling refusal and
CLAUDE.md's rule that every `org_id` assertion pins `42501`.

The burst re-executed green at `granted=10/40, reserved=100`.

### WR-05: a stale `estimateSnapshot` from a previous selection is saved

**Files:** `src/server/actions/save-preset-version.ts`,
`src/components/preset-editor/preset-form.tsx`, `tests/unit/server-actions-guard.test.ts` ·
**Commit:** `3d05833`

The field is gone from the input schema and the snapshot is recomputed inside the transaction
that writes the version — same seed, same period, same free allowance as `estimate-preset.ts`.
`null` when the estimator refuses, because a preset genuinely costing $0.00 early in the month
is a real answer and "no snapshot" must stay distinguishable from "$0.00" (`preset-card.tsx`
renders them differently on purpose).

Both halves of the finding are closed: the staleness (the hook marks a key settled on its
error branch, so the form's `busy` guard was false while the panel showed another spec's
price) and the authorship (client-supplied data stored as "what the estimator quoted", shape-
validated and nothing more).

**Guard:** `tests/unit/server-actions-guard.test.ts` › `no server action takes a price from
the client` walks every action's `z.strictObject` input shape, because the *shape* — a money
value a caller hands in that the product then attributes to itself — is what recurs, not the
field name. Phase 4's settle path is the next candidate.

**Mutation check:** re-adding `estimateSnapshot: z.unknown().optional()` to the schema reds
that test alone; reverted and green.

🔴 **Not executed end to end.** The action carries the server directive and cannot be imported
by a unit test, and the e2e spec that creates a preset ran against the local server *before*
this change. typecheck, lint and the unit suite are green, and the new arithmetic is the same
call `estimate-preset.ts` already makes with the same arguments — but the first real execution
of the new save path will be the next e2e run. **Worth a human eye.**

### WR-06: the estimate panel keeps the previous dollar figure after the selection stops being estimable

**Files:** `src/components/preset-editor/use-live-estimate.ts`,
`tests/unit/stale-estimate.test.tsx` · **Commit:** `c3acb46`

Cleared in the hook, not the panel: the panel is handed `estimate` and cannot tell "the last
good value" from "the value for THIS selection". `settledKey` is cleared with it, or `busy`
would stay false against a key that never settled once a selection is picked again.

**Watched red first:** `stale estimate: clearing the selection removes the figure and restores
the prompt` → *Unable to find an element with the text: Pick at least one cluster to see an
estimate.* — the stale figure was still rendered in its place.

**The discriminating control is in the same file and stayed green:** `stale estimate: the
previous value stays visible while recomputing`. A hook that cleared on every key change would
satisfy the new test and break Executor Rule 11; that test is what says so. Both out-of-order
sequence-guard tests are green, so the monotonic guard is untouched.

### WR-07: `readPreset`/`readPresets` declare `Date` for timestamps that arrive as strings

**Files:** `src/server/queries/presets.ts`, `src/server/queries/budget.ts`,
`src/app/(app)/presets/[id]/page.tsx`, `tests/db/versioned-presets.test.ts` ·
**Commit:** `98931a3`

Cast to epoch milliseconds in SQL and converted once at the boundary, the way `budget.ts`
already does for bigint, for `date` and for its own timestamps. The detail page's private
normaliser is deleted — it fixed one screen and left `listPresets` and the edit page handing a
string to anything calling `formatLocal` — and the page's own last-run query is cast the same
way. `requireInstant()` joins `instantOf()` in `budget.ts` for NOT NULL columns and throws
rather than rendering 1970.

**Executed, not reasoned about:** `tests/db/versioned-presets.test.ts` › `timestamps: the
epoch-ms cast the query module reads is exact and parseable` runs the real expression against
the real database and pins three things: digits only, the bigint truncation equals the numeric
one (so it is not rounding a microsecond into another second), and it is the **same instant**
as the row's own rendering — which is what discriminates a cast that dropped the offset and
would otherwise land the row hours away and still look valid.

🔴 The test states plainly what it **cannot** prove: `tests/db` connects with node-postgres,
which parses oid 1184 into a `Date`, so this suite cannot reproduce the string that caused the
defect (that is postgres.js with `prepare: false`). Claiming otherwise would have been the
dishonest version of this test.

### WR-08: `/presets/[id]/edit` does not validate the id and 500s on a malformed URL

**Files:** `src/lib/ids.ts`, both `[id]` routes, `tests/unit/ids.test.ts` ·
**Commit:** `2db5d1a`

The regex moved to one module, anchored at both ends (an unanchored pattern matches a uuid
anywhere in the segment while the whole string still reaches the query), with no client
directive.

🔴 The guard is not the interesting part; the **second copy** is. So the test walks `src/app`
for every page under an `[id]` segment and asserts each one calls `isUuid`, rather than testing
the regex in isolation — a unit test over `isUuid` alone would have been green for the entire
time the edit page was crashing.

**Watched red first:** `tests/unit/ids.test.ts` → `Error: Cannot find package '@/lib/ids'`.
**Mutation check after:** deleting the call from the edit page reds `ids: every [id] route
guards its id before it queries` alone, naming the file. Restored and green.

### WR-09: `spend.spec.ts` › "lists a queued run" can never execute and reads as a pass

**Files:** `tests/e2e/spend.spec.ts` · **Commit:** `90aa202`

Both hooks fixed (the card *is* the anchor; the trigger is `run-preset`, not the non-existent
`preset-run-cta`), the preset name read from the card's `data-preset-name` before navigating,
the "ships in plan 02-12" skip deleted now that 02-12 has shipped, and the `if (count > 0)`
around the trigger click removed — a probe that tolerates a missing trigger is how this passed
for a fortnight without opening anything.

🔴 **Proved by execution, which is the only thing that settles a silently-skipped test.**
Built (`pnpm build`, exit 0) and ran the suite against a local `next start` on port 3111 with
`SUPABASE_DB_POOL_URL` pointed at the local `siteless_test` database, so **nothing touched
production**:

```
17 [chromium] › spend.spec.ts:112 › spend: the by-run tab lists a queued run (1.7s)   PASS
19 passed, 2 skipped (40.8s)
```

It is line 17 of the run and no longer a dash.

**Database left as found.** The execution wrote one queued run, one 1 µUSD hold (the free-tier
estimate's minimum reservation) and three `e2e-*` presets. All were removed in one transaction,
with `reserved_micro_usd` decremented in the same statement so the balance could not drift, and
the state re-read afterwards: `runs 0, open holds 0, reserved 0, searches back to 18`. Only my
own PID was stopped, verified by its command line before the kill.

## Skipped Issues

None. All ten in-scope findings were fixed.

The ten **Info** findings (IN-01…IN-10) were out of scope for this pass (`fix_scope:
critical_warning`) and are untouched.

## Production owed

🔴 **Four new migrations were applied to the LOCAL `siteless_test` database only.** Production
Supabase is **PostgreSQL 17.6** while this machine and CI are 18; every statement below was
written to the 17-compatible subset and `tests/unit/pg17-compat.test.ts` greps `drizzle/` and
is green.

| Migration | Carries |
|---|---|
| `drizzle/0017_strange_mathemanic.sql` | CR-01 — composite `(id, org_id)` unique keys and the two composite FKs |
| `drizzle/0018_condemned_luke_cage.sql` | WR-01 — `app.release_expired_reservations`, and `ensure_budget_period` / `reserve_budget` calling it |
| `drizzle/0019_aromatic_bromley.sql` | WR-03 — `settle_reservation` derives provider/sku and keeps the ledger row |
| `drizzle/0020_yellow_ricochet.sql` | WR-04 — `reserve_budget` re-checks `p_run`'s org |

Production is owed the same **pre-flight read → danlo's approval → `db:migrate:prod` →
post-flight read** sequence plan 02-14 used. That is danlo's decision and his to run, not this
agent's: no production connection was opened at any point in this pass.

One thing to weigh before applying 0017: it adds foreign keys to existing tables, so
PostgreSQL validates every existing row. Production currently holds the six `e2e-*` presets
plan 02-15 left behind; they were written by one tenant and should validate, but the pre-flight
read is the moment to confirm it rather than discover it during the migration.

---

_Fixed: 2026-09-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

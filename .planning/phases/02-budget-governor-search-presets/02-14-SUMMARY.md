---
phase: 02-budget-governor-search-presets
plan: 14
subsystem: infra
tags: [postgres, supabase, drizzle-kit, migrations, seed, rls, grants, google-maps-platform, vercel]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy
    provides: "the production Supabase project, `scripts/db.ts`'s `--target=prod` gate, `app_user`, and the pre-flight/post-flight discipline 01-10 established"
  - phase: 02-budget-governor-search-presets
    provides: "plans 02-02/02-03/02-05/02-06 (the twelve tables, five meter functions, reference policies and the seed loader); 02-11/02-12/02-13 (the screens that read them)"
provides:
  - "Phase 2's twelve tables, five `app.*` functions, eight named constraints, 56 policies and 19 `public` triggers LIVE on production Supabase `jahgeqshuesndyscnmjo`, applied by drizzle-kit alone"
  - "The reference rows on production: 254 counties, 17 cities, 4 industry clusters, 33 industry terms, 20 outlet-count rows, 3 geo presets — idempotent on re-run"
  - "Proof that PostgreSQL 17.6 accepts every statement of migrations 0012–0016, on the real server rather than by grep"
  - "`docs/runbooks/google-quota.md` — BUDG-03's console path, derivation, two Google caveats and the three-timezone warning"
  - "`docs/deploy.md` extended with the Phase 2 migration/seed recipe and two recorded gotchas"
  - "danlo's confirmation that the RGV city list is the 17 as measured — the Phase 2 / Phase 3 shared contract"
  - "Research assumption A7 resolved: the Vercel team is on Pro"
affects: [03-free-data-spine, 04-places-verification, 09-scheduler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A separate, later, read-only connection verifies a production write — never the mutating script's own output"
    - "A catalog count used as an acceptance criterion must be schema-scoped (`public`), because Supabase ships its own triggers in `realtime` and `storage`"
    - "Idempotency of `drizzle-kit migrate` is decided by the journal row count, never by the exit code or the success banner"
    - "Grant assertions are read as NEGATIVES from `information_schema` — counts of rows that must be absent"

key-files:
  created:
    - .planning/phases/02-budget-governor-search-presets/02-14-PREFLIGHT.md
    - .planning/phases/02-budget-governor-search-presets/02-14-POSTFLIGHT.md
    - docs/runbooks/google-quota.md
  modified:
    - docs/deploy.md

key-decisions:
  - "The RGV city list stands at the 17 as measured — Raymondville (221 outlets) stays below the 400-outlet line, so Willacy County is unrepresented among cities though present among counties. danlo confirmed explicitly; Phase 3's ingest scope reads this."
  - "BUDG-03's Google quota is recorded as BLOCKED, not deferred silently: the GCP project does not exist, so it becomes the first item of Phase 4's setup. Nothing in Phase 2 depends on it and `tests/unit/no-google-credential.test.ts` is the standing proof."
  - "REQUIREMENTS.md marks only SRCH-02 for this plan. BUDG-01/BUDG-02 keep 02-05's judgement — the mechanism is now on production but no instrumented outbound paid call exists until Phase 3/4 — and BUDG-03 cannot be marked while the quota is unset."
  - "The plan's literal credential criterion is unsatisfiable by construction (the regex contains `sk_`, so every document quoting it matches itself); 01-10's discriminating scan was run instead, as in Task 1."

patterns-established:
  - "Production verification pairs every reading with its local twin and states which differences are EXPECTED before showing them"
  - "A human checkpoint answered `blocked` produces a carried-forward blocker with the exact console path, not a TODO"

requirements-completed: [SRCH-02]

# Metrics
duration: ~21 min of agent work across three dispatches (checkpoint wait excluded)
completed: 2026-09-22
---

# Phase 02 Plan 14: Production Migration, Seed, Google Quota & Vercel Plan Summary

**Phase 2's twelve tables, five meter functions, 56 policies and 254/17/4/33/20/3 reference rows are live on production Supabase (PostgreSQL 17.6) — applied by drizzle-kit alone, verified object-for-object against local on a separate read-only connection, with BUDG-03's Google quota recorded as blocked on a GCP project that does not exist.**

---

## 🔑 FLAGGED AT THE TOP — the Phase 2 / Phase 3 shared contract

> **`city list: 17 as measured`** — danlo's explicit answer.

The RGV city picker ships the **17 cities with at least 400 active sales-tax outlets**, covering **90.9 %** of the RGV outlet universe after folding Rio Grande City's three source spellings. **Raymondville (221 outlets)**, Willacy County's only town, falls below the line and is therefore **NOT** in the picker — so **Willacy is unrepresented among cities though it is present among counties**. That is deliberate and confirmed, not an oversight.

No follow-up is owed. `src/seed/data/cities.json` still lists the next five candidates, so promoting one later is a one-file edit plus a re-seed. **Phase 3's ingest scope reads this list** — it is now settled on both sides.

---

## Performance

- **Duration:** ~21 min of agent work across three dispatches (the two human checkpoint waits are excluded); task commits span 12:30:56 → 12:42:16 CDT
- **Started:** 2026-09-22T17:20:00Z (approx., Task 1 pre-flight)
- **Completed:** 2026-09-22T17:55:00Z
- **Tasks:** 3 of 3 (Task 1 auto, Tasks 2 and 3 blocking human checkpoints, both answered)
- **Files created/modified:** 4

## Accomplishments

- **Production carries Phase 2's schema.** Twelve tables (all with `relrowsecurity = true`), five `app.*` meter functions, eight named constraints, 56 policies, 19 `public` triggers — every pair matching local.
- **Production carries Phase 2's seed.** 254 counties / 17 cities / 4 clusters / 33 industry terms / 20 outlet-count rows / 3 geo presets, and a second run inserted **0** of everything.
- **PostgreSQL 17.6 accepted every statement of migrations 0012–0016.** That is the claim `tests/unit/pg17-compat.test.ts` exists to protect, and it is now proven on the real server rather than argued from a grep. Local and CI are 18.6.
- **The threat-model grant facts were read as negatives from `information_schema` on production**, not inferred from local: T-2-02, T-2-03, T-2-09 and T-2-12 all hold there.
- **BUDG-03's runbook exists whether or not the quota is ever set**, so the derivation and the honest limitation cannot drift.
- **Research assumption A7 is resolved:** the Vercel team is on **Pro**, unblocking the Phase 9 scheduler.

## Task Commits

| Task | Name | Commit | Type | Files |
| ---- | ---- | ------ | ---- | ----- |
| 1 | Pre-flight READ against production — no writes | `831a21b` | docs | `02-14-PREFLIGHT.md` |
| 2 | [danlo] Approve the production migration and seed, then apply and verify | `f226e18` | docs | `02-14-POSTFLIGHT.md`, `docs/deploy.md` |
| 3 | [danlo] The Google Cloud daily quota (BUDG-03) and the Vercel plan | `0027e1a` | docs | `docs/runbooks/google-quota.md` |
| 3 | — follow-up: keep the budget-alert quote on one line so a grep finds it | `b08870f` | docs | `docs/runbooks/google-quota.md` |

**Plan metadata:** see the final two commits listed at the end of this file.

---

## danlo's replies, verbatim

### Task 2 (2026-09-22)

```
prod migration: approved
prod seed: approved
city list: 17 as measured
```

### Task 3 (2026-09-22)

```
google quota: blocked - no GCP project yet
vercel plan: pro
```

---

## Task 1 — the pre-flight, production beside local

Recorded before anything in this plan wrote. Every connection opened `begin read only`; only names and counts were selected. Full detail in [`02-14-PREFLIGHT.md`](./02-14-PREFLIGHT.md).

| Reading | Production | Local |
| --- | --- | --- |
| `version()` | **PostgreSQL 17.6** on x86_64-pc-linux-gnu, gcc 15.2.0, 64-bit | **PostgreSQL 18.6** on x86_64-windows, msvc-19.44.35228, 64-bit |
| `drizzle.__drizzle_migrations` rows | 12 (`0000_bootstrap` … `0011_events_no_caller_insert`) | 17 (`0000_bootstrap` … `0016_budget_meter_functions`) |
| `public` tables | 4 | 16 |
| `app.*` functions | 6 | 11 |
| `pg_policy` count | 12 | 56 |
| non-internal triggers | 13 | 19 |

**Production `public` tables (4):** `businesses`, `events`, `orgs`, `source_records`
**Production `app.*` functions (6):** `current_org_id`, `emit_event`, `ensure_org`, `jwt`, `log_event`, `touch_updated_at`

**The gap Task 2 closed:** +12 tables, +5 functions, +44 policies, +6 triggers, +5 migrations (`0012_eager_vertigo`, `0013_reference_policies_and_grants`, `0014_brown_phantom_reporter`, `0015_budget_grants_and_triggers`, `0016_budget_meter_functions`).

### STOP conditions — all clear

| # | Condition | Result |
| --- | --- | --- |
| 1 | Any of this phase's twelve tables already on production | **CLEAR** — none present |
| 2 | `public` holds only Phase 1's four tables | **CLEAR** — exactly those four |
| 3 | Every applied migration exists in `drizzle/` | **CLEAR** — all 12 applied hashes match a committed file |

`ls supabase` exits 2 — there is **no Supabase CLI migration directory** in this repository, and no Supabase CLI, MCP `apply_migration` or dashboard SQL editor was used for any schema object. D-09 holds.

### Portability gates, re-run immediately before the production write

Test **names** read from the output, not just the exit code:

```
pnpm test:unit -t "pg17"           -> 2 passed, exit 0
  ✓ pg17: no migration uses PostgreSQL 18-only syntax
  ✓ pg17: the comment-stripping guard is not self-invalidating

pnpm test:db -t "server version"   -> 1 passed, exit 0
  ✓ server version: the test database is at least PostgreSQL 17
```

---

## Task 2 — the write, and the post-flight

### `pnpm db:migrate:prod`, twice

Run 1: exit 0; the five Phase 2 migrations applied in order. **Not one statement was refused by PostgreSQL 17.6.**
Run 2: exit 0, **applied nothing**.

🔴 **The exit code and the success banner do not discriminate.** `drizzle-kit migrate` prints `[✓] migrations applied successfully!` on *both* runs — a no-op run is not announced as one. The journal is the witness:

| Evidence | First run | Second run |
| --- | --- | --- |
| `drizzle.__drizzle_migrations` rows afterwards | 17 | **still 17** (not 22) |
| stdout bytes | 2,261 | 389 |
| `applying migrations` spinner frames | 56 | 1 |

A re-applied `create table` would additionally have raised `42P07` and exited non-zero, so exit 0 is a second, independent witness — but the journal count is the direct one.

### `pnpm db:seed:prod`, twice — both summary blocks verbatim

```
$ pnpm db:seed:prod            (first run)
scripts/seed.ts: target=prod
counties: 254 inserted, 0 updated
industry_clusters: 4 inserted, 0 updated
industry_terms: 33 inserted, 0 updated
cities: 17 inserted, 0 updated
outlet_counts: 20 inserted, 0 updated
geo_presets: 3 inserted, 0 updated
```

```
$ pnpm db:seed:prod            (second run)
scripts/seed.ts: target=prod
counties: 0 inserted, 254 updated
industry_clusters: 0 inserted, 4 updated
industry_terms: 0 inserted, 33 updated
cities: 0 inserted, 17 updated
outlet_counts: 0 inserted, 20 updated
geo_presets: 0 inserted, 3 updated
```

**0 inserted for every table on the second run** and the row counts below unchanged — so the `on conflict on constraint` / `NULLS NOT DISTINCT` pairing held on 17.6 exactly as it does on 18. A plain `UNIQUE (org_id, key)` would have silently doubled every built-in here; it did not occur. The seed ran as the migration owner, the only role that can write an `org_id IS NULL` row at all.

### Post-flight — production beside local, every row

Read on a **separate, later, read-only connection**, never from the mutating script's output.

| Reading | Production | Local | Verdict |
| --- | --- | --- | --- |
| `version()` | PostgreSQL 17.6 | PostgreSQL 18.6 | **expected difference — the point of this plan** |
| `drizzle.__drizzle_migrations` rows | 17 | 17 | match |
| `public` tables | 16 | 16 | match |
| `public` tables WITHOUT `relrowsecurity` | (none) | (none) | match |
| this phase's twelve tables, present AND `relrowsecurity = true` | 12 | 12 | match |
| `pg_policy` total | 56 | 56 | match |
| `pg_policy` in `public` | 56 | 56 | match |
| the eight named constraints | 8 of 8 | 8 of 8 | match |
| `app.*` functions | 11 | 11 | match |
| this phase's five `app.*` functions | 5 of 5 | 5 of 5 | match |
| non-internal triggers **in `public`** | 19 | 19 | match |
| non-internal triggers, unscoped | 27 | 19 | **expected difference — see below** |
| `search_versions` grants to `authenticated` | `INSERT, SELECT` | `INSERT, SELECT` | match |
| `budget_periods` grants to `authenticated` | `SELECT` | `SELECT` | match |
| `cost_reservations` grants to `authenticated` | `SELECT` | `SELECT` | match |
| `cost_ledger` grants to `authenticated` | `SELECT` | `SELECT` | match |
| `runs` table-level grants to `authenticated` | `INSERT, SELECT` | `INSERT, SELECT` | match |
| `runs` columns `authenticated` may UPDATE | `calls_count, cost_micro_usd, finished_at, started_at, status, stopped_reason` | identical | match |
| `counties` rows (`org_id is null`) | 254 | 254 | match |
| `cities` rows | 17 | 17 | match |
| `industry_clusters` rows | 4 | 4 | match |
| `industry_terms` rows | 33 | 33 | match |
| `geo_presets` rows | 3 | 3 | match |
| `outlet_counts` rows | 20 | 20 | match |
| `counties where county_fips <> 2 * comptroller_code - 1` | 0 | 0 | match |
| `budget_periods_event_upd` `pg_get_triggerdef` | present | present | **byte-identical** |

**Every pair matches.** The two rows marked as differences are the two that are *supposed* to differ, and both were predicted:

1. **17.6 versus 18.6 is the entire subject of this plan.**
2. **The unscoped trigger count is the 01-10 gotcha, repeated exactly.** Supabase ships non-internal triggers of its own outside `public`: `realtime` 1 + `storage` 7 = 8, so production reads 19 + 8 = 27 where local reads 19.

   | Schema | Production | Local |
   | --- | --- | --- |
   | `public` | 19 | 19 |
   | `realtime` | 1 | 0 |
   | `storage` | 7 | 0 |

   The **schema-scoped** count is the one that means anything, and it matches.

The 19 `public` triggers are set-identical on both — local-minus-production and production-minus-local are both empty. `budget_periods_event_upd` carries its `WHEN` clause on production, read from `pg_get_triggerdef`:

```sql
CREATE TRIGGER budget_periods_event_upd AFTER UPDATE ON public.budget_periods
  FOR EACH ROW WHEN ((old.cap_micro_usd IS DISTINCT FROM new.cap_micro_usd))
  EXECUTE FUNCTION app.log_event()
```

That `WHEN` is what keeps a cap that did not change from emitting an event — the same class of defect as BIS's 10 spurious `update` events. It survived the trip to 17.6 intact.

### The `information_schema` grant reads, as negatives

A grant table is easy to read optimistically. These were read as counts of what must be **absent**, on production:

| Assertion | Production | Local |
| --- | --- | --- |
| `authenticated` rows granting UPDATE or DELETE on `search_versions` (`role_table_grants`) | **0** | 0 |
| `authenticated` rows granting INSERT/UPDATE/DELETE on `budget_periods`, `cost_reservations`, `cost_ledger` (`role_table_grants`) | **0** | 0 |
| `authenticated` rows granting UPDATE on `runs.search_version_id` (`column_privileges`) | **0** | 0 |

- **T-2-12** rests on the first and third: a version is append-only, and a run cannot be re-pointed at a different version after the fact.
- **T-2-02** rests on the second: the only write path to a cap is `app.set_budget_cap` with its SQL role check.
- **T-2-03** additionally requires `cost_ledger.reservation_id` to be `NOT NULL` behind a foreign key. On production: `attnotnull = true`, foreign keys referencing the column = 1. Identical locally.
- **T-2-09**: the reference tables show `authenticated` with `SELECT, INSERT, UPDATE, DELETE` at the *grant* layer — the NULL-org exclusion is enforced by RLS **policy**, not by grant, which is why the policy count (56 = 56) is the load-bearing reading for this threat and not the grant list.

### Rows that differ for known test reasons

| Reading | Production | Local | Why |
| --- | --- | --- | --- |
| `orgs` total rows | 1 | 2 | a local fixture org from the wave-5 suites; not part of the comparison |
| `geo_presets` total rows | 3 | 3 | the wave-5 `e2e-*` presets were rolled back — built-ins only, on both |

### The three `docs/deploy.md` findings

1. **`drizzle-kit migrate` announces success identically on a no-op run** — the banner and the exit code are the same, so neither proves idempotency. The journal row count is the witness. Written into `docs/deploy.md` as a 🔴 callout.
2. **Scope every catalog count to `public`** — Supabase's `realtime` + `storage` triggers make an unscoped count read 8 higher on production, so a correct database looks broken. 01-10 hit this first (13 against a correct database); 02-14 hit it again as 27 versus 19. Written into `docs/deploy.md` as a 🔴 callout.
3. **The Google scan's one hit is a comment, and the credential scan is the discriminating one.** `grep -rn "GOOGLE\|X-Goog\|googleapis" src/ | wc -l` returns **1**, not 0 — `src/lib/budget/field-mask-tier.ts:5`, a comment explaining that the price of a call is a property of the `X-Goog-FieldMask` header. `tests/unit/field-mask-tier.test.ts` deliberately permits the name in **exactly one** module (`✓ X-Goog-FieldMask is named in at most one module under src`); the discriminating scan — anything that *reads* a Google credential — returns none.

`docs/deploy.md` was additionally extended with the Phase 2 migration file names, `pnpm db:seed:prod` and when to run it (after every migration that adds a reference table), and the note that `scripts/refresh-outlet-counts.ts` is **never** run in CI and never against production without a fresh review of the numbers it rewrites.

---

## Task 3 — BUDG-03 and the Vercel plan

### 🔴 CARRIED-FORWARD BLOCKER FOR PHASE 4 — the Google Cloud daily quota (BUDG-03)

**danlo answered `google quota: blocked - no GCP project yet`.** The Google Cloud project and the Places API (New) key **do not exist**. **No screenshot exists, because no quota was set** — there is nothing to screenshot.

**This blocks nothing in Phase 2.** The proof is enforced, not asserted: `tests/unit/no-google-credential.test.ts` is green on both of its tests, run as the **whole file** rather than through a `-t` filter (a filter that matches nothing silently skips):

```
✓ tests/unit/no-google-credential.test.ts > no Google credential in the source tree
    > no google credential is read anywhere in src
✓ tests/unit/no-google-credential.test.ts > no Google credential in the source tree
    > src/env.ts declares no Google variable
```

A third standing guard passes alongside them: `✓ tests/unit/server-actions-guard.test.ts > server actions > no server action reads a Google credential`. Full unit suite on this tree: **19 files, 76 tests, all passing.**

**What Phase 4 must do first, in order** (from [`docs/runbooks/google-quota.md`](../../../docs/runbooks/google-quota.md)):

1. Create the Google Cloud project.
2. Enable **Places API (New)**.
3. **Attach billing** — quota editing is unavailable without it.
4. Set the quota: Google Cloud console → **Google Maps Platform → Quotas** → API dropdown → **Places API (New)** → quota metric **"Requests per day"** → **⋮** → **Edit quota** → uncheck **Unlimited** → enter **`100`** → **Submit request**.
   Alternates for when the console moves things: **IAM & Admin → Quotas & System Limits** (filter by service `places.googleapis.com`), or **APIs & Services → [the API] → Quotas → Edit Quotas**.
5. Screenshot the quota page showing `100` and reference it from the Phase 4 plan's SUMMARY.

**The value and its derivation** (committed in the runbook, rendered on `/settings/budget` by plan 02-13): a $50.00 cap buys `50,000,000 / 35,000 = 1,428` paid Text Search **Enterprise** requests at $35.00/1,000, plus the 1,000 free = **2,428/month ≈ 80.9/day**, rounded up to **100/day** so a weekly partition can burst. Runaway bound: `100 × $0.035 = $3.50/day`, against $50 in an hour unbounded.

🔴 **The honesty line, unchanged:** 100/day × 30 = 3,000 requests = **$70/month, which EXCEEDS the $50 cap**. The quota bounds a runaway **day**; only the app meter bounds the **month**. And **a budget alert is not a cap** — Google states verbatim that setting a budget does not automatically cap usage or spending. Three clocks all called "monthly" do not coincide: `America/Chicago` (the app's budget period, D-11), **`US/Pacific`** (Google's daily quota reset) and Google's billing month.

**Phase 4 cannot make its first paid call without the project and key anyway**, so this is the natural place for it and not a slip.

### Vercel plan (A7) — RESOLVED

**danlo answered `vercel plan: pro`.** Corroborated read-only against the Vercel API for team `team_8zjV46sJxQDsVzikNQa1JaO2`: `"plan": "pro"`, `"planIteration": "plus"`, `"status": "active"`, role `OWNER`. No write, no token printed.

- **Research assumption A7 is resolved.** It was UNVERIFIED because `vercel teams ls` returned "The specified token is not valid".
- **Phase 9's scheduler is unblocked.** The Hobby cron's once-a-day, ±59-minute jitter is what would have blocked it; Pro's cron granularity does not.
- 🔴 **Pro's ~$20/mo is infrastructure and is NEVER merged into the $50 data cap.** The two numbers stay separate in every report — the standing STATE.md concern is unchanged, only its uncertainty is gone.

---

## Files Created/Modified

- `.planning/phases/02-budget-governor-search-presets/02-14-PREFLIGHT.md` — the read-only pre-flight, the side-by-side, the three STOP conditions and five findings
- `.planning/phases/02-budget-governor-search-presets/02-14-POSTFLIGHT.md` — danlo's approval, both migrate runs, both seed blocks, the full post-flight comparison and the grant negatives
- `docs/runbooks/google-quota.md` — BUDG-03's value, derivation, what it does not do, the console path with two alternates, Google's two caveats, the three-timezone table and when to revisit
- `docs/deploy.md` — the Phase 2 migration/seed recipe, the no-op-banner callout, the schema-scoped-count callout, and the `refresh-outlet-counts.ts` warning

## Decisions Made

1. **The 17 stand as measured.** danlo confirmed; Raymondville is not promoted. Phase 3 reads this.
2. **BUDG-03 is recorded as blocked with its console path, not marked done or quietly deferred.** The runbook was written *before* the checkpoint precisely so the answer `blocked` would still leave an artifact.
3. **`REQUIREMENTS.md` gets SRCH-02 only** — see the honest judgement below.
4. **The literal credential-scan criterion was replaced by 01-10's discriminating scan**, because the plan's regex contains `sk_` and therefore matches every document that writes it down (`02-14-PLAN.md` twice, `02-14-PREFLIGHT.md` once, and now this SUMMARY).
5. **A screenshot is not fabricated or described.** No quota was set, so none exists; the SUMMARY says so plainly.

## Requirements — honest judgement

| ID | Claim | Verdict |
| --- | --- | --- |
| **SRCH-02** | "The four industry clusters, the RGV city list, and the four RGV counties ship as seed data…" | ✅ **COMPLETE.** The rows are on production (254/17/4/33/20/3), idempotent on re-run, the FIPS bijection holds there, and danlo has explicitly confirmed the city list. This plan is what moved it from "committed in the repo" to "live and agreed". |
| **BUDG-03** | "A Google Cloud per-API daily quota is configured as an independent second wall" | ❌ **NOT COMPLETE — BLOCKED.** The requirement says *configured*. No GCP project exists, so no quota is configured. The documentation, the derivation and the on-screen card all exist, but documentation is not configuration. Carried forward to **Phase 4**. |
| **BUDG-01** | "Every outbound paid API call writes a cost-ledger row … instrumented before the first billable call" | ⏳ **Still Pending**, following 02-05's explicit decision. The ledger table, the price book and the field-mask tiering are now on production, but **there is no outbound paid API call yet** — that arrives in Phase 3/4. Marking it now would claim instrumentation that does not exist. |
| **BUDG-02** | "A monthly cap … enforced by an atomic reserve → spend → true-up … gating both enumeration and verification" | ⏳ **Still Pending**, same reasoning. `app.reserve_budget` / `app.settle_reservation` / `app.set_budget_cap` are live on production and proven under a 40-way burst locally, and the UI takes real holds — but nothing is *gating enumeration and verification* until enumeration and verification exist. |

`requirements-completed: [SRCH-02]`. SRCH-02 was already `Complete` in the traceability table from plan 02-11; `requirements mark-complete SRCH-02` was re-run and confirmed it, which is the correct idempotent outcome.

## Deviations from Plan

### Auto-fixed / adapted

**1. [Rule 3 - Blocking] `drizzle.__drizzle_migrations` has no `name` column**
- **Found during:** Task 1
- **Issue:** The plan's pre-flight query `select name from drizzle.__drizzle_migrations` cannot run; the real columns are `(id, hash, created_at)`.
- **Fix:** Applied migrations were identified by hashing each `drizzle/<tag>.sql` and matching; idempotency is decided by `created_at` versus the journal's `when`.
- **Committed in:** `831a21b`

**2. [Rule 1 - Correctness] The recorded hashes vary by line ending, and local `0016` was migrated from a pre-commit draft**
- **Found during:** Task 1
- **Issue:** Production's `0000`–`0006` were applied from CRLF text, `0007`–`0011` from LF; locally all hash as LF. Separately, local `0016_budget_meter_functions` matched no hashing variant of the committed file.
- **Fix:** Verified behaviourally instead of by hash — `pg_get_functiondef()` for all five functions in the live local database was compared against the bodies in the committed `0016`, normalised for whitespace and comments. **All five identical.** `git log` shows one commit for the file and a clean tree, so the committed text is final and it is the local journal row that is stale. What was tested locally is what was applied to production.
- **Committed in:** `831a21b`

**3. [Rule 1 - Plan text stale] Production carries six Phase 1 `app.*` functions, not five**
- **Found during:** Task 1
- **Issue:** The plan says "Phase 1's five"; the sixth is `emit_event`.
- **Fix:** Recorded; local carries the same six plus this phase's five, so the pair is consistent. Not a defect.
- **Committed in:** `831a21b`

**4. [Rule 3 - Unsatisfiable criterion] The literal credential grep matches itself**
- **Found during:** Tasks 1–3
- **Issue:** `git grep -nE 'sk_|eyJ|://[^ ]*:[^ ]*@'` contains `sk_`, so every document quoting it matches.
- **Fix:** Ran 01-10's discriminating scan instead (see Self-Check).
- **Committed in:** `831a21b`, `f226e18`

**5. [Rule 1 - Bug] The runbook's budget-alert quote was wrapped across two lines**
- **Found during:** Task 3
- **Issue:** The acceptance criterion greps for the sentence that a budget alert is not a cap; a hard-wrapped quote defeats a line-oriented grep.
- **Fix:** Kept the quote on one line.
- **Committed in:** `b08870f`

**6. [Rule 3 - Acceptance criterion as written is unmeetable] `grep -rn "GOOGLE\|X-Goog\|googleapis" src/ | wc -l` returns 1, not 0**
- **Found during:** Task 3
- **Issue:** One comment in `src/lib/budget/field-mask-tier.ts` names the `X-Goog-FieldMask` header, which is the whole subject of that module.
- **Fix:** Not "fixed" — the naive scan is the wrong scan. `tests/unit/field-mask-tier.test.ts` deliberately permits the name in exactly one module and refuses a second; the discriminating scan (anything that *reads* a credential) returns none, and both `no-google-credential` tests are green. Documented rather than silenced.
- **Verification:** `✓ X-Goog-FieldMask is named in at most one module under src`

---

**Total deviations:** 6 (2 blocking, 3 correctness/plan-text, 1 bug). **Impact:** none on scope. Four are the plan's own text or criteria being slightly wrong about the world; two were real fixes. No architectural change, no Rule 4 escalation.

## Issues Encountered

- **A `-t` filter silently skipped one of the two `no-google-credential` tests.** Running the whole file surfaced both. This is the recorded hard lesson about reading test **names**, not exit codes — it bit again here and was caught.
- **Nothing else.** No statement was refused by 17.6, no object count diverged, no grant was missing, no seeded count was off by a row.

## Known Stubs

None. This plan created no code — only documentation and production state.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change was introduced beyond what the plan's `<threat_model>` already covers; T-2-02, T-2-03, T-2-09, T-2-12 and T-2-15 were all verified rather than added to.

## User Setup Required

**One item, carried forward to Phase 4:** the Google Cloud project + Places API (New) key with billing, then the `Requests per day = 100` quota. Steps are in [`docs/runbooks/google-quota.md`](../../../docs/runbooks/google-quota.md) and repeated above.

Vercel needs nothing — the team is already on Pro.

## Next Phase Readiness

- **Phase 3 is unblocked on its shared contract.** The RGV geography/cluster seed is live on production and the 17-city list is explicitly agreed. `src/seed/data/clusters.json` (NAICS predicates) and `geo-presets.json` (geography) are the files to read.
- **Phase 4 is blocked on exactly one external item** — the GCP project, key and quota — which it needs for its first paid call regardless.
- **Phase 9's scheduler is unblocked** by the Pro confirmation.
- **Plan 02-15's phase gate** can now run against a production database that matches local object for object.
- **Standing concern, unchanged:** Vercel Pro's ~$20/mo is infrastructure and must never be merged into the $50 data cap in any report.

## Self-Check

Run on `main` at `b08870f`, before the metadata commits.

**Files exist:**

```
FOUND: .planning/phases/02-budget-governor-search-presets/02-14-PLAN.md
FOUND: .planning/phases/02-budget-governor-search-presets/02-14-PREFLIGHT.md
FOUND: .planning/phases/02-budget-governor-search-presets/02-14-POSTFLIGHT.md
FOUND: .planning/phases/02-budget-governor-search-presets/02-14-SUMMARY.md
FOUND: docs/runbooks/google-quota.md
FOUND: docs/deploy.md
```

**Commits exist:**

```
FOUND: 831a21b  docs(02-14): record the production pre-flight read before any write
FOUND: f226e18  docs(02-14): apply and verify the Phase 2 schema and seed on production
FOUND: 0027e1a  docs(02-14): add the Google Cloud daily-quota runbook (BUDG-03)
FOUND: b08870f  docs(02-14): keep the budget-alert quote on one line so a grep finds it
```

**Tests green (whole files, names read):**

```
✓ no google credential is read anywhere in src
✓ src/env.ts declares no Google variable
✓ no server action reads a Google credential
Test Files  19 passed (19)   Tests  76 passed (76)
```

**Credential scan — the discriminating form, not the self-matching literal:**

| Scan | Result |
| --- | --- |
| live-shaped keys `(sk_live_\|pk_live_\|(sk\|pk)_test_[A-Za-z0-9]{20,}\|eyJ[A-Za-z0-9_-]{20,})` | only `pk_test_cGxhY2Vob2xkZXIuY2xlcmsuYWNjb3VudHMuZGV2JA==` in `.github/workflows/ci.yml`, which base64-decodes to `placeholder.clerk.accounts.dev$`, plus the two planning docs that quote the regex itself |
| connection strings not pointing at `localhost` / `127.0.0.1` | one illustrative URL in `01-REVIEW.md` whose password is the literal `x` |
| Google credential read anywhere in `src/` | **none** — one comment naming `X-Goog-FieldMask`, permitted in exactly one module by its own test |

**No real credential is present in the repository.** No connection string, password or key was printed, pasted or committed by any task in this plan.

## Self-Check: PASSED

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*

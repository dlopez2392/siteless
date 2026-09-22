# Deferred items — phase 02

Out-of-scope discoveries logged rather than fixed, per the executor scope boundary.

## Status after the wave 5 merge (orchestrator, 2026-09-22)

The three 🔴 items below were each fixed by a sibling plan in the same wave before merge:

- `savePresetVersion` uuid[] binding — fixed by 02-11 (`sql.join`) in `src/server/actions/save-preset-version.ts`.
- `duplicatePreset` uuid[] binding — fixed by 02-12 (array literal) in `src/server/actions/duplicate-preset.ts`.
- `readSpendByRun` Date binding / timestamptz-as-string — fixed by 02-13 in `src/server/queries/budget.ts`.

Still open: the nine `e2e-*` presets left in the shared `siteless_test` database (no delete path in Phase 2), and the db-level test that calls the actions rather than re-writing their INSERT (owed alongside the 1 µUSD-hold test from 02-09).

---

# Logged by the code-review fix pass (WR-02, 2026-09-22)

## D-13 "one cap" as ONE ORG-WIDE CEILING — owner danlo, moment Phase 5

**What shipped and is now told truthfully:** `budget_periods` is keyed
`(org_id, provider, period_start)` and `app.reserve_budget`'s conditional UPDATE matches ONE
such row. That single statement is the whole concurrency control — proven under a 40-way
burst — and it is atomic *because* it touches one row. So the ceiling the database enforces
is **per provider**, and `BUDGET_CAP_HELP` claimed "Applies to Places, Firecrawl and
Anthropic together", which was never true of any version of this schema. The copy is fixed
and `tests/unit/ui-maps.test.ts` › `ui copy: the cap help claims only the scope the meter
enforces` now compares the sentence to the schema so the two cannot drift apart again.

**What is NOT fixed, deliberately.** D-13 says one cap. Honouring that as a single org-wide
ceiling means one of:

1. a `provider = 'all'` (or provider-less) meter row that every reserve, settle and read
   uses — which changes the burst proof, `readSpendByProvider`'s three-row `values` list,
   the banner, the gauge and the spend header together; or
2. aggregating three rows on every read — which is **not** the same product: an aggregate
   ceiling cannot be enforced by the one-row conditional UPDATE, so the atomic guarantee
   (ROADMAP success criterion 5) would be lost; or
3. per-provider caps made explicit in the UI (three inputs), which contradicts D-13.

None of those is a review fix, all three are architecture, and the number on screen is not
wrong today: Places is the only provider that reserves anything before Phase 5, so the
enforced ceiling on real spend is exactly the cap the admin set.

🔴 **The trap this leaves, named so Phase 5 cannot walk into it silently:** the first
Firecrawl reservation will be metered against a `budget_periods` row `ensure_budget_period`
lazily created at the $50 default — a row nobody set and no screen displays. Phase 5 must
pick one of the three options above BEFORE the first Firecrawl call, not after.

---

# Logged by plan 02-11

## 🔴 `readSpendByRun` binds a JS `Date` and will 500 the spend screen

- **Found by:** plan 02-11, while executing its own preset-list query against the real
  local database for the first time (2026-09-22).
- **File:** `src/server/queries/budget.ts`, line ~314 (plan 02-09).

```sql
where r.created_at >= ${from} and r.created_at < ${to}
```

`from` and `to` are JS `Date` objects from `periodWindow()`. drizzle's postgres-js driver
sends `tx.execute` parameters through postgres.js's `unsafe` path, which does **not**
type-infer a `Date` the way its tagged template does. At query time this throws, inside
drizzle's `Failed query:` wrapper:

```
TypeError: The "string" argument must be of type string or an instance of Buffer or
ArrayBuffer. Received an instance of Date
```

Plan 02-11 hit the identical defect in its own new query and fixed it there by binding
`from.toISOString()` with an explicit `::timestamptz` cast. **The occurrence in
`budget.ts` is untouched** — it is 02-09's file and 02-13's screen, and both are being
executed in sibling worktrees right now; editing it here would be a merge conflict for a
line neither of us owns.

**Why no gate caught it:** `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test:unit`
are all green against it. 02-09's SUMMARY says so itself — "No database was touched… every
statement in these modules is verified by `tsc` and by reading the migrations rather than
by execution." `readSpendByRun` has still never been executed.

**Owner:** plan 02-13 (`/spend` → By run) — it will 500 on first load otherwise.
**Fix:** `${from.toISOString()}::timestamptz` / `${to.toISOString()}::timestamptz`.
**Also worth checking:** any other `tx.execute` in `src/server/` binding a `Date`.
`grep -rn '\${[a-zA-Z]*}' src/server/queries/*.ts` and check each parameter's type.

---

## 🔴 `duplicatePreset` binds a uuid array the same way `savePresetVersion` did

- **Found by:** plan 02-11, by grepping for the defect it had just been blocked by.
- **File:** `src/server/actions/duplicate-preset.ts`, line ~91 (plan 02-09).

```sql
(app.current_org_id(), ${created.id}, 1, ${source.cluster_ids}::uuid[],
```

Plan 02-11 proved, by executing it, that interpolating a **JS array** into a drizzle `sql`
template expands it into a parenthesised list, so Postgres receives
`($3, $4)::uuid[]` — a ROW expression cast to an array, which it refuses. Every save of a
multi-cluster preset failed with `unexpected`. 02-11 fixed its own blocker in
`save-preset-version.ts` with `sql.join` (one bound placeholder per id) and **did not touch
`duplicate-preset.ts`** — that is 02-12's screen (the Duplicate dialog, D-17).

⚠️ **Verify before assuming it is broken.** `source.cluster_ids` there is READ BACK from
Postgres rather than built in TypeScript, and 02-11 separately measured that a `timestamptz`
comes out of `tx.execute` as a **string** — so `cluster_ids` may well arrive as the array
LITERAL `'{a,b}'`, bind as a single parameter, and work by accident. Run the duplicate path
once against the real database before changing the line; if it is broken, the fix is the
same `sql.join` form.

**Owner:** plan 02-12.

---

## Nine `e2e-*` presets remain in the shared `siteless_test` database

`tests/e2e/presets.spec.ts` creates real `searches` + `search_versions` rows named
`e2e-<epoch>-{cities,county,radius}`. Plan 02-11 ran the spec three times end to end while
debugging two blocking defects, so **nine** rows exist, across three run prefixes:
`1790096442647`, `1790096478427`, `1790097027886`. The list reads
`9 presets · none run this month`. **They were not deleted.** Phase 2 ships no archive
and no delete path by design (02-CONTEXT § Deferred Ideas), and `search_versions` is
append-only by GRANT — `revoke update, delete` in `drizzle/0013`, which is the mechanism
behind SRCH-03. So the product itself cannot remove them, and the only way to clean up is a
migration-privileged statement against a database two sibling plans are using concurrently.

They are harmless (the list is ordered by `updated_at desc` and nothing asserts a count) and
identifiable by the `e2e-` prefix. Whoever next has the local database to themselves can
delete them as the owner role.

---

# Logged by plan 02-12

## 🔴 `savePresetVersion` cannot insert a version: `cluster_ids` is bound as N placeholders, not one array

**Found during:** plan 02-12, Task 2, by the first e2e run that actually pressed "Create the copy".
**Owner:** whoever holds `src/server/actions/save-preset-version.ts` — it is plan 02-11's
critical path (the preset editor's save), and plan 02-09 wrote it.
**Not fixed in 02-12 because:** 02-11 is executing in a parallel worktree against that exact
file. Two worktrees editing one line is the conflict the file partitioning exists to prevent,
so this is reported for a single central fix rather than raced.

### The defect

`src/server/actions/save-preset-version.ts` line ~143:

```ts
${resolved.clusterIds}::uuid[]
```

A JS array inside a drizzle `sql` template is expanded into a comma-separated **placeholder
list** — that is drizzle's behaviour so `in (...)` works — so it is not one `uuid[]`
parameter. Postgres receives a ROW constructor cast to an array.

Measured directly against the local `siteless_test` database (`test-results/probe-array.mjs`
during 02-12), at every arity:

| clusters | emitted SQL | result |
|---|---|---|
| 2+ | `($1, $2)::uuid[]` | `42846 cannot cast type record to uuid[]` |
| 1 | `($1)::uuid[]` | `22P02 malformed array literal` |

There is no arity at which this succeeds, so **no version can be saved through
`savePresetVersion` at all**. The action's `catch` maps the SQLSTATE to `unexpected`, so the
screen shows "Something broke on our side" and nothing upstream ever names an array problem.
That is why it survived 02-09 green.

### The fix (already applied to the twin defect in `duplicate-preset.ts`, commit in 02-12)

Bind the Postgres array **literal** as a single parameter and cast it once:

```ts
const clusterIdsLiteral = `{${resolved.clusterIds.join(',')}}`;
// ...
${clusterIdsLiteral}::uuid[]
```

It is a bound parameter rather than interpolated SQL, and every element is a uuid that came
out of the database, so there is no quoting or injection surface. A native JS array passed as
a single param (`$1::uuid[]`) also works on postgres.js and is an equally valid fix — both
were verified green in the same probe.

### What would have caught it, and should

`tests/db/versioned-presets.test.ts` exercises the TABLE, not the ACTION, so it inserts
`cluster_ids` with its own correct SQL and cannot see this. A db-level test that calls
`savePresetVersion` / `duplicatePreset` — rather than re-writing their INSERT — is the test
that closes this class. Same for the `$0`-estimate 1 µUSD hold that 02-09 already owes a
db test for.

---

# Logged by plan 02-15

## ✅ RESOLVED 2026-09-22 — danlo chose option 3 — `preset-detail.spec.ts` self-skips unless the target is local

**Decision (danlo, verbatim):** `e2e fixture: 3: self-skip unless local`. Deviation Rule 4
closed by the owner, not by the executor. Applied in `tests/e2e/preset-detail.spec.ts`:
a file-level `test.skip(!TARGET_IS_LOCAL, …)` whose predicate parses `E2E_BASE_URL` and
fires unless the hostname is `localhost` / `127.0.0.1` / `::1` / `[::1]`.

- **No test was deleted and no assertion was weakened.** Against a local server all three
  tests run exactly as written (02-12 and the 02-15 orchestrator both ran them green there).
- **Direction checked**, because a guard that fires unconditionally is indistinguishable
  from a working one: `playwright test --list --reporter=json` reports all three as
  skip-annotated with the production `E2E_BASE_URL`, and all three as `WILL RUN` with
  `E2E_BASE_URL=http://localhost:3000`. The predicate flips.
- **`beforeAll` no longer executes** against a deployed target, which is what removes the
  `searches_org_id_orgs_id_fk` failure at its cause rather than catching it.
- **SRCH-03 is carried by a named test that CI actually runs:**
  `tests/db/versioned-presets.test.ts` → `run keeps its version after the preset moves on`,
  watched red under plan 02-06's M12 grant mutation and executed by CI's `db` job on every
  push. The skip reason names it in full, so a reader of the skip line is told where the
  requirement lives instead of being left to assume it was dropped.
- **This also closes the never-observed CI failure** described below: `TEST_DATABASE_URL`
  is undefined on a runner, so this file would have thrown on the first push of the branch.

**Result:** `pnpm test:e2e` against `https://siteless-iota.vercel.app` — **15 passed,
6 skipped, 0 failed**, 45 s wall clock (the failing run was 53 s).

---

## Deferred to Phase 4 (danlo, 2026-09-22) — the 80 %/100 % banner and refused-run captures

**Decision (danlo, verbatim):** `state shots: defer to Phase 4`.

The four state shots 02-15 Task 2 asks for on the **deployed** app — the 80 % banner, the
100 % banner, the refused run drawer, the assumptions drawer — are deferred. Driving them
requires lowering the production budget cap through `/settings/budget` and restoring it,
and committed spend in production is **$0** until Phase 4 calls Places, so the states are
synthetic there. The local hex-probed proofs from **02-10** (the banner at both thresholds,
computed-style probed) and **02-13** (the refusal copy) stand in for the phase gate, and
the behaviours themselves are pinned by named tests: `budget banner: renders on every route
at 80 percent` and `budget banner: is not dismissible`, which **self-skip on production
today for the same reason** — they assert against real committed spend that does not exist
yet. Phase 4 is where both the shots and those two skips stop being synthetic.

---

## Follow-up for Phase 3/4 planning — `presets.spec.ts` leaves three rows per run, forever

`tests/e2e/presets.spec.ts` creates three real `searches` + `search_versions` rows named
`e2e-<epoch>-{cities,county,radius}` and **deletes none of them**, because Phase 2 ships no
archive and no delete path by design (02-CONTEXT § Deferred Ideas) and `search_versions` is
append-only by GRANT — which is SRCH-03's own mechanism. Against the local database that was
already logged above (nine rows). It is now also true of **production**: plan 02-15's two
deployed runs left **six** `e2e-*` presets in production Supabase (prefixes
`1790100256747` and this run's), plus one lazily-created `budget_periods` row.

🔴 **The CI `e2e` job will add three more on every push**, against whatever `E2E_BASE_URL`
points at. Nobody has to act today — the rows are harmless, prefixed and identifiable, and
`/presets` is ordered by `updated_at desc` with nothing asserting a count — but this grows
without bound and should be closed when a plan owns it. Two ways, either acceptable:

1. Give `presets.spec.ts` an `afterAll` teardown, the way `preset-detail.spec.ts` already
   has one. Needs a delete path with enough privilege, which is the reason it has none.
2. Scope the names so they are trivially reclaimable, and add the archive/delete path the
   product owes anyway — then the teardown is a product call, not a SQL one.

**Owner:** Phase 3 or Phase 4 planning. Recorded here rather than fixed because a delete
path is a product feature, not a test fix (Rule 4 territory).

---

## 🔴 BLOCKER — RESOLVED ABOVE, kept for the record — `preset-detail.spec.ts` seeds a DIFFERENT DATABASE than the app it drives

**Found during:** plan 02-15, Task 1 — the first time this suite has ever been pointed at a
DEPLOYED url. Three tests fail; the phase's e2e gate cannot go green without a decision.

### What happens

```
✘ preset detail: a saved edit shows two versions and the run keeps the old one (0ms)
-  preset detail: duplicate creates a new preset at version 1          (did not run)
-  preset detail: run this preset queues a run                          (did not run)

error: insert or update on table "searches" violates foreign key constraint
       "searches_org_id_orgs_id_fk"
```

The failure is in `beforeAll`, so the two later tests never start. Deterministic: the same
test at the same line, `0ms`, on a solo re-run (10s wall) as in the full run (53s wall) — a
regression fails the same test every time, and contention moves between tests.

### Why

`tests/e2e/preset-detail.spec.ts` is the **only** spec in the suite that writes to a
database directly. Two lines decide which one:

```ts
async function withDb(...) { const url = process.env.TEST_DATABASE_URL; ... }   // LOCAL siteless_test
async function tenantId(page) { await page.goto('/settings/organization'); ... } // the DEPLOYED app's org
```

`tenantId()` reads danlo's real org id off **production**, and `withDb()` then inserts it
into **local** `siteless_test`, where no such `orgs` row exists. The FK refuses it.

These are the same database only when `E2E_BASE_URL` points at a local dev server — which is
how plan 02-12 ran it. Against a deployment they are two different databases, and the spec's
own header assumption ("`siteless_test` is one database for the whole repo") stops holding.

### 🔴 The same defect breaks CI, and has never been observed there

The `e2e` job in `.github/workflows/ci.yml` sets exactly four variables — `E2E_BASE_URL`,
`E2E_ADMIN_EMAIL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — and `.env.local`
is gitignored, so **`TEST_DATABASE_URL` is undefined on a CI runner**. `withDb` throws its
own named error, `preset-detail.spec: TEST_DATABASE_URL is not set`, in `beforeAll`. (Read
from the workflow and the gitignore, not executed — a local run cannot reproduce it, because
`playwright.config.ts` loads `.env.local` before the spec sees `process.env`.)

CI has been green on `7cec235`, a **Phase 1** commit predating every Phase 2 spec. No CI run
has ever executed this file. The first push of this branch would have gone red.

### The three ways out — none of them is the executor's to pick

1. **Point the fixture at the database behind `E2E_BASE_URL`.** Then the fixture seeds and
   tears down rows in **production Supabase**, and CI needs a production database credential
   added to GitHub Actions secrets. The only such URL on this machine is `SUPABASE_DB_URL`,
   the **owner** — which `docs/deploy.md` §3 forbids the runtime from ever holding, because an
   owner bypasses RLS. A security-posture change.
2. **Rebuild the fixture through the product's UI** — which is what the spec's own header says
   to do "when 02-11 lands", and 02-11 has landed. Partially blocked: the fixture needs a
   `complete` run costing $2.31 against version 1, and **nothing in Phase 2 can finish a run**
   (Phase 4 owns calling Places). Rebuilt through the UI the test would lose exactly the leg
   that proves SRCH-03 — that a finished run still points at the version that produced it —
   and that is ROADMAP success criterion 3.
3. **Self-skip the spec unless the target is backed by `TEST_DATABASE_URL`.** Cheap, honest,
   no security change; but it drops `preset detail: a saved edit shows two versions and the
   run keeps the old one` from the deployed run, and 02-15's acceptance criteria name that
   test explicitly among those that must be pasted as passing. Turning a required criterion
   into a permanent skip is a scope decision — and a permanently skipped test reads the same
   as a passing one in a summary line, which is the trap `budget-banner.spec.ts` already
   warns about in its own header.

**Owner:** danlo. Deviation Rule 4 (architectural / security). Not auto-fixed.

> **Answered 2026-09-22: option 3.** See "RESOLVED" at the top of this plan's section. The
> three ways out are kept as written because the reasoning for rejecting 1 and 2 is the
> justification for the skip, and a future reader re-opening this should have to argue with
> it rather than rediscover it.

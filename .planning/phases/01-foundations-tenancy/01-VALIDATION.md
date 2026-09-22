---
phase: 1
slug: foundations-tenancy
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-21
updated: 2026-09-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` § Validation Architecture. The per-task map below was filled
> by `/gsd-plan-phase` on 2026-09-21; the executor updates **Status** only.
>
> **Closed by `01-11` Task 3 on 2026-09-22.** Every Status below is recorded from a run that
> was read by test NAME, not by exit code, and each cites the SUMMARY that ran it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@5.0.1` (+ `vite@8.3.0`) for unit and DB-integration; `@playwright/test@1.63.0` for E2E |
| **Config file** | created by plan **01-03**: `vitest.config.ts` (TZ + locale pinned above the imports, `pool: 'forks'`), `vitest.db.config.ts` (`pool: 'forks'`, `singleFork`, `.env.local` loaded), `playwright.config.ts` |
| **Quick run command** | `pnpm test:unit` → `vitest run tests/unit` |
| **DB suite command** | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks --poolOptions.forks.singleFork` (serial: `withRollback` opens a real connection per test) |
| **Full suite command** | `pnpm verify` → `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db` |
| **E2E command** | `pnpm test:e2e` → `playwright test` against `E2E_BASE_URL` (the **deployed** URL, never localhost) |
| **Estimated runtime** | unit < 10 s · db ~30–60 s · verify ~2 min · e2e ~2 min against the deployed URL |
| **Final size at the gate** | unit **11** tests (4 files) · db **31** tests (9 files) · e2e **4** (3 specs + the auth setup) |

> 🔴 **`pnpm verify` is not runnable on this machine and never has been** (recorded first in
> `01-01-SUMMARY.md` deviation 1, again in 01-03, 01-05 and 01-09). The composite script
> shells out to a bare `pnpm`, which resolves to the global 11.9.0 with a broken 12.5.1
> self-switch shim and dies before reaching a single constituent. Every gate in this phase —
> including the final one — ran the **four constituents individually** through the pinned
> Node launcher. CI on Linux is unaffected, and the `verify` *job* in `ci.yml` runs
> `typecheck`, `lint` and `test:unit` as separate `- run:` lines precisely so one broken
> composite cannot hide three gates.

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit` plus the single `-t "<name>"` filter for the test that task made green — and **read the test name in the output**: a `-t` filter that matches nothing exits green.
- **After every plan wave:** Run `pnpm verify` (typecheck + lint + unit + db).
- **Before `/gsd-verify-work`:** `pnpm verify` green, `pnpm test:e2e` green against the deployed URL, and the recorded **mutation checks** below.
- **Max feedback latency:** 60 seconds (unit + one DB filter)

### The phase-gate mutation checks — **as run**, not as planned

Each mutation was applied, the suite run, the failing test **names** read, and the mutation
reverted with `git diff --stat` proven empty. Where the planned recipe and the executed
recipe differ, the executed one is authoritative and the correction is recorded.

| # | Plan / Task | Mutation, **as actually run** | The test(s) that went red | Suite | Recorded in |
|---|-------------|-------------------------------|---------------------------|-------|-------------|
| **M1** | **01-05 T3** | **CORRECTED.** `businesses_insert` recreated as `WITH CHECK (true)`. The planned recipe — *drop* the `WITH CHECK` clause — **does not discriminate**: on PostgreSQL 18.6 an INSERT policy with neither `WITH CHECK` nor `USING` fails **closed**, so the caller's own-org INSERT is refused too and the suite stayed **green for the wrong reason** (`11 passed`). Diagnosed by probing the positive path (own-org INSERT → `42501 new row violates row-level security policy`). A second correction was also needed: the `25P02` test was decoupled onto its own `orgs` INSERT refusal (commit `ad0bede`), because sharing one refusal made the mutation red two tests. | `org A cannot INSERT into org B, and the refusal is 42501` — **exactly one**, 1 failed / 10 passed | 11 | `01-05-SUMMARY.md` § Mutation check |
| **M2** | **01-07 T3** | `alter table source_records drop constraint sr_google_is_ephemeral` — as written | `google content cannot be durable` — **exactly one**, 1 failed / 18 passed. Direction check: `positive control: a durable field citing a durable source is accepted` stayed **green**, so the guard is not "working" by refusing everything | 19 | `01-07-SUMMARY.md` § Mutation check |
| **M2b** | **01-07 T3** | Companion FK mutation: `alter table businesses drop constraint businesses_phone_src_fk` | `durable cites durable: a durable field citing an ephemeral source is refused` — **exactly one**, 1 failed / 18 passed. The positive control cannot detect this mutation (without the FK the citing insert simply succeeds), which is why the refusal test must | 19 | `01-07-SUMMARY.md` § Mutation check |
| **M3** | **01-09 T3** | `drop trigger businesses_event on businesses` — as written | **TWO**, not the one the map predicted: `a direct write still produces an event` **and** `every state-bearing table has an app.log_event after-row trigger`. These are independent properties that happen to share one database object, and independence was **proven** rather than argued: `alter table businesses disable trigger businesses_event` reds only the behaviour test (coverage stays green), and collapsing `app.log_event()`'s actor chain to the literal `'system'` also reds only the behaviour test, with the trigger present and enabled | 25 | `01-09-SUMMARY.md` § Mutation checks 1, 4, 5 |
| **M4** | **01-08 T1** | In `src/db/with-org.ts`, the third argument of `set_config('request.jwt.claims', $1, true)` changed `true` → `false` — as written. The mutation was applied to the **committed** file so `git diff -U0` showed the `-`/`+` pair | `withOrg binds the tenant claims and they die with the transaction` — **exactly one**, 1 failed / 13 passed at the time | 14 | `01-08-SUMMARY.md` § Gate Mutation M4 |
| **M5** | **01-12 T3** | `grant truncate on public.events to authenticated` | **TWO**, as that plan predicted: `a TRUNCATE of events as authenticated is refused with 42501` **and** `authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table` — 2 failed / 29 passed. `a cascading TRUNCATE of every tenant table as authenticated is refused with 42501` correctly stayed **green** (that statement names `orgs` first, where the grant was not made) — so the two TRUNCATE tests are not redundant | 31 | `01-12-SUMMARY.md` § Mutation checks |
| **M6** | **01-12 T3** | `grant select on public.orgs to anon` | `anon holds no privilege on any tenant table` — **exactly one**, 1 failed / 30 passed | 31 | `01-12-SUMMARY.md` § Mutation checks |

Supporting mutations also recorded and reverted:

- **01-06 T1** — a leaky payload builder added to `PAYLOAD_BUILDERS` → `no registered payload builder emits an internal annotation`, one red. Seven further mutations over `src/lib/time.ts` and `src/lib/auth/sole-organization.ts` each killed exactly one named test (`01-06-SUMMARY.md` § Sanity mutations), plus two survivors recorded because they contradicted the prediction.
- **01-09 T3** — `grant update, delete on events to authenticated` → `events are append-only: UPDATE as authenticated is refused` **and** `… DELETE …`; split into two narrower grants, each reding exactly one.
- **01-05 T3** — `orgs_insert_MUTATION … with check (true)` → `a second statement in the same aborted transaction reports 25P02`, one red, proving the rewritten test is not vacuous.
- **01-04 T3** — `alter role app_user with inherit` → `pnpm db:check --bootstrap` exit 1, `app_user must be login + NOINHERIT`.
- **01-03 T1** — the `TZ` pin removed from `vitest.config.ts` → `AssertionError: expected 'America/Chicago' to be 'UTC'`.
- **01-07 T2** — `displayName` → `displayNameRENAMED` in `src/db/schema/businesses.ts` → `TS2344` at `src/lib/export/public-business.ts`, proving the compile-time bridge is not decorative.

**The standing lesson, for every future phase gate:** a mutation must be checked for
*direction*. A guard that fails **closed** under the mutation is indistinguishable from a
working guard by exit code alone — probe the positive path to tell them apart. And a
mutation that reds **two** tests is only acceptable when the two properties are proven
independent (M3, M5); otherwise the tests are coupled and must be decoupled (M1).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-03-T1 | 01-03 | 1 | FOUND-06 | — | zone + locale pinned in the main process; suite runs in a discriminating zone (UTC) | unit | `pnpm test:unit -t "suite runs in a zone that can discriminate"` | 01-03 T1 | ✅ green (01-03; mutation-checked — TZ pin removed → red) |
| 01-04-T3 | 01-04 | 1 | FOUND-01 | T-1-03 | bootstrap roles exist; `app_user` is login + NOINHERIT; `app.jwt()` reads the v2 claim | script | `pnpm db:check --bootstrap` | 01-04 T1/T3 | ✅ green (01-04; eight `ok` lines incl. `app.jwt() v2 claim path returns org_X`) |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-01 | T-1-02 | org A sees only org A rows (v1 flat claim) | DB-integration | `pnpm test:db -t "sees only its own org"` | 01-05 T2 | ✅ green (01-05; watched failing first) |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-13 | token v2 `{o:{id}}` resolves the same org as v1 | DB-integration | `pnpm test:db -t "token v2"` | 01-05 T2 | ✅ green (01-05; closes the NULL-claim silent failure) |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-02 | foreign-org INSERT → `42501` + "row-level security" | DB-integration | `pnpm test:db -t "42501"` | 01-05 T2 | ✅ green (01-05; **M1** reds exactly this) |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-02 | second statement in an aborted tx → `25P02` | DB-integration | `pnpm test:db -t "25P02"` | 01-05 T2 | ✅ green (01-05; decoupled onto an `orgs` INSERT in `ad0bede`) |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-02 | T-1-02 | cross-org UPDATE/DELETE affect 0 rows (filtered, not refused) | DB-integration | `pnpm test:db -t "filtered, not refused"` | 01-05 T2 | ✅ green (01-05; D-11a — the other half of criterion 2) |
| 01-05-T2 | 01-05 | 2 | FOUND-01 | T-1-03 | a connection without `set local role` is refused `42501` | DB-integration | `pnpm test:db -t "without set local role"` | 01-05 T2 | ✅ green (01-05) |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-01 | T-1-01 | `app.ensure_org` idempotent; refuses another org with `42501` | DB-integration | `pnpm test:db -t "ensure_org"` | 01-05 T2 | ✅ green (01-05; 2 tests. Idempotency re-proven in production — see Manual-Only, D-03) |
| 01-05-T2→T3 | 01-05 | 2 | FOUND-01 | T-1-02 | every public table has `org_id` + RLS + ≥1 policy (Set allow-list) | DB-integration | `pnpm test:db -t "every public table is org-scoped"` | 01-05 T2 | ✅ green (01-05; enumeration now covers 4 tables / 12 policies) |
| 01-05-T2 | 01-05 | 2 | FOUND-06 | — | every `timestamp` column in `public` is `timestamptz` | DB-integration | `pnpm test:db -t "timestamptz"` | 01-05 T2 | ✅ green (01-05) |
| 01-05-T2 | 01-05 | 2 | FOUND-04 | T-1-09 | `legal_name`, `display_name`, `internal_notes` are three distinct columns | DB-integration | `pnpm test:db -t "three distinct name fields"` | 01-05 T2 | ✅ green (01-05; criterion 5, schema half) |
| 01-06-T1 | 01-06 | 2 | FOUND-04 | T-1-09 | no registered payload builder emits the internal-notes canary | unit | `pnpm test:unit -t "internal annotation"` | 01-06 T1 | ✅ green (01-06; mutation 1 — a leaky builder reds exactly this. Criterion 5, export half) |
| 01-06-T1 | 01-06 | 2 | FOUND-04 | T-1-09 | every module under `src/lib/export/` is in `PAYLOAD_BUILDERS` | unit | `pnpm test:unit -t "represented in the registry"` | 01-06 T1 | ✅ green (01-06; `readdirSync`, so a new module cannot dodge the sentinel) |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | T-1-25 | `Intl.DateTimeFormat` called with `timeZone: 'America/Chicago'` + explicit locale, on every call | unit (spy) | `pnpm test:unit -t "pins the zone and the locale"` | 01-06 T2 | ✅ green (01-06; mutation 3 reds exactly this) |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | T-1-25 | one instant renders `2026-09-21` UTC / `2026-09-20` Chicago (TypeScript) | unit | `pnpm test:unit -t "opposite days"` | 01-06 T2 | ✅ green (01-06; mutation 2 reds exactly this) |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | T-1-25 | `formatLocal` ignores a caller-supplied `timeZone` (spread order is load-bearing) | unit (spy) | `pnpm test:unit -t "caller-supplied timeZone"` | 01-06 T2 | ✅ green (01-06; mutation 4 reds exactly this) |
| 01-06-T2 | 01-06 | 2 | FOUND-06 | — | `2026-09-21T01:00Z` → `2026-09-21` UTC / `2026-09-20` Chicago (SQL) | DB-integration | `pnpm test:db -t "two zones, opposite verdicts"` | 01-06 T2 | ✅ green (01-06; plus the DST companion test) |
| 01-06-T3 | 01-06 | 2 | FOUND-01 | T-1-26 | `soleOrganizationToActivate` activates on exactly one membership; null on 0, >1, already-active, signed-out | unit | `pnpm test:unit -t "sole organization"` | 01-06 T3 | ✅ green (01-06; 5 tests, mutations 5–8 each red exactly one). ⚠️ The **caller** was wrong until 01-11 T2 — see Deviations in `01-11-SUMMARY.md` |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-08 | `google_places` + `durable` → `23514` / `sr_google_is_ephemeral` | DB-integration | `pnpm test:db -t "google content cannot be durable"` | 01-07 T2 | ✅ green (01-07; **M2** reds exactly this. Criterion 3) |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-08 | ephemeral without `expires_at`, and durable with one → `23514` / `sr_ephemeral_has_expiry` | DB-integration | `pnpm test:db -t "ephemeral"` | 01-07 T2 | ✅ green (01-07; 2 tests) |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-27 | durable field citing an ephemeral source → `23503`; citing a durable source succeeds | DB-integration | `pnpm test:db -t "durable cites durable"` | 01-07 T2 | ✅ green (01-07; **M2b** reds exactly this; the positive control cannot) |
| 01-07-T2→T3 | 01-07 | 3 | FOUND-05 | T-1-29 | `sr_expiry` partial index exists for Phase 4's TTL purge | DB-integration | `pnpm test:db -t "partial index on expires_at"` | 01-07 T2 | ✅ green (01-07) |
| 01-08-T1 | 01-08 | 3 | FOUND-01 | T-1-11 | `proxy.ts` is at `src/`, contains no authorization; build is green | build | `pnpm build` | 01-08 T1 | ✅ green (01-08, re-run at the 01-11 gate; `ƒ Proxy (Middleware)` in the route listing, `src/app/proxy.ts` absent) |
| 01-08-T1 | 01-08 | 3 | FOUND-01 | T-1-05 | `withOrg` issues `set_config('request.jwt.claims', $1, true)` with the claims as a BOUND parameter — text and params asserted separately through `PgDialect.sqlToQuery()` — and refuses a role outside the `Set` allow-list before any SQL is issued | DB-integration | `pnpm test:db -t "die with the transaction"` | 01-08 T1 | ✅ green (01-08; **M4** reds exactly this) |
| 01-08-T1 | 01-08 | 3 | FOUND-01 | T-1-04 | the claims do not survive COMMIT onto the pooled connection: between two `withOrg` calls on the same `max:1` client the GUC is empty, and the second transaction sees `org_B` and never `org_A` | DB-integration | `pnpm test:db -t "die with the transaction"` | 01-08 T1 | ✅ green (01-08; same test, second assertion block) |
| 01-08-T3 | 01-08 | 3 | Criterion 1 | T-1-12 | local production server answers `/api/health` 200 `{ok,db:up,proxy:up}` and leaks nothing | smoke | `curl -fsS http://localhost:3000/api/health` | 01-08 T3 | ✅ green (01-08; `{"ok":true,"db":"up","proxy":"up","commit":"local"}`, leak scan clean, single PID killed by id) |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | T-1-30 | a raw SQL write still produces an `events` row with actor + `occurred_at` | DB-integration | `pnpm test:db -t "direct write still produces an event"` | 01-09 T1 | ✅ green (01-09; **M3** + the actor-chain collapse each red this. Criterion 4) |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | T-1-06 | `update`/`delete` on `events` as authenticated → `42501` "permission denied for table events" | DB-integration | `pnpm test:db -t "append-only"` | 01-09 T1 | ✅ green (01-09; 2 tests, each red under its own narrow grant. D-06) |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | — | domain-column UPDATE moves `updated_at`, stamps `updated_by` | DB-integration | `pnpm test:db -t "updated_at"` | 01-09 T1 | ✅ green (01-09; `drop trigger businesses_touch` reds exactly this) |
| 01-09-T1→T2 | 01-09 | 4 | FOUND-03 | T-1-30 | exactly `orgs` + `businesses` carry an `app.log_event` after-row trigger | DB-integration | `pnpm test:db -t "after-row trigger"` | 01-09 T1 | ✅ green (01-09; asserts `tgenabled` in `('O','A')`, not mere existence — a disabled trigger leaves the `pg_trigger` row behind) |
| 01-10-T2 | 01-10 | 5 | FOUND-01/03/05 | T-1-21 | production schema matches local, count for count, applied only by drizzle-kit | script | `pnpm db:migrate:prod` (idempotent on the second run) | 01-10 T2 | ✅ green (01-10; 8 migration rows both databases, second run applied nothing, 4 tables / 12 policies / 6 constraints / 5 public triggers / 5 `app.*` functions side by side). ⚠️ The side-by-side also **found the 01-12 gap** — see below |
| 01-12-T1→T2 | 01-12 | 6 | FOUND-01 | T-1-30 | `truncate public.events` as `authenticated` → `42501`, and the four-table cascade likewise | DB-integration | `pnpm test:db -t "TRUNCATE"` | 01-12 T1 | ✅ green (01-12; 2 tests, watched failing under the platform condition **reproduced locally**. **M5** reds the single-table one) |
| 01-12-T1→T2 | 01-12 | 6 | FOUND-01 | T-1-03 | `anon` holds no privilege on any tenant table; `authenticated` holds no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN | DB-integration | `pnpm test:db -t "holds no"` | 01-12 T1 | ✅ green (01-12; 2 tests. **M6** reds the `anon` one, **M5** the `authenticated` one) |
| 01-12-T1→T2 | 01-12 | 6 | FOUND-01 | T-1-31 | the `public` default ACL grants nothing to `anon`/`authenticated` on tables, so no future table inherits | DB-integration | `pnpm test:db -t "default ACL"` | 01-12 T1 | ✅ green (01-12; scoped to default ACLs owned by roles that own tables in `public` — the unscoped form is unsatisfiable on Supabase forever, proven by attempting the DDL) |
| 01-12-T1→T2 | 01-12 | 6 | FOUND-03 | T-1-30 | positive control: `authenticated` keeps the DML the RLS policies rely on | DB-integration | `pnpm test:db -t "keeps the DML"` | 01-12 T1 | ✅ green (01-12; the direction check — 0008 revokes without breaking the product) |
| 01-11-T1 | 01-11 | 6 | Criterion 1 | T-1-12 | `/api/health` on the DEPLOYED URL → 200 `{ok:true,db:'up',proxy:'up'}` with the expected commit | smoke | `curl -fsS "$DEPLOY_URL/api/health"` | 01-08 T2 | ✅ green (01-11 T1; `{"ok":true,"db":"up","proxy":"up","commit":"311e6b4574cc1973c6307b6d2b1dcb1f24dea876"}` — the sha recorded **before** the deploy. Leak scan clean) |
| 01-11-T2 | 01-11 | 6 | Criterion 1 | T-1-11 | danlo signs in on the deployed URL and the page is org-scoped | E2E | `pnpm test:e2e -g "signs in and is org-scoped"` | 01-08 T3 | ✅ green (01-11 T2, **after a real product fix** — run 1 failed on a PENDING Clerk session; two post-fix runs against `https://siteless-iota.vercel.app`, 16 s and 9 s. Also closed by hand — see Manual-Only) |
| 01-11-T2 | 01-11 | 6 | FOUND-01 | T-1-11 | a signed-out visitor never reaches the shell; `/no-access` renders | E2E | `pnpm test:e2e -g "no access"` | 01-08 T3 | ✅ green (01-11 T2; 2 tests, both runs. Corroborated signed-out by `curl`: `307 → /sign-in`, `data-testid="org-id"` 0 occurrences) |
| 01-11-T3 | 01-11 | 6 | Criterion 1 | T-1-35 | the final gate is green on a **printed** branch and sha, read AFTER the run | gate | `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db` + `git rev-parse` | 01-11 T3 | ✅ green (01-11 T3; see `01-11-SUMMARY.md` § Final gate for the constituent results and the post-run branch + sha) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*`A→B` in Task ID means the test is written RED in task A and turned green in task B.*

**No row is ❌ or ⚠️.** Two rows carry a ⚠️ annotation on an adjacent fact (the
`soleOrganizationToActivate` caller, and the 01-10 side-by-side that found the 01-12 gap);
in both cases the test itself was and is green, and the adjacent problem was fixed and is
recorded in the SUMMARY named on the row.

---

## Wave 0 Requirements

Wave numbering below matches the plan frontmatter. "Wave 0" in `01-RESEARCH.md` is realised as plans **01-01** and **01-02** (wave 0) plus **01-03** and **01-04** (wave 1), because the test harness and the bootstrap migration both depend on `package.json` existing.

- [x] `package.json` + `pnpm-lock.yaml` + `"packageManager": "pnpm@12.5.1"` — **01-01 T1** (installed pnpm is 11.9.0; the field makes it self-switch — **it does not, on this machine**; see the launcher note above)
- [x] `tsconfig.json` / `next.config.ts` / `eslint.config.mjs` / placeholder shell — **01-01 T2**
- [x] `src/env.ts` fail-loudly server env guard — **01-01 T3**
- [x] A local PostgreSQL 18 for `TEST_DATABASE_URL` (D-05a; never a Supabase URL) — **01-02 T2** (danlo, checkpoint) — PostgreSQL **18.6**, service RUNNING, `siteless_test` reached through the configured URL
- [x] `SUPABASE_DB_URL` / `SUPABASE_DB_POOL_URL` in `.env.local`; Clerk + Supabase dashboard settings confirmed — **01-02 T3** (danlo, checkpoint)
- [x] `vitest.config.ts` (TZ + locale pinned above the imports) — **01-03 T1** — covers FOUND-06
- [x] `vitest.db.config.ts` (`pool: 'forks'`, `singleFork`, `.env.local`) — **01-03 T1** — covers FOUND-01/02/03/05
- [x] `tests/db/_fixtures.ts` (`withRollback`, `actAs`, `actAsRole`, `actAsOwner`, `seedTwoOrgs`) — **01-03 T2** — shared by every DB test; `actAsRole` gained `authenticated` in **01-12 T1**
- [x] `playwright.config.ts` + `tests/e2e/_required-env.ts` + `tests/e2e/auth.setup.ts` — **01-03 T3** — covers criterion 1
- [x] `.github/workflows/ci.yml` with the `postgres:18` service container and `pnpm install --frozen-lockfile` — **01-03 T3**
- [x] `drizzle.config.ts` + `scripts/db.ts` + `scripts/check-test-db.ts` — **01-04 T1**
- [x] `drizzle/0000_bootstrap.sql` (roles `anon`/`authenticated`/`service_role`/`app_user`, `app` schema, `app.jwt()`) — **01-04 T2**, applied in **01-04 T3**
- [x] `src/lib/export/registry.ts` — **01-06 T1** — the empty `PAYLOAD_BUILDERS` must exist so the leak sentinel is real from day one

> CI's `db` job is **expected red** between plan 01-03 and plan 01-05, because `pnpm db:migrate` has no application migrations to apply yet. Do not disable the job to make it green.
>
> **Closed.** Migrations `0001`–`0008` exist and the db suite holds 31 tests, so the
> condition that made the job red no longer applies. The job was never disabled.

---

## Manual-Only Verifications

| Behavior | Requirement | Plan / Task | Why Manual | Test Instructions | Result and provenance |
|----------|-------------|-------------|------------|-------------------|------------------------|
| PostgreSQL 18 installed; `siteless_test` created; `TEST_DATABASE_URL` set | FOUND-02 | **01-02 T2** | Docker and WSL are both absent; the GUI installer has no scriptable path | `psql --version` reports 18.x; `psql -U postgres -l` lists `siteless_test` | ✅ **`psql (PostgreSQL) 18.6`**; service `postgresql-x64-18` RUNNING, 5432 LISTENING; a read-only query *through `TEST_DATABASE_URL`* returned `siteless_test` — stronger than the stated criterion. **Orchestrator, on this machine, 2026-09-22** (`01-02-SUMMARY.md`) |
| Clerk: "users can create organizations" OFF, "Membership required" ON (D-02) | FOUND-01 | **01-02 T3** | Dashboard setting, no API in scope | Clerk → Configure → Organizations; record the two values in the SUMMARY | ✅ `org creation: off` / `membership required: on`. **Orchestrator dashboard read in Chrome, 2026-09-22**, at danlo's request: `name=create_organization` read `checked=false`; the "Membership required" radio was SELECTED. **Re-read 2026-09-22 after the e2e runs — both unchanged.** Closes `01-RESEARCH.md` assumption A5 |
| Clerk: exactly one organization, danlo a member of exactly one | FOUND-01 | **01-02 T3** | Dashboard state | Clerk → Organizations; this is what lets `ActivateSoleOrganization` activate | ✅ `orgs: 1, danlo is a member of 1`. **danlo's own answer, 2026-09-22** (`01-02-SUMMARY.md`). Corroborated by the e2e failure trace, which showed Clerk's choose-organization task offering exactly one org button |
| Supabase: Clerk third-party auth ENABLED for `equipped-newt-5148.clerk.accounts.dev` | FOUND-01 | **01-02 T3** | Dashboard setting | Supabase → Authentication → Sign In / Providers → Third-Party Auth | ✅ `third-party auth: enabled`. **Orchestrator dashboard read in Chrome, 2026-09-22**: Clerk listed ENABLED with domain `https://equipped-newt-5148.clerk.accounts.dev` |
| `SUPABASE_DB_URL` is the session pooler on 5432, not the IPv6-only direct address | FOUND-01 | **01-02 T3** | Value lives only in the gitignored `.env.local` | grep for `:5432` and for the direct host; never print the value | ✅ `SUPABASE_DB_URL: set (session pooler, 5432)` — exactly one line, contains `:5432`, contains **0** occurrences of `db.jahgeqshuesndyscnmjo.supabase.co`. **Orchestrator grep, 2026-09-22** |
| Production `app_user` password set | FOUND-01 | **01-10 T3** | Credential operation; the role has no password until one is set | Supabase SQL Editor: `alter role app_user with login password '...'` | ✅ Set. Proven downstream rather than asserted: `/api/health` on the deployed URL reports `"db":"up"`, which is only possible if `app_user` authenticates through the transaction pooler. **Orchestrator with danlo's per-item approval, 2026-09-22; value piped over stdin, never printed** |
| Vercel env vars present for Production + Preview | Criterion 1 | **01-10 T3** | Secrets never in repo | `vercel env ls` shows all six names; no value printed | ✅ All six names present for Production and Preview (`01-10-SUMMARY.md` § Manual verifications). Corroborated by the running app: `db:"up"` + `proxy:"up"` + a working sign-in require five of the six |
| GitHub Actions secrets + `E2E_BASE_URL` variable | Criterion 1 | **01-10 T3**, **01-11 T3** | Repo settings | Repo → Settings → Secrets and variables → Actions | ✅ Secrets set in 01-10 T3. `E2E_BASE_URL` **set by automation in 01-11 T1**, not by hand: `gh variable set E2E_BASE_URL --repo dlopez2392/siteless --body https://siteless-iota.vercel.app`, confirmed by `gh variable list` (2026-09-22T04:27:31Z). The plan's Task 3 step 8 was therefore already done when the checkpoint was presented |
| danlo signs in on the deployed URL and sees his org; tenant uuid stable on reload | Criterion 1 | **01-11 T3** | Human sign-in with an email code | See `01-11-PLAN.md` Task 3 `how-to-verify`, steps 1-7 | ✅ **Closed 2026-09-22.** danlo signed in at `https://siteless-iota.vercel.app` in a private window and landed on `/` — not on the choose-organization screen, not on `/no-access`. The six-line block and its per-line provenance are below |

### The 01-11 T3 six-line block, with provenance per line

| Line | Provenance |
|------|------------|
| `sign-in: ok` | **danlo, verbatim, 2026-09-22** — pasted `Signed in as user_3Jf37HgqXFh3Xr7scbCWSLTQ5F5` |
| `org shown: org_3Jf2trxDQzIC3yX4sgZki3kE3ky` | **danlo, verbatim, 2026-09-22** — pasted `Org org_3Jf2trxDQzIC3yX4sgZki3kE3ky`. Not blank, not "no access" |
| `tenant uuid stable on reload: yes (proven by a single orgs row across three sign-ins)` | **Database evidence, orchestrator, 2026-09-22.** danlo pasted `Tenant 26491ff8-9755-4a98-b576-7dab6b00e314` but did not answer the reload item; it was closed objectively instead. A read-only query on the **production** database (session pooler, as `postgres`) returned `orgs_rows: 1` — id `26491ff8-9755-4a98-b576-7dab6b00e314`, `clerk_org_id = org_3Jf2trxDQzIC3yX4sgZki3kE3ky`, `created 2026-09-22T04:35:20Z`, i.e. the row provisioned during the **e2e** runs. After two automated sign-ins **plus** danlo's manual sign-in and page loads there is still **exactly one row**. That is a stronger idempotency proof than one reload (D-03). Also read: `events_rows: 9`, `businesses_rows: 0` |
| `no-access: ok` | **Orchestrator `curl`, 2026-09-22** — signed-out `GET /no-access` → HTTP 200, body contains "No access" (1) and "Sign out" (1), `data-testid="org-id"` **0**. The signed-in rendering is asserted by the passing e2e test `no access: /no-access renders the invite-only message`, whose storageState is a signed-in session |
| `health: ok` | **Orchestrator `curl`, 2026-09-22** — `{"ok":true,"db":"up","proxy":"up","commit":"311e6b4574cc1973c6307b6d2b1dcb1f24dea876"}` |
| `E2E_BASE_URL: set` | **Automation, 01-11 T1** — `gh variable set` + `gh variable list` confirmation at 2026-09-22T04:27:31Z |

> **Observation recorded, not acted on.** Clerk's task screen during the failing e2e run
> offered a "Create new organization" button. The orchestrator re-read the Clerk dashboard
> on 2026-09-22 afterwards: `create_organization` is still `false` and "Membership required"
> is still selected. The button is Clerk's task UI rendering regardless of the instance
> setting. **D-02 holds at the setting level**; a future phase may verify that *clicking* it
> is refused server-side.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] The phase-gate mutation checks (**M1, M2, M2b, M3, M4, M5, M6**) are recorded **as run**, each reverted and diffed back — M1 corrected because the planned recipe did not discriminate, M3 and M5 recorded as reding two tests each with independence proven by narrower mutations
- [x] `nyquist_compliant: true` set in frontmatter
- [x] `wave_0_complete: true` set in frontmatter

**Approval:** 2026-09-22 — closed by **01-11 T3**, on danlo's sign-in confirmation at
`https://siteless-iota.vercel.app` plus the deployed-URL e2e runs, the production database
read, and a final gate green on a printed branch and sha.

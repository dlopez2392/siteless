---
phase: 3
slug: free-data-spine-entity-resolution
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived verbatim from `03-RESEARCH.md` § Validation Architecture — the requirement → test
> map, the sampling rate, the gate mutations M13–M25 and the Wave 0 gaps are copied from there,
> which is where their evidence lives. `02-VALIDATION.md` is the format precedent, including
> how it was closed.
>
> **Closed by plan 03-22 on 2026-09-23: `status: approved`, `nyquist_compliant: true`.** The
> Per-Task Verification Map below is filled from the 59 task IDs of the 22 PLAN.md files. Every
> `-t` filter in it was checked against the real test names of the suite at `337a35a` (298 unit,
> 194 DB), and each matches at least one test. The gate mutations are logged, as run, in
> `docs/measurements/03-gate-mutations.md`. Every number in the research behind this file was
> measured live on 2026-09-22 against the real datasets and the real local PostgreSQL 18.6.
>
> 🔴 **`$PNPM test:unit -t "x"` filters; `$PNPM test:unit -- -t "x"` does NOT** (pnpm 12 passes the
> `--` through literally and vitest then runs everything). Every PLAN.md verify line in this phase
> used the `-- -t` form. The commands below use the form that filters, verified at 03-22:
> `-t "phoneE164"` ran 1 of 42 files, 5 of 298 tests.

---

## Test Framework

| Property | Value |
|---|---|
| Framework | `vitest@5.0.1` (+ `vite@8.3.0`) unit & DB-integration; `@playwright/test@1.63.0` E2E |
| Config files | `vitest.config.ts` (TZ + locale pinned line 1, `pool:'forks'`, jsdom lane for `*.test.tsx`) · `vitest.db.config.ts` (`pool:'forks'`, `fileParallelism:false`, `isolate:false`, `.env.local`) · `playwright.config.ts` (deployed URL only) |
| Quick run command | `pnpm test:unit` → `vitest run tests/unit` |
| DB suite command | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks` |
| Full suite command | `pnpm verify` — 🔴 **not runnable on this machine**; run the five constituents individually through the pinned store launcher |
| E2E command | `pnpm test:e2e` against `E2E_BASE_URL` (deployed) |
| Baseline at the Phase 2 gate | unit ~90 · db ~90 · e2e ~12 (see `02-VALIDATION.md`) |

🔴 **Two harness facts this phase depends on:**

1. **`withRollback` is one transaction, and every DB test here must stay inside it.** The scale measurements in this document ran against a throwaway database (`prospector_probe`, created and dropped; `siteless_test` verified afterwards as `plpgsql`-only with 16 public tables). Tests use fixtures of **tens** of rows — the scale evidence lives here, not in the suite.
2. **`pg_trgm.similarity_threshold` is a GUC.** Any DB test relying on `%` must `set local pg_trgm.similarity_threshold = …` inside its transaction, or it inherits whatever the previous file left. `fileParallelism:false` makes that leak *deterministic* and therefore invisible — set it explicitly every time.

## Phase Requirements → Test Map

| Req | Behavior | Type | Automated command | File exists? |
|---|---|---|---|---|
| **DATA-01** | `jrea-zgmq` row → source record: `outlet_naics_code` arrives as a *string* although typed `number`; `outlet_county_code` is zero-padded | unit (msw) | `$PNPM test:unit -t "comptroller row"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-01 | The SoQL string-prefix function appears nowhere in `src/lib/socrata/**` (the lifted grep gate) | unit (grep) | `$PNPM test:unit -t "naics prefix"` | ✅ extended |
| **DATA-01 / D-03** | 🔴 `3kx8-uryv` is queried with **unpadded** county codes; the two formatters return different strings for 31 | unit | `$PNPM test:unit -t "unpadded county"` | ✅ (Wave 0 closed — see the Per-Task map) |
| D-03 | A closure row sets `closed_at` on the exact `(taxpayer_number, outlet_number)` match and on **no** other row | DB | `$PNPM test:db -t "closure exact match"` | ✅ (Wave 0 closed — see the Per-Task map) |
| D-03 | `closed_at` citing an **ephemeral** source is refused → `23503 businesses_closed_at_src_fk` | DB | `$PNPM test:db -t "closed_at cites durable"` | ✅ extended |
| **DATA-02** | `country='US' AND region='TX'` keeps the TX rows and drops **every** MX row, including `country='MX' AND region='TX'` | unit | `$PNPM test:unit -t "texas side filter"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-02 | `phones`/`websites`/`socials` are read from `.items`, not as bare arrays | unit | `$PNPM test:unit -t "duckdb list shape"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-02 | The stored coordinate is `ST_X/ST_Y`, not `bbox.xmin/ymin` (the fixture carries both; they differ) | unit | `$PNPM test:unit -t "geometry not bbox"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-02 | `categories` is read **nowhere**; `basic_category` is the only category input | unit (grep) | `$PNPM test:unit -t "basic_category only"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-02 | Every emitted row carries the release string | unit | `$PNPM test:unit -t "release recorded"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **DATA-03** | `address` / `location` / `closed_at` each refuse an ephemeral source → `23503`, constraint name pinned, one refusal per transaction, positive control each | DB ×3 | `$PNPM test:db -t "cites durable"` | ✅ extended |
| DATA-03 | `sr_source_key_known` admits the four new keys and still refuses an unknown one → `23514` | DB | `$PNPM test:db -t "source key known"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-03 | Every field on the detail view renders a source tag; a field with no source reads "Not stored / No durable source" | DB | `$PNPM test:db -t "provenance render"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **DATA-04** | A second ingest of an identical fixture: `added=0, changed=0, unchanged=n, gone=0`, **zero `businesses` writes and zero new `events` rows** | DB | `$PNPM test:db -t "re-run is idempotent"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-04 | A changed `payload_hash` updates the payload **and** the derived columns; an unchanged one advances only `last_seen_at` | DB | `$PNPM test:db -t "payload hash diff"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-04 | A row absent from the second run is counted `gone` and **not deleted**; its business survives | DB | `$PNPM test:db -t "gone is not a delete"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-04 | `payload_hash` is stable under key re-ordering | unit | `$PNPM test:unit -t "canonical hash"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DATA-04 | One `events` row per run via `app.emit_event`, actor `etl:<script>` | DB | `$PNPM test:db -t "one run-level event"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **DEDUP-01** | `score()` against the committed fixture: **exact** score, exact band, exact `signals` for all ten pairs | unit | `$PNPM test:unit -t "merge-pairs fixture"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | A single signal at its ceiling scores 75 and **cannot** reach 95 | unit | `$PNPM test:unit -t "one signal cannot reach 95"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | Two signals without the geo gate cap at 94 | unit | `$PNPM test:unit -t "no geo gate caps at 94"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | >25 km with both locations known → `distinct`, score 0, regardless of every other feature | unit | `$PNPM test:unit -t "never merges across 25 km"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | D-07: exact phone + same ZIP + sim ≥ 0.60 → 95; sim < 0.60 → clamped to 80–94 | unit ×2 | `$PNPM test:unit -t "phone locality"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | A `chain_key` on either side caps at 94 — auto-merge skips it | unit | `$PNPM test:unit -t "chain flag never merges"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | Toll-free NPAs never form a phone signal | unit | `$PNPM test:unit -t "toll-free is not an identifier"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | The candidate pass uses the GIN index: the generated SQL contains `cross join lateral` and **not** `on … % …` | unit (grep) | `$PNPM test:unit -t "lateral blocker"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-01 | Chain detection flags exactly the names with ≥3 members and no others | DB | `$PNPM test:db -t "chain_key >= 3"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **DEDUP-02** | After a merge: loser `status='merged'` + `merged_into_id`; **every** `source_records.business_id` unchanged | DB | `$PNPM test:db -t "every parent survives"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-02 | Unmerge restores the winner from `winner_fields_before`, the loser from its own source records, and writes `decision='distinct'` | DB | `$PNPM test:db -t "unmerge restores"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-02 | An unmerged pair is never re-proposed by a later resolve pass | DB | `$PNPM test:db -t "never auto-re-merges"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-02 | A three-way cluster (one Comptroller, two Overture at 95) merges into **one** winner | DB | `$PNPM test:db -t "three-way cluster"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-02 | A merge writes an `events` row with actor + timestamp, from a raw SQL write | DB | `$PNPM test:db -t "merge is audited"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **DEDUP-03** | `external_key` unique per org → `23505`; the shape CHECK refuses `I`/`L`/`O`/`U` → `23514` | DB ×2 | `$PNPM test:db -t "external key"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-03 | The loser's key resolves to the winner after merge and back to the loser after unmerge | DB | `$PNPM test:db -t "key survives merge"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-03 | `external_key` appears in no `references(` clause under `src/db/schema/**` | DB (catalog) | `$PNPM test:db -t "external key is not a FK"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-03 | `business_aliases` and `merged_into_id` never disagree | DB | `$PNPM test:db -t "alias consistency"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **DEDUP-04** | `nameNorm` over the committed string table: accents, ligatures, legal suffixes, bilingual stopwords, **adjacent** stopwords, no leading/trailing space, digits preserved | unit | `$PNPM test:unit -t "nameNorm"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-04 | `phoneE164` rejects non-US, 555 and the "other" class; marks toll-free `blockable:false` | unit | `$PNPM test:unit -t "phoneE164"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-04 | The address key strips the suite from the key and **keeps** it on the record | unit | `$PNPM test:unit -t "suite stripped not lost"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-04 | 🔴 `unaccent(` appears in no file under `src/` or `drizzle/*.sql` except the extension migration and the one named search predicate | unit (grep) | `$PNPM test:unit -t "SQL never normalizes"` | ✅ (Wave 0 closed — see the Per-Task map) |
| DEDUP-04 | `name_norm` is registered in `src/lib/export/registry.ts` and the leak sentinel scans it | unit | `$PNPM test:unit -t "internal annotations never leave the building"` | ✅ extended |
| **D-08** | Census batch: ragged `No_Match`/`Tie` lines parse; results rejoin by ID from a **shuffled** fixture; `lon,lat` order pinned by sign | unit ×3 | `$PNPM test:unit -t "census batch"` | ✅ (Wave 0 closed — see the Per-Task map) |
| D-08 | `Non_Exact` never promotes to the `address_exact` signal | unit | `$PNPM test:unit -t "non_exact is location only"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **Criterion 5** | A 60 km radius over a fixture containing Reynosa / Matamoros / Río Bravo returns > 20 Texas rows and **zero** Mexican rows | DB | `$PNPM test:db -t "no Mexican-side row"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **D-06** | `/sources` renders four rows with version, last run and the four counts, before and after a run | DB | `$PNPM test:db -t "run report"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **Extensions** | `pg_trgm 1.6` and `unaccent 1.1` installed, versions named | DB | `$PNPM test:db -t "extensions"` | ✅ (Wave 0 closed — see the Per-Task map) |
| **Phase 1/2 carry** | The five new tables are in `TENANT_TABLES` and the live catalog equals the array | DB | `$PNPM test:db -t "holds no"` | ✅ extended |
| Phase 1/2 carry | `business_merges` carries `log_event`; the other four deliberately do not (set equality both ways, `tgenabled` asserted) | DB | `$PNPM test:db -t "after-row trigger"` | ✅ extended |
| Phase 1/2 carry | Every new table has `org_id` + RLS + ≥1 policy; every new timestamp is `timestamptz` | DB | `$PNPM test:db -t "every public table"` | ✅ auto-covers |
| Phase 1/2 carry | `overture_category_map` built-ins are visible to a tenant; UPDATE/DELETE → `rowCount 0`; forged INSERT → `42501`; a duplicate built-in → `23505` (`nullsNotDistinct`) | DB | `$PNPM test:db -t "built-in"` | ✅ extended |
| Phase 1/2 carry | `out_of_business_date` buckets in `America/Chicago`: one instant, two zones, opposite day verdicts | DB + unit | `$PNPM test:db -t "two zones"` | ✅ extended |
| **UI-SPEC** | Every `data-testid` in 03-UI-SPEC § Accessibility resolves; primary controls ≥ 44×44 at 390×844 | E2E | `$PNPM test:e2e -g "touch targets"` | ✅ extended |
| CI hygiene | No test and no `src/` module reaches `data.texas.gov`, `overturemaps`, `s3.` or `geocoding.geo.census.gov` outside `scripts/` and msw handlers | unit (grep) | `$PNPM test:unit -t "CI never reaches the network"` | ✅ (Wave 0 closed — see the Per-Task map) |

## Sampling Rate

- **After every task commit:** `pnpm test:unit` plus the single `-t "<name>"` filter for the test that task made green — **read the test NAME in the output**; a `-t` filter matching nothing exits 0 green.
- **After every plan wave:** the five `verify` constituents individually through the pinned store launcher.
- **Before `/gsd-verify-work`:** all constituents green, `pnpm test:e2e` green against the deployed URL, and every mutation below applied to the **live local database** (or the live source file, where noted) and reverted with `git diff --stat` empty.
- **Max feedback latency:** 60 s (unit + one DB filter).

## Proposed phase-gate mutations (M13–M25, continuing Phase 2's numbering)

| # | Mutation | Must red — exactly |
|---|---|---|
| **M13** | Delete the `distanceM > 25_000 → 'distinct'` clause from `score.ts` | `never merges across 25 km` only. The fixture's other nine pairs stay green |
| **M14** | Delete `if (signals < 2) s = Math.min(s, 94)` | `one signal cannot reach 95` only; every ≥2-signal fixture pair stays green |
| **M15** | Delete `if (!geoGate(...)) s = Math.min(s, 94)` | `no geo gate caps at 94` only |
| **M16** | Remove the toll-free NPA set from `phoneE164()` | `toll-free is not an identifier` **and** `phoneE164` — two, and they are independent |
| **M17** | `drop index businesses_external_key_uniq` on the live DB | `external key is unique per org` only; the shape-CHECK test stays green |
| **M18** | `alter table businesses drop constraint businesses_location_src_fk` | `location cites durable` only; the address and closed_at pairs stay green |
| **M19** | `alter table businesses drop constraint businesses_closed_at_src_fk` | `closed_at cites durable` only |
| **M20** | Add `payload_hash` to the upsert's conflict target | `re-run is idempotent` **and** `gone is not a delete`; `payload hash diff` stays green |
| **M21** | Make unmerge skip the `decision='distinct'` write | `never auto-re-merges` only; `unmerge restores` stays green |
| **M22** | `grant update on public.ingest_runs to authenticated` | the grants matrix / `holds no` only |
| **M23** | Replace `country==='US' && region==='TX'` with `region==='TX'` in the Overture transform | `texas side filter` **and** `no Mexican-side result` — two, and the second is criterion 5 |
| **M24** | Wrap `name_norm` in `unaccent()` inside the blocking SQL | `SQL never normalizes` only |
| **M25** | Remove the `coalesce(merged_into_id, id)` re-point from the merge loop | `three-way cluster` only; `every parent survives` stays green |

Each per CONVENTIONS § Testing: **watched failing first**, SQLSTATE **and** constraint name pinned, message pinned where two invariants share `42501`, one refused statement per rolled-back transaction, a **positive control beside every refusal**, and every test's **name** read in the output. DB mutations go against the live local database and are verified reverted from `pg_constraint` / `pg_indexes` / `pg_trigger` / `information_schema.role_table_grants`, never from "the script ran".

## Wave 0 Gaps

> All closed. Each item names the plan that closed it (walked at 03-22 against `git log --diff-filter=A` for every file).

- [x] `pnpm add -D @duckdb/node-api@1.5.5-r.5` · `pnpm add libphonenumber-js@1.13.13` — **03-01** (`c8d1195`)
- [x] **The `create extension pg_trgm; create extension unaccent;` `db:custom` migration — the FIRST migration of the phase** — **03-01** (`drizzle/0021_extensions.sql`)
- [x] `tests/db/extensions.test.ts` — both extensions installed, versions named — **03-01**
- [x] `tests/unit/msw/fixtures/socrata-jrea-page.json` · `socrata-3kx8-page.json` · `socrata-400-type-mismatch.json` — **03-03**
- [x] `tests/unit/msw/fixtures/census-batch-{match,non_exact,tie,no_match,shuffled}.txt` — recorded verbatim — **03-07**
- [x] `tests/unit/fixtures/overture-rgv-sample.json` — release `2026-08-19.0` named, incl. Reynosa / Matamoros / Río Bravo and the `country='MX' AND region='TX'` rows — **03-13**
- [x] `tests/unit/fixtures/merge-pairs.json` — the ten pairs with exact expected scores — **03-02**, re-pinned by **03-20**
- [x] `tests/db/_ingest-fixtures.ts` — `withRollback`-safe, tens of rows — **03-09** (the merge-side seeders are `tests/db/_merge-fixtures.ts`, 03-11)
- [x] `src/seed/data/overture-categories.json` — measured mapping, the unmapped tail reported — **03-08**
- [x] `tests/db/grants-audit.test.ts` — `TENANT_TABLES` 16 → 21 — **03-05**
- [x] `tests/db/event-trigger.test.ts` — `business_merges` in `EVENT_LOGGED`, the other four excluded with the reason — **03-05**
- [x] `tests/db/retention.test.ts` — three "cites durable" tests, each with a positive control — **03-05** (M18 and M19 each red exactly one, 03-22)
- [x] The internal columns `name_norm`, `street_norm`, `phone_blockable` are scanned by `tests/unit/no-internal-leak.test.ts` — **03-05**. 🔴 Registered in `src/lib/export/public-business.ts` (the `PublicBusiness` `Omit`, which the sentinel type-checks) and in the sentinel's own internal-key list, **not** in `registry.ts`: that file lists payload *builders*, and has none until Phase 8. 03-05 proved it by mutation (removing `nameNorm` from the `Omit` fails `tsc`).
- [x] `src/env.ts` — optional `SOCRATA_APP_TOKEN`, server-only — **03-03**
- [x] `docs/runbooks/ingest.md` — the desk-run procedure and the numbers it reports — **03-20**
- [x] **Owed from Phase 2**: `.vercelignore` for `coverage/` — **03-01** (`c8d1195`); struck in `02-…/deferred-items.md`

---

## Security Domain

ASVS **L1**, `security_block_on: high`. The roadmap's note: *"bulk ingestion, new org-scoped tables and their RLS policies."*

---

## Per-Task Verification Map

> **Filled at 03-22 from the 59 task IDs of the 22 PLAN.md files.** Each row is one task, carrying
> the requirement it serves, the `<threat_model>` entries of its plan that it mitigates (`T-3-NN`,
> or `—`), and the exact filtered command that proves it. Status is as of `337a35a`: unit 298/298,
> db 194/194, typecheck, lint and build green. The three manual rows (two checkpoints and the
> desk run) each sit between automated tasks, so there are never three unverified tasks in a row.
>
> `$PNPM` in every command is the pinned store launcher, written out in full:
> `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs`
> Bare `pnpm` on this machine is the global 11.9.0 and dies before any script runs.
> `A→B` in a Task ID means the test is written in A and turned green in B.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 01 | 1 | DEDUP-01, DEDUP-04 | T-3-14 | duckdb + libphonenumber-js pinned; `.vercelignore` keeps `coverage/` (and later `.claude/`) out of the Vercel upload | build | `$PNPM typecheck` + `$PNPM build` | `.vercelignore` ✅ | ✅ green (build green at 03-22 `3c89af4`) |
| 03-01-T2 | 01 | 1 | DEDUP-01, DEDUP-04 | T-3-03 (accepted) | The extensions migration is the FIRST of the phase; `app.distance_m()` exists | DB | `$PNPM test:db -t "extensions are installed at the pinned versions"` | `drizzle/0021_extensions.sql` ✅ | ✅ green |
| 03-01-T3 | 01 | 1 | DEDUP-01 | T-3-05 (accepted) | pg_trgm 1.6 / unaccent 1.1 pinned by name; distance matches the measured RGV distances | DB | `$PNPM test:db -t "0021 extensions"` | `tests/db/extensions.test.ts` ✅ | ✅ green |
| 03-02-T1 | 02 | 1 | DEDUP-01 | T-3-11 | Six structural rules, each its own cap; `name_norm` never enters `features` | unit | `$PNPM test:unit -t "structural rules"` | `tests/unit/score.test.ts` ✅ | ✅ green (M13, M14, M15 red it at 03-22) |
| 03-02-T2 | 02 | 1 | DEDUP-01 | T-3-12 (accepted) | Exact score, band and signals for all ten pairs | unit | `$PNPM test:unit -t "merge-pairs fixture"` | `tests/unit/fixtures/merge-pairs.json` ✅ | ✅ green (re-pinned 03-20) |
| 03-02-T3 | 02 | 1 | DEDUP-03 | T-3-13 | Crockford lead key; never I, L, O or U | unit | `$PNPM test:unit -t "external key matches|external key never contains|external key draws"` | `tests/unit/external-key.test.ts` ✅ | ✅ green |
| 03-03-T1 | 03 | 1 | DATA-01 | T-3-04 | No SoQL string-prefix function; NAICS as half-open numeric ranges | unit (grep) | `$PNPM test:unit -t "naics prefix"` | `tests/unit/socrata.test.ts` ✅ | ✅ green |
| 03-03-T2 | 03 | 1 | DATA-01 | T-3-14 | Recorded msw pages; an unrecorded `$where` is refused, never answered | unit (msw) | `$PNPM test:unit -t "socrata replay"` | `tests/unit/msw/fixtures/socrata-*.json` ✅ | ✅ green |
| 03-03-T3 | 03 | 1 | DATA-01, D-03 | T-3-03 | Permits padded, closures UNPADDED; zod row schemas refuse a padded `loc_county` | unit | `$PNPM test:unit -t "unpadded county|comptroller row"` | `tests/unit/socrata.test.ts` ✅ | ✅ green |
| 03-04-T1 | 04 | 1 | DATA-03, DEDUP-01 | T-3-11 | Every Copy Table string in the server-safe `copy.ts` | unit | `$PNPM test:unit -t "ui copy"` | `tests/unit/ui-maps.test.ts` ✅ | ✅ green |
| 03-04-T2 | 04 | 1 | DEDUP-01 | T-3-10 | Six destinations in two groups; four phone tabs; the More sheet (its ✕ ≥ 44 px since 03-22 fix 2) | unit + e2e | `$PNPM test:unit -t "nav groups hold six destinations"` + `$PNPM test:e2e -g "touch targets"` | `tests/e2e/touch-targets.spec.ts` ✅ | ✅ green (touch targets 4/4 on the local build at 03-22) |
| 03-05-T1 | 05 | 2 | DATA-03, DEDUP-03 | T-3-11 | The five tables; internal columns registered so the leak sentinel scans them | unit | `$PNPM test:unit -t "internal annotations never leave the building"` | `src/lib/export/registry.ts` ✅ | ✅ green |
| 03-05-T2 | 05 | 2 | DATA-03, DATA-04, DEDUP-02 | T-3-06, T-3-08, T-3-09, T-3-13 | Migrations 0022/0023: org_id + RLS, provenance FKs, select-only grants, external key unique | DB | `$PNPM test:db -t "every public table"` + `$PNPM test:db -t "select-only spine tables"` | `drizzle/0022`, `0023` ✅ | ✅ green (M17, M22 red it) |
| 03-05-T3 | 05 | 2 | DATA-03 | T-3-06, T-3-09 | TENANT_TABLES 21; EVENT_LOGGED; the three "cites durable" pairs, each with a positive control | DB | `$PNPM test:db -t "cites durable"` + `$PNPM test:db -t "after-row trigger"` | `tests/db/retention.test.ts` ✅ | ✅ green (M18, M19 red it) |
| 03-06-T1 | 06 | 2 | DEDUP-04 | T-3-03 | nameNorm string table and defects; phoneE164 refuses non-US, 555, junk; toll-free not blockable | unit | `$PNPM test:unit -t "nameNorm|phoneE164"` | `tests/unit/normalize.test.ts` ✅ | ✅ green (M16 red it) |
| 03-06-T2 | 06 | 2 | DEDUP-04 | T-3-03 | The address key strips the suite from the key and keeps it on the record; USPS folding | unit | `$PNPM test:unit -t "addressKey|suite stripped not lost"` | `tests/unit/normalize.test.ts` ✅ | ✅ green |
| 03-06-T3 | 06 | 2 | DEDUP-04 | T-3-11, T-3-14 | Two grep gates: `unaccent(` only in the two allow-listed files; no module reaches the network | unit (grep) | `$PNPM test:unit -t "SQL never normalizes|CI never reaches the network"` | `tests/unit/sql-never-normalizes.test.ts`, `no-network.test.ts` ✅ | ✅ green (M24 red it) |
| 03-07-T1 | 07 | 2 | DATA-01 | T-3-14 | Five ragged Census responses recorded verbatim | unit (msw) | `$PNPM test:unit -t "census batch parses a ragged"` | `tests/unit/msw/fixtures/census-batch-*.txt` ✅ | ✅ green |
| 03-07-T2 | 07 | 2 | DATA-01, DATA-03 | T-3-05, T-3-12 | At most three chunks at once; an address only ever as a CSV field; a failed chunk is recorded | unit | `$PNPM test:unit -t "transport bounds|retries and then records the chunk"` | `src/lib/geocode/census-batch.ts` ✅ | ✅ green |
| 03-07-T3 | 07 | 2 | DATA-03 | T-3-03 | Rejoin by id from a shuffled fixture; lon,lat order pinned; Non_Exact is location only | unit | `$PNPM test:unit -t "census batch rejoins by id|census batch pins the axis order|non_exact is location only"` | `tests/unit/census-batch.test.ts` ✅ | ✅ green |
| 03-08-T1 | 08 | 3 | DATA-02 | T-3-07 | Category map from the measured distribution; only seeded cluster keys; its arithmetic closes | unit | `$PNPM test:unit -t "overture category map"` | `src/seed/data/overture-categories.json` ✅ | ✅ green |
| 03-08-T2 | 08 | 3 | DATA-02 | T-3-07, T-3-01 | Built-ins visible to a tenant; UPDATE/DELETE filtered to 0; forged INSERT 42501; duplicate 23505; seed idempotent | DB | `$PNPM test:db -t "built-in overture"` | `tests/db/reference-rows.test.ts` ✅ | ✅ green |
| 03-09-T1 | 09 | 3 | DATA-04 | T-3-01, T-3-02, T-3-15 | The ETL tier has org context without Clerk claims; a skipped `resolveEtlOrg` is refused | DB | `$PNPM test:db -t "the ETL tier has org context"` | `src/lib/ingest/etl-actor.ts` ✅ | ✅ green |
| 03-09-T2 | 09 | 3 | DATA-04 | T-3-03, T-3-12 | Re-run is idempotent (zero business writes, zero events); hash diff; gone is not a delete; one run event; two zones | DB | `$PNPM test:db -t "DATA-04: the ingest write path"` | `tests/db/ingest-idempotency.test.ts` ✅ | ✅ green (M20 / M20b red it) |
| 03-09-T3→03-13-T3 | 09 | 3 | DEDUP-03, criterion 5 | T-3-13 | External key unique per org (23505) and shaped (23514); a 60 km radius returns no Mexican-side row. Seeded through the 03-13 transform, so M23 reds both halves | DB | `$PNPM test:db -t "the external key|criterion 5"` | `tests/db/external-key.test.ts`, `texas-side.test.ts` ✅ | ✅ green (M17, M23 red it) |
| 03-10-T1 | 10 | 4 | DEDUP-01 | T-3-12, T-3-09, T-3-03 | Three blocking shapes; a block over the cap is recorded, not truncated; candidates org-scoped; toll-free forms no block | DB | `$PNPM test:db -t "candidate blocking"` | `tests/db/blocking.test.ts` ✅ | ✅ green (M24 reds its EXPLAIN gate) |
| 03-10-T2 | 10 | 4 | DEDUP-01 | T-3-04 | The candidate SQL is a `cross join lateral`, never `on … % …` | unit (grep) | `$PNPM test:unit -t "lateral blocker"` | `tests/unit/block-sql.test.ts` ✅ | ✅ green |
| 03-10-T3 | 10 | 4 | DEDUP-01, D-03 | T-3-12 | Chains flagged at ≥ 3 members only; a closure sets `closed_at` on the exact key and no other row | DB | `$PNPM test:db -t "chain detection|the closure feed"` | `tests/db/chain-closures.test.ts` ✅ | ✅ green |
| 03-11-T1 | 11 | 4 | DEDUP-02 | T-3-06 | D-14 survivorship as one pure function; a google_places parent never supplies a source id | unit | `$PNPM test:unit -t "survivorship"` | `tests/unit/survivorship.test.ts` ✅ | ✅ green |
| 03-11-T2 | 11 | 4 | DEDUP-02, DEDUP-03 | T-3-02, T-3-08, T-3-10, T-3-15, T-3-16 | The 0024 definers refuse cross-org ids and succeed from the desk tier | DB | `$PNPM test:db -t "cross-org refusal|the desk tier"` | `drizzle/0024_merge_functions.sql` ✅ | ✅ green (M21, M25b red it) |
| 03-11-T3 | 11 | 4 | DEDUP-02, DEDUP-03 | T-3-08, T-3-13 | Every parent survives; unmerge restores; never auto-re-merges; three-way cluster; merge is audited; key survives merge; aliases agree | DB | `$PNPM test:db -t "merge and unmerge|alias consistency"` | `tests/db/merge-unmerge.test.ts`, `alias-consistency.test.ts` ✅ | ✅ green |
| 03-12-T1 | 12 | 4 | DATA-01, DATA-04 | T-3-01 | `ingest-comptroller` refuses to start without `--org` and refuses an unknown flag | unit | `$PNPM test:unit -t "the argument gate"` | `tests/unit/ingest-comptroller.test.ts` ✅ | ✅ green |
| 03-12-T2 | 12 | 4 | DATA-01, DATA-03, D-03 | T-3-12, T-3-15 | The Census pass leaves a merge-chosen location alone on a re-run; the closure feed matches exactly | DB | `$PNPM test:db -t "the Census geocode pass on a re-run|closure exact match"` | `tests/db/geocode-rerun.test.ts` ✅ | ✅ green |
| 03-12-T3 | 12 | 4 | DATA-01, D-11 | T-3-04, T-3-05 | Query shapes pinned: permits padded, closures unpadded, statewide frequency by the county sentinel | unit | `$PNPM test:unit -t "the query shapes"` | `tests/unit/ingest-comptroller.test.ts` ✅ | ✅ green |
| 03-13-T1 | 13 | 4 | DATA-02 | T-3-05, T-3-12 | The DuckDB range-read is a desk script; no `src/` module imports the native binary | unit (grep) | `$PNPM test:unit -t "no src module imports the DuckDB native binary"` + `$PNPM typecheck` | `scripts/ingest-overture.ts` ✅ | ✅ green |
| 03-13-T2 | 13 | 4 | DATA-02 | T-3-03 | The committed Overture fixture names its release and carries every branch, incl. `country=MX AND region=TX` | unit | `$PNPM test:unit -t "overture fixture carries its provenance"` | `tests/unit/fixtures/overture-rgv-sample.json` ✅ | ✅ green |
| 03-13-T3 | 13 | 4 | DATA-02, DATA-04 | T-3-03, T-3-11 | Texas side filter (both halves); `.items`; geometry not bbox; `basic_category` only; release recorded | unit | `$PNPM test:unit -t "DATA-02: overtureRowToSourceRecord"` | `tests/unit/overture-transform.test.ts` ✅ | ✅ green (M23 red it) |
| 03-14-T1 | 14 | 5 | DEDUP-01, DEDUP-02 | T-3-01, T-3-15 | Stage 0 resolves the org before any stage; the pass runs from an owner connection with no claims | DB | `$PNPM test:db -t "stage 0 preflight|the pass runs from an owner connection"` | `scripts/resolve.ts` ✅ | ✅ green |
| 03-14-T2 | 14 | 5 | DEDUP-01, DEDUP-02 | T-3-02, T-3-08, T-3-09, T-3-12 | The pass end to end: merges at 95, enqueues at 80, chains wait, unmerged never re-proposed, deterministic, org-scoped | DB | `$PNPM test:db -t "the resolve pass"` | `tests/db/resolve-pass.test.ts` ✅ | ✅ green (M21, M25a; see deferred F7) |
| 03-15-T1 | 15 | 5 | DATA-03, DEDUP-03 | T-3-09, T-3-11 | Provenance per field; internal columns absent by KEY; a foreign id reads as unknown; merge sides carry key + source | DB | `$PNPM test:db -t "business detail provenance"` | `tests/db/provenance-render.test.ts` ✅ | ✅ green |
| 03-15-T2 | 15 | 5 | DEDUP-02 | T-3-08, T-3-10 | Both server actions call `requireOrg` first; foreign id is not_found; decided pair is a conflict | unit + DB | `$PNPM test:unit -t "every server action calls requireOrg"` + `$PNPM test:db -t "review actions, as a Clerk user"` | `tests/unit/server-actions-guard.test.ts`, `tests/db/review-actions.test.ts` ✅ | ✅ green |
| 03-15-T3 | 15 | 5 | DATA-04, D-06 | T-3-09 | The run report renders four rows before and after a run, and survives a failed run | DB | `$PNPM test:db -t "run report"` | `tests/db/run-report.test.ts` ✅ | ✅ green |
| 03-16-T1 | 16 | 6 | DEDUP-01 | T-3-11 | The pair card and the chip band as a component vector; never a key the vector did not supply | unit + build | `$PNPM test:unit -t "review chips"` + `$PNPM build` | `tests/unit/review-chips.test.ts` ✅ | ✅ green |
| 03-16-T2 | 16 | 6 | DEDUP-01, DEDUP-02 | T-3-10 | Rule 20: never advance before the write is recorded; the thumb clearance is MEASURED (03-22 fix 1) | unit | `$PNPM test:unit -t "review actions|review thumb bar clearance"` | `tests/unit/review-actions.test.tsx`, `thumb-bar.test.tsx` ✅ | ✅ green |
| 03-17-T1 | 17 | 6 | DATA-04 | T-3-03, T-3-09 | One tone map covers every ingest status; the ledger renders four rows before any run | unit | `$PNPM test:unit -t "ingest run tone covers every status|sources ledger"` | `tests/unit/sources-ledger.test.tsx` ✅ | ✅ green |
| 03-17-T2 | 17 | 6 | DATA-02 | T-3-11, T-3-14 | The confidence distribution; the licence attribution verbatim; its heading in foreground (03-22 fix 4) | unit | `$PNPM test:unit -t "confidence distribution|sources skeleton and attribution"` | `tests/unit/sources-ledger.test.tsx` ✅ | ✅ green |
| 03-18-T1 | 18 | 6 | DATA-02 | T-3-05 | The search predicate is the one allow-listed `unaccent(` site; replace, never push | unit | `$PNPM test:unit -t "businesses search|SQL never normalizes"` | `tests/unit/business-list.test.tsx` ✅ | ✅ green |
| 03-18-T2 | 18 | 6 | DATA-03 | T-3-03, T-3-09, T-3-11, T-3-13 | Desk table and phone cards; sources as text; Closed in the Chicago day; names verbatim | unit | `$PNPM test:unit -t "business list|the Closed badge is one treatment"` | `tests/unit/business-list.test.tsx`, `closed-badge.test.tsx` ✅ | ✅ green |
| 03-19-T1 | 19 | 6 | DATA-03, DEDUP-03 | T-3-06, T-3-09, T-3-11, T-3-13 | Every `[id]` route guards its uuid; the D-18 field order with a source tag on every row; "Not stored / No durable source" | unit | `$PNPM test:unit -t "ids: every|business detail"` | `tests/unit/ids.test.ts`, `business-detail.test.tsx` ✅ | ✅ green |
| 03-19-T2 | 19 | 6 | DEDUP-02 | T-3-10 | Unmerge always confirms; refusals keep the dialog open; same-name sides told apart by key + source (03-22 fix 3) | unit + DB | `$PNPM test:unit -t "merge history|unmerge confirmation"` + `$PNPM test:db -t "merge history names each side"` | `tests/unit/unmerge-dialog.test.tsx` ✅ | ✅ green |
| 03-20-T1 | 20 | 6 | DATA-01, DATA-02, DATA-04 | T-3-01, T-3-02, T-3-14, T-3-15 | The desk run against the real sources, its numbers committed; the re-run writes nothing | manual (desk run) + DB | `$PNPM test:db -t "re-run is idempotent"` | `docs/measurements/03-desk-run.md` ✅ | ✅ green (desk run 2026-09-22/23) |
| 03-20-T2 | 20 | 6 | DEDUP-01, D-04 | T-3-11 | danlo confirmed the confidence cutoff and the ten fixture verdicts | manual (checkpoint:human-verify) | — (manual; bracketed by automated tasks on both sides) | `docs/measurements/03-desk-run.md` ✅ | ✅ approved (03-20) |
| 03-20-T3 | 20 | 6 | DEDUP-01 | T-3-11 | Tuned constants applied; fixture re-pinned; the R4 phone-lift floor | unit | `$PNPM test:unit -t "merge-pairs fixture|phone lift needs name sim"` | `tests/unit/score.test.ts` ✅ | ✅ green |
| 03-21-T1 | 21 | 7 | DATA-01, DATA-02, DATA-03 | T-3-01 | danlo approved the production migration | manual (checkpoint:decision) | — (manual; bracketed by automated tasks on both sides) | `docs/deploy.md` ✅ | ✅ approved (03-21) |
| 03-21-T2 | 21 | 7 | DATA-01, DATA-02, DATA-03 | T-3-01, T-3-07, T-3-09 | Production migrated 0021–0024 and seeded; the deployed commit verified | e2e (deployed) | `$PNPM test:e2e -g "signed in"` | `tests/e2e/signed-in.spec.ts` ✅ | ✅ green (03-21, deployed) |
| 03-21-T3 | 21 | 7 | DEDUP-01, UI-SPEC | T-3-10, T-3-14 | Chrome-only `/sources` and `/businesses` specs; touch targets on the deployed build | e2e | `$PNPM test:e2e -g "sources|businesses|touch targets"` | `tests/e2e/sources.spec.ts`, `businesses.spec.ts` ✅ | ✅ green (03-21 deployed; touch targets re-run locally at 03-22) |
| 03-22-T1 | 22 | 8 | all eight | T-3-01, T-3-06, T-3-09, T-3-11 | M13–M25 each applied, red by NAME, reverted; catalog byte-identical to the capture | mutation | `$PNPM test:unit` + `$PNPM test:db` | `docs/measurements/03-gate-mutations.md` ✅ | ✅ green (291/291 + 193/193 after the last revert) |
| 03-22-T2 | 22 | 8 | UI-SPEC | T-3-10 | The four screens in both themes on the built app; contrast by computed style; four fixes applied | manual (checkpoint:human-verify) | `$PNPM test:e2e -g "touch targets"` | `docs/measurements/03-screens/` ✅ | ✅ approved 2026-09-23 with four fixes |
| 03-22-T3 | 22 | 8 | all eight | — | This map and the sign-off; the Phase 2 debts settled | unit + DB (+ e2e) | `$PNPM test:unit` + `$PNPM test:db` | this file ✅ | ✅ green (298/298 + 194/194); full e2e owed to CI on the PR |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The real ingest numbers — added/changed/unchanged/gone, the Overture confidence distribution and the sampled junk rate | DATA-04 / D-04 / D-06 | CI never reaches Socrata, S3 or the Census geocoder. The measurement is a desk run by definition, and its output is the artifact success criterion 1 asks for. | Run both ingest scripts from the repo against the live sources (~20 min wall clock per `docs/runbooks/ingest.md`), then commit the reported numbers. |
| The `confidence` cutoff | D-04 | The distribution is measured, but whether a band is junk needs human eyes on real rows. | Ship `0.5` behind a `// TUNED BY THE DESK RUN` marker, then eyeball a sample per 0.1 band and adjust the committed constant. |
| The ten-pair scoring fixture's expected scores | DEDUP-01 / D-09 | The pairs are real RGV businesses; whether two rows *are* the same business is a judgement no test can make for us. | Read the ten pairs in `03-RESEARCH.md` § Scoring, confirm each verdict, then pin the expected score and band in `tests/unit/fixtures/merge-pairs.json`. |
| Review-queue and business-detail visual verification in both themes on the deployed app | UI-SPEC | Screenshots of the styleguide prove nothing — the standing lesson is to shoot the real screens on the built app. | After deploy, open `/review`, `/sources`, `/businesses` and a detail page at 390×844 and on the desk, in light and dark. **Done at 03-22 on the built app** (local build, not the deployed URL: the fixes are unpushed). danlo approved 2026-09-23 with four fixes applied; see `docs/measurements/03-gate-mutations.md` § Task 2 and `docs/measurements/03-screens/`. |

---

## Validation Sign-Off

- [x] **Per-Task Verification Map filled from the PLAN.md task IDs.** 59 rows, one per task
      across 03-01…03-22. Every `-t` filter matched ≥ 1 real test (a script checked all of them
      against the verbose name lists at `337a35a`).
- [x] **All tasks have an `<automated>` verify or a Wave 0 dependency.** 56 of 59 carry an
      automated command. The other three are the checkpoints 03-20-T2, 03-21-T1 and 03-22-T2, and
      each is bracketed by automated tasks. 03-22-T2 also carries the `touch targets` e2e run.
- [x] **Sampling continuity: no 3 consecutive tasks without an automated verify.** The longest
      manual run is one task.
- [x] **Wave 0 covers every ❌ reference in the requirement → test map.** All sixteen Wave 0
      items are ticked with their closing plan. Three stale filters in the requirement map were
      corrected to real test names (`external key is not a FK` is a DB test;
      `internal annotations never leave the building`; `no Mexican-side row`).
- [x] **No watch-mode flags.** `grep -n watch` over `package.json`, the three test configs and
      the CI workflow returns nothing; every script is `vitest run` or `playwright test`.
- [x] **Feedback latency < 60 s (unit + one DB filter).** Measured at 03-22: `$PNPM test:unit`
      15 s + `$PNPM test:db -t "re-run is idempotent"` 4 s = **19 s**.
- [x] **M13–M25 each applied to the live local database (or the named source file), watched red
      by test NAME, reverted, `git diff --stat` empty.** See `docs/measurements/03-gate-mutations.md`:
      thirteen mutations plus four variants (M20b, M22b, M25a, M25b). None reds nothing. Six red
      more than predicted, each explained there: M16, M17, M20, M21, M24, M25b. One guard (M25a's
      distinct check) is covered only by chance and is deferred with a proposed test. The catalog
      after the last revert is byte-identical to the pre-mutation capture.
- [x] **`nyquist_compliant: true` set in frontmatter**, and `status: approved`.

**Not ticked, and why:** `$PNPM test:e2e` against the deployed URL was **not** run in 03-22.
This plan may not touch production, and the e2e suite writes presets there. Nothing is pushed,
so the deployed app lacks the four 03-22 fixes, and the new `sheet-close` assertions in
`touch-targets.spec.ts` would fail against it until this branch deploys. That spec ran green
(4/4) against a local `next build && next start` of this tree. The full e2e run is owed to CI
on the phase PR.

**Approval:** approved 2026-09-23. danlo approved the screens with four fixes (applied in
`bd83587`, `f274413`, `7b00b72`, `3c89af4`); the mutation log and this map were closed by
plan 03-22.

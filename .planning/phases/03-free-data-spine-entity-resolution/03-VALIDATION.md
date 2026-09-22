---
phase: 3
slug: free-data-spine-entity-resolution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived verbatim from `03-RESEARCH.md` § Validation Architecture — the requirement → test
> map, the sampling rate, the gate mutations M13–M25 and the Wave 0 gaps are copied from there,
> which is where their evidence lives. `02-VALIDATION.md` is the format precedent, including
> how it was closed.
>
> **Status is `draft` and `nyquist_compliant` is `false` until the Per-Task Verification Map
> below is filled from the PLAN.md task IDs.** Every number in the research behind this file was
> measured live on 2026-09-22 against the real datasets and the real local PostgreSQL 18.6.

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
| **DATA-01** | `jrea-zgmq` row → source record: `outlet_naics_code` arrives as a *string* although typed `number`; `outlet_county_code` is zero-padded | unit (msw) | `pnpm test:unit -t "comptroller row"` | ❌ Wave 0 |
| DATA-01 | The SoQL string-prefix function appears nowhere in `src/lib/socrata/**` (the lifted grep gate) | unit (grep) | `pnpm test:unit -t "naics prefix"` | ✏️ extend to the new path |
| **DATA-01 / D-03** | 🔴 `3kx8-uryv` is queried with **unpadded** county codes; the two formatters return different strings for 31 | unit | `pnpm test:unit -t "unpadded county"` | ❌ Wave 0 |
| D-03 | A closure row sets `closed_at` on the exact `(taxpayer_number, outlet_number)` match and on **no** other row | DB | `pnpm test:db -t "closure exact match"` | ❌ Wave 0 |
| D-03 | `closed_at` citing an **ephemeral** source is refused → `23503 businesses_closed_at_src_fk` | DB | `pnpm test:db -t "closed_at cites durable"` | ✏️ extend `retention.test.ts` |
| **DATA-02** | `country='US' AND region='TX'` keeps the TX rows and drops **every** MX row, including `country='MX' AND region='TX'` | unit | `pnpm test:unit -t "texas side filter"` | ❌ Wave 0 |
| DATA-02 | `phones`/`websites`/`socials` are read from `.items`, not as bare arrays | unit | `pnpm test:unit -t "duckdb list shape"` | ❌ Wave 0 |
| DATA-02 | The stored coordinate is `ST_X/ST_Y`, not `bbox.xmin/ymin` (the fixture carries both; they differ) | unit | `pnpm test:unit -t "geometry not bbox"` | ❌ Wave 0 |
| DATA-02 | `categories` is read **nowhere**; `basic_category` is the only category input | unit (grep) | `pnpm test:unit -t "basic_category only"` | ❌ Wave 0 |
| DATA-02 | Every emitted row carries the release string | unit | `pnpm test:unit -t "release recorded"` | ❌ Wave 0 |
| **DATA-03** | `address` / `location` / `closed_at` each refuse an ephemeral source → `23503`, constraint name pinned, one refusal per transaction, positive control each | DB ×3 | `pnpm test:db -t "cites durable"` | ✏️ extend `retention.test.ts` |
| DATA-03 | `sr_source_key_known` admits the four new keys and still refuses an unknown one → `23514` | DB | `pnpm test:db -t "source key known"` | ❌ Wave 0 |
| DATA-03 | Every field on the detail view renders a source tag; a field with no source reads "Not stored / No durable source" | DB | `pnpm test:db -t "provenance render"` | ❌ Wave 0 |
| **DATA-04** | A second ingest of an identical fixture: `added=0, changed=0, unchanged=n, gone=0`, **zero `businesses` writes and zero new `events` rows** | DB | `pnpm test:db -t "re-run is idempotent"` | ❌ Wave 0 |
| DATA-04 | A changed `payload_hash` updates the payload **and** the derived columns; an unchanged one advances only `last_seen_at` | DB | `pnpm test:db -t "payload hash diff"` | ❌ Wave 0 |
| DATA-04 | A row absent from the second run is counted `gone` and **not deleted**; its business survives | DB | `pnpm test:db -t "gone is not a delete"` | ❌ Wave 0 |
| DATA-04 | `payload_hash` is stable under key re-ordering | unit | `pnpm test:unit -t "canonical hash"` | ❌ Wave 0 |
| DATA-04 | One `events` row per run via `app.emit_event`, actor `etl:<script>` | DB | `pnpm test:db -t "one run-level event"` | ❌ Wave 0 |
| **DEDUP-01** | `score()` against the committed fixture: **exact** score, exact band, exact `signals` for all ten pairs | unit | `pnpm test:unit -t "merge-pairs fixture"` | ❌ Wave 0 |
| DEDUP-01 | A single signal at its ceiling scores 75 and **cannot** reach 95 | unit | `pnpm test:unit -t "one signal cannot reach 95"` | ❌ Wave 0 |
| DEDUP-01 | Two signals without the geo gate cap at 94 | unit | `pnpm test:unit -t "no geo gate caps at 94"` | ❌ Wave 0 |
| DEDUP-01 | >25 km with both locations known → `distinct`, score 0, regardless of every other feature | unit | `pnpm test:unit -t "never merges across 25 km"` | ❌ Wave 0 |
| DEDUP-01 | D-07: exact phone + same ZIP + sim ≥ 0.60 → 95; sim < 0.60 → clamped to 80–94 | unit ×2 | `pnpm test:unit -t "phone locality"` | ❌ Wave 0 |
| DEDUP-01 | A `chain_key` on either side caps at 94 — auto-merge skips it | unit | `pnpm test:unit -t "chain flag never merges"` | ❌ Wave 0 |
| DEDUP-01 | Toll-free NPAs never form a phone signal | unit | `pnpm test:unit -t "toll-free is not an identifier"` | ❌ Wave 0 |
| DEDUP-01 | The candidate pass uses the GIN index: the generated SQL contains `cross join lateral` and **not** `on … % …` | unit (grep) | `pnpm test:unit -t "lateral blocker"` | ❌ Wave 0 |
| DEDUP-01 | Chain detection flags exactly the names with ≥3 members and no others | DB | `pnpm test:db -t "chain_key >= 3"` | ❌ Wave 0 |
| **DEDUP-02** | After a merge: loser `status='merged'` + `merged_into_id`; **every** `source_records.business_id` unchanged | DB | `pnpm test:db -t "every parent survives"` | ❌ Wave 0 |
| DEDUP-02 | Unmerge restores the winner from `winner_fields_before`, the loser from its own source records, and writes `decision='distinct'` | DB | `pnpm test:db -t "unmerge restores"` | ❌ Wave 0 |
| DEDUP-02 | An unmerged pair is never re-proposed by a later resolve pass | DB | `pnpm test:db -t "never auto-re-merges"` | ❌ Wave 0 |
| DEDUP-02 | A three-way cluster (one Comptroller, two Overture at 95) merges into **one** winner | DB | `pnpm test:db -t "three-way cluster"` | ❌ Wave 0 |
| DEDUP-02 | A merge writes an `events` row with actor + timestamp, from a raw SQL write | DB | `pnpm test:db -t "merge is audited"` | ❌ Wave 0 |
| **DEDUP-03** | `external_key` unique per org → `23505`; the shape CHECK refuses `I`/`L`/`O`/`U` → `23514` | DB ×2 | `pnpm test:db -t "external key"` | ❌ Wave 0 |
| DEDUP-03 | The loser's key resolves to the winner after merge and back to the loser after unmerge | DB | `pnpm test:db -t "key survives merge"` | ❌ Wave 0 |
| DEDUP-03 | `external_key` appears in no `references(` clause under `src/db/schema/**` | unit (grep) | `pnpm test:unit -t "external key is not a FK"` | ❌ Wave 0 |
| DEDUP-03 | `business_aliases` and `merged_into_id` never disagree | DB | `pnpm test:db -t "alias consistency"` | ❌ Wave 0 |
| **DEDUP-04** | `nameNorm` over the committed string table: accents, ligatures, legal suffixes, bilingual stopwords, **adjacent** stopwords, no leading/trailing space, digits preserved | unit | `pnpm test:unit -t "nameNorm"` | ❌ Wave 0 |
| DEDUP-04 | `phoneE164` rejects non-US, 555 and the "other" class; marks toll-free `blockable:false` | unit | `pnpm test:unit -t "phoneE164"` | ❌ Wave 0 |
| DEDUP-04 | The address key strips the suite from the key and **keeps** it on the record | unit | `pnpm test:unit -t "suite stripped not lost"` | ❌ Wave 0 |
| DEDUP-04 | 🔴 `unaccent(` appears in no file under `src/` or `drizzle/*.sql` except the extension migration and the one named search predicate | unit (grep) | `pnpm test:unit -t "SQL never normalizes"` | ❌ Wave 0 |
| DEDUP-04 | `name_norm` is registered in `src/lib/export/registry.ts` and the leak sentinel scans it | unit | `pnpm test:unit -t "no internal leak"` | ✏️ extend |
| **D-08** | Census batch: ragged `No_Match`/`Tie` lines parse; results rejoin by ID from a **shuffled** fixture; `lon,lat` order pinned by sign | unit ×3 | `pnpm test:unit -t "census batch"` | ❌ Wave 0 |
| D-08 | `Non_Exact` never promotes to the `address_exact` signal | unit | `pnpm test:unit -t "non_exact is location only"` | ❌ Wave 0 |
| **Criterion 5** | A 60 km radius over a fixture containing Reynosa / Matamoros / Río Bravo returns > 20 Texas rows and **zero** Mexican rows | DB | `pnpm test:db -t "no Mexican-side result"` | ❌ Wave 0 |
| **D-06** | `/sources` renders four rows with version, last run and the four counts, before and after a run | DB | `pnpm test:db -t "run report"` | ❌ Wave 0 |
| **Extensions** | `pg_trgm 1.6` and `unaccent 1.1` installed, versions named | DB | `pnpm test:db -t "extensions"` | ❌ Wave 0 |
| **Phase 1/2 carry** | The five new tables are in `TENANT_TABLES` and the live catalog equals the array | DB | `pnpm test:db -t "holds no"` | ✏️ extend |
| Phase 1/2 carry | `business_merges` carries `log_event`; the other four deliberately do not (set equality both ways, `tgenabled` asserted) | DB | `pnpm test:db -t "after-row trigger"` | ✏️ extend `EVENT_LOGGED` |
| Phase 1/2 carry | Every new table has `org_id` + RLS + ≥1 policy; every new timestamp is `timestamptz` | DB | `pnpm test:db -t "every public table"` | ✅ auto-covers |
| Phase 1/2 carry | `overture_category_map` built-ins are visible to a tenant; UPDATE/DELETE → `rowCount 0`; forged INSERT → `42501`; a duplicate built-in → `23505` (`nullsNotDistinct`) | DB | `pnpm test:db -t "built-in"` | ✏️ extend |
| Phase 1/2 carry | `out_of_business_date` buckets in `America/Chicago`: one instant, two zones, opposite day verdicts | DB + unit | `pnpm test:db -t "two zones"` | ✏️ extend |
| **UI-SPEC** | Every `data-testid` in 03-UI-SPEC § Accessibility resolves; primary controls ≥ 44×44 at 390×844 | E2E | `pnpm test:e2e -g "touch targets"` | ✏️ extend |
| CI hygiene | No test and no `src/` module reaches `data.texas.gov`, `overturemaps`, `s3.` or `geocoding.geo.census.gov` outside `scripts/` and msw handlers | unit (grep) | `pnpm test:unit -t "CI never reaches the network"` | ❌ Wave 0 |

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

- [ ] `pnpm add -D @duckdb/node-api@1.5.5-r.5` · `pnpm add libphonenumber-js@1.13.13`
- [ ] **The `create extension pg_trgm; create extension unaccent;` `db:custom` migration — the FIRST migration of the phase**, so CI answers A1 before anything depends on it
- [ ] `tests/db/extensions.test.ts` — both extensions installed, versions named
- [ ] `tests/unit/msw/fixtures/socrata-jrea-page.json` · `socrata-3kx8-page.json` · `socrata-400-type-mismatch.json`
- [ ] `tests/unit/msw/fixtures/census-batch-{match,non_exact,tie,no_match,shuffled}.txt` — recorded verbatim from this session's live probes
- [ ] `tests/unit/fixtures/overture-rgv-sample.json` — ~200 rows, release `2026-08-19.0` named in a header comment, incl. Reynosa / Matamoros / Río Bravo and one `country='MX' AND region='TX'` row
- [ ] `tests/unit/fixtures/merge-pairs.json` — the ten pairs in § Scoring, with exact expected scores
- [ ] `tests/db/_ingest-fixtures.ts` — `seedOvertureFixture` / `seedComptrollerFixture` / `seedCandidatePair`, `withRollback`-safe, **tens of rows, never thousands**
- [ ] `src/seed/data/overture-categories.json` — ≥60 `basic_category` → `cluster_key` entries covering ≈80 % of rows; the unmapped tail is reported, never guessed
- [ ] `tests/db/grants-audit.test.ts` — extend `TENANT_TABLES` with the five new tables (16 → 21)
- [ ] `tests/db/event-trigger.test.ts` — add `business_merges` to `EVENT_LOGGED`; **deliberately exclude** `ingest_runs`, `merge_candidates`, `business_aliases`, `overture_category_map`, with a comment naming the reason
- [ ] `tests/db/retention.test.ts` — three new "cites durable" tests, one per new provenance pair, each with a positive control
- [ ] `src/lib/export/registry.ts` — register `name_norm`, `street_norm`, `phone_blockable` and any other new internal column so `tests/unit/no-internal-leak.test.ts` scans them
- [ ] `src/env.ts` — optional `SOCRATA_APP_TOKEN` (server-only, never `NEXT_PUBLIC_`)
- [ ] `docs/runbooks/ingest.md` — the desk-run procedure, its ~20-minute wall clock, and the numbers the run must report
- [ ] **Owed from Phase 2** (03-CONTEXT § Deferred): `.vercelignore` for `coverage/` — one line, the first plan that touches deploy

---

## Security Domain

ASVS **L1**, `security_block_on: high`. The roadmap's note: *"bulk ingestion, new org-scoped tables and their RLS policies."*

---

## Per-Task Verification Map

> **Filled after planning.** Task IDs do not exist until `gsd-planner` writes the PLAN.md files;
> each row below is one task, carrying the requirement it serves, the `<threat_model>` entry it
> mitigates (`T-3-NN` or `—`), and the exact filtered command that proves it.
>
> `$PNPM` in every command is the pinned store launcher, written out in full:
> `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs`
> Bare `pnpm` on this machine is the global 11.9.0 and dies before any script runs.
> `A→B` in a Task ID means the test is written in A and turned green in B.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _pending_ | — | — | — | — | _filled from PLAN.md after planning_ | — | — | — | ⬜ pending |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The real ingest numbers — added/changed/unchanged/gone, the Overture confidence distribution and the sampled junk rate | DATA-04 / D-04 / D-06 | CI never reaches Socrata, S3 or the Census geocoder. The measurement is a desk run by definition, and its output is the artifact success criterion 1 asks for. | Run both ingest scripts from the repo against the live sources (~20 min wall clock per `docs/runbooks/ingest.md`), then commit the reported numbers. |
| The `confidence` cutoff | D-04 | The distribution is measured, but whether a band is junk needs human eyes on real rows. | Ship `0.5` behind a `// TUNED BY THE DESK RUN` marker, then eyeball a sample per 0.1 band and adjust the committed constant. |
| The ten-pair scoring fixture's expected scores | DEDUP-01 / D-09 | The pairs are real RGV businesses; whether two rows *are* the same business is a judgement no test can make for us. | Read the ten pairs in `03-RESEARCH.md` § Scoring, confirm each verdict, then pin the expected score and band in `tests/unit/fixtures/merge-pairs.json`. |
| Review-queue and business-detail visual verification in both themes on the deployed app | UI-SPEC | Screenshots of the styleguide prove nothing — the standing lesson is to shoot the real screens on the built app. | After deploy, open `/review`, `/sources`, `/businesses` and a detail page at 390×844 and on the desk, in light and dark. |

---

## Validation Sign-Off

- [ ] Per-Task Verification Map filled from the PLAN.md task IDs
- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers every ❌ reference in the requirement → test map
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] M13–M25 each applied to the live local database (or the named source file), watched red by test NAME, reverted, `git diff --stat` empty
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

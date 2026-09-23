# Phase 3: Free-Data Spine & Entity Resolution — Research

**Researched:** 2026-09-22
**Domain:** Bulk public-data ingest (Socrata / Overture-on-DuckDB / Census batch geocoder) + Postgres-native entity resolution at ~92k records
**Confidence:** HIGH — every load-bearing number below was measured live in this session against the real datasets and the real local PostgreSQL 18.6, not inferred

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Ingest surface & scope**

- **D-01:** Both ingests are **desk scripts**, run from the repo by danlo or Claude Code (Remote Control can drive them): `tsx scripts/ingest-comptroller.ts` (plain `fetch` + SoQL, paged) and `tsx scripts/ingest-overture.ts` (`@duckdb/node-api` against the release Parquet on S3, RGV bbox range-read, then `region='TX' AND country='US'` filter). They connect as an **ETL actor** — the `app.actor_id` GUC fallback in `app.log_event` / `app.touch_updated_at` (`drizzle/0007`) exists for exactly this — and write through the same org-scoped tables as the app, for danlo's org. **Nothing in the app calls Socrata or DuckDB**; the app reads the result and shows the last-run report. No in-app "refresh" button in this phase.
- **D-02:** The ingest loads **everything in the four counties**: all ~35k Comptroller outlets and all ~57k Texas-side Overture places. Each source record is tagged with a cluster where its NAICS code falls in a seeded range (`src/seed/data/clusters.json`) or its `basic_category` maps to one (a new committed mapping seed, see Discretion); **unmapped rows stay in the spine and never enter the lead funnel**. Dedupe sees the whole universe; adding a cluster later is a mapping change, not a re-ingest.
- **D-03:** The Comptroller **out-of-business dataset `3kx8-uryv` ships in this phase as a closure signal**: a second feed keyed on `(taxpayer_number, outlet_number)`, exact match only, that sets `closed_at` (with provenance) on the matching business. No fuzzy logic on this feed. Phase 6/7 read `closed_at` so a dead business is never surfaced as a lead; the compliance list itself (COMP-05) stays v2.
- **D-04:** Overture `confidence` is **stored on every row, never cut at ingest** (Overture already drops ≤0.2 upstream). The funnel applies a **committed cutoff constant**, and the ingest **measures and reports** the distribution (rows per 0.1 band, junk rate sampled) so the roadmap's research flag — "real RGV duplicate rate, junk rate and correct `confidence` cutoff are asserted, not measured" — is answered by numbers in the run report, not by a guess.
- **D-05:** A re-run is **idempotent by external id** (Overture GERS `id`; Comptroller `taxpayer_number || '-' || outlet_number`) with a `payload_hash` diff: unchanged rows only advance `last_seen_at`; changed rows update the payload and the derived columns; new rows insert. A row that has **vanished from the source is marked, never deleted**: its `last_seen_at` stops advancing, the run counts it under `gone`, and the business and its history stay. Nothing retires a business on a source's absence alone — Overture drops and re-adds ids between releases.
- **D-06:** The run report is the success-criterion-1 artifact: per source, per run — `added / changed / unchanged / gone`, the source version ingested (Overture release string; Socrata `rowsUpdatedAt`), duration, and the confidence distribution (Overture). Persisted, not just printed, so `/sources` can show it.

**Cross-source matching rules**

- **D-07:** **Phone + locality + name agreement** is the trusted-identifier rule for ≥95. Exact E.164 phone AND same locality AND name similarity above a *lower* bar auto-merges. Exact phone + same locality with a **dissimilar name lands in the review queue**, not in a merge — RGV phone reuse (one cell number for a roofing business, a salon and a taquería; PITFALLS Pitfall 6) is real, and the requirement's "phone + same locality" is honoured in spirit while the mis-merge that would be invisible until a call is routed to a human. `place_id` as a trusted identifier is Phase 4's; nothing here references it.
- **D-08:** **Comptroller outlet addresses are batch-geocoded at ingest with the US Census batch geocoder** (`/geocoder/locations/addressbatch`, ≤10,000 addresses per file, no key, free — the same D-02 choice from Phase 2, now the batch endpoint). The result is a **provenance-tracked location** whose source is a new durable `source_key` (`census_geocoder`); an address the geocoder cannot match stays `NULL` and that record falls back to text matching. This is what makes the geo gate, distance scoring, the 25 km rule, and radius presets reach Comptroller-only businesses.
- **D-09:** Pair scoring is **weighted features summed to a 0–100 score, stored on the pair with its component vector**: name trigram similarity (`pg_trgm` over the normalized name), street number + ZIP agreement, distance between locations, category/cluster agreement, phone agreement when both sides carry one. **≥95 requires two independent signals plus the geo gate**; a single-signal match can never reach 95. The weights and the two thresholds (95, 80) live in **one committed module** with a **fixture of real RGV pairs** (pulled from the first ingest, anonymised only if needed) pinned by tests — re-tuning is a constant edit that a red test confronts, never a silent drift.
- **D-10:** **Never merge across > 25 km** is a hard rule regardless of score (Rio Grande Tire in Brownsville and Rio Grande City are different businesses). A pair with both locations known and >25 km apart is `distinct` by construction; a pair with one location unknown falls to the text-only path and cannot exceed the review band.
- **D-11:** **Chain detection is a flag, not a merge**: ≥3 places sharing a normalized name across Texas get a `chain_key` on each member. **Auto-merge skips flagged rows, the funnel skips them, the review queue shows the flag** when a flagged row lands there via another signal. Nothing is merged or deleted on the strength of a chain flag. What a chain is worth as a lead is Phase 6's call.
- **D-12:** Normalization is a pure, unit-tested module (DEDUP-04): NFD decompose → strip combining marks → lowercase → strip punctuation → strip legal suffixes (`llc|inc|co|ltd|corp|dba`) and a **bilingual stopword list** (`el la los las de del y and the`, plus generic trade words `taqueria carniceria panaderia`) → collapse whitespace; phone → E.164 `+1` + 10 digits, reject non-US and 555; address → leading street number + USPS-folded street + ZIP5, **suite/unit stripped from the match key but kept on the record**. The normalized form is **never displayed** — `display_name` stays verbatim from its source (an `ñ` on the card is the business's own name).

**Review queue & survivorship**

- **D-13:** One review item is a **side-by-side pair with signal chips**: both records in two columns (name, address, phone, category, source, `closed_at` if set, chain flag if set) and the scored signals rendered as chips — "phone exact", "name 0.81", "140 m apart", "same ZIP", "different cluster". On a phone the columns stack as two cards; the chips sit between them. **Actions: Same business · Different · Skip.** "Different" records a `distinct` decision that suppresses the pair from auto-merge forever; "Skip" leaves it pending and moves on.
- **D-14:** **Fixed survivorship rules, per field, applied identically to auto-merges and reviewed merges** — the review UI decides same/different only, never per-field winners:
  - `legal_name` ← Comptroller `outlet_name` (the state-filing string; never shown on a card)
  - `display_name` ← Overture `names.primary`; Comptroller `outlet_name` only when no Overture parent exists
  - `phone_e164` ← whichever parent has one; Overture preferred when both do
  - address and location ← Overture; Census-geocoded Comptroller as fallback
  - `closed_at` ← Comptroller `3kx8-uryv` only
  - Every surviving field records its source record (Phase 1's `*_source_id` pairs, extended to the new fields). Losing values are not discarded — they remain on the parent source records.
- **D-15:** The review queue is **phone-first in the existing responsive shell** (`src/app/(app)/layout.tsx`: stacked cards + sticky action bar in the thumb zone on a phone, two columns on the desk), consistent with MOB-01 and the Phase 2 UI-SPEC.
- **D-16:** The queue is **ordered highest score first**, shows a **remaining count** in its header, and reaches an **explicit "Queue clear" end state** — the same shape TRI-03 will need, so Phase 7 reuses the pattern rather than inventing a second one. Undo-toast on a review decision is Phase 7's pattern (TRI-02) and is **not** built here; unmerge (D-20) is the reversal path.

**Screens & provenance display**

- **D-17:** Phase 3 ships **three screens**: the review queue; **`/sources`** — one row per source (Comptroller permits, Comptroller closures, Overture, Census geocoder) with last run time, the version ingested, and the added / changed / unchanged / gone counts from D-06; and **`/businesses`** — a searchable list of the spine (name, city, cluster, sources present, status) with a **detail view** showing every field with its source, `closed_at`, the chain flag, the external key, the **merge history with parents**, and the unmerge action. Phase 7's card will reuse the detail. The shell nav gains the entries the UI pass places (the Phase 2 shell has Presets · Spend · Settings).
- **D-18:** Provenance renders as an **inline source tag on every field** of the detail view — "Comptroller", "Overture", "Census geocoder" — always visible, no tap. Tag style is the UI pass's; the information architecture is fixed here.
- **D-19:** The **external lead key (DEDUP-03) is a human-readable short key** — prefix + 5–6 Crockford base32 characters, e.g. `SL-7F3K2` — **unique per org**, assigned at business creation, shown on the detail view, and the key the BIS push (HAND-02) and CSV export (HAND-05) will use. **Merge: the winner keeps its key; the loser's key resolves to the winner** (an alias row, never a rewrite). **Unmerge restores the loser's key to the loser.** The row `id` (uuid) stays the internal PK; the external key is never the FK anywhere.
- **D-20:** **Unmerge lives on the detail view's merge history.** Each merge row has an Unmerge action that restores the loser to `active`, re-points its aliases and external key, restores the loser's surviving fields from its own source records, records actor + timestamp (Phase 1 events), and **marks the pair `distinct`** so it never auto-re-merges. Covers auto-merges and reviewed merges alike.

### Claude's Discretion

- **Schema shapes and names** for the new tables — research proposes `business_aliases`, `merge_candidates` (with `score`, `features jsonb`, `decision in ('pending','merged','distinct')`), `business_merges` (winner, loser, reason, merged_by, merged_at, undone_at), plus an ingest-runs table for D-06 and a `chain_key`/`closed_at`/`external_key`/location extension of `businesses`. Merges are rows, never deletes (ARCHITECTURE anti-pattern 9). Every new table: `org_id`, RLS, explicit grants in the same migration, a row in `TENANT_TABLES` (CONVENTIONS § Grants) — the schema-audit test fails otherwise.
- **`source_records` extensions** — `last_seen_at`, the source version (`release` / `rowsUpdatedAt`), the derived normalized columns (`name_norm`, `phone_e164`, `street_num`, `street_norm`, `postal`, `geohash6`) and the blocking indexes (GIN `gin_trgm_ops` on `name_norm`, btree on `phone_e164`, GiST on location). Whether the derived columns live on `source_records`, on `businesses`, or on a dedicated candidates table is the planner's; the blocker must never compare all pairs (STACK § (c): 49M pairs per pass at RGV scale).
- **Extending the `sr_source_key_known` CHECK** to add `census_geocoder` and a closures key (or reusing `tx_comptroller` with a dataset column) — a `db:custom` migration either way; the composite-FK "durable cites durable" invariant must be preserved and re-proven for every new provenance pair.
- **PostGIS vs pure SQL for distance** — the project constraint names PostGIS, prod Supabase ships it, but the local PostgreSQL 18 install has `pg_trgm` / `unaccent` / `fuzzystrmatch` only (PostGIS via Stack Builder was explicitly deferred to Phase 3) and CI's service is `postgres:18` (no PostGIS; `postgis/postgis` image would be needed). Planner picks: PostGIS with a `checkpoint:human-action` for the Stack Builder install and a CI image change, **or** `earthdistance`/haversine-in-SQL with a geohash6 blocking key and no new extension. Either must keep dev and CI byte-identical (Phase 1 D-05a).
- **The Overture `basic_category` → cluster mapping seed** — a committed JSON beside `clusters.json`, loaded by `scripts/seed.ts` as reference rows (org_id IS NULL, D-05 pattern), built from the live category distribution the ingest reports. Unmapped categories are reported, not guessed.
- **Overture release pinning** — the script takes the release string as an argument and records it on every row; the current release is `2026-08-19.0` and `2026-09-23.0` (the breaking release that removes `categories`) lands tomorrow. Build on `basic_category` only.
- **Texas-side proof (criterion 5)** — attribute filters (`region='TX' AND country='US'` on Overture; `outlet_county_code in ('031','108','214','245')` on Comptroller) are sufficient — no county polygons are loaded. The proof is a named test that runs a naive-bbox radius query and asserts zero rows with a Mexican locality, against a fixture that contains Reynosa / Matamoros / Río Bravo rows.
- **Ingest fixtures for CI** — CI never reaches Socrata, S3 or the Census geocoder: recorded payload slices (msw for HTTP; a committed small Parquet or the DuckDB output as JSON for Overture) drive the ingest tests. The real-data measurement (D-04, D-09 fixture) is a desk run whose numbers are committed.
- **How the ETL actor is identified** — `set_config('app.actor_id', 'etl:<script>', true)` per transaction, and which org the script targets (danlo's org by `clerk_org_id`, passed explicitly, never defaulted to "the only org").
- **Rate-limit and batching mechanics** — Socrata paging (`$limit`/`$offset`, an app token to avoid throttling), Census batch file size and retry, DuckDB memory for the RGV bbox.
- Which of the review queue / sources / businesses screens get e2e specs, and how their fixtures avoid the `preset-detail.spec.ts` trap (fixture seeded into the local db while the app under test is deployed) — self-skip unless local, or seed through the product.

### Deferred Ideas (OUT OF SCOPE)

- **Undo toast on a review decision** — TRI-02's pattern; Phase 7. Unmerge (D-20) is the Phase 3 reversal.
- **Bulk review actions / desk keyboard shortcuts** — TRI-06/TRI-07, v2.
- **Bilingual name-variant handling in the blocker** (Spanish/English word-order variants beyond the stopword list) — DEDUP-05, v2.
- **Suppression / do-not-contact seeded from `out_of_business_date`** — COMP-05, v2; this phase records `closed_at` only.
- **Service-area-business branch of the merge rules** (no geo gate when `pureServiceAreaBusiness` is true) — needs the Phase 4 flag; write the Comptroller no-location path so it can be reused.
- **In-app "Refresh sources" button** — not in this phase; if wanted later it wraps the Comptroller script's logic (fetch-only) in a Vercel Workflow, and Overture stays offline.
- **`presets.spec.ts` teardown / preset archive path** — owed from Phase 2 deferred-items; a Phase 3 or 4 plan should own it (a delete path is a product feature).
- **`.vercelignore` for `coverage/`** — Phase 2 follow-up, one-line change, first plan that touches deploy.
- **Overture attribution block** (Overture + providers, Foursquare notice, CDLA text on export) — the UI pass places it on `/sources`; the export copy is Phase 8's (COMP-03).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **DATA-01** | Ingest TX Comptroller active sales-tax permits (`jrea-zgmq`) for the target counties — DBA name, outlet address, NAICS, permit and out-of-business dates, per-field provenance | § Socrata Ingest Mechanics — live schema, **34,928** RGV rows in a single `$limit=50000` request (2.55 s), the `outlet_naics_code`-is-a-number trap already solved in `scripts/refresh-outlet-counts.ts`, and the `3kx8-uryv` join key verified against a real row |
| **DATA-02** | Ingest Overture places (`basic_category`, `names`, `addresses`, `websites[]`, `socials[]`, `phones[]`, `confidence`) for the target counties, Texas side only | § Overture via DuckDB — exact Parquet column types read from the live release, bbox range-read measured at **9.5 s**, `region='TX' AND country='US'` measured to keep **56,944** of 98,960 rows and drop **41,532** Mexican-side rows (42.0 %) |
| **DATA-03** | Comptroller + Overture form the durable canonical record; each field records its source | § Provenance Schema Extension — the four new `sr_source_key_known` values, the three new composite-FK provenance pairs, and the re-proof each one needs in `tests/db/retention.test.ts` |
| **DATA-04** | Ingest re-runnable and idempotent; a re-run updates changed rows and reports counts | § Idempotency and the Run Report — the `(source_key, external_id)` upsert, the `payload_hash` diff, `last_seen_at`, and how `gone` is computed without a delete; plus the 🔴 `businesses` `log_event` volume trap |
| **DEDUP-01** | Three tiers: ≥95 auto-merge on trusted identifiers, 80–95 review, <80 ignore | § Scoring, Thresholds and the Fixture — the weight table, the structural signal cap that makes "two signals + geo gate" the only path to 95, and the D-07 trusted-identifier rule as an explicit named rule |
| **DEDUP-02** | A merged lead retains all parents with per-field provenance; unmerge exists | § Merge, Survivorship and Unmerge — `merged_into_id` + `business_merges.winner_fields_before`, source records never re-pointed, unmerge restores by construction |
| **DEDUP-03** | A stable external lead key survives merges | § The External Lead Key — Crockford base32 collision arithmetic at RGV and Texas scale, the exact uniqueness constraint, and why it is never a FK |
| **DEDUP-04** | Names, addresses and phones normalized before matching (case, accents, suite noise, E.164) | § The Normalization Module — 🔴 `unaccent()` is **STABLE, not IMMUTABLE** (measured: `42P17` on both a generated column and an expression index), which settles "which side is authoritative" in favour of TypeScript |
</phase_requirements>

---

## Summary

**The architectural fork is settled by measurement, and the answer is: do not install PostGIS.** At RGV scale the geometry work this phase needs is (a) a 25 km hard gate applied to already-blocked candidate pairs and (b) a radius query for Phase 2's geo presets. Both were measured on the real data in the real local PostgreSQL 18.6 with a six-line pure-SQL haversine function: the 25 km gate over **332,738** candidate pairs runs in **303 ms**, and "every Overture place within 25 km of downtown McAllen" over **56,944** points runs in **52 ms** as a parallel sequential scan with no index at all. PostGIS would buy nothing measurable and would cost a 105 MB human-checkpoint install, a CI image change, and — decisively — **three different PostGIS versions across the three environments** (local PG18 would get 3.6.2, `postgis/postgis:18-3.6` would get 3.6.x, production Supabase PostgreSQL 17.6 offers only **3.3.7**, verified live). Phase 1 D-05a's "dev and CI byte-identical" is achievable on either path, but only Path B also keeps *production* identical. Path B needs `pg_trgm` and `unaccent` and nothing else; both are `pg_available_extensions` on all three environments and were successfully created locally during this research.

**The second finding is that the blocking problem is an order of magnitude worse than STACK.md records, and the fix is a specific SQL shape rather than a specific index.** All-pairs is **1,988,940,032** cross-source comparisons (34,928 × 56,944), not the 49 M STACK.md estimates — plus 1.62 billion intra-Overture. A naive `join … on a.zip5 = b.zip5 and a.name_norm % b.name_norm` looks like it uses the GIN trigram index and does not: the planner picks the ZIP btree and applies `%` as a post-index filter, which was **measured at 269.6 s** with 85 M similarity evaluations. Rewriting it as `cross join lateral (… where ov.name_norm % cm.name_norm order by ov.name_norm <-> cm.name_norm limit 5)` makes the GIN index the driver (3.3 ms per probe, verified by `EXPLAIN ANALYZE`) and completes the whole cross-source pass in **101.8 s**, producing **~30,000** candidate pairs — a 66,000× reduction. A `(zip5, street_num)` block is *not* safe on its own: one shopping-centre address (2200 in 78503) alone yields **57,568** pairs.

**The third finding is that real data breaks two of the phase's stated assumptions.** `3kx8-uryv` is not an "out-of-business dataset" — it is *All Permitted Sales Tax Locations*, 1,452,890 rows, whose `out_of_business_date` is one nullable column and whose county code is **unpadded** (`'31'`) while `jrea-zgmq`'s is **zero-padded** (`'031'`); querying it with the padded RGV codes silently returns 37,875 instead of 58,937 rows. And Overture `phones[]` is **not normalized**: 40,127 rows carry `+1…`, 6,403 carry a bare 10 digits, 2,581 a bare 11 and 2,263 something else — the *same* toll-free number appears in both forms — and one number is shared by **215** places, so a phone blocking key without a toll-free exclusion produces a 23,005-pair block from a single row. Excluding the toll-free NPAs drops the worst block from 215 to 32 and the phone-block pair count from 61,677 to 12,717.

**Primary recommendation:** Path B — no PostGIS, no `earthdistance`, no geohash column. Install `pg_trgm` + `unaccent` in one `db:custom` migration; write a pure-SQL `app.distance_m()`; block with (1) exact non-toll-free E.164 phone, (2) `(zip5, street_num)` gated by `similarity ≥ 0.3`, and (3) a GIN-driven `cross join lateral` trigram top-5 within ZIP; keep the derived match keys on `businesses` as **plain columns written by TypeScript**, because `unaccent()` is STABLE and Postgres refuses it in both a generated column and an index expression.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Socrata fetch + SoQL paging | Desk script (`tsx`) | — | D-01. Nothing in the app calls Socrata. `src/lib/socrata/` holds the pure client so unit tests can drive it with msw |
| Overture bbox range-read | Desk script (`tsx` + DuckDB) | — | Native binary, 10.4 GB remote dataset, ~1 GB peak RAM. STACK.md already forbids it inside a Vercel function |
| Census batch geocoding | Desk script (inside the Comptroller ingest) | — | 93 s per 3,000 addresses measured; ~18 min for 35k. Far past any function timeout |
| Normalization (name / phone / address) | **TypeScript (`src/lib/normalize/`)** | — | 🔴 Authoritative side. `unaccent()` is STABLE → cannot be a generated column or an index expression (measured `42P17` twice) |
| Blocking + candidate generation | Database (SQL) | Desk script orchestrates | Only the database has the GIN trigram index; 2 billion all-pairs must never reach the application tier |
| Pair scoring + banding | **TypeScript (`src/lib/resolve/score.ts`)** | Database supplies `similarity()` and `app.distance_m()` | D-09 requires one committed module with a pinned fixture; a pure function is unit-testable without a database |
| Merge / unmerge execution | Database (transaction, via the app or the script) | — | Must be atomic with the `events` write and the alias move |
| Run report persistence | Database (`ingest_runs`) | — | D-06: persisted, not printed, so `/sources` can render it |
| Review queue / `/sources` / `/businesses` | Frontend Server (RSC) | Database | `requireOrg()` + `withOrg()`; every list query is org-scoped and indexed |
| Review decision write | Server Action | Database | Phase 2's `useFormSubmit` pattern; `requireOrg()` first line |

---

## Standard Stack

### Core (already installed — do not re-decide)

| Library | Version | Purpose |
|---|---|---|
| `drizzle-orm` / `drizzle-kit` | `0.45.2` / `0.31.10` | Schema, RLS policies, migrations. **Single migration authority** |
| `postgres` (postgres.js) | `3.4.9` | Runtime driver, `prepare: false` |
| `pg` | `8.23.0` (dev) | Test + script connections |
| `zod` | `4.6.5` | Every external payload: Socrata rows, Census CSV lines, DuckDB rows |
| `tsx` | `4.23.15` | Both ingest scripts |
| `msw` | `2.15.0` (dev) | Recorded Socrata + Census payloads. CI never reaches the network |
| `vitest` / `@playwright/test` | `5.0.1` / `1.63.0` | Unit + DB + E2E |

### New in this phase

| Library | Version | Verified | Purpose | Notes |
|---|---|---|---|---|
| `@duckdb/node-api` | **`1.5.5-r.5`** | `npm view`, 2026-09-22 — published 2026-09-13, `dist-tags.latest` | Overture Parquet range-read | **devDependency only.** Native binary; never import from `src/`. `DuckDBInstance.create(':memory:', { threads:'4', memory_limit:'6GB' })` |
| `libphonenumber-js` | **`1.13.13`** | `npm view`, 2026-09-22 | Phone → E.164, region `US` | Required by the measured mess in Overture `phones[]` |
| `pg_trgm` (extension) | `1.6` | Created live on local PG 18.6; `pg_available_extensions` on prod PG 17.6 | Name similarity + GIN blocking index | `db:custom` migration |
| `unaccent` (extension) | `1.1` | Same | **Only** the `/businesses` free-text search predicate | 🔴 STABLE — never in an index, a generated column, or the match key |

**Deliberately NOT added**

| Rejected | Why |
|---|---|
| **PostGIS** | See § The Architectural Fork. Three divergent versions; nothing it buys is measurable at 92k rows |
| **`earthdistance` + `cube`** | A six-line `app.distance_m()` is identical everywhere and needs no `CREATE EXTENSION` in three environments. `earthdistance` was measured (142,503 m vs haversine's 142,343 m on the same pair — a 0.11 % difference from its 6,378,168 m earth radius) and is a fine fallback, not a need |
| **A geohash / `geo_cell` column** | Measured as a blocker: 4,172,644 pairs at 0.01° (worst cell 811) and 449,667 at 0.002° **before** 3×3 neighbour expansion. Every high-value pair it finds is already produced by the `(zip5, street_num)` block, and the pairs it adds uniquely are the "six different businesses at 1805 …" class that must not merge |
| `recharts` | The `/sources` confidence distribution is `Progress` + painted divs per 03-UI-SPEC § 2 |
| `splink` / `dedupe` / `addresser` | STACK.md § Alternatives: overkill below 100k with no labelled training set; the address field is short enough to own |

**Installation**

```bash
pnpm add -D @duckdb/node-api@1.5.5-r.5
pnpm add libphonenumber-js@1.13.13
```

---

## 🔴 The Architectural Fork — PostGIS vs no-PostGIS

**Recommendation: Path B. Do not install PostGIS in this phase.**

### What the environments actually hold (all three probed live, 2026-09-22)

| | Engine | PostGIS | `cube`/`earthdistance` | `pg_trgm` | `unaccent` |
|---|---|---|---|---|---|
| **Local (`TEST_DATABASE_URL`)** | PostgreSQL **18.6** on x86_64-windows (EDB) | ✗ not in `pg_available_extensions` (62 available, all contrib) | available `1.5` / `1.2` | available `1.6` | available `1.1` |
| **CI (`postgres:18` service)** | PostgreSQL 18 (Debian PGDG) | ✗ | inherited from `postgresql-18` contrib | same | same |
| **Production (Supabase `jahgeqshuesndyscnmjo`)** | PostgreSQL **17.6** | available **`3.3.7`**, not installed | available `1.5` / `1.2` | available `1.6` | available |

🔴 **Installed extensions on the local test database today: `plpgsql` only.** CONTEXT.md's "has `pg_trgm` / `unaccent` / `fuzzystrmatch`" means *available*, not *installed* — Phase 3 must add a `CREATE EXTENSION` migration whichever path is chosen.

### Path A — PostGIS (what it would actually take)

Both prerequisites exist, so Path A is not blocked, only expensive:

- **Windows build for PG 18 exists.** `https://download.osgeo.org/postgis/windows/pg18/postgis-bundle-pg18x64-setup-3.6.2-1.exe` — **104,764,772 bytes, Last-Modified 2026-03-16** (verified by `HEAD` request). A `postgis-bundle-pg18-3.6.2x64.zip` sits beside it. This is the Stack Builder payload. A `checkpoint: human-action` task would read: *"Run the PostGIS 3.6.2 bundle installer for PostgreSQL 18 (Stack Builder → Spatial Extensions, or the standalone .exe). Then `psql -d siteless_test -c 'create extension postgis'` and paste the `postgis_full_version()` output."*
- **CI image exists.** `postgis/postgis:18-3.6` (Docker Hub, updated 2026-08-31). Also `18-3.6-alpine` and `18-master`. The `db` job's `image: postgres:18` becomes `image: postgis/postgis:18-3.6`; nothing else in the job changes.

**What kills it:**

1. **Production is on PostgreSQL 17.6 and Supabase offers PostGIS 3.3.7 there.** Local would be 3.6.2, CI 3.6.x, prod 3.3.7. Three versions of a large C extension in the SQL path is precisely the drift Phase 1 D-05a exists to prevent — and unlike the engine-version skew (PG18 local / PG17 prod, already accepted and guarded by `tests/unit/pg17-compat.test.ts`), this one sits *inside the dedupe predicates*.
2. **It buys nothing measurable.** See the numbers below.
3. It adds a 105 MB human checkpoint on danlo's critical path for a phase that already carries one desk-run gate.

### Path B — pure SQL (recommended), with the numbers

One `IMMUTABLE` SQL function, no extension:

```sql
create or replace function app.distance_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision)
returns double precision language sql immutable parallel safe as $fn$
  select 6371000.0 * 2 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2-lon1)/2), 2)))
$fn$;
```

Measured on the real 56,944-row Overture slice and the real 34,928-row Comptroller slice, local PostgreSQL 18.6:

| Operation | Shape | Measured |
|---|---|---|
| **The 25 km hard rule (D-10)** over every `(zip5, street_num)` candidate pair | `where app.distance_m(a.lat,a.lon,b.lat,b.lon) <= 25000` over 332,738 pairs | **303 ms** |
| **Radius preset** — every place within 25 km of downtown McAllen | full parallel seq scan, **no index** | **52 ms** (2 workers, 2,994 shared buffers) |
| Same with an explicit lat/lon bbox prefilter | planner still seq-scans | 58–62 ms — the prefilter is **not** worth adding |
| Correctness spot-checks | Brownsville ↔ Rio Grande City | 142,343 m (`earthdistance`: 142,503 m) |
| | McAllen ↔ Edinburg | 12,795 m |
| | identical point | 0 m |

**Growth headroom.** A statewide spine is 887,244 Comptroller outlets; the same seq scan scales to ~800 ms, at which point a btree on `(org_id, lat)` plus a latitude-band prefilter restores it. That is a one-index change in a later phase, not an architecture change.

**Distance as a scored feature (D-09)** and **the geo gate** both read `app.distance_m()` on an already-blocked pair — never a search. **Radius presets from Phase 2** read it as the 52 ms scan above. **The blocking strategy** does not use geometry at all (see next section).

**Whichever path: dev, CI and prod must end byte-identical.** Path B's guarantee is a `tests/db` assertion, not a claim:

```sql
-- tests/db/extensions.test.ts
select extname, extversion from pg_extension where extname in ('pg_trgm','unaccent') order by 1;
-- must be exactly [{pg_trgm,1.6},{unaccent,1.1}] and the test must name the versions
```

and the first CI run after the `CREATE EXTENSION` migration is the proof that the `postgres:18` image carries contrib. If it does not — the one unverified link in this chain — the fallback is already in hand: drop `unaccent` (it is used in exactly one search predicate) and, for `pg_trgm`, fall back to `(zip5, left(name_norm,4))` btree blocking, measured at 115,358 pairs with a worst block of 4,165. **This is an intentionally cheap failure.**

---

## Blocking Strategy at Real Scale

### The number blocking has to avoid

| | Rows | All-pairs |
|---|---|---|
| Comptroller RGV (`jrea-zgmq`, 4 counties) | **34,928** | 609,962,128 intra |
| Overture RGV (TX/US, naive bbox) | **56,944** | 1,621,281,096 intra |
| **Cross-source** | | **1,988,940,032** |

🔴 **STACK.md § (c)'s "49 M comparisons" is 40× low.** The planner should quote 2.0 billion cross-source.

### 🔴 The trap that wastes a day: the obvious join does not use the GIN index

```sql
-- NEVER WRITE THIS. Measured: 269,647 ms.
select … from ov join cm on ov.zip5 = cm.zip5 and ov.name_norm % cm.name_norm;
```

`EXPLAIN (ANALYZE, BUFFERS)` on the real data:

```
Nested Loop (actual time=33.118..269577.848 rows=7242.50 loops=2)
  ->  Parallel Seq Scan on cm  (rows=17464 loops=2)
  ->  Index Scan using ov_zip on ov  (actual time=12.676..15.432 rows=0.41 loops=34928)
        Index Cond: (zip5 = cm.zip5)
        Filter: (name_norm % cm.name_norm)     <-- the GIN index is NOT used
        Rows Removed by Filter: 2441
        Index Searches: 34928
```

85 million `similarity()` evaluations. The GIN trigram index cannot be the driver when the probe value is a correlated column of the outer relation.

### The shape that works

```sql
-- Candidate generation, cross-source. Measured: 101,807 ms for the full pass,
-- 79,797 pairs. Per-probe cost 3.3 ms, confirmed by EXPLAIN on a single probe.
select c.id as comptroller_id, k.id as overture_id, k.sim
from businesses c
cross join lateral (
  select o.id, similarity(o.name_norm, c.name_norm) as sim
  from businesses o
  where o.org_id = c.org_id
    and o.primary_source = 'overture'
    and o.name_norm % c.name_norm          -- GIN bitmap index scan, 43 buffers
  order by o.name_norm <-> c.name_norm     -- top-N heapsort over ~21 rows
  limit 5
) k
where c.primary_source = 'tx_comptroller' and c.name_norm is not null;
```

Single-probe plan (verified):

```
Limit (actual time=3.244..3.246 rows=5 loops=1)
  ->  Sort  (Sort Key: name_norm <-> 'taqueria jalisco', top-N heapsort, 25kB)
        ->  Bitmap Heap Scan on ov (rows=21)
              ->  Bitmap Index Scan on ov_name_trgm (rows=417)   <-- GIN, 43 buffers
Execution Time: 3.270 ms
```

### Measured blocking-key comparison

| # | Key | Candidate pairs | Worst single block | Build / run time | Verdict |
|---|---|---|---|---|---|
| **B1** | exact `phone_e164`, **toll-free NPAs excluded** | **12,717** (intra-Overture) | **32** | 38 ms | ✅ Use. Without the exclusion: 61,677 pairs, worst block **215** |
| **B2** | `(zip5, street_num)` exact | 332,738 | **57,568** (78503 / 2200) | 162 ms | ❌ Alone. ✅ gated |
| **B2′** | `(zip5, street_num)` **AND `similarity ≥ 0.3`** | **14,357** | bounded | 1,743 ms | ✅ Use |
| **B3** | GIN lateral trigram top-5, within `zip5` | ≤ 5 per left row | 5 by construction | ~70 s | ✅ Use (primary) |
| B4 | `(zip5, left(name_norm,4))` btree | 115,358 | 4,165 | 65 ms | ⚠ Fallback if `pg_trgm` is unavailable |
| B5 | `(zip5, soundex(first token))` | 597,063 | **65,658** | 110 ms | ❌ Reject — worse than B2 |
| B6 | grid cell 0.01° (~1.1 km) | 4,172,644 | 811 | 22 ms | ❌ Reject as a blocker |
| B7 | grid cell 0.002° (~220 m) | 449,667 | 136 | 67 ms | ❌ Reject — and this is *before* 3×3 neighbour expansion (×9) |

**Union of B1 ∪ B2′ ∪ B3 = 29,701 distinct cross-source candidate pairs** (measured, 70.5 s). Against 1.99 billion all-pairs that is a **66,970× reduction**, and the whole pass is a ~2-minute desk run.

**Every block needs a size cap.** B2's 57,568-pair block is a shopping centre. Emit `block_key`, `block_size` on each candidate and **refuse to expand a block above 500 pairs**, recording the skip in the run report — a silently truncated block is how a whole mall disappears from the spine.

### Where the derived columns live — recommendation: on `businesses`

| Option | Verdict |
|---|---|
| On `source_records` | ✅ for `last_seen_at` / `source_version` / the **raw** per-source derived values (the provenance of record). ❌ as the blocker's home |
| **On `businesses`** | ✅ **The blocker's home.** Recommended |
| On a dedicated candidates table | ✅ for the *pair*, its `score` and its `features jsonb`. ❌ for the keys |

**Defence.** (1) The ingest creates exactly one `businesses` row per source record (idempotent by external id), so the blocker has a single relation to scan rather than a union. (2) A candidate must be **re-scorable after a merge** changes a business's surviving fields — scoring source records would make every merge invalidate its own inputs. (3) `source_records` also holds Phase 5's `http_probe` / `dns_probe` rows, for which nine name/address columns are permanently NULL. (4) A `businesses`-side index is the same index the `/businesses` search needs.

**Indexes on `businesses`** (all in the creating migration, per CONVENTIONS § Tenancy):

```sql
create index businesses_name_trgm on businesses using gin (name_norm gin_trgm_ops);            -- 367 ms to build on 57k rows
create index businesses_phone_idx on businesses (org_id, phone_e164) where phone_e164 is not null;
create index businesses_addr_idx  on businesses (org_id, postal, street_num) where postal is not null;
create index businesses_chain_idx on businesses (org_id, chain_key)  where chain_key is not null;
create index businesses_merged_idx on businesses (org_id, merged_into_id) where merged_into_id is not null;
create unique index businesses_external_key_uniq on businesses (org_id, external_key);
```

> The GIN index cannot carry `org_id` without `btree_gin` (available on both local and prod, **not installed**). v1 is one org; the LATERAL still filters `o.org_id = c.org_id` and the recheck is free. Adding `btree_gin` is the multi-org upgrade, not this phase's work.

---

## Socrata Ingest Mechanics

### 🔴 `3kx8-uryv` is not what its nickname says

Queried live, 2026-09-22:

| | `jrea-zgmq` | `3kx8-uryv` |
|---|---|---|
| Title | Active Sales Tax Permit Holders | **All Permitted Sales Tax Locations and Local Sales Tax Responsibility** |
| Total rows | 887k-class | **1,452,890** |
| `rowsUpdatedAt` | 1789805121 → **2026-09-19T08:05:21Z** | 1790005715 → **2026-09-21T15:48:35Z** |
| Taxpayer id | `taxpayer_number` | **`tp_number`** |
| Outlet id | `outlet_number` | **`loc_number`** |
| Name | `outlet_name` | **`loc_name`** |
| Address | `outlet_address` (combined) | **`address_number` + `address_text`** (split) |
| City / ZIP | `outlet_city` / `outlet_zip_code` | `loc_city` / `loc_zip` (+ `loc_zip4`) |
| County code | `outlet_county_code` — **zero-padded `'031'`** | `loc_county` — **UNPADDED `'31'`** |
| NAICS | `outlet_naics_code` — **Socrata `number`** | `naics` — **Socrata `text`** |
| Closure | — | **`out_of_business_date` (`calendar_date`, nullable)** |

🔴 **The county-code padding trap, measured.** `loc_county = '031'` returns **0 rows**; `loc_county = '31'` returns **21,062**. Querying `3kx8-uryv` with the same padded RGV list `jrea-zgmq` uses returns **37,875** rows instead of **58,937** — a silent 36 % loss that looks like a plausible number.

| Filter | `jrea-zgmq` | `3kx8-uryv` |
|---|---|---|
| RGV, padded `('031','108','214','245')` | **34,928** ✅ | 37,875 ❌ |
| RGV, unpadded `('31','108','214','245')` | — | **58,937** ✅ |
| RGV **and `out_of_business_date IS NOT NULL`** | — | **21,509** ← the closure feed |

**Join key verified on a real RGV row.** `jrea-zgmq` `(taxpayer_number='32006170057', outlet_number='5')` resolves in `3kx8-uryv` to `(tp_number='32006170057', loc_number='5')` — the same business ("PATTI ZIMMY HAIR REPLACEMENT SPECIALIST", 2426 E TYLER AVE STE 1C, Harlingen). **Exact string equality on both parts; no padding, no casting.** A `group by tp_number, loc_number having count(1) > 1` over Starr County returned **zero rows**, so the pair is a key at least within a county.

**Recommendation for D-03:** fetch only `loc_county in ('31','108','214','245') AND out_of_business_date IS NOT NULL` — **21,509 rows**, one request — and write a `closed_at` provenance pair on the business whose `(taxpayer_number, outlet_number)` matches exactly. Do not ingest the other 1.4 M rows.

### Paging, limits and app tokens — measured

| Probe | Result |
|---|---|
| `$limit=50000` + `$where` RGV + `$order=taxpayer_number,outlet_number` | HTTP 200, **34,928 rows in 2,550 ms**. One request covers the entire phase |
| `$limit=50001` | HTTP 200, no error, same row count (the ceiling is not enforced as a 400 at this volume) |
| `$offset=0 / 10000 / 30000` at `$limit=1000` | 242 / 347 / **440 ms** — no deep-offset cliff |
| Rate-limit headers | **none** (`x-socrata-region`, `x-socrata-requestid` only). 15+ unauthenticated requests in this session, zero throttling |
| `Last-Modified` header on the data request | `Sat, 19 Sep 2026 08:05:19 GMT` — matches `rowsUpdatedAt` |
| `X-SODA2-Data-Out-Of-Date` | `false` |

**App token:** not required. `dev.socrata.com/docs/app-tokens.html` — unauthenticated requests are throttled by IP; a token grants the app its own pool and is sent as the **`X-App-Token` header** (preferred) or `$$app_token`. **Recommendation:** read an optional `SOCRATA_APP_TOKEN` from `src/env.ts` and set the header only when present; at 3 requests per ingest run a token is unnecessary, and making it required would add a credential the project does not have.

**Recommendation for paging:** `$limit=50000` + `$order=taxpayer_number,outlet_number` + `$offset` loop, stopping when a page returns fewer than `$limit` rows. Keyset paging is unnecessary — `$offset=30000` costs 440 ms — but `$order` is mandatory: without it Socrata gives no stability guarantee across pages.

### Use the source version from the metadata endpoint

```
GET https://data.texas.gov/api/views/jrea-zgmq.json  ->  .rowsUpdatedAt (epoch seconds)
```

Record `new Date(rowsUpdatedAt * 1000).toISOString()` on `ingest_runs.source_version` and on every `source_records.source_version`. The `Last-Modified` response header on the data request is the same instant and can serve as a cross-check.

### What `scripts/refresh-outlet-counts.ts` already solves — lift it, do not rewrite it

Move these into `src/lib/socrata/` and have **both** the refresh script and the ingest import them:

| Existing helper | What it encodes |
|---|---|
| `quote(s)` | Socrata single-quoted literals, `'` doubled |
| `comptrollerCode(n)` | `String(n).padStart(3,'0')` — 🔴 correct for `jrea-zgmq`, **wrong for `3kx8-uryv`**; the lifted module needs a second, unpadded variant |
| `naicsPredicate(ranges)` | Half-open `>= lo and < hi` numeric ranges |
| the `000` sentinel note | `outlet_county_code between '001' and '254'` for statewide figures |
| the `outlet_naics_code` is-a-`number` warning | `starts_with()` → HTTP 400 `query.soql.type-mismatch`. The file is grepped for the absence of that prefix function — **the lifted module inherits that grep** |
| error body echo | Prints the SoQL error rather than "request failed" |

🔴 The ingest also needs **row-level** fetching, which the counts script never does. Wrap every row in a `zod` schema and treat `outlet_naics_code` as `z.coerce.string()` — the JSON payload returns it as a *string* (`"561311"`) although the column type is `number`.

---

## Overture via DuckDB

### Release string — verified against the bucket, and it changes tomorrow

```
GET https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&delimiter=/&prefix=release/
  ->  CommonPrefixes: release/2026-08-19.0/     (KeyCount 1, IsTruncated false)
```

🔴 **The bucket holds exactly one release.** `2026-08-19.0` is current, and it is the *only* release present. When `2026-09-23.0` lands (tomorrow), `2026-08-19.0` will in all likelihood disappear. Two consequences the planner must build for:

1. **A pinned release string is not a reproducibility guarantee.** Record it on every row (D-05 / D-06), but the *only* durable copy of the data is the one in our own database and the committed CI fixture.
2. **Ingest before the release turns over, or accept `2026-09-23.0`.** `categories` is removed in the September 2026 release ([docs.overturemaps.org](https://docs.overturemaps.org/guides/places/taxonomy/): the property "has been deprecated and will be removed in the September 2026 release, replaced by the new `basic_category` and `taxonomy` properties"). Building on `basic_category` only — as the roadmap and D-04 require — makes the script release-agnostic.

Theme layout verified: `release/2026-08-19.0/theme=places/type=place/` holds **16 zstd Parquet parts, ~617–705 MB each ≈ 10.4 GB**.

### Exact path form and the bbox range-read

```ts
const PATH = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;

const instance = await DuckDBInstance.create(':memory:', { threads: '4', memory_limit: '6GB' });
const c = await instance.connect();
await c.run(`install httpfs; load httpfs;`);
await c.run(`install spatial; load spatial;`);   // only for ST_X / ST_Y
await c.run(`set s3_region='us-west-2';`);

await c.run(`
  create table rgv as
  select
    id,                                    -- GERS id: a bare UUID string, e.g. 'e2d3a704-983c-4349-967d-9f6403722ccc'
    names.primary            as name_primary,
    basic_category,                        -- VARCHAR, never `categories`
    taxonomy.primary         as taxonomy_primary,
    confidence,                            -- DOUBLE, 0..1
    operating_status,                      -- 'open' | 'permanently_closed' | NULL
    coalesce(websites, [])   as websites,  -- VARCHAR[]
    coalesce(socials,  [])   as socials,   -- VARCHAR[]
    coalesce(phones,   [])   as phones,    -- VARCHAR[]  🔴 NOT normalized
    coalesce(emails,   [])   as emails,    -- VARCHAR[]
    addresses[1].freeform    as street,    -- addresses is a STRUCT[] — take [1]
    addresses[1].locality    as locality,
    addresses[1].postcode    as postcode,
    addresses[1].region      as region,
    addresses[1].country     as country,
    ST_X(geometry)           as lon,       -- the STORED coordinate
    ST_Y(geometry)           as lat,
    version
  from read_parquet('${PATH}', hive_partitioning=1)
  where bbox.xmin between ${xmin} and ${xmax}   -- 🔴 the PUSHDOWN predicate
    and bbox.ymin between ${ymin} and ${ymax}
`);
```

**Verified Parquet schema (`describe`, read from the live release):**

| Column | DuckDB type |
|---|---|
| `id` | `VARCHAR` |
| `geometry` | `GEOMETRY('OGC:CRS84')` |
| `categories` | `STRUCT("primary" VARCHAR, alternate VARCHAR[])` — **removed in 2026-09-23.0, do not read** |
| `basic_category` | `VARCHAR` |
| `taxonomy` | `STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[])` |
| `confidence` | `DOUBLE` |
| `operating_status` | `VARCHAR` |
| `websites` / `socials` / `phones` / `emails` | `VARCHAR[]` |
| `addresses` | `STRUCT(freeform VARCHAR, locality VARCHAR, postcode VARCHAR, region VARCHAR, country VARCHAR)[]` |
| `names` | `STRUCT("primary" VARCHAR, common MAP(VARCHAR,VARCHAR), rules STRUCT(...)[])` |
| `brand` | `STRUCT(wikidata VARCHAR, "names" STRUCT(...))` |
| `sources` | `STRUCT(property, dataset, license, record_id, update_time, confidence, "between", provider, resource, "version")[]` |
| `bbox` | `STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE)` |
| `version` | `INTEGER` |
| `theme` / `type` | `VARCHAR` |

🔴 **`bbox` is float32-rounded and is NOT the point.** Measured over all 98,960 bbox rows: **98,834 differ** from `ST_X/ST_Y(geometry)`, max Δlon `1.53e-5°` (≈ 1.7 m) and max Δlat `3.81e-6°` (≈ 0.42 m). **Use `bbox.*` only as the pruning predicate; store `ST_X/ST_Y(geometry)`.** A 1.7 m error is irrelevant to a 25 km gate and visible in a "12 m apart" chip.

🔴 **DuckDB's node-api returns `VARCHAR[]` as `{ items: [...] }`, not a bare JS array.** `row.phones.items[0]`, not `row.phones[0]`. This will silently produce `undefined` phones for every row if missed.

**Performance, measured on this machine (`threads: '4'`, `memory_limit: '6GB'`, Wi-Fi):**

| | |
|---|---|
| `describe` over the 10.4 GB dataset | 1,259 ms |
| Full RGV bbox materialisation, 98,960 rows, 19 columns | **9.5–9.7 s**, run twice |
| Every subsequent aggregate over the materialised table | 0–100 ms |

`threads: '4'` / `memory_limit: '6GB'` is comfortable; the bbox predicate prunes 10.4 GB to a handful of row groups. Do not raise `threads` past the physical core count — S3 range reads are the bottleneck, not CPU.

### The Texas-side filter, measured (this is criterion 5's evidence)

Naive RGV bbox `lon ∈ [-99.30, -97.10], lat ∈ [25.80, 26.75]` → **98,960 rows**.

| `country` / `region` | Rows |
|---|---|
| **`US` / `TX`** | **56,944** (57.5 %) |
| `MX` / `NULL` | 40,106 |
| `MX` / `Tamaulipas` | 1,071 |
| `MX` / `Campeche` | 267 |
| `MX` / `TAM` | 249 |
| `MX` / `''`, `NLE`, `TAMAULIPAS`, `CMX`, `TX`, `Sinaloa` | 109 |
| `US` / `NULL` or `''` | **180** |
| `US` / `CA`, `FL`, … | 6 |
| **Mexican-side total** | **41,532 = 42.0 %** |

**DATA-SOURCES.md's "42 % Mexico" is confirmed to the decimal.**

- `region = 'TX' AND country = 'US'` admits **zero** Mexican rows. The 3 rows carrying `country='MX' AND region='TX'` are excluded by the country half — 🔴 **a region-only filter would let them through**, so both halves are load-bearing.
- It **drops 180 genuine US rows** whose `region` is NULL or `''` — mostly county-level entries ("Hidalgo County" ×18, "Cameron County" ×16, "Willacy County" ×9, "Starr County" ×7) plus a handful of real city rows (Brownsville ×12, McAllen ×6, La Joya ×5, Progreso Lakes ×4). **0.3 % loss, and it is the right trade**: none of them is a lead-bearing storefront and admitting them would require re-admitting the 40,106 `region IS NULL` Mexican rows.
- **ZIP leakage is negligible.** 55,196 of 56,944 TX/US rows carry a `785xx` postcode; the next-largest prefixes are `787` (10), `780` (6), `782` (6). 1,559 have no postcode, 62 have `''`, and a few carry junk (`"<<n"`, `"TX "`). **No county polygons are needed** — the bbox plus the attribute filter is the county scope, exactly as CONTEXT.md holds.

**Mexican-side fixture material for the criterion-5 test** (real localities in the naive bbox): Reynosa **20,295** · Matamoros **15,009** · Río Bravo **3,317** · Heroica Matamoros 844 · Ciudad Miguel Alemán 565 · Gustavo Díaz Ordaz 309 · Miguel Alemán 267 · Ciudad Camargo 154 · Camargo 149 · Mier 106 · Municipio de Reynosa 96 · Rio Bravo 54 · Guerrero 51.

### The D-04 measurement, already answered

**Confidence distribution, TX/US, `2026-08-19.0`:**

| Band | Rows | Share |
|---|---|---|
| 0.0–0.1 | 292 | 0.5 % |
| 0.1–0.2 | 537 | 0.9 % |
| 0.2–0.3 | 1,851 | 3.3 % |
| 0.3–0.4 | 1,982 | 3.5 % |
| 0.4–0.5 | 1,501 | 2.6 % |
| 0.5–0.6 | 3,075 | 5.4 % |
| 0.6–0.7 | 3,298 | 5.8 % |
| 0.7–0.8 | 3,973 | 7.0 % |
| 0.8–0.9 | 4,920 | 8.6 % |
| 0.9–1.0 | 35,270 | 61.9 % |
| = 1.0 | 245 | 0.4 % |

**Fill rates, TX/US (n = 56,944):** name 100 % · phone **90.2 %** (51,374) · website **66.3 %** (37,755) · social **76.8 %** (43,731) · email 38.6 % · street 97.3 % · postcode 97.3 % · `basic_category` 97.9 % (1,223 NULL) · `taxonomy` 97.2 %.

**`operating_status`:** `open` 37,712 · NULL 18,369 · **`permanently_closed` 863**. This is a *second* closure signal Overture supplies for free. It is not in D-03 (which names `3kx8-uryv` only) — **flag it for the planner as a candidate for `source_records` storage now and a Phase 6 decision later**, but do not write `closed_at` from it.

**Internal duplicate rate (the roadmap's research flag):** grouping TX/US rows by `(lower(name), postcode)` gives **1,720 groups covering 5,243 rows — 9.2 % of the slice sits in a same-name-same-ZIP group.** Much of that is chains (see below), which is exactly why D-11 flags rather than merges.

**`basic_category`:** **244 distinct values** in TX/US. That is the size of the committed mapping seed. Top values: `restaurant` 4,556 · `financial_service` 2,950 · `personal_or_beauty_service` 2,857 · `automotive_service` 2,328 · `home_service` 1,869 · `fashion_and_apparel_store` 1,617 · `christian_place_of_worship` 1,533 · `food_and_beverage_store` 1,272 · `real_estate_service` 1,247 · **NULL 1,223** · `health_care` 1,026 · `wellness_service` 1,024 · `casual_eatery` 1,022 · `hardware_home_and_garden_store` 1,016 · `auto_dealer` 977 · `convenience_store` 910. The mapping seed should cover at least the top 60 (≈ 80 % of rows) and report the unmapped tail rather than guessing.

### 🔴 Overture `phones[]` is raw, and that is a blocking hazard

| Form | Rows |
|---|---|
| `+1…` E.164 | **40,127** |
| bare 10 digits | 6,403 |
| bare 11 digits | 2,581 |
| **other** (extensions, international, junk) | **2,263** |

The same toll-free number appears as `8004879643` (170 rows) *and* `+18004879643` (45 rows). After normalising to 10 digits:

| | |
|---|---|
| Distinct numbers | 37,577 unique · 5,084 shared by 2–4 · **233 shared by 5+** |
| **Worst number** | shared by **215 places** → 23,005 pairs from one block |
| Pairs from the phone block, all NPAs | 61,677 |
| **Pairs with toll-free NPAs excluded** | **12,717**, worst block **32** |
| Top NPAs | 956 (48,604 — the RGV area code) · **800 (781)** · **866 (279)** · 210 (152) · **888 (146)** · **877 (110)** · **833 (78)** · **844 (57)** · **855 (56)** |

**Rule:** exclude NPAs `800, 833, 844, 855, 866, 877, 888` from the phone blocking key *and* from the D-07 trusted-identifier rule. A toll-free number is a franchise switchboard, not an identity.

### How CI avoids ever touching S3 — recommendation

**Freeze the DuckDB output as JSON, not a Parquet file.**

- `tests/unit/fixtures/overture-rgv-sample.json` — ~200 rows selected to cover every branch: a TX/US row with all fields; a row with NULL `basic_category`; a `permanently_closed` row; a row with no phone; rows with each of the four phone forms; a row with a junk postcode; and **Reynosa, Matamoros and Río Bravo rows** for the criterion-5 test.
- The ingest's transform is a pure function `overtureRowToSourceRecord(row)`; the script calls DuckDB and feeds it, the test feeds it the fixture. **DuckDB never appears in the test's import graph** — no native binary in CI, no 10 MB fixture, no Parquet reader version coupling.
- A committed Parquet would re-introduce exactly the coupling the fixture exists to remove, and `@duckdb/node-api` would have to install in CI.
- Provenance on the fixture: a header comment naming the release string (`2026-08-19.0`), the bbox and the date it was cut.

---

## The Census Batch Geocoder (D-08)

Probed live against `geocoding.geo.census.gov`, 2026-09-22, with real RGV Comptroller addresses. No API key at any point.

### Request shape

```ts
const fd = new FormData();
fd.set('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv');
fd.set('benchmark', 'Public_AR_Current');
// fd.set('vintage', 'Current_Current');   // REQUIRED only for returntype=geographies
await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch',
            { method: 'POST', body: fd });
```

**Input CSV — no header row, five columns in this exact order:**

```
Unique ID, Street address, City, State, ZIP
1,"2426 E TYLER AVE",HARLINGEN,TX,78550
```

Fields containing a comma **must** be quoted; the Comptroller's `outlet_address` regularly contains none, but `loc_name`-style strings do. Documented ceiling: **10,000 rows per file** ([geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)).

### Response shape — `text/plain`, quoted CSV, **ragged**

```
"1","2426 E TYLER AVE, HARLINGEN, TX, 78550","Match","Exact","2426 E TYLER AVE, HARLINGEN, TX, 78550","-97.672649743751,26.189604634647","658325383","R"
"3","100 E CANO ST, EDINBURG, TX, 78539","Match","Non_Exact","100 W CANO ST, EDINBURG, TX, 78539","-98.162702070658,26.300352263624","71496225","L"
"639","2410 EAST EXPRESSWAY 84, MISSION, TX, 78572","Tie"
"4","PO BOX 764, POTH, TX, 78147","No_Match"
```

| Position | `locations` | `geographies` (adds 4) |
|---|---|---|
| 1 | Unique ID | same |
| 2 | input address, echoed | same |
| 3 | `Match` / `No_Match` / `Tie` | same |
| 4 | `Exact` / `Non_Exact` | same |
| 5 | `matchedAddress` | same |
| 6 | **`"longitude,latitude"`** | same |
| 7 | TIGER line id | same |
| 8 | side (`L`/`R`) | same |
| 9–12 | — | STATE FIPS, COUNTY FIPS, TRACT, BLOCK |

🔴 **Axis order confirmed for the batch endpoint: LONGITUDE FIRST.** `"-97.672649743751,26.189604634647"` for Harlingen. This matches `src/lib/geocode/census.ts`'s `x = longitude, y = latitude` pin for the oneline endpoint. `const [lng, lat] = field6.split(',').map(Number)`.

🔴 **A `No_Match` row has 4 fields and a `Tie` row has 3.** A parser that indexes position 6 unconditionally reads `undefined`; a parser that asserts a column count throws on ~29 % of rows.

🔴 **Result order is NOT input order.** Measured at n=1,000 and n=3,000 — the 3,000-row response began `"1462", "2793", "1461"`. **Rejoin on the ID column; never zip by position.**

### Measured match quality and latency, on 4,000 real RGV Comptroller addresses

| n | Wall clock | Match | Exact | Non_Exact | Tie | No_Match | Match rate |
|---|---|---|---|---|---|---|---|
| 8 (hand-built) | 488 ms | 4 | 2 | 2 | 0 | 4 | — |
| **1,000** | **26,330 ms** | 708 | 487 | 221 | 6 | 286 | **70.8 %** |
| **3,000** | **93,270 ms** | 2,127 | 1,473 | 654 | 12 | 861 | **70.9 %** |

Throughput ≈ **32 addresses/s**, and it is linear. `geographies/addressbatch` for the same 8 rows took **4,448 ms vs 488 ms** — ~9× slower.

**Consequences for the plan:**

- **~29 % of Comptroller outlets will have NO location.** D-08 already provides for this ("stays `NULL` and that record falls back to text matching"), but the planner must size it: ≈ **10,100 of 34,928** RGV outlets are text-only, and D-10 caps every one of their pairs at the review band. The review queue will therefore be dominated by unlocated Comptroller rows, and `/sources` should report the geocoder's `matched / non_exact / tie / no_match` counts as its own run row (D-17 already gives it one).
- **Chunk at 1,000, not 10,000.** 10,000 rows in one file is ≈ **5.2 minutes** of a single held-open HTTP request. 1,000 rows ≈ 26 s. Run 2–3 chunks concurrently with `p-limit` → 35k in ~6–8 min.
- **Retry policy:** the service returns `200` for everything including total failure, so retry on transport error, non-200, or a response whose line count ≠ the request's row count. Exponential backoff 2 s / 8 s / 30 s, 3 attempts, then record the chunk as failed in the run report and leave those rows unlocated. No budget is at stake — it is free.
- 🔴 **`Non_Exact` can flip a direction.** `100 E CANO ST` matched `100 W CANO ST`; `500 N CLOSNER BLVD` matched `500 S CLOSNER BLVD`; `717 N 77 SUNSHINESTRIP` matched `717 S 77 SUNSHINE STRIP`. **Store the match type** and treat `Non_Exact` as location-only evidence: it may feed the distance feature but must never be promoted to the `address_exact` signal.
- **Use `locations/addressbatch`, not `geographies`.** The county FIPS is already known from `outlet_county_code`; paying 9× for it is not worth it.
- **Use `matchedAddress` for display, never the input** — the same rule `src/lib/geocode/census.ts` already documents.
- **Mexican-side addresses `No_Match`** (verified: `AV HIDALGO 100, REYNOSA, TM, 88500` → `No_Match`). Useful, not a guarantee; the county filter is still the primary Texas-side control.


---

## The Normalization Module (D-12, DEDUP-04)

### 🔴 Which side is authoritative — settled by a refusal, not a preference

Two statements were issued against the real local PostgreSQL 18.6 with `unaccent` installed:

```sql
create table trap (n text, g text generated always as (lower(unaccent(n))) stored);
-- ERROR 42P17: generation expression is not immutable

create index on cm (lower(unaccent(outlet_name)));
-- ERROR 42P17: functions in index expression must be marked IMMUTABLE
```

`select provolatile from pg_proc where proname='unaccent'` returns **`s` (STABLE)**, because the dictionary file can be reloaded. `similarity`, `soundex` and `levenshtein` are all `i` (IMMUTABLE).

**Therefore:**

1. `name_norm`, `phone_e164`, `street_num`, `street_norm`, `postal` **cannot be Postgres generated columns** and **cannot be expression indexes**. They are plain columns.
2. Somebody writes them. **That somebody is TypeScript**, in `src/lib/normalize/`, called by the ingest and by any future write path.
3. **SQL never normalizes.** The only SQL that touches a normalized value is `similarity(a.name_norm, b.name_norm)`, `=` and `%` — all over already-stored values.

> The common workaround is a `create function app_name_norm(text) … immutable` wrapper around the STABLE `unaccent` (Postgres accepts the declaration and does not verify it). **Do not do this.** It is a lie to the planner, it puts the index at the mercy of `unaccent.rules`, and it re-creates the two-implementations problem this section exists to close.

### And the two pipelines genuinely disagree — measured

`unaccent()` is not "NFD + strip combining marks". Measured outputs:

| Input | `unaccent()` | NFD + strip `\p{M}` |
|---|---|---|
| `ñ` `á` `ü` `í` `É` `ç` | `n a u i E c` | **same** |
| `ø` | **`o`** | `ø` (no canonical decomposition) |
| `æ` | **`ae`** | `æ` |
| `ß` | **`ss`** | `ß` |
| `œ` | **`oe`** | `œ` |
| `Ł` | **`L`** | `Ł` |
| `đ` | **`d`** | `đ` |
| `ı` | **`i`** | `ı` |

For Spanish they agree; for the Latin-1 ligature/stroke set they do not. Since the ingest will also carry occasional Vietnamese, Polish and German business names, the two implementations *will* diverge on real rows — and a blocker and a scorer that disagree about a key produce candidate pairs that vanish when re-scored.

### The recommended TS pipeline

```ts
// src/lib/normalize/name.ts — pure, no I/O, no database
const LIGATURES: Record<string, string> = {
  'æ':'ae','Æ':'ae','œ':'oe','Œ':'oe','ß':'ss','ø':'o','Ø':'o',
  'đ':'d','Đ':'d','ł':'l','Ł':'l','ı':'i','ð':'d','þ':'th',
};
const LEGAL = new Set(['llc','l','c','inc','co','ltd','corp','dba','lp','llp','pllc','plc','incorporated','company','corporation']);
const STOP  = new Set(['el','la','los','las','de','del','y','and','the','of']);
const TRADE = new Set(['taqueria','carniceria','panaderia']);   // D-12's generic trade words

export function nameNorm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const folded = [...raw].map((ch) => LIGATURES[ch] ?? ch).join('');
  const stripped = folded.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  const tokens = stripped
    .replace(/[^a-z0-9]+/g, ' ')          // punctuation -> space
    .split(' ')
    .filter((t) => t.length > 0)
    .filter((t) => !LEGAL.has(t) && !STOP.has(t) && !TRADE.has(t));
  const out = tokens.join(' ').trim();     // 🔴 trim() is load-bearing — see below
  return out.length === 0 ? null : out;
}
```

🔴 **Three defects the SQL prototype exhibited on real RGV rows, every one of which the token-based version above avoids and every one of which deserves its own unit test:**

1. **A regex stopword strip leaves a leading space.** `"La Taqueria De Guanajuato"` normalized to `" taqueria guanajuato"` — a leading space changes every leading trigram and silently lowers similarity. **Tokenise, filter, re-join; never regex-replace in place.**
2. **Adjacent stopwords survive.** `(^| )(el|la|…)( |$)` consumes the shared space, so `"de la"` loses only one word. A token filter removes both.
3. **Digits leak in from the source.** `"Loro's Taqueria & Salads 956-263-1462"` → `"loro s taqueria salads 956 263 1462"`. Real Overture names contain phone numbers, store numbers (`"SMARTSTYLE 8"`, `"OLLIE'S BARGAIN OUTLET 475"`, `"FIRESTONE COMPLETE AUTO CARE #44HG"`) and suite fragments. **Do not strip digits** — `"Taqueria Las 3 Torres"` needs its `3`, and `"3 Amigos"` is a real name — but **do** strip a trailing token that is a 10/11-digit run, and record `name_had_store_number` in the feature vector so the scorer can forgive it.

Also `"La Colmena Meat Martket"` vs `"La Colmena Meat Market"` and `"TEXAS OUTDOOR POWER EQUIPTMENT"` vs `"Texas Outdoor Power Equipment"` are both real, both from the first twelve candidate pairs the probe produced, and both are why trigram similarity rather than equality is the name feature.

### Phone → E.164

```ts
import { parsePhoneNumberFromString } from 'libphonenumber-js';
const TOLL_FREE = new Set(['800','833','844','855','866','877','888']);

export function phoneE164(raw: string | null): { e164: string | null; blockable: boolean } {
  if (!raw) return { e164: null, blockable: false };
  const p = parsePhoneNumberFromString(raw, 'US');
  if (!p || !p.isValid() || p.country !== 'US') return { e164: null, blockable: false };
  const nsn = p.nationalNumber;                       // 10 digits
  if (nsn.length !== 10) return { e164: null, blockable: false };
  const npa = nsn.slice(0, 3), nxx = nsn.slice(3, 6);
  if (nxx === '555') return { e164: null, blockable: false };     // D-12: reject 555
  return { e164: p.number, blockable: !TOLL_FREE.has(npa) };
}
```

`e164` is stored and displayed; **`blockable` is what the phone blocking key and the D-07 rule read.** Storing a toll-free number is correct (danlo may still want to dial it); blocking on it is not.

### Address key

```
street_num  = leading integer run of the address, or null      ("2426 E TYLER AVE STE 1C" -> "2426")
street_norm = remainder, suite/unit REMOVED, USPS-folded       ->  "e tyler ave"
unit        = the removed suite/unit, KEPT ON THE RECORD       ->  "STE 1C"
postal      = first 5 digits of the ZIP                        ->  "78550"
```

USPS folding is a table-driven map (`STREET→ST`, `AVENUE→AVE`, `BOULEVARD→BLVD`, `DRIVE→DR`, `ROAD→RD`, `HIGHWAY→HWY`, `EXPRESSWAY→EXPY`, `NORTH→N`, …). Note from the live data that the Census geocoder itself folds `E EXPRESSWAY 83` → `E EXPY 83`, so the same table also reconciles a Census `matchedAddress` against a raw Comptroller `outlet_address`. Suite patterns to strip: `STE`, `SUITE`, `UNIT`, `APT`, `#`, `BLDG`, `RM`, `SPC`, `LOT`, `FL`.

### The parity guard

The authoritative-side decision needs an enforcement, not a convention:

```ts
// tests/unit/normalize-sql-free.test.ts
// Assert unaccent( appears in NO blocking/scoring path. Allowed: the CREATE EXTENSION
// migration, and the single /businesses search predicate (named explicitly).
```

grep `src/**/*.ts` and `drizzle/*.sql` for `unaccent(`; allow-list exactly two file paths. This is mutation M24's target.

---

## Scoring, Thresholds and the Fixture (D-09, DEDUP-01)

### The weight table

One committed module, `src/lib/resolve/score.ts`. Every feature emits its own integer into a stored `features jsonb`, and the score is their clamped sum.

| Feature | Value | Contributes | "Independent signal" when |
|---|---|---|---|
| `name` | `round(45 × clamp((sim − 0.40) / 0.60, 0, 1))` over `similarity(a.name_norm, b.name_norm)` | 0…45 | `sim ≥ 0.85` |
| `phone` | 30 if both `e164` present, equal, and **both `blockable`** | 0 or 30 | `= 30` |
| `address` | 30 (`street_num` + `street_norm` + `postal` all equal) / 15 (`street_num` + `postal`) / 5 (`postal` only) / 0 | 0…30 | `= 30` |
| `distance` | 15 (≤ 100 m) / 10 (≤ 500 m) / 4 (≤ 2 km) / 0 (≤ 25 km) — both locations known, and the Census side not `Non_Exact` | 0…15 | `≤ 100 m` |
| `cluster` | +5 same cluster · 0 either unmapped · **−10 different cluster** | −10…+5 | never |
| **`raw`** | `clamp(Σ, 0, 100)` | | |

### The structural rule set — this, not the arithmetic, is what a test pins

Applied in this order, each a separate named clause with a one-test blast radius:

```
R1  both locations known AND distance > 25 000 m   ->  decision = 'distinct', score = 0     (D-10)
R2  chain_key set on either side                   ->  score = min(score, 94)               (D-11)
R3  phone signal AND postal equal AND sim >= 0.60  ->  signals := max(signals, 2);
                                                       score   := max(score, 95);
                                                       features.rule = 'phone_locality_name'  (D-07)
R4  phone signal AND postal equal AND sim <  0.60  ->  score = clamp(score, 80, 94)          (D-07)
R5  signals < 2                                    ->  score = min(score, 94)                (D-09)
R6  geo gate NOT satisfied                         ->  score = min(score, 94)                (D-09/D-10)
        geo gate := both locations known AND distance <= 500 m

band: >= 95 auto-merge · 80–94 review · < 80 ignore · 'distinct' never enters the queue
```

**Why "two signals + geo gate" is the only way to reach 95, and why one signal structurally cannot:**

- **R5 is the guarantee.** With `signals < 2` the score is capped at 94 no matter what the weights produce. R6 then caps again on the geo gate. The invariant is enforced by two `min()` calls, each removable in isolation — which is what makes it mutation-testable (M14, M15) rather than a property of a weight table nobody can re-derive.
- **The arithmetic agrees independently.** Maximum reachable with exactly one signal:
  - name-only (`sim = 1.0` → 45) + address at its non-signal ceiling (15) + distance at its non-signal ceiling (10) + cluster (5) = **75**
  - phone-only (30) + name below 0.85 (≤ 25) + address 15 + distance 10 + cluster 5 = **85**
  - address-only (30) + name ≤ 25 + distance 10 + cluster 5 = **70**

  All < 95 before R5 even runs. Belt and braces; R5 is the belt and the test pins R5.
- **Two signals + geo gate reaches 95 on real data.** Worked from an actual measured pair — `"ZORBA, INC."` (Comptroller, 516 / 78501) vs `"Zorba"` (Overture, 516 / 78501), both normalizing to `zorba` at similarity **1.000**:
  `name 45 + phone 0 (Comptroller carries no phone) + address 30 + distance 15 (Census-geocoded within 100 m) + cluster +5 = 95`; signals = {name, address, distance} = 3; geo gate satisfied → **auto-merge at exactly 95.** ✅
- **The near-miss class lands in review, as it should.** `"SOUTHWEST MEDICAL HOMEPATIENT"` vs `"Southwest Medical Home Patient"` (measured sim 0.848 → 34): `34 + 0 + 30 + 15 + 5 = 84` → review. `"FIRESTONE COMPLETE AUTO CARE #44HG"` vs `"Firestone Complete Auto Care"` → 84, and R2 caps it anyway because Firestone carries a `chain_key`.
- **The must-not-merge class stays below 80.** `"EIS"` (Comptroller, 1805 / 78550) against each of six different Overture businesses at that same address (`"Central Park Car Wash"`, `"Tussing Chiropractic Clinic"`, `"Owens and Minor"`, …), all measured at similarity **0.000**: `0 + 0 + 30 + 15 − 10 = 35`; signals = {address, distance} = 2; geo gate satisfied; **35 → ignore.** ✅
- **R3 cannot fire on a Comptroller↔Overture pair at all**, because `jrea-zgmq` carries no phone column. It exists for Overture↔Overture pairs and for Phase 4's Places-derived phones. **State this in the module's header comment** so nobody hunts for a phone match that cannot exist.
- **R6 runs after R3**, so D-10's hard rule wins: a phone+locality+name match whose Comptroller side failed to geocode is capped at 94 and goes to review. That is exactly D-10's "a pair with one location unknown … cannot exceed the review band."

### The committed fixture

`tests/unit/fixtures/merge-pairs.json` — real RGV pairs pulled from the first ingest. No anonymisation needed; this is public data.

```jsonc
[
  {
    "id": "P01",
    "label": "legal suffix only — the canonical auto-merge",
    "a": { "source": "tx_comptroller", "name": "ZORBA, INC.", "streetNum": "516", "postal": "78501", "phoneE164": null, "lat": 26.20, "lng": -98.23 },
    "b": { "source": "overture",       "name": "Zorba",       "streetNum": "516", "postal": "78501", "phoneE164": "+1956…", "lat": 26.20, "lng": -98.23 },
    "expect": { "score": 95, "band": "merge", "signals": ["name","address","distance"], "geoGate": true }
  },
  { "id": "P02", "label": "Comptroller typo — EQUIPTMENT vs EQUIPMENT",                  "expect": { "score": 84, "band": "review" } },
  { "id": "P03", "label": "both sides misspelled — Martket vs Market",                   "expect": { "score": 84, "band": "review" } },
  { "id": "P04", "label": "store-number suffix + chain flag — #44HG",                    "expect": { "score": 84, "band": "review" } },
  { "id": "P05", "label": "shared address, unrelated — EIS vs Central Park Car Wash",    "expect": { "score": 35, "band": "ignore" } },
  { "id": "P06", "label": "D-10 hard rule — Brownsville vs Rio Grande City (142,343 m)", "expect": { "score": 0,  "band": "distinct" } },
  { "id": "P07", "label": "D-07 review path — exact phone, same ZIP, dissimilar name",   "expect": { "score": 80, "band": "review", "rule": "phone_locality_review" } },
  { "id": "P08", "label": "D-09 — one signal at its ceiling cannot reach 95",            "expect": { "score": 75, "band": "ignore" } },
  { "id": "P09", "label": "D-10 — two signals, Comptroller side never geocoded",         "expect": { "score": 94, "band": "review", "geoGate": false } },
  { "id": "P10", "label": "one Comptroller row, TWO Overture parents at 95 (RIO STONE PRODUCTS)", "expect": { "score": 95, "band": "merge" } }
]
```

**The test asserts the EXACT integer score, the exact band and the exact `signals` array** — not a range. "Re-tuning is a constant edit that a red test confronts, never a silent drift" (D-09) only holds if the assertion is exact; a range would absorb a ±4 weight change in silence.

🔴 **P10 is not decoration.** Measured: `"RIO STONE PRODUCTS, INC."` (2520 / 78501) matches **both** `"RIO Stone Products"` **and** `"Rio Stone Products Inc"` at similarity 1.000. Pairwise auto-merge must therefore be **cluster-aware**: process candidates in descending score and, before each merge, resolve both sides through `coalesce(merged_into_id, id)`. Without that re-point the second merge writes a `merged_into_id` pointing at an already-merged loser and the chain breaks. This is mutation M25.

---

## Merge, Survivorship and Unmerge (D-14, D-19, D-20, DEDUP-02)

### Merges are rows (ARCHITECTURE anti-pattern 9)

```
businesses.status          'active' | 'merged' | 'closed'     -- existing column, existing default
businesses.merged_into_id  uuid -> businesses(id)             -- NULL for a live row
```

**`source_records.business_id` is NEVER re-pointed on merge.** Each source record keeps pointing at the business it created; the winner's `*_source_id` provenance pairs are what move. Consequences, all desirable:

- "every parent record survives the merge" (criterion 4) becomes **structural**, not a procedure somebody can forget.
- Unmerge restores the loser's fields by **re-reading its own source records**, exactly as D-20 requires — no snapshot needed for the loser.
- The winner *does* need a snapshot, because its `*_source_id` pairs were overwritten. `business_merges.winner_fields_before jsonb` carries them.

### `business_merges`

| Column | Notes |
|---|---|
| `orgScoped` spread | `id`, `org_id`, `created_at`, `updated_at`, `updated_by` |
| `winner_id`, `loser_id` | → `businesses(id)`; `check (winner_id <> loser_id)` |
| `candidate_id` | → `merge_candidates(id)`, nullable (a future manual merge has none) |
| `reason` | `check (reason in ('auto','review'))` |
| `score` | the score at merge time — a historical score must stay reproducible |
| `features` | `jsonb`, the component vector at merge time |
| `merged_by`, `merged_at` | actor + `timestamptz` |
| `winner_fields_before` | `jsonb` — every `*_source_id` and every survivorship-owned scalar on the winner immediately before the merge |
| `undone_by`, `undone_at` | NULL until unmerged. **The row is never deleted** |

Partial unique index `(org_id, loser_id) where undone_at is null` — a business can be merged away only once at a time.

### Unmerge, as one transaction

1. `businesses` winner ← `winner_fields_before` (every `*_source_id` and scalar restored).
2. `businesses` loser: `status='active'`, `merged_into_id=null`; then re-derive its surviving fields from its own `source_records` rows using the *same* D-14 survivorship function the merge used — **one function, two call sites, never two implementations**.
3. `business_aliases` row for the loser's key: `released_at = now()`.
4. `merge_candidates` for the pair: `decision='distinct'`, `decided_by = actor`. **D-20's "never auto-re-merges" is this row** (mutation M21).
5. `business_merges`: `undone_by`, `undone_at`.
6. `app.emit_event('businesses', loser_id, 'unmerge', {...})`.

### D-14 survivorship, as a pure function

```ts
// src/lib/resolve/survivorship.ts — one function, used by merge AND unmerge
export function survive(parents: SourceRecordView[]): SurvivingFields
```

| Field | Rule | Provenance pair |
|---|---|---|
| `legal_name` | Comptroller `outlet_name` | `legal_name_source_id` (exists) |
| `display_name` | Overture `names.primary`; Comptroller `outlet_name` only when no Overture parent | `display_name_source_id` (exists) |
| `phone_e164` | Overture preferred; otherwise whichever parent has one | `phone_source_id` (exists) |
| `street` / `postal` / `city` | Overture; Census-geocoded Comptroller as fallback | **`address_source_id` (NEW)** |
| `lat` / `lng` | Overture `ST_X/ST_Y(geometry)`; Census `Exact` next; Census `Non_Exact` last | **`location_source_id` (NEW)** |
| `closed_at` | `3kx8-uryv` only | **`closed_at_source_id` (NEW)** |
| `chain_key`, `cluster_key`, `confidence` | derived, not sourced — no provenance pair | — |

---

## The External Lead Key (D-19, DEDUP-03)

### Alphabet and length — the arithmetic

Crockford base32 excludes `I`, `L`, `O`, `U` → **32 symbols**. Collision probability for `n` keys in `N = 32^k` slots is `≈ 1 − exp(−n²/2N)`:

| Length | `N` | n = 92,000 (RGV, pre-merge) | n = 1,000,000 (statewide) |
|---|---|---|---|
| **5** | 33,554,432 | `n²/2N = 126` → **collision certain**, ~126 expected | ~14,900 expected |
| **6** | 1,073,741,824 | `n²/2N = 3.9` → **P ≈ 98 %**, ~4 expected | ~466 expected |
| 7 | 34,359,738,368 | 0.12 → P ≈ 11 % | ~14.6 expected |

**Recommendation: 6 characters, `SL-XXXXXX`, with a unique constraint and retry-on-conflict.** D-19 permits 5–6; 5 is arithmetically indefensible — dozens of collisions are a certainty at RGV scale alone.

**Retry is cheap, and that is the point.** At 1,000,000 keys in a 6-char namespace the occupancy is 0.093 %, so `P(a fresh draw collides) = 0.00093` — an expected 0.001 retries per insert. A checked generator ("pre-read the taken set") would be both slower *and* racy.

```ts
// src/lib/ids/external-key.ts
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // 32 symbols, no I L O U
export function newExternalKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'SL-' + Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
}
```

> `b % 32` over a uniform byte is exactly uniform here, because 256 = 8 × 32. Stated explicitly because a 36-symbol alphabet would **not** be, and a reviewer will check.

### The constraint, exactly

```sql
alter table businesses add column external_key text not null;
create unique index businesses_external_key_uniq on businesses (org_id, external_key);
alter table businesses add constraint businesses_external_key_shape
  check (external_key ~ '^SL-[0-9A-HJKMNP-TV-Z]{6}$');
```

**Unique per org, not globally** (D-19: "unique per org"). The shape CHECK is what keeps a hand-written row from introducing `I`/`L`/`O`/`U` and defeating the read-aloud property the key exists for.

Insert path: `INSERT … ON CONFLICT (org_id, external_key) DO NOTHING RETURNING id`, retry up to 5 times with a fresh key, then throw. The retry loop is mutation M17's neighbour.

### Resolution after a merge

```sql
-- the loser's key -> the winner's business, in one indexed lookup
select coalesce(b.merged_into_id, b.id) as business_id
from businesses b
where b.org_id = $1 and b.external_key = $2;
```

`merged_into_id` **is** the resolution mechanism, and it is what makes unmerge free: clearing it returns the key to its own record with no second write.

D-19 names "an alias row, never a rewrite", and the Discretion section names `business_aliases`. **Recommendation: ship `business_aliases` as an explicit, queryable row** — the UI shows merge history anyway, a `SL-…` search benefits from one indexed table, and a locked decision should not be relitigated in planning — **but treat `merged_into_id` as the source of truth** and add a DB test asserting the two never disagree:

```
business_aliases (org_id, id, external_key, business_id /* winner */,
                  source_business_id /* loser */, created_at, released_at)
unique (org_id, external_key) where released_at is null
```

```sql
-- tests/db/alias-consistency.test.ts — "an alias and merged_into_id never disagree"
select count(*) from business_aliases a
join businesses l on l.id = a.source_business_id
where a.released_at is null and l.merged_into_id is distinct from a.business_id;
-- must be 0
```

🔴 **The external key is never a foreign key.** Every FK in the schema targets `businesses(id)` (uuid) or the composite `(id, retention_class)`. `business_aliases.business_id` and `.source_business_id` are uuid FKs; `external_key` is a plain unique text column with no `REFERENCES` anywhere. The `/businesses/[id]` route parameter is the uuid (03-UI-SPEC § 4 states this and points at `src/lib/ids.ts`), so the key never becomes a join key by accident. A unit test asserting `external_key` appears in no `references(` clause under `src/db/schema/**` is one grep and closes it permanently.

---

## Idempotency and the Run Report (D-05, D-06, DATA-04)

### The upsert

```sql
insert into source_records (org_id, source_key, external_id, payload, payload_hash,
                            retention_class, source_version, fetched_at, last_seen_at, …derived…)
values (…)
on conflict (org_id, source_key, external_id) do update
  set last_seen_at   = excluded.last_seen_at,
      source_version = excluded.source_version,
      payload        = case when source_records.payload_hash is distinct from excluded.payload_hash
                            then excluded.payload else source_records.payload end,
      payload_hash   = excluded.payload_hash,
      …derived…      = case when source_records.payload_hash is distinct from excluded.payload_hash
                            then excluded.… else source_records.… end
returning (xmax = 0) as inserted,
          (source_records.payload_hash is distinct from excluded.payload_hash) as changed;
```

- New index: `create unique index source_records_ext_uniq on source_records (org_id, source_key, external_id) where external_id is not null;`
- **`external_id`:** Overture → the GERS `id` **verbatim** (measured: a bare UUID string, `e2d3a704-983c-4349-967d-9f6403722ccc`; store as `text`, never cast to `uuid` — the format is Overture's to change). Comptroller → `taxpayer_number || '-' || outlet_number` (D-05) → `'32006170057-5'`.
- **`payload_hash`:** `sha256` over a **canonically key-sorted** JSON serialization of the *selected* fields, never `JSON.stringify(row)` — Socrata's key order is stable today but is not a contract, and a re-ordering would report every row as `changed`.
- `returning (xmax = 0)` is the standard "was this an insert?" discriminator and is correct on PostgreSQL 17 and 18.

### `gone`, computed without a delete

```sql
-- after the pass, in the same transaction
select count(*) from source_records
where org_id = $org and source_key = $src and last_seen_at < $run_started_at;
```

Rows whose `last_seen_at` did not advance during this run are `gone`. **Nothing is deleted, nothing is status-changed.** D-05's rationale (Overture drops and re-adds ids between releases) makes `gone` a *report line*, not a state transition — the detail view renders it as "Last seen in the {version} release — not in the latest run" (03-UI-SPEC § 4.3).

### `ingest_runs` — the D-06 artifact

| Column | Notes |
|---|---|
| `orgScoped` spread | `id`, `org_id`, `created_at`, `updated_at`, `updated_by` |
| `source_key` | `check (source_key in ('tx_comptroller','tx_comptroller_closures','overture','census_geocoder'))` — the four `/sources` rows |
| `dataset_id` | `'jrea-zgmq'` / `'3kx8-uryv'` / `null` / `null` |
| `source_version` | Socrata `rowsUpdatedAt` as ISO / Overture release string / `null` |
| `started_at`, `finished_at` | `timestamptz` |
| `status` | `check (status in ('running','complete','stopped','failed'))` — maps onto Phase 2's existing `src/lib/ui/run-tone.ts` tone map |
| `added`, `changed`, `unchanged`, `gone`, `total_seen` | `integer not null default 0` |
| `stats` | `jsonb` — confidence bands, geocoder match-type counts, the unmapped `basic_category` list, skipped over-size blocks |
| `error` | `text` |

Index `(org_id, source_key, started_at desc)` — `/sources` reads the latest row per source and `SCHED-02` will read the history.

🔴 **`ingest_runs` gets `app.touch_updated_at` but NOT `app.log_event`**, and the deliberate exclusion must be written into `EVENT_LOGGED`'s comment beside `cost_ledger`'s. The run's own record *is* the event; a row trigger on it would duplicate. The **one run-level event per run goes through `app.emit_event('ingest_runs', run_id, 'complete', stats)`** — CONVENTIONS § Audit is explicit that Phase 3 must honour this rather than re-derive it.

### 🔴 The trap CONVENTIONS did not anticipate: `businesses` DOES carry `log_event`

CONVENTIONS § Audit excludes `source_records` from `log_event` precisely because Phase 3 writes ~10k+ rows per run. But `businesses` **is** in `EVENT_LOGGED`, and this phase writes ~92k `businesses` rows too.

| Run | `businesses` writes | `events` rows produced |
|---|---|---|
| First ingest | ~91,872 INSERTs | **~91,872**, each carrying the full row as `after` jsonb (≈ 35–40 MB, estimated — A8) |
| Second ingest, nothing changed upstream | **0** | **0** |
| Typical monthly re-run | the genuinely changed rows only | the same count |

**Mitigation, and it is the right design anyway:** D-05's `payload_hash` diff must gate the `businesses` write as well as the `source_records` write. An unchanged source row advances `source_records.last_seen_at` and **touches nothing on `businesses`**. The first run's ~92k events are a one-time, correct, auditable cost.

**This turns into DATA-04's proof.** The named test is: *"a second ingest of an identical fixture writes zero `businesses` rows and zero new `events` rows, and reports every row as `unchanged`."* It is simultaneously the idempotency proof, the event-volume guard, and mutation M20's target.

---

## Chain Detection (D-11) and Closures (D-03)

### Chain detection

```sql
-- After the ingest, before the resolver.
with chains as (
  select name_norm, count(*) as n
  from businesses
  where org_id = $1 and name_norm is not null and merged_into_id is null
  group by name_norm
  having count(*) >= 3
)
update businesses b
   set chain_key = c.name_norm
  from chains c
 where b.org_id = $1 and b.name_norm = c.name_norm and b.merged_into_id is null;
```

**Measured on the real slices:**

| Population | Names with ≥ 3 members | Member rows |
|---|---|---|
| Overture TX/US in the RGV bbox | **1,025** | **9,782** (17.2 % of 56,944) |
| Comptroller RGV | **444** | **2,091** (6.0 % of 34,928) |

🔴 **One in six Overture rows will carry a chain flag.** D-11 says auto-merge skips flagged rows and the funnel skips them — so ~17 % of the Overture spine is excluded from auto-merge by this rule alone. The review queue must show the flag (03-UI-SPEC § 1: `Chain · {n} in Texas` badge) and the count belongs in the run report's `stats`.

**The `chain_key` value:** the `name_norm` itself, not a synthetic id. It is stable across runs, it is what the badge's count groups on, and it is directly indexable. `chain_key` carries **no provenance pair** — it is derived, not sourced.

⚠ D-11 says "across Texas". This phase's spine is the four RGV counties, so a national chain with two RGV outlets and 400 elsewhere would not be flagged. **Recommendation:** add one statewide request to `scripts/ingest-comptroller.ts` — `$select=outlet_name,count(1)&$group=outlet_name&$having=count(1)>=3` over `outlet_county_code between '001' and '254'` — and seed a statewide name-frequency table. One request closes the gap properly; otherwise record the limitation explicitly and change the badge copy to "in the RGV".

### Closures (D-03)

```ts
// One Socrata request: 21,509 rows, measured. 🔴 UNPADDED county codes.
const where = "loc_county in ('31','108','214','245') and out_of_business_date IS NOT NULL";
```

```sql
-- Exact match only. No fuzzy logic on this feed (D-03).
update businesses b
   set closed_at           = sr.closed_at,
       closed_at_source_id = sr.id
  from source_records sr
 where b.org_id = $1
   and sr.org_id = $1
   and sr.source_key = 'tx_comptroller_closures'
   and sr.external_id = b.comptroller_key       -- 'taxpayer_number-outlet_number'
   and b.closed_at is distinct from sr.closed_at;
```

`b.comptroller_key` is the Comptroller external id copied onto the business at creation (a plain indexed text column). Without it this join needs two round trips through `source_records` and the `merged_into_id` re-point becomes ambiguous after a merge. On a merged business the closure applies to the **winner**, resolved through `coalesce(merged_into_id, id)`.

`closed_at_src_ret` is a new `generated always as ('durable') stored` twin with a new composite FK — see § Provenance Schema Extension.

**Note for the planner, not a decision:** Overture also reports **863 `permanently_closed`** rows in the TX/US slice. D-03 and D-14 make `3kx8-uryv` the *only* `closed_at` source, so **do not write `closed_at` from Overture**. Store `operating_status` on the source record so Phase 6 can use it as a scoring signal, and say so in the plan.

---

## Provenance Schema Extension (DATA-03)

### `sr_source_key_known` — recommendation: **four separate keys, not a dataset column**

```sql
alter table source_records drop constraint sr_source_key_known;
alter table source_records add constraint sr_source_key_known check (
  source_key in ('overture','tx_comptroller','tx_comptroller_closures','census_geocoder',
                 'osm','county_dba','google_places','firecrawl','http_probe','dns_probe','manual')
);
```

**Why separate keys rather than reusing `tx_comptroller` with a `dataset` column:**

1. `/sources` (D-17) renders **four rows, one per source**, and each needs its own `ingest_runs` history. A dataset column makes "the last Comptroller-closures run" a two-column lookup on a table whose entire point is one row per source.
2. The D-18 inline source tag reads `source_key`. "Comptroller closures" is a distinct tag in 03-UI-SPEC § 4.2.
3. `census_geocoder` is unavoidably a new key — a different provider with a different retention story — so the migration is being written either way.
4. A `dataset` column adds a nullable field meaningful for two of eleven keys, and the CHECK cannot express "non-null iff `tx_comptroller*`" without growing another clause.

**Retention class of all four: `durable`.** `census_geocoder` warrants a sentence in the migration comment — it is a free federal service with no caching restriction, unlike Google Places, so `durable` is correct and the FOUND-05 `sr_google_is_ephemeral` CHECK is untouched.

### The three NEW provenance pairs — and all three must be re-proven

| Pair | Typical citing source | Composite FK name |
|---|---|---|
| `address_source_id` / `address_src_ret` | `overture`, fallback `tx_comptroller` | `businesses_address_src_fk` |
| `location_source_id` / `location_src_ret` | `overture`, fallback **`census_geocoder`** | `businesses_location_src_fk` |
| `closed_at_source_id` / `closed_at_src_ret` | **`tx_comptroller_closures`** only | `businesses_closed_at_src_fk` |

```sql
alter table businesses
  add column address_source_id uuid,
  add column address_src_ret text generated always as ('durable') stored,
  add column location_source_id uuid,
  add column location_src_ret text generated always as ('durable') stored,
  add column closed_at_source_id uuid,
  add column closed_at_src_ret text generated always as ('durable') stored;

alter table businesses add constraint businesses_address_src_fk
  foreign key (address_source_id, address_src_ret) references source_records (id, retention_class);
alter table businesses add constraint businesses_location_src_fk
  foreign key (location_source_id, location_src_ret) references source_records (id, retention_class);
alter table businesses add constraint businesses_closed_at_src_fk
  foreign key (closed_at_source_id, closed_at_src_ret) references source_records (id, retention_class);
```

🔴 **`tests/db/retention.test.ts` must gain one named test per pair** — three tests, each attempting to cite an **ephemeral** source record from that field and pinning `23503` **and the constraint name**. Per CONVENTIONS § Testing: one refused statement per rolled-back transaction, each resting on a different invariant, each with a positive control. These are mutations M18, M19 and their sibling.

🔴 **`location_source_id` is the pair that matters most in Phase 4.** A `place_id` sweep produces ephemeral Places lat/lng, and this constraint is exactly what stops that lat/lng becoming the durable `businesses.lat/lng`. Writing the test now makes Phase 4's legal boundary already proven.

### New tables and their tenancy obligations

| Table | Rows (RGV) | Tenancy | `log_event`? | Grants for `authenticated` |
|---|---|---|---|---|
| `ingest_runs` | ~4 per run | `orgScoped` + `orgPolicies` | ❌ (run-level `emit_event` instead) | `select` only |
| `merge_candidates` | ~30,000 per pass | `orgScoped` + `orgPolicies` | ❌ (volume — the `source_records` argument) | `select, update` (the review decision) |
| `business_merges` | ~10,000 | `orgScoped` + `orgPolicies` | ✅ **state-bearing, low volume** | `select` only; written by a definer so `merged_by` cannot be forged |
| `business_aliases` | ~10,000 | `orgScoped` + `orgPolicies` | ❌ (derived from the merge) | `select` only |
| `overture_category_map` | ~244 | `orgScopedNullable` + **`referencePolicies`** | ❌ | the built-in exclusion pattern |

**All five must be added to `TENANT_TABLES` in `tests/db/grants-audit.test.ts`** (16 → 21) — test 1 asserts the array equals the live catalog, so forgetting is red rather than silently unguarded. **`business_merges` must be added to `EVENT_LOGGED`**, and the other four **deliberately excluded with a comment naming the reason**, exactly as `cost_ledger` is.

`overture_category_map` follows Phase 2's D-05 reference pattern verbatim: `org_id IS NULL` built-ins, `referencePolicies()`, and 🔴 **`.nullsNotDistinct()` on the unique index** — without it a second `(null, 'restaurant')` inserts cleanly and the seed loader stops being idempotent (`_helpers.ts` documents this at length).

---

## Criterion 5 — the Texas-Side Proof

**What is being proven:** "A city, county or radius search never returns a Mexican-side result — proven against a naive RGV bounding box, which is 42 % Mexico."

**Measured basis:** the naive bbox holds 98,960 Overture places, of which **41,532 (42.0 %)** are `country='MX'`. `region='TX' AND country='US'` admits **zero** of them, including the 3 rows carrying `country='MX' AND region='TX'`.

**The named test** — a DB test, because the assertion is about what a query returns, not what a transform produces:

```ts
// tests/db/texas-side.test.ts
it('a naive-RGV-bbox radius search returns no Mexican-side row', () =>
  withRollback(async (c) => {
    const { a } = await seedTwoOrgs(c);
    await actAs(c, ORG_A_CLAIMS);
    // ~40 TX/US rows PLUS real Reynosa / Matamoros / Río Bravo rows, every one of them
    // INSIDE the naive bbox — taken from the committed Overture sample.
    await seedOvertureFixture(c, a);

    // The naive bbox centre, 60 km radius — deliberately wide enough to swallow Reynosa,
    // which is 12 km from McAllen. A radius that could not reach Mexico proves nothing.
    const { rows } = await c.query(
      `select display_name, city from businesses
        where org_id = $1 and app.distance_m(lat, lng, 26.2034, -98.2300) <= 60000`, [a]);

    // Positive control FIRST: the query must find the Texas rows, or an empty result set
    // would "pass" this assertion while proving the opposite.
    expect(rows.length).toBeGreaterThan(20);
    const mexican = rows.filter((r) =>
      ['Reynosa','Matamoros','Río Bravo','Rio Bravo','Heroica Matamoros',
       'Ciudad Miguel Alemán','Gustavo Díaz Ordaz','Ciudad Camargo'].includes(r.city));
    expect(mexican).toEqual([]);
  }));
```

🔴 **The positive control is not optional.** A filter bug that admits nothing passes an "expect zero Mexican rows" assertion perfectly — CONVENTIONS § Testing's "every refusal test is paired with a positive control", and the difference between proving criterion 5 and proving that the seed failed.

**A second, cheaper unit test** guards the ingest side: `overtureRowToSourceRecord()` fed the Reynosa fixture rows returns `skipped: 'not_texas'`, and fed the `country='MX' AND region='TX'` row **also** returns skipped. That last one is mutation M23's target, because dropping `country='US'` leaves the region half looking correct.

**Comptroller side:** `outlet_county_code in ('031','108','214','245')` is a Texas county list; no Mexican row can exist in a Texas Comptroller permit dataset. The test that matters there is the **padding** test, not a Texas test.

---

## Architecture Patterns

### System architecture diagram

```
 DESK (tsx, ETL actor: set_config('app.actor_id','etl:<script>', true))
 ═══════════════════════════════════════════════════════════════════════

 data.texas.gov/resource/jrea-zgmq.json          s3://overturemaps-us-west-2/release/<rel>/
   $limit=50000 + $order + $where county           theme=places/type=place/*   (10.4 GB)
            |  34,928 rows / 2.5 s                          |  bbox pushdown -> 9.5 s
            v                                               v
   src/lib/socrata/  --zod-->                       @duckdb/node-api (httpfs + spatial)
            |                                               |  ST_X/ST_Y(geometry), NOT bbox
            |                                               v
            |                                        region='TX' AND country='US'
            |                                          98,960 -> 56,944  (42.0% MX dropped)
            |                                               |
            +-------------> src/lib/normalize/ <------------+   TS IS AUTHORITATIVE
            |                nameNorm . phoneE164 . address       (unaccent is STABLE)
            |                       |
            v                       |
   geocoding.geo.census.gov         |
   /locations/addressbatch          |
     1,000-row chunks, p-limit 3    |
     26 s/chunk, 70.9% match        |
     lon,lat  +  out of order       |
            |                       |
            +-----------------------+
                                    v
 DATABASE (app_user via withOrg; the ETL connects as owner)
 ═══════════════════════════════════════════════════════════════════════
            +---------------------------------------------------+
            | source_records   (org_id, RLS, NO log_event)       |
            |   upsert on (org_id, source_key, external_id)      |
            |   payload_hash diff -> inserted / changed          |
            |   last_seen_at not advanced -> `gone`              |
            +-------------------------+-------------------------+
                                      | one business per source record, idempotent
                                      v
            +---------------------------------------------------+
            | businesses  (org_id, RLS, log_event YES)           |
            |   name_norm . phone_e164 . street_num .            |
            |   street_norm . postal . lat . lng                 |
            |   external_key SL-XXXXXX . chain_key .             |
            |   closed_at . merged_into_id                       |
            |   GIN(name_norm gin_trgm_ops) + 5 btree indexes    |
            +-------------------------+-------------------------+
                                      |
      +-------------------------------+--------------------------------+
      |  BLOCK  (SQL, ~2 min, 1.99e9 all-pairs -> 29,701 candidates)   |
      |    B1  exact E.164, toll-free NPAs excluded                    |
      |    B2' (postal, street_num) AND similarity >= 0.3              |
      |    B3  cross join lateral ... % ... order by <-> limit 5       |
      |    NEVER a plain join on % -- 269 s, the GIN index is unused   |
      +-------------------------------+--------------------------------+
                                      v
      +----------------------------------------------------------------+
      |  SCORE   src/lib/resolve/score.ts  (pure TS, pinned fixture)   |
      |    name45 . phone30 . address30 . distance15 . cluster +5/-10  |
      |    R1 >25 km -> distinct      R2 chain -> cap 94               |
      |    R3/R4 phone+locality       R5 <2 signals -> cap 94          |
      |    R6 no geo gate -> cap 94                                    |
      +------+---------------------+-----------------------+-----------+
         >=95|               80-94 |                    <80|
             v                     v                       v
       auto-merge            merge_candidates            ignore
       (skipped if            decision='pending'        (row kept,
        chain_key set)              |                    never deleted)
             |                      v
             |              /review   Same . Different . Skip
             |                      |
             v                      v
      +----------------------------------------------------------------+
      | business_merges (winner, loser, score, features,                |
      |   winner_fields_before, undone_at)          + log_event         |
      | businesses.merged_into_id  ;  source_records UNTOUCHED          |
      | business_aliases  (loser key -> winner)                         |
      +-------------------------------+--------------------------------+
                                      | unmerge = reverse + decision='distinct'
                                      v
 APP (RSC, requireOrg + withOrg)
 ═══════════════════════════════════════════════════════════════════════
   /review              /sources (ingest_runs)        /businesses -> /businesses/[id]
   score-ordered        4 rows: version, last run,    search + cluster/status filters
   chip band            added/changed/unchanged/gone  per-field source tags, lead key,
   "Queue clear"        Overture confidence bands     merge history, Unmerge
```

### Recommended project structure

```
scripts/
├── ingest-comptroller.ts          # DATA-01 + D-03 + D-08 (the geocode step runs inline)
├── ingest-overture.ts             # DATA-02, DuckDB, takes --release
└── resolve.ts                     # block -> score -> auto-merge -> enqueue review
src/lib/
├── socrata/
│   ├── client.ts                  # LIFTED from scripts/refresh-outlet-counts.ts
│   ├── permits.ts                 # jrea-zgmq row schema + transform (zod)
│   └── closures.ts                # 3kx8-uryv — UNPADDED county codes
├── overture/
│   └── transform.ts               # pure row -> source record. DuckDB is NOT imported here
├── geocode/
│   ├── census.ts                  # EXISTS (oneline)
│   └── census-batch.ts            # NEW: chunking, ID rejoin, ragged-CSV parse, retry
├── normalize/
│   ├── name.ts  phone.ts  address.ts   # the authoritative side
│   └── index.ts
├── resolve/
│   ├── block.ts                   # the three blocking SQL shapes
│   ├── score.ts                   # D-09 weights + R1..R6. ONE module, pinned fixture
│   ├── survivorship.ts            # D-14. ONE function, used by merge AND unmerge
│   └── merge.ts                   # merge / unmerge transactions
└── ids/external-key.ts            # D-19 Crockford base32
src/db/schema/
├── ingest-runs.ts  merge-candidates.ts  business-merges.ts
├── business-aliases.ts  overture-categories.ts
└── businesses.ts / source-records.ts    # EXTENDED — may ADD, may not rename
src/app/(app)/
├── review/  sources/  businesses/  businesses/[id]/
src/seed/data/overture-categories.json   # basic_category -> cluster_key
tests/unit/fixtures/
├── merge-pairs.json                     # D-09's pinned fixture
└── overture-rgv-sample.json             # incl. Reynosa / Matamoros / Río Bravo
tests/unit/msw/fixtures/
├── socrata-jrea-page.json  socrata-3kx8-page.json  socrata-400-type-mismatch.json
└── census-batch-*.txt                   # match / non_exact / tie / no_match / shuffled
```

### Pattern 1: Blocking is a materialised pass, never a live query

Candidate generation takes ~2 minutes. It runs once per resolve pass in `scripts/resolve.ts` and writes `merge_candidates`. **The app never issues a blocking query.** `/review` reads `merge_candidates where decision='pending' order by score desc limit 1` — one indexed row.

### Pattern 2: One business per source record; merges come afterwards

The ingest never tries to match. It creates a business per source record with the derived keys copied on. Resolution is a separate pass over `businesses`. This is what makes the ingest idempotent *and* independently re-runnable, and what lets a re-scored candidate see post-merge surviving fields.

### Pattern 3: Transform is pure; I/O lives at the edge

`socrataRowToSourceRecord`, `overtureRowToSourceRecord` and `censusLineToLocation` are pure functions over already-parsed input. The DuckDB connection, the `fetch` and the `FormData` live only in `scripts/`. This is what lets CI exercise every branch with zero network and zero native binaries.

### Pattern 4: The ETL actor

```ts
await tx.query(`select set_config('app.actor_id', $1, true)`, [`etl:ingest-overture`]);
```

Transaction-local (`true`), per CONVENTIONS § Claims and the `withOrg` precedent. The org is resolved **explicitly** by a `clerk_org_id` passed as a CLI argument — never "the only org", which is a bug that appears only once a second org exists.

### Anti-patterns to avoid

- **`join … on a.name_norm % b.name_norm`** — 269 s; the GIN index is not used. Always `cross join lateral … order by <-> … limit N`.
- **`unaccent()` in an index, a generated column, or any match key** — `42P17`, and it disagrees with the TS normalizer.
- **Re-pointing `source_records.business_id` on merge** — breaks unmerge and breaks "every parent survives".
- **Deleting a `gone` row** — D-05; Overture drops and re-adds ids between releases.
- **A phone blocking key without a toll-free exclusion** — a 215-place block.
- **Storing `bbox.xmin/ymin` as the coordinate** — 98.9 % of rows are wrong by up to 1.7 m.
- **Mass-updating `businesses` on an unchanged re-run** — ~92k `events` rows per run.
- **An "expect zero Mexican rows" test without a positive control.**

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Phone parsing / E.164 | A digit regex | **`libphonenumber-js@1.13.13`**, region `US` | Measured: 2,263 Overture phones match none of the three obvious forms |
| Trigram similarity | Levenshtein in TS over 2 billion pairs | **`pg_trgm`** `%` + `<->` + GIN | The index *is* the blocker. `fastest-levenshtein` / `talisman` are 2022-dead (STACK § What NOT to Use) |
| Parquet range-read over 10.4 GB on S3 | A Parquet reader, or downloading the parts | **`@duckdb/node-api`** + `httpfs` | Row-group pruning on `bbox` turns 10.4 GB into 9.5 s |
| Geodesic distance | A PostGIS dependency | **A 6-line `app.distance_m()`** | 52 ms for a 25 km radius over 56,944 points, no index, no extension, identical in all three environments |
| SoQL literals, NAICS ranges, county padding | A second copy inside the ingest | **Lift `scripts/refresh-outlet-counts.ts` into `src/lib/socrata/`** | It already encodes the `outlet_naics_code`-is-a-number trap, the `000` sentinel and the `quote()` rules, and is grep-guarded |
| Geocoding | Google Geocoding, or a paid provider | **`geocoding.geo.census.gov`** batch | Free, federal, no key. `tests/unit/no-google-credential.test.ts` is the standing guard |
| "Was this an insert?" | `select` then `insert` | `insert … on conflict … returning (xmax = 0)` | One statement, no race — the shape `drizzle/0009` already teaches |
| Address parsing | `node-postal`, `parse-address` | A table-driven USPS abbreviation map with unit tests | `node-postal` is a native C build that will not deploy; `parse-address` is 2022-dead |
| Unique short-key generation | A pre-read of taken keys | `ON CONFLICT DO NOTHING` + retry | At 0.09 % occupancy the expected retry count is 0.001/insert; a pre-read is slower *and* racy |

**Key insight:** every one of these is a problem whose *hard part is the edge cases in the real data*, and this phase now has the real data measured. A hand-rolled version does not fail on the happy path; it fails on the 2,263 malformed phones, the 6 `Tie` rows, the 1,223 NULL categories and the one address that produces 57,568 pairs.

---

## Common Pitfalls

### Pitfall 1: `3kx8-uryv`'s county codes are unpadded
`loc_county = '031'` returns **0 rows**; `'31'` returns 21,062. The padded RGV list returns 37,875 instead of 58,937 — a plausible-looking number that is 36 % short. **`src/lib/socrata/` needs two county-code formatters and a unit test asserting they differ.**

### Pitfall 2: The GIN trigram index is silently not used in a plain join
269,647 ms vs 101,807 ms for the same result set. `EXPLAIN` shows `Filter: (name_norm % cm.name_norm)` beneath an `Index Scan using ov_zip`. **Warning sign:** a candidate pass taking minutes per thousand rows. **Prevention:** `cross join lateral … order by <-> … limit N`, and read the plan for `Bitmap Index Scan on …_name_trgm`.

### Pitfall 3: `unaccent()` cannot be indexed or generated
`42P17` on both. **Warning sign:** a migration that "just needs `IMMUTABLE` on a wrapper". **Prevention:** normalize in TypeScript, store plain columns, grep-gate `unaccent(` out of `src/`.

### Pitfall 4: The Census batch response is ragged and out of order
`No_Match` = 4 fields, `Tie` = 3, `Match` = 8 (or 12 for `geographies`). Order is not input order at n=1,000 or n=3,000. **Warning sign:** every thirtieth business has a location 200 miles away. **Prevention:** rejoin on column 1; branch on column 3 before reading column 6.

### Pitfall 5: Longitude comes first, everywhere in this phase
Census batch column 6 is `"lon,lat"`; Overture `bbox.xmin` is longitude; `ST_X` is longitude; `src/lib/geocode/census.ts` already pins `x = lng, y = lat`. **Prevention:** a unit test asserting `lng < -90 && lat > 20` on every fixture row — RGV longitude is ≈ −98 and latitude ≈ +26, so a swap is a sign error the assertion catches.

### Pitfall 6: `bbox` is not the point
98,834 of 98,960 rows differ from `ST_X/ST_Y(geometry)`, by up to 1.7 m. Use `bbox` for the pushdown predicate only.

### Pitfall 7: Toll-free numbers make a 215-way block
7 NPAs, 1,507 rows, 79 % of the phone-block pairs. **Prevention:** the `blockable` flag in `phoneE164()`, plus a named unit test on a real toll-free number from the fixture.

### Pitfall 8: `businesses` carries `log_event` and this phase writes 92k rows
~92k events with full-row `after` payloads on the first run; **zero** on an unchanged re-run *only if* the `payload_hash` diff gates the `businesses` write too. **Prevention:** the DATA-04 test asserts zero `events` rows on a second identical ingest.

### Pitfall 9: A JS array interpolated into a drizzle `sql` template becomes N placeholders
Phase 2 deferred-items, **three occurrences**. Phase 3 hits it in at least four places: the RGV county-code list, the toll-free NPA list, the `basic_category` mapping lookup, and the criterion-5 Mexican-locality list. **Prevention:** bind an array literal (``sql`= any(${arr}::text[])` `` with a single bound parameter) or use `sql.join(xs, sql`, `)`.

### Pitfall 10: A `Date` bound through `tx.execute` with `prepare:false` throws
Phase 3 binds `last_seen_at`, `run_started_at`, `closed_at`, `merged_at`, `undone_at` and `fetched_at`. **Prevention:** bind `d.toISOString()` with an explicit `::timestamptz` cast, every time.

### Pitfall 11: `timestamptz` comes back as a string, and Socrata dates are floating
`out_of_business_date` arrives as `"1993-03-03T00:00:00.000"` — **no zone suffix**. It is a Texas business date: interpret it in `America/Chicago`, never as UTC, or every closure lands a day early for evening-stamped rows. Compare in SQL (`extract(epoch from …)`), per CONVENTIONS § Time.

### Pitfall 12: One Comptroller row can match two Overture rows at 95
Measured (`RIO STONE PRODUCTS, INC.`). Pairwise merges must resolve both sides through `coalesce(merged_into_id, id)` before each write, processing candidates in descending score.

### Pitfall 13: `orgs` rows cannot be deleted
Phase 2's Pitfall 8 carries forward: an ingest test that seeds rows and cleans up by deleting an org fails. Every DB test here stays inside `withRollback` with **tens** of rows; the 92k-row measurement is a deliberate desk activity, not a test.

### Pitfall 14: The Overture bucket keeps exactly one release
`2026-08-19.0` is the only prefix under `release/`. A pinned release string documents provenance; it does not guarantee re-fetchability. The committed CI fixture is the only reproducible copy.

### Pitfall 15: `pnpm verify` does not run on this machine
Carried from Phase 2. Run the five constituents individually through the pinned store launcher; bare `pnpm` is an older global.

---

## Code Examples

### Candidate generation — the shape that uses the index

```sql
-- Verified plan: Bitmap Index Scan on businesses_name_trgm; 3.3 ms per probe;
-- 101.8 s for the full 34,928-probe cross-source pass.
set pg_trgm.similarity_threshold = 0.45;

insert into merge_candidates (org_id, left_id, right_id, block_key, score, features, decision)
select $1, least(c.id, k.id), greatest(c.id, k.id), 'trgm_zip', 0, '{}'::jsonb, 'pending'
from businesses c
cross join lateral (
  select o.id
  from businesses o
  where o.org_id = c.org_id
    and o.id <> c.id
    and o.postal = c.postal
    and o.name_norm % c.name_norm
  order by o.name_norm <-> c.name_norm
  limit 5
) k
where c.org_id = $1 and c.name_norm is not null and c.postal is not null
on conflict (org_id, left_id, right_id) do nothing;
```

### The 25 km hard rule (D-10)

```sql
-- 303 ms over 332,738 pairs, measured.
update merge_candidates mc
   set decision = 'distinct',
       features = mc.features || jsonb_build_object('distance_m', d.m, 'rule', 'over_25km')
  from businesses a, businesses b,
       lateral (select app.distance_m(a.lat, a.lng, b.lat, b.lng) as m) d
 where mc.org_id = $1 and mc.decision = 'pending'
   and a.id = mc.left_id and b.id = mc.right_id
   and a.lat is not null and b.lat is not null
   and d.m > 25000;
```

### Overture ingest — the parts that bite

```ts
for (const r of reader.getRowObjects()) {
  // DuckDB node-api returns VARCHAR[] as { items: [...] }, not a bare array.
  const phones: string[]   = (r.phones   as any)?.items ?? [];
  const websites: string[] = (r.websites as any)?.items ?? [];
  const socials: string[]  = (r.socials  as any)?.items ?? [];

  // COUNTRY FIRST: a region-only filter lets 3 country='MX' region='TX' rows through.
  if (r.addr_country !== 'US' || r.addr_region !== 'TX') { skipped.not_texas++; continue; }

  // geometry, not bbox: 98.9 % of rows differ, by up to 1.7 m.
  const lat = r.geom_lat as number, lng = r.geom_lon as number;

  const { e164, blockable } = phoneE164(phones[0] ?? null);
  yield {
    sourceKey: 'overture',
    externalId: r.id as string,          // bare UUID string; store as text, never cast
    sourceVersion: release,              // '2026-08-19.0' — recorded on EVERY row
    retentionClass: 'durable',
    payload: r,
    nameNorm: nameNorm(r.name_primary as string),
    phoneE164: e164, phoneBlockable: blockable,
    lat, lng,
    basicCategory: r.basic_category as string | null,   // never `categories`
    confidence: r.confidence as number,
    operatingStatus: r.operating_status as string | null,
  };
}
```

### Census batch — chunk, rejoin, branch

```ts
const CHUNK = 1000;                                   // 26 s measured; 10,000 would be 5.2 min
export async function geocodeBatch(rows: { id: string; street: string; city: string; zip: string }[]) {
  const out = new Map<string, Located>();
  const limit = pLimit(3);
  await Promise.all(chunk(rows, CHUNK).map((slice) => limit(async () => {
    const csv = slice.map((r) =>
      [q(r.id), q(r.street), q(r.city), 'TX', q(r.zip.slice(0, 5))].join(',')).join('\n') + '\n';
    const text = await postWithRetry(csv);            // 2 s / 8 s / 30 s, 3 attempts
    for (const line of text.trim().split('\n')) {
      const f = parseQuotedCsvLine(line);
      const id = f[0];                                // rejoin on the ID — order is NOT input order
      if (f[2] !== 'Match') { out.set(id, { kind: f[2] as 'No_Match' | 'Tie' }); continue; }
      const [lng, lat] = f[5].split(',').map(Number); // LONGITUDE FIRST
      out.set(id, { kind: 'Match', matchType: f[3] as 'Exact' | 'Non_Exact',
                    matchedAddress: f[4], lat, lng });
    }
  })));
  return out;
}
```

### The scorer's structural guarantee, as code

```ts
// src/lib/resolve/score.ts — the clauses a test pins, one mutation each
export function score(a: Side, b: Side): Scored {
  const f = features(a, b);                                    // name, phone, address, distance, cluster
  const distanceM = (a.lat != null && b.lat != null) ? haversine(a, b) : null;

  if (distanceM != null && distanceM > 25_000)                 // R1 (M13)
    return { decision: 'distinct', score: 0, features: { ...f, rule: 'over_25km' } };

  let s = clamp(f.name + f.phone + f.address + f.distance + f.cluster, 0, 100);
  let signals = countSignals(f);

  if (a.chainKey || b.chainKey) s = Math.min(s, 94);           // R2
  if (f.phone === 30 && a.postal === b.postal) {               // R3 / R4 (D-07)
    if (f.nameSim >= 0.60) { signals = Math.max(signals, 2); s = Math.max(s, 95); }
    else                   { s = clamp(s, 80, 94); }
  }
  if (signals < 2)          s = Math.min(s, 94);               // R5 (M14) — D-09
  if (!geoGate(distanceM))  s = Math.min(s, 94);               // R6 (M15) — D-09 / D-10

  return { decision: band(s), score: s, features: { ...f, signals, distanceM } };
}
const geoGate = (m: number | null) => m != null && m <= 500;
const band = (s: number) => (s >= 95 ? 'merge' : s >= 80 ? 'review' : 'ignore');
```

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|---|---|---|---|
| Overture `categories.primary` | **`basic_category`** + `taxonomy` | `categories` **removed in the September 2026 release** (`2026-09-23.0`); `taxonomy` added Dec 2025; all three coexisted until now | Build on `basic_category` only (roadmap + D-04). `taxonomy.primary` is a free second axis already present in `2026-08-19.0` |
| Read Overture `geometry` via `ST_GeomFromWKB` | DuckDB 1.5.x exposes it as a native `GEOMETRY('OGC:CRS84')` | DuckDB 1.5 | `ST_X` / `ST_Y` directly, with the `spatial` extension loaded |
| `duckdb` npm package (node-gyp) | **`@duckdb/node-api`** | 2024 → | The legacy `duckdb@1.4.4` is a generation behind |
| PostGIS as the default answer to "I need distance" | Pure-SQL haversine below ~1 M rows | — | Measured 52 ms; PostGIS costs three divergent versions here |
| `pg_trgm` join with `%` in the ON clause | `cross join lateral … order by <-> … limit N` | — | 269 s → 102 s, and the GIN index is actually used |

**Deprecated / outdated in this project's own corpus — correct these when CONVENTIONS is next touched:**

- **STACK.md § (c)'s "49 M comparisons"** — the real cross-source figure is **1,988,940,032**.
- **STACK.md § (c)'s `ST_DWithin(geom, geom, 150)`** — written when PostGIS was assumed. Replace with `app.distance_m(...) <= 150`.
- **`3kx8-uryv` described as "the out-of-business dataset"** in CONTEXT.md and DATA-SOURCES.md — it is *All Permitted Sales Tax Locations*, 1.45 M rows, with a nullable `out_of_business_date`, different column names and unpadded county codes.
- **CONTEXT.md's "the local PostgreSQL 18 install has `pg_trgm` / `unaccent` / `fuzzystrmatch`"** — those are *available*, not *installed*. Only `plpgsql` is installed today.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| **A1** | The official `postgres:18` Docker image ships contrib, so `create extension pg_trgm` and `unaccent` succeed in CI. Local (EDB, verified) and Supabase (verified) both have them, and the Debian PGDG `postgresql-18` package has carried contrib since PG 10 — but **no container was run** (Docker is absent from this machine) | The Architectural Fork; Environment Availability | The `db` job fails on the first migration. Cheap and immediate: the fallback (`(zip5, left(name_norm,4))` blocking, 115,358 pairs measured) is already sized, and `unaccent` has exactly one consumer |
| **A2** | Overture release `2026-09-23.0` lands on schedule and removes `categories` | Overture | If it slips, nothing breaks — the script reads only `basic_category`. If `2026-08-19.0` disappears before the desk run, the ingest is re-pointed with one CLI argument |
| **A3** | `(tp_number, loc_number)` ↔ `(taxpayer_number, outlet_number)` is unique across all four RGV counties. Verified on a real Cameron row and proven duplicate-free for Starr; **Hidalgo, Cameron and Willacy were not exhaustively checked** | Socrata | A duplicate would set `closed_at` from the wrong row. Mitigation: the `unique (org_id, source_key, external_id)` index turns it into a loud `23505` at ingest |
| **A4** | The Census batch match rate of ~70.9 % holds for all 34,928 rows. Measured on the first 1,000 and first 3,000 by `(taxpayer_number, outlet_number)` order — a *sorted*, not random, sample | Census | A lower rate means more text-only Comptroller rows and a larger review queue. Nothing breaks; the run report makes it visible |
| **A5** | `pg_trgm.similarity_threshold = 0.45` is the right blocking threshold. Measured: 0.45 → 33,333 pairs; 0.60 → 14,485 | Blocking | A committed constant beside the D-09 weights; the desk run's first review session tunes it and the fixture test makes a change loud |
| **A6** | Socrata's `$limit` ceiling is ≥ 50,000. `$limit=50000` and `50001` both returned 200 with the full 34,928 rows; the true ceiling was not probed against a larger result set | Socrata | A statewide fetch (887k rows) would need real paging — which the recommended `$offset` loop already provides |
| **A7** | The measured timings (101.8 s candidate generation, 303 ms 25 km gate, 52 ms radius) transfer to Supabase PostgreSQL 17.6. They were taken on local PG 18.6 on this machine | Blocking; The Architectural Fork | The resolve pass is a desk script — a 3× slowdown is irrelevant. The 52 ms radius query *is* in a request path; at 3× it is 156 ms, still fine |
| **A8** | ~92k `events` rows on the first ingest at ~400 bytes each ≈ 37 MB. The row size is estimated from the column list, not measured | Idempotency | A disk-usage estimate only. The zero-events-on-re-run property is exact and is what the test asserts |

---

## Open Questions (RESOLVED)

🔴 **All five are RESOLVED — every Recommendation below was adopted verbatim by the phase plan set,
and the clause after each heading names the plan that carries it.** Nothing here is still open; a
reader who needs to reopen one must change the named plan, not this document.

1. **Does `postgres:18` carry contrib?** (A1) — **RESOLVED by 03-01**, which makes `CREATE EXTENSION`
   the phase's first migration (`drizzle/0021_extensions.sql`) so the first CI run answers it before
   any dependent work exists.
   - *Known:* local EDB and Supabase both list `pg_trgm`, `unaccent`, `cube`, `earthdistance`, `fuzzystrmatch`, `btree_gin`, `btree_gist` as available; the image installs the Debian PGDG `postgresql-18` package.
   - *Unclear:* not executed — Docker is absent here.
   - *Recommendation:* make the `CREATE EXTENSION` migration the **first** Phase 3 migration, so the first CI run answers it before any dependent work exists.

2. **What is the correct `confidence` cutoff (D-04)?** — **RESOLVED by 03-02 and 03-20**: 03-02
   commits the constant at `0.5` behind a `// TUNED BY THE DESK RUN` marker in
   `src/lib/resolve/score.ts`; 03-20 samples 20 rows per band during the desk run and Task 2's
   human checkpoint confirms or changes the value.
   - *Known:* the distribution is now measured (61.9 % ≥ 0.9; 8.2 % ≤ 0.3). Overture already drops ≤ 0.2 upstream.
   - *Unclear:* the *junk rate* per band — whether a 0.4-confidence RGV row is a real business — is a human judgement needing eyes on rows.
   - *Recommendation:* ship the committed constant at **0.5** (excludes 8.3 % of rows) with a `// TUNED BY THE DESK RUN` marker, and have the desk run sample 20 rows per band. D-04 already promises the number comes from the run report.

3. **Should `operating_status = 'permanently_closed'` (863 rows) do anything here?** — **RESOLVED by
   03-13 and 03-12**: 03-13 stores it on the Overture source record and reports the count in
   `stats`; 03-12 states explicitly that those rows never write `closed_at`, leaving `3kx8-uryv` the
   only `closed_at` source (D-03, D-14). The decision itself stays deferred to Phase 6.
   - *Known:* D-03 and D-14 make `3kx8-uryv` the only `closed_at` source.
   - *Recommendation:* store it on the source record, surface the count in `/sources`, leave the decision to Phase 6. Do not write `closed_at` from it.

4. **D-11 says "across Texas" but the spine is four counties.** — **RESOLVED by 03-12 Task 3**,
   which ships `src/lib/socrata/statewide-names.ts` with the one statewide
   `$group=outlet_name&$having=count(1)>=3` request, and pins the badge-copy fallback
   (`Chain · {n} in the RGV`) in the same task if that request proves impractical.
   - *Recommendation:* add one statewide `$select=outlet_name,count(1)&$group=outlet_name&$having=count(1)>=3` request to `scripts/ingest-comptroller.ts` and seed a statewide name-frequency table. One request closes the gap properly; otherwise change the badge copy to "in the RGV" and record the limitation.

5. **Which screens get e2e specs, given the `preset-detail.spec.ts` two-databases trap?** —
   **RESOLVED by 03-21**, which carries `tests/e2e/sources.spec.ts` and
   `tests/e2e/businesses.spec.ts` as chrome-only specs against the deployed app, while `/review`
   and `/businesses/[id]` are covered by DB tests only (03-15, 03-11) — stated in the plan rather
   than left to a spec that self-skips forever.
   - *Known:* Phase 2 resolved it by self-skipping unless `E2E_BASE_URL` is local, carrying SRCH-03 in `tests/db` instead.
   - *Recommendation:* `/sources` and `/businesses` get **DB tests plus a Playwright spec that asserts chrome only** (nav, empty state, headings) against the deployed app — no fixture. `/review` and `/businesses/[id]` get **DB tests only** in this phase, because both need seeded rows the deployed database will not have. State this in the plan rather than letting a spec quietly self-skip forever.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Local PostgreSQL (`TEST_DATABASE_URL`) | every DB test, the desk run | ✓ | **18.6** x86_64-windows (EDB) | — |
| `pg_trgm` **installed** locally | blocking | ✗ (available, not installed) | `1.6` available | the `CREATE EXTENSION` migration — this phase's first |
| `unaccent` **installed** locally | the `/businesses` search predicate | ✗ (available, not installed) | `1.1` available | same |
| PostGIS locally | Path A only | ✗ **not in `pg_available_extensions`** | — | **Path B — recommended** |
| PostGIS Windows installer for PG 18 | Path A only | ✓ | `postgis-bundle-pg18x64-setup-3.6.2-1.exe`, 104.8 MB, 2026-03-16 | — |
| `postgis/postgis:18-3.6` image | Path A only | ✓ | pushed 2026-08-31 | — |
| Production Supabase | prod migration | ✓ | **PostgreSQL 17.6**; PostGIS **3.3.7** available, not installed | — |
| Node.js | scripts, tests | ✓ | **24.13.0** | — |
| Docker | verifying the CI image locally | ✗ | — | **None.** A1 is answered by the first CI run |
| `data.texas.gov` Socrata | DATA-01, D-03 | ✓ | `jrea-zgmq` 2026-09-19, `3kx8-uryv` 2026-09-21 | msw fixtures in CI |
| `overturemaps-us-west-2` S3 | DATA-02 | ✓ | release **`2026-08-19.0`** (the only release present) | committed JSON fixture in CI |
| `geocoding.geo.census.gov` batch | D-08 | ✓ | `Public_AR_Current`, no key, ~32 addr/s | msw fixtures in CI |
| `@duckdb/node-api` | DATA-02 | ✗ not installed | `1.5.5-r.5` on npm, exercised in a scratch dir this session | — |
| `libphonenumber-js` | D-12 | ✗ not installed | `1.13.13` on npm | — |
| Google Cloud / Places | **nothing in this phase** | ✗ | — | `tests/unit/no-google-credential.test.ts` must stay green |

**Missing with no fallback:** none.
**Missing with fallback:** `pg_trgm` / `unaccent` (a migration this phase writes); `@duckdb/node-api` and `libphonenumber-js` (one `pnpm add` each).

---

## Validation Architecture

### Test Framework

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

### Phase Requirements → Test Map

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

### Sampling Rate

- **After every task commit:** `pnpm test:unit` plus the single `-t "<name>"` filter for the test that task made green — **read the test NAME in the output**; a `-t` filter matching nothing exits 0 green.
- **After every plan wave:** the five `verify` constituents individually through the pinned store launcher.
- **Before `/gsd-verify-work`:** all constituents green, `pnpm test:e2e` green against the deployed URL, and every mutation below applied to the **live local database** (or the live source file, where noted) and reverted with `git diff --stat` empty.
- **Max feedback latency:** 60 s (unit + one DB filter).

### Proposed phase-gate mutations (M13–M25, continuing Phase 2's numbering)

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

### Wave 0 Gaps

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

### Applicable ASVS categories

| Category | Applies | Control |
|---|---|---|
| V2 Authentication | yes (inherited) | Clerk; `requireOrg()` as the first line of `/review`, `/sources`, `/businesses`, `/businesses/[id]` and every server action |
| V3 Session Management | yes (inherited) | `withOrg()` binds claims transaction-locally (`set_config(..., true)`) |
| V4 Access Control | **yes — primary** | `orgPolicies()` + `_org_idx` on all five new tables; explicit DML grants in the creating migration; `referencePolicies()` + `nullsNotDistinct` on `overture_category_map`; every new `SECURITY DEFINER` pins `set search_path = public` on the same statement |
| V5 Input Validation | **yes — primary** | `zod` on every Socrata row, every DuckDB row and every Census CSV line. Three untrusted third-party feeds write ~92k rows into the durable record |
| V6 Cryptography | yes (narrow) | `crypto.getRandomValues` for the external key — **never `Math.random`**; the alphabet divides 256 so `% 32` is unbiased |
| V7 Error Handling & Logging | yes | One run-level `app.emit_event`; `events` immutable by GRANT; `merged_by` written by a definer so it cannot be forged; a SoQL 400 body is echoed, never swallowed |
| V8 Data Protection | **yes — primary** | FOUND-05 extended by three new composite FKs. `census_geocoder` is classified `durable` deliberately, and the `sr_google_is_ephemeral` CHECK is untouched |
| V12 Business Logic | yes | The scorer's R1–R6 clauses; the ≤500-pair block cap; the merge's `coalesce(merged_into_id, id)` re-point |
| V13 API / SSRF | yes | Three hard-coded hosts. No caller input reaches a host, a path or a header |

### Known threat patterns

| Ref | Pattern | STRIDE | Mitigation |
|---|---|---|---|
| T-3-01 | An ETL script writes into the wrong org | Tampering | The org is resolved from a `clerk_org_id` passed explicitly on the CLI; **never** "the only org". A unit test asserts the script refuses to start without it |
| T-3-02 | The ETL actor forges a Clerk `sub` | Repudiation | `app.actor_id` is a GUC a client cannot set; `app.log_event` / `app.emit_event` resolve `jwt->>'sub'` **first**, so a real session always wins |
| T-3-03 | A poisoned Socrata / Overture row injects SQL | Tampering | Every value is a bound parameter; `zod` bounds type and length before the row reaches the driver |
| T-3-04 | A Socrata `$where` built from user input | Tampering | The `$where` is built from **seeded** county codes and NAICS ranges only; `quote()` doubles embedded quotes. No caller input reaches SoQL in this phase |
| T-3-05 | SSRF via a release string or an address | Tampering | Three constant hosts. The release string is validated `^\d{4}-\d{2}-\d{2}\.\d+$` before interpolation into the S3 path; the Census address is a CSV field in a POST body, never a URL |
| T-3-06 | Google Places content reaches a durable field via the new location pair | Info disclosure / legal | `businesses_location_src_fk` — a Places source record is `ephemeral` by `sr_google_is_ephemeral`, so the composite FK refuses it with `23503`. **M18 is the proof** |
| T-3-07 | A tenant mutates the `overture_category_map` built-ins | Tampering | `referencePolicies()`: write policies exclude `org_id IS NULL`. Verified zero-rows / `42501` split |
| T-3-08 | A tenant forges a merge's actor or score | Repudiation | `business_merges` is `select`-only for `authenticated`; the write is a definer that reads the actor itself |
| T-3-09 | Cross-org read of candidates or merges | Info disclosure | `orgPolicies()` + `_org_idx` on all five tables; two orgs in every fixture |
| T-3-10 | The review action POSTed directly, bypassing the UI | Elevation | `requireOrg()` inside the action; the candidate is re-read under RLS before the decision is written; `proxy.ts` carries no authorization by design |
| T-3-11 | `name_norm` / `internal_notes` leak into an export or push | Info disclosure | `PAYLOAD_BUILDERS` + `tests/unit/no-internal-leak.test.ts`; every new internal column registers |
| T-3-12 | A block explosion (the 57,568-pair mall address) exhausts memory | DoS | The ≤500-pair block cap, with the skip recorded in the run report |
| T-3-13 | An external key guessed to enumerate leads | Info disclosure | The key is never a route parameter (03-UI-SPEC § 4 uses the uuid) and every lookup is org-scoped by RLS. 6 Crockford chars = a 1.07e9 namespace at 0.009 % occupancy |
| T-3-14 | A CI run spends money or leaks a credential | Info disclosure | No paid API in this phase; the network grep gate; `tests/unit/no-google-credential.test.ts` stays green |

---

## Project Constraints (from CLAUDE.md)

Actionable directives the planner must honour, with the same authority as CONTEXT.md's locked decisions.

- **Overture (CDLA-Permissive 2.0) and Comptroller (public domain) are the durable record**; Google Places is a transient verifier and **is not touched in this phase**. `tests/unit/no-google-credential.test.ts` must stay green.
- **Postgres-native dedupe (`pg_trgm`, `fuzzystrmatch`, `unaccent`, PostGIS).** 🔴 This research recommends **omitting PostGIS** on measured grounds (§ The Architectural Fork); the planner must treat that as a proposal for danlo, not a fait accompli. `fuzzystrmatch` is likewise not needed — `soundex` blocking measured as the worst of the six keys (597,063 pairs, worst block 65,658).
- **Every table carries `org_id` with RLS from the first migration**; every assertion tested through a user-role connection carrying Clerk claims, pinning `42501`, watched failing first, one refused statement per rolled-back transaction.
- **`legal_name` / `display_name` / internal annotations are three fields, never interchangeable.** `name_norm` joins the internal set — D-12 says it is never displayed, so it registers with the leak sentinel.
- **`typescript@6.0.3`, never 7.x.**
- **Own Supabase project (`jahgeqshuesndyscnmjo`)**, never BIS's `tlbkbmlrfafquucsmsmm`.
- **Drizzle-kit is the single migration authority.** There is **no `drizzle-kit push`** in this project. No Supabase CLI migrations, no MCP `apply_migration`. Functions, grants and table-level constraints go through `pnpm db:custom --name=<name>` with an explicit `--> statement-breakpoint` between every statement; generated SQL is committed and never hand-edited; the `meta/NNNN_snapshot.json` is committed alongside.
- **Production migration is a human checkpoint**, never automatic (`pnpm db:migrate:prod`).
- **`msw` with recorded real payloads; CI must never spend budget** — and here, must never reach Socrata, S3 or the Census geocoder at all.
- **RGV is `America/Chicago`; tests pin zone AND locale.**
- **World-class UI/UX is first-class** — `03-UI-SPEC.md` is the contract for the three screens and is not re-decided here.
- **A green suite proves nothing a mutation check hasn't** — one named test per mutation, reverted, diffed back, and read the failing test's *name*.
- **PR-only; no autonomous merges — danlo reviews before merge.**
- **Carried BIS gotchas:** painted values, never CSS custom properties, for anything a test pins; Tailwind v4 uses `[var(--x)]` not `[--x]`; a `"use client"` module's exports are client references inside a server component.
- **Never leave scratch `.ts` under the repo** — `next build` type-checks it and the Vercel CLI uploads gitignored `coverage/*.ts`.

---

## Sources

### Primary (HIGH — executed or read directly this session, 2026-09-22)

- **Local PostgreSQL 18.6** via `TEST_DATABASE_URL` — extension inventory (`pg_extension`, `pg_available_extensions`; 62 available, `plpgsql` only installed); a throwaway `prospector_probe` database loaded with **56,944 real Overture rows and 34,928 real Comptroller rows**, in which every blocking, scoring, distance and normalization number in this document was measured; `unaccent`'s `provolatile='s'` and the two `42P17` refusals; `EXPLAIN (ANALYZE, BUFFERS)` for both the failing and the working candidate-generation shapes. The database was dropped and `siteless_test` re-verified afterwards (`plpgsql` only, 16 public tables)
- **Supabase `jahgeqshuesndyscnmjo`** (read-only) — `PostgreSQL 17.6`; `pg_extension` (5 installed, no PostGIS); `pg_available_extensions` → **postgis 3.3.7**, `cube 1.5`, `earthdistance 1.2`, `pg_trgm 1.6`, `fuzzystrmatch 1.2`, `btree_gin 1.3`, `btree_gist 1.7`, none installed
- **`data.texas.gov`** — `/api/views/jrea-zgmq.json` and `/api/views/3kx8-uryv.json` (full column lists, types, `rowsUpdatedAt`); RGV counts on both datasets with padded and unpadded county codes; the `(tp_number, loc_number)` join verified on a real Cameron row; the duplicate-key check on Starr; `$limit` 1 / 50000 / 50001; `$offset` 0 / 10000 / 30000; the full response header set
- **`s3.us-west-2.amazonaws.com/overturemaps-us-west-2`** — `ListObjectsV2` on `release/` (one prefix), on the release root (6 themes) and on `theme=places/type=place/` (16 parts, ~10.4 GB)
- **`@duckdb/node-api@1.5.5-r.5`** (installed in the session scratchpad, never in the repo) — `describe` of the live places Parquet; two full RGV bbox range-reads; the country/region split, confidence bands, fill rates, `operating_status`, 244 `basic_category` values, the duplicate and chain rates, the phone-form distribution and the toll-free blast radius; the `bbox` vs `ST_X/ST_Y` delta
- **`geocoding.geo.census.gov/geocoder/{locations,geographies}/addressbatch`** — an 8-row hand-built probe covering Match / Non_Exact / No_Match / Mexican-side, plus 1,000-row and 3,000-row batches of real RGV Comptroller addresses (latency, match rate, tie rate, ragged lines, out-of-order results, `lon,lat` axis order)
- **`download.osgeo.org/postgis/windows/`** — directory listing `pg10`…`pg19`; `pg18/postgis-bundle-pg18x64-setup-3.6.2-1.exe` (`HEAD`: 104,764,772 bytes, `Last-Modified: Mon, 16 Mar 2026 05:58:06 GMT`)
- **Docker Hub** `/v2/repositories/postgis/postgis/tags?name=18` — `18-3.6`, `18-3.6-alpine`, `18-master`, pushed 2026-08-31
- **`npm view`** — `@duckdb/node-api` `1.5.5-r.5` (published 2026-09-13), `libphonenumber-js` `1.13.13`, `duckdb` `1.4.4`
- **Repo** — `src/db/schema/**`, `drizzle/0006`, `0007`, `0009`, `0011`, `tests/db/{_fixtures,grants-audit,retention}.ts`, `scripts/refresh-outlet-counts.ts`, `src/lib/geocode/census.ts`, `package.json`, `.github/workflows/ci.yml`, `.planning/{CONVENTIONS,ROADMAP,REQUIREMENTS,STATE}.md`, `.planning/phases/0{1,2}/*-CONTEXT.md`, `02-RESEARCH.md`, `02-VALIDATION.md`, `03-UI-SPEC.md`

### Secondary (HIGH-MEDIUM — official documentation)

- `docs.overturemaps.org/schema/reference/places/place/` — the authoritative field list, including `operating_status` and `taxonomy`
- `docs.overturemaps.org/guides/places/taxonomy/` — "`categories` … will be removed in the September 2026 release, replaced by the new `basic_category` and `taxonomy` properties"
- `dev.socrata.com/docs/app-tokens.html` — tokens optional; IP throttling without one; `X-App-Token` header preferred
- `geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html` — the batch endpoint, the 10,000-row ceiling, benchmark/vintage semantics
- `github.com/docker-library/postgres` `18/bookworm/Dockerfile` — installs `postgresql-$PG_MAJOR` from PGDG (read; contrib presence inferred — see A1)

### Tertiary (MEDIUM/LOW — corroborating, flagged)

- Web search corroborating that `cube` / `earthdistance` "ship by default with … the official postgres docker image" — single-source, feeds A1 only, and A1's failure mode is a first-CI-run error with a sized fallback

---

## Metadata

**Confidence breakdown:**

- **The PostGIS decision:** **HIGH** — the alternative was executed on the real data in the real engine; the version matrix was read from all three environments; the Path A artifacts were verified to exist, so the recommendation rests on cost, not on unavailability
- **Blocking strategy and its numbers:** **HIGH** — every pair count, worst-block size and timing came from the real 56,944 × 34,928 slices, with `EXPLAIN ANALYZE` for both the failing and the working shape
- **Socrata mechanics:** **HIGH** — both datasets' schemas, counts, the padding divergence and the join key queried live; the join key's uniqueness proven for one county only (A3)
- **Overture:** **HIGH** for the schema, the release inventory, the 42.0 % split, the confidence distribution, the fill rates and the phone mess — all read from `2026-08-19.0` itself. **MEDIUM** for what `2026-09-23.0` will contain (A2)
- **Census batch geocoder:** **HIGH** — every documented behaviour exercised, including the three that break naive parsers; the 70.9 % match rate measured twice on a sorted sample (A4)
- **Normalization authority:** **HIGH** — settled by two `42P17` refusals and a measured `unaccent`-vs-NFD divergence table
- **The scoring weights:** **MEDIUM by design** — the *structure* (R1–R6, the signal cap) is HIGH and mutation-testable; the *numbers* are a committed starting point whose first real tuning is the desk run, which is exactly what D-09's pinned fixture exists to make loud
- **CI contrib availability:** **MEDIUM** (A1) — the one unverified link, deliberately answered by making the extension migration the phase's first

**Research date:** 2026-09-22
**Valid until:** **~24 hours** for the Overture release string (`2026-09-23.0` lands tomorrow and the bucket keeps one release); **30 days** for the Socrata schemas, the Census batch contract, the npm versions and every measured number

**Working-tree hygiene:** every probe ran in the session scratchpad or against a throwaway `prospector_probe` database, dropped in a verified cleanup (`siteless_test`: extensions = `plpgsql` only, 16 public tables, unchanged). No package was installed into the repo, no migration was written, no scratch `.ts` was left under the repo. `git status` was clean apart from this file; `main` @ `cceda32`.

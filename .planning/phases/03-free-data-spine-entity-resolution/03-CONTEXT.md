# Phase 3: Free-Data Spine & Entity Resolution - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

<domain>
## Phase Boundary

A durable, license-clean canonical business record for the RGV that exists before any Google call is made. Concretely: two re-runnable, idempotent desk-run ingests — Texas Comptroller active sales-tax permits (Socrata `jrea-zgmq`, plus `3kx8-uryv` for out-of-business dates) and Overture Maps places (`basic_category`, `names`, `addresses`, `websites[]`, `socials[]`, `phones[]`, `confidence`) — for Cameron, Hidalgo, Starr and Willacy, Texas side only; every business field records which source supplied it and a durable field can only cite a durable source (Phase 1's composite FK); three-tier entity resolution (≥95 auto-merge / 80–95 review queue / <80 ignore) over normalized names, addresses and phones, with reversible merges, every parent surviving, and a stable external lead key; a review queue danlo works from a phone; a sources page reporting each run's added / changed / unchanged / gone counts; and a business list + detail that shows per-field provenance and merge history. Success criterion 5 (no Mexican-side result from a city, county or radius search, proven against the naive bounding box that is 42% Mexico) is proven here.

Out of scope here: any Google Places call, `place_id` attachment, tiling (Phase 4); web-presence probes and receipts (Phase 5); verdicts and scoring (Phase 6); the triage card and swipe UI (Phase 7); the BIS push (Phase 8); the scheduler and the "Net New" view (Phase 9); bilingual name-variant handling in the blocker (DEDUP-05, v2); suppression seeded from out-of-business dates as a *compliance* list (COMP-05, v2 — this phase records `closed_at`, it does not build the do-not-contact list).

</domain>

<decisions>
## Implementation Decisions

### Ingest surface & scope
- **D-01:** Both ingests are **desk scripts**, run from the repo by danlo or Claude Code (Remote Control can drive them): `tsx scripts/ingest-comptroller.ts` (plain `fetch` + SoQL, paged) and `tsx scripts/ingest-overture.ts` (`@duckdb/node-api` against the release Parquet on S3, RGV bbox range-read, then `region='TX' AND country='US'` filter). They connect as an **ETL actor** — the `app.actor_id` GUC fallback in `app.log_event` / `app.touch_updated_at` (`drizzle/0007`) exists for exactly this — and write through the same org-scoped tables as the app, for danlo's org. **Nothing in the app calls Socrata or DuckDB**; the app reads the result and shows the last-run report. No in-app "refresh" button in this phase.
- **D-02:** The ingest loads **everything in the four counties**: all ~35k Comptroller outlets and all ~57k Texas-side Overture places. Each source record is tagged with a cluster where its NAICS code falls in a seeded range (`src/seed/data/clusters.json`) or its `basic_category` maps to one (a new committed mapping seed, see Discretion); **unmapped rows stay in the spine and never enter the lead funnel**. Dedupe sees the whole universe; adding a cluster later is a mapping change, not a re-ingest.
- **D-03:** The Comptroller **out-of-business dataset `3kx8-uryv` ships in this phase as a closure signal**: a second feed keyed on `(taxpayer_number, outlet_number)`, exact match only, that sets `closed_at` (with provenance) on the matching business. No fuzzy logic on this feed. Phase 6/7 read `closed_at` so a dead business is never surfaced as a lead; the compliance list itself (COMP-05) stays v2.
- **D-04:** Overture `confidence` is **stored on every row, never cut at ingest** (Overture already drops ≤0.2 upstream). The funnel applies a **committed cutoff constant**, and the ingest **measures and reports** the distribution (rows per 0.1 band, junk rate sampled) so the roadmap's research flag — "real RGV duplicate rate, junk rate and correct `confidence` cutoff are asserted, not measured" — is answered by numbers in the run report, not by a guess.
- **D-05:** A re-run is **idempotent by external id** (Overture GERS `id`; Comptroller `taxpayer_number || '-' || outlet_number`) with a `payload_hash` diff: unchanged rows only advance `last_seen_at`; changed rows update the payload and the derived columns; new rows insert. A row that has **vanished from the source is marked, never deleted**: its `last_seen_at` stops advancing, the run counts it under `gone`, and the business and its history stay. Nothing retires a business on a source's absence alone — Overture drops and re-adds ids between releases.
- **D-06:** The run report is the success-criterion-1 artifact: per source, per run — `added / changed / unchanged / gone`, the source version ingested (Overture release string; Socrata `rowsUpdatedAt`), duration, and the confidence distribution (Overture). Persisted, not just printed, so `/sources` can show it.

### Cross-source matching rules
- **D-07:** **Phone + locality + name agreement** is the trusted-identifier rule for ≥95. Exact E.164 phone AND same locality AND name similarity above a *lower* bar auto-merges. Exact phone + same locality with a **dissimilar name lands in the review queue**, not in a merge — RGV phone reuse (one cell number for a roofing business, a salon and a taquería; PITFALLS Pitfall 6) is real, and the requirement's "phone + same locality" is honoured in spirit while the mis-merge that would be invisible until a call is routed to a human. `place_id` as a trusted identifier is Phase 4's; nothing here references it.
- **D-08:** **Comptroller outlet addresses are batch-geocoded at ingest with the US Census batch geocoder** (`/geocoder/locations/addressbatch`, ≤10,000 addresses per file, no key, free — the same D-02 choice from Phase 2, now the batch endpoint). The result is a **provenance-tracked location** whose source is a new durable `source_key` (`census_geocoder`); an address the geocoder cannot match stays `NULL` and that record falls back to text matching. This is what makes the geo gate, distance scoring, the 25 km rule, and radius presets reach Comptroller-only businesses.
- **D-09:** Pair scoring is **weighted features summed to a 0–100 score, stored on the pair with its component vector**: name trigram similarity (`pg_trgm` over the normalized name), street number + ZIP agreement, distance between locations, category/cluster agreement, phone agreement when both sides carry one. **≥95 requires two independent signals plus the geo gate**; a single-signal match can never reach 95. The weights and the two thresholds (95, 80) live in **one committed module** with a **fixture of real RGV pairs** (pulled from the first ingest, anonymised only if needed) pinned by tests — re-tuning is a constant edit that a red test confronts, never a silent drift.
- **D-10:** **Never merge across > 25 km** is a hard rule regardless of score (Rio Grande Tire in Brownsville and Rio Grande City are different businesses). A pair with both locations known and >25 km apart is `distinct` by construction; a pair with one location unknown falls to the text-only path and cannot exceed the review band.
- **D-11:** **Chain detection is a flag, not a merge**: ≥3 places sharing a normalized name across Texas get a `chain_key` on each member. **Auto-merge skips flagged rows, the funnel skips them, the review queue shows the flag** when a flagged row lands there via another signal. Nothing is merged or deleted on the strength of a chain flag. What a chain is worth as a lead is Phase 6's call.
- **D-12:** Normalization is a pure, unit-tested module (DEDUP-04): NFD decompose → strip combining marks → lowercase → strip punctuation → strip legal suffixes (`llc|inc|co|ltd|corp|dba`) and a **bilingual stopword list** (`el la los las de del y and the`, plus generic trade words `taqueria carniceria panaderia`) → collapse whitespace; phone → E.164 `+1` + 10 digits, reject non-US and 555; address → leading street number + USPS-folded street + ZIP5, **suite/unit stripped from the match key but kept on the record**. The normalized form is **never displayed** — `display_name` stays verbatim from its source (an `ñ` on the card is the business's own name).

### Review queue & survivorship
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

### Screens & provenance display
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/ROADMAP.md` § Phase 3 — goal, five success criteria, `UI hint: yes`, `/gsd-secure-phase` applies, the research flag on Overture's measured duplicate/junk rate and `confidence` cutoff, `basic_category` not `categories`
- `.planning/REQUIREMENTS.md` — DATA-01…DATA-04, DEDUP-01…DEDUP-04 (this phase); FOUND-04/FOUND-05 (constraints this phase extends); SCHED-03 change types (`new / updated / unchanged / gone`) that D-05/D-06 pre-shape; HAND-02/HAND-05 (consumers of the D-19 key); COMP-05 (v2, closures as a compliance list — not here)

### Research (project-level, already decided — do not re-research)
- `.planning/research/DATA-SOURCES.md` § (b) Texas Comptroller (~L283–376) — `jrea-zgmq` fields, county codes 031/108/214/245, licence, `3kx8-uryv` closures, the personal-services under-count caveat; § (c) Overture (~L378–490) — DuckDB query, schema, `2026-09-23.0` breaking release, the 42%-Mexico bbox measurement, `socials[]` is Facebook-dominated, licence and attribution obligations; § Layering strategy (~L941–1006) — dedupe key priority order, "every geography filter must clip to Texas"
- `.planning/research/ARCHITECTURE.md` § Sources and raw payloads (~L133–158) and § Canonical business — provenance as a constraint (~L160–188) — `source_records`, `business_aliases`, `merge_candidates`, `business_merges` shapes; § Entity Resolution: normalize → block → score → merge (~L598–624); anti-pattern § 9 Deleting the losing row on merge (~L827)
- `.planning/research/STACK.md` § (c) Entity resolution / dedupe (~L150–173) — the three stages, blocking keys, survivorship per field, the BIS `accounts.name` carry-over; the Socrata numeric-NAICS gotcha (~L284); Overture via DuckDB as an offline script only (~L288–292); `@duckdb/node-api@1.5.5-r.5`, `zod` on every external payload, msw-recorded payloads
- `.planning/research/PITFALLS.md` Pitfall 6 (bilingual entity resolution, ~L205–235) — the four RGV failure modes, two-signals-plus-geo-gate, never across 25 km, chain detection, phone is corroboration; Pitfall 8 (~L278–304) — service-area businesses have no address (branch the merge rules when Phase 4 adds the flag; Comptroller rows are the Phase 3 analogue); Integration gotchas table (~L625–628) — Overture vs OSM licensing, Comptroller `taxpayer_address` is a mailing address (use `outlet_address`, never `taxpayer_address`, for location)
- `.planning/research/FEATURES.md` — § on dedupe / review queue / provenance features (read for the competitive framing; no decision here overrides it)

### Locked by Phase 1 and Phase 2
- `.planning/phases/01-foundations-tenancy/01-CONTEXT.md` — D-01…D-11b (tenancy, append-only events, drizzle-kit authority, local test database, RLS proof standard incl. `42501` on foreign-org INSERT and `rowCount: 0` on cross-org UPDATE/DELETE, `23514`/`23503` on the retention constraints)
- `.planning/phases/02-budget-governor-search-presets/02-CONTEXT.md` — D-02 (Census geocoder, never Google), D-03 (four atomic clusters), D-05 (reference rows `org_id IS NULL`), D-09 (Comptroller outlet counts as the estimator's source); the 17-city list is the Phase 2 ∥ 3 shared contract (`src/seed/data/cities.json`, `nameVariants` fold the Comptroller spellings)
- `.planning/phases/02-budget-governor-search-presets/02-UI-SPEC.md` — the design system (shadcn 4.21 `nova`, Inter, teal accent, painted tokens), § 0 App shell (nav, phone bottom tab bar, sticky action bar), § Executor Rules, § Copywriting Contract — the Phase 3 `/gsd-ui-phase` extends this spec, it does not replace it
- `.planning/CONVENTIONS.md` — § Tenancy, § Claims (the `app.actor_id` fallback for ETL), § Database access (`withOrg()`, `app_user`, migrations as owner via `scripts/db.ts`), § Migrations (`db:custom` for functions/grants/constraints), § Grants (every new table grants its DML explicitly and joins `TENANT_TABLES`)
- `.planning/phases/01-foundations-tenancy/01-VALIDATION.md` and `.planning/phases/02-budget-governor-search-presets/02-VALIDATION.md` — the gate-mutation standard (one named test per mutation, watched red, reverted)
- `.planning/phases/02-budget-governor-search-presets/deferred-items.md` — the `presets.spec.ts` teardown owed (three `e2e-*` rows per CI run, no delete path) and the `preset-detail.spec.ts` two-databases trap; the WR-02 D-13 per-provider meter note is Phase 5's, not this phase's

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db/schema/businesses.ts` — the three-name rule and the `*_source_id` / `*_src_ret` provenance pairs (legal_name, display_name, phone) whose composite FK (`drizzle/0006`) only resolves against a `durable` source record; extend with location, `closed_at`, `chain_key`, `external_key`, `merged_into_id`
- `src/db/schema/source-records.ts` — `source_records` with `retention_class`, `payload_hash`, `expires_at`, `business_id` and the `sr_source_key_known` CHECK already admitting `overture` and `tx_comptroller`; the ingest writes here first
- `src/db/schema/geography.ts` — `counties` (FIPS + Comptroller code + `is_rgv`, identity CHECK), `cities` (`name_variants[]` for the Comptroller spellings, `is_rgv_seed`), `geo_presets`; the ingest scopes on `is_rgv` counties and folds `outlet_city` through `name_variants`
- `src/db/schema/clusters.ts` + `src/seed/data/clusters.json` — the four clusters with half-open NAICS ranges; `src/seed/types.ts` states the range form
- `scripts/refresh-outlet-counts.ts` — a working Socrata client: `$where` building, `quote()`, `comptrollerCode()`, `naicsPredicate()`, the `000` sentinel, the numeric-NAICS gotcha; lift the client into `src/lib/socrata/` rather than duplicating it
- `src/lib/geocode/census.ts` — the Census onelineaddress client with zod parsing, axis-order pin, no-match handling; the batch endpoint client sits beside it
- `src/db/schema/_helpers.ts` — `orgScoped`, `orgScopedNullable`, `orgPolicies()`, `referencePolicies()` (for the category-mapping seed), `tstz`
- `drizzle/0007_event_triggers.sql` — `app.log_event` / `app.touch_updated_at` with the `app.actor_id` GUC fallback the ETL actor uses; `drizzle/0011` — `app.emit_event` for application-emitted events (merge, unmerge, review decision)
- `drizzle/0009_ensure_org_no_write.sql` — the select-then-do-nothing idempotency shape for "get or create" upserts
- `src/lib/ids.ts` — the `[id]` route uuid guard every new `[id]` page must call (`tests/unit/ids.test.ts` walks every route)
- `src/lib/export/registry.ts` + `tests/unit/no-internal-leak.test.ts` — the internal-annotation sentinel; `name_norm`, `internal_notes` and any new internal column must register so the leak test scans them
- `src/lib/auth/require-org.ts` — `requireOrg()` guards every `(app)` page; `src/db/with-org.ts` — `withOrg()` is the one runtime db entry point
- `tests/db/_fixtures.ts` — `withRollback` / `actAs` / `actAsRole` / `seedTwoOrgs`; `tests/db/grants-audit.test.ts` — `TENANT_TABLES` list to extend; `tests/db/retention.test.ts` — the durable-cites-durable proof to extend for each new provenance pair
- `src/app/(app)/layout.tsx` and the `/presets` screens — the shell, list, detail and sticky-action-bar patterns the review queue, `/sources` and `/businesses` follow
- `scripts/db.ts` (`db:generate`, `db:custom`, `db:migrate` / `db:migrate:prod`) and `scripts/seed.ts` (`db:seed` / `db:seed:prod`) — the only migration and seed gates

### Established Patterns
- Every table: `org_id`, RLS, explicit grants in the creating migration, a row in `TENANT_TABLES`; the schema-audit test reads the live database
- Proof standard: watched failing first, SQLSTATE pinned, one refused statement per rolled-back transaction, one named mutation per guard run on the live local database and reverted
- Money is µUSD bigint; timestamps `timestamptz`; zone AND locale pinned in tests (America/Chicago)
- drizzle `sql` templates: a JS array interpolates as N placeholders — bind an array literal or `sql.join`; a `Date` bound through `tx.execute` throws — bind `toISOString()` with `::timestamptz`; `timestamptz` comes back as a string (Phase 2 deferred-items, three occurrences)
- pnpm only through the store launcher on this machine; `--reporter=verbose` on filtered vitest runs; a `-t` filter that matches nothing skips silently — read the test name
- Never leave scratch `.ts` under the repo (Vercel CLI uploads gitignored `coverage/*.ts`; `next build` type-checks it) — `.vercelignore` is owed
- Reference/seed rows are `org_id IS NULL` with `referencePolicies()`; tenant rows are `orgScoped` with `orgPolicies()`

### Integration Points
- `src/db/schema/index.ts` — new schema modules register here
- `src/app/(app)/` — gains `/review` (queue), `/sources`, `/businesses`, `/businesses/[id]`; the shell nav (Phase 2 UI-SPEC § 0) gains entries per the Phase 3 UI pass
- `scripts/` — `ingest-comptroller.ts`, `ingest-overture.ts`, a Census batch step (inside the Comptroller script or its own), all writing through the ETL actor
- `src/seed/data/` + `scripts/seed.ts` — the `basic_category` → cluster mapping seed
- `.github/workflows/ci.yml` — the `db` job's `postgres:18` service (image change if PostGIS is chosen); the `verify` job must never reach Socrata, S3 or the Census geocoder
- `tests/e2e/` — new screens get specs with `data-testid` hooks; fixtures must not repeat the `preset-detail.spec.ts` two-databases trap
- Phase 4 attaches `place_id` to the businesses this phase creates (a join table, never a FK on `businesses`); Phase 6 reads `closed_at`, `chain_key`, cluster and confidence; Phase 8 reads `external_key`; Phase 9's change types are D-05's

</code_context>

<specifics>
## Specific Ideas

- Review chips as danlo will read them: "phone exact · name 0.81 · 140 m apart · same ZIP" — the component vector, not a bare score.
- The external key looks like `SL-7F3K2`: something that can be read aloud on a call and typed into a CSV filter.
- The three review actions are exactly "Same business · Different · Skip" — no per-field picking on a phone.
- Every field on the business detail carries its source tag inline: "Comptroller", "Overture", "Census geocoder".
- The `/sources` report reads like a ledger: source · version ingested · last run · added / changed / unchanged / gone.
- `display_name` keeps the `ñ`; only the hidden match key is normalized.

</specifics>

<deferred>
## Deferred Ideas

- **Undo toast on a review decision** — TRI-02's pattern; Phase 7. Unmerge (D-20) is the Phase 3 reversal.
- **Bulk review actions / desk keyboard shortcuts** — TRI-06/TRI-07, v2.
- **Bilingual name-variant handling in the blocker** (Spanish/English word-order variants beyond the stopword list) — DEDUP-05, v2.
- **Suppression / do-not-contact seeded from `out_of_business_date`** — COMP-05, v2; this phase records `closed_at` only.
- **Service-area-business branch of the merge rules** (no geo gate when `pureServiceAreaBusiness` is true) — needs the Phase 4 flag; write the Comptroller no-location path so it can be reused.
- **In-app "Refresh sources" button** — not in this phase; if wanted later it wraps the Comptroller script's logic (fetch-only) in a Vercel Workflow, and Overture stays offline.
- **`presets.spec.ts` teardown / preset archive path** — owed from Phase 2 deferred-items; a Phase 3 or 4 plan should own it (a delete path is a product feature).
- **`.vercelignore` for `coverage/`** — Phase 2 follow-up, one-line change, first plan that touches deploy.
- **Overture attribution block** (Overture + providers, Foursquare notice, CDLA text on export) — the UI pass places it on `/sources`; the export copy is Phase 8's (COMP-03).

</deferred>

---

*Phase: 03-free-data-spine-entity-resolution*
*Context gathered: 2026-09-22*

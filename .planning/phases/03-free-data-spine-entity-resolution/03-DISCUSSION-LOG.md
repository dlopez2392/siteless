# Phase 3: Free-Data Spine & Entity Resolution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-22
**Phase:** 3-free-data-spine-entity-resolution
**Areas discussed:** Ingest surface & scope, Cross-source matching rules, Review queue & survivorship, Screens & provenance display

---

## Ingest surface & scope

**Q1. Where does the ingest run and how is it triggered?**

| Option | Description | Selected |
|--------|-------------|----------|
| Desk scripts, both sources | `tsx scripts/ingest-comptroller.ts` + `scripts/ingest-overture.ts`, ETL actor; app only reads the result and shows the last-run report. DuckDB cannot ship in a Vercel function; Remote Control can drive it. | ✓ |
| Comptroller in-app, Overture script | A "Refresh Comptroller" server action; Overture stays offline. Two code paths, one visible button. | |
| Both in-app via a pre-extracted file | DuckDB once to produce a committed extract, the app ingests it. Adds an artifact hand-off and a large file. | |

**User's choice:** Desk scripts, both sources (recommended).

**Q2. How much of the four counties does the ingest load?**

| Option | Description | Selected |
|--------|-------------|----------|
| Everything, tag the cluster | All ~35k Comptroller outlets and ~57k TX-side Overture places; cluster tagged where NAICS/basic_category maps; unmapped rows stay in the spine, out of the funnel. | ✓ |
| Cluster-matched rows only | Only rows mapping to the four clusters (~24k Comptroller). Smaller, but a new cluster means a re-ingest. | |

**User's choice:** Everything, tag the cluster (recommended).

**Q3. Include the Comptroller out-of-business dataset (3kx8-uryv) in this phase?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, as a closure signal | Second feed keyed on taxpayer_number + outlet_number sets `closed_at`; no fuzzy logic. | ✓ |
| Defer to a later phase | Active permits only; closures land with the compliance list. | |

**User's choice:** Yes, as a closure signal (recommended).

**Q4. Overture confidence: apply a cutoff at ingest, or store all and filter later?**

| Option | Description | Selected |
|--------|-------------|----------|
| Store all, cutoff in the funnel | Keep `confidence` on every row; the funnel applies a committed constant measured during ingest. | ✓ |
| Cutoff at ingest (≥0.5) | Only rows ≥0.5 land; a re-tune means a re-ingest. | |

**User's choice:** Store all, cutoff in the funnel (recommended).

**Q5. On a re-run, what happens to a row that has vanished from the source?**

| Option | Description | Selected |
|--------|-------------|----------|
| Mark it, never delete | `last_seen_at` stops advancing, counted as `gone`; the business stays. | ✓ |
| Mark it and retire the business | Same, plus flip the business to `closed` when its last source is gone. Overture drops and re-adds ids between releases. | |
| Delete the source record | Mirror the source exactly. Breaks provenance FKs. | |

**User's choice:** Mark it, never delete (recommended).
**Notes:** User chose "Next area" after these five; no free-text notes.

---

## Cross-source matching rules

**Q1. Phone + same locality as a trusted identifier vs RGV phone reuse — which rule holds?**

| Option | Description | Selected |
|--------|-------------|----------|
| Phone + locality + name agreement | Exact E.164 AND same locality AND name similarity above a lower bar auto-merges; a dissimilar name goes to review. | ✓ |
| Phone + locality as written | Auto-merge regardless of name. A roofer and a salon on one cell number become one lead. | |
| Phone never auto-merges | Corroboration only; every phone-only agreement to review. | |

**User's choice:** Phone + locality + name agreement (recommended).

**Q2. Geocode Comptroller outlet addresses with the Census batch geocoder?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, batch geocode at ingest | Census batch endpoint, 10k per file, no key; stored as a provenance-tracked location (`census_geocoder`); unmatched stay null. | ✓ |
| No, match on normalized address text | Street number + street + ZIP only; radius presets never reach Comptroller-only businesses; 25 km rule unenforceable for them. | |

**User's choice:** Yes, batch geocode at ingest (recommended).

**Q3. How is the score bucketed into the three tiers for a Comptroller ↔ Overture pair?**

| Option | Description | Selected |
|--------|-------------|----------|
| Weighted features, committed thresholds | Name trigram, street number + ZIP, distance, category, phone — weighted, summed to 0–100, stored on the pair; two signals + geo gate for ≥95; one committed module with a real-RGV-pairs fixture. | ✓ |
| Rule ladder, no numeric score | Ordered rules; the 80–95 band has no natural home. | |

**User's choice:** Weighted features, committed thresholds (recommended).

**Q4. Chain detection: 3+ places sharing a normalized name across Texas?**

| Option | Description | Selected |
|--------|-------------|----------|
| Flag the cluster, keep the rows | `chain_key` on each member; funnel and auto-merge skip flagged rows; review queue shows the flag; Phase 6 decides value. | ✓ |
| Not in this phase | Rely on the 25 km rule and geo gate alone. | |

**User's choice:** Flag the cluster, keep the rows (recommended).
**Notes:** User chose "Next area"; the 25 km hard rule and the normalization recipe were carried from research into CONTEXT.md as D-10 / D-12 without a separate question (they are research-locked, not gray).

---

## Review queue & survivorship

**Q1. What does one review item look like?**

| Option | Description | Selected |
|--------|-------------|----------|
| Side-by-side pair with signal chips | Two columns (name, address, phone, category, source, distance) with the scored signals as chips; actions Same business / Different / Skip; stacks as two cards on a phone. | ✓ |
| Cluster view, many candidates at once | One anchor with every candidate beneath it; a desk layout. | |

**User's choice:** Side-by-side pair with signal chips (recommended).

**Q2. On a merge, how are per-field winners chosen?**

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed survivorship rules | Comptroller → legal_name; Overture → display_name (Comptroller fallback); phone from whichever has one, Overture preferred; address/location Overture, geocoded Comptroller fallback; each field records its source. Review decides same/different only. | ✓ |
| danlo picks per field in review | Per-field choice before confirming; slow on a phone. | |

**User's choice:** Fixed survivorship rules (recommended).

**Q3. Phone-first or desk?**

| Option | Description | Selected |
|--------|-------------|----------|
| Both, phone-first layout | Same responsive shell as /presets; stacked cards + thumb-zone actions on a phone, two columns on the desk. | ✓ |
| Desk only in this phase | A desk table now, phone layout in Phase 7. Breaks mobile-first for one screen. | |

**User's choice:** Both, phone-first layout (recommended).

**Q4. Ordering and end state of the queue?**

| Option | Description | Selected |
|--------|-------------|----------|
| Highest score first, explicit end | Most-likely-same first, remaining count in the header, explicit "Queue clear" end state; mirrors TRI-03. | ✓ |
| Newest first | Ingest order; easy 94s and hard 81s interleave. | |

**User's choice:** Highest score first, explicit end (recommended).
**Notes:** User chose "Next area".

---

## Screens & provenance display

**Q1. Which screens does Phase 3 ship, beyond the review queue?**

| Option | Description | Selected |
|--------|-------------|----------|
| Sources page + business list/detail | `/sources` (per source: last run, counts, version) and `/businesses` list + detail (fields with source, merge history, parents, unmerge). Phase 7's card reuses the detail. | ✓ |
| Sources page only | Spine visible only via the review queue; unmerge has no home; criterion 2 has no screen. | |
| Business list/detail only | Ingest report only in the terminal and a log table. | |

**User's choice:** Sources page + business list/detail (recommended).

**Q2. How does "which source supplied this field" show?**

| Option | Description | Selected |
|--------|-------------|----------|
| Inline source tag per field | Always-visible tag: Comptroller / Overture / Census geocoder. | ✓ |
| Provenance drawer | Plain fields; a disclosure opens a drawer listing every field and source. | |

**User's choice:** Inline source tag per field (recommended).

**Q3. External lead key format?**

| Option | Description | Selected |
|--------|-------------|----------|
| Human-readable short key | e.g. `SL-7F3K2`, prefix + 5–6 Crockford base32, unique per org; winner keeps its key, loser's resolves to the winner. | ✓ |
| Bare uuid | No new column; unreadable on a call or a CSV. | |

**User's choice:** Human-readable short key (recommended).

**Q4. Unmerge: where does it live and what does it do?**

| Option | Description | Selected |
|--------|-------------|----------|
| On the detail merge history | Unmerge per merge row: restore loser to active, re-point aliases, record actor, mark pair distinct so it never auto-re-merges. Covers auto and reviewed merges. | ✓ |
| Only from the review queue history | Undo per reviewed decision; auto-merges have no unmerge path until Phase 7. | |

**User's choice:** On the detail merge history (recommended).
**Notes:** User chose "Wrap up", then "I'm ready for context".

---

## Claude's Discretion

- Table shapes and names (`business_aliases`, `merge_candidates`, `business_merges`, an ingest-runs table, the `businesses` extensions)
- `source_records` derived columns, blocking indexes, and where they live
- Extending `sr_source_key_known` (`census_geocoder`, closures) while preserving the durable-cites-durable invariant
- PostGIS (Stack Builder checkpoint + CI image) vs pure-SQL haversine + geohash6
- The `basic_category` → cluster mapping seed
- Overture release pinning as a script argument
- The Texas-side proof as an attribute-filter test (no county polygons)
- CI fixtures (msw / committed extract) so CI never reaches Socrata, S3 or the Census geocoder
- ETL actor identity (`app.actor_id` GUC) and explicit org targeting
- Socrata paging / app token, Census batch sizing, DuckDB memory
- Which screens get e2e specs and how their fixtures avoid the two-databases trap

## Deferred Ideas

- Undo toast on review decisions (TRI-02, Phase 7)
- Bulk review / desk keyboard shortcuts (TRI-06/07, v2)
- Bilingual name-variant blocking (DEDUP-05, v2)
- Do-not-contact seeded from closures (COMP-05, v2)
- Service-area-business merge branch (needs Phase 4's flag)
- In-app "Refresh sources" button
- `presets.spec.ts` teardown / preset archive path (Phase 2 deferred item, owner Phase 3 or 4)
- `.vercelignore` for `coverage/`
- Overture attribution block placement (UI pass) and export copy (Phase 8)

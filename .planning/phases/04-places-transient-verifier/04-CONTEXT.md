# Phase 4: Places Transient Verifier - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Google Places API (New) Text Search becomes an authoritative, billed, **transient** verifier for the Phase 3 spine. It answers "does Google list a website URI for this business?" and discards almost everything else in the response. Concretely:

- A Places adapter behind a kill switch sends a request built in one module: the hard-coded field mask plus `includePureServiceAreaBusinesses: true`.
- Tiling over each preset's (cluster × geography × Places type) cells detects the 60-result saturation ceiling, subdivides the tile, and reports anything still truncated.
- In-memory matching of each Places result to a spine business attaches its `place_id` to that business.
- Append-only observations keep the derived website signal, with lat/lng expiring after 30 days, purged by a daily cron and observable on `/sources`.
- Every call is reserved on the budget meter before it leaves and ledgered with its SKU.
- The Workflow executor behind Phase 2's Run button, plus manual "this week's partition" and "check for changes (free)" actions.
- A live run report.
- Google Maps attribution inline wherever a Places-derived signal is shown.
- The Google Cloud project, key and daily quota (BUDG-03, carried from Phase 2) are created in this phase through a human-action checkpoint.

Out of scope here:
- DNS/HTTP/TLS/parked probes, receipts, and web-search discovery (Phase 5).
- The six-way verdict and scoring (Phase 6). The `business.site` → `dead` verdict is Phase 5/6's; this phase only records the derived host class.
- The triage card (Phase 7).
- The scheduler that fires partitions weekly and detection nightly (Phase 9). This phase builds the operations and manual triggers; Phase 9 only schedules them.
- The "Net New" view (Phase 9).
- Using Google-only places (no spine match) as a lead source (deferred).

</domain>

<decisions>
## Implementation Decisions

### Legal gate, Google setup and the first real call
- **D-01:** **Build and test the whole phase against recorded payloads. Gate production.** Every plan until the gate runs on msw-recorded Places payloads. CI never spends budget (Phase 2 D-04), and nothing in the app needs the key to pass its tests.
  - Before the **first real Places call of any SKU**, a `checkpoint:human-action` records one of two things in PROJECT.md Key Decisions: counsel's answer on Maps Platform Terms §3.2.3(c) (is a derived value "Content"?) and §3.2.3(d)(iii) (is a lead tool a "listings or directory service"?), **or** danlo's own written risk call.
  - The checkpoint enumerates exactly what persists (D-05, D-10, D-13), so the call covers the real list, not the PLACE-02 wording alone.
- **D-02:** **A kill switch ships regardless of the legal answer:** a `PLACES_MODE` env var with values `off | ids_only | enterprise`, **defaulting to `off`**.
  - It is declared in `src/env.ts` (fail loudly on an unknown value) and read by the adapter.
  - Changing it takes a Vercel env edit and a redeploy. That is deliberately hard to flip by accident; there is no in-app toggle.
  - `off` refuses before any reservation. `ids_only` permits only the Essentials mask (change detection). `enterprise` permits the full mask.
  - A "no" from counsel is a config change, as the roadmap requires.
- **D-03:** **GCP setup is a runbook-driven human-action checkpoint, and danlo does the clicking.** danlo:
  1. creates the Google Cloud project;
  2. enables Places API (New);
  3. attaches billing;
  4. sets **Places API (New) → Requests per day = 100** (the value and derivation already in `docs/runbooks/google-quota.md`);
  5. creates an API key **restricted to Places API (New)**.

  The key goes into `.env.local` and Vercel env, names only in `.env.example`. Claude verifies the key with **one free IDs-Only call** and closes BUDG-03. `tests/unit/no-google-credential.test.ts` must be amended deliberately, never deleted: the adapter module becomes the one sanctioned reader.
- **D-04:** **The first real run is one city × one cluster** (e.g. McAllen × home services). It is sized to fit inside the free 1,000 Text Search Enterprise requests per month. It:
  - records the msw fixtures from real payloads;
  - proves saturation, subdivision and SAB inclusion on real RGV density;
  - makes the TTL purge and the run report non-synthetic.

  It also un-synthesizes the Phase 2 items deferred to this phase: the 80 % / 100 % banner shots and the two `budget-banner` specs that self-skip on production (02 deferred-items). Its geography is the likely Phase 6 slice.

### Matching Places results to the spine
- **D-05:** Each Places result is scored **in memory, at call time** against spine businesses, reusing Phase 3's weighted features, weights module and 95/80 thresholds. Google's name, address and phone are never persisted.
  - **≥95** attaches the `place_id` (a join table, never an FK on `businesses`).
  - **80–95** attaches as **`tentative`**, carrying its score and component vector (derived numbers only). A tentative attachment is **excluded from every verdict input** until confirmed. It lands in the **existing review queue**, which shows the spine side plus the signal chips (Google's text cannot be shown because it isn't stored). Actions: confirm / reject; a reject marks the pair so it never re-attaches.
  - **<80** is dropped from matching and counted.
- **D-06:** **Unmatched Places results keep only their `place_id`**, in a tile-membership record. This is legal indefinitely and required anyway: IDs-Only change detection diffs the set of place_ids per tile, and an unkept id would read as "new" every night. These results never become businesses or leads. The run report counts "Google places that matched nothing in the spine" **per cluster**, so the coverage gap is measured, not guessed. Home-services trades are the expected gap: Texas residential repair is often not sales-taxable, so there's no Comptroller permit.
- **D-07:** **The pure service-area-business branch** (Phase 3 deferred it to here). A result with `pureServiceAreaBusiness` and no location can reach ≥95 via **exact E.164 phone plus name similarity above the bar**, with **the queried city standing in for locality**. Without an exact phone it caps at the tentative band. The Phase 3 rule "never merge across > 25 km" is unaffected; an SAB simply has no distance to test.
- **D-08:** **Collisions:**
  - **Many place_ids → one business is allowed** (Google has duplicate listings too). The business's current `had_website_uri` is **true if any attached, non-tentative listing's latest observation is true**. That leans against a false "no website" lead.
  - **One place_id tying across two businesses at ≥95 goes to tentative/review.** The system never picks silently.
  - Chain-flagged businesses (Phase 3 D-11) follow the same rules. Phase 3 already keeps them out of the funnel.

### What survives the call: the website signal
- **D-09:** **Amends PLACE-02 and roadmap success criterion 2.** A **derived host class** persists beside the boolean. At call time a pure, unit-tested string match classifies `websiteUri` into `none | business_site_dead | social | directory | platform_subdomain | other`, and then **the URL itself is discarded**. The host-pattern table follows PITFALLS Pitfall 4:
  - `business.site` / `g.page` → dead;
  - facebook / instagram / linktr.ee / beacons.ai → social;
  - yelp / yellowpages / bbb / nextdoor / mapquest / manta → directory;
  - wixsite / square.site / myshopify / godaddysites → platform subdomain.

  This captures the prime `business.site` cohort at $0 without storing a URL. Phase 5 probes `other` through durable URLs (Overture `websites[]`) or web search, never through a stored Places URL. The planner updates REQUIREMENTS.md PLACE-02 and the ROADMAP criterion text in the same plan that introduces the column.
- **D-10:** **Observations are append-only.** There is one immutable row per (business, `place_id`, run) holding:
  - the boolean;
  - the host class;
  - the SKU tier the observation was billed at;
  - `observed_at`;
  - the derived `pureServiceAreaBusiness` flag (see D-13);
  - lat/lng with a **30-day `expires_at`**.

  The business's current signal is its latest row. "Got a website since last run" becomes a query, which Phase 9's lead auto-retire reads. UPDATE/DELETE are revoked by grant, except the coordinate purge (D-12), which nulls coordinates and never deletes the observation.
- **D-11:** **Attribution is inline with the signal (PLACE-06).** It uses the Phase 3 source-tag pattern, e.g. "No website listed · Google Maps · Sep 23", as another source tag beside "Comptroller" and "Overture". A test pins that the tag renders **wherever** a Places-derived signal renders. No non-Google map is ever rendered on a screen that shows Places content (DATA-SOURCES § Google attribution, §3.2.3(e) / §B.14.2).
- **D-12:** **The TTL purge is observable.** `/sources` gains a **"Google Places (transient)"** row showing:
  - place_ids held;
  - coordinates held;
  - the oldest coordinate's age (always < 30 days);
  - the last purge time and the rows purged.

  The purge is a **daily Vercel Cron** job (Pro). It must not depend on a run happening. A database-level proof ensures no coordinate older than 30 days can be read (a CHECK or read-path guard, plus a named test), so a missed cron day is visible and never silently in breach.
- **D-13:** `pureServiceAreaBusiness` joins the field mask; it's Pro tier, so free at the margin under Enterprise. Update `fieldMaskTier`'s PRO list and `PLACES_TEXT_SEARCH_FIELD_MASK`, keeping the M11 mutation test meaningful. The flag persists on the observation as a derived signal and is named in D-01's legal enumeration. Nothing else from the response persists.

### How a run executes
- **D-14:** **The executor is a Vercel Workflow (Workflow DevKit, `workflow@4.x`).** Phase 2's Run button (`queue-run.ts`, which already creates a `queued` run and holds the worst-case reservation) starts a workflow run. There is **one step per (Places type × tile) request** (not per business, per ARCHITECTURE anti-pattern 2). It is resumable across crashes and deploys and drivable from danlo's phone. Phase 9's scheduler calls the same workflow. This is the repo's first Workflow; research covers setup, local dev, testing and the Vercel project config.
- **D-15:** **Spend control is two layers inside the monthly cap.**
  1. **Every request reserves on the meter just in time**, before it leaves (roadmap criterion 5). A denial ends the run as `partial` with its stopped reason. A refused reservation is zero rows, not an exception (the Phase 2 pattern).
  2. **A run may spend at most 2× its estimate-high.** Past that it stops as `partial` with `stopped_reason` "exceeded estimate", and the report names the tiles still subdividing. The multiplier is a **committed constant** beside `FAN_OUT` in `src/lib/estimate/assumptions.ts`.

  The Phase 2 run-level hold is settled or released against the actual spend; the planner reconciles the run hold with per-call reservations so nothing is double-counted.
- **D-16:** **Run scope in this phase:**
  - **Run** = a **full Enterprise sweep** of the preset version's cells. The Phase 6 slice needs this.
  - **Partition assignment** (cell → ISO week, stable hashing, so a cell stays in its week across runs and cells are added without reshuffling) and the **IDs-Only change-detection pass** (diff each tile's place_id set against D-06's membership records; only changed tiles become Enterprise candidates) are built and tested as functions.
  - The preset page gains two manual actions: **"Run this week's partition"** and **"Check for changes (free)"**. Both go through the same meter and kill switch; IDs-Only still writes a zero-cost ledger row, since the free-allowance math needs every paid-SKU call and zero rows cost nothing. PLACE-04 closes here; Phase 9 only puts them on a clock.
- **D-17:** **The run report is a live, ledger-style run detail page** that refreshes while the run is `running`. It shows:
  - status and stopped reason;
  - requests by SKU;
  - cost versus the estimate range;
  - tiles searched, saturated, subdivided, and **still truncated at minimum size**, shown as an explicit truncation warning, never a silent partial (criterion 3);
  - outcomes: attached / tentative / unmatched (per cluster) / `had_website_uri` split / host-class counts.

  The tone matches `/sources`. Layout is the UI pass's.

### Decisions from the research round (danlo, 2026-09-23, after 04-RESEARCH.md)
- **D-18:** **The estimate becomes type-aware.** `requestsLo = Σ types × PAGES_LO`, `requestsHi = Σ types × PAGES_HI × FAN_OUT` (FAN_OUT now means tiles-per-type). Phase 2's displayed numbers change: the RGV baseline moves from 612 to ~3,978 requests high (~$104 gross), so a **full RGV sweep is refused at admission** and a partition (~¼) or a one-city × one-cluster run fits. The committed cost-model test is updated with the new exact numbers. The D-15 ceiling is enforced on **requests** (`runs.ceiling_requests = ceil(RUN_CEILING_MULTIPLIER × requestsHi)`), not dollars, since estimate-high is $0 inside the free allowance.
- **D-19:** **Daily quota → stop as `partial` now.** A Google daily-quota 429 ends the run `partial` with stopped reason `google_daily_quota`. The 100/day quota stays for the D-04 run. Raising the quota vs multi-day (sleeping) runs is decided later on D-04's real numbers — not built this phase.
- **D-20:** **Fixtures are anonymized, never raw.** D-04's recording script anonymizes in memory before writing: it keeps structure, pagination, counts, `place_id`s, SAB flags and host classes, and synthesizes names, addresses, phones and URL hosts. No Google text is ever committed to git. Fixture files carry a `synthetic`/`anonymized` sidecar marker. Added to D-01's legal enumeration.
- **D-21:** **Rating and review count: in the mask, memory-only.** They stay requested (free at the margin under Enterprise), nothing uses or persists them in this phase, and D-01's legal checkpoint enumeration adds "a derived review-volume bucket (future, Phase 6)" so Phase 6 is not blocked by a later surprise.

### Claude's Discretion
- **Tiling geometry.** Quadtree over `locationRestriction` rectangles; the starting tile per geography unit; minimum tile size and maximum depth; the saturation test (a full 20 + 20 + 20 with a `nextPageToken` exhausted at 60, or the Pitfall 7 heuristic). Tile overlap and double-billing avoidance follow PITFALLS Pitfall 7. The constants are committed and tuned on the D-04 run.
- **Query shape.** `includedType` + `strictTypeFiltering` per Places type versus a `textQuery` per type. One request builder module owns the field mask, `includePureServiceAreaBusinesses: true`, and the type/region/language parameters, so none can be omitted per call site (Pitfall 1 / Pitfall 8).
- **Validating every `placesTypes` entry in `src/seed/data/clusters.json` against the Places API (New) type table** before the first paid call. This was promised in the seed's own `placesTypesNote`. An invalid type fails a named test; the corrected list is committed.
- **Schema shapes and names:** the place attachment join table (with `status in ('attached','tentative','rejected')`, score, features jsonb), observations, tile membership, and run-tile progress. Every new table has `org_id`, RLS, explicit grants and a `TENANT_TABLES` row. Observations are append-only by grant. A `google_places` source record's retention class is `ephemeral`, and the Phase 1 composite FK must keep refusing any durable field that cites it; re-prove it for every new pair.
- **How pagination is priced and reserved.** Each `pageToken` page is a separately billed request (MEDIUM confidence; verify against the first invoice after D-04). Reserve per page.
- Settling reservations for failed or timed-out requests, retries (non-retryable on a budget denial; bounded retries on 5xx/429 that reserve again), and Workflow step idempotency keyed by (run, tile, type, page) so a replay never double-bills.
- The key's application restriction: Vercel functions have no fixed egress IP, so the key is API-restricted only and server-only (never `NEXT_PUBLIC_`). Document this in the runbook.
- Where the review queue shows tentative Places attachments: a second item kind in `/review` or a filter. Reuse the Phase 3 pair card and chips.
- The IDs-Only request mask (Essentials only, `places.id` + `nextPageToken`) and how detection handles a tile whose id set shrinks (gone) versus grows (new).
- e2e specs for the run page and `/sources` Places row. Fixtures must avoid the `preset-detail.spec.ts` two-databases trap: self-skip unless local, or seed through the product.
- The `presets.spec.ts` teardown owed since Phase 2 (no product delete path). A plan in this phase may own the preset archive/delete action if it is cheap; otherwise it stays deferred.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/ROADMAP.md` § Phase 4: goal, five success criteria, dependency ordering (budget before first paid call, spine before Places), `/gsd-secure-phase` applies, research flag ("light", saturation tuning empirical, the §3.2.3(d)(iii) read before the first production call, adapter behind an interface).
- `.planning/REQUIREMENTS.md`: PLACE-01…PLACE-06 (this phase); BUDG-03 (the carried GCP daily quota; closes here); BUDG-01/BUDG-02 (the meter every call goes through); VERIF-02 (Phase 5's `business.site` cohort, which consumes D-09's host class).
- `.planning/PROJECT.md`: Constraints (Legal, Budget), Context ("Legal read pending", cost model), Key Decisions (the D-01 checkpoint writes here).

### Research (project-level, already decided; do not re-research)
- `.planning/research/DATA-SOURCES.md` § (a) Google Places API (New) (~L82–281): SKUs, field tiers, Terms §3.2.3, what may be cached; § "Google attribution, and the non-Google-map trap" (~L896–903).
- `.planning/research/PITFALLS.md`:
  - Pitfall 1: the field mask selects the SKU (~L16–53).
  - Pitfall 2: nightly full crawl doesn't fit $50 (~L54–106).
  - Pitfalls 3 and 4: `websiteUri` absent ≠ no site, present ≠ has site; the host-pattern table and the `business.site` cohort (~L107–173).
  - Pitfall 7: tiling a county, coverage holes and double-billing (~L237–277).
  - Pitfall 8: service-area businesses, `includePureServiceAreaBusinesses`, storing the flag (~L278–305).
  - Pitfall 9: read-then-spend races, retry amplification (~L306–341).
  - Pitfall 11: storing Places content (~L378–410).
- `.planning/research/ARCHITECTURE.md`:
  - Pattern 1: uniform source adapter with a cost estimate in the interface (~L389).
  - Pattern 2: reserve → call → settle (~L409).
  - Pattern 4: Postgres as the work queue (~L487).
  - Anti-pattern 1: persisting Places fields in the canonical record (~L779).
  - Anti-pattern 2: one workflow step per business (~L785).
- `.planning/research/STACK.md` § "Google Places API (New) — use REST, not the SDK" (~L255); § (a) Scheduler + budget cap (Vercel Workflow DevKit chosen, `workflow@4.x`, limits: 10,000 steps / 25,000 events per run, child workflows past ~2,000 events); Version Compatibility (`workflow@4.x` pinned to `iad1`, stay on 4.x).

### Locked by earlier phases
- `.planning/phases/01-foundations-tenancy/01-CONTEXT.md`: tenancy, append-only events, drizzle-kit authority, the RLS proof standard, the retention-class CHECK and durable-cites-durable composite FK (`23514` / `23503`).
- `.planning/phases/02-budget-governor-search-presets/02-CONTEXT.md`:
  - D-06/D-07: the estimate range and `FAN_OUT`.
  - D-10/D-12: cap per org; `partial` at 100 %; no outbound alerts.
  - D-13: one cap.
  - D-15/D-16: runs reference versions.
  - Discretion notes on the quota value and `fieldMaskTier`.
- `.planning/phases/02-budget-governor-search-presets/deferred-items.md`:
  - WR-02, "one cap" as a per-provider meter; the Firecrawl trap is Phase 5's, but Places is the only reserving provider here.
  - The 80 %/100 % state shots and `budget-banner` production skips deferred to Phase 4.
  - The `presets.spec.ts` teardown owed.
- `.planning/phases/03-free-data-spine-entity-resolution/03-CONTEXT.md`:
  - D-07/D-09/D-10/D-11: the matching rules, weights module and fixture, 25 km rule, chain flag.
  - D-13/D-15/D-16: the review queue pair card, chips and ordering.
  - D-17/D-18: `/sources`, business detail, inline source tags.
  - Deferred: the SAB branch, which D-07 here closes.
- `.planning/phases/03-free-data-spine-entity-resolution/deferred-items.md`: resolve-pass performance notes (B3 lateral 6–12 min; 343 ms/merge). In-memory matching per Places result must not inherit the org-wide scan; block by phone / name trigram / geohash.
- `.planning/phases/02-budget-governor-search-presets/02-UI-SPEC.md` and `.planning/phases/03-free-data-spine-entity-resolution/03-UI-SPEC.md`: the design system and screen patterns the Phase 4 UI pass extends.
- `.planning/CONVENTIONS.md`: Tenancy, Claims, Database access (`withOrg()`), Migrations (`db:custom`), Grants (`TENANT_TABLES`).
- `docs/runbooks/google-quota.md`: the 100/day value, derivation, and console path; D-03's checkpoint extends it with project, key and restriction steps.
- `docs/deploy.md`: env var handling and the owner-credential prohibition.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/budget/field-mask-tier.ts`: `fieldMaskTier()` (refuses unknown fields) and `PLACES_TEXT_SEARCH_FIELD_MASK`, the mask Phase 4 sends. The one-module rule for the `X-Goog-FieldMask` header is enforced by a repo grep in `tests/unit/field-mask-tier.test.ts`. D-13 adds `places.pureServiceAreaBusiness` to PRO and to the mask.
- `src/lib/budget/price-book.ts`: `PRICE_BOOK`, `priceRequests()`, `freeRemaining()`. Cost derives from the mask sent, and zero-cost free-tier calls are still ledgered.
- `src/server/actions/queue-run.ts`: creates the `queued` run and reserves the worst case (`costMicroUsdHi`); a denial is zero rows; the true-up is `app.settle_reservation` (Phase 4's to call). The Workflow start hooks in here.
- `src/db/schema/runs.ts`: `runs` with status `queued/running/complete/partial/refused/failed`, `stopped_reason`, `cost_micro_usd` bigint µUSD, `calls_count`, `started_at`/`finished_at`; no event trigger by design.
- `src/db/schema/budget.ts`, `src/server/queries/budget.ts`, `app.reserve_budget` / `app.settle_reservation` (drizzle migrations): the race-free meter proven by the 40-way burst.
- `src/lib/estimate/` (`expand-cells.ts`, `assumptions.ts` with `FAN_OUT`, `PAGES_LO/HI`, `estimate.ts`): the cell list the sweep executes. The D-15 run ceiling constant goes beside `FAN_OUT`.
- `src/seed/data/clusters.json`: `placesTypes` per cluster, not yet validated against Google's type table.
- `src/db/schema/source-records.ts`: `source_key` already admits `google_places`; `retention_class in ('durable','ephemeral')`; `expires_at`.
- `src/lib/resolve/` (`score.ts` — the weights and thresholds; `block.ts`, `derivation.ts`, `chain.ts`, `merge.ts`, `survivorship.ts`) plus the Phase 3 RGV pair fixture: the scoring D-05 reuses in memory.
- `src/lib/normalize/` (name, phone, address): Places result fields are normalized in memory through the same functions before scoring.
- `src/app/(app)/review/page.tsx` (the Phase 3 queue), `/sources`, `/businesses/[id]` with inline source tags: extended for tentative attachments, the Places row, and the Google Maps tag.
- `tests/unit/no-google-credential.test.ts`: must be amended deliberately to sanction exactly the adapter module.
- `src/env.ts`: fail-loudly env guard; gains the Places key and `PLACES_MODE`.

### Established Patterns
- Every table: `org_id`, RLS, explicit grants in the creating migration, a `TENANT_TABLES` row; append-only by grant where immutable.
- Proof standard: watched failing first, SQLSTATE pinned, one refused statement per rolled-back transaction, one named mutation per guard, reverted, and read the failing test's NAME.
- Money is µUSD bigint; timestamps `timestamptz`; zone and locale pinned (America/Chicago).
- CI never reaches a paid or external API: msw-recorded payloads (Phase 3 did the same for Socrata/S3/Census).
- Drizzle `sql` traps (a JS array interpolates as N placeholders; a `Date` through `tx.execute` throws; `timestamptz` comes back as a string).
- pnpm only through the store launcher; `$PNPM test:x -t "name"` (the `--` form does NOT filter under pnpm 12); run typecheck + build after every parallel merge; add producer→consumer contract tests where one plan writes a payload another reads (Phase 3 lesson: `lng` vs `lon`).
- No scratch `.ts` under the repo (the deploy type-checks it).

### Integration Points
- `src/lib/places/` (new): the request builder, adapter, host-class classifier, tiler, matcher.
- A Workflow definition (new, first in repo) started from `queue-run.ts` and from the two new preset actions.
- `vercel.json` (currently only `framework: nextjs`, no crons) / Vercel Cron: the daily coordinate purge is the repo's first cron.
- `src/app/(app)/runs/[id]` (new run detail page), `/presets/[id]` (two new actions), `/review` (tentative attachments), `/sources` (Places row), `/businesses/[id]` (the Google Maps-tagged signal).
- Phase 5 reads the host class and `had_website_uri`. Phase 6 reads the latest non-tentative observation. Phase 9 schedules D-16's two operations and reads D-10's history for "got a website".

</code_context>

<specifics>
## Specific Ideas

- The signal reads like the other source tags: "No website listed · Google Maps · Sep 23".
- The run report reads like a ledger: requests by SKU, cost versus estimate, tiles searched / saturated / subdivided / still truncated, then attached / tentative / unmatched per cluster.
- "Google places that matched nothing in the spine", counted per cluster, is how the Comptroller/Overture coverage gap for trades gets measured.
- The first real run is McAllen × home services (or the city/cluster danlo names at the checkpoint), kept inside the free 1,000 Enterprise requests.
- Preset page actions: **Run** (full sweep) · **Run this week's partition** · **Check for changes (free)**.

</specifics>

<deferred>
## Deferred Ideas

- **Google-only candidates as a lead source.** Places results with no spine match (D-06 keeps only their `place_id`). Pursuing them means displaying Google content live at view time, which changes the legal posture and needs per-candidate lookups (contradicts criterion 1). Revisit with D-06's measured gap numbers.
- **In-app `PLACES_MODE` toggle.** Rejected for v1 (D-02); env-only.
- **Scheduling partitions weekly and detection nightly.** Phase 9.
- **The `business.site` → `dead` verdict and probing `other` URLs.** Phase 5/6, consuming D-09's host class.
- **Preset archive/delete path and the `presets.spec.ts` teardown.** Owed since Phase 2; in scope only if a Phase 4 plan picks it up cheaply (see Discretion).
- **D-11 chain amendment (≥3 members >500 m apart), resolve-pass performance fixes, and the "X merged into X" header.** Phase 3 follow-ups; not this phase's unless a Phase 4 plan touches the same code.

</deferred>

---

*Phase: 04-places-transient-verifier*
*Context gathered: 2026-09-23*

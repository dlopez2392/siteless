# Roadmap: Siteless

## Overview

Siteless ships in nine phases that follow a dependency graph, not a preference. A tenant-isolated, audited schema comes first because nine of research's seventeen catalogued pitfalls are schema decisions that turn into cross-cutting migrations if deferred. Then two independent tracks run in parallel: the cost ledger and atomic cap (nothing may spend a cent outside the meter) and the free-data spine (Overture + TX Comptroller as the durable, license-clean business record). Only then does Google Places enter — as a transient verifier that stores a `place_id`, a 30-day lat/lng and one derived boolean, and discards the rest. Verification writes immutable receipts; a separate, pure, versioned classifier reads only those receipts, so re-classifying history costs $0. Then the build stops: danlo runs one city × one industry by hand and eyeballs ~50 verdicts before anything is automated. Only after that gate do the three consumer-facing tracks — phone triage, the BIS handoff, and the scheduler with the measured false-positive rate — get built.

**Granularity note:** config is `standard` (5–8 phases). This roadmap lands at **9**. The four hard ordering constraints plus two parallel pairs forbid further compression without collapsing a legal boundary (free-data spine before Places), a purity boundary (receipts before classifier), or a quality gate (vertical slice before scheduler). v1 is 63 requirements; 9 phases is ~7 requirements each.

**Requirement count correction:** REQUIREMENTS.md stated 57 v1 requirements. A direct count of REQ-IDs in the v1 section returns **63**. All 63 are mapped below; the coverage counters in REQUIREMENTS.md have been corrected.

## Ordering Constraints (do not reshuffle)

1. **Budget before the first paid call** — Phase 2 precedes Phase 4. The cap is a feature of the first billable call, not of the scheduler.
2. **Free-data spine before Places** — Phase 3 precedes Phase 4. Legal, not preference: Places content may not be the durable record, so a durable name/address/phone must already exist for a `place_id` to attach to.
3. **Receipts before the classifier** — Phase 5 precedes Phase 6. Built together, the purity boundary does not survive a deadline.
4. **A hand-triggered vertical slice before the scheduler** — Phase 6's closing gate precedes Phases 7, 8 and 9. A nightly crawl producing confident nonsense is worse than no crawl.

## Parallel Tracks

Parallelization is enabled in config.

- **Phase 2 ∥ Phase 3** — budget governor and free-data spine share only Phase 1. Shared contract: the geography/cluster seed data (SRCH-02) is defined in Phase 2 and read by Phase 3's ingest scope; agree it before either starts.
- **Phase 7 ∥ Phase 8 ∥ Phase 9** — all three consume the same trustworthy pipeline and none depends on another's internals. Shared contracts: the accept-action idempotency key format (Phase 7 ↔ Phase 8) and the label source for FP-02 (Phase 7 → Phase 9, which is why the FP dashboard plan lands after Phase 7's triage control, while the scheduler plans do not).
- **External, from day one:** the BIS inbound-lead endpoint lives in `bis-platform` and is not on this critical path. Its request shape and `Idempotency-Key` semantics can be specified now; Phase 8 builds against a documented contract stub.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundations & Tenancy** - Org-scoped auth, RLS proven by a refused cross-org statement, and the schema constraints that keep Places content out of the durable record (completed 2026-09-22)
- [x] **Phase 2: Budget Governor & Search Presets** - Nothing spends outside the meter; danlo defines and costs a search before running it (completed 2026-09-22)
- [ ] **Phase 3: Free-Data Spine & Entity Resolution** - Overture + TX Comptroller become one deduped, provenance-tracked RGV business record
- [ ] **Phase 4: Places Transient Verifier** - Google answers "is there a website URI?" under an allow-listed Enterprise field mask, and almost everything is discarded
- [ ] **Phase 5: Verification & Receipts** - Cheapest-first probe ladder writes immutable receipts, including negative evidence, one tap from the lead
- [ ] **Phase 6: Classifier, Scorer & Vertical-Slice Gate** - Six-way verdict and glass-box score over stored receipts, proven by hand on ~50 real verdicts
- [ ] **Phase 7: Triage & Mobile PWA** - The morning phone loop: swipe, call, undo, receipts, compliance gating
- [ ] **Phase 8: BIS Handoff & Export** - Accepted leads reach BIS exactly once as tagged contacts, or leave as CSV with provenance
- [ ] **Phase 9: Scheduled Operation & Measured Accuracy** - The pipeline runs itself inside the cap and publishes what it cost and how often it was wrong

## Phase Details

### Phase 1: Foundations & Tenancy
**Goal**: A deployed, org-scoped application skeleton where every table is tenant-isolated, every state change is attributable, and the durable record is legally constrained by the schema rather than by convention.
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06
**Success Criteria** (what must be TRUE):
  1. danlo signs in with Clerk on a deployed Vercel app and every request he makes is scoped to his org.
  2. A statement issued by a second seeded org against danlo's rows is refused — proven through a user-role connection carrying v2 Clerk claims (`o.id`), SQLSTATE `42501` pinned, watched failing first, one refused statement per rolled-back transaction.
  3. An attempt to persist Google Places content into a durable field is refused by a database constraint, not by a code review.
  4. Every state change on a record shows which actor made it and when, with all timestamps stored as `timestamptz` and rendered in `America/Chicago` (zone and locale pinned in tests).
  5. `legal_name`, `display_name` and internal annotations are three distinct fields, and a test proves the internal annotation cannot reach an export or push payload.
**Plans:** 12 plans across 7 waves (01-12 is a gap-closure plan added during execution)

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Repo scaffold, pinned toolchain, fail-loudly env guard (wave 0)
- [x] 01-02-PLAN.md — Local PostgreSQL 18 + Supabase/Clerk credentials and dashboard settings (wave 0, checkpoints)
- [x] 01-03-PLAN.md — Test harness: vitest configs pinned to UTC, DB fixtures, Playwright, CI (wave 1)
- [x] 01-04-PLAN.md — drizzle-kit bootstrap migration: Supabase-shaped roles, app schema, app.jwt() (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-05-PLAN.md — Tenancy schema, RLS policies and the refused cross-org statement (wave 2)
- [x] 01-06-PLAN.md — Internal-annotation sentinel, timezone discipline, sole-organization port (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-07-PLAN.md — Places retention constraints and the durable-cites-durable composite FK (wave 3)
- [x] 01-08-PLAN.md — Clerk shell: proxy, withOrg, requireOrg, JIT org, /no-access, /api/health (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-09-PLAN.md — Event triggers, updated_at/updated_by, append-only grants, CONVENTIONS.md (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 01-10-PLAN.md — Vercel project, production schema migration, environment variables (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 01-11-PLAN.md — Deploy, e2e against the real URL, criterion-1 sign-in, phase gate (wave 6)
- [x] 01-12-PLAN.md — Gap closure: revoke Supabase platform grants (TRUNCATE bypasses RLS) and the default ACL, parity on both databases (wave 6, found by 01-10)
**Security**: /gsd-secure-phase applies — RLS policies, Clerk claim shape, tenant isolation.
**Notes**: Ships an unstyled app shell only; the design system is established in Phase 2's UI pass, which is the first phase with real screens.

### Phase 2: Budget Governor & Search Presets
**Goal**: danlo can define and cost a search before it runs, and no code path in the system can spend a cent outside an atomic, race-free meter.
**Depends on**: Phase 1
**Parallel with**: Phase 3 (shared contract: the RGV geography and cluster seed data defined here is what Phase 3's ingest scope reads)
**Requirements**: BUDG-01, BUDG-02, BUDG-03, BUDG-04, SRCH-01, SRCH-02, SRCH-03, SRCH-04
**Success Criteria** (what must be TRUE):
  1. danlo saves a named preset defined as one or more industry clusters × a geography (named city list, county, or radius around a geocoded point), with the four clusters, the RGV city list and the four RGV counties already seeded on first run.
  2. Before saving or running, the preset shows an estimated cost and an estimated result count; a Texas-wide preset is expressible and shows its cost multiplier.
  3. Editing a preset creates a new version, and a past run still points at the version that produced it.
  4. A spend view shows month-to-date spend versus the cap broken down by provider, fed by a ledger row per paid call.
  5. With the cap reached, a concurrent burst of workers is refused at 100% (and warned at 80%) with no over-spend — proven by a concurrency test — and a Google Cloud per-API daily quota stands as an independent second wall.
**Plans:** 15 plans across 7 waves

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Design system birth: shadcn init, painted tokens, Inter, theme, toaster, jsdom lane
- [x] 02-02-PLAN.md — Seed data (4 clusters, 17 RGV cities, 254 counties, outlet matrix), Census fixtures, concurrency harness, the Google-credential and PG17 guards
- [x] 02-03-PLAN.md — Search & reference schema: nine tables, org_id IS NULL policies, grants, version immutability, triggers
- [x] 02-04-PLAN.md — Cost model: SKU price book, fieldMaskTier, micro-USD money, the Chicago budget month

**Wave 2** *(blocked on Wave 1)*
- [x] 02-05-PLAN.md — Budget schema + the race-free meter: reserve, self-heal, settle, set_budget_cap
- [x] 02-06-PLAN.md — Idempotent seed loader, and the built-in and preset-versioning proofs
- [x] 02-07-PLAN.md — Estimator, Census geocoder, server-safe UI maps

**Wave 3** *(blocked on Wave 2)*
- [x] 02-08-PLAN.md — The meter proofs: 40-way concurrent burst, thresholds, admin gate, Chicago month in SQL
- [x] 02-09-PLAN.md — Six server actions, two query modules, and the requireOrg-first static guard

**Wave 4** *(blocked on Wave 3)*
- [x] 02-10-PLAN.md — App shell, persistent budget banner, organization settings, the e2e testid move

**Wave 5** *(blocked on Wave 4)*
- [x] 02-11-PLAN.md — Preset list and preset editor with the live debounced estimate
- [x] 02-12-PLAN.md — Preset detail: version history, duplicate, run drawer with its refusal state
- [x] 02-13-PLAN.md — Spend view and budget settings, including BUDG-03's second-wall card

**Wave 6** *(blocked on Wave 5, checkpoints)*
- [x] 02-14-PLAN.md — Production migration and seed, Google quota and Vercel Pro checkpoints

**Wave 7** *(blocked on Wave 6, checkpoints)*
- [x] 02-15-PLAN.md — Deploy, e2e on the real URL, both-theme screenshot review, gate mutations M7–M12, close VALIDATION
**UI hint**: yes
**Security**: /gsd-secure-phase applies — budget enforcement is a spend-control boundary; the reserve→spend→true-up path must be race-free and unbypassable.
**Notes**: The cost estimator is built against the real cell list as a committed test, not a spreadsheet; its fan-out multiplier is trued up with real invoice data at the Phase 6 gate.

### Phase 3: Free-Data Spine & Entity Resolution
**Goal**: A durable, license-clean canonical business record for the RGV — Comptroller plus Overture, deduped into one lead per business with per-field provenance — existing before any Google call is made.
**Depends on**: Phase 1
**Parallel with**: Phase 2 (consumes the geography/cluster seed defined there)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DEDUP-01, DEDUP-02, DEDUP-03, DEDUP-04
**Success Criteria** (what must be TRUE):
  1. A re-runnable ingest loads TX Comptroller active sales-tax permits and Overture places for the four RGV counties, Texas side only, and a re-run reports added/changed/unchanged counts instead of duplicating rows.
  2. Any business record shows which source supplied each field, and a durable field can only cite a durable source.
  3. The same business arriving from both sources resolves into one lead at ≥95 confidence on a trusted identifier; 80–95 lands in a review queue danlo can work; below 80 is ignored — with names, addresses and phones normalized (case, accents, suite noise, E.164) before matching.
  4. A merge can be undone, every parent record survives the merge, and the external lead key is unchanged by merge or unmerge.
  5. A city, county or radius search never returns a Mexican-side result — proven against a naive RGV bounding box, which is 42% Mexico.
**Plans:** 22 plans across 8 waves

Plans:
**Wave 1**
- [ ] 03-01-PLAN.md — Toolchain, the extensions migration (pg_trgm + unaccent, FIRST of the phase) and `app.distance_m()`
- [ ] 03-02-PLAN.md — The scorer, its pinned ten-pair fixture, and the Crockford external lead key
- [ ] 03-03-PLAN.md — Socrata client lift, permits + closures transforms (unpadded county codes), recorded msw fixtures
- [ ] 03-04-PLAN.md — Six-destination nav (Leads / Operations, four phone tabs + More sheet), the full copy table, touch-targets fix

**Wave 2** *(blocked on Wave 1)*
- [ ] 03-05-PLAN.md — Spine schema: five new tables, three new provenance FKs, grants, triggers, the widened audit lists
- [ ] 03-06-PLAN.md — Normalization (TypeScript is authoritative — `unaccent` is STABLE) and the two grep gates
- [ ] 03-07-PLAN.md — Census batch geocoder: ragged lines, ID rejoin, longitude first, bounded retry

**Wave 3** *(blocked on Wave 2)*
- [ ] 03-08-PLAN.md — Overture `basic_category` → cluster mapping seed and its reference-row proofs
- [ ] 03-09-PLAN.md — The shared ingest write path, DB fixtures, DATA-04's four proofs, the external key and criterion 5

**Wave 4** *(blocked on Wave 3)*
- [ ] 03-10-PLAN.md — Blocking (the `cross join lateral` shape), the 25 km gate, the block cap, chain detection
- [ ] 03-11-PLAN.md — Survivorship, merge and unmerge, with the three SECURITY DEFINER writers
- [ ] 03-12-PLAN.md — `scripts/ingest-comptroller.ts`: permits, closures, the inline Census geocode, statewide chain names
- [ ] 03-13-PLAN.md — `scripts/ingest-overture.ts`: the DuckDB bbox range-read, the pure transform, the committed fixture

**Wave 5** *(blocked on Wave 4)*
- [ ] 03-14-PLAN.md — `scripts/resolve.ts`: block → score → auto-merge → enqueue, cluster-aware
- [ ] 03-15-PLAN.md — Three query modules and two server actions

**Wave 6** *(blocked on Wave 5)*
- [ ] 03-16-PLAN.md — `/review`: the candidate pair, the chip band, three actions, no optimistic advance
- [ ] 03-17-PLAN.md — `/sources`: the four-row ledger, the composed confidence distribution, the attribution block
- [ ] 03-18-PLAN.md — `/businesses`: search, filters, append paging
- [ ] 03-19-PLAN.md — `/businesses/[id]`: ten fields with inline source tags, merge history, unmerge
- [ ] 03-20-PLAN.md — The desk run: real numbers committed, the confidence cutoff and the ten verdicts confirmed (checkpoint)

**Wave 7** *(blocked on Wave 6, checkpoints)*
- [ ] 03-21-PLAN.md — Production migration and seed, deploy, the two chrome-only e2e specs, the owed teardown

**Wave 8** *(blocked on Wave 7, checkpoint)*
- [ ] 03-22-PLAN.md — Gate mutations M13–M25, both-theme screenshot review, close 03-VALIDATION
**UI hint**: yes
**Security**: /gsd-secure-phase applies — bulk ingestion, new org-scoped tables and their RLS policies.
**Research flag**: yes — Overture's real RGV duplicate rate, junk rate and correct `confidence` cutoff are asserted, not measured; measure during ingest. Build on `basic_category`, not the `categories` field removed in the 2026-09-23.0 release.

### Phase 4: Places Transient Verifier
**Goal**: Google Places answers "does this business have a website URI?" as an authoritative, billed, transient verifier whose response is almost entirely discarded.
**Depends on**: Phase 2 (budget cap must exist before the first billable call) and Phase 3 (durable record must exist before a `place_id` can attach to anything)
**Requirements**: PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06
**Success Criteria** (what must be TRUE):
  1. A Text Search runs against a hard-coded field-mask allow-list; `fieldMaskTier()` refuses an unknown field, and Place Details is unreachable per candidate.
  2. After a run, the only Places-derived data on disk is `place_id`, lat/lng younger than 30 days, and a derived `had_website_uri` boolean — the TTL purge is observable — and wherever a Places-derived signal is displayed, Google attribution is displayed with it.
  3. A search that saturates the 60-result ceiling is detected, its tile subdivided, and the run reports truncation rather than returning a silent partial.
  4. Pure service-area businesses (trades with no storefront) appear in results, and Enterprise sweeps run over rotating weekly partitions of the (cluster × city × type) cell list while change detection uses the free IDs-Only SKU.
  5. Every outbound Places call is reserved against the budget before it leaves and lands in the ledger with its SKU; with the cap reached, the run stops instead of calling.
**Plans:** TBD
**Security**: /gsd-secure-phase applies — external paid API, key handling, retention/TTL enforcement, spend gating.
**Research flag**: light — ToS and pricing are settled by research; tile-saturation tuning against real RGV density is empirical. The §3.2.3(d)(iii) legal read belongs before this phase's first production call; the adapter sits behind an interface so a "no" is a config change.

### Phase 5: Verification & Receipts
**Goal**: Every claim about a business's web presence is backed by an immutable, human-readable receipt — produced cheapest-first, budget-gated, and stored separately from any verdict.
**Depends on**: Phase 4
**Requirements**: VERIF-02, VERIF-03, VERIF-04, VERIF-05, VERIF-07
**Success Criteria** (what must be TRUE):
  1. One tap from a lead, danlo sees a receipts timeline — newest first, raw artifact behind a disclosure — including negative evidence that records what was searched and found nothing.
  2. Probes cover DNS resolution, HTTP and HTTPS reachability, redirect chain and final URL, HTTP status, TLS validity and expiry, parked/placeholder heuristics, and the dead `*.business.site` cohort, each writing its own receipt with `{probe_type, target, outcome, status, final_url, observed_at, source, cost}`.
  3. Social and directory presence (Facebook, Instagram, Linktree, Yelp, Yellow Pages) is discovered from web search and Overture `socials[]`, and no code path calls the Yelp or Meta APIs.
  4. A receipt cannot be updated or deleted — the grant is revoked, not merely policied — and the probe layer never writes a verdict.
  5. Given a budget smaller than the candidate set, the cheap pre-filter ranks, the top-N are verified, and the remainder are visibly labelled `unverified` rather than silently dropped.
**Plans:** TBD
**UI hint**: yes
**Security**: /gsd-secure-phase applies — probing arbitrary third-party URLs (SSRF, redirect handling, response-size limits), Firecrawl key handling, spend per probe.
**Research flag**: yes — parking-provider nameserver signatures, Firecrawl's disputed per-search credit cost (docs say 2 and 10), and RGV-specific noise (bilingual names, shared strip-mall addresses, reused phones) all need real-data tuning.

### Phase 6: Classifier, Scorer & Vertical-Slice Gate
**Goal**: A verdict and a score danlo would bet a phone call on — pure, versioned, explainable, replayable at zero cost — and proven by hand on one city × one industry before anything is automated.
**Depends on**: Phase 5
**Requirements**: VERIF-01, VERIF-06, VERIF-08, SCORE-01, SCORE-02
**Success Criteria** (what must be TRUE):
  1. Every candidate carries one of six verdicts — `no presence` / `social-only` / `directory-only` / `real site` / `dead or parked` / `unverifiable` — with a confidence level and the `rule_key` that produced it.
  2. A classifier version bump re-classifies all stored history with zero external spend, proven by a replay run over stored receipts.
  3. `unverifiable` verdicts never enter the triage queue and follow their own retry policy.
  4. Each lead shows a hot / warm / cold band and a persisted component breakdown — reviews and rating, social-only presence, industry ticket size, and phone presence acting as a floor — that reproduces a historical score exactly.
  5. **GATE:** danlo has run one city × one industry end to end by hand, eyeballed roughly 50 verdicts, and recorded an explicit go/no-go plus the first real cost-per-verified-lead from an actual invoice. Phases 7, 8 and 9 do not start until that record exists.
**Plans:** TBD
**Research flag**: yes — rule thresholds are the product; budget a tuning loop against real RGV verdicts, not a one-shot build. The classifier and scorer are pure functions with zero I/O and zero `db/` imports, enforced by a lint rule rather than a convention.

### Phase 7: Triage & Mobile PWA
**Goal**: danlo works the morning queue from his phone — accepting, rejecting, snoozing and calling — with receipts one tap away and compliance enforced at the surface.
**Depends on**: Phase 6 (including the gate)
**Parallel with**: Phase 8 and Phase 9 (agree the accept-action idempotency key with Phase 8 before either starts)
**Requirements**: TRI-01, TRI-02, TRI-03, TRI-04, TRI-05, MOB-01, MOB-02, MOB-03, MOB-04, COMP-01, COMP-02, COMP-04, FP-01
**Success Criteria** (what must be TRUE):
  1. On an installed phone app, danlo works a score-ordered swipe stack — right accepts, left rejects into reason chips, long-press snoozes with a resurface date — showing a remaining count and reaching an explicit end state.
  2. Every triage action can be undone from a toast that lasts about five seconds.
  3. Tapping the number dials via `tel:`, logs the call as an activity, and prompts for an outcome on return (connected · voicemail · bad number · has a site · not interested); "has a site" retires the lead with the URL recorded as ground truth against the verdict class that produced it.
  4. The card shows name, category, city, rating and review count, verdict badge, score band and a call CTA, with low-confidence verdicts visually distinct; one tap deeper, the detail view shows the receipts timeline, score breakdown, per-field provenance, merge history, status history with actor and timestamp, outbound links and notes.
  5. The day's queue and its receipts are readable in a dead zone after the app was opened on signal; do-not-contact matches never appear in the queue; and the call CTA is greyed outside 8am–9pm `America/Chicago` with an override and a linked compliance note.
**Plans:** TBD
**UI hint**: yes
**Security**: /gsd-secure-phase applies — triage API authorization on an installed PWA, org-scoped queries, do-not-contact gating as a compliance control, cached data on a device.
**Research flag**: yes, via /gsd-ui-phase — the offline-tolerant installed-PWA daily-use surface is the primary design risk in the project; installed-PWA auth must be tested on a real iPhone, not a simulator.

### Phase 8: BIS Handoff & Export
**Goal**: An accepted lead arrives in BIS exactly once as a correctly tagged contact — or leaves as a CSV with provenance — with per-lead status danlo can see and retry, and no internal label ever in the payload.
**Depends on**: Phase 6 (including the gate); the accept trigger is contracted with Phase 7
**Parallel with**: Phase 7 and Phase 9
**Requirements**: HAND-01, HAND-02, HAND-03, HAND-04, HAND-05, HAND-06, COMP-03
**Success Criteria** (what must be TRUE):
  1. Accepting a lead queues a push to BIS as a contact under BIS's dogfood account tagged `source:siteless`, industry, city and score band, delivered through a transactional outbox rather than an inline HTTP call inside the accept transaction, and verified end to end against a documented contract stub until the BIS endpoint exists.
  2. Re-accepting or retrying the same lead updates rather than duplicates, keyed on the stable lead key that survives merges.
  3. Each lead shows `queued` / `pushed` / `failed` with a reason, and a retry action that works.
  4. Low-confidence verdicts and suppressed (do-not-contact) leads are never pushed automatically.
  5. A CSV export has a stable column contract including verdict, confidence, score, receipt count and per-field provenance, and a sentinel test scans every outbound payload and export row to prove the internal annotation never appears.
**Plans:** TBD
**Security**: /gsd-secure-phase applies — outbound webhook to BIS, raw-body HMAC signing, idempotency key handling, payload allow-list.
**Notes**: The BIS-side inbound-lead endpoint is an external dependency in `bis-platform` (v2 requirement HAND-08). Specify the request shape and `Idempotency-Key` semantics from day one so this phase never starts blocked.

### Phase 9: Scheduled Operation & Measured Accuracy
**Goal**: The pipeline runs itself on a schedule inside the cap, and the dashboard publishes what it cost and how often the verdict was wrong — the two numbers nobody in this category publishes.
**Depends on**: Phase 6 (including the gate); FP-02 additionally needs Phase 7's labels
**Parallel with**: Phase 7 and Phase 8 (scheduler plans run in parallel; the false-positive dashboard plan lands after Phase 7's triage control ships)
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-04, FP-02
**Success Criteria** (what must be TRUE):
  1. Saved presets run unattended on their schedule — weekly Enterprise partitions plus nightly free change detection — and a run that hits the budget cap stops cleanly, leaves a consistent partial result with a recorded reason, and resumes from where it stopped.
  2. Run history shows counts, duration and cost per run, and each partition cell shows when it was last swept.
  3. A "Net New" view lists leads first seen by this org in this preset, each row carrying a change type (`new` / `updated` / `unchanged` / `gone`), and an unchanged record is not re-verified.
  4. The dashboard shows a measured false-positive rate over the verdicts issued in the window, fed by every called lead's outcome plus a weekly random sample of 20 uncalled verified leads with a recording flow that prompts for the sample.
  5. Two cron ticks for the same preset on the same `America/Chicago` local date produce exactly one run, including across a DST boundary.
**Plans:** TBD
**UI hint**: yes
**Security**: /gsd-secure-phase applies — cron endpoint authentication (an unauthenticated tick is free spend), resumable-run state, cap enforcement under concurrency.

## Coverage

All 63 v1 requirements are mapped to exactly one phase. No orphans, no duplicates.

| Phase | Requirements | Count |
|-------|--------------|-------|
| 1. Foundations & Tenancy | FOUND-01…06 | 6 |
| 2. Budget Governor & Search Presets | BUDG-01…04, SRCH-01…04 | 8 |
| 3. Free-Data Spine & Entity Resolution | DATA-01…04, DEDUP-01…04 | 8 |
| 4. Places Transient Verifier | PLACE-01…06 | 6 |
| 5. Verification & Receipts | VERIF-02, VERIF-03, VERIF-04, VERIF-05, VERIF-07 | 5 |
| 6. Classifier, Scorer & Vertical-Slice Gate | VERIF-01, VERIF-06, VERIF-08, SCORE-01, SCORE-02 | 5 |
| 7. Triage & Mobile PWA | TRI-01…05, MOB-01…04, COMP-01, COMP-02, COMP-04, FP-01 | 13 |
| 8. BIS Handoff & Export | HAND-01…06, COMP-03 | 7 |
| 9. Scheduled Operation & Measured Accuracy | SCHED-01…04, FP-02 | 5 |
| **Total** | | **63** |

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9, with Phases 2 ∥ 3 and Phases 7 ∥ 8 ∥ 9 runnable concurrently.

Plan counts below are estimates until `/gsd-plan-phase` runs for each phase.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations & Tenancy | 12/12 | Complete | 2026-09-22 |
| 2. Budget Governor & Search Presets | 15/15 | Complete | 2026-09-22 |
| 3. Free-Data Spine & Entity Resolution | 0/22 | Planned | - |
| 4. Places Transient Verifier | 0/4 | Not started | - |
| 5. Verification & Receipts | 0/4 | Not started | - |
| 6. Classifier, Scorer & Vertical-Slice Gate | 0/4 | Not started | - |
| 7. Triage & Mobile PWA | 0/5 | Not started | - |
| 8. BIS Handoff & Export | 0/3 | Not started | - |
| 9. Scheduled Operation & Measured Accuracy | 0/4 | Not started | - |

---
*Roadmap created: 2026-09-20*

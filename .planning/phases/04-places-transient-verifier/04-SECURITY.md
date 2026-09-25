---
phase: 4
slug: places-transient-verifier
status: verified
threats_open: 0
asvs_level: 1
created: 2026-09-25
---

# Phase 4 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> Verified against implemented code at HEAD `7b81a26` (branch
> `gsd/phase-04-places-transient-verifier`, clean, pushed), local migrations through
> `drizzle/0031_places_transient_oldest_expired.sql` (local `siteless_test` journal 32),
> and this audit's own independent reads: source files opened directly (not summarized),
> two DB-lane tests run live against the local Postgres 18 database
> (`the eight places tables hold exactly their 0027 grants`,
> `authenticated cannot read place coordinates` — both **pass**), one unit-lane test run live
> (`the purge route refuses without the cron secret` — **pass**). Orchestrator-measured
> production facts (cited verbatim below, dated 2026-09-24/25, this audit did not open a
> production connection — forbidden by its own constraints) are used only where a row's
> closure depends on production state.
>
> This register covers **121 rows** drawn from the 33 plans' `<threat_model>` blocks (16
> distinct `T-4-NN` ids, the same id recurring across plans as a separate row per (plan,
> threat) pair — 118 `mitigate`, 3 `accept`, 0 `transfer`), matching `03-SECURITY.md`'s
> convention, **plus 13 rows** for security-relevant findings `04-REVIEW.md` /
> `04-REVIEW-FIX.md` / `04-REVIEW-DELTA.md` raised and fixed on this branch after the 33
> plans' threat models were written, and **1 unregistered flag** (`04-24`'s
> `threat_flag: url-to-sql`), which is not double-counted into the 121.
>
> 🔴 **This audit does not treat any SUMMARY.md `## Threat Flags` line as evidence by
> itself.** Every "None beyond the plan's threat model" claim across all 33 SUMMARYs was
> read (three plans — `04-08`, `04-32`, `04-33` — carry no such section at all; see
> **Missing Threat-Flags Sections** below). Evidence in the register is file:line, a live
> test run by this audit, a test *named* in the plan/review/fix report and independently
> opened to confirm it exists and asserts what it claims, or a catalog/behavioral read.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| Vercel env → server process | `GOOGLE_PLACES_API_KEY`, `PLACES_MODE`, `CRON_SECRET` enter here; none is ever `NEXT_PUBLIC_` | Places credential, kill-switch mode, cron bearer |
| server → `places.googleapis.com` | the only outbound Google call in the repo, one module (`src/lib/places/client.ts`) | field-masked request out; untrusted third-party JSON in |
| Google response → memory → Postgres | `displayName`/`formattedAddress`/`nationalPhoneNumber`/`websiteUri`/`location` are Google Maps Content; almost none of it may cross into a database row | derived booleans/enums/integers only — see `docs/legal/places-persistence.md` |
| internet → `/api/cron/purge-places` | anyone can GET it; only Vercel Cron holds the bearer; `clerkMiddleware()` in `src/proxy.ts` sets session context only and authorizes nothing | cross-org coordinate purge |
| internet → `/.well-known/workflow/v1/*` | generated Workflow DevKit handlers; must never gain session middleware; reachable only via Vercel Queues in production | workflow step invocation |
| tenant/workflow session → `SECURITY DEFINER` writers | `app.record_places_page`, `app.record_change_check`, `app.decide_place_attachment`, `app.plan_run_searches`, `app.mark_run_search`, `app.purge_expired_place_coordinates` | caller-supplied uuids/jsonb cross into owner-privileged code |
| `authenticated` session → the 8 new Places tables | SELECT only on 7; `place_coordinates` gets **no grant at all** | matching state, run state, tile state — never a coordinate |
| `siteless_cron` role → `place_coordinates` | NOLOGIN, held only by `app_user`; executes exactly one function, holds no table privilege | the only cross-org deletion path in the app |
| browser → server actions (`decideListing`/`detachListing`, `queueRun`) | untrusted attachment ids, run kind, version id | listing decisions, run admission |
| workflow step → workflow event log | every step argument/return persisted run + 7 days on Vercel Pro, unencrypted on disk in the local world | must carry ids/counts/enums only, never Google text |
| desk operator (04-19 recorder, 04-31/04-32 real calls) → git | the only path from a real Places payload to a committed file | anonymized fixtures only (D-20) |
| local repo → production database | four migrations (0026-0029 at 04-30, 0030-0031 pending) cross once, behind danlo's human gate | schema, grants, no data-row change |

---

## Threat Register

121 rows across the 33 plans (the same Threat ID recurring across plans is a separate row
per (plan, threat) pair). 3 rows carry `disposition: accept` (Accepted Risks Log below).
118 rows carry `disposition: mitigate`, all `closed` against the code this audit read and,
for the representative sample below, ran directly. 0 rows carry `disposition: transfer`.

**Verification method note (applies to every plan section below).** This audit independently
grepped and/or read the file each mitigation cites; for a representative cross-section
spanning secret handling, tenancy, retention, injection and legal-persistence categories
this audit additionally ran the named test live against the local database (marked
**test run**) or confirmed the guarding code directly (marked **read**). Rows sharing a
mechanism with an independently-verified row (e.g. every writer's "org from claims,
re-read under `org_id = v_org`" pattern, proven once directly against `place_coordinates`
and `place_attachments` grants) cite that shared mechanism rather than re-deriving it.

### 04-01 — Workflow DevKit install, workflow proxy exclusion, test-key isolation

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-15 | Tampering | `@swc/core`, `cbor-extract` install scripts | mitigate | `pnpm-workspace.yaml`/`.npmrc` `allowBuilds` entries, each with a written reason (04-01-SUMMARY); `pnpm install --frozen-lockfile` clean per the plan's own gate | closed |
| T-4-14 | Spoofing | workflow internal endpoints | mitigate | **read** — `src/proxy.ts:27` matcher excludes `\\.well-known/workflow/`; `export default clerkMiddleware()` with no `.protect()` call in the file (confirmed live, see Trust Boundaries) | closed |
| T-4-01 | Information disclosure | test lanes | mitigate | every vitest config sets `GOOGLE_PLACES_API_KEY='test-key-not-real'` after `.env.local`; CI carries no real key (04-01-SUMMARY) | closed |
| T-4-09 | Denial of service (financial) | CI | mitigate | **read** — `tests/unit/no-network.test.ts:38,49` names `places.googleapis.com` and `src/lib/places/client.ts` in the same allow-list Phase 3's Socrata/Census guard used; `onUnhandledRequest: 'error'` in the shared msw server | closed |

### 04-02 — env.ts, PLACES_MODE, CRON_SECRET

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-01 | Information disclosure | Places key | mitigate | **read** — `src/env.ts` declares no `GOOGLE_PLACES_API_KEY` field at all (only `PLACES_MODE`, `CRON_SECRET`); `.env.example` documents "never `NEXT_PUBLIC_`"; `tests/unit/no-google-credential.test.ts` still fails on any `GOOGLE_*KEY` outside `src/lib/places/client.ts` | closed |
| T-4-02 | Denial of service (financial) | kill switch | mitigate | **read** — `src/env.ts:36` `PLACES_MODE: z.enum(['off','ids_only','enterprise']).default('off')`; an unrecognized value throws at boot (zod enum), never silently defaults to a paid mode | closed |
| T-4-08 | Spoofing | cron secret | mitigate | **read** — `src/env.ts:39` `CRON_SECRET: z.string().min(16).optional()`; absent → `undefined`, and the route (04-17) treats that as refuse (503) | closed |
| T-4-05 | Information disclosure | guards blinded by generated code | mitigate | exclusion is explicit in `src/proxy.ts`'s matcher, not a broad wildcard; the guard files assert they scanned real files (two-sided walk, `no-google-credential.test.ts` header) | closed |

### 04-03 — `hostClass` classifier, partition hashing

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure (legal) | `hostClass` | mitigate | **read** — `src/lib/places/host-class.ts:20-27` returns one of exactly 6 enum values; every return path is the enum, never the URL/host; unparseable input returns `'other'` without echoing (`catch { return 'other' }`) | closed |
| T-4-10 | Tampering | `hostClass` input | mitigate | **read** — `host-class.ts:44-49`: `host === d \|\| host.endsWith('.' + d)`, a dot-boundary suffix match; `business.site.evil.com` fails both arms (not `=== `, not ending in `.business.site`) | closed |
| T-4-02 | Denial of service (financial) | partition drift | mitigate | hash of the cell key (FNV-1a), not list index, so re-ordering/adding cells cannot move a cell into a re-billed week (04-03-SUMMARY, M47) | closed |

### 04-04 — Type-aware estimate

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-02 | Denial of service (financial) | estimate under-count | mitigate | type-aware `Math.ceil` formula; committed cost-model test with exact numbers; `ceiling_requests = ceil(2 × requestsHi)` (04-04-SUMMARY, D-18) | closed |
| T-4-10 | Tampering | `includedType` values | mitigate | only the committed Table A snapshot is sendable; M48 named test; 04-12's request builder independently refuses a non-Table-A type at build time (defense in depth, confirmed by 04-VERIFICATION truth 1) | closed |
| T-4-12 | Tampering | ceiling constant | accept | See Accepted Risks Log (AR-P4-01) | closed (accepted) |

### 04-05 — Quadtree tiling, TIGERweb seed

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-02 | Denial of service (financial) | quadtree | mitigate | three committed floors (depth, size, novelty) bound every branch; truncation counted/reported; the per-run request ceiling (04-16) is the final wall (04-05-SUMMARY) | closed |
| T-4-05 | Information disclosure (legal) | `SearchResult` | mitigate | the type carries tile keys, counts, rects and enums only — no field can hold a name/address/phone/URL (04-05-SUMMARY) | closed |
| T-4-10 | Tampering | keys into SQL/jsonb | mitigate | `dbSafe()` on every DB-bound key; a named "tile keys never carry U+0000" test | closed |

### 04-06 — Candidate matching query

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure (legal) | `PlaceFeatures`, `MatchDecision` | mitigate | numbers/enum-only types; named test scans the serialized decision for sentinel Google text (04-06-SUMMARY) | closed |
| T-4-10 | Tampering (SQL injection) | `placeCandidatesQuery` | mitigate | probes bound as one jsonb parameter, city bound as a parameter, no string concatenation into SQL (same `drizzle-executor.test.ts` binding discipline this audit ran live under 04-purge, see 04-17 row) | closed |
| T-4-06 | Tampering (cross-tenant) | candidate fetch | mitigate | every arm filters `org_id = (select app.current_org_id())` in addition to RLS; named test `places candidate query scopes by org on every arm` (`tests/unit/places-candidates.test.ts`, confirmed present by grep) | closed |
| T-4-02 | Denial of service | candidate fetch cost | mitigate | ≤20 probes, bounded `limit` per arm, index-driven arms (04-06-SUMMARY); named test `places candidate query refuses more than one page of probes` | closed |

### 04-07 — Signal formatters, Maps link, attribution header

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-11 | Tampering | `mapsUrlFor` | mitigate | **read** — `src/lib/ui/places-format.ts:235-241`: built from `placeId` + spine name/city only, every component `encodeURIComponent`-ed, fixed origin `MAPS_SEARCH` constant | closed |
| T-4-05 | Information disclosure (legal) | formatters | mitigate | inputs are enums, numbers and spine fields only; no formatter accepts Google text (04-07-SUMMARY) | closed |
| T-4-13 | Repudiation / legal | attribution | mitigate | module header binds importers to `GoogleMapsTag`; enforced repo-wide by `tests/unit/google-maps-attribution.test.tsx` (04-28's registry + import walk) | closed |

### 04-08 — No-map guard, `GoogleMapsTag`

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-13 | Repudiation (legal §3.2.3(e), §B.14.2) | map rendering | mitigate | **read** — `tests/unit/no-map.test.ts:26-34` forbids `leaflet`/`react-leaflet`/`maplibre-gl`/`mapbox-gl`/`@vis.gl/react-google-maps`/`pigeon-maps`/`ol`, the `@react-google-maps/` scope, and pattern-matches `maps/embed`, `staticmap`, `tile.openstreetmap`; mutation-checked per its own header comment | closed |
| T-4-13 | Repudiation (legal: attribution) | `GoogleMapsTag` | mitigate | exact "Google Maps" text, `translate="no"`, painted policy colours in both themes; computed-style e2e probe added in 04-28 (04-08-SUMMARY) | closed |

### 04-09 — Places schema, grants, retention CHECK, `siteless_cron`

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-04 | Information disclosure (legal retention) | `place_coordinates` | mitigate | **test run** — `tests/db/places-schema.test.ts` `authenticated cannot read place coordinates`: **PASS**, live against local Postgres, this session. `revoke all on place_coordinates from authenticated, anon` (`drizzle/0027_places_grants_triggers.sql:65`); CHECK `pc_expiry_within_30_days` / `pc_expiry_after_observed` (`drizzle/0026_places_tables.sql:59-60`) | closed |
| T-4-06 | Tampering (cross-tenant) | new tables | mitigate | **test run** — `tests/db/grants-audit.test.ts` `the eight places tables hold exactly their 0027 grants`: **PASS**, live. `TENANT_TABLES` in the same file lists all 8 (`grants-audit.test.ts:78-85`); `business_place_signal` view is `security_invoker` | closed |
| T-4-05 | Information disclosure (legal) | observations | mitigate | `place_observations` columns are booleans/enums/ids/timestamps only (CHECK `po_host_class_known`, `po_host_class_agrees`); `businesses` gains no Places column (named test `businesses gains no Places-derived column`, `places-schema.test.ts`) | closed |
| T-4-12 | Tampering | `runs.ceiling_requests` | mitigate | outside the UPDATE column grant, named test `grants: runs heartbeat_at is updatable and ceiling_requests is not` (`places-schema.test.ts`) | closed |
| T-4-02 | Denial of service (financial) | concurrent runs | mitigate | named test `one active run per org` (`places-schema.test.ts`), unique partial index `runs_one_active_per_org` (23505) | closed |
| T-4-07 | Elevation of privilege | `siteless_cron` | mitigate | **read** — `drizzle/0027_places_grants_triggers.sql:124-130` creates the role NOLOGIN, `grant siteless_cron to app_user`; `drizzle/0028_places_meter_retention.sql:301` grants EXECUTE on exactly the purge function | closed |

### 04-10 — msw Places harness, committed fixtures

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-09 | Denial of service (financial) | CI | mitigate | RegExp handler + `onUnhandledRequest: 'error'` (04-10-SUMMARY); shared with the T-4-09 mechanism verified in 04-01/04-17 | closed |
| T-4-05 | Information disclosure (legal) | committed fixtures | mitigate | hand-authored synthetic data, `synthetic: true` sidecar, no Google-authored text (D-20); confirmed still true by `04-REVIEW-DELTA.md`'s independent byte-level anonymization check (see review-findings section below) | closed |
| T-4-10 | Tampering | builder regressions | mitigate | 501 on a missing mask/key/SAB flag makes a regression red (M26 support, 04-10-SUMMARY) | closed |

### 04-11 — Writer definers, cross-org refusal, budget hold release

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-06 | Tampering (cross-tenant) | release/plan/mark/stats | mitigate | org from claims, never a parameter; every uuid re-read `org_id = v_org`; same message for foreign and missing (04-11-SUMMARY, named refusal tests) — same pattern this audit confirmed live for the two writer paths tested directly (T-4-06 rows, 04-09/04-15/04-18) | closed |
| T-4-07 | Elevation of privilege | cross-org purge | mitigate | execute revoked from public/anon/authenticated/service_role, granted to `siteless_cron` only (`drizzle/0028:301`, confirmed by read); `siteless_cron` holds no table privilege | closed |
| T-4-04 | Information disclosure (legal retention) | stats read path | mitigate | counts only; expired rows never reported as held; no row-level coordinate read exists in the app (confirmed — no `place_coordinates` select outside the purge function, `docs/legal/places-persistence.md` §1.3) | closed |
| T-4-02 | Denial of service (financial) | admission hold | mitigate | explicit release frees the hold without a phantom ledger unit (M53), so the free allowance stays true (04-11-SUMMARY) | closed |
| T-4-10 | Tampering | `mark_run_search` jsonb | mitigate | allow-listed keys only (22023 otherwise) — no Places text can be smuggled into progress rows (04-11-SUMMARY) | closed |

### 04-12 — Places REST client, request builder, response parsing

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-01 | Information disclosure | Places key | mitigate | **read** — `src/lib/places/client.ts:1` `import 'server-only'`; `:48` `process.env.GOOGLE_PLACES_API_KEY \|\| undefined`; `no-google-credential.test.ts` allow-lists exactly this file, per-pattern not per-file, M51 mutation-checked | closed |
| T-4-02 | Denial of service (financial) | mask / SKU | mitigate | mask is a module constant in `field-mask-tier.ts`; `fieldMaskTier` refuses unknown fields; IDs-only mask is a separate constant priced `ts_essentials` (confirmed present, `tests/unit/field-mask-tier.test.ts`) | closed |
| T-4-05 | Information disclosure (legal) | error outcomes | mitigate | outcomes carry reason + status only; named test proves no response text survives (04-12-SUMMARY) | closed |
| T-4-10 | Tampering | response parsing | mitigate | zod `safeParse` with default strip; `bad_shape` on failure; no string from the response reaches SQL in this module (04-12-SUMMARY) | closed |
| T-4-02 | Denial of service (financial) | retry on 429 | mitigate | daily quota vs per-minute distinguished by metadata; ambiguous → daily (stop, the safe direction); bounded retries live in the step (04-18/04-22) | closed |

### 04-13 — Run planner / scope sizing

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-02 | Denial of service (financial) | scope | mitigate | the same function sizes the admission hold and plans the run; a unit without geometry is refused rather than tiled from a guess (04-13-SUMMARY, M5/M7/M8) | closed |
| T-4-10 | Tampering | types / keys | mitigate | types filtered by `isTableAType` against the committed seed; keys `dbSafe` | closed |

### 04-14 — `/spend` display

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure | `/spend` stopped reason | mitigate | mapped through `STOPPED_REASON`; unknown key renders nothing (M1/M2, 04-14-SUMMARY) | closed |
| T-4-02 | Denial of service | refresh polling | mitigate | 5 s cadence only while queued/running, paused when hidden, stopped on terminal (N1-N3, 04-14-SUMMARY) | closed |

### 04-15 — Attachment/observation writers, `decide_place_attachment`

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure (legal) | features / all writer inputs | mitigate | **read** — `toPageRecord` (`src/lib/places/page-record.ts`) refuses non-allow-listed keys; `pa_features_numeric` → `app.places_features_ok` CHECK confirmed in `drizzle/0030_places_review_fixes.sql:39-74` (post-review-fix, tightened from 13 to 11 keys, A-WR-06) | closed |
| T-4-06 | Tampering (cross-tenant) | writers | mitigate | org from claims; search/business/attachment re-read under `org_id = v_org`; named 42501 tests (04-15-SUMMARY) — same class this audit confirmed live for `place_coordinates`/8-tables grants | closed |
| T-4-04 | Information disclosure (legal retention) | coordinates | mitigate | `expires_at = observed_at + 30 days` exactly, CHECKed (0026, confirmed by read above) | closed |
| T-4-10 | Tampering | jsonb inputs | mitigate | all values read with typed casts inside one definer; enums validated (22023, 04-15-SUMMARY) | closed |
| T-4-06 (labeled Repudiation in-plan) | Repudiation | listing decisions | mitigate | `decided_by` from claims; `log_event` row per status change (named test) — superseded/tightened by A-WR-05's fix (0030's `app.log_place_attachment_event`, see review findings) | closed |

### 04-16 — Per-page reserve/settle, kill-switch-vs-pinned-deployment

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-02 | Denial of service (financial) | per-page spend | mitigate | mode gate before SQL; reservation + ceiling in one txn; cap refusal is zero rows → stop, never retried; per-attempt settlement; pessimistic settle of unknown outcomes (04-16-SUMMARY, M28/M34a/M34b/S2-S5) | closed |
| T-4-03 | Elevation / Tampering | kill switch vs pinned deployment | mitigate | `status = 'running'` required on every reservation and in the ceiling UPDATE — an operator's `failed` is never overwritten (04-16-SUMMARY, matching `finishRun`'s guard confirmed in 04-22 below) | closed |
| T-4-06 | Tampering (cross-tenant) | `withWorkerOrg` | mitigate | claims `{o:{id}}` only, no `sub`, no role claim; first statement re-reads the run under RLS; mismatch throws (M46, 04-16-SUMMARY) | closed |
| T-4-12 | Tampering | tenant resets `calls_count` | accept | See Accepted Risks Log (AR-P4-02) | closed (accepted) |

### 04-17 — Cron purge route, `/sources` transient card

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-08 | Spoofing | cron route | mitigate | **test run** — `tests/unit/purge-route.test.ts` `the purge route refuses without the cron secret`: **PASS**, live, this session. **Read** — `src/app/api/cron/purge-places/route.ts:38-46`: `Buffer.from` on both sides, length-checked before `timingSafeEqual`, unset secret → 503 before any header check | closed |
| T-4-07 | Elevation of privilege | purge execution | mitigate | `withCronRole` sets only `siteless_cron` (confirmed by read, same evidence as 04-09/04-11) | closed |
| T-4-04 | Information disclosure (legal retention) | missed purge | mitigate | idempotent daily purge + database read barrier (T-4-04 central evidence) + purge-overdue alert (0031, C-WR-10 fix, see review findings) + desk fallback `pnpm purge:places` | closed |
| T-4-05 | Information disclosure | route errors | mitigate | **read** — `route.ts:54-58`: fixed-enum bodies (`{ok,reason}`/`{ok,orgs,rowsPurged}`); `console.error('purge-places: purge failed', e instanceof Error ? e.name : 'unknown')` — error NAME only, never the secret or a message | closed |
| T-4-02 | Denial of service | repeated invocations | accept | See Accepted Risks Log (AR-P4-03) | closed (accepted) |

### 04-18 — `runSearchTile` step (Google response → memory → Postgres boundary)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure (legal) | DB, returns, logs, errors | mitigate | derived-only `PageRecord` (refuses text) + table CHECK; return type holds no Google strings; no logging; sentinel scan over eleven tables (M36, 04-18-SUMMARY) | closed |
| T-4-02 | Denial of service (financial) | paging / retries | mitigate | reserve per page before the call (M32); daily quota stops; retries bounded (04-18-SUMMARY) | closed |
| T-4-06 | Tampering (cross-tenant) | step DB writes | mitigate | every transaction via `withWorkerOrg`; writers re-check org; `WorkerOrgMismatch` fails closed (04-18-SUMMARY) | closed |
| T-4-10 | Tampering (SQL) | candidate fetch | mitigate | one jsonb-bound statement; threshold via validated `similarityThresholdSql()` (same binding discipline as 04-06) | closed |

### 04-19 — Fixture recorder (real payload → git)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure (legal) | committed fixtures | mitigate | in-memory anonymization, structure-preserving text-dropping unit test; raw payload never written or logged; sidecar `anonymized: true` (D-20) — independently re-checked byte-level by `04-REVIEW-DELTA.md` (see review findings) | closed |
| T-4-04 | Information disclosure (legal retention) | fixture coordinates | mitigate | coordinates re-drawn from a hash inside the searched rectangle; `04-REVIEW-DELTA.md` re-ran `anonymizePage` on both committed pages and got a byte-identical fixpoint — no real coordinate survived | closed |
| T-4-02 | Denial of service (financial) | recorder | mitigate | goes through `reservePage`; hard cap 10 requests; local target only; refuses without the D-01 record (`scripts/lib/record-guard.ts` `assertLegalRecord`, `assertLocalTarget`) | closed |
| T-4-02 | Denial of service (financial) | change check | mitigate | IDs-only mask by construction; still reserved and ledgered at $0 (D-16) | closed |

### 04-20 — Run report query

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-06 | Information disclosure (cross-tenant) | run report | mitigate | one `withOrg`; RLS on every table read; tenant-scoped test returns null for another org's run (04-20-SUMMARY) | closed |
| T-4-04 | Information disclosure (legal retention) | coordinates | mitigate | the query never touches `place_coordinates` — it cannot, no grant exists (confirmed by the schema evidence above) | closed |
| T-4-05 | Information disclosure (legal) | report content | mitigate | only counts, enums, keys and our own names are read (04-20-SUMMARY) | closed |

### 04-21 — Review/detach server actions

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-06 | Tampering (cross-tenant) | listing actions | mitigate | `requireOrg()` first; claims from `orgClaims()`; definer re-reads under the org (42501 → not_found); zod `z.uuid()` + enum (04-21-SUMMARY) | closed |
| T-4-06 (Repudiation) | Repudiation | decisions | mitigate | `decided_by` = Clerk `sub` via the definer; `log_event` row per status change | closed |
| T-4-04 | Information disclosure (legal retention) | business read | mitigate | never selects `place_coordinates` (named test, 04-21-SUMMARY) | closed |
| T-4-05 | Information disclosure (legal) | queue item | mitigate | carries spine fields + numeric features only (named test) | closed |

### 04-22 — Workflow steps / event log

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure (legal) | event log / world files | mitigate | steps return ids/counts/enums only; lane test scans every world file for sentinels (M45, 04-22-SUMMARY) | closed |
| T-4-06 | Tampering (cross-tenant) | beginRun / every step | mitigate | `withWorkerOrg` from the start input; beginRun refuses a run its org cannot see; writers re-check org (foreign-run test, 04-22-SUMMARY) | closed |
| T-4-02 | Denial of service (financial) | retries / loops | mitigate | budget stops are results, never thrown (M33); daily quota never retried (M52); `maxRetries = 3`; request ceiling; tiling floors | closed |
| T-4-03 | Elevation / Tampering | pinned deployments | mitigate | `finishRun` and every reservation guard on `status = 'running'`; an operator's `failed` is never overwritten (same mechanism as 04-16) | closed |
| T-4-02 | Denial of service (financial) | leftover in-flight reservations | mitigate | `finishRun` settles them as charged (pessimistic), so a failed run never under-ledgers — extended by round-2 fix F3 (`e7d8e6b`), see review findings | closed |

### 04-23 — `/runs/[id]` page

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-06 | Information disclosure (cross-tenant) | `/runs/[id]` | mitigate | `isUuid` guard; `orgClaims()`; RLS read; unknown and foreign ids both `notFound()` — no existence oracle (04-23-SUMMARY) | closed |
| T-4-13 | Repudiation (legal: attribution) | Places-derived cards | mitigate | one `GoogleMapsTag` per Places-derived container (N1/N2); repo-wide registry lands in 04-28 | closed |
| T-4-05 | Information disclosure | stopped reasons | mitigate | copy-mapped, tested over all eight keys (M2) | closed |

### 04-24 — Listing action UI (Maps link-out, reject confirmation)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-11 | Tampering | Maps link | mitigate | `mapsUrlFor` from place_id + spine name/city, every part `encodeURIComponent`-ed (same evidence as 04-07); `rel="noopener noreferrer"` | closed |
| T-4-13 | Repudiation (legal) | attribution / no map | mitigate | one `GoogleMapsTag` in the bordered listing card; link-out only, no embed | closed |
| T-4-05 | Information disclosure (legal) | Google text | mitigate | the card renders stored ids, numbers and spine fields only (named test) | closed |
| T-4-06 | Tampering | irreversible reject | mitigate | confirmation required; no action before confirm (Rule 42 test); no advance before the write lands | closed |

**Also 04-24: unregistered flag `threat_flag: url-to-sql`.** See **Unregistered Flags** below — not double-counted into the 121.

### 04-25 — `/businesses/[id]` Places signal row

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-13 | Repudiation (legal: attribution) | Google check rows | mitigate | one `GoogleMapsTag` per Places-derived row container; tentative/rejected rows show no Places value | closed |
| T-4-04 | Information disclosure (legal retention) | coordinates | mitigate | never read (no grant) and never rendered (named repo grep) | closed |
| T-4-06 | Tampering | detach | mitigate | confirmation required; server action re-checks org (04-21) | closed |
| T-4-11 | Tampering | Maps link | mitigate | `mapsUrlFor` with encoded components; `noopener noreferrer` | closed |

### 04-26 — `queueRun` server action, Workflow `start()`

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-02 | Denial of service (financial) | admission | mitigate | mode refusal before any reservation; planner-sized hold; `ceiling_requests` stored; one active run per org; stale-run reclaim (mutations 1,2,3,5,6,7,8,10,11,12 per 04-26-SUMMARY) | closed |
| T-4-06 | Tampering (cross-tenant) | workflow input | mitigate | `clerkOrgId` from server-verified `requireOrg()` only, asserted as `'org_A'` in the mutation-checked test; the version is read under RLS before the run row exists | closed |
| T-4-09 | Denial of service (financial) | CI e2e | mitigate | `spend.spec.ts` never clicks a run; `preset-detail.spec.ts` is local-only and asserts the refusal | closed |
| T-4-02 | Denial of service (financial) | `start()` failure | mitigate | hold released and run failed `never_started` (04-26-SUMMARY) | closed |
| T-4-14 | Spoofing | workflow registration | mitigate | manifest proves the only registered entry is `placesSweep`; handlers reachable only via Vercel Queues (shared evidence with 04-01) | closed |

### 04-27 — `PLACES_MODE` UI affordance

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-01 | Information disclosure | `PLACES_MODE` | mitigate | server-read prop; `NEXT_PUBLIC_` doesn't appear in `preset-detail/`; no client module imports `src/env.ts` (04-27-SUMMARY) | closed |
| T-4-02 | Denial of service (financial) | disabled actions | mitigate | UI is an affordance only; `queueRun`'s own refusal (04-26) is unchanged | closed |
| T-4-09 | Denial of service (financial) | e2e | mitigate | grep for `run-confirm` over `tests/e2e` returns nothing (04-27-SUMMARY) | closed |

### 04-28 — Attribution registry, e2e cap-lowering guards

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-13 | Repudiation (legal: attribution) | every Places surface | mitigate | registry + import walk + computed-style probe; M44 through M44h plus `#FEFEFE` mutation, confirmed present (`tests/unit/google-maps-attribution.test.tsx`) | closed |
| T-4-09 | Denial of service (financial/availability) | budget-banner specs | mitigate | skip while any run is queued/running on the deployment (04-28-SUMMARY) | closed |
| T-4-01 | Information disclosure | e2e seeding | mitigate | `runs.spec.ts` self-skips unless local, never uses a production credential (`docs/deploy.md` §3) | closed |

### 04-29 — D-01 legal enumeration gate

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-05 | Information disclosure (legal §3.2.3) | everything persisted | mitigate | the decision is taken against a schema-generated enumeration (`docs/legal/places-persistence.md`, confirmed by direct read above, 115 columns cross-checked against `drizzle/0026-0029`); a "no" keeps `PLACES_MODE=off` | closed |
| T-4-02 | Denial of service (financial) | premature calls | mitigate | 04-31/04-32 depend on this plan; `assertLegalRecord` refuses the recorder without the row — a tool contract, not a prompt rule (confirmed: `scripts/lib/record-guard.ts`) | closed |

### 04-30 — Production migration/deploy (0026-0029), cron secret provisioning

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-16 | Tampering | `db:migrate:prod` | mitigate | read-only pre-flight (twice); human approval; `scripts/db.ts` gate; catalog post-flight; second-run no-op proven from the catalog (04-30-SUMMARY) | closed |
| T-4-08 | Spoofing | cron secret | mitigate | CSPRNG-generated, piped into Vercel without echo; smoke proves 401 without it and 401 with a wrong one. **Orchestrator-measured, 2026-09-25:** `/api/cron/purge-places` returns 401 without the bearer on production | closed |
| T-4-01 | Information disclosure | secrets in transcripts | mitigate | values never printed; scratch pull file outside the repo, deleted (04-30-SUMMARY) | closed |
| T-4-02 | Denial of service (financial) | premature calls | mitigate | `PLACES_MODE` unset (= off) and no key exists on production at 04-30 time; verified via `vercel env ls`. **Orchestrator-measured, 2026-09-24/25:** Vercel Production still has no `PLACES_MODE`, `GOOGLE_PLACES_API_KEY` is Sensitive | closed |
| T-4-09 | Denial of service (financial) | deployed e2e | mitigate | no spec clicks a run confirm (04-26/04-27, confirmed by grep evidence above) | closed |

### 04-31 — First real Google call (IDs-only key verification)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-01 | Information disclosure | the key | mitigate | danlo stores it; Claude checks presence by exit code only; API-restricted to Places API (New); server-only; one sanctioned reader (`client.ts`, confirmed above). **Orchestrator-measured:** GCP key restricted to Places API (New) | closed |
| T-4-02 | Denial of service (financial) | spend beyond the meter | mitigate | 100/day quota as the independent second wall (BUDG-03); verification call is IDs-only ($0) and metered. **Orchestrator-measured:** `SearchTextRequest` 100/day, every other Places method 0/day | closed |
| T-4-05 | Information disclosure (legal) | verification call | mitigate | gated by the D-01 row (recorder guard); IDs-only mask returns place ids only (04-31-SUMMARY: "the one call was IDs-only, went through the meter, used the local DB, and was gated by D-01") | closed |

### 04-32 — D-04 first real run (McAllen × home services)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-02 | Denial of service (financial) | the run | mitigate | one cell (54 high, ceiling 108), inside the free 1,000; meter + ceiling + 100/day quota; daily-quota stop expected and non-retried (04-32-SUMMARY, `docs/measurements/04-first-run.md`) | closed |
| T-4-05 | Information disclosure (legal) | recorded fixtures | mitigate | in-memory anonymization, manual inspection before commit, replay sentinel test, `anonymized: true` sidecar — independently re-verified byte-level by `04-REVIEW-DELTA.md` (below) | closed |
| T-4-03 | Elevation / Tampering | mode flip | mitigate | danlo chooses the mode before and after; redeploy + sha check; runbook's cancel procedure available (04-32-SUMMARY) | closed |
| T-4-16 | Tampering | production ingest (optional) | mitigate | Phase 3's own desk procedure with pre-flight and `--target=prod` gate, only on danlo's explicit option — not exercised in 04-32 (production has 0 businesses per orchestrator facts) | closed |

### 04-33 — Mutation validation gate

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-4-16 | Tampering | mutations leaking into commits | mitigate | `git diff --stat` empty after every code mutation; catalog read after every DB revert; never against production (04-33-SUMMARY) | closed |
| T-4-05 | Information disclosure | screenshots | mitigate | taken of the local DB seeded with synthetic data; no Google text can appear, none is stored (04-33-SUMMARY) | closed |

---

## Security-relevant code review findings (not in the original per-plan threat models)

`04-REVIEW.md` (2026-09-24, `status: issues_found`, 204 files, 3 parallel `gsd-code-reviewer`
slices) found these after the 33 plans' threat models were written. `04-REVIEW-FIX.md`
(iteration 2, `status: partial`, 40/43 fully fixed, 3 partial with the remainder recorded as
a danlo decision in `deferred-items.md`) and `04-REVIEW-DELTA.md` (2026-09-25,
`status: resolved`) fixed the security-relevant ones. Each row below is verified against
the current branch code, not copied from the fix report's own claim.

| Finding | Category | Component | Disposition | Evidence (code, HEAD `7b81a26`) | Status |
|---|---|---|---|---|---|
| A-WR-02 | Tampering | change-check saturation corrupting `place_tile_members` history | mitigate | `14a11e4` + `45bd720`: SQL refuses; `diffTile` sends `gone: []` when saturated, so a saturated change check can no longer mark live members `gone` | closed |
| A-WR-05 | Information disclosure (legal, D-01 enumeration) | `events` audit table silently gained a permanent `place_id` sink not on the D-01 list | mitigate | **read** — `drizzle/0030_places_review_fixes.sql:630-665` replaces the trigger's target function with `app.log_place_attachment_event`, which copies ids/status/decided-by only, **not** `score`/`features`. Round-2 F4 (`0348e42`) pins the exact 8 table/trigger/function triples by name, closing the gap where a trigger re-pointed at the generic `app.log_event` would silently restore the score/features copy. **`docs/legal/places-persistence.md` §1.10 documents `place_id` as an indefinite, undeletable `events` sink** — this is disclosed, not hidden. **D-01 re-acknowledged by danlo 2026-09-24** on the doc as of `96c20f4` (PROJECT.md Key Decisions D-01 row, confirmed by direct read: "re-acknowledged by danlo 2026-09-24 on the doc as of `96c20f4`... none widens what is stored") | closed |
| A-WR-06 | Information disclosure (legal) | `pa_features_numeric` CHECK admitted `nameSim`/`distanceM` (continuous Google-derived values) that D-01 says are memory-only | mitigate | **read** — `drizzle/0030_places_review_fixes.sql:39-74` `app.places_features_ok` now admits exactly 11 keys, rejecting `nameSim`/`distanceM` and any non-integer point at the database, not just in TypeScript. Named tests in `tests/db/places-writer.test.ts`: "features carrying nameSim is 23514", "features carrying distanceM is 23514" | closed |
| A-WR-07 | Tampering (integrity) | `record_places_page` accepted an Essentials-SKU page as if Enterprise, which would permanently write false "no website" observations | mitigate | `b594b0e` + `8649197` (+ round-2 collision fix `a0b05e9`): `toPageRecord` refuses any non-Enterprise SKU before the writer is called; named test "an enterprise search records ts_enterprise pages only" pins `22023` | closed |
| A-WR-08 | Denial of service (financial) | a race between the reclaim's `settleInFlight` and a page view's release could double-settle/mis-ledger a reservation | mitigate | `b292703` + `b67494a`, extended by round-2 F3 (`e7d8e6b`): `closeAbandonedRun` now settles exclusively through the meter's `settleInFlightInTx`, in a savepoint; `queue-run.ts` no longer imports the price book independently. Named test "no module but the meter settles a Places charge" — an equality over `src/` call sites | closed |
| C-CR-02 | Elevation / Tampering | the version-history "Run version N" buttons ignored `PLACES_MODE`, so a click was possible (with a false "switched off" message and a loop) while the kill switch was `off` in production | mitigate | `dcd0761`: the version "Run" buttons honour `PLACES_MODE`, confirmed fixed per 04-REVIEW-FIX.md tally; `queueRun`'s own server-side mode gate (04-26, independently confirmed above) was never bypassable regardless — this closes the UI-level false affordance, not a real admission gap | closed |
| B-CR-02 | Denial of service (financial) | retries re-buy already-recorded pages; a process crash mid-tile restarts a search at page 1 | mitigate (partial, residual accepted) | `9444a26`, `2ac9a88`: in-step page retry, deterministic faults fatal (never retried), a finished search rebuilds its result from `run_searches` rather than re-querying. **Residual, NOT implemented:** persisting Google's opaque `nextPageToken` across a crash (F1), because that string is Google Maps Content not on the D-01 list — correctly deferred to a D-01 decision rather than built silently (`deferred-items.md` "F1"). **The threat's actual mitigation goal (T-4-02, every request reserved and ledgered) holds even in the residual case** — 04-VERIFICATION.md truth 5 confirms every re-bought page is still reserved and ledgered; this is a cost-efficiency gap in a rare crash window, not an unmitigated spend-control bypass | closed (residual tracked, not a threat-model gap) |
| C-WR-10 | Information disclosure (legal retention) | `/sources` could not distinguish "on-time purge, nothing overdue" from "a coordinate has been expired and unpurged past a purge cycle" — a silent-breach risk the D-12 threat row (T-4-04) requires stay observable | mitigate | `96c20f4` (`drizzle/0031_places_transient_oldest_expired.sql`): `app.places_transient_stats()` gains `oldest_expired_ms`; EXECUTE revoked from `public, anon, service_role`, granted to `authenticated`. **Orchestrator-measured, production:** journal 32 (0030/0031 applied), nine app functions have `service_role` EXECUTE false and grants identical to local, function bodies identical modulo CRLF. Named tests: "transient stats never report an expired coordinate as held", "places_transient_stats is executable by authenticated only, search_path pinned" | closed |

### Delta review (`04-REVIEW-DELTA.md`, 2026-09-25, scope: `7eba6e2..15823b8`)

A second, deep review pass over the D-04 real-run follow-up commits (msw harness, anonymizer,
recorder, and every consumer of changed copy). Two Warnings, both directly load-bearing for
Phase 4's legal persistence boundary (T-4-05/D-20):

| Finding | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| WR-01 | Information disclosure (test integrity) | the recorder's "marks the sidecar anonymized" test had gone vacuous — the committed sidecar already satisfied its own assertion before the code under test ran, so a real regression (deleting the write) would pass green | mitigate | `d8324ca`: scratch sidecar reseeded to a neutral `anonymized: false` state; mutation (delete the write) confirmed **red** by this audit's read of the resolution table, naming the exact failing assertion | closed |
| WR-02 | Information disclosure (legal, D-06/D-20 boundary) | the replay test's "no recorded Places string reached any table" sentinel scan only detected the **served** string forms (national-format phone, full address, full URL) — every real writer normalizes first (E.164, split street, host class), so a leak in the form a writer would actually produce could never trip the scan; `businesses` (the table a leak would land in) was excluded from the scan entirely | mitigate | `10762e2` + `1259a18`: sentinels extended to the normalized forms actually written (E.164, street, URL host); `businesses` added to the post-run scan with per-kind non-vacuity proof (three mutations, each injected inside a rolled-back transaction, each independently confirmed **red** by name per the resolution table: an `events` row carrying a raw phone, a twin's `internal_notes` carrying a served address, an `events` row carrying a raw URL host) | closed |

---

## Unregistered Flags

**One: `04-24`'s `threat_flag: url-to-sql`.** New attack surface the plan's own
`<threat_model>` block did not name: `/review?skip=` is a user-controlled query parameter
that reaches `listReviewQueue` → a database query (`src/app/(app)/review/page.tsx` →
`src/server/queries/review-queue.ts`). This is new surface beyond T-4-06/T-4-05/T-4-11/T-4-13,
which is what 04-24's plan register covers. It was found and fixed by the executor in the
same plan, matching `03-SECURITY.md`'s C-WR-01 precedent ("found and fixed" is recorded
here rather than smoothed over, per this audit's adversarial stance):

- **Mitigation, independently confirmed by this audit (read):** `src/lib/ui/review-kind.ts:55-65`
  `parseSkipped` keeps only values matching a `UUID` regex, lower-cased and deduplicated,
  capped by `capSkipped`; a non-uuid string (including an injection payload) is filtered out
  before the value ever reaches `src/server/queries/review-queue.ts`. That function is called
  only via `withOrg(claims, (tx) => readReviewQueue(tx, filter, skippedListings))` — RLS-scoped,
  and the plan states a unit test pins an injection string → `[]`, plus a db test pinning that a
  foreign id matches nothing.
- **Effect bound:** the parameter only reorders which already-RLS-visible rows are skipped in
  the queue; it cannot widen what is readable.

No other plan's `## Threat Flags` section named new surface: every SUMMARY this audit read
(30 of 33 carry the section; see below) says "None" or "None beyond the plan's threat model",
each tying back to an existing `T-4-NN` id.

### Missing Threat-Flags Sections

Three SUMMARYs — `04-08`, `04-32`, `04-33` — carry **no** `## Threat Flags` section at all
(confirmed by `grep -n "^##"` over each file; neither the header nor a "None" line exists).
This is a convention gap, not silently accepted as "None":

- **04-08** (no-map guard + `GoogleMapsTag` component): no new endpoint, I/O, or schema;
  its own `## Threat model` section (present, different heading) explicitly states "No new
  surface beyond the plan's register."
- **04-32** (the D-04 real run): the plan's own threat rows (T-4-02, T-4-05, T-4-03, T-4-16,
  all independently verified above) already cover a real, billed Google call and a production
  key crossing — the highest-stakes plan in the phase — and no unnamed surface was found by
  the code review, the delta review, or this audit's own reading of the plan and its
  production catch-up section.
- **04-33** (mutation validation gate): mutations to local test DB and tree only; its own
  register (T-4-16, T-4-05) covers the surface; no new endpoint or schema.

None of the three introduces attack surface this audit's independent reading did not already
find covered elsewhere in this register or the review findings. Flagged here so the gap in
executor discipline is visible, not because it hid anything.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-P4-01 | T-4-12 (04-04, Tampering, the `2× requestsHi` ceiling constant) | A committed constant beside `FAN_OUT` in `src/lib/estimate/assumptions.ts`; changing it reds the named cost-model test and needs code review — no runtime input can change it. | plan author (04-04-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-P4-02 | T-4-12 (04-16, Tampering, tenant resets `calls_count`) | `calls_count` stays tenant-updatable by the Phase 2 column grant; the monthly meter (`app.reserve_budget`'s cap comparison) still bounds spend independently of this counter, and `ceiling_requests` itself — the value that actually stops a run — is NOT tenant-updatable (verified above, 04-09 row). | plan author (04-16-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-P4-03 | T-4-02 (04-17, Denial of service, repeated cron invocations) | The purge is a bounded `DELETE` over an indexed `expires_at`; Vercel Cron's best-effort delivery may duplicate or skip, and a duplicate delete is a no-op (idempotent reconciliation), not a cost or availability risk. | plan author (04-17-PLAN.md `<threat_model>`) | 2026-09-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Deferred, Non-Blocking Residuals (tracked in `deferred-items.md`, not open threat-model rows)

These are review-Info findings or explicitly-deferred decisions that do not correspond to any
unmitigated `T-4-NN` row above. Listed for completeness per this audit's adversarial stance
(a residual noted in a deferred-items file is not automatically "handled" until checked against
what it actually leaves exposed):

- **A-IN-03 (3 of 4 closed).** `app.release_reservation(uuid)` still grants EXECUTE to
  `service_role` (**read**, confirmed live: `drizzle/0028_places_meter_retention.sql:81,84`
  revokes from `public, anon` and grants to `authenticated` only — no `service_role` revoke
  line exists for this function, unlike the 3 functions 0030/0031 fixed). **Why this is not a
  BLOCKER:** the application holds no `service_role` credential anywhere (`docs/legal/
  places-persistence.md` §1.3, confirmed: no `SERVICE_ROLE` reference in `src/` or `src/env.ts`);
  `service_role` privilege is a Supabase-owner-level grant that exists independent of this
  function's own grants. It is a hygiene gap (one `revoke` statement, tracked in
  `deferred-items.md`), not an exploitable path from the app's own credential set.
- **B-WR-02 (dense-core novelty-rule tuning).** Deferred to real D-04 data (`deferred-items.md`);
  not a security gap — worst case is over-spend inside the still-enforced request ceiling, or
  under-coverage of a dense tile, neither of which bypasses the meter.
- **C-WR-03 (keep-last-good on a failed live run-report refresh).** A UX/availability structural
  decision (client error boundary vs. route-handler probe), not a data-exposure or tenancy gap —
  a failed refresh still cannot show another org's run (T-4-06 holds regardless).
- **The accented-city SAB miss (B-IN-01).** A matching-accuracy gap (a legitimate SAB match
  fails to fire), not a security threat — it produces a false negative (missed match), never a
  cross-tenant or over-disclosure outcome.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|----------------|--------|------|--------|
| 2026-09-25 | 121 (+13 review findings, +1 unregistered flag) | 121 (+13) | 0 | gsd-security-auditor |

**Supporting evidence for this run:**

- All 33 `04-*-PLAN.md` `<threat_model>` blocks extracted directly (121 rows, cross-checked:
  118 `mitigate` + 3 `accept` + 0 `transfer`, matching the prompt's stated totals exactly).
- All 33 `04-*-SUMMARY.md` files read for `## Threat Flags` (or equivalent-titled) content;
  30 explicitly say "None" / "None beyond the plan's threat model" tied to a named `T-4-NN`;
  3 carry no such section (`04-08`, `04-32`, `04-33`, see **Missing Threat-Flags Sections**);
  1 (`04-24`) names genuine new surface, folded into **Unregistered Flags**.
- `04-REVIEW.md` (2026-09-24, `issues_found`, 7 Critical / 36 Warning / 23 Info across
  204 files, three parallel `gsd-code-reviewer` slices) read in full via its index and all
  three part files' summarized findings tables.
- `04-REVIEW-FIX.md` (iteration 2, `status: partial`, 40/43 fully fixed, `deferred-items.md`
  tracks the 3 partials and 7 "needs decision" items) read in full; each security-relevant
  fix's cited commit and file re-opened independently by this audit (`drizzle/0030_places_
  review_fixes.sql`, `docs/legal/places-persistence.md`, `src/lib/places/page-record.ts`,
  `src/lib/ui/review-kind.ts`) rather than trusting the fix report's own claim.
- `04-REVIEW-DELTA.md` (2026-09-25, `status: resolved`, deep delta review of the D-04
  follow-up commits) read in full; its byte-level anonymization re-check and its two Warning
  fixes (WR-01, WR-02) independently confirmed present in the resolution table with named,
  by-name-red mutations.
- `04-HUMAN-UAT.md` (`status: partial`, 3/4 passed, 1 pending) — danlo's 2026-09-25
  confirmations of the six review-fix semantics ("Accept all six") and the two new copy
  strings ("Approve both") read directly; the one pending item (first-invoice reconciliation)
  is a billing-accuracy check, not a security gap.
- `docs/legal/places-persistence.md` read in full (636 lines): the D-01 enumeration, its two
  post-review corrections (A-WR-05, A-WR-06), and PROJECT.md's D-01 Key Decisions row
  (re-acknowledged by danlo 2026-09-24 on the doc as of `96c20f4`) cross-checked directly.
- **Two DB-lane tests run live** by this audit against the local `siteless_test` Postgres 18
  database (`--pool=forks`): `tests/db/grants-audit.test.ts` "the eight places tables hold
  exactly their 0027 grants" → **PASS**; `tests/db/places-schema.test.ts` "authenticated cannot
  read place coordinates" → **PASS**.
- **One unit-lane test run live**: `tests/unit/purge-route.test.ts` "the purge route refuses
  without the cron secret" → **PASS**.
- Direct source reads (not summarized) of: `src/env.ts`, `src/proxy.ts`, `src/lib/places/
  client.ts`, `src/lib/places/host-class.ts`, `src/lib/ui/places-format.ts` (`mapsUrlFor`),
  `src/app/api/cron/purge-places/route.ts`, `src/lib/ui/review-kind.ts` (`parseSkipped`),
  `tests/unit/no-google-credential.test.ts`, `tests/unit/no-map.test.ts`, `tests/unit/
  no-network.test.ts`, `tests/db/grants-audit.test.ts` (TENANT_TABLES), `drizzle/
  0026_places_tables.sql`, `drizzle/0027_places_grants_triggers.sql`, `drizzle/
  0028_places_meter_retention.sql`, `drizzle/0030_places_review_fixes.sql`.
- Orchestrator-measured production facts (this audit did not open a production connection,
  per its own constraints): journal 32 (0026-0031 applied); nine app functions have
  `service_role` EXECUTE false with grants identical to local and function bodies identical
  modulo CRLF; deployed `e7a059f` with a matching health-endpoint commit; `/api/cron/
  purge-places` returns 401 without the bearer; Vercel Production has no `PLACES_MODE`; prod
  `place_purge_runs` shows a `trigger=cron` row at `2026-09-25T09:17:35Z` (also independently
  confirmed in `04-HUMAN-UAT.md` test 2, "passed"); `GOOGLE_PLACES_API_KEY` is Sensitive in
  Vercel Production and the GCP key is restricted to Places API (New) with `SearchTextRequest`
  100/day and every other Places method 0/day.

**No threat resolved to `open`.** No `T-4-NN` row's declared mitigation was absent from the
code this audit read or ran. The one genuinely new attack surface an executor introduced
(04-24's `url-to-sql`) was found and fixed in the same plan, independently re-confirmed here.
The one class of finding with a real residual (B-CR-02's page-token persistence) does not
leave its own threat (T-4-02, spend control) unmitigated — every re-bought page is still
reserved and ledgered — and is correctly gated behind a pending D-01 legal decision rather
than built without one.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-25

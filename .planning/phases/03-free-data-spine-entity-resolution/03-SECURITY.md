---
phase: 3
slug: free-data-spine-entity-resolution
status: verified
threats_open: 0
asvs_level: 1
created: 2026-09-23
---

# Phase 3 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> Verified against implemented code at HEAD `f45d0cf` (branch
> `gsd/phase-03-free-data-spine-entity-resolution`), local migrations `drizzle/0021_extensions.sql`
> … `drizzle/0025_review_fixes_spine.sql` (5 journal rows beyond Phase 2's 20 — `siteless_test`
> journal now 26), and a read-only execution of both pinned suites run independently by this
> audit rather than copied from a report: `pnpm test:unit` → **340/340 passed** (46 files),
> `pnpm test:db` → **222/222 passed** (30 files, local PostgreSQL 18.6, `siteless_test`, rolled
> back / self-cleaning transactions). Evidence below is file:line, test name, SQL fragment, or a
> live catalog/behavioral read — never a SUMMARY claim taken on faith.
>
> This register covers **111 rows** drawn from the 22 plans' `<threat_model>` blocks (16 distinct
> `T-3-NN` ids, the same id recurring across plans as a separate row per (plan, threat) pair,
> matching `01-SECURITY.md`/`02-SECURITY.md`'s convention), **plus 4 rows** for the
> security-relevant findings `03-REVIEW.md` raised and `03-REVIEW-FIX.md` fixed on this branch
> (A-CR-01, A-WR-01, A-WR-02, C-WR-01) — these were not in the original per-plan threat models
> because the review found them during implementation, exactly as `02-SECURITY.md`'s CR-01/WR-04
> precedent. One SUMMARY `## Threat Flags` entry (03-19's `threat_flag: outbound-identity-lookup`,
> the Clerk `getUserList` call) maps to C-WR-01 below rather than to an original register id — see
> **Unregistered Flags**.
>
> 🔴 **Four rows are `closed — pending production` (code proven, production not yet updated), not
> plain `closed`.** `03-REVIEW-FIX.md` and `03-VERIFICATION.md` both state plainly that
> `drizzle/0025_review_fixes_spine.sql` — which carries A-CR-01, A-WR-01 and A-WR-02's fixes, plus
> `app.apply_survivorship_if_changed` — was applied to the **local** `siteless_test` database
> only. This is also an explicit constraint of this audit run: "Production Supabase
> (`jahgeqshuesndyscnmjo`) is at migration 0024." `docs/deploy.md` §10 independently confirms the
> deployed application commit is `8acee7c` (plan 03-21's deploy, dated 2026-09-23), which
> **predates** the review (`03-REVIEW.md`, same date, later) and every one of its fixes,
> including C-WR-01's application-only fix (commit `44f3a49`, no migration involved). This audit
> does not open a production connection (forbidden by its own constraints), so it cannot confirm
> any of the four fixes is live where real tenants' data lives. See **Production Closure Pending**
> below for the precise catalog queries that will prove each one after the migration and redeploy
> danlo has not yet approved.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| desk script (owner connection) → org-scoped tables | The four ETL scripts (`ingest-comptroller`, `ingest-overture`, `resolve`, `rederive`) connect as the migration owner, which bypasses RLS entirely; `resolveEtlOrg` is the ONLY thing that ties a write to one tenant | ~92k business/source rows, per org |
| `resolveEtlOrg`'s synthetic claim → `app.current_org_role()` | The claim installed is `{o:{id}}` and nothing else — no `sub`, no `o.rol` — so the ETL gets org context but resolves NO role and cannot pass a role-gated definer | org id only, transaction-local, dies at COMMIT |
| `authenticated` session → `business_merges` / `merge_candidates` write | Write access exists only through `SECURITY DEFINER` functions; the grant layer holds `SELECT` only on both tables | merge/decision state |
| `authenticated` session → `businesses` / `source_records` write | **Was** a live gap (A-WR-01): 0008's blanket grant from Phase 1 still let a Clerk session write `merged_into_id`, `status` or `location_source_id` directly, bypassing both the definers' tenancy check and the composite FK's org-blindness. `drizzle/0025` revokes it; not yet on production | spine record integrity |
| `SECURITY DEFINER` function → `pg_temp` | When a definer's `search_path` omits `pg_temp`, PostgreSQL searches it FIRST for relations — the documented CVE-2007-2138 pattern. `drizzle/0025`'s sweep appends `pg_temp` LAST on every definer; not yet on production | definer read/write integrity (hygiene; needs arbitrary SQL as `authenticated`, which the app does not grant) |
| a reviewer's decision → `app.record_merge` | **Was** a live, no-timing-required race (A-CR-01): the old definer read the candidate with no lock and refused `distinct` only for `reason='auto'`, so a second reviewer's "Same business" could silently overwrite a first reviewer's "Different" with no trace. `drizzle/0025` makes the definer the lock-holder (`for update`) and refuses any non-pending decision for both reasons; not yet on production | review decision integrity |
| Google Places lat/lng (future Phase 4) → `businesses.lat/lng` | The composite FK (`businesses_location_src_fk`) is the legal/durability boundary: a `google_places` source record is `ephemeral`, so citing it from `location_source_id` is refused with `23503` before Phase 4 exists | location provenance, CDLA/legal |
| tenant session → `overture_category_map` / `industry_clusters` / `counties` / `cities` built-ins | Reference rows are `org_id IS NULL`; `referencePolicies()` excludes NULL-org rows from every write policy, so a tenant can read but never edit a built-in | reference data integrity |
| `authenticated` session → the five new spine tables (`ingest_runs`, `merge_candidates`, `business_merges`, `business_aliases`, `source_records`/`businesses` reads) | `orgPolicies()` plus an `_org_idx` on every one; every DB test seeds two orgs, because with one org a policy returning everything and a policy returning the caller's rows are the same result set | cross-tenant record visibility |
| browser → server action (`recordReviewDecision`, `unmergeBusiness`) | `src/proxy.ts` carries no authorization by design (Next 16 renamed middleware partly in response to CVE-2025-29927; Vercel's guidance is that the proxy is for routing). A server action is a POST any client can make without the page ever rendering — `requireOrg()` inside the action is the only wall | review decisions, merge/unmerge |
| query module → rendered payload (review queue, business list, business detail, sources ledger) | `name_norm`, `street_norm`, `phone_blockable`, `internal_notes` and `chainKey` must never cross into a component, cell, tooltip, `data-` attribute or export | internal match-key / operator-annotation confidentiality |
| `[id]` route param → uuid lookup | An arbitrary string in the URL reaches a lookup; `isUuid()` guards it, and a foreign id and an unknown id both resolve to the same `notFound()` so existence is never confirmed to a wrong-tenant caller | tenant existence oracle |
| server component → Clerk Backend API (`users.getUserList`) | New surface this phase introduced beyond its own threat model (SUMMARY threat_flag, folded into C-WR-01): one outbound call per detail render with a reviewed/undone merge, sending only Clerk ids already stored as actors. **Was** unbounded (no timeout) and could fall back to printing a reviewer's email to every org member including `Member` role | availability (page hang) / PII (email) |
| desk operator CLI (`--org`, `--release`) → SoQL / S3 path / SQL | Every network host is a module constant; the only caller-influenced values are a `clerk_org_id` (resolved against `orgs`, never trusted as an org context by itself) and Overture's `--release`, validated against `^\d{4}-\d{2}-\d{2}\.\d+$` before interpolation | SSRF / injection surface |
| CI / repo source tree → the public internet | Must not be crossable at all outside `scripts/**` and three named client modules | budget, credential exposure |

---

## Threat Register

115 rows: 111 across the 22 plans of this phase (the same Threat ID recurring across plans is a
separate row per (plan, threat) pair, matching `01-SECURITY.md`/`02-SECURITY.md`'s convention),
plus 4 rows for the review findings (A-CR-01, A-WR-01, A-WR-02, C-WR-01). 8 rows carry
`disposition: accept`, verified against this document's Accepted Risks Log below. 2 rows carry
`disposition: transfer` (attribution is the definer's, not the caller's). 105 rows carry
`disposition: mitigate`. Of the mitigate rows, 4 (the review findings) are `closed — pending
production`; every other row is `closed` against the code and local database this audit measured
directly.

### 03-01 — Extensions migration, `.vercelignore`

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-14 | Information disclosure | CI / build inputs | mitigate | `.vercelignore:23-24,33` excludes `coverage/` and `.claude/` (both explained inline: the Vercel CLI uploads gitignored/untracked working-tree files, and `next build` type-checks every `.ts` it finds); `tests/unit/no-google-credential.test.ts` ran green in the 340/340 unit pass | closed |
| T-3-05 | Tampering | `app.distance_m` | accept | See Accepted Risks Log (AR-01) | closed (accepted) |
| T-3-03 | Tampering | `create extension` | accept | See Accepted Risks Log (AR-02) | closed (accepted) |

### 03-02 — Scoring, external key

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-12 | Denial of service | `score()` | accept | See Accepted Risks Log (AR-03) | closed (accepted) |
| T-3-13 | Information disclosure | `newExternalKey()` | mitigate | `src/lib/ids/external-key.ts:19,34-35` — `crypto.getRandomValues(new Uint8Array(6))` over a 32-symbol alphabet, comment pins ASVS V6 and rejects `Math` PRNG explicitly; called from `src/lib/ingest/upsert.ts:400` | closed |
| T-3-11 | Information disclosure | `Side.nameNorm` in `features` | mitigate | `tests/unit/no-internal-leak.test.ts` (compile-time `InternalKeysOmitted` type over `PublicBusiness`, plus a runtime scan of `PAYLOAD_BUILDERS`) is the registered sentinel this row cites; part of the green 340/340 unit run | closed |
| T-3-08 | Repudiation | scoring inputs | transfer | `score()` (`src/lib/resolve/score.ts`) is pure and takes no actor argument; attribution is `app.record_merge`'s job (T-3-08 rows under 03-05/03-11) | closed |

### 03-03 — Socrata client

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-03 | Tampering | `permitRowSchema` / `closureRowSchema` | mitigate | `src/lib/socrata/` zod schemas name exactly the fields read; part of `tests/unit` green run (Socrata payload-contract tests) | closed |
| T-3-04 | Tampering | `socrataQuery` `$where` | mitigate | Seeded county-code/NAICS constants only, `quote()` doubles an embedded `'`; confirmed no caller input reaches SoQL in `src/lib/socrata/client.ts` | closed |
| T-3-05 | Tampering (SSRF) | `SOCRATA_HOST` | mitigate | `src/lib/socrata/client.ts:38` `const SOCRATA_HOST = 'https://data.texas.gov'` — module-level constant, confirmed by direct read | closed |
| T-3-14 | Information disclosure | msw harness | mitigate | `tests/unit/no-network.test.ts:29-41` enumerates the exact allow-list (`src/lib/socrata/client.ts`, `src/lib/geocode/census.ts`, `src/lib/geocode/census-batch.ts`, `tests/unit/msw/`) and scans every other `.ts`/`.tsx`/`.json` under `src/`/`tests/` for the four host tokens; green in the unit run | closed |
| T-3-02 | Repudiation | `SOCRATA_APP_TOKEN` | accept | See Accepted Risks Log (AR-04) | closed (accepted) |

### 03-04 — Nav shell

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-10 | Elevation of privilege | new nav destinations | mitigate | `src/app/(app)/layout.tsx` (`requireOrg()` confirmed present, same file T-3-10/03-21 cites) guards `/review`, `/sources`, `/businesses`; RLS on every query beneath it | closed |
| T-3-11 | Information disclosure | `src/lib/ui/copy.ts` | mitigate | `grep -n 'name_norm\|internal_notes' src/lib/ui/copy.ts` → 0 matches (confirmed by read) | closed |
| T-3-09 | Information disclosure | shell components | accept | See Accepted Risks Log (AR-05) | closed (accepted) |

### 03-05 — Spine schema (migrations 0022/0023)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-06 | Information disclosure / legal | `businesses_location_src_fk` | mitigate | `drizzle/0023_spine_constraints_grants.sql:26-32` — composite FK to `(id, retention_class)`; `sr_google_is_ephemeral` (0022) means a Places record can never satisfy it; `tests/db/retention.test.ts` "location cites durable" is part of the green 222/222 DB run and is watched red by mutation M18 (`03-VALIDATION.md:123`) | closed |
| T-3-07 | Tampering | `overture_category_map` | mitigate | `src/db/schema/_helpers.ts:96-97` `referencePolicies()` — `org_id is not null and org_id = (select app.current_org_id())` on all three write policies; `.nullsNotDistinct()` on the built-in unique index; used at `src/db/schema/overture-categories.ts:35` | closed |
| T-3-08 | Repudiation | `business_merges.merged_by`, `merge_candidates.decided_by` | mitigate | `src/db/schema/business-merges.ts:59`, `merge-candidates.ts:60` — `orgPolicies()` only (no direct write policy); `drizzle/0024_merge_functions.sql:453-457` grants `execute` on the three definers to `authenticated`, not table DML | closed |
| T-3-09 | Information disclosure | all five new tables | mitigate | `orgPolicies()` + `_org_idx` confirmed present on `business-aliases.ts:36,38`, `business-merges.ts:54,59`, `businesses.ts:91`, `ingest-runs.ts:50,58`, `merge-candidates.ts:54,60`, `source-records.ts:38,49` (direct read of all six schema files) | closed |
| T-3-13 | Information disclosure | `businesses.external_key` | mitigate | `drizzle/0023_spine_constraints_grants.sql:44-60` — unique **per org**, shape CHECK, never a FK target | closed |
| T-3-01 | Tampering | `ingest_runs.org_id` | mitigate | `not null references orgs(id)` + `orgPolicies`; ETL org resolution is `resolveEtlOrg` — see central evidence below (T-3-01 summary) | closed |

### 03-06 — Normalizers

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-11 | Information disclosure | `name_norm`, `street_norm` | mitigate | `tests/unit/no-internal-leak.test.ts` (registered internal, Omit-type + runtime scan); UI-SPEC Rule 17 grep gate | closed |
| T-3-03 | Tampering | `nameNorm`, `addressKey` | mitigate | Pure string transforms in `src/lib/ingest/normalize.ts` (no `eval`, no input-built regex); confirmed by read; bound parameter everywhere stored | closed |
| T-3-14 | Information disclosure | CI network access | mitigate | `tests/unit/no-network.test.ts` (same sentinel as 03-03) | closed |
| T-3-12 | Denial of service | `nameNorm` on a pathological string | accept | See Accepted Risks Log (AR-06) | closed (accepted) |

### 03-07 — Census batch geocoder

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-05 | Tampering (SSRF) | `CENSUS_HOST` / `CENSUS_BATCH_PATH` | mitigate | `src/lib/geocode/census-batch.ts:56,289` — `const CENSUS_HOST = 'https://geocoding.geo.census.gov'`, address is a CSV field in a POST body (confirmed by read: `fetch(\`${CENSUS_HOST}${CENSUS_BATCH_PATH}\`, ...)`) | closed |
| T-3-03 | Tampering | `parseBatchLine` | mitigate | Confirmed field-3 branch-before-read pattern in `src/lib/geocode/census-batch.ts`; malformed lines return a named `bad_shape`, never throw | closed |
| T-3-12 | Denial of service | `geocodeBatch` | mitigate | `p-limit(3)` bounds concurrency; three-attempt 2s/8s/30s backoff, confirmed by read | closed |
| T-3-14 | Information disclosure | CI | mitigate | `tests/unit/no-network.test.ts` allow-lists `census-batch.ts` explicitly (line 40 of that file) | closed |

### 03-08 — Reference seed

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-07 | Tampering | `overture_category_map` | mitigate | Same `referencePolicies()` evidence as 03-05; `tests/db/reference-rows.test.ts` zero-rows/`42501` split is part of the green 222/222 DB run | closed |
| T-3-03 | Tampering | `scripts/seed.ts` | mitigate | Committed JSON under `src/seed/data/`, bound parameters; confirmed by read | closed |
| T-3-01 | Tampering | seed target | mitigate | `scripts/db.ts` `resolveSeedTarget` gates `--target=test\|prod`; `db:seed:prod` is the separate, human-gated script 03-21 ran | closed |

### 03-09 — ETL identity + upsert (source of the central org/actor mitigation)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-01 | Tampering | `resolveEtlOrg` | mitigate | `src/lib/ingest/etl-actor.ts:103-129` — throws `EtlOrgRequiredError` on an empty/absent `clerk_org_id` (line 105-107), resolves against `orgs.clerk_org_id` (111-116), never defaults to "the only org" (doc comment 88-101) | closed |
| T-3-02 | Repudiation | `app.actor_id` GUC | mitigate | `setEtlActor` (`etl-actor.ts:79-81`) sets a transaction-local GUC; `drizzle/0024_merge_functions.sql:414` and `drizzle/0025_review_fixes_spine.sql:56` both resolve `coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system')` — Clerk `sub` wins first, confirmed by read of both definer files | closed |
| T-3-15 | Elevation of privilege | `resolveEtlOrg`'s synthetic claim | mitigate | `etl-actor.ts:118-128` — claim is exactly `{o:{id: clerkOrgId}}`, no `sub`, no `o.rol`, no `set role`; `set_config(..., true)` is transaction-local (confirmed by read, matches the doc comment at 88-99) | closed |
| T-3-03 | Tampering | `upsertSourceRecord` | mitigate | `src/lib/ingest/upsert.ts` — bound parameters throughout, zod-bounded upstream, `jsonb` payload never interpolated (confirmed by read of the surrounding function) | closed |
| T-3-12 | Denial of service | `events` volume | mitigate | `payload_hash` diff gate confirmed in `src/lib/ingest/upsert.ts`; "re-run is idempotent" class of tests in the green DB run | closed |
| T-3-09 | Information disclosure | new tables | mitigate | Every DB fixture seeds two orgs (`seedTwoOrgs` used throughout `tests/db/`, confirmed via grants-audit.test.ts and merge-unmerge.test.ts reads) | closed |

### 03-10 — Blocking

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-12 | Denial of service | block explosion | mitigate | `src/lib/resolve/block.ts:79` `export const MAX_BLOCK_PAIRS = 500`; skip recorded rather than truncated (confirmed by read of the surrounding query builders at 138-219) | closed |
| T-3-09 | Information disclosure | cross-org candidates | mitigate | `o.org_id = c.org_id` + bound `$1` confirmed in `block.ts` query text (lines 138-219 cite `orgId` as the first bound value) | closed |
| T-3-03 | Tampering | generated SQL | mitigate | Bound parameters throughout `block.ts`; county/NPA lists bound as one array literal, not JS-array interpolation (the exact Pitfall 9 class caught elsewhere in this phase per the gotchas memory) | closed |
| T-3-04 | Tampering | `pg_trgm.similarity_threshold` | mitigate | `scripts/resolve.ts:323` `await tx.query(\`set local pg_trgm.similarity_threshold = ${BLOCK_SIMILARITY_THRESHOLD}\`)` — a committed numeric constant, `set local` scopes it to the transaction; `block.ts:317-322` re-reads and asserts it before running | closed |
| T-3-11 | Information disclosure | `merge_candidates.features` | mitigate | Confirmed: `features` column carries integers/`nameSim`/rule name only (same sentinel class as T-3-11 elsewhere); `candidate-pair.tsx` (03-16) has zero `nameNorm`/`name_norm` matches | closed |

### 03-11 — Merge/undo/decision definers (migration 0024)

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-08 | Repudiation | `business_merges.merged_by` | mitigate | `drizzle/0024_merge_functions.sql` (superseded in relevant part by `0025`, see A-CR-01 below) — actor resolved inside the definer, never a parameter; `authenticated` SELECT-only (0023) | closed |
| T-3-10 | Elevation of privilege | `app.undo_merge` foreign `p_merge_id` | mitigate | `drizzle/0025_review_fixes_spine.sql:217-226` — Step 0: `select * into v_merge from business_merges where id = p_merge_id and org_id = v_org for update; if not found then raise ... '42501'`; every later step repeats the org predicate (confirmed by full read of the function, lines 202-322) | closed |
| T-3-16 | Elevation of privilege | `app.record_merge` / `app.record_candidate_decision` caller-supplied ids | mitigate | `drizzle/0025_review_fixes_spine.sql:65-75` (winner/loser re-read under `org_id = v_org`, `42501` on miss) and `drizzle/0024_merge_functions.sql:420-424` (`record_candidate_decision`, same shape); three named cross-org refusal tests confirmed in `tests/db/merge-unmerge.test.ts` (part of the green 222/222 run) | closed |
| T-3-15 | Elevation of privilege | ETL org context | mitigate | `resolveEtlOrg` (03-09 evidence); "record_merge succeeds from an owner connection with no claims" confirmed as a named test in `tests/db/merge-unmerge.test.ts` | closed |
| T-3-02 | Repudiation | `set search_path` | mitigate | `drizzle/0024_merge_functions.sql:404` originally `set search_path = public` (bare); **superseded by A-WR-02 below** — `drizzle/0025`'s sweep rewrites every definer whose config was exactly that string to `public, pg_temp`, confirmed by the green `tests/db/grants-audit.test.ts` "every SECURITY DEFINER function searches pg_temp last" (local only — see Production Closure Pending) | closed |
| T-3-06 | Information disclosure / legal | `survive()` provenance pairs | mitigate | Composite FKs (03-05 evidence) refuse a Google-ephemeral parent; `src/lib/resolve/survivorship.ts` `survive()` states the rule (confirmed by read) | closed |
| T-3-13 | Information disclosure | `business_aliases` | mitigate | `src/db/schema/business-aliases.ts:36,38` `orgPolicies()` + partial unique index; key never a route parameter (confirmed, matches `src/components/business-detail/copy-lead-key.tsx`'s display-only usage) | closed |

### 03-12 — Comptroller ingest script

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-01 | Tampering | `--org` | mitigate | `scripts/ingest-comptroller.ts:130-183` — `IngestOrgRequiredError` thrown on empty `--org`; calls `resolveEtlOrg` per transaction (line 249) | closed |
| T-3-04 | Tampering | SoQL `$where` | mitigate | Same evidence as 03-03/03-10: `quote()` over seeded constants only | closed |
| T-3-05 | Tampering (SSRF) | hosts | mitigate | `SOCRATA_HOST` (03-03) and `CENSUS_HOST` (03-07) module constants, confirmed shared by this script's imports | closed |
| T-3-03 | Tampering | row ingestion | mitigate | zod on every Socrata row and Census CSV line before the driver (confirmed by read); bound parameters | closed |
| T-3-02 | Repudiation | ETL attribution | mitigate | `scripts/ingest-comptroller.ts:248` `await setEtlActor(client, SCRIPT)` before `resolveEtlOrg` (line 249), every transaction | closed |
| T-3-15 | Elevation of privilege | ETL org context | mitigate | `resolveEtlOrg(tx, clerkOrgId)` per transaction (03-09 central evidence) | closed |
| T-3-12 | Denial of service | the geocode pass | mitigate | `p-limit(3)`, 1,000-row chunks, 2s/8s/30s backoff (03-07 evidence, shared) | closed |
| T-3-14 | Information disclosure | CI | mitigate | `tests/unit/no-network.test.ts` allow-lists `scripts/**` as the only network caller outside the three named modules | closed |

### 03-13 — Overture ingest script

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-05 | Tampering (SSRF) | `--release` | mitigate | `scripts/ingest-overture.ts:103,171` — `RELEASE_PATTERN.test(release)` checked at both the argument-parse site and the S3-path build site, confirmed by grep of both line numbers; bucket/region are module constants | closed |
| T-3-03 | Tampering | `overtureRowToSourceRecord` | mitigate | zod names exactly the fields read; named `skipped` reason rather than throw (confirmed by read) | closed |
| T-3-01 | Tampering | `--org` | mitigate | `scripts/ingest-overture.ts:599` throws `--org=<clerk_org_id> is required` | closed |
| T-3-15 | Elevation of privilege | ETL org context | mitigate | `scripts/ingest-overture.ts:232-233` `setEtlActor(x, 'ingest-overture')` then `resolveEtlOrg(x, clerkOrgId)`, inside `inEtlTransaction`, called from every batch (lines 355,371,395,414) | closed |
| T-3-12 | Denial of service | DuckDB memory | mitigate | `threads:'4'`, `memory_limit:'6GB'` (per plan; confirmed present as constants in the DuckDB connection setup) | closed |
| T-3-14 | Information disclosure | CI | mitigate | `@duckdb/node-api` is a devDependency imported only from `scripts/` (confirmed: no import under `src/`); CI never reaches S3 | closed |
| T-3-11 | Information disclosure | `name_norm` | mitigate | Same sentinel as 03-06 (`no-internal-leak.test.ts`) | closed |

### 03-14 — Resolve desk script

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-01 | Tampering | `--org` | mitigate | `scripts/resolve.ts:84-120` `ResolveOrgRequiredError` on empty `--org` | closed |
| T-3-15 | Elevation of privilege | ETL org context | mitigate | `scripts/resolve.ts:182-183` `setEtlActor` then `resolveEtlOrg` per transaction; Stage 0 preflight (`resolve.ts:201-221`) asserts `app.current_org_id()` resolves to the expected org BEFORE any stage runs, raising `ResolvePreflightError` otherwise | closed |
| T-3-12 | Denial of service | block explosion | mitigate | `MAX_BLOCK_PAIRS = 500` (03-10 central evidence), `stats.skipped_blocks` recorded | closed |
| T-3-08 | Repudiation | auto-merge attribution | mitigate | Every merge goes through `app.record_merge`; `app.actor_id = 'etl:resolve'` set per transaction (confirmed via `setEtlActor(client, 'resolve')` call sites) | closed |
| T-3-09 | Information disclosure | cross-org merge | mitigate | Every statement bound to `$1` org id (same pattern as 03-10's blocking queries, confirmed by the shared `resolveTransactions`/`etlTransactions` executor) | closed |
| T-3-02 | Repudiation | `merge_candidates.decision` | mitigate | Writes only through `app.record_merge`/`app.record_candidate_decision`, never a direct session-role UPDATE (grants confirmed: `authenticated` SELECT-only on `merge_candidates`) | closed |

### 03-15 — Review/unmerge server actions + query module

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-10 | Elevation of privilege | `recordReviewDecision`, `unmergeBusiness` | mitigate | `src/server/actions/record-review-decision.ts:76` and `unmerge-business.ts:72` — `await requireOrg();` is literally the first executable statement in both (confirmed by direct read); `tests/unit/server-actions-guard.test.ts` walks `src/server/actions/` and fails on any action module where this is not true (part of the green 340/340 unit run) | closed |
| T-3-08 | Repudiation | decision and merge attribution | mitigate | Both actions call only the `SECURITY DEFINER` functions (`_merge-decisions.ts`); `authenticated` holds no write DML on `merge_candidates`/`business_merges` (0023 grants) | closed |
| T-3-09 | Information disclosure | foreign ids | mitigate | Candidate/merge rows re-read under RLS before write; a foreign id and an unknown id both resolve to `not_found` (confirmed via `_merge-decisions.ts` and the copy constants `NOT_FOUND`/`REVIEW_ALREADY_DECIDED`) | closed |
| T-3-11 | Information disclosure | query projections | mitigate | Same `no-internal-leak.test.ts` sentinel; `PUBLIC_BUSINESS_KEYS` Omit-type excludes `internalNotes`/`nameNorm`/`streetNorm`/`phoneBlockable`/`chainKey` at compile time (`tests/unit/no-internal-leak.test.ts:38-47`) | closed |
| T-3-05 | Tampering | `/businesses` search predicate | mitigate | `src/server/queries/businesses.ts:120-121` `unaccent(b.display_name) ilike unaccent('%' \|\| ${pattern} \|\| '%')` — `${pattern}` is a bound drizzle-sql parameter, confirmed by direct read; wildcard chars escaped per the comment at line 84 | closed |
| T-3-13 | Information disclosure | `external_key` search | accept | See Accepted Risks Log (AR-07) | closed (accepted) |

### 03-16 — Review queue UI

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-10 | Elevation of privilege | review action POSTed directly | mitigate | Same `requireOrg()`-first evidence as 03-15; the component (`src/components/review/candidate-pair.tsx`) sends only `{candidateId, decision}` | closed |
| T-3-11 | Information disclosure | the chip band | mitigate | `grep -n 'nameNorm\|name_norm' src/components/review/candidate-pair.tsx` → 0 matches, confirmed live by this audit | closed |
| T-3-08 | Repudiation | the decision's actor | transfer | Stamped by the definer; component sends only a candidate id and decision enum (confirmed by read) | closed |
| T-3-13 | Information disclosure | pair identifiers | accept | See Accepted Risks Log (AR-08) | closed (accepted) |

### 03-17 — `/sources` screen

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-09 | Information disclosure | `/sources` | mitigate | `requireOrg()` in `src/app/(app)/layout.tsx`; `ingest_runs` `orgPolicies()` (03-05 evidence) | closed |
| T-3-03 | Tampering | rendering `stats` and `error` | mitigate | React's default text escaping, no `dangerouslySetInnerHTML` in the sources components (confirmed by grep); band bars clamp through `Number()` | closed |
| T-3-11 | Information disclosure | the ledger | mitigate | Ledger renders counts/versions only (confirmed by read of the sources components) | closed |
| T-3-14 | Information disclosure | licence compliance | mitigate | `src/components/sources/attribution-block.tsx:8` — "LICENCE TEXT (T-3-14)... CDLA-Permissive 2.0" confirmed present by direct read | closed |

### 03-18 — `/businesses` list

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-05 | Tampering | search predicate | mitigate | Same bound-parameter evidence as 03-15 (`businesses.ts:120-121`); query string trimmed/capped at 200 chars per SUMMARY, `status`/`cluster` allow-listed | closed |
| T-3-09 | Information disclosure | the list | mitigate | `requireOrg()` in layout + `orgPolicies()` on `businesses` (`businesses.ts:91`) | closed |
| T-3-11 | Information disclosure | rendered columns | mitigate | `grep -rn 'name_norm\|street_norm\|internal_notes' src/components/business-list/` → 0 matches (confirmed live) | closed |
| T-3-13 | Information disclosure | the lead key | mitigate | Every href is `/businesses/{uuid}` (confirmed via `src/app/(app)/businesses/[id]/page.tsx`'s own routing and the SUMMARY's pinned test) | closed |
| T-3-03 | Tampering | verbatim names | mitigate | No `dangerouslySetInnerHTML` (confirmed by grep of `src/components/business-list/`) | closed |

### 03-19 — Business detail page + unmerge dialog

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-10 | Elevation of privilege | `unmergeBusiness` POSTed directly | mitigate | Same `requireOrg()`-first evidence as 03-15 (`unmerge-business.ts:72`) | closed |
| T-3-09 | Information disclosure | `[id]` | mitigate | `src/app/(app)/businesses/[id]/page.tsx:20,74` `import { isUuid } from '@/lib/ids'; ... if (!isUuid(id)) notFound();` — confirmed live, guard runs before any query | closed |
| T-3-13 | Information disclosure | the lead key | mitigate | Displayed/copyable only (`src/components/business-detail/copy-lead-key.tsx`), never a route parameter or FK | closed |
| T-3-11 | Information disclosure | the field list | mitigate | Same `no-internal-leak.test.ts` sentinel; confirmed no `internal_notes`/`name_norm` in `src/app/(app)/businesses/[id]/` by grep | closed |
| T-3-06 | Information disclosure / legal | the "Not stored" rendering | mitigate | Composite FK (03-05/03-11 evidence) means the field cannot be set from a Google payload at all; the screen renders that honestly (confirmed by read) | closed |
| T-3-08 | Repudiation | the unmerge actor | transfer | Stamped by `app.undo_merge`, which reads the actor itself (03-11 evidence); component sends only `{ mergeId }` | closed |

🔴 03-19 also introduced the Clerk `getUserList` outbound call (SUMMARY `## Threat Flags`,
`threat_flag: outbound-identity-lookup`) — new surface beyond this plan's own `<threat_model>`
block. It is not a numbered row here to avoid double-counting: it is registered as the **C-WR-01**
row below (the review found the same surface independently, with a sharper finding — no timeout,
an email-address fallback — than the plan's own "read-only, server-side, failure falls back to
the stored id"). See **Unregistered Flags**.

### 03-20 — Real desk run

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-01 | Tampering | the run's target org | mitigate | Every command in `docs/measurements/03-desk-run.md`'s recorded invocations carries explicit `--org=`; `--target` defaulted to `test` (confirmed: production is at migration 0024, not 92k rows) | closed |
| T-3-14 | Information disclosure | credentials during the run | mitigate | No paid API/key involved (Socrata keyless, Overture public S3, Census keyless); `no-google-credential.test.ts` green | closed |
| T-3-12 | Denial of service | the real volume | accept | See Accepted Risks Log (AR-09) | closed (accepted) |
| T-3-02 | Repudiation | the run's attribution | mitigate | `setEtlActor` per transaction (03-09 central evidence), `etl:<script>` actor strings | closed |
| T-3-15 | Elevation of privilege | ETL org context | mitigate | `resolveEtlOrg` per transaction (03-09 central evidence); preflight confirms `app.current_org_id()` before the run | closed |
| T-3-11 | Information disclosure | the committed measurements | mitigate | `docs/measurements/03-desk-run.md` — spot-checked for `name_norm`/`internal_notes`/credential-shaped strings: none found | closed |

### 03-21 — Production migration/deploy/e2e

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-01 | Tampering | `db:migrate:prod` | mitigate | `scripts/db.ts --target=prod` demands the session pooler on 5432 (D-04 pattern, carried from Phase 2); `03-21-SUMMARY.md` records a pre-flight read (journal 21, 0 businesses) before the write and a post-flight catalog read (journal 25) after | closed |
| T-3-07 | Tampering | `db:seed:prod` | mitigate | `03-21-SUMMARY.md:47` — seed ran twice, 70 inserted then 0 (idempotent, confirmed by the second run's own report) | closed |
| T-3-09 | Information disclosure | the new tables on production | mitigate | `03-21-SUMMARY.md` lines 89-91 (post-flight catalog read): `authenticated` holds `SELECT` only on `ingest_runs`, `merge_candidates`, `business_merges`, `business_aliases`; `overture_category_map` correctly holds S/I/U/D (a reference table, RLS-confined) | closed |
| T-3-14 | Information disclosure | e2e against production | mitigate | `tests/e2e/_required-env.ts` reports variable names only; `tests/e2e/sources.spec.ts`/`businesses.spec.ts` open no DB connection (confirmed by the plan's own design and the SUMMARY's test list) | closed |
| T-3-10 | Elevation of privilege | the deployed screens | mitigate | `03-21-SUMMARY.md` — signed-out smokes of the four new routes all `307` to `/sign-in`; full e2e suite green against the deployed alias with a real signed-in Clerk session (20 passed, 5 deliberate self-skips, 0 failed) | closed |

**🔴 Note on 03-21's scope:** these five rows verify the state production reached at migration
`0024` / commit `8acee7c` — that deployment predates the review and is NOT what this audit is
verifying as "current." The four review-finding rows below are what changed after `8acee7c`,
and those are the rows still open on production. 03-21's own rows above remain correctly closed:
nothing in migrations 0021-0024 or in commit `8acee7c` regressed.

### 03-22 — Validation mutations

| Threat ID | Category | Component | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-3-09 | Information disclosure | M22 (`grant update on ingest_runs`) | mitigate | `03-VALIDATION.md:127,190` — M22 listed and recorded as run, reding the grants-matrix test; catalog-verified via `information_schema.role_table_grants`, not `has_table_privilege` alone (the class of check that missed Phase 2's M12b column-grant gap) | closed |
| T-3-06 | Information disclosure / legal | M18 (`businesses_location_src_fk`) | mitigate | `03-VALIDATION.md:123,149,191` — M18 recorded as run, reds "location cites durable" only | closed |
| T-3-11 | Information disclosure | M24 (`unaccent` in blocking SQL) | mitigate | `03-VALIDATION.md:129,194,203` — M24 recorded as run, reds "SQL never normalizes" and the blocking EXPLAIN gate | closed |
| T-3-01 | Tampering | mutations on a shared tree | mitigate | `03-VALIDATION.md` frontmatter `status: approved`, `nyquist_compliant: true`; mutation-check discipline (one at a time, `git diff --stat` empty between) is this phase's own stated practice, matching the `reference_gsd_windows_worktree_gotchas` lesson this audit's own environment carries | closed |

---

### Security-relevant code review findings (not in the original per-plan threat models)

`03-REVIEW.md` (2026-09-23, status: `issues_found`) found these during implementation, after the
22 plans' threat models were written; `03-REVIEW-FIX.md` (same date, status: `all_fixed`) fixed
all four on this branch. Each is verified against the current code exactly as `02-SECURITY.md`
verified CR-01/WR-04 — but see **Production Closure Pending**: none of the four is live where
real tenants' data lives yet.

| Finding | Category | Component | Disposition | Evidence (code, HEAD `f45d0cf`) | Status |
|---|---|---|---|---|---|
| A-CR-01 | Elevation of privilege / Repudiation | `app.record_merge` reviewer race | mitigate | `drizzle/0025_review_fixes_spine.sql:79-93` — candidate read `for update` (serialises against `record_candidate_decision`'s UPDATE, which takes the same row lock), refuses `distinct` (`55000 'pair was marked distinct'`) and any non-pending decision (`55000 'candidate already decided'`) for BOTH reasons, not only `'auto'`; closing UPDATE at line 162-167 is pending-only with a FOUND check. Named tests in `tests/db/merge-unmerge.test.ts:330,352,381` (`'a reviewer "Same business" after a "Different" is refused, never a silent overwrite'`, `'a candidate already merged is refused by name, not re-merged'`), confirmed present by grep and part of the green 222/222 DB run. `03-REVIEW-FIX.md:74` records the mutation check: restoring `and p_reason = 'auto'` turned only the first test red. | closed (production verified 2026-09-23) |
| A-WR-01 | Elevation of privilege | `authenticated` DML on `businesses`/`source_records` | mitigate | `drizzle/0025_review_fixes_spine.sql:348` `revoke insert, update, delete on businesses, source_records from authenticated;`. Behavioral tests confirmed live in `tests/db/grants-audit.test.ts:497-529` (`'a Clerk user cannot write merged_into_id on its own business'` pins `42501`/`permission denied for table businesses`; `'a Clerk user cannot insert a source record'` pins the same for `source_records`), both part of the green 222/222 DB run (positive control included: the same caller CAN still `select` the row) | closed (production verified 2026-09-23) |
| A-WR-02 | Elevation of privilege (definer hygiene, CVE-2007-2138 class) | every `SECURITY DEFINER` function's `search_path` | mitigate | `drizzle/0025_review_fixes_spine.sql:364-382` — a `DO` block rewrites every definer (plus two invoker helpers only definers call) whose `proconfig` was exactly `search_path=public` to `search_path=public, pg_temp`; anything else is named via `raise notice` rather than guessed at. `tests/db/grants-audit.test.ts:468-489` `'every SECURITY DEFINER function searches pg_temp last'` reads the live catalog (`pg_proc.proconfig`), asserts the enumeration includes `record_merge`/`record_candidate_decision`/`emit_event`/`reserve_budget`, and asserts zero rows lack `'search_path=public, pg_temp'` — confirmed passing in the green 222/222 DB run, which is itself the direct proof this audit needed (not a claim from the fix report) | closed (production verified 2026-09-23) |
| C-WR-01 | Information disclosure (PII) / Denial of service (availability) | Clerk `getUserList` on `/businesses/[id]` | mitigate | `src/app/(app)/businesses/[id]/actor-names.ts` (new file, confirmed by full read) — `ACTOR_LOOKUP_TIMEOUT_MS = 1500` races `getUserList` via `Promise.race`, losing promise's rejection swallowed (lines 60-71); `MAX_LOOKUP = 100` caps the page (line 15, inside Clerk's 500 ceiling); `displayNameOf` (lines 24-35) is first+last, else username, else `null` (→ raw id) — **the email fallback the review found is gone, confirmed by the absence of any `primaryEmailAddress`/`email` token in the file**. Named tests confirmed present in `tests/unit/actor-names.test.ts:50,68,104` (`'a Clerk lookup that never answers falls back to the raw ids once the budget runs out'`, `'a user with no name and no username is never named by their email'`, `'the page size stays inside what Clerk accepts'`), part of the green 340/340 unit run | closed (production verified 2026-09-23) |

*Status: open · closed · closed — pending production*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Production Closure Pending

Every row above marked `closed — pending production` traces to the same root cause this audit's
own constraints name explicitly: production Supabase (`jahgeqshuesndyscnmjo`) is at migration
`0024` (`drizzle/0025_review_fixes_spine.sql` — 445 lines, A-CR-01 + A-WR-01 + A-WR-02 +
`app.apply_survivorship_if_changed` — is applied to the **local** `siteless_test` database only,
per `03-REVIEW-FIX.md`'s "Production owed" framing and `03-VERIFICATION.md`'s own re-verification
notes), and the deployed application commit is `8acee7c` (`docs/deploy.md` §10, dated
2026-09-23, plan 03-21's deploy) — which **predates** `03-REVIEW.md` and therefore predates
C-WR-01's fix (`commit 44f3a49`) too. This audit does not open a production connection (forbidden
by its own constraints), so it cannot itself close these four rows. It states precisely what
would close each one, so the orchestrator can measure it directly after danlo approves the
migration and redeploy — the same pattern `02-SECURITY.md`'s Closure subsection used.

| Row | What is missing on production | Exact read-only query to run after `db:migrate:prod` (0025) / redeploy |
|---|---|---|
| A-CR-01 | `app.record_merge`'s body still matches `drizzle/0024`'s (no `for update`, no pending-only refusal for both reasons) | `select pg_get_functiondef('app.record_merge(uuid,uuid,uuid,text,integer,jsonb,jsonb)'::regprocedure);` — expect the body to contain `for update` immediately after the `merge_candidates` select, and `raise exception 'record_merge: pair was marked distinct'` unconditioned on `p_reason`. Simpler proxy: compare `md5(pg_get_functiondef(...))` against the local value measured by this audit's own `withRollback` read, or re-run `tests/db/merge-unmerge.test.ts`'s two named tests against a production-shaped connection in a rolled-back transaction. |
| A-WR-01 | `authenticated` still holds INSERT/UPDATE/DELETE on `businesses` and `source_records` (Phase 1's 0008 blanket grant, never revoked on production) | `select grantee, table_name, privilege_type from information_schema.role_table_grants where grantee = 'authenticated' and table_name in ('businesses','source_records') order by 1,2,3;` — expect exactly two rows, both `SELECT`, one per table. Any `INSERT`/`UPDATE`/`DELETE` row means the revoke has not landed. |
| A-WR-02 | Every definer's `proconfig` is still `{search_path=public}` (no `pg_temp`) | `select p.oid::regprocedure::text as fn, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','public') and p.prosecdef order by 1;` — expect every row's `proconfig` to equal `{search_path=public, pg_temp}` (array with the trailing `pg_temp`). `03-21-SUMMARY.md`'s own post-flight read already recorded these as `search_path=public` on production — this query re-runs that same read and expects a different answer once 0025 lands. |
| C-WR-01 | The deployed `/businesses/[id]` still runs the pre-review `actorNames`/inline lookup with no timeout and (if the finding's exact original code is what shipped at `8acee7c`) an email fallback | `curl -fsS https://siteless-iota.vercel.app/api/health` → confirm `"commit"` is `44f3a49` or a later sha that contains it (i.e., `git merge-base --is-ancestor 44f3a49 <deployed-sha>` on the developer machine that has both commits). This is a deploy-freshness check, not a migration check — no database query proves it. |

None of these four gaps is exploitable through the deployed application's own UI/action surface
in a way this audit found evidence of at `8acee7c` — the risk is specifically that a **second**
reviewer session, a hand-written SQL statement as `authenticated`, or arbitrary temp-table SQL
would need to reach production to exploit A-CR-01/A-WR-01/A-WR-02 respectively, and the deployed
app does not hand out any of those paths today. C-WR-01 is the one with a live, low-effort
trigger (any detail-page view with a reviewed/undone merge, while Clerk is slow) but is bounded
to a hang plus (in the worst case) an email string to org members, not a cross-tenant leak.

**Action:** `pnpm db:migrate:prod` for `0025` (pre-flight read → danlo's approval →
`db:migrate:prod` → post-flight catalog read, the same sequence `02-14`/`03-21` used), and a
`vercel --prod` redeploy of the current branch HEAD (`f45d0cf` or later), before this phase is
treated as fully closed on production.

---

## Unregistered Flags

One: `03-19-SUMMARY.md`'s `## Threat Flags` table, `threat_flag: outbound-identity-lookup` —
the Clerk `users.getUserList` call added to `src/app/(app)/businesses/[id]/page.tsx`. This is
new attack surface beyond what 03-19's own `<threat_model>` block named (it did not anticipate
an outbound third-party API call at all). It is **not left as an open gap**: `03-REVIEW.md`
independently found the same surface (C-WR-01: no timeout, an email-address fallback) and
`03-REVIEW-FIX.md` fixed it on this branch. It is folded into the register above as the C-WR-01
row rather than double-counted. Per this audit's adversarial stance, "found and fixed" is not
the same as "never a gap" — it is recorded here precisely so the fact that this phase's original
threat model missed an entire outbound network call is visible, not smoothed over.

No other plan's `## Threat Flags` section named new surface; every other plan explicitly wrote
"None" with a reason tying back to an existing `T-3-NN` id (confirmed by reading all 22 SUMMARY
files' `## Threat Flags` sections; 03-09's SUMMARY carries no such section at all — its threats
are covered by the 03-09 plan rows above, and nothing in its Deviations/Issues sections names
new surface).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|--------------|------|
| AR-01 | T-3-05 (03-01, Tampering, `app.distance_m`) | Four `double precision` parameters, no table access, `immutable parallel safe`, not a `SECURITY DEFINER` — confirmed by reading the function signature in `drizzle/0021_extensions.sql`: no injectable surface and no `search_path` to attack. | plan author (03-01-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-02 | T-3-03 (03-01, Tampering, `create extension`) | Two fixed contrib extensions (`pg_trgm`, `fuzzystrmatch`/`unaccent` per plan) installed by the migration owner; no caller input reaches the statement — confirmed, migrations are hand-authored and only `pnpm db:migrate` runs them. | plan author (03-01-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-03 | T-3-12 (03-02, Denial of service, `score()`) | Pure arithmetic over two records, no allocation proportional to input; the real DoS surface (pair-count explosion) is bounded by `MAX_BLOCK_PAIRS = 500` (T-3-12/03-10, `block.ts:79`, mitigate and verified above), which is the module actually at risk. | plan author (03-02-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-04 | T-3-02 (03-03, Repudiation, `SOCRATA_APP_TOKEN`) | Optional, server-only, never a `NEXT_PUBLIC_` variable; the Socrata client works unauthenticated today, so there is nothing to leak or forge yet. Confirmed absent from `.env.example`'s `NEXT_PUBLIC_` set. | plan author (03-03-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-05 | T-3-09 (03-04, Information disclosure, shell components) | No server data is imported into a `"use client"` shell module; org label and user email arrive as props from the already-`requireOrg()`-scoped layout. Confirmed: the shell components (`app-sidebar`, `mobile-tab-bar`, `more-sheet`) take props only, no data fetch of their own. | plan author (03-04-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-06 | T-3-12 (03-06, Denial of service, `nameNorm` on a pathological string) | Linear in input length; Socrata and Overture name fields are short and zod-bounded before the normalizer runs. No user-controlled input reaches this function at all in Phase 3 (desk-script only). | plan author (03-06-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-07 | T-3-13 (03-15, Information disclosure, `external_key` search) | Searching by lead key is org-scoped by RLS like every other query; the key is not a route parameter, and the namespace is 1.07e9 at 0.009% occupancy (same generator as T-3-13/03-02, `external-key.ts`), so enumeration is not practical even before the RLS wall. | plan author (03-15-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-08 | T-3-13 (03-16, Information disclosure, pair identifiers) | The candidate id is a uuid, org-scoped by RLS; the external lead key does not render on the review screen at all (confirmed: `candidate-pair.tsx` renders no `externalKey`/lead-key field). | plan author (03-16-PLAN.md `<threat_model>`) | 2026-09-23 |
| AR-09 | T-3-12 (03-20, Denial of service, the real volume) | ~92k rows into a local PostgreSQL 18.6 with indexes already built; the resolve pass is bounded by the same `MAX_BLOCK_PAIRS = 500` cap (T-3-12/03-10); the whole run measured ~20 minutes per `docs/measurements/03-desk-run.md`. This is a desk-run resource question, not a production-reachable DoS — production has 0 businesses (03-21 pre-flight read) and no scheduler exists yet to run this against it unattended. | plan author (03-20-PLAN.md `<threat_model>`) | 2026-09-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Closed — Pending Production | Open | Run By |
|------------|----------------|--------|------------------------------|------|--------|
| 2026-09-23 | 115 | 111 | 4 | 0 | gsd-security-auditor |

**Supporting evidence for this run:**

- `pnpm test:unit` (via the pnpm 12.5.1 store launcher — bare `pnpm` on this machine is global
  11.9.0) → 46 files, **340/340 tests passed**, run independently by this audit
- `pnpm test:db --config vitest.db.config.ts --pool=forks` → 30 files, **222/222 tests passed**
  (local PostgreSQL 18.6, `siteless_test`), run independently by this audit
- `03-REVIEW.md` (2026-09-23, status: `issues_found`, split across `03-REVIEW-partA/B/C.md`,
  124+ files reviewed across three parallel `gsd-code-reviewer` slices) — the four
  security-relevant findings this audit folds in (A-CR-01, A-WR-01, A-WR-02, C-WR-01) were read
  in full, not summarized
- `03-REVIEW-FIX.md` (2026-09-23, status: `all_fixed`, split across `03-REVIEW-FIX-partA/B/C.md`)
  — each of the four fixes' "Applied fix" and "Tests" sections were read, and the cited files
  (`drizzle/0025_review_fixes_spine.sql`, `src/app/(app)/businesses/[id]/actor-names.ts`,
  `tests/db/grants-audit.test.ts`, `tests/db/merge-unmerge.test.ts`, `tests/unit/actor-names.test.ts`)
  were independently opened and read by this audit rather than trusting the fix report's own
  claims — matching `02-SECURITY.md`'s standard for CR-01/WR-04
- `03-VERIFICATION.md` (2026-09-23T19:30:00Z, status: `passed`, re-verification after gap
  closure) — independently confirms `drizzle/0025` is local-only and names the exact production
  follow-up this audit's Production Closure Pending section also names
- `03-VALIDATION.md` (`status: approved`, `nyquist_compliant: true`) — M18, M22, M24 (the three
  mutations whose threat rows this register cites under 03-22) confirmed present and recorded as
  run, each reding the predicted named test/gate
- `docs/deploy.md` §10 — the live production deployment table, read directly: verified commit
  `8acee7c`, deployed 2026-09-23 via plan 03-21, which predates `03-REVIEW.md`'s findings
- Every plan's `## Threat Flags` section in its SUMMARY.md was read; 21 of 22 report "None" with
  a named reason tying back to the register above (03-09's SUMMARY carries no such section — its
  register rows above are unaffected); the one flag with new surface (03-19's
  `threat_flag: outbound-identity-lookup`) is folded into C-WR-01 rather than left as a gap — see
  **Unregistered Flags**
- Direct code reads (not excerpted from any report) confirming central, cross-cutting mitigations
  used by many register rows at once: `src/lib/ingest/etl-actor.ts` (resolveEtlOrg/setEtlActor,
  T-3-01/T-3-02/T-3-15 across eight plans), `src/db/schema/_helpers.ts` (`referencePolicies`/
  `orgPolicies`, T-3-07/T-3-09), `tests/unit/no-internal-leak.test.ts` and
  `tests/unit/no-network.test.ts` (T-3-11/T-3-14, most plans), `drizzle/0025_review_fixes_spine.sql`
  in full (445 lines, all four review-finding rows), `tests/db/grants-audit.test.ts` (A-WR-01/
  A-WR-02's exact behavioral and catalog assertions), `tests/db/merge-unmerge.test.ts` (A-CR-01's
  exact named tests), `src/app/(app)/businesses/[id]/actor-names.ts` and
  `tests/unit/actor-names.test.ts` in full (C-WR-01)
- No production database connection was opened at any point in this audit (forbidden by its own
  constraints); the Production Closure Pending conclusions rest entirely on `03-REVIEW-FIX.md`,
  `03-VERIFICATION.md`, `03-21-SUMMARY.md`'s own post-flight catalog read, and `docs/deploy.md`'s
  own words — not on any live read this audit performed itself

## Observations

*(Not register rows — noted per this audit's own instructions, since they do not correspond to
a declared `<threat_model>` disposition.)*

1. **A-CR-02, A-CR-03, A-WR-03 through A-WR-09, C-CR-01 and C-WR-02/C-WR-03 from `03-REVIEW.md`
   are real findings this audit did not register as threat rows**, because they are correctness
   / data-integrity / UX-consistency defects rather than security findings under this audit's own
   brief (confidentiality, integrity-of-authorization, availability against an adversary, or
   repudiation of an attributable action). `03-REVIEW-FIX.md` records all of them as fixed on
   this branch (`03-VERIFICATION.md` independently confirms A-CR-02 and B-CR-01, the two BLOCKER
   gaps, are closed). Named here so a future audit does not need to re-derive which review
   findings were in-scope for a security register and which were not.
2. **The four in-scope findings share one root cause with `02-SECURITY.md`'s two open rows**: a
   correct, tested fix that exists only on a feature branch and only in a locally-applied
   migration is not evidence about production. This audit treated that the same way — closed
   against the code and the local database, explicitly not closed against the tenant data that
   actually exists.
3. **`03-21`'s production deployment (`8acee7c`) is a real, verified, currently-serving state**
   that is *older* than the code this audit is otherwise verifying (HEAD `f45d0cf`). Anyone
   reading only "production journal 24, all good" from 03-21's own SUMMARY without also reading
   `03-REVIEW.md`/`03-REVIEW-FIX.md` (dated after 03-21) would miss that four fixes shipped
   *after* that production deploy and have not reached it.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer) — 105 `mitigate` (101 closed
      + 4 closed — pending production), 8 `accept`, 2 `transfer`
- [x] Accepted risks documented in Accepted Risks Log (AR-01 through AR-09)
- [ ] `threats_open: 0` confirmed **against the code and local database** — yes, 0 rows are
      `open`. **Not yet confirmed against production**: 4 rows are `closed — pending production`,
      requiring `db:migrate:prod` (0025) and a redeploy danlo has not yet approved. See
      **Production Closure Pending**.
- [x] `status: verified` set in frontmatter — verified against the code and the local database;
      the frontmatter's `threats_open: 0` reflects that same scope, matching `02-SECURITY.md`'s
      precedent of counting a migration/deploy-gated row as closed once its code and local-test
      evidence are directly measured, with the production gap tracked separately rather than
      counted as `open`

**Approval:** verified against code and the local `siteless_test` database — 115/115 threats
closed at that scope (105 mitigated [4 pending a production migration + redeploy], 8 accepted, 2
transferred). Production closure requires danlo's approval of `pnpm db:migrate:prod` for `0025`
and a `vercel --prod` redeploy from `f45d0cf` or later; the exact post-flight queries to run
afterward are listed in **Production Closure Pending** above.


## Production Closure (2026-09-23)

danlo approved "Apply + redeploy + PR" on 2026-09-23. Sequence, each step read back from the
catalog through a SEPARATE read-only connection (Supabase MCP), never from the migrating script:

| Step | Evidence |
|---|---|
| Pre-flight (before any write) | `drizzle.__drizzle_migrations` = 25 · `businesses` = 0 · `merge_candidates` = 0 · `authenticated` held DELETE/INSERT/SELECT/UPDATE on `businesses` + `source_records` · all 13 app definers `search_path=public` |
| `pnpm db:migrate:prod` (once) | exit 0 |
| Post-flight | migrations = **26** · `authenticated` = **SELECT only** on businesses, source_records, ingest_runs, merge_candidates, business_merges, business_aliases (A-WR-01) · definers **13/13** carry `pg_temp` (A-WR-02) · `record_merge` body contains `for update` (A-CR-01) · `undo_merge(p_merge_id uuid, p_loser_fields jsonb, p_winner_fields jsonb)` and `apply_survivorship_if_changed(p_org uuid, p_id uuid, p_fields jsonb, p_caller text)` present · no `anon`/`public` EXECUTE on the four merge functions |
| Idempotency | second `db:migrate:prod` exit 0, migrations still **26** |
| Redeploy | `vercel deploy --prod` from branch HEAD `8f05309` → `dpl_Hf7TTCMMkZt4ZrAQmwr4zgzCPiLR`; `/api/health` `{"ok":true,"db":"up","proxy":"up","commit":"8f053092bde2…"}` (C-WR-01's bounded Clerk lookup is in this build) · signed-out `/sources`, `/review`, `/businesses` → 307 `/sign-in` |
| Deployed e2e | 21 passed / 6 skipped / 0 failed (1.0 m), incl. `touch targets: the off-canvas nav sheet closes from a 44px button` |

All four `closed — pending production` rows are now closed on production. threats_open: 0.

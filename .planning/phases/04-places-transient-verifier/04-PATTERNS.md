# Phase 4: Places Transient Verifier — Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 104 new or modified. Sources: `04-CONTEXT.md` D-01…D-21 and Claude's Discretion; `04-RESEARCH.md` § Recommended Project Structure, Patterns 1–10, § Wave 0 Gaps and § Phase Requirements → Test Map; `04-UI-SPEC.md` §§ 0–6, Components inventory and Executor Rules 28–42.
**Analogs found:** 91 / 104. Thirteen shapes are genuinely new; see § No Analog Found.

Every analog below was opened and read in this session at repo HEAD `99e3bf9` (branch `gsd/phase-04-places-transient-verifier`). Phase 3's choices in `03-PATTERNS.md` still hold wherever they are reused. Where the tree contradicts CONTEXT, RESEARCH or UI-SPEC, the point is flagged 🔴 **CORRECTION** inline and collected in § Blast-radius notes.

---

## File Classification

### Wave 0: infra, config, toolchain

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `package.json` **(MOD)**: `workflow@4.8.9`, `@workflow/vitest@4.0.25` (dev), `test:workflow` script | config | — | itself L10–33 | exact |
| `pnpm-workspace.yaml` **(MOD)**: `allowBuilds` `'@swc/core'`, `cbor-extract` | config | — | itself L1–21 (`msw: false` rationale) | exact |
| `next.config.ts` **(MOD)**: `withWorkflow()` | config | — | — | **none** |
| `src/proxy.ts` **(MOD)**: matcher excludes `\\.well-known/workflow/` | middleware | request-response | itself L24–33 | exact |
| `.gitignore` · `.prettierignore` · `eslint.config.mjs` **(MOD)** | config | — | `eslint.config.mjs` L5–24 | exact |
| `vitest.workflow.config.ts` (NEW) | config (test) | — | `vitest.db.config.ts` + `vitest.config.ts` L45–49 | role-match |
| `.github/workflows/ci.yml` **(MOD)**: `pnpm test:workflow` in the `db` job | config | batch | itself L43–87 | exact |
| `vercel.json` **(MOD)**: first `crons` entry | config | event-driven | — | **none** |
| `.env.example` **(MOD)**: names only | config | — | itself | exact |
| `src/env.ts` **(MOD)**: `PLACES_MODE` (`off\|ids_only\|enterprise`, default `off`), `CRON_SECRET` | config | — | itself L18–61 | exact |

### Schema and migrations

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/db/schema/runs.ts` **(MOD)**: `kind`, `partition_index`, `estimate_*`, `ceiling_requests`, `workflow_run_id`, `requested_by`, `heartbeat_at` | model | CRUD | itself L28–63 | exact |
| `src/db/schema/place-attachments.ts` (NEW) | model | CRUD | `src/db/schema/merge-candidates.ts` + `business-merges.ts` | exact |
| `src/db/schema/place-observations.ts` (NEW, append-only) | model | append-only | `cost_ledger` in `src/db/schema/budget.ts` L160–190 | role-match |
| `src/db/schema/place-coordinates.ts` (NEW, grant-less) | model | TTL / purge | `source-records.ts` (`expires_at`) | partial |
| `src/db/schema/place-tiles.ts` · `place-tile-members.ts` (NEW) | model | CRUD | `merge-candidates.ts` (`unique` + queue index) | role-match |
| `src/db/schema/run-searches.ts` · `run-place-outcomes.ts` (NEW) | model | batch progress | `src/db/schema/ingest-runs.ts` / `runs.ts` | role-match |
| `src/db/schema/place-purge-runs.ts` (NEW) | model | batch | `ingest-runs.ts` | role-match |
| `src/db/schema/index.ts` **(MOD)** | config | — | itself (barrel) | exact |
| `drizzle/00NN_<generated>.sql` (`db:generate`) | migration | — | `drizzle/0022_spine_tables.sql` | exact |
| `drizzle/00NN_places_grants_triggers.sql` (`db:custom`) | migration | — | `drizzle/0023_spine_constraints_grants.sql` L90–177 + `0015` L66–93 + `0013` L88–90 | **exact** |
| `drizzle/00NN_places_functions.sql` (`db:custom`): `app.release_reservation`, `app.record_places_page`, `app.decide_place_attachment`, `app.places_transient_stats`, `app.purge_expired_place_coordinates` | migration (definers) | CRUD | `drizzle/0018` L45–73 · `0019` L36–131 · `0020` L28–103 · `0024` L129–457 · `0025` L36 | **exact** |
| `drizzle/00NN_siteless_cron_role.sql` (`db:custom`), or folded into the above | migration | — | `drizzle/0000_bootstrap.sql` L26–33 | exact |
| `business_place_signal` view (`security_invoker`) | migration (view) | read | — | **none** |

### Places library (pure modules + the one client)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/budget/field-mask-tier.ts` **(MOD)**: `places.pureServiceAreaBusiness` into PRO and the mask; IDs-only mask export | utility | transform | itself L25–82 | exact |
| `src/lib/places/request.ts` (NEW): the one builder | utility | transform | `field-mask-tier.ts` (one-module rule) + `src/lib/geocode/census.ts` L37–49 (fixed query) | role-match |
| `src/lib/places/client.ts` (NEW): the only reader of the key and host | service | request-response | `src/lib/geocode/census.ts` L1, L37–38, L108–187 | **exact** |
| `src/lib/places/meter.ts` (NEW): mints `ReservedCall`; reserve/settle/release per page | service | CRUD (transaction) | `src/server/actions/queue-run.ts` L117–169 | role-match |
| `src/lib/places/response.ts` (NEW): zod | utility | transform | `census.ts` zod schemas (strip-by-default) | exact |
| `src/lib/places/host-class.ts` (NEW) | utility | transform | `src/lib/ui/review-format.ts` (pure, defensive) | role-match |
| `src/lib/places/place-types.ts` (NEW): Table A snapshot | config (data) | — | `src/lib/budget/price-book.ts` header (published table + source URL + fetch date) | role-match |
| `src/lib/places/tiling.ts` (NEW) | utility | transform | `src/lib/estimate/expand-cells.ts` + `assumptions.ts` (committed constants) | role-match |
| `src/lib/places/partition.ts` (NEW) | utility | transform | `src/lib/budget/period.ts` L1–60 (Chicago-anchored bucket via `APP_TZ`) | **exact** |
| `src/lib/places/change-detect.ts` (NEW) | utility | transform | — (pure set diff; `score.ts` house shape) | partial |
| `src/lib/places/match.ts` (NEW): Places result → `Side`; `scoreSab` | service | transform | `src/lib/resolve/score.ts` L39–81, L378–436 | **exact** |
| `src/lib/places/candidates.ts` (NEW): per-page candidate SQL | service | batch (SQL gen) | `src/lib/resolve/block.ts` L118–125, L235–265 | **exact** |
| `src/lib/resolve/score.ts` **(MOD)**: widen `Side['source']`, `Features['rule']` | service | transform | itself L39–80 | exact |
| `src/lib/estimate/assumptions.ts` **(MOD)**: `RUN_CEILING_MULTIPLIER`, tiling constants | config | — | itself L27–37 | exact |
| `src/lib/estimate/estimate.ts` **(MOD)**: type-aware requests (D-18) | service | transform | itself L73–88 | exact |
| `src/lib/estimate/expand-cells.ts` **(MOD, if cells carry types/bbox)** | utility | transform | itself L47–69, L194 | exact |
| `src/seed/data/clusters.json` **(MOD)**: drop `general_contractor` | config (data) | — | itself | exact |
| `src/seed/data/geo-shapes.json` (NEW) + `scripts/fetch-geo-shapes.ts` (NEW, desk) | config (data) + script | file-I/O | `src/seed/data/outlet-counts.json` + `scripts/refresh-outlet-counts.ts` | role-match |

### DB tier context for the workflow and the cron

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/db/with-worker-org.ts` (NEW) | middleware (DB context) | request-response | `src/lib/ingest/etl-actor.ts` L79–130 + `src/db/with-org.ts` L54–64 | **exact** |
| `src/db/with-cron-role.ts` (NEW) | middleware (DB context) | batch | `src/db/with-org.ts` L5–6, L54–64 (allow-listed role) | role-match |

### Workflow executor

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/workflows/places-sweep/workflow.ts` (NEW, `"use workflow"`) | orchestrator | event-driven / durable | — | **none** |
| `src/workflows/places-sweep/steps.ts` (NEW, `"use step"`) | service | request-response + CRUD | `queue-run.ts` (reserve txn) + `with-worker-org.ts` | partial |
| `src/workflows/places-sweep/reducer.ts` (NEW, pure) | utility | transform | `src/lib/resolve/score.ts` house shape | partial |

### Server actions and queries

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/server/actions/queue-run.ts` **(MOD)**: `kind`, mode refusal, ceiling, `start()` after commit | action | CRUD + event start | itself L45–217 | exact |
| `src/server/actions/record-listing-decision.ts` (NEW): Same business / Not this business / Skip | action | CRUD | `src/server/actions/record-review-decision.ts` | **exact** |
| `src/server/actions/detach-listing.ts` (NEW) | action | CRUD | `src/server/actions/unmerge-business.ts` | exact |
| `src/server/queries/run-report.ts` (NEW) | query | request-response | `src/server/queries/sources.ts` + `budget.ts` `readSpendByRun` | exact |
| `src/server/queries/review-queue.ts` **(MOD)**: Google item kind + filter | query | request-response | itself | exact |
| `src/server/queries/sources.ts` **(MOD)**: transient stats | query | request-response | itself L87–149 | exact |
| `src/server/queries/businesses.ts` **(MOD)**: Google check read | query | request-response | itself L457, L695–700 | exact |
| `src/server/queries/budget.ts` **(MOD)**: `RunSpend` gains kind / link | query | request-response | itself L248–363 | exact |

### Route handlers and desk scripts

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/api/cron/purge-places/route.ts` (NEW) | route (handler) | event-driven (cron) | `src/app/api/health/route.ts` | role-match |
| `scripts/purge-places.ts` (NEW, desk) | script | batch | `scripts/resolve.ts` L84–133 (arg and target gate) | role-match |
| `scripts/record-places-fixtures.ts` (NEW, D-20 anonymizing recorder) | script | file-I/O | `scripts/refresh-outlet-counts.ts` + fixtures README "throwaway run" | partial |

### UI: routes and components

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/(app)/runs/[id]/page.tsx` + `loading.tsx` · `error.tsx` · `not-found.tsx` (NEW) | route (RSC) | request-response | `src/app/(app)/businesses/[id]/*` | **exact** |
| `src/components/runs/run-auto-refresh.tsx` (NEW, client) | component (client) | polling | `src/components/preset-editor/use-live-estimate.ts` L71–113 (timer hygiene) | partial |
| `src/components/runs/run-status-badge.tsx` (NEW, extracted) | component | — | `src/components/spend/by-run.tsx` L43–75 | **exact (lift)** |
| `src/components/runs/{run-header,requests-card,tiles-card,outcomes-card,changes-card}.tsx` (NEW) | component | — | `src/components/sources/source-ledger.tsx` + `spend/by-run.tsx` | role-match |
| `src/components/places/google-maps-tag.tsx` (NEW, server-safe) | component | — | `fields-and-sources.tsx` L114–121 `Tag` (text, never a badge) | role-match |
| `src/app/globals.css` **(MOD)**: `--google-attribution` + `.google-maps-attribution` | config (style) | — | itself L35–158 (`--warning` pair) | exact |
| `src/lib/ui/places-format.ts` (NEW) | utility | transform | `src/lib/ui/review-format.ts` | **exact** |
| `src/lib/ui/copy.ts` **(MOD)**: every Phase 4 string, `STOPPED_REASON`; retire `PHASE4_RUN_NOTICE` | config | — | itself L35, L106, L590 | exact |
| `src/lib/ui/run-tone.ts` **(MOD)**: `StoppedReason` union, `RUN_KIND` | config | — | itself L31–72 | exact |
| `src/components/spend/by-run.tsx` **(MOD)** | component | — | itself | exact |
| `src/components/app-shell/app-sidebar.tsx` **(MOD)**: `alsoActiveUnder` | component | — | itself L45–51, L136–138 | exact |
| `src/components/preset-detail/run-drawer.tsx` **(MOD)**: `kind` prop, navigate to `/runs/{id}` | component (client) | request-response | itself L69–103, L152–178 | exact |
| `src/components/preset-detail/{other-runs,recent-runs,places-mode-notice}.tsx` (NEW) | component | — | `version-history.tsx` rows + `summary-card.tsx` | role-match |
| `src/components/preset-detail/summary-card.tsx` **(MOD)**: last-run link | component | — | itself | exact |
| `src/app/(app)/presets/[id]/page.tsx` **(MOD)**: mode prop, three actions, recent runs | route (RSC) | request-response | itself L152–199, L306–322 | exact |
| `src/app/(app)/presets/page.tsx` **(MOD)**: drop `PHASE4_RUN_NOTICE` import | route | — | itself | exact |
| `src/app/(app)/review/page.tsx` **(MOD)**: filter, kind dispatch | route (RSC) | request-response | itself L44–135 | exact |
| `src/components/review/candidate-pair.tsx` **(MOD)**: extract `SpineRecordCard` | component | — | itself L55–113 | exact |
| `src/components/review/google-listing-card.tsx` (NEW) | component | — | `candidate-pair.tsx` `Side` + `signal-chips.tsx` | exact |
| `src/components/review/reject-dialog.tsx` (NEW, client) | component (client) | request-response | `src/components/business-detail/unmerge-dialog.tsx` | **exact** |
| `src/components/review/review-actions.tsx` · `review-empty.tsx` · `signal-chips.tsx` **(MOD)** | component | — | themselves | exact |
| `src/components/business-detail/google-check.tsx` (NEW) | component | — | `fields-and-sources.tsx` L93–121 + `merge-history.tsx` | exact |
| `src/components/business-detail/detach-dialog.tsx` (NEW, client) | component (client) | request-response | `unmerge-dialog.tsx` | **exact** |
| `src/app/(app)/businesses/[id]/page.tsx` **(MOD)** | route | — | itself L66–143 | exact |
| `src/components/sources/transient-card.tsx` (NEW) | component | — | `source-ledger.tsx` count cells + `copy-command-button.tsx` | role-match |
| `src/app/(app)/sources/page.tsx` **(MOD)** | route | — | itself L50–112 | exact |
| `src/components/budget/second-wall-card.tsx` **(MOD)** | component | — | itself; `FLAG_BADGE_SIZING` (`flags/flag-badge.tsx` L17) | exact |

### Tests, fixtures and docs

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `tests/unit/msw/server.ts` **(MOD)**: Places RegExp handler, 501 discipline | test harness | request-response | itself L275–323 (POST + 501) and L57–85 (envelope, one-shot) | **exact** |
| `tests/unit/msw/fixtures/places-*.json` + `places-recordings.json` (synthetic sidecar) + `README.md` **(MOD)** | fixture | — | `socrata-*.json` + `socrata-recordings.json` + README | exact |
| `tests/unit/_walk.ts` (NEW): shared walker with `.well-known/workflow` exclusion | test util | — | the three `walk()` copies (`field-mask-tier.test.ts` L62–67 etc.) | exact |
| `tests/unit/field-mask-tier.test.ts` **(MOD)** | test | — | itself L41–55, L119–139 | exact |
| `tests/unit/no-google-credential.test.ts` **(MOD, never delete)** | test | — | itself L28–88 | exact |
| `tests/unit/no-network.test.ts` **(MOD)** | test | — | itself L29–46 | exact |
| `tests/unit/{places-request,host-class,tiling,partition,change-detect,places-match,place-types,places-env,purge-route,step-returns}.test.ts` (NEW) | test (unit) | — | `tests/unit/census.test.ts`, `score.test.ts`, `field-mask-tier.test.ts`, `time.test.ts` | exact |
| `tests/unit/google-maps-attribution.test.tsx` · `no-map.test.ts` · `run-auto-refresh.test.tsx` · `preset-actions.test.tsx` · `reject-dialog.test.tsx` (NEW) | test (dom/unit) | — | `unmerge-dialog.test.tsx`, `sources-ledger.test.tsx`, `ui-maps.test.ts` | role-match |
| `tests/unit/estimate.test.ts` · `ui-maps.test.ts` · `no-internal-leak.test.ts` · `seed-data.test.ts` **(MOD)** | test | — | themselves | exact |
| `tests/db/_places-fixtures.ts` (NEW) | test fixture | — | `tests/db/_merge-fixtures.ts` | exact |
| `tests/db/places-*.test.ts` (NEW: meter, writer, coordinates, purge, append-only, attachments, tenancy) | test (db) | — | `budget-meter.test.ts`, `events-append-only.test.ts`, `review-actions.test.ts` | exact |
| `tests/db/grants-audit.test.ts` · `event-trigger.test.ts` **(MOD)** | test (db) | — | themselves L34–71 / L60–103 | exact |
| `tests/workflow/places-sweep.test.ts` (NEW) | test (workflow lane) | — | — | **none** |
| `tests/e2e/sources.spec.ts` · `spend.spec.ts` · `preset-detail.spec.ts` · `theme-tokens.spec.ts` **(MOD)**; `tests/e2e/runs.spec.ts` (NEW, local-only) | test (e2e) | — | `preset-detail.spec.ts` (incl. its `TARGET_IS_LOCAL` trap) | role-match |
| `docs/runbooks/google-quota.md` **(MOD)** · `docs/runbooks/places.md` (NEW) · `docs/measurements/04-gate-mutations.md` (NEW) | doc | — | `docs/runbooks/ingest.md`, `docs/measurements/03-gate-mutations.md` | exact |

---

## Pattern Assignments

### `src/env.ts` (MOD): `PLACES_MODE`, `CRON_SECRET`

**Analog:** itself. Server-only zod schema, parsed once, throws naming the variable.

**The optional-secret shape to copy** (L21–28 and L46–52). `||` rather than `??`, because GitHub Actions hands an absent secret over as `''`:

```typescript
  SOCRATA_APP_TOKEN: z.string().min(1).optional(),
});
...
const parsed = serverSchema.safeParse({
  ...process.env,
  SUPABASE_DB_POOL_URL: process.env.SUPABASE_DB_POOL_URL || process.env.RUNTIME_DB_URL,
  SOCRATA_APP_TOKEN: process.env.SOCRATA_APP_TOKEN || undefined,
});
```

Map `PLACES_MODE` to `z.enum(['off','ids_only','enterprise']).default('off')` and pass `PLACES_MODE: process.env.PLACES_MODE || undefined`, so `''` becomes the default rather than a refusal. An unknown value then fails at L54–61, which is the D-02 "fail loudly".

🔴 **CORRECTION / blast radius.** `tests/unit/no-google-credential.test.ts` L76–88 asserts `src/env.ts` does not contain `'PLACES'`. D-02 puts `PLACES_MODE` here, so that assertion must be amended to allow exactly `PLACES_MODE`, in the same commit and watched red first. The **key** must not be declared here. Follow the `SOCRATA_APP_TOKEN` precedent (L22–27): `src/lib/places/client.ts` reads it from `process.env` directly, which keeps D-03's "the adapter module becomes the one sanctioned reader" literally true. A key name matching `GOOGLE_[A-Z_]*KEY` trips the walk at L34, so the amended test must allow-list exactly `src/lib/places/client.ts`.

---

### `src/lib/budget/field-mask-tier.ts` (MOD, D-13)

**Analog:** itself. Add `'places.pureServiceAreaBusiness'` to `PRO` (L28–34) and to `PLACES_TEXT_SEARCH_FIELD_MASK` (L70–82). Add an exported IDs-only mask `['places.id', 'nextPageToken']` built from `ESSENTIALS` members only.

The "refuses; never defaults" guard at L98–121 is unchanged. `tests/unit/field-mask-tier.test.ts` L41–55 (`FIELD_TIERS`) gains the row `['places.pureServiceAreaBusiness', 'ts_pro', 'ts_essentials']`. The set-equality assertion at L73 goes red until it does. That is M27's target.

🔴 **The header-name grep moves.** L57–59 and L119–139 allow `X-Goog-FieldMask` in `src/lib/budget/field-mask-tier.ts` only, but the header is *sent* from `client.ts` (or built in `request.ts`). Pick one module to spell it, and move `HEADER_MAY_BE_NAMED_IN` to that module in the same commit. Recommendation: `client.ts` spells every header; `request.ts` returns `{ body, mask }` only. `field-mask-tier.ts` then no longer needs to name the header at all.

---

### `src/lib/places/client.ts` (NEW): the one sanctioned reader

**Analog:** `src/lib/geocode/census.ts`, in full.

- **Module guard (L1):** `import 'server-only';`
- **Hard-coded host and path, never caller-supplied (L37–38):**

```typescript
const CENSUS_HOST = 'https://geocoding.geo.census.gov';
const CENSUS_PATH = '/geocoder/geographies/onelineaddress';
```

  This becomes `https://places.googleapis.com` and `/v1/places:searchText`. Only the `:searchText` path exists; no Place Details path is ever spelled (criterion 1).

- **Never throws; every outcome is a named reason (L108, L143–165):**

```typescript
export type GeocodeFailureReason = 'no_match' | 'not_texas' | 'unreachable' | 'bad_shape';
...
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!response.ok) return { ok: false, reason: 'unreachable' };
  ...
  const parsed = censusResponseSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'bad_shape' };
```

  The Places outcome union is: `ok` · `daily_quota` (429 plus quota detail) · `rate_limited` (per-minute 429) · `rejected` (400) · `unavailable` (5xx or timeout) · `bad_shape`. The workflow maps `daily_quota` to `FatalError` (M52), and D-19 maps it to `partial` / `google_daily_quota`.

🔴 **No response text ever reaches an error message or a log** (RESEARCH Pitfall 1d). `census.ts` already returns reasons, not bodies. Keep it that way. `socrata/client.ts`'s "echo 400 chars of the body" pattern (03-PATTERNS L403–414) is **wrong here**, because the body is Places content and a thrown message lands in the workflow's `step_failed` event.

**Signature contract (RESEARCH Pattern 3):** `searchText(call: ReservedCall, req: PlacesRequest)`. `ReservedCall` carries a `unique symbol` brand constructible only in `src/lib/places/meter.ts`.

---

### `src/lib/places/request.ts` (NEW): the one builder

**Analog:** the one-module rule in `field-mask-tier.ts` L1–10, plus the fixed-query pattern in `census.ts` (`CENSUS_FIXED_QUERY`, 03-PATTERNS L488–495): caller input is a value only, and the invariant parameters are constants.

The body shape comes from RESEARCH Pattern 4. `includePureServiceAreaBusinesses: true`, `strictTypeFiltering: true`, `pageSize: 20`, `regionCode: 'US'` and `languageCode: 'en'` are module constants, never parameters, so no call site can omit them (M26, M49). Page 2 and 3 must be `{ ...firstPageBody, pageToken }` built from the page-1 object, never rebuilt (the "a page request repeats the first request's body" test).

---

### `src/lib/places/meter.ts` (NEW): reserve → call → settle / release

**Analog:** `src/server/actions/queue-run.ts` L117–169. This is the repo's only live call of `app.reserve_budget` from TypeScript.

**The 1 µUSD hold rule** (L117–127):

```typescript
      const holdMicroUsd = estimateHi > 0 ? BigInt(estimateHi) : 1n;
```

**The meter call, bound values, bigint as text** (L139–151):

```typescript
      const meter = rowsOf<{ reservation_id: string | null; pct_after: string | null; at_80: boolean; at_100: boolean }>(
        await tx.execute(sql`
          select reservation_id, pct_after::text as pct_after, at_80, at_100
            from app.reserve_budget('places', ${period}::date, ${holdMicroUsd.toString()}::bigint,
                                    ${run.id}::uuid, ${ESTIMATE_SKU})`),
      )[0];
      if (!meter) throw new Error('queueRun: app.reserve_budget returned no row');
```

**A denial is zero rows, not an exception** (L155–169): `if (meter.reservation_id === null)`. Per page, this becomes `stop: 'budget_cap_reached'`, and the ceiling UPDATE sits in the same transaction (RESEARCH Pattern 2).

**Settle** calls `app.settle_reservation(p_reservation, p_request_id, p_actual_micro, p_units, p_sku, p_provider)`, whose signature is `drizzle/0019` L36–38. 🔴 It **refuses `p_units <= 0` (L51–53)** and a sku or provider that disagree with the reservation (L76–83, `22023`). The per-attempt `request_id` idempotency is `on conflict (request_id) do nothing` (L98–107). Use per-attempt ids, never per-page (RESEARCH Pattern 6.3).

**Pricing** is `priceRequests(sku, 1, freeRemaining(sku, unitsUsed))` from `src/lib/budget/price-book.ts` L110–133 and L141–151. `unitsUsed` is read by `readUnitsUsedThisPeriod` (`src/server/queries/budget.ts` L173).

---

### `src/lib/places/match.ts` (NEW) and `src/lib/resolve/score.ts` (MOD)

**Analog:** `src/lib/resolve/score.ts`. Reuse `score()` unchanged. The additions are type widenings plus a separate pure `scoreSab`.

**Types to widen** (L39–81):

```typescript
export type Side = {
  id: string;
  source: 'tx_comptroller' | 'overture';        // ← add 'google_places'
  nameNorm: string | null;
  phoneE164: string | null;
  phoneBlockable: boolean;
  ...
  locationMatchType: LocationMatchType | null;
  clusterKey: string | null;
  chainKey: string | null;                        // ← pass null on BOTH sides for Places pairs (RESEARCH A4)
};
export type Features = { ...; rule?: 'phone_locality_name' | 'phone_locality_review' | 'over_25km' };  // ← add 'sab_phone_city'
```

**Constants to import, never restate:** `AUTO_MERGE_SCORE` (95, L85), `REVIEW_SCORE` (80, L86), `REVIEW_CEILING` (94, L90), and `PHONE_LOCALITY_NAME_SIM` (0.6, L137), which is the SAB name bar.

**House rules from the header (L1–35):** the module stays PURE, with no server import and no DB in its import graph. `nameSim` arrives from the database (`similarity()`), never from a TS trigram. `features` carries integers, `nameSim` and `distanceM` only, and never a name (T-3-11). That last rule is exactly M36's target for Places text.

Normalize Places fields in memory through `phoneE164`, `addressKey` and `nameNorm` from `src/lib/normalize/` (03-PATTERNS: they must agree byte-for-byte with the spine keys).

---

### `src/lib/places/candidates.ts` (NEW): one statement per page

**Analog:** `src/lib/resolve/block.ts`.

**The mandatory setup statement** (L118–125). A SET takes no bound parameter, so the number is validated:

```typescript
export function similarityThresholdSql(threshold: number = BLOCK_SIMILARITY_THRESHOLD): string {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`similarityThresholdSql: not a similarity threshold: ${threshold}`);
  }
  return `set local pg_trgm.similarity_threshold = ${threshold}`;
}
```

**The lateral trigram arm that drives the GIN index** (L235–265). The `%` operator goes inside the lateral WHERE, ordered by `<->` with `limit 5`, and `merged_into_id is null` plus the org predicate go on every arm:

```sql
    cross join lateral (
      select o.id
        from businesses o
       where o.org_id = c.org_id
         and o.postal = c.postal
         and o.merged_into_id is null
         and o.name_norm % c.name_norm
       order by o.name_norm <-> c.name_norm
       limit 5
    ) k
```

**Return shape:** `BlockStatement { shape, setup, text, values }` (L95–103). Copy it so the step can run `setup` then `text` in one transaction.

🔴 **The ≤20 probes are ONE jsonb parameter** (`jsonb_to_recordset($1::jsonb)`), never a JS array. See `src/db/drizzle-executor.ts` L15–34 (N placeholders → `42846` / `22P02`). 🔴 `tests/unit/sql-never-normalizes.test.ts` forbids the SQL accent-fold function anywhere under `src/`. A `lower(city) = lower($city)` SAB comparison is fine. An accent-folded city comparison is not; normalize the city in TS.

---

### `src/lib/places/partition.ts` (NEW)

**Analog:** `src/lib/budget/period.ts`. It is the Chicago-anchored bucket function, and its exports are at L54, L60, L66 and L81.

Copy the header discipline verbatim (L1–12). Import `APP_TZ` and `APP_LOCALE` from `src/lib/time.ts` and never spell a zone: the repo greps `src/` for any other file naming it. Never use the zoneless `Date` accessors. The `timeZone` defaulted parameter (`periodStart(instant, timeZone = APP_TZ)`) is what makes the "one instant in two zones, opposite verdicts" test expressible. `weeksSinceEpoch(now, timeZone = APP_TZ)` must take the same shape. The cell key separator `'\u0000'` is `SEP` in `src/lib/estimate/expand-cells.ts` L69. Import or re-export it rather than retyping it.

---

### `src/lib/places/tiling.ts` · `reducer.ts` · `change-detect.ts` · `host-class.ts` (NEW, pure)

**Analog for committed constants:** `src/lib/estimate/assumptions.ts` L1–37. Every unmeasured number is named, documented and tested with exact values. `MAX_DEPTH`, `MIN_TILE_SIDE_M`, `NOVELTY_MAX_OVERLAP` and `RUN_CEILING_MULTIPLIER` go in `assumptions.ts` beside `FAN_OUT` (D-15, per CONTEXT), or in `tiling.ts` with the same header style. The planner picks one; CONTEXT names `assumptions.ts` for the multiplier.

**Analog for pure, defensive transforms:** `src/lib/ui/review-format.ts` L5–24. No client directive, no `server-only`, no I/O; plain objects in, plain objects out; unit-tested with JSON. The host-class classifier body is RESEARCH § Code Examples (`hostClass`). Keep the suffix-on-dot-boundary rule.

---

### `src/lib/places/place-types.ts` (NEW) + `src/seed/data/clusters.json` (MOD)

**Analog:** `src/lib/budget/price-book.ts` L1–18, a published external table committed as data, with the source URL and fetch date in the header. The test reads this snapshot, never the network. `no-network.test.ts` would red a live host under `src/`, and `developers.google.com` belongs in a comment only.

`clusters.json` carries `placesTypesNote` on every cluster (L19, L27, L46, L65). Update that note in the same commit that drops `general_contractor`, with the test watched red first (M48).

---

### `src/db/with-worker-org.ts` (NEW): the workflow tier's org context

**Analog:** `src/lib/ingest/etl-actor.ts` L79–130 (`resolveEtlOrg` + `setEtlActor`), combined with `src/db/with-org.ts` L54–64.

**The claim-only-`{o:{id}}` installer** (etl-actor L121–128):

```typescript
  await tx.query(
    `select set_config(
       'request.jwt.claims',
       json_build_object('o', json_build_object('id', $1::text))::text,
       true
     )`,
    [clerkOrgId],
  );
```

**The three deliberate omissions** (L88–101) carry over verbatim, with one difference:
- **no `sub`**, so the actor falls to the `app.actor_id` GUC (`workflow:<runId>`);
- **no `o.rol`**, so no admin-gated definer is reachable;
- **the difference:** unlike the ETL, the worker **does** `set local role authenticated`, because it runs on the runtime `app_user` pool (`src/db/client.ts` L25), not the owner.

**The transaction wrapper** (with-org L54–64). A bound parameter; the `true` makes it transaction-LOCAL; the role is allow-listed before `sql.raw`:

```typescript
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
    await tx.execute(sql.raw('set local role ' + claims.role)); // safe: allow-listed above
    return fn(tx);
  });
```

🔴 Per transaction, never once per step (etl-actor L25–30: both GUCs die at COMMIT). The first statement in every step re-reads the run under RLS; zero rows → `FatalError` (M46).

### `src/db/with-cron-role.ts` (NEW)

**Analog:** `with-org.ts` L5–6 (`const ROLES = new Set([...])`, "never interpolate a role that came from input") and `tests/db/_fixtures.ts` L80–88 (`actAsRole`, the explicit allow-list because `set role` takes no bound parameter). Allow exactly `'siteless_cron'`. No claims are set.

---

### `drizzle/00NN_places_grants_triggers.sql` (`db:custom`)

**Analog:** `drizzle/0023_spine_constraints_grants.sql` L90–177. It is the canonical "half drizzle-kit cannot emit".

**Grants plus the belt-and-braces revoke** (L104–117):

```sql
grant select on ingest_runs, merge_candidates, business_merges, business_aliases to authenticated;
--> statement-breakpoint
revoke insert, update, delete on ingest_runs, merge_candidates, business_merges, business_aliases from authenticated;
```

That becomes `place_attachments`, `place_observations`, `place_tiles`, `place_tile_members`, `run_searches`, `run_place_outcomes` and `place_purge_runs`: SELECT-only, and every write goes through a definer.

🔴 **`place_coordinates` gets no grant at all, plus an explicit `revoke all … from authenticated, anon`.** M37 is "grant select on place_coordinates to authenticated", which reds "authenticated cannot read place coordinates". The expected error text is `permission denied for table place_coordinates`. The wording is asserted, as in `events-append-only.test.ts` L36–41.

**`runs` column grant** (`drizzle/0013` L88–90). `heartbeat_at` is added to it, and `ceiling_requests` is deliberately excluded:

```sql
grant update (status, stopped_reason, cost_micro_usd, calls_count, started_at, finished_at) on runs to authenticated;
```

**The narrowed `log_event` on `place_attachments`** follows `drizzle/0015` L66–93: two triggers, because a combined insert/update/delete trigger cannot reference OLD and NEW in `WHEN`:

```sql
create trigger budget_periods_event_ins_del after insert or delete on budget_periods
  for each row execute function app.log_event();
--> statement-breakpoint
create trigger budget_periods_event_upd after update on budget_periods
  for each row when (old.cap_micro_usd is distinct from new.cap_micro_usd)
  execute function app.log_event();
```

⚠️ With this shape the INSERT arm fires once per new attachment. RESEARCH wants it "narrowed to status changes" because of per-run upsert volume. The planner decides whether INSERT is audited, or whether only the update-of-status arm exists and the insert event goes through `app.emit_event` at run level. Either way, `EVENT_LOGGED` / `LOG_EVENT_TRIGGER_ROWS` in `tests/db/event-trigger.test.ts` L67 / L103 move with it; set equality is asserted in both directions.

**The touch-trigger loop and the "deliberately no log_event" comments** (0023 L127–161). Copy the `do $$ … foreach t in array array[...]` shape and write one `comment on table` per excluded table. Tables without an `updated_at` pair (append-only observations, coordinates) get no touch trigger, per `0015` L55–57 on `cost_ledger`.

**Observations append-only, belt and braces.** The grant refusal alone is the Phase 1 standard (`events-append-only.test.ts` L29–55). The RESEARCH-recommended BEFORE UPDATE OR DELETE raising trigger has **no analog in the tree**: no table carries a raising trigger today. Write it as a plain `plpgsql` function and give it its own named test and mutation.

**`siteless_cron` role** — `drizzle/0000_bootstrap.sql` L26–33. Conditional creation, because the role already exists on Supabase:

```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login noinherit;
  end if;
end $$;
--> statement-breakpoint
grant authenticated to app_user;
```

That becomes `create role siteless_cron nologin`, followed by `grant siteless_cron to app_user`.

---

### `drizzle/00NN_places_functions.sql` (`db:custom`): the definers

**`app.release_reservation(p_reservation uuid) returns bigint`**

- **Primary analog:** `drizzle/0018` L45–70, `app.release_expired_reservations`. It sets `released_at`, decrements `reserved_micro_usd` by the est, and writes **no ledger row**:

```sql
  with expired as (
    select r.id, r.est_micro_usd from cost_reservations r
      join budget_periods b on b.id = r.budget_period_id
     where b.org_id = v_org and ... and r.settled_at is null and r.released_at is null and r.expires_at < now()
     for update of r skip locked
  ), rel as (
    update cost_reservations r set released_at = now()
      from expired e where r.id = e.id returning e.est_micro_usd
  ) select coalesce(sum(est_micro_usd), 0) into v_freed from rel;
```

- **Tenancy re-check to copy:** `drizzle/0019` L60–72. Load the row as the owner, then compare the org explicitly. "Belongs to another org" raises `42501`:

```sql
  select r.org_id, ... into v_res_org, ... from cost_reservations r join budget_periods b on b.id = r.budget_period_id
   where r.id = p_reservation;
  if v_res_org is null then
    raise exception 'settle_reservation: no such reservation' using errcode = '22023';
  end if;
  if v_res_org is distinct from v_org then
    raise exception 'settle_reservation: reservation belongs to another org' using errcode = '42501';
  end if;
```

- **Idempotent:** the second call frees 0, using the `v_hold := case when settled_at is null and released_at is null then est else 0` idea from 0019 L89.

**`app.record_places_page(...)`, the single writer of membership, outcomes, attachments, observations and coordinates**

- **Analog:** `drizzle/0024` `app.record_merge` L151–199, as re-issued in `0025` L33–36.
- **Header rule (0024 L9–15):** a SECURITY DEFINER bypasses RLS. Every caller-supplied uuid is re-read with `org_id = v_org`, and every `select … into` is followed by an explicit not-found guard, because a plpgsql `select into` that matches nothing does not raise.
- **Org and actor are resolved, never passed** (0024 L168–174):

```sql
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'record_merge: no current org' using errcode = '42501';
  end if;
  v_actor := coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system');
```

- **Run-ownership check:** the `reserve_budget` form, `drizzle/0020` L46–50 (the same message for "foreign" and "missing", so it is not an existence oracle):

```sql
  if p_run is not null
     and not exists (select 1 from runs where id = p_run and org_id = v_org) then
    raise exception 'reserve_budget: run belongs to another org or does not exist' using errcode = '42501';
  end if;
```

- **The sticky reject (M40):** the attachment upsert's `do update … where place_attachments.status <> 'rejected'`, following the pending-only UPDATE plus `if not found` in 0024 L426–437.

**`app.decide_place_attachment(p_attachment uuid, p_decision text)`** (confirm / reject / detach)

**Analog:** `drizzle/0024` L403–438, `app.record_candidate_decision`. The decision enum is checked (`22023`), the row is re-read under the org (`42501`), the UPDATE is pending-only, and `not found` raises `55000` "already decided". The action layer maps `55000` → `conflict` (see `record-review-decision.ts` L52–65).

**`app.purge_expired_place_coordinates()` (cross-org; for `siteless_cron` only)**

There is no cross-org definer analog; every existing definer resolves one org. The revoke pattern is `drizzle/0024` L129–139. `from public` alone does nothing, because `0000_bootstrap.sql` L54 sets `alter default privileges … grant execute on functions to authenticated, anon, service_role`:

```sql
revoke execute on function app.survivorship_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;
```

Then `grant execute on function app.purge_expired_place_coordinates() to siteless_cron;`. M39 re-grants it to `authenticated` and must red "the purge refuses a tenant session".

**Every definer:** `language plpgsql security definer set search_path = public, pg_temp`. That is the 0025 form (0025 L36), which replaced 0024's `= public`; CONVENTIONS "since 0025". `--> statement-breakpoint` goes between every statement, and each function body is one statement. Close each definer with a `comment on function … is '…'`, as in 0019 L134–135 and 0020 L106–107.

---

### `src/db/schema/place-attachments.ts` and the other new tables (model)

**Analog:** `src/db/schema/business-merges.ts` (read in full) for a definer-written, SELECT-only tenant table:

```typescript
export const businessMerges = pgTable(
  'business_merges',
  {
    ...orgScoped,
    winnerId: uuid('winner_id').notNull().references(() => businesses.id),
    ...
    reason: text('reason').notNull(),
    score: integer('score'),
    features: jsonb('features'),
    mergedBy: text('merged_by').notNull(),
    mergedAt: tstz('merged_at').notNull().defaultNow(),
    ...
  },
  (t) => [
    index('business_merges_org_idx').on(t.orgId),
    index('business_merges_winner_idx').on(t.orgId, t.winnerId),
    check('bm_not_self', sql`winner_id <> loser_id`),
    check('bm_reason_known', sql`reason in ('auto','review')`),
    ...orgPolicies('business_merges'),
  ],
);
```

`merge-candidates.ts` L54–59 supplies the queue index and unique shape: `index(...).on(t.orgId, t.decision, t.score.desc())`, `unique(...).on(t.orgId, t.leftId, t.rightId)`, and a `check(... in (...))` whose values are the UI's union.

**Append-only observations:** follow `cost_ledger` in `src/db/schema/budget.ts` L160–190: `unique('cost_ledger_request_id_key')`, `check('cl_units_positive', …)`, and no touch trigger. The SKU CHECK names the text-search SKUs from `TEXT_SEARCH_TIERS` (`price-book.ts` L25–30).

**`runs.ts` (MOD).** Keep the doc-block discipline at L6–27 and extend `runs_status_known`'s neighbour with a `runs_kind_known` CHECK (`full_sweep|partition|change_check`). Bigint columns use `.default(sql\`0\`)`, never `0n` (L44–47: drizzle-kit cannot serialize a BigInt default). Timestamps use `tstz()` only.

**Every table:** `...orgScoped`, `index('<t>_org_idx')`, `...orgPolicies('<t>')` (which auto-enables RLS; never call `.enableRLS()`), an explicit grant in the creating migration, and a `TENANT_TABLES` row. These are the four obligations in 03-PATTERNS § Shared Patterns → Tenancy.

---

### `src/server/actions/queue-run.ts` (MOD)

**Analog:** itself. What stays:

- **The first statement is `requireOrg()`** (L58–61). Its comment says why this action is the one where a missed check costs money.
- **The `z.strictObject` input** (L45–47) gains `kind: z.enum(['full_sweep','partition','change_check'])`.
- **Recompute the estimate from the version snapshot, never `estimate_snapshot`** (L87–115).
- **The run row goes in before the reservation** (L129–137), with the ceiling added: `ceiling_requests = ceil(RUN_CEILING_MULTIPLIER × requestsHi)`, stored at insert.
- **The refused → `runs.status = 'refused'` branch** (L155–169).

What changes:

1. **Mode refusal before any reservation (D-02, M28).** Read `env.PLACES_MODE` before step 1. `off` → `fail(...)` with the mode-refused copy. `ids_only` plus a non-`change_check` kind → the same refusal.
2. **`start()` after the transaction commits.** Import `start` from `workflow/api` and the workflow function, then open a second `withOrg` that stores `workflow_run_id`. RESEARCH Pattern 1: never put `"use server"` in a module the workflow imports. The dependency direction is `queue-run.ts` → workflow, never the reverse.
3. **Retire `PHASE4_RUN_NOTICE`** (import at L11, payload at L213–216). Return `runId`; the drawer navigates.

🔴 **Blast radius of retiring `PHASE4_RUN_NOTICE`.** It is referenced in `src/lib/ui/copy.ts` L106, `src/components/preset-detail/run-drawer.tsx` L31 and L320–321, `src/app/(app)/presets/page.tsx`, `tests/unit/ui-maps.test.ts` L26 and `tests/e2e/preset-detail.spec.ts` L341. UI-SPEC Rule 38 names only the spec and the drawer. `ui-maps.test.ts` and `presets/page.tsx` will not compile until they are updated in the same task.

**Error handling:** the `try { outcome = await runInTransaction() } catch { return fail('unexpected', …) }` shape at L182–187. A `start()` failure after commit leaves a `queued` run with a live hold, which the self-heal releases in 10 minutes. The drawer's "Start failed" copy covers it.

---

### `src/server/actions/record-listing-decision.ts` (NEW) and `detach-listing.ts` (NEW)

**Analog:** `src/server/actions/record-review-decision.ts`, in full.

**Skeleton** (L72–102). `requireOrg()` first, **then `orgClaims()`**, never a hand-built claims object (L31–32; `queue-run.ts` L61 builds one by hand and is the known exception):

```typescript
export async function recordReviewDecision(input: unknown): Promise<ActionResult<{ remaining: number; merged: MergedNames | null }>> {
  await requireOrg();
  const claims = await orgClaims();
  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) { ... return fail('validation', badId ? NOT_FOUND('pair') : REVIEW_DECISION_FAILED); }
  ...
      const outcome = await withOrg(claims, (tx) => decideCandidate(tx, parsed.data));
      if (outcome.kind === 'missing') return fail('not_found', NOT_FOUND('pair'));
      revalidatePath('/review');
      revalidatePath('/businesses');
      return ok({ remaining: outcome.remaining, merged: outcome.merged });
```

**SQLSTATE → result mapping** (L52–65). `pgFailure()` walks `.cause` (`_pg.ts`):

```typescript
function decisionFailure<T>(error: unknown): ActionResult<T> {
  const failure = pgFailure(error);
  if (failure?.code === '42501') return fail('not_found', NOT_FOUND('pair'));
  if (failure?.code === '55000') { ... fail('conflict', REVIEW_ALREADY_DECIDED, { reason: 'already_decided' }); }
  ...
  return fail('unexpected', REVIEW_DECISION_FAILED);
}
```

The input is `z.strictObject({ attachmentId: z.uuid(), decision: z.enum(['attached','rejected','skip']) })`. `detach-listing.ts` follows `unmerge-business.ts` the same way. `tests/unit/server-actions-guard.test.ts` walks `src/server/actions/` and holds both new files to "`requireOrg()` first".

---

### `src/server/queries/run-report.ts` (NEW) and `sources.ts` (MOD)

**Analog:** `src/server/queries/sources.ts`.

**Module shape** (L1–5, L87, L147–149): `import 'server-only'`, a `tx`-taking `read*` function, and a `withOrg`-opening `list*` wrapper, with one transaction per request.

**Static structure via `values` + `left join lateral`** (L89–128). This is the pattern for the run report's SKU rows (a 0-request SKU still renders) and for the transient card's five figures before any call:

```sql
        from (values ('tx_comptroller', 1),
                     ('tx_comptroller_closures', 2),
                     ('overture', 3),
                     ('census_geocoder', 4)) as s(source_key, ord)
        left join lateral (
          select ...,
                 (extract(epoch from r.started_at)  * 1000)::bigint::text as started_ms,
            from ingest_runs r
           where r.org_id = (select app.current_org_id())
             and r.source_key = s.source_key
           order by r.started_at desc nulls last, r.id desc
           limit 1
        ) lr on true
       order by s.ord
```

**Instants as epoch-ms text, then `instantOf()`** (L20–23, L110–111, L134–135). Never parse the `timestamptz` string and never ISO-ify it.

The transient figures come from the definer `app.places_transient_stats()`, because `authenticated` cannot read `place_coordinates`. Call it from `readSources` inside the same `withOrg`.

🔴 **ONE `withOrg` per page** (review page L25–28; `presets/[id]/page.tsx` L60–66). `src/db/client.ts` pools with `max: 1`, so a nested transaction HANGS. The run report reads the run, its searches, outcomes, ledger rows and preset name in one transaction.

---

### `src/app/api/cron/purge-places/route.ts` (NEW)

**Analog:** `src/app/api/health/route.ts`, the only route handler in the tree.

```typescript
export const dynamic = 'force-dynamic';
...
export async function GET() {
  ...
  } catch (e) {
    console.error('health: database probe failed', e instanceof Error ? e.name : 'unknown');
  }
  ...
  return NextResponse.json({ ok, db: dbState, ... }, { status: ok ? 200 : 503 });
}
```

Copy three things: the fixed-enum response body, logging by error **name** only, and `force-dynamic`. The header (L8–21) calls its `select 1` "the ONE database call outside withOrg() … NOT a precedent". The cron route is the second exception; it goes through `withCronRole`, and the header must say so.

**The `CRON_SECRET` Bearer check has no analog.** Follow RESEARCH Pattern 10: compare equal-length buffers with `crypto.timingSafeEqual`, and refuse when the secret is unset (M50). `src/proxy.ts` runs `clerkMiddleware()` on `/(api|trpc)(.*)`. That is session context only, and it does not block an unauthenticated GET. Verify that during the task.

---

### `src/app/(app)/runs/[id]/page.tsx` (NEW) and its siblings

**Analog:** `src/app/(app)/businesses/[id]/page.tsx` plus `loading.tsx`, `error.tsx` and `not-found.tsx` in the same directory.

**The uuid guard, then one read, then `notFound()` for both unknown and foreign** (L66–76):

```tsx
export default async function BusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const claims = await orgClaims();
  const detail = await getBusinessDetail(claims, id);
  if (!detail) notFound();
```

`tests/unit/ids.test.ts` discovers every `[id]/page.tsx` by walking the tree (L21–28), so `/runs/[id]` is red until it calls `isUuid`.

**Desk-only breadcrumb** (L104–121). `export const dynamic = 'force-dynamic'` (L24).

### `src/components/runs/run-auto-refresh.tsx` (NEW, client island)

**Partial analog:** `src/components/preset-editor/use-live-estimate.ts` L71–113, the repo's one timer: `useEffect` plus `setTimeout` plus a `clearTimeout` cleanup, with no dependency added (L29). It holds no data of its own; it calls `router.refresh()` (see `run-drawer.tsx` L164). The visibility pause and the terminal stop are new (UI-SPEC Rule 36; fake-timer test).

### `src/components/runs/run-status-badge.tsx` (NEW, extracted)

**Analog:** `src/components/spend/by-run.tsx` L43–75. Lift `TONE_CLASS`, `TONE_VARIANT` and `RunStatusBadge` whole:

```tsx
const TONE_CLASS: Record<BadgeTone, string> = {
  'neutral-outline': '',
  'accent-outline': 'border-primary text-primary',
  'neutral-solid': '',
  warning: 'border-warning/40 bg-warning-surface text-warning-surface-foreground',
  destructive: '',
};
...
function RunStatusBadge({ status }: { status: string }) {
  const known = status as RunStatus;
  const tone = RUN_TONE[known];
  const label = RUN_LABEL[known] ?? status;
  ...
    <Badge variant={variant} className={cn(tone ? TONE_CLASS[tone] : '', 'text-xs font-semibold')}>
```

Replace `'text-xs font-semibold'` with `FLAG_BADGE_SIZING` (`src/components/flags/flag-badge.tsx` L17: `'h-auto px-2 py-1 text-sm font-semibold tabular-nums'`), per Rule 41.

🔴 **The stored-key leak to fix** (by-run L104–106, Rule 35). This function prints `runs.stopped_reason` verbatim:

```tsx
function stoppedReasonOf(run: RunSpend): string | null {
  return run.status === 'partial' && run.stoppedReason ? run.stoppedReason : null;
}
```

Route it through `STOPPED_REASON[...]` in `copy.ts`. The `StoppedReason` union goes beside `RUN_STATUSES` in `src/lib/ui/run-tone.ts` (L31–72), and `tests/unit/ui-maps.test.ts` gains the drift assertion.

### Run-report cards (NEW)

**Analog:** `src/components/sources/source-ledger.tsx`. Its four-count block is the focal point, with desk `Table` cells right-aligned and `tabular-nums`, and phone label/value rows (L318–349, L405–424). The testid-per-count form is `data-testid={\`sources-count-${sourceKey}-${kind}\`}` (L421). `spend/by-run.tsx` supplies the desk-`Table` / phone-`ItemGroup` split with distinct testids (L28–31: "one hook on two elements … is the silent `.first()` match").

---

### `src/components/places/google-maps-tag.tsx` (NEW, server-safe) and `globals.css` (MOD)

**Analog for "a source tag is text, never a badge":** `src/components/business-detail/fields-and-sources.tsx` L114–121 and the Rule 22 header (L27–33):

```tsx
function Tag({ field, 'data-testid': testid }: { field: FieldView<unknown>; 'data-testid': string }) {
  return <span data-testid={testid}>{sourceTagOf(field)}</span>;
}
```

The tag is `<span translate="no" className="google-maps-attribution" data-testid="google-maps-attribution">Google Maps</span>`, with the date in a sibling muted span. No client directive.

**CSS token analog:** `globals.css` declares `--warning` on `:root` (L67) and `.dark` (L117), and maps it in `@theme inline` (L135, L158: `--color-warning: var(--warning);`). Add `--google-attribution` the same way, as a literal in both blocks, and add one `.google-maps-attribution` rule (UI-SPEC Rule 29).

---

### `src/components/review/google-listing-card.tsx`, `SpineRecordCard` extraction (MOD), `review-format.ts` → `places-format.ts`

**Analog:** `src/components/review/candidate-pair.tsx` L55–113 (`Side`). Extract it as an exported `SpineRecordCard`. `CandidatePair` (L115–129) then keeps using it unchanged.

Its focus hook must survive the extraction: the first heading gets `tabIndex={-1}` and `data-review-focus`, which `review-actions.tsx` moves focus to after an advance (L72–77).

**Chips:** `src/components/review/signal-chips.tsx` L21–58 is reused as is. The Google-kind keys come from a `placesChips()` in `src/lib/ui/places-format.ts`, shaped exactly like `reviewChips()` in `review-format.ts` L26–35 and L75–124:

```typescript
export type ReviewChip = { key: 'phone' | 'name' | 'distance' | 'zip' | 'cluster'; label: string; agrees: boolean };
...
  const nameSim = num(features.nameSim);
  if (nameSim !== null) {
    const namePoints = num(features.name) ?? 0;
    chips.push({ key: 'name', label: REVIEW_CHIP_NAME(nameSim.toFixed(2)), agrees: namePoints > 0 });
  }
```

Widen the key union with `'city' | 'sab' | 'no_listing_phone' | 'no_listing_location'`. Read `features` defensively (L21–23): a malformed vector drops a chip and never throws.

🔴 **Rule 28's repo walk:** any file that imports `places-format.ts` must also import `GoogleMapsTag`. The file must carry no client directive, and `ui-maps.test.ts` already walks `src/lib/ui/` for one.

### `src/app/(app)/review/page.tsx` (MOD)

**Analog:** itself. Keep:
- the one `withOrg` (L25–28);
- the `review-remaining` live region, which holds the count and the end state in the same node (L37–42, L66–74);
- the `ReviewAdvance` keyed by item id (L90–93).

Add a `?kind=` read from `searchParams` and a `ToggleGroup`. `listReviewQueue(claims, kind)` returns a discriminated `top: { kind: 'pair', … } | { kind: 'google', … }`.

---

### `src/components/review/reject-dialog.tsx` and `business-detail/detach-dialog.tsx` (NEW, client)

**Analog:** `src/components/business-detail/unmerge-dialog.tsx`, the one destructive confirmation in the tree.

**Imports and the desk/phone switch** (L1–41). Import `useIsDesk` from `@/components/preset-detail/run-drawer` (defined at L69–103 there); never write a second `matchMedia`.

**The confirm path** (L131–160). `onClick` inside `useTransition`; catch the rejected promise; close and `router.refresh()` only on `ok: true`:

```tsx
  const confirm = useCallback(() => {
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof unmergeBusiness>>;
      try {
        result = await unmergeBusiness({ mergeId });
      } catch {
        setError({ message: UNMERGE_FAILED, retryable: true });
        return;
      }
      if (!result.ok) {
        setError({ message: result.message, retryable: isRetryable(result.code, result.detail?.reason) });
        return;
      }
      toast(TOAST_UNMERGED(loserName, loserKey));
      setOpen(false);
      router.refresh();
    });
  }, [mergeId, loserName, loserKey, router]);
```

**No `<form action>`** (header L57–60). **Toast on success only**; a refusal is a persistent `Alert` inside the dialog. The Rule 42 test ("the trigger calls no server action until confirm") has its analog in `tests/unit/unmerge-dialog.test.tsx`.

---

### `src/components/business-detail/google-check.tsx` (NEW)

**Analog:** `src/components/business-detail/fields-and-sources.tsx` L93–112 (`FieldRow`): the desk three-column grid and the phone three-line stack:

```tsx
    <div className="flex flex-col gap-2 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] sm:items-baseline sm:gap-x-6 sm:gap-y-1">
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-base font-normal break-words">{value}{note ? ... : null}</dd>
      <dd className="text-sm font-normal text-muted-foreground sm:text-right">{source}</dd>
    </div>
```

The source column holds `<GoogleMapsTag /> · {date}`. The history rows follow `merge-history.tsx`, a per-row type plus a shared context object (03-PATTERNS L919–940). The collapsible follows `ConfidenceDistribution` (`src/components/sources/confidence-distribution.tsx`).

🔴 **Rule 32:** no component reads Places lat/lng. The existing Location row keeps its durable source. `tests/unit/no-internal-leak.test.ts` gains the coordinate column names as never-rendered.

---

### `src/components/sources/transient-card.tsx` (NEW) and `sources/page.tsx` (MOD)

**Analog:** the page structure in `src/app/(app)/sources/page.tsx` L50–112. Static parts render outside `Suspense`, so they survive a load failure. The data region calls `unstable_rethrow(error)` before logging (L79–84):

```tsx
  try {
    rows = await listSources(claims);
  } catch (error) {
    unstable_rethrow(error);
    console.error('sources: the run ledger failed to load', error);
    return <SourcesLoadFailed />;
  }
```

The "Copy the purge command" action reuses `CopyCommandButton` (`src/components/sources/copy-command-button.tsx`) with `testId="sources-transient-purge-copy"`. It takes a plain string prop only (L14–16).

🔴 **Rule 37:** `SOURCE_KEYS` (`sources.ts` L28–33) stays at four, and `tests/e2e/sources.spec.ts` L44–45 counts `[data-testid^="sources-row-"]` = 4. The card's testids are `sources-transient-*`.

---

### `src/components/preset-detail/run-drawer.tsx` (MOD) and `presets/[id]/page.tsx` (MOD)

**Analog:** themselves.

- **Drawer confirm** (L152–178). Replace `toast(...); setOpen(false); router.refresh();` on success with `router.push(\`/runs/${result.data.runId}\`)` and no toast (UI-SPEC § Screen 2). Keep the `budget_refused` → persistent `Alert` branch. Add a `mode_refused` branch.
- **The page's single `withOrg`** (L171–199) gains the five-recent-runs read beside the existing `lastRun` query, the same shape:

```typescript
        await tx.execute(sql`
          select r.status, r.cost_micro_usd::text as cost,
                 (extract(epoch from coalesce(r.finished_at, r.started_at, r.created_at)) * 1000)::bigint::text as at_ms
            from runs r
            join search_versions v on v.id = r.search_version_id
           where v.search_id = ${id}
           order by r.created_at desc
           limit 1`),
```

- **`run-preset` trigger** (L306–322). One element in the DOM, moved by CSS into the sticky bar on phone. Rules 34 and 40 require the mode-dependent primary slot to keep "exactly one element per testid".
- `PLACES_MODE` is read on the server (`env.PLACES_MODE`) and passed as a prop (Rule 33).
- **Rule 41 drift:** `gap-3` at `run-drawer.tsx` L220 and L300 and at page L310 (the title row `flex flex-wrap items-center justify-between gap-3`).

### `src/components/app-shell/app-sidebar.tsx` (MOD)

**Analog:** itself. `NavItem` (L45–51) gains `alsoActiveUnder?: readonly string[]`. `isNavActive` (L136–138) gains an optional third argument:

```typescript
export function isNavActive(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/');
}
```

Call sites (L177, L195, and the mobile tab bar) pass `item.alsoActiveUnder`.

---

### `tests/unit/msw/server.ts` (MOD): the Places handler

**Analog:** itself.

- **POST handler with 501 on an unrecorded request** (L275–294). The Places handler returns 501 when the `X-Goog-FieldMask` header, the key header, or `includePureServiceAreaBusinesses: true` is missing (M26):

```typescript
export const censusBatchHandler = http.post(CENSUS_BATCH_ENDPOINT, async ({ request }) => {
  ...
  if (benchmark !== 'Public_AR_Current' || vintage !== null) {
    return new HttpResponse(`msw: unrecorded batch form: ...`, { status: 501 });
  }
```

🔴 **A RegExp path, not a string** (RESEARCH Pitfall 8, measured): `http.post(/^https:\/\/places\.googleapis\.com\/v1\/places:searchText$/, …)`.

- **One-shot failure injection, reset in `afterEach`** (L67–85). This serves the 429 daily / per-minute, 400 and 503 envelopes.
- **Envelope shape checked at load** (L57–65). This covers the error-envelope fixtures and the `synthetic: true` sidecar marker (D-20).
- **Registration** (L461–477). Add to `setupServer(...)`; `onUnhandledRequest: 'error'` stays in the single start function.
- **A request log for assertions** (`censusRequests`, L69). The Places log records the body and headers, which is how "no places request leaves without a reservation" checks for an open reservation at request time.

The fixtures README gains a Places section. It follows the Socrata section's shape: recording date, request shape, a table of files, and "Re-recording". It states that every file is anonymized (D-20).

🔴 **The workflow lane:** `vi.mock` does not reach step code, but msw does (RESEARCH spike). The workflow lane therefore imports this same server.

---

### `tests/unit/no-google-credential.test.ts` · `no-network.test.ts` · `field-mask-tier.test.ts` (MOD) + `tests/unit/_walk.ts` (NEW)

**Analogs:** themselves. Three private copies of `walk()` exist: `no-google-credential` L41–48, `no-network` L52–59 and `field-mask-tier` L62–67. RESEARCH Pitfall 6 requires every walker to skip `src/app/.well-known/workflow/**`, which `next build` generates. Lift one `walk(dir, { exts, exclude })` into `tests/unit/_walk.ts` and keep each test's two-sided assertions: `expect(scanned.length).toBeGreaterThan(...)` plus a pinned known file.

- **`no-google-credential`:** allow exactly `src/lib/places/client.ts` for the `FORBIDDEN` patterns (L33–39), and amend L86–87 for `PLACES_MODE` (see `env.ts` above). M51, "read the key in a second module", must red the named test.
- **`no-network`:** add the Places host to `HOSTS` as a constructed string (L29–34), and `src/lib/places/client.ts` to `ALLOWED_FILES` (L40–44). `scripts/` is not walked (L11–12), so the recorder and the geo-shape fetcher may name hosts there.

---

### `tests/db/*` for the new tables and definers

**Test-shape analogs:**
- **Grant refusal with wording:** `tests/db/events-append-only.test.ts` L29–55, one refused statement per `withRollback`, with the `25P02` warning at L47–48:

```typescript
      await actAs(c, ORG_A_CLAIMS);
      const attempt = c.query("update events set action = 'hacked'");
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table events/);
```

- **Definer tenancy refusal:** `tests/db/budget-meter.test.ts` L304–326 (`reserve_budget refuses a run belonging to another org`), with the positive control as the next test (L328).
- **Zero-cost ledger row:** `budget-meter.test.ts` L511 (`a zero-cost paid-SKU call still writes a ledger row`). This is the template for "a change check ledgers a zero-cost row".
- **Driving action or step code on the runtime driver:** `tests/db/_drizzle-tx.ts` L66–80 (`withTxRollback`, `asPg`).
- **The `withOrg` savepoint double:** `tests/db/review-actions.test.ts` L80–93. Reuse it for `withWorkerOrg` and `withCronRole` doubles in the DB lane:

```typescript
  vi.doMock('@/db/with-org', () => ({
    withOrg: async <T>(claims: OrgClaims, fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const outer = request.tx;
      if (!outer) throw new Error('review-actions: no request transaction is open');
      return outer.transaction(async (sp) => {
        const tx = sp as unknown as Tx;
        await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
        await tx.execute(sql`set local role authenticated`);
        return fn(tx);
      });
    },
  }));
```

  🔴 Use `vi.doMock` plus a dynamic import, undone in `afterAll`, never a hoisted `vi.mock` (L18–21: the DB suite runs `isolate: false`).
- **`refusedCode` for one refusal inside a savepoint** (L110–120).
- **Fixtures module:** `tests/db/_merge-fixtures.ts` (`CLAIMS_A`/`CLAIMS_B` L33–38, `seed*` helpers L97–269). `_places-fixtures.ts` composes on `seedTwoOrgs` and inserts as the owner before `actAs`, with tens of rows, never thousands.
- **`actAsRole` gains `'siteless_cron'`** (`_fixtures.ts` L80–88), extending the explicit allow-list.

**`tests/db/grants-audit.test.ts` (MOD) L34–71:** add seven rows to `TENANT_TABLES`, each with a comment naming its grant line, as the Phase 3 rows do (L63–70). Test 1 asserts the array equals the live catalog.

**`tests/db/event-trigger.test.ts` (MOD) L60–103:** `EVENT_LOGGED` and `LOG_EVENT_TRIGGER_ROWS` move with whatever the `place_attachments` trigger decision is.

---

### `vitest.workflow.config.ts` (NEW) and `.github/workflows/ci.yml` (MOD)

**Analog:** `vitest.db.config.ts`, read in full.
- **Line 1, the TZ and LANG pin in the MAIN process:** `process.env.TZ = 'UTC'; process.env.LANG = 'en_US.UTF-8';`
- `loadEnv({ path: '.env.local', override: false })`.
- `pool: 'forks'`, `fileParallelism: false`, `testTimeout: 60000`.
- **The `server-only` no-op alias** from `vitest.config.ts` L45–49 (`serverOnlyNoop` via `require.resolve`, never a hard-coded path).
- **New:** the `workflow()` vitest plugin from `@workflow/vitest`; `include: ['tests/workflow/**/*.test.ts']`.

**CI:** the `db` job (L43–87) already carries `TEST_DATABASE_URL`, `RUNTIME_DB_URL` and the `CLERK_SECRET_KEY` placeholder (L66–70). Add `- run: pnpm test:workflow` after `- run: pnpm test:db` (L87). Do **not** add a Places key or a real `CRON_SECRET` to CI; placeholders only, as for Clerk.

### `pnpm-workspace.yaml` · `eslint.config.mjs` · `.gitignore` (MOD)

- **`pnpm-workspace.yaml` L1–21:** every `allowBuilds` entry gets a written reason, like `msw: false` (L12–18). Add `'@swc/core': true` and `cbor-extract: false`, each with its reason, and prove them with a clean `install --frozen-lockfile`.
- **`eslint.config.mjs` L5–24:** each ignore carries a why-comment. Add `'src/app/.well-known/workflow/**'`, `'.workflow-data/**'` and `'.workflow-vitest/**'`.
- **`.gitignore`:** add `.workflow-data/`, `.workflow-vitest/` and `.swc/` (the spike created all three).

### `src/proxy.ts` (MOD)

**Analog:** itself, L27–33. Add `\\.well-known/workflow/` inside the first matcher's negative lookahead.

🔴 L19–23: this file is **token-grepped**. It must not spell a route matcher helper, a protect call or a runtime declaration, **including in comments**. Write the new comment without naming them.

---

## Shared Patterns

### Tenancy: the four obligations per new table
**Source:** `src/db/schema/_helpers.ts` (`orgScoped`, `orgPolicies`, `tstz`) · `drizzle/0023` L104–117 · `tests/db/grants-audit.test.ts` L34–71
**Apply to:** all eight new tables. `place_coordinates` has the grant step inverted: no grant at all.

1. `...orgScoped`
2. `index('<t>_org_idx').on(t.orgId)`
3. `...orgPolicies('<t>')`
4. The grant in the creating migration, plus a `TENANT_TABLES` row

### Definer discipline: org and actor are resolved, never passed
**Source:** `drizzle/0024` L9–15 and L168–174 · `0019` L60–72 · `0020` L46–50 · `0025` L36 (`search_path = public, pg_temp`) · `0024` L129–139 (named-role revoke)
**Apply to:** every `app.*` function in this phase. The one exception is the cross-org purge, which takes no org at all and is executable only by `siteless_cron`.

### Auth: `requireOrg()` first, and claims from `orgClaims()`
**Source:** `src/lib/auth/require-org.ts` · `record-review-decision.ts` L27–32, L75–77 · `tests/unit/server-actions-guard.test.ts`
**Apply to:** `queue-run.ts`, `record-listing-decision.ts`, `detach-listing.ts`. Workflow steps have no Clerk request. Their equivalent is `withWorkerOrg` plus the re-read of the run under RLS as the first statement.

### Expected refusals are results
**Source:** `src/server/actions/_result.ts` L20–68 · `_pg.ts` (SQLSTATE on `.cause`) · `queue-run.ts` L35–38 ("a denial is zero rows, not an exception")
**Apply to:** every action. In the workflow the equivalent is a budget denial or ceiling stop → `state.stopped` (M33: never a retryable throw). A daily-quota 429 → `FatalError` (M52).

### Drizzle traps (unchanged from Phase 3)
**Source:** `src/db/drizzle-executor.ts` L15–34 · `src/server/queries/preset-cards.ts` (Date binding, `instantOf`) · `_pg.ts`
**Apply to:** `meter.ts`, `candidates.ts`, `steps.ts`, every new query.

| Trap | Fix |
|---|---|
| JS array in a `sql` template → N placeholders | One `jsonb` parameter (`jsonb_to_recordset($1::jsonb)`) or one array-literal string + cast |
| A bound `Date` | `toISOString()` + `::timestamptz` |
| `timestamptz` comes back as a string | Epoch-ms text + `instantOf()` (`sources.ts` L110–111, L134) |
| SQLSTATE not on the caught error | `pgFailure(err)` |
| bigint | `.toString()` + `::bigint` (`queue-run.ts` L148) |

### No Places content outside memory (Pitfall 1)
**Source:** `score.ts` L32–35 (T-3-11: `features` carries numbers only) · `census.ts` (named reasons, never bodies) · UI-SPEC Rule 30
**Apply to:** step return values, `features` jsonb, thrown messages, logs, fixtures (D-20), `data-` attributes and toasts. Named tests: "no step returns Places content" and "no Places text reaches the database".

### Server-safe copy and maps
**Source:** `src/lib/ui/run-tone.ts` L1–22 · `src/lib/ui/copy.ts` · `tests/unit/ui-maps.test.ts`
**Apply to:** `copy.ts` (every Phase 4 string), `run-tone.ts` (`StoppedReason`, `RUN_KIND`), and `places-format.ts`. None carries the client directive, and the comments must not spell it (the walk is a bare token search over `src/lib/ui/`).

### Time
**Source:** `src/lib/time.ts` L20–73 (`APP_TZ`, `APP_LOCALE`, `formatLocal`, `formatCount`) · `src/lib/budget/period.ts`
**Apply to:** partition weeks, run timestamps, "Updated 2:14:05 PM", the purge age. No component calls `Intl` directly (Rule 26). Tests run TZ=UTC and assert one instant in two zones.

### Touch and testids
**Source:** `tests/e2e/touch-targets.spec.ts` (exactly one visible match per testid) · `preset-detail.spec.ts` header (assert testids and numbers, never copy; the `TARGET_IS_LOCAL` two-databases trap)
**Apply to:** the three run actions in every mode, the review filter, and `runs.spec.ts`. That spec must be local-only or fixture-free, and it must never click `run-confirm` against a deployed target (Rules 38/39).

---

## No Analog Found

| File | Role | Data Flow | Reason | Use instead |
|---|---|---|---|---|
| `src/workflows/places-sweep/workflow.ts` | orchestrator | durable / event-driven | First Workflow in the repo; nothing uses `"use workflow"` | RESEARCH § Pattern 1 (the full `placesSweep` sketch) + § Anti-Patterns (return no Places content; no Node I/O in the workflow file) |
| `src/workflows/places-sweep/steps.ts` | service | per-page reserve → call → settle | No `"use step"` anywhere; the per-page ordering (A reserve+ceiling · B in-flight · C call · D settle/release+write) is new | RESEARCH § Pattern 2 (`reservePage` sketch) + § Pattern 6 + Pitfall 9. The transaction bodies copy `queue-run.ts` L139–169 and `drizzle/0019` |
| `src/workflows/places-sweep/reducer.ts` | utility | transform | No queue reducer exists | RESEARCH § Pattern 5 (saturation = exactly 60; three floors; novelty rule) |
| `tests/workflow/places-sweep.test.ts` + `vitest.workflow.config.ts` plugin half | test lane | — | `@workflow/vitest` is not installed; no in-process workflow harness exists | RESEARCH § Validation Architecture → Layering (3); § Standard Stack (spike-verified versions) |
| `next.config.ts` `withWorkflow()` | config | — | Config is `{ reactStrictMode: true }` only | RESEARCH § Pattern 1 + Pitfall 11 (check `manifest.json` after `next build`) |
| `vercel.json` `crons` | config | event-driven | `vercel.json` is `$schema` + `framework` only; the repo has no cron | RESEARCH § Pattern 10 |
| `src/app/api/cron/purge-places/route.ts` Bearer auth | route | event-driven | `health/route.ts` is unauthenticated; no timing-safe compare exists in `src/` | RESEARCH § Pattern 10 (`timingSafeEqual`, refuse when unset, idempotent purge) |
| `app.purge_expired_place_coordinates()` | definer | batch, cross-org | Every existing definer is single-org via `app.current_org_id()` | RESEARCH § Pattern 10 (tenancy paragraph); revoke per `0024` L129–139 |
| `business_place_signal` view (`security_invoker = true`) | migration | read | No view exists in `drizzle/` (grep: zero `create view`) | RESEARCH § Pattern 8 → "Current signal"; drizzle-kit does not own views, so write it in `db:custom` |
| `place_observations` BEFORE UPDATE OR DELETE raising trigger | migration | — | No raising trigger exists; append-only is grant-only today (`events`) | RESEARCH § Pattern 8 table; keep the grant refusal as the primary proof |
| `src/components/runs/run-auto-refresh.tsx` (visibility pause, terminal stop) | component (client) | polling | Only timer is a debounce (`use-live-estimate.ts`) | UI-SPEC § Live refresh contract + Rule 36 |
| `scripts/record-places-fixtures.ts` (anonymize in memory) | script | file-I/O | Phase 3 recordings were throwaway runs outside the repo, verbatim | CONTEXT D-20 + RESEARCH Pitfall 1(b); fixture README format from the Socrata section |
| `src/lib/places/change-detect.ts` | utility | transform | No set-diff utility; `countGone` in `src/lib/ingest/` is SQL-side | RESEARCH § Pattern 9 |

**Partial-only matches worth flagging:**
- `src/lib/places/meter.ts`: `queue-run.ts` supplies the reserve call and the 1 µUSD rule. The `ReservedCall` brand, the conditional `runs.calls_count < ceiling_requests` UPDATE in the same transaction, and the per-attempt `request_id` are all new.
- `place_coordinates`: `source_records.expires_at` + `sr_expiry` partial index (`drizzle/0006` L40) is the only TTL precedent. A table `authenticated` cannot touch at all is new; so is a purge that deletes.

---

## Blast-radius notes (the planner must put these in the same task)

1. **`PHASE4_RUN_NOTICE` retirement** reaches six files: `copy.ts`, `run-drawer.tsx`, `queue-run.ts`, `presets/page.tsx`, `tests/unit/ui-maps.test.ts` L26 and `tests/e2e/preset-detail.spec.ts` L341. UI-SPEC Rule 38 names only two.
2. **`tests/unit/no-google-credential.test.ts` L86–87** refuses `'PLACES'` in `src/env.ts`, which conflicts with D-02 as written. Amend it; never delete it.
3. **The `X-Goog-FieldMask` single-module grep** (`field-mask-tier.test.ts` L59) names `field-mask-tier.ts`. Move it to whichever module actually sends the header.
4. **Three walkers** need the `.well-known/workflow` exclusion (Pitfall 6). `ui-maps.test.ts` walks only `src/lib/ui/` and is unaffected.
5. **`tests/unit/estimate.test.ts` L94, L160, L175** pin `612` and `9144 / 612`. D-18 re-pins all three with the new exact numbers, watched red first.
6. **`tests/e2e/spend.spec.ts` L128–133** clicks `run-preset` → `run-confirm` against the deployed app (Rule 39).
7. **`queue-run.ts` builds claims by hand** (L61: no `org_role`). If the Phase 4 version calls anything role-gated, switch to `orgClaims()` (with-org.ts L11–19 records the 42501 this caused before).

---

## Metadata

**Analog search scope:** `src/{app,components,db,lib,server,seed,workflows}`, `drizzle/*.sql`, `scripts/`, `tests/{unit,db,e2e}`, `vitest*.config.ts`, `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, `eslint.config.mjs`, `next.config.ts`, `vercel.json`, `.planning/phases/03-*/03-PATTERNS.md`
**Files scanned:** 330 tracked files enumerated; 58 opened and mined, reading only the ranges cited above.
**Repo state at mapping:** `99e3bf9 docs(04): validation strategy + research-round decisions D-18..D-21`
**Pattern extraction date:** 2026-09-23

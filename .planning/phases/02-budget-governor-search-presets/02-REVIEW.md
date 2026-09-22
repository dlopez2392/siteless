---
phase: 02-budget-governor-search-presets
reviewed: 2026-09-22T19:04:51Z
depth: standard
files_reviewed: 124
files_reviewed_list:
  - .github/workflows/ci.yml
  - docs/deploy.md
  - docs/runbooks/google-quota.md
  - drizzle/0012_eager_vertigo.sql
  - drizzle/0013_reference_policies_and_grants.sql
  - drizzle/0014_brown_phantom_reporter.sql
  - drizzle/0015_budget_grants_and_triggers.sql
  - drizzle/0016_budget_meter_functions.sql
  - eslint.config.mjs
  - package.json
  - postcss.config.mjs
  - scripts/refresh-outlet-counts.ts
  - scripts/seed.ts
  - src/app/(app)/layout.tsx
  - src/app/(app)/presets/[id]/edit/page.tsx
  - src/app/(app)/presets/[id]/page.tsx
  - src/app/(app)/presets/new/page.tsx
  - src/app/(app)/presets/page.tsx
  - src/app/(app)/settings/budget/page.tsx
  - src/app/(app)/settings/organization/page.tsx
  - src/app/(app)/spend/page.tsx
  - src/app/globals.css
  - src/app/layout.tsx
  - src/app/no-access/page.tsx
  - src/app/page.tsx
  - src/components/app-shell/app-sidebar.tsx
  - src/components/app-shell/budget-banner.tsx
  - src/components/app-shell/mobile-tab-bar.tsx
  - src/components/app-shell/settings-nav.tsx
  - src/components/app-shell/theme-switch.tsx
  - src/components/app-shell/top-bar.tsx
  - src/components/app-shell/user-menu.tsx
  - src/components/budget/cap-form.tsx
  - src/components/budget/second-wall-card.tsx
  - src/components/preset-detail/duplicate-dialog.tsx
  - src/components/preset-detail/run-drawer.tsx
  - src/components/preset-detail/summary-card.tsx
  - src/components/preset-detail/version-diff.ts
  - src/components/preset-detail/version-history.tsx
  - src/components/preset-editor/assumptions-surface.tsx
  - src/components/preset-editor/cluster-picker.tsx
  - src/components/preset-editor/estimate-panel.tsx
  - src/components/preset-editor/geography-picker.tsx
  - src/components/preset-editor/preset-form.tsx
  - src/components/preset-editor/radius-geocoder.tsx
  - src/components/preset-editor/use-live-estimate.ts
  - src/components/preset-list/create-preset-cta.tsx
  - src/components/preset-list/preset-card.tsx
  - src/components/preset-list/presets-empty.tsx
  - src/components/spend/budget-gauge.tsx
  - src/components/spend/by-provider.tsx
  - src/components/spend/by-run.tsx
  - src/components/spend/period-header.tsx
  - src/components/theme-provider.tsx
  - src/db/schema/_helpers.ts
  - src/db/schema/budget.ts
  - src/db/schema/clusters.ts
  - src/db/schema/geography.ts
  - src/db/schema/index.ts
  - src/db/schema/outlet-counts.ts
  - src/db/schema/runs.ts
  - src/db/schema/searches.ts
  - src/db/with-org.ts
  - src/hooks/use-mobile.ts
  - src/lib/auth/require-org.ts
  - src/lib/budget/field-mask-tier.ts
  - src/lib/budget/money.ts
  - src/lib/budget/period.ts
  - src/lib/budget/price-book.ts
  - src/lib/estimate/assumptions.ts
  - src/lib/estimate/estimate.ts
  - src/lib/estimate/expand-cells.ts
  - src/lib/geocode/census.ts
  - src/lib/ui/copy.ts
  - src/lib/ui/run-tone.ts
  - src/lib/utils.ts
  - src/seed/types.ts
  - src/server/actions/_pg.ts
  - src/server/actions/_result.ts
  - src/server/actions/duplicate-preset.ts
  - src/server/actions/estimate-preset.ts
  - src/server/actions/geocode-address.ts
  - src/server/actions/queue-run.ts
  - src/server/actions/save-preset-version.ts
  - src/server/actions/set-budget-cap.ts
  - src/server/queries/budget.ts
  - src/server/queries/preset-cards.ts
  - src/server/queries/preset-editor.ts
  - src/server/queries/presets.ts
  - tests/db/_concurrency.ts
  - tests/db/_fixtures.ts
  - tests/db/budget-admin-gate.test.ts
  - tests/db/budget-concurrency.test.ts
  - tests/db/budget-meter.test.ts
  - tests/db/counties-fips.test.ts
  - tests/db/event-trigger.test.ts
  - tests/db/grants-audit.test.ts
  - tests/db/reference-rows.test.ts
  - tests/db/versioned-presets.test.ts
  - tests/e2e/budget-banner.spec.ts
  - tests/e2e/preset-detail.spec.ts
  - tests/e2e/presets.spec.ts
  - tests/e2e/signed-in.spec.ts
  - tests/e2e/spend.spec.ts
  - tests/e2e/theme-tokens.spec.ts
  - tests/e2e/touch-targets.spec.ts
  - tests/unit/_setup-dom.ts
  - tests/unit/budget-period.test.ts
  - tests/unit/census.test.ts
  - tests/unit/estimate.test.ts
  - tests/unit/field-mask-tier.test.ts
  - tests/unit/fixtures/preset.ts
  - tests/unit/jsdom-lane.test.tsx
  - tests/unit/money.test.ts
  - tests/unit/msw/server.ts
  - tests/unit/no-google-credential.test.ts
  - tests/unit/outlet-counts.test.ts
  - tests/unit/pg17-compat.test.ts
  - tests/unit/price-book.test.ts
  - tests/unit/server-actions-guard.test.ts
  - tests/unit/stale-estimate.test.tsx
  - tests/unit/ui-maps.test.ts
  - tests/unit/version-diff.test.ts
  - vitest.config.ts
findings:
  critical: 1
  warning: 9
  info: 10
  total: 20
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-09-22T19:04:51Z
**Depth:** standard
**Files Reviewed:** 124
**Status:** issues_found

## Summary

Every file in scope was read in full. `tsc --noEmit` is clean on `16399bc`. The five migrations, the three `SECURITY DEFINER` write paths, the six server actions, the four query modules, every page and component, and all 36 test files were checked against the generic checklist and the six project-specific criteria (tenancy, money, meter, drizzle `sql` pitfalls, React/Next boundary rules, test honesty).

What holds up: money is `bigint` micro-USD end to end with no float on a cost path; `cost_cents` is a single generated column; the free allowance is applied exactly once through `priceRequests`; the meter is a single conditional `UPDATE` with the self-heal under `SKIP LOCKED` and settlement idempotent on `request_id`; every action calls `requireOrg()` first and nothing nests `withOrg`; the two JS-array-in-`sql` sites are fixed and no third exists; every `Date` bound through `tx.execute` is now an ISO string with an explicit cast; every `Intl` call site pins `APP_LOCALE`/`APP_TZ`; no `"use client"` data export is consumed from a server component; no Google credential is read; no `[--x]` shorthand appears.

What does not hold up is one tenancy gap and a cluster of meter-visibility and test-honesty defects:

- **CR-01 (BLOCKER):** `savePresetVersion` accepts a `searchId` belonging to another tenant. RLS confines the `UPDATE searches` to zero rows, but the `INSERT INTO search_versions` succeeds because the insert policy only checks the version row's own `org_id` and the FK check bypasses RLS. The result is an existence oracle on foreign preset ids, cross-tenant rows with `org_id` different from their parent, and a version-number squatting attack that locks a victim out of saving their own preset with a permanent "changed while you were editing" refusal.
- **WR-01:** nothing releases an expired reservation except the next `app.reserve_budget` call. There is no sweeper. In Phase 2 every "Run this preset" is a hold that expires after ten minutes and then sits in `reserved_micro_usd` — counted by the banner, the gauge, the spend header and `bp_not_over`'s cap floor — until somebody queues another run.
- **WR-02:** the cap is per `(org, provider)` in the database but the UI edits and reads only `places` while the help copy says the cap "applies to Places, Firecrawl and Anthropic together". The enforced ceiling is $50 per provider, not $50.
- **WR-09:** `tests/e2e/spend.spec.ts` › "the by-run tab lists a queued run" has never executed against a real drawer: its locator resolves to the Create-preset CTA and it probes for a testid (`preset-run-cta`) that does not exist. It is one of the "6 skipped" in the phase gate and reads as a pass.

Already-known items (deferred-items.md: the `e2e-*` rows left in `siteless_test` and production, the missing action-level db test, the local-only skip on `preset-detail.spec.ts`) are not re-reported.

## Critical Issues

### CR-01: `savePresetVersion` writes a version onto another tenant's preset

**File:** `src/server/actions/save-preset-version.ts:156-175`, `drizzle/0012_eager_vertigo.sql:154,193`
**Issue:** On the edit path (`searchId` supplied) the action never verifies the caller can see that search. It inserts straight into `search_versions` with `org_id = app.current_org_id()` and `search_id = ${targetSearchId}`. The `search_versions_insert` policy only checks the new row's own `org_id`, and PostgreSQL evaluates the FK to `searches` with the referenced table owner's privileges — referential checks bypass RLS by design. So for any real search id from any org the insert succeeds; the follow-up `update searches set current_version_id …` is silently filtered to zero rows; the action returns `ok` with the foreign `searchId`. Consequences, each proven from the code paths above:

1. **Existence oracle (T-2-10 is explicitly violated).** A random uuid → FK `23503` → `unexpected`. A real foreign uuid → `ok`. `NOT_FOUND`'s own copy ("the link may belong to a different organisation") says cross-org links are expected.
2. **Version-number squatting / denial of service.** An attacker holding a victim's search id inserts `(search_id, version = N)` for the victim's next N. The victim's save raises `23505` on `search_versions_search_version_uniq` → `conflict`; `readCurrentVersionNumber` reads under the victim's RLS and reports N−1, so "Reload" points them back at the same collision forever. `search_versions` is append-only by grant, so the victim cannot clear it.
3. **Data integrity.** `search_versions.org_id ≠ searches.org_id` for the squatted rows; `app.log_event` records the attacker's actor id against a version of the victim's preset.

`tests/db/versioned-presets.test.ts` inserts versions only for the caller's own search and cannot see this. `queue-run.ts` and `duplicate-preset.ts` are not affected — both read the parent row through RLS before writing.
**Fix:**
```ts
// save-preset-version.ts, inside withOrg, before the version insert on the edit path:
if (targetSearchId !== undefined) {
  const owned = rowsOf<{ id: string }>(
    await tx.execute(sql`select id from searches where id = ${targetSearchId}`),
  )[0];
  if (!owned) return { kind: 'missing' } as const;   // -> fail('not_found', NOT_FOUND('preset'))
}
```
and close it at the database so hand-written SQL cannot do it either (new `pnpm db:custom` migration):
```sql
alter table searches add constraint searches_id_org_uniq unique (id, org_id);
alter table search_versions
  add constraint search_versions_search_org_fk
  foreign key (search_id, org_id) references searches (id, org_id);
alter table search_versions add constraint search_versions_id_org_uniq unique (id, org_id);
alter table runs
  add constraint runs_version_org_fk
  foreign key (search_version_id, org_id) references search_versions (id, org_id);
```
Add a named test to `tests/db/versioned-presets.test.ts`: as `org_A`, insert a version whose `search_id` is org B's search → expect `23503` (with the composite FK) and, through the action, `not_found`. Watch it red first without the fix.

## Warnings

### WR-01: Expired reservations are never released except by the next `reserve_budget`; every read, the banner, and the cap floor count stale holds

**File:** `drizzle/0016_budget_meter_functions.sql:157-180,339-367`, `src/server/queries/budget.ts:137-164`, `src/server/actions/queue-run.ts:40-43`, `src/components/app-shell/budget-banner.tsx:72-84`
**Issue:** 02-CONTEXT lists "a sweeper that releases expired reservations" beside the self-heal; only the self-heal shipped, and it runs solely inside `app.reserve_budget`. `ensure_budget_period`, `readCurrentPeriod`, `set_budget_cap` and every page read the raw `reserved_micro_usd`. In Phase 2 nothing settles a reservation (no executor), so every queued run is a hold of `costMicroUsdHi` that expires after `p_ttl = 10 minutes` and then stays in the column indefinitely. Effects: the 80 %/100 % banner and gauge show committed money nothing holds (a single RGV-baseline run late in the month is a $21.42 hold, 43 % of the cap, displayed until someone queues again); `app.set_budget_cap` refuses a legitimate cap below `spent + stale reserved` with `bp_not_over`; `CAP_BELOW_SPEND` quotes that inflated floor. `period-header.tsx:102` then explains the stale hold as "reserved by runs in flight" — which is false.
**Fix:** Move the release out of the meter's hot path into a function callable from reads:
```sql
create or replace function app.release_expired_reservations(p_provider text, p_period date)
returns bigint language plpgsql security definer set search_path = public as $$ ... $$;
-- body = step 1 of app.reserve_budget verbatim, returning v_freed
```
call it from `app.ensure_budget_period` (already the get-or-create every read goes through) and from `app.set_budget_cap` before the cap update, and have `app.reserve_budget` call the same function so the logic exists once. Add the Vercel Cron sweeper the CONTEXT names when Phase 4 lands, and add `budget-meter.test.ts` › "a read after the TTL no longer counts the expired hold".

### WR-02: The cap is per provider in the database, `places`-only in the UI, and "all three together" in the copy

**File:** `src/lib/ui/copy.ts:129-131`, `src/app/(app)/settings/budget/page.tsx:46,77`, `src/app/(app)/layout.tsx:56`, `src/app/(app)/spend/page.tsx:68`, `drizzle/0016_budget_meter_functions.sql:339-367`
**Issue:** `budget_periods` is keyed `(org, provider, month)` and `app.set_budget_cap(p_provider, …)` edits one row. The cap form is hard-wired `provider="places"`, the shell banner, `/spend` header and `/settings/budget` gauge all read `getCurrentPeriod(claims, 'places')`, and `ensure_budget_period` lazily creates `firecrawl` and `anthropic` rows at the $50 default. `BUDGET_CAP_HELP` tells the admin the number "applies to Places, Firecrawl and Anthropic together". D-13 says one cap; PROJECT says "< $50/month data spend (Places + Firecrawl) enforced as an atomic reservation cap". As built, the enforced monthly ceiling is $50 × 3 and the banner never sees the other two providers' spend. Not money-losing in Phase 2 (only `places` reserves), but the first Firecrawl reservation in Phase 5 will be metered against a $50 row nobody set and nobody displays.
**Fix:** Pick one and make the copy match. Either (a) one cap: `setBudgetCap` sets all three provider rows inside one `withOrg` and the banner/header/gauge aggregate the three periods (`sum(spent)`, `sum(reserved)`, `min(cap)` or a single shared cap); or (b) per-provider caps: the settings screen renders three inputs and `BUDGET_CAP_HELP` stops claiming "together". Until then change the copy to "Applies to Places. Firecrawl and Anthropic are metered separately from Phase 5."

### WR-03: `app.settle_reservation` trusts caller-supplied `p_provider`/`p_sku`, and a late settle after self-heal can abort and lose the ledger row

**File:** `drizzle/0016_budget_meter_functions.sql:259-320`
**Issue:** Two gaps in the one definer that writes the ledger. (1) `p_provider` and `p_sku` are written to `cost_ledger` verbatim without being compared to the reservation's `sku` or the period's `provider`. `readUnitsUsedThisPeriod` filters by `sku`, so a mismatched sku makes the free-allowance derivation wrong; `cost_ledger.provider` is BUDG-01's external contract and can disagree with the period it points at. (2) The `v_hold = 0` branch (reservation already released by self-heal) adds `p_actual_micro` to `spent` with no hold to offset. If the freed budget was re-reserved in between, `spent + reserved > cap` → `bp_not_over` raises `23514`, the whole function aborts, and the ledger row for a call Google really billed is lost — exactly the "a green suite proves nothing" shape the module header warns about, and the meter then under-reports actual spend.
**Fix:**
```sql
-- derive, never accept:
select r.org_id, r.budget_period_id, r.est_micro_usd, r.run_id, r.settled_at, r.released_at, r.sku, b.provider
  into v_res_org, v_period, v_est, v_run, v_settled, v_released, v_sku, v_provider
  from cost_reservations r join budget_periods b on b.id = r.budget_period_id
 where r.id = p_reservation;
if p_sku is distinct from v_sku or p_provider is distinct from v_provider then
  raise exception 'settle_reservation: sku/provider do not match the reservation' using errcode = '22023';
end if;
```
For (2), the ledger row must survive: wrap the `budget_periods` update in `begin … exception when check_violation then perform app.emit_event('budget_periods', v_period, 'budget_overrun', jsonb_build_object('micro_usd', p_actual_micro, 'reservation_id', p_reservation)); end;` so the spend is recorded and the overrun is audited rather than silently dropped. Add `budget-meter.test.ts` › "settle after release does not lose the ledger row".

### WR-04: `app.reserve_budget` accepts a `p_run` from any org

**File:** `drizzle/0016_budget_meter_functions.sql:138-204`
**Issue:** The definer inserts `cost_reservations.run_id = p_run` as the owner; RLS does not apply to the insert and the FK to `runs` bypasses RLS, so a caller can attach a reservation (and, through it, a ledger row) to another tenant's run id. `readSpendByRun` joins `cost_ledger` under the victim's RLS so the victim does not see it, but a definer that takes a foreign key without re-checking tenancy is the T-2-10 shape `settle_reservation` explicitly guards against for reservations.
**Fix:**
```sql
if p_run is not null and not exists (select 1 from runs where id = p_run and org_id = v_org) then
  raise exception 'reserve_budget: run belongs to another org or does not exist' using errcode = '22023';
end if;
```

### WR-05: A stale `estimateSnapshot` from a previous selection is saved when the current one errored

**File:** `src/components/preset-editor/preset-form.tsx:181-185`, `src/components/preset-editor/use-live-estimate.ts:82-91`
**Issue:** The hook keeps the last good `estimate` when a recompute fails (correct for display) and sets `settledKey = key` on the error branch, so `busy` is `false`. `onSubmit` then sends `estimateSnapshot: estimate` — the range priced for a *different* spec — and `savePresetVersion` stores it verbatim as this version's quote (`estimateRangeSchema` validates shape only). The card reads "Est. ~$X" for a preset that was never priced at X. Independently: the snapshot is client-authored data stored as "what the estimator quoted"; the client can send any numbers.
**Fix:** Drop the client-supplied snapshot. `savePresetVersion` already resolves the spec, reads the period and units inside its transaction — compute the snapshot there exactly as `estimate-preset.ts` does and store `toStoredEstimate(range)` (or `null` when `computeEstimate` throws). Remove `estimateSnapshot` from `saveInputSchema`.

### WR-06: The estimate panel keeps showing the previous dollar figure after the selection stops being estimable

**File:** `src/components/preset-editor/estimate-panel.tsx:63-82`, `src/components/preset-editor/use-live-estimate.ts:66-98`
**Issue:** When the user unchecks the last cluster (or clears the geography) `spec` becomes `null`, the hook's `key` is `null`, `busy` is `false`, and `estimate` is left as it was. The panel renders the prompt only when `estimate === null`, so the stale "~$21.42" stays on screen at full opacity with no spinner and no prompt, for a preset that now has nothing to search for. Executor Rule 11 covers *recomputing*, not "nothing to compute". `stale-estimate.test.tsx` › "no cluster selected renders the prompt" starts from `null` and cannot see this transition.
**Fix:** In `useLiveEstimate`, when `key === null` reset: `setEstimate(null); setError(null); setSettledKey(null);` inside the effect (guarded so it runs once per transition). Add a test that renders `SPEC_A`, waits for the figure, rerenders with `null`, and asserts the prompt is shown and the figure is gone.

### WR-07: `readPreset`/`readPresets` declare `Date` for timestamps that arrive as strings

**File:** `src/server/queries/presets.ts:445,457,466,495,510,524,542,566-573`
**Issue:** `budget.ts` and `preset-cards.ts` both document (and fix) that drizzle's postgres-js driver disables date parsing, so a `timestamptz` out of `tx.execute` is a string. `presets.ts` still types `updated_at`/`created_at` as `Date` and passes them through. The detail page works only because it wraps every one in its own local `instantOf`; the edit page, `listPresets`, and any future consumer that calls `formatLocal(preset.updatedAt, …)` will throw `RangeError: Invalid time value` with typecheck, lint and build green — the exact class already recorded twice in this phase.
**Fix:** Normalise at the boundary, once, the way `budget.ts` does:
```sql
(extract(epoch from v.created_at) * 1000)::bigint::text as created_ms
```
convert with an `instantOf` in the query module, and delete the page-level copy in `presets/[id]/page.tsx:156-168`.

### WR-08: `/presets/[id]/edit` does not validate the id and 500s on a malformed URL

**File:** `src/app/(app)/presets/[id]/edit/page.tsx:32-38`
**Issue:** The detail page guards `id` with a UUID regex before `where id = ${id}` because Postgres answers a malformed uuid with `22P02`, which surfaces as a 500. The edit page skips that guard and calls `getPreset(claims, id)` directly, so `/presets/not-a-uuid/edit` is a crash where the sibling route is a 404.
**Fix:** Move the `UUID` regex to a shared helper (e.g. `src/lib/ids.ts`) and call `if (!UUID.test(id)) notFound();` in both pages.

### WR-09: `spend.spec.ts` › "lists a queued run" can never execute — its locator and its testid are both wrong, and it reads as a pass

**File:** `tests/e2e/spend.spec.ts:94-119`
**Issue:** `presetLink = page.locator('[data-testid^="preset-card-"] a, a[href^="/presets/"]').first()`. The card **is** the anchor (`preset-card.tsx:44-52`), so the first alternative matches nothing; the second matches `href="/presets/new"` on the header Create-preset CTA, which precedes the cards in DOM order. The click lands on `/presets/new`, where neither `run-confirm` nor the probe hook exists, so `test.skip(…)` fires. Even on the right page the probe testid `preset-run-cta` does not exist anywhere in `src/` — the trigger 02-12 shipped is `run-preset` (`presets/[id]/page.tsx:368`) — so the drawer is never opened and `run-confirm` (mounted only while open) is always count 0. The header's own warning ("if 02-12 names its trigger something this probe does not find, the skip persists silently") came true; the gate's "15 passed, 6 skipped" includes it.
**Fix:**
```ts
const card = page.locator('[data-testid^="preset-card-"]').first();
test.skip((await card.count()) === 0, 'no preset to run');
await card.click();
await page.getByTestId('run-preset').click();
const confirm = page.getByTestId('run-confirm');
await expect(confirm).toBeVisible();
```
delete the "ships in plan 02-12" skip, and assert the run row on `/spend` by the preset's `data-preset-name`, not `h1`. Note this will queue one real reservation per CI push against production (1 µUSD while inside the free tier, more after) — teardown or a `finished`-marking path is owed alongside the deferred `e2e-*` row cleanup.

## Info

### IN-01: Schema comments cite the wrong migration file

**File:** `src/db/schema/budget.ts:39,105`
**Issue:** Both comments name `drizzle/0014_budget_grants_and_triggers.sql`; the grants/triggers live in `0015_budget_grants_and_triggers.sql` (0014 is the generated table DDL).
**Fix:** Correct the two references.

### IN-02: `version-history.tsx` restates `Copy of {name}` instead of importing `COPY_OF`

**File:** `src/components/preset-detail/version-history.tsx:167`, `src/components/preset-detail/duplicate-dialog.tsx:99`
**Issue:** The dialog omits `displayName` only when the field equals `defaultName`; if `COPY_OF` in `copy.ts` ever changes, the client default and the server default diverge and every "unchanged" duplicate is sent with the old string as an explicit name.
**Fix:** `defaultName={COPY_OF(context.presetName)}`.

### IN-03: Renaming a preset updates `display_name` but leaves `name_internal` at the original name

**File:** `src/server/actions/save-preset-version.ts:171-175`
**Issue:** The two columns "start equal and a later phase may diverge them"; this path diverges them silently now. Nothing renders `name_internal`, so no leak, but the internal label stops meaning anything.
**Fix:** Update both until an internal-label UI exists, or document the intended divergence.

### IN-04: Four actions hand-build claims without `org_role` although `orgClaims()` exists

**File:** `src/server/actions/duplicate-preset.ts:45`, `save-preset-version.ts:81`, `queue-run.ts:61`, `estimate-preset.ts:41`
**Issue:** `set-budget-cap.ts` learned the hard way that a definer reading `app.current_org_role()` refuses an admin when the claims carry no role. These four build `{ o, sub, role }` by hand; the next role-gated definer on any of these paths repeats plan 02-13 deviation 2.
**Fix:** `const claims = await orgClaims();` in all four (it calls `requireOrg()` first, so T-2-01 ordering is preserved).

### IN-05: `queueRun` computes the period twice from two `new Date()` calls

**File:** `src/server/actions/queue-run.ts:67,101`
**Issue:** `period = periodStart(new Date())` at the top and `readCurrentPeriod(tx, 'places')` (its own `new Date()`) inside can straddle local midnight on the 1st and ensure/reserve against different months.
**Fix:** `const now = new Date();` once; pass it to `readCurrentPeriod(tx, 'places', now)`.

### IN-06: `cost_ledger.request_id` is unique globally, not per org

**File:** `drizzle/0014_brown_phantom_reporter.sql:34`, `drizzle/0016_budget_meter_functions.sql:301-310`
**Issue:** A request id reused across orgs makes the second org's settle return `false` and move nothing — a silent lost settlement. Harmless if Phase 4 generates UUID request ids; a footgun otherwise.
**Fix:** `unique (org_id, request_id)` and `on conflict (org_id, request_id) do nothing`.

### IN-07: "calls" counts ledger rows while the allowance sums `units`

**File:** `src/server/queries/budget.ts:192,237,350`
**Issue:** `readUnitsUsedThisPeriod` sums `units` and its comment says one row can carry more than one; `readSpendByProvider`/`readSpendByRun` report `calls = count(l.id)`. The two disagree the first time `p_units > 1`.
**Fix:** Report `coalesce(sum(l.units), 0)` as calls, or constrain `units = 1` and drop the comment.

### IN-08: Two definitions of "run this month"

**File:** `src/server/queries/budget.ts:356-357`, `src/server/queries/preset-cards.ts:165-168`
**Issue:** `/spend` windows on `r.created_at`; the preset list windows on `coalesce(r.started_at, r.created_at)`. A run created on the 30th and started on the 1st is in one month on one screen and the next on the other.
**Fix:** Pick one expression and put it in one SQL fragment both queries import.

### IN-09: `docs/deploy.md` "live deployment" table is stale

**File:** `docs/deploy.md:257-268`
**Issue:** "Verified commit `6d6c52f`" while the reviewed HEAD is `16399bc`; the table is presented as the current state.
**Fix:** Update on each production deploy, or reword the heading to "last verified".

### IN-10: The assumptions Popover is closed by dispatching a synthetic Escape keydown

**File:** `src/components/preset-editor/assumptions-surface.tsx:188-205`
**Issue:** Works because Radix listens for `keydown` on the document, but it couples the component to an undocumented implementation detail and will silently stop closing if Radix changes its listener target.
**Fix:** Control the popover: `const [open, setOpen] = useState(false); <Popover open={open} onOpenChange={setOpen}>` and `onClick={() => setOpen(false)}`.

---

_Reviewed: 2026-09-22T19:04:51Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

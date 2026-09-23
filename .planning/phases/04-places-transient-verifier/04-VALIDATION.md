---
phase: 4
slug: places-transient-verifier
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-23
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source of truth for the requirement → test map and the gate mutations: `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@5.0.1` (unit + DB lanes) · **new** workflow lane with `@workflow/vitest@4.0.25` · `@playwright/test@1.63.0` e2e |
| **Config file** | `vitest.config.ts`, `vitest.db.config.ts`, **new `vitest.workflow.config.ts`** (Wave 0) |
| **Quick run command** | `cd /c/Users/danlo/prospector && $PNPM test:unit -t "<name>"` (never the `-- -t` form — it does not filter under pnpm 12) |
| **Full suite command** | `typecheck` · `lint` · `test:unit` · `test:db` · `test:workflow` · `build`, each via `$PNPM` |
| **Estimated runtime** | unit ~30 s · db ~3 min · workflow ~1 min · build ~2 min |

`$PNPM` = `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs`

**Test layering (measured in the research spike):**
1. Pure modules (builder, tiler, host class, matcher, partition, change detection, estimate) → unit lane.
2. Step bodies → DB lane, called as plain functions inside a rolled-back transaction, msw for Places.
3. Orchestration → workflow lane: real compiled workflow, msw for Places (msw intercepts in-process), real local DB with a dedicated test org. `vi.mock` of `@/` modules does NOT reach step code.

---

## Sampling Rate

- **After every task commit:** the quick unit filter for the touched module + `typecheck`
- **After every plan wave:** `test:unit`, `test:db`, `test:workflow`, `typecheck`, `lint`, **`build`** (the build generates `.well-known/workflow` and proves registration)
- **Before `/gsd-verify-work`:** full suite green + mutations M26–M53 logged in `docs/measurements/04-gate-mutations.md`
- **Max feedback latency:** 60 seconds for the quick filter
- 🔴 Read the failing test's **name** on every filtered run — a `-t` that matches nothing exits green.

---

## Per-Task Verification Map

*Filled by the planner from each PLAN's `<automated>` verify blocks; requirement-level map is in `04-RESEARCH.md` § Phase Requirements → Test Map.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (planner) | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Gate Mutations (M26–M53)

Listed verbatim in `04-RESEARCH.md` § Gate mutations. Each: apply, run the named test, confirm it goes red **by name**, revert, `git diff` clean.

---

## Wave 0 Requirements

- [ ] Install `workflow@4.8.9`, `@workflow/vitest@4.0.25`; `allowBuilds` entries for `@swc/core`, `cbor-extract`; prove `install --frozen-lockfile` + `build`
- [ ] `next.config.ts` → `withWorkflow`; `proxy.ts` matcher excludes workflow internals; ignore `src/app/.well-known/workflow/**` in `.gitignore`/`.prettierignore`/ESLint and in the source-walking tests (`field-mask-tier`, `no-network`, `no-google-credential`)
- [ ] `vitest.workflow.config.ts` + `test:workflow` script + CI step in the `db` job
- [ ] msw Places handler (RegExp path — a string path containing `places:searchText` is parsed as a route param) + **anonymized** synthetic fixtures (D-20) with a sidecar marker: 3-page saturated set, empty tile, SAB listing, `business.site` listing, tie pair, daily-quota 429, per-minute 429, 400 `INVALID_ARGUMENT`, 503
- [ ] `src/lib/places/place-types.ts` Table A snapshot; geo-shapes seed + desk fetch script
- [ ] DB fixtures for the new tables; worker/cron-role savepoint doubles for the DB lane
- [ ] `clusters.json`: remove `general_contractor` (test watched red first)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Legal checkpoint recorded before the first real call | D-01 | Human decision (counsel or danlo's written call) | PROJECT.md Key Decisions entry enumerating everything that persists (D-05, D-10, D-13, D-20, D-21) |
| GCP project, Places API (New), billing, 100/day quota, API-restricted key | BUDG-03 / D-03 | danlo clicks in the GCP console | Runbook `docs/runbooks/google-quota.md`; Claude verifies with one free IDs-only call |
| First real run (one city × one cluster) proves saturation, subdivision, SAB inclusion, TTL purge on real density | D-04 / PLACE-03/05 | Needs the real key + legal gate | Run from the deployed app; inspect the run report and `/sources` Places row |
| First invoice confirms per-`pageToken` billing | Pricing assumption (MEDIUM) | Billing data only | Compare GCP billing SKU counts to the ledger |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

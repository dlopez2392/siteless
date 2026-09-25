---
phase: 04-places-transient-verifier
plan: 31
subsystem: budget / Google Cloud second wall / Places key
tags: [budget, google-cloud, quota, places-api-new, api-key, BUDG-03]
requires:
  - 04-19 (the recorder's `--ids-only` single-call mode and its three guards)
  - 04-29 (D-01 row in PROJECT.md Key Decisions: danlo-risk-call)
  - 04-30 (production migrated to journal 30, deployed with PLACES_MODE unset)
provides:
  - Google Cloud project `siteless` (id siteless-509611) with Places API (New) enabled, billing attached, per-method daily quotas set
  - GOOGLE_PLACES_API_KEY in .env.local and in Vercel Production (Sensitive); PLACES_MODE set nowhere
  - GOOGLE_QUOTA_SET_ON = '2026-09-24', so the second-wall card renders its "set" state
  - BUDG-03 closed (REQUIREMENTS.md [x], traceability Phase 4 | Complete)
  - the first real Google response through the product's own meter and client (local DB, $0)
affects:
  - docs/runbooks/google-quota.md (recorded-setup table, per-method console path)
  - /settings/budget second-wall card (after the deferred deploy)
tech-stack:
  added: []
  patterns:
    - "The key is checked by exit code or length only; the recorder's output was checked for the key's text by exit code before it was displayed"
key-files:
  created:
    - .planning/phases/04-places-transient-verifier/04-31-SUMMARY.md
  modified:
    - src/lib/budget/second-wall.ts
    - src/components/budget/second-wall-card.tsx
    - src/lib/ui/copy.ts
    - tests/unit/second-wall-card.test.tsx
    - docs/runbooks/google-quota.md
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
decisions:
  - "D-03 done 2026-09-24: quota=100 restricted=places-api-new. Quotas are per method: SearchTextRequest per day = 100 and every other Places method per day = 0. The key is Google's auto-created one, renamed siteless-places-server."
  - "The second-wall card's set-state copy now names the per-method metric (SearchTextRequest per day = 100, every other Places method per day = 0). The console has no single 'Requests per day' row."
  - "The verification call ran against a new local preset (McAllen x home_services). The existing local presets were e2e fixtures covering Alamo and Brownsville."
  - "The deploy step is deferred. The branch needs prod migrations 0030 and 0031 first (local is at journal 32, prod at 30)."
metrics:
  duration: "Task 1 on 2026-09-23; Task 2 (human) 2026-09-24; Task 3 ~25 min on 2026-09-24"
  completed: 2026-09-24
  tasks: 3
  files: 7
---

# Phase 4 Plan 31: D-03 Google Cloud setup, one metered key check, BUDG-03 closed (Summary)

**What this plan did:** danlo's Google Cloud project `siteless-509611` now has a 100/day quota on Places Text Search and 0/day on every other Places method. The key is restricted to Places API (New). One free IDs-only Text Search went through the product's own meter against the local database. It returned ok with 20 ids and a next-page token, and it was ledgered as `ts_essentials`, 1 unit, $0. BUDG-03 is closed. The production deploy is deferred until migrations 0030 and 0031 are on production.

## Task 1: Runbook steps and the card's "set" state (done earlier)

- `c71823f` test(04-31): failing tests for the second-wall card's set state
- `964feb7` feat(04-31): D-03 setup runbook and the second-wall card's set state

## Task 2: danlo's Google Cloud setup (human-action, done 2026-09-24)

Resume signal equivalent: `done 2026-09-24 quota=100 restricted=places-api-new`.

At danlo's request the orchestrator did the console work in the browser. danlo copied the key himself.

- Project `siteless`, id `siteless-509611`, in org `danlopez508-org`, with billing attached. The billing account was at its 5-project cap. At danlo's instruction, billing was disabled on two unused projects to free a slot.
- Places API (New) is enabled.
- The quotas are **per method**. There is no single "Requests per day" row.
  - `SearchTextRequest per day` = **100** (was 75,000).
  - `AutocompletePlaces`, `GetPhotoMedia`, `GetPlace`, `SearchMedia`, `SearchNearby` and `SearchReviewPosts` per day = **0**.
  - `SearchTextRequest per minute` stays at 600.
- Key `siteless-places-server`: Google auto-created it and it was renamed. It is API-restricted to Places API (New) only, has no application restriction, and is the only key in the project.
- The key is stored in `.env.local` and in Vercel Production (Sensitive). PLACES_MODE is not set anywhere.

## Task 3: Verify, record, close

1. **Key presence (exit codes only).**
   - dotenv check on `.env.local`: `GOOGLE_PLACES_API_KEY` present → exit 0. Length 39 → exit 0.
   - `vercel env ls production --scope team_8zjV46sJxQDsVzikNQa1JaO2`: `GOOGLE_PLACES_API_KEY` listed once (Encrypted, Production). `PLACES_MODE` count is 0.
   - `.env.local` has no `PLACES_MODE` line.
2. **Local preset.** No local preset covered McAllen. All 18 local searches were `e2e-*` fixtures (home_services + food_hospitality, over Alamo + Brownsville, a county, or a radius). I created one locally with the same owner-connection insert shape the db tests use: searches row, then version 1, then `current_version_id`, all in one transaction, with `app.actor_id = 'script:04-31'`.
   - Org `org_3Jf2trxDQzIC3yX4sgZki3kE3ky`.
   - Search `6f8eb2df-a9de-4271-b26a-19acb97a316f` ("McAllen home services").
   - Version `017002f5-4a51-4261-9fbb-a19a0fd050bd`: cluster home_services, geo `cities` = [McAllen].
3. **The single metered call**, run once:
   `node --conditions=react-server --import tsx scripts/record-places-fixtures.ts --ids-only --max-requests=1 --version=017002f5-… --type=plumber --unit=city:48215/McAllen`
   - Guards passed: the D-01 row was present and both DB URLs were local.
   - Before the output was displayed, it was checked by exit code for the key's text. The key was absent.
   - Output: `run f46bb1ff-cf3a-45fa-9418-caa22e072eff (change_check, ids-only) · tile city:48215/McAllen|plumber|r · cap 1 request(s)`, then `outcome ok · 1 request(s) · 20 id(s) · 1 page(s) · stopped by the cap with a next page offered`, then `ledger 1 row(s) [ts_essentials] · cost $0.0000`, then `no fixture written`.
   - **HTTP status:** 2xx. The recorder prints a status only for a failed response, and `ok` requires `response.ok` (src/lib/places/client.ts L109) plus a schema-valid parse.
   - **Page parsed:** yes, 1 page with **20 ids**.
   - **nextPageToken:** **yes**. The cap stopped the run with a next page offered.
   - No Google text was recorded. The IDs-only mask returns place ids only, and no fixture was written.
   - **Local `cost_ledger` row:** `46309848-c544-422b-aca6-41b16352df18`, provider `places`, **sku `ts_essentials`, units 1, micro_usd 0**, cost_cents 0.00, run `f46bb1ff-…`, reservation `2ef43af4-…`. Run row: status `complete`, kind `change_check`, ceiling_requests 1.
   - This was the only Google request made in this task.
4. **`GOOGLE_QUOTA_SET_ON = '2026-09-24'`** is in `src/lib/budget/second-wall.ts`. `vitest -t "the second wall"`: 3 passed, 2 skipped by the filter. The full file: 5/5.
5. **Runbook:** new "Recorded setup — 2026-09-24" table with the project id, the per-method quotas, the key and the verification call. Step 4 and the console path now say the quotas are per method. Step 5 notes the auto-created key. The "names only" note now allows the project id, since it is an identifier and not a credential.
6. **BUDG-03 closed:**
   - REQUIREMENTS.md: `[x] **BUDG-03**`, traceability row `| BUDG-03 | Phase 4 | Complete |`.
   - STATE.md: removed the "UNSET" blocker line. Replaced the "BUDG-03 stays OPEN" decision with the plan's closing line. Added a blocker entry saying the deploy is deferred.
7. **Deploy: DEFERRED (not done).** The branch contains review fixes that need migrations 0030 and 0031. Those are applied to the LOCAL database only (journal 32); production is at journal 30. Deploying this code first would break /sources and the writers. The orchestrator will bundle "prod migrate 0030+0031 → deploy → smoke" behind danlo's explicit approval. Until that happens, production still renders the "not set yet" second-wall card. Nothing was pushed or deployed, and production was not touched: `vercel env ls` was the only production read.

**Gate:** Run on the tree that was committed as `24cf57c`, with branch `gsd/phase-04-places-transient-verifier` and HEAD `7eba6e2` before that commit.
- `tsc --noEmit` exit 0
- `eslint . --ignore-pattern ".claude/**"` exit 0
- unit lane: 84 files, 671 tests, all passed
- second-wall `-t`: 3 passed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The set-state card named a quota metric that does not exist**
- **Found during:** Task 3
- **Issue:** `SECOND_WALL_SET_BODY` said "Places API (New) → Requests per day = 100". The console has no such row: Places API (New) quotas are per method. The card is meant to record what a human actually set, so it was wrong.
- **Fix:** The copy now reads "SearchTextRequest per day = {n}, every other Places method per day = 0". The doc comment on `GOOGLE_QUOTA_REQUESTS_PER_DAY` was updated to match, and the two test assertions that pinned the old wording were updated.
- **Files modified:** src/lib/ui/copy.ts, src/lib/budget/second-wall.ts, tests/unit/second-wall-card.test.tsx
- **Commit:** 24cf57c

**2. [Scope, per orchestrator] Deploy step not executed.** See Task 3 step 7.

**3. [Rule 3 - Blocking] No local McAllen preset existed**, so one was created locally (see Task 3 step 2). Only local data changed; there was no code change.

## Known Stubs

None.

## Threat Flags

None. The key was never printed. The one call was IDs-only, went through the meter, used the local DB, and was gated by D-01.

## Self-Check: PASSED

- FOUND: src/lib/budget/second-wall.ts (GOOGLE_QUOTA_SET_ON = '2026-09-24')
- FOUND: docs/runbooks/google-quota.md ("Application restrictions", "siteless-509611", "SearchTextRequest per day")
- FOUND commits: c71823f, 964feb7, 24cf57c

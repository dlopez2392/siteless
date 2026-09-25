# 04 — The first real Places run (D-04)

**Venue:** LOCAL (`next start` against the local spine, ~92k businesses, Clerk dev org "BIS"),
`PLACES_MODE=enterprise` set only in `.env.local` for the run and removed afterwards.
danlo chose it at 04-32 Task 1 (2026-09-24): "Local", post-run mode `off`, banner specs re-deferred.
**Cell:** McAllen × home services (search version `017002f5-4a51-4261-9fbb-a19a0fd050bd`).
**Run:** `6a30dc3b-f7ca-499d-b320-c70217c64612`, started by danlo from the preset page, 2026-09-25
10:05:06Z → 10:06:28Z (**82 s**), status **complete**, no stop reason. danlo watched the report and
replied `approved`.

All figures below were read from the local database in one `begin read only` transaction after the run.

## Requests and money

| Measure | Value |
|---|---|
| Estimate (D-18, type-aware) | 6 low · **54 high** · ceiling 108 |
| Requests made (`runs.calls_count`) | **33** (61 % of the high estimate) |
| Ledger rows for the run | **33** — equal to `calls_count`; 33 distinct request ids |
| SKU / units | every row `ts_enterprise`, `units = 1` |
| Cost | **$0.00** (inside the month's free 1,000 Enterprise requests) |
| Reservations left open | **0** (every hold settled or released) |

**Fixture recording (04-32 Task 2), before the run:** 2 `ts_enterprise` requests through
`record:places` against the LOCAL ledger (run `7253d834…`, $0.00). With 04-31's single free IDs-only
call, the Google project has seen **36 requests in total, 35 of them Enterprise** — the number the
first invoice should reconcile against (none of them is in the production ledger).

## Tiling on real RGV density

| Measure | Value |
|---|---|
| Searches planned and done | 22 / 22 (`done`) |
| Pages fetched | 33 |
| Results returned (with overlap) | 457 |
| Distinct place ids | 270 |
| Saturated tiles (60 results) | **4**, all subdivided |
| Deepest tile | depth **2** (`MAX_DEPTH` = 5) |
| Truncated tiles | **0** |

| Places type | Searches | Results | Saturated | Depth |
|---|---|---|---|---|
| electrician | 5 | 94 | yes | 1 |
| locksmith | 1 | 34 | no | 0 |
| moving_company | 9 | 184 | yes | 2 |
| painter | 1 | 19 | no | 0 |
| plumber | 1 | 33 | no | 0 |
| roofing_contractor | 5 | 93 | yes | 1 |

Saturation is real in McAllen (3 of 6 types) but shallow: every saturated root resolved within two
levels, nothing hit `MIN_TILE_SIDE_M` or `MAX_DEPTH`, and no tile was left truncated.

## Matching and signals (home services)

| Outcome (per distinct place) | Count |
|---|---|
| attached (≥ 95) | **96** |
| tentative (80–95, review) | **25** |
| unmatched (< 80; place id + tile membership only) | **149** (55 % — the cluster's gap count) |

- `place_attachments` rows: 96 attached, 27 tentative (two places are tentative against two
  businesses each — the many-candidates case the review queue resolves).
- Observations: **123** (one per attachment), over 121 distinct places.
- **`pure_sab` observations: 9.** Service-area businesses ARE returned under `locationRestriction`
  and DO match on real phone + name — research **A6 answered yes** on real data. (The anonymized
  replay cannot show this: its 555-01xx phones never match, so the replay test pins 0.)
- Coordinates: 114 rows (123 − 9 SABs, which carry no location); `expires_at − observed_at` is
  exactly **30 days** for every row (min = max).
- Website signal: `had_website_uri` true on 102 of 123.

| Derived host class | Observations |
|---|---|
| other (a real domain) | 101 |
| none (no `websiteUri`) | **21** |
| platform_subdomain | 1 |

The 21 `none` observations are this cell's first real "no website per Google" candidates — Phase 5
verifies them; nothing here is a verdict.

## Daily quota headroom (D-19)

The GCP quota is **100 Text Search requests per day** (Pacific day). The run used 33 on 2026-09-25
(PT); the recording and 04-31's check (3) fell on 2026-09-24 (PT). One McAllen-sized cell fits
three times a day; the D-18 full RGV sweep (~3,978 requests high) would take ~40 quota-days and
cross the free 1,000 in the first month.

## Proposals for danlo (NOT applied)

1. **Tiling constants: no change proposed.** Zero truncation, depth ≤ 2 against a ceiling of 5.
   Revisit on the first dense-core cell (Brownsville or a food cluster) before touching
   `MAX_DEPTH`, `MIN_TILE_SIDE_M` or `NOVELTY_MAX_OVERLAP`.
2. **Estimator:** the high bound (54) held with 39 % headroom; the ceiling (108) was never near.
   Keep it; re-measure on a food & hospitality cell, where density is higher.
3. **Daily quota (D-19's deferred decision): keep 100/day for Phase 4–6.** Raising it only matters
   once the Phase 9 scheduler sweeps partitions; size it then from the partition plan, not now.
4. **Research A1/A2 (per-page and error-response billing):** reconcile the first invoice against
   35 Enterprise + 1 Essentials requests (see above).

## Kill switch restored

`PLACES_MODE` removed from `.env.local` (defaults to `off`); the local `next start` (PID 93712,
command line checked) was stopped. Production never had `PLACES_MODE` set during Phase 4 and still
runs with it `off`.

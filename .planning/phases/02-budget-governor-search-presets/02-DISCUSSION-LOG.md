# Phase 2: Budget Governor & Search Presets - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-22
**Phase:** 2-budget-governor-search-presets
**Areas discussed:** Geography & cluster input, Cost estimate & result count, Cap policy & threshold behaviour, Preset versioning UX
**Mode:** batched (four questions per area in one prompt) because the session's context was at 66% when the discussion started; every option below was presented with the recommended choice marked.

---

## Geography & cluster input

| Option | Description | Selected |
|--------|-------------|----------|
| All three now | City-list picker, county picker, radius around a geocoded address | ✓ |
| City list + county now, radius later | Defer radius | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| US Census Geocoder, free | No key, US-only, outside the paid ledger | ✓ |
| Google Geocoding API, billable | $5/1k through the ledger; needs the not-yet-created GCP key | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| 4 clusters, atomic | Types/NAICS inside a cluster are seed data | ✓ |
| Clusters with per-type toggles | Exclude individual Places types per preset | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Seeded "Texas (254 counties)" geo preset | Built-in row; estimate shows the multiple vs RGV | ✓ |
| County multi-select only | No built-in row | |
| You decide | | |

**User's choice:** all recommended options.
**Notes:** none.

---

## Cost estimate & result count

| Option | Description | Selected |
|--------|-------------|----------|
| Requests + dollars + expected results, vs remaining budget | Request counts make the Texas multiplier legible | ✓ |
| Dollars and expected results only | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Range with the assumptions visible | 1–3 pages per leg; fan-out multiplier as an editable committed constant until Phase 6 | ✓ |
| Single point estimate | Research's 3× overlap multiplier | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Live as you edit, debounced | Server action, no button, no paid calls | ✓ |
| On an explicit Estimate button | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| TX Comptroller outlet counts per county × NAICS | Seeded, measured, $0 | ✓ |
| Live Places IDs-only probe | Depends on the Google key and Phase 4 tiling | |
| You decide | | |

**User's choice:** all recommended options.
**Notes:** none.

---

## Cap policy & threshold behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Per org, editable in-app, default $50 | Admin budget settings screen; audited | ✓ |
| Config only (env var) | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Calendar month in America/Chicago | Local midnight on the 1st; zone + locale pinned | ✓ |
| Calendar month in UTC | | |
| Rolling 30 days | | |

| Option | Description | Selected |
|--------|-------------|----------|
| 80%: warning + event; 100%: refuse, clean partial stop | No email this phase | ✓ |
| Same plus email at 80%/100% | Adds an outbound email path | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| One cap, no separate allowance; view by provider and by run | | ✓ |
| Small hard-separated ad-hoc sub-cap | Two meters | |
| You decide | | |

**User's choice:** all recommended options.
**Notes:** none.

---

## Preset versioning UX

| Option | Description | Selected |
|--------|-------------|----------|
| Every saved edit creates a new version automatically | Immutable rows, moving current pointer, no drafts | ✓ |
| Explicit "Save as new version" with a draft | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Version list on the preset page with "used by N runs" | Shows the diff between versions | ✓ |
| Hidden; only a run shows its version | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, any version is re-runnable | Default Run uses current | ✓ |
| Only the current version runs | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Duplicate, from any version | New preset v1 named "Copy of …" | ✓ |
| Not in this phase | | |
| You decide | | |

**User's choice:** all recommended options.
**Notes:** none.

---

## Claude's Discretion

- Google Cloud daily quota value and its derivation; setting it is a human-action checkpoint because the GCP project does not exist yet
- Reserve → call → settle mechanics, reservation TTL and sweeper mechanism (pg_cron availability to be verified)
- `fieldMaskTier()` / SKU table as unit-tested pure functions that refuse unknown fields
- Exact table shapes and names; micro-USD vs cents storage
- Seed-data format and loader; the RGV 17-city list source; county × NAICS count refresh
- Which tables get row triggers vs `app.emit_event` (ledger volume, T-1-32)
- How much of `runs` lands in this phase

## Deferred Ideas

- Per-type toggles inside a cluster
- Email / outbound alerts at thresholds
- Separate hard-capped ad-hoc allowance
- Google Geocoding API as a fallback geocoder
- Preset archiving / soft delete
- Cost-per-verified-lead headline (BUDG-05)

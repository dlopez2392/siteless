# Phase 4: Places Transient Verifier - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 04-places-transient-verifier
**Areas discussed:** Legal gate & first call, Matching Places → spine, websiteUri → verification, How a run executes

---

## Legal gate & first call

| Option | Description | Selected |
|--------|-------------|----------|
| Build + test now, gate prod | Whole phase on recorded payloads; human-action checkpoint records counsel's answer or danlo's written call before the first real call; kill switch ships either way | ✓ |
| Hard block on counsel | No production Places call of any SKU until counsel answers | |
| My call, proceed | danlo's own risk decision recorded now; real calls during the phase | |

**User's choice:** Build + test now, gate prod

| Option | Description | Selected |
|--------|-------------|----------|
| Checkpoint, I click | Runbook human-action: project, Places API (New), billing, 100/day quota, key restricted to Places API (New); Claude verifies with one free IDs-Only call | ✓ |
| Browser-driven | Claude drives the Cloud console through Chrome while danlo approves | |
| Already have one | Reuse an existing GCP project / billing account | |

**User's choice:** Checkpoint, I click

| Option | Description | Selected |
|--------|-------------|----------|
| One city × one cluster | e.g. McAllen × home services, inside the 1,000 free Enterprise/month; records fixtures, proves saturation + SAB | ✓ |
| Record-only micro call | Minimal calls to capture fixtures only | |
| Full RGV partition | One real weekly partition across the RGV | |

**User's choice:** One city × one cluster

| Option | Description | Selected |
|--------|-------------|----------|
| Env var, deploy to change | `PLACES_MODE` = off / ids_only / enterprise, default off | ✓ |
| In-app admin toggle | Per-org audited setting | |
| Both, env wins | Env ceiling, in-app can only lower | |

**User's choice:** Env var, deploy to change

---

## Matching Places → spine

| Option | Description | Selected |
|--------|-------------|----------|
| ≥95 attach; 80–95 tentative | Tentative excluded from verdicts, confirmed in the review queue (spine side + chips only); <80 dropped + counted | ✓ |
| ≥95 only, rest dropped | Strictest; re-tried next run | |
| Lower bar for place_id | ≥80 with exact phone or ≤150 m | |

**User's choice:** ≥95 attach; 80–95 tentative

| Option | Description | Selected |
|--------|-------------|----------|
| Keep place_id, count the gap | place_id-only tile-membership record (needed for IDs-Only diffing); never a lead; per-cluster gap in the run report | ✓ |
| Discard entirely | Count only | |
| Google-only candidates | A lead source via live re-fetch — contradicts criterion 1; would be deferred | |

**User's choice:** Keep place_id, count the gap

| Option | Description | Selected |
|--------|-------------|----------|
| Phone + name, city as locality | Exact E.164 + name above bar reaches ≥95; no exact phone caps at tentative | ✓ |
| SABs always tentative | Every location-less match reviewed | |
| You decide | Planner picks, pinned by fixture | |

**User's choice:** Phone + name, city as locality

| Option | Description | Selected |
|--------|-------------|----------|
| Many→one OK, OR the boolean | Several place_ids per business; website true if any listing has one; one place_id tying two businesses → review | ✓ |
| Strict one-to-one | Best score wins, rest dropped | |
| You decide | Planner picks | |

**User's choice:** Many→one OK, OR the boolean

---

## websiteUri → verification

| Option | Description | Selected |
|--------|-------------|----------|
| Boolean + derived host class | String-match class at call time, URL discarded; amends PLACE-02; legal checkpoint covers it | ✓ |
| Boolean only (as written) | Narrowest exposure; Phase 5 rediscovers everything | |
| Ephemeral URL, short TTL | Raw URL held ~24 h for Phase 5 probes; most exposed | |

**User's choice:** Boolean + derived host class

| Option | Description | Selected |
|--------|-------------|----------|
| Append-only observations | One immutable row per (business, place_id, run); lat/lng with 30-day expires_at | ✓ |
| Latest value only | Overwrite on the attachment | |
| You decide | | |

**User's choice:** Append-only observations

| Option | Description | Selected |
|--------|-------------|----------|
| Inline with the signal | "No website listed · Google Maps · Sep 23" as a source tag; test pins it | ✓ |
| Footer block | Page-level attribution footer | |
| You decide | UI pass | |

**User's choice:** Inline with the signal

| Option | Description | Selected |
|--------|-------------|----------|
| /sources row + daily cron | Places row with held counts, oldest age, last purge; daily Vercel Cron; DB-level proof | ✓ |
| Purge at run start | No cron; breaches if no run for weeks | |
| You decide | Must not depend on a run | |

**User's choice:** /sources row + daily cron

---

## How a run executes

| Option | Description | Selected |
|--------|-------------|----------|
| In-app Run → Vercel Workflow | One step per (type × tile) request; resumable; Phase 9 reuses | ✓ |
| Desk script now, Workflow in Phase 9 | `tsx scripts/run-places.ts <runId>` | |
| Route handler (≤800 s) | No resumability | |

**User's choice:** In-app Run → Vercel Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Per-call reserve + 2× estimate ceiling | Just-in-time reservation per request; run stops `partial` past 2× estimate-high; committed constant | ✓ |
| Cap only | Only the monthly cap stops a run | |
| Hard stop at estimate | Stop exactly at estimate-high | |

**User's choice:** Per-call reserve + 2× estimate ceiling

| Option | Description | Selected |
|--------|-------------|----------|
| Full sweep + manual partition/detect | Run = full sweep; partition + IDs-Only detection built as functions with two manual preset actions | ✓ |
| Partition only | Run = this week's partition | |
| Full sweep only; partition in Phase 9 | PLACE-04 only partly closed | |

**User's choice:** Full sweep + manual partition/detect

| Option | Description | Selected |
|--------|-------------|----------|
| Live ledger-style report | Refreshing run page: SKU requests, cost vs estimate, tile saturation/truncation, match outcomes | ✓ |
| Summary after finish | Static report at the end | |
| You decide | UI pass | |

**User's choice:** Live ledger-style report

---

## Claude's Discretion

- Tiling geometry, minimum tile size / max depth, saturation test
- Query shape (`includedType` + strict filtering vs `textQuery`) inside one request-builder module
- Validating `clusters.json` `placesTypes` against Google's type table
- Schema shapes for attachments, observations, tile membership, run-tile progress
- Pagination pricing/reservation, retries, Workflow step idempotency
- API-key restriction details (API-restricted, server-only)
- How tentative attachments appear in `/review`
- IDs-Only mask and detection semantics for shrinking/growing tiles
- e2e fixtures for the run page and `/sources` Places row
- Whether to pick up the preset delete path + `presets.spec.ts` teardown

## Deferred Ideas

- Google-only candidates (unmatched Places results) as a lead source
- In-app `PLACES_MODE` toggle
- Scheduling partitions/detection (Phase 9)
- `business.site` → dead verdict and probing `other` URLs (Phase 5/6)
- Phase 3 follow-ups (chain amendment, resolve-pass performance, merged-into header)

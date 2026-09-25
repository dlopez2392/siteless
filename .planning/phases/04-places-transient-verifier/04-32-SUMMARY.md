---
phase: 04-places-transient-verifier
plan: 32
subsystem: Places first real run (D-04) / anonymized fixtures / production catch-up
tags: [places-api-new, D-04, D-20, fixtures, measurements, PLACE-02, PLACE-03, PLACE-04, PLACE-05]
requires:
  - 04-29 (D-01 danlo-risk-call; re-acknowledged here on the doc as of 96c20f4)
  - 04-30 (production at journal 30)
  - 04-31 (GCP key + 100/day quota; BUDG-03 closed)
provides:
  - production migrated 0030 + 0031 (journal 30 → 32) and redeployed from the branch at e7a059f, PLACES_MODE off
  - anonymized recorded fixtures (McAllen plumber, 2 pages) + a replay test through the tile search
  - the D-04 numbers in docs/measurements/04-first-run.md
affects:
  - .planning/PROJECT.md (D-01 row: re-acknowledgement)
  - tests/unit/msw/fixtures/ (recorded files, sidecar, README)
  - deferred-items.md (banner re-deferral, A1/A2 invoice check, A6 answered, quota)
key-files:
  created:
    - tests/unit/msw/fixtures/places-recorded-mcallen-plumber-p1.json
    - tests/unit/msw/fixtures/places-recorded-mcallen-plumber-p2.json
    - tests/db/places-recorded-replay.test.ts
    - docs/measurements/04-first-run.md
    - .planning/phases/04-places-transient-verifier/04-32-SUMMARY.md
  modified:
    - tests/unit/msw/fixtures/places-recordings.json
    - tests/unit/msw/fixtures/README.md
    - .planning/PROJECT.md
    - .planning/phases/04-places-transient-verifier/deferred-items.md
decisions:
  - "danlo, 2026-09-24 (verbatim picks): prod gate 'Apply + deploy (Recommended)'; D-01 'Re-acknowledge'; venue 'Local (Recommended)'; after the run 'off + re-defer (Recommended)'. Cell = McAllen × home services (default, not changed)."
  - "danlo, Task 3: 'approved'."
  - "No tiling constant changed; proposals only (docs/measurements/04-first-run.md)."
metrics:
  duration: "2026-09-24 evening → 2026-09-25 morning (local app reaped once for low memory before the run; restarted on danlo's 'start it')"
  completed: 2026-09-25
---

# 04-32 — The D-04 first real run

## Production catch-up (before the plan's tasks, danlo's gate)

- Read-only pre-flight (one `begin read only` tx, `transaction_read_only` on at start and end):
  journal 30 ending `0029` (created_at 1790195198325); `place_attachments` 0; `events` for
  place_attachments 0; attached-to-merged 0; `place_tiles` 0; open reservations 0; dependents of
  `app.places_transient_stats()` 0; `service_role` EXECUTE on it true (informational);
  `businesses` 0; no queued/running runs. Re-read immediately before the write: journal 30, branch
  and HEAD `e7a059f`, tree clean.
- `db:migrate:prod` → journal **32** (0030 + 0031 in one transaction). Separate read-only
  post-flight: the nine touched `app` functions all have `service_role` EXECUTE false and grants
  identical to local; `places_transient_stats` returns `oldest_expired_ms`; trigger
  `place_attachments_event_upd` on `app.log_place_attachment_event`; `pa_features_numeric`
  validated; `business_place_signal` present. Function bodies are **identical to local modulo line
  endings** (prod got CRLF from the Windows checkout; `diff --strip-trailing-cr` clean on all 9).
- Second `db:migrate:prod`: journal still 32 — no-op proven.
- `vercel deploy --prod` from the branch → `dpl_77jw8nu5MkDs3YUpasH481QXsYKi`, aliased to
  siteless-iota.vercel.app; `/api/health` commit `e7a059f99b57…` = HEAD; `/api/cron/purge-places`
  without the secret → 401. Deployed e2e: **22 passed / 10 skipped / 0 failed** (1.6 m).
  `PLACES_MODE` is not in Vercel Production (`vercel env ls production` count 0).
- Not smoked: the cron 200 path (the secret is Sensitive and not pullable; 04-30 proved it) and the
  settings second-wall card's "set" state (authenticated page).

## Task 1 — decision

Venue **local**, cell McAllen × home services, post-run `PLACES_MODE` **off**, banner specs
**re-deferred to the first billed month**.

## Task 2 — recording, replay test, venue

- `record:places --version=017002f5… --type=plumber --unit=city:48215/McAllen --max-requests=3
  --out=mcallen-plumber` against LOCAL: run `7253d834…`, outcome ok, **2 requests**, 33 ids,
  2 pages (20 + 13, root not saturated → no p3, no child quad), ledger 2 × `ts_enterprise`, $0.00.
  Structural inspection clean (synthetic names/addresses, `(956) 555-01NN` phones, synthetic hosts,
  rating 4 / count 10, synthetic locations); sidecar `anonymized: true`. Commit `db12ffe`.
- `tests/db/places-recorded-replay.test.ts` — `recorded fixtures replay through the tile search`
  (`b6827ff`), README subsection (`75e9560`). Full db lane 43 files / 405 tests (was 42 / 404).
  Mutations: serving only page 1 → RED by name; flipping one located place to SAB → RED by name;
  both reverted and diffed clean. Re-run independently by the orchestrator: green by name.
- **Deviation (plan text):** "a `pure_sab` observation exists iff the recording held a SAB" cannot
  hold for anonymized data — observations are written only for matched places, and a recorded SAB
  with a 555 phone and no address scores ≤ 50. The test pins `pure_sab` = matched SABs = 0; the
  SAB-true path stays covered by the synthetic test. The real run below shows 9.
- Venue: `PLACES_MODE=enterprise` appended to `.env.local`; `next build` (1 workflow, 9 steps);
  `next start` PID 65760 — **reaped by Claude Code for low system memory while idle**, before any run
  (local DB confirmed no sweep had started). Restarted on danlo's "start it" as PID 93712 with
  0.8 GB free.

## Task 3 — danlo ran it

danlo started "Run full sweep" from the preset and replied **`approved`**.

## Task 4 — verification (local DB, one read-only transaction)

Run `6a30dc3b-f7ca-499d-b320-c70217c64612`: complete, 82 s, **33 requests = 33 ledger rows**
(`ts_enterprise`, units 1, 33 distinct request ids, $0.00), 0 open reservations; 22/22 searches
done, 33 pages, 457 results / 270 distinct places, 4 saturated (all subdivided), max depth 2,
0 truncated; outcomes 96 attached / 25 tentative / 149 unmatched; **9 `pure_sab`**; 114 coordinates,
all expiring at exactly 30 days; host class other 101 / none 21 / platform_subdomain 1. Full
figures and proposals in `docs/measurements/04-first-run.md` (`9cd5f5d`).

Restored: `PLACES_MODE` line removed from `.env.local`; PID 93712 stopped after its command line was
checked (`next start -p 3000`); port 3000 free.

## Commits

| sha | message |
|---|---|
| `db12ffe` | test(04-32): record anonymized McAllen plumber pages; D-01 re-acknowledged |
| `b6827ff` | test(04-32): replay the anonymized McAllen plumber recording through the tile search |
| `75e9560` | docs(04-32): document the anonymized D-04 recording in the fixtures README |
| `9cd5f5d` | docs(04-32): measure the D-04 first real run (local, McAllen x home services) |

## Self-check

- [x] recorded file(s) with `anonymized: true`; recording requests 2 ≤ 6
- [x] replay test passes by name
- [x] venue prep recorded (local PIDs)
- [x] danlo's replies recorded
- [x] `calls_count` = ledger rows; SKU/units checked; no open reservation
- [x] measurements committed; constants proposed, not changed; `PLACES_MODE` restored

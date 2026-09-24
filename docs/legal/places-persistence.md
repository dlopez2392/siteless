# What Siteless persists from Google Places — the D-01 enumeration

**Purpose.** This is the list the D-01 legal call is made against (04-CONTEXT D-01): counsel's
answer, or danlo's own written risk call, on Google Maps Platform Terms §3.2.3(c) and
§3.2.3(d)(iii), **before the first real Places call of any SKU** — including 04-31's single free
IDs-only verification call. It is descriptive only. It records what the code and schema do; it
draws no legal conclusion.

**Generated 2026-09-23** on branch `gsd/phase-04-places-transient-verifier` @ `605e377`, from:

- `information_schema.columns` on the **local** test database (`siteless_test`, inside a
  `begin read only` transaction; drizzle journal at 30 entries, migrations through 0029), for the
  eight Places tables below — **115 columns**;
- cross-checked against `drizzle/0026_places_tables.sql` (the same 115 columns, table by table:
  16 + 14 + 10 + 22 + 10 + 26 + 9 + 8), `0027_places_grants_triggers.sql`,
  `0028_places_meter_retention.sql`, `0029_places_writers.sql`. No later migration adds a column to
  these tables;
- and the code paths named in each row.

**Revised 2026-09-23** @ `dc8e057` after two scope reductions (below). No schema change: the
column count was re-queried on the same local database, in a read-only transaction, and is still
**115** (16 + 14 + 10 + 22 + 10 + 26 + 9 + 8; drizzle journal still 30 entries).

**Changes before the decision (2026-09-23).** danlo approved both ("Go with your
recommendations") before the D-01 call was recorded. Each one narrows what this document
describes; neither adds anything.

- `53e5650` — **fix(04): stop requesting unused Places types/businessStatus.** Nothing in `src/`
  read either field. They are no longer in the field mask or the response schema. The anonymizer
  no longer keeps them, and every fixture check now refuses a file that carries either one.
- `dc8e057` — **fix(04): persist only integer match signals, not Google-derived
  nameSim/distanceM.** The matcher's two continuous inputs are now memory-only:
  - the name similarity to Google's `displayName`;
  - the metres to Google's `location`.

  `place_attachments.features` keeps only the scorer's integer points, its fixed enums and its
  0/1 flags (§1.1). The review card now labels a name or distance chip by its band instead of
  printing the figure (§5).

**Where things stand today.** No Places call of any SKU has been made. Nothing Places-derived exists
in any database. Production has `PLACES_MODE` unset, which is `off` (`src/env.ts`, D-02): `off`
refuses before any reservation, `ids_only` permits only the free IDs-only mask, `enterprise`
permits the full mask. Changing it takes a Vercel env edit plus a redeploy; there is no in-app
toggle. CI never calls Google. Every committed Places fixture is hand-written synthetic data
(`tests/unit/msw/fixtures/places-recordings.json`: `"synthetic": true, "anonymized": false`).

**Labels used below.**

| Label                          | Meaning                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| **Google — verbatim**          | A value Google returned, stored as returned                                             |
| **Google-derived — computed**  | Computed from a Google response at call time; the source value is discarded             |
| **ours**                       | Our keys, our timestamps, our query inputs, our enums, our counters — no Google content |
| **ours — count of a response** | Our counter, but its number depends on what Google returned                             |

---

## 1. Persisted, by table and column

Tenant access, for all eight tables: row-level security is on, scoped by `org_id`. The
`authenticated` role (every signed-in session) holds **SELECT only** on seven tables. INSERT, UPDATE
and DELETE are explicitly revoked (0027). Every write goes through a `SECURITY DEFINER` function
(`app.record_places_page`, `app.record_change_check`, `app.decide_place_attachment`,
`app.plan_run_searches`, `app.mark_run_search`). `place_coordinates` is the exception: it has **no**
tenant privilege at all (see 1.3).

### 1.1 `place_attachments` — 16 columns (a Places listing linked to one of our businesses)

One row per (org, business, `place_id`) pair the matcher scored as attached, tentative or rejected.
Retention: **indefinite** (no purge; the pair's decision is sticky — D-05).

| Column              | Label                         | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | ours                          | row key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `org_id`            | ours                          | tenant key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `created_at`        | ours                          | timestamp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `updated_at`        | ours                          | timestamp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `updated_by`        | ours                          | actor key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `business_id`       | ours                          | our spine business (Comptroller/Overture-sourced)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `place_id`          | **Google — verbatim**         | Google's place id — the field the Service Specific Terms §A.3 permit caching                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `status`            | Google-derived — computed     | `attached` / `tentative` / `rejected` — the outcome of scoring the listing against our business (D-05)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `reason`            | ours / computed               | `score` / `tie` / `confirmed` / `rejected` / `detached` — how the status was reached (a human decision or the matcher)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `score`             | **Google-derived — computed** | integer 0–100, CHECK `pa_score_range` — the match score of Google's name/phone/address/location against ours (D-05)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `features`          | **Google-derived — computed** | jsonb, **integers, fixed enums and 0/1 flags only**. Written with exactly these 11 keys at most (`src/lib/places/page-record.ts` `FEATURE_KEYS`): `name`, `phone`, `address`, `distance`, `cluster` (integer points); `signals` (array drawn only from `name`/`phone`/`address`/`distance`); `rule` (one of `phone_locality_name`, `phone_locality_review`, `over_25km`, `sab_phone_city`); `city`, `sab`, `listingPhone`, `listingLocation` (0 or 1). The database CHECK `pa_features_numeric` → `app.places_features_ok` (0029) is the wall behind it. See the note below |
| `tie_business_id`   | ours                          | a second business of ours the listing tied with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `first_seen_run_id` | ours                          | run key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `last_seen_run_id`  | ours                          | run key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `decided_by`        | ours                          | the human who confirmed/rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `decided_at`        | ours                          | timestamp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Note on `features` (stated plainly, because these are indefinite).** Every `features` value is
computed from Google content compared with ours, then reduced to an integer, an enum or a flag.
They are kept for the life of the attachment:

- `name` is `round(45 × clamp((similarity − 0.40) / 0.60, 0, 1))`. The similarity is the trigram
  similarity between Google's `displayName` and our name. The points are a coarsened, monotone
  function of it: 46 possible values, all similarities below 0.40 collapse to 0, and each step
  above that is about 0.013 of similarity.
- `distance` is one of four tiers: 15 (≤ 100 m), 10 (≤ 500 m), 4 (≤ 2 km), or 0 (farther, or a
  location too coarse to score). The distance is measured between Google's `location` and our
  spine point.
- `phone` and `address` are per-feature points from comparing Google's normalized phone and
  address with ours. `cluster` compares our own two cluster keys.
- `signals` names which independent signals fired. `rule` names which scoring rule, if any,
  lifted or capped the score.
- `city`, `listingPhone` and `listingLocation` are flags. They record whether Google's address
  city matched, whether the listing had a phone, and whether it had a location. `sab` is the
  service-area flag.

**Not persisted since `dc8e057`:**

- the similarity figure itself (`nameSim`);
- the metres (`distanceM`).

Both still exist **in memory** during the call, because they are what the scorer computes the
points from. `toPageRecord` drops exactly these two keys before the write. The unit test
"persisted place features carry no nameSim or distanceM" pins that. The writer test in
`tests/db/places-writer.test.ts` reads the stored row back and asserts neither key is there.

**The database CHECK now matches the legal line (0030, review finding A-WR-06).** Until 0030,
`app.places_features_ok` still admitted `nameSim` and `distanceM` as numbers (13 keys), so the
keep-out for those two was TypeScript only. Since 0030 it admits exactly the 11 keys above and
refuses `nameSim` and `distanceM` like any other unknown key. It also refuses a non-integer under
a points key (`name`, `phone`, `address`, `distance`, `cluster`). If the application regressed,
the database would now refuse either continuous value, not just text. Named tests in
`tests/db/places-writer.test.ts`: "features carrying nameSim is 23514", "features carrying
distanceM is 23514", "a non-integer point value is 23514". The constraint was dropped and
re-added in 0030, so every existing row was re-checked against it. Production held no
`place_attachments` rows when 0030 was written.

No text from Google can be stored here. The database refuses any non-numeric value, any
non-integer point and any key outside the 11 (M36, A-WR-06), and `toPageRecord` refuses the same
shapes before the write.

### 1.2 `place_observations` — 14 columns (append-only history of what one run saw)

One immutable row per (run, business, `place_id`) for attached and tentative listings (D-10).
UPDATE and DELETE are refused twice: by grant, and by a trigger that raises `55000` even for the
owner. Retention: **indefinite** (it is the history Phase 9's "got a website since last run" reads).

| Column            | Label                         | What it holds                                                                                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | ours                          | row key                                                                                                                                                                                                                                                                                                                 |
| `org_id`          | ours                          | tenant key                                                                                                                                                                                                                                                                                                              |
| `created_at`      | ours                          | timestamp                                                                                                                                                                                                                                                                                                               |
| `updated_at`      | ours                          | timestamp                                                                                                                                                                                                                                                                                                               |
| `updated_by`      | ours                          | actor key                                                                                                                                                                                                                                                                                                               |
| `business_id`     | ours                          | our spine business                                                                                                                                                                                                                                                                                                      |
| `place_id`        | **Google — verbatim**         | Google's place id                                                                                                                                                                                                                                                                                                       |
| `run_id`          | ours                          | run key                                                                                                                                                                                                                                                                                                                 |
| `attachment_id`   | ours                          | key into `place_attachments`                                                                                                                                                                                                                                                                                            |
| `had_website_uri` | **Google-derived — computed** | boolean: did the listing carry a `websiteUri`. The URL is not stored                                                                                                                                                                                                                                                    |
| `host_class`      | **Google-derived — computed** | one of `none`, `business_site_dead`, `social`, `directory`, `platform_subdomain`, `other` (CHECK `po_host_class_known`; CHECK `po_host_class_agrees` ties it to the boolean). Classified at call time by a pure suffix match on the URL's host (`src/lib/places/host-class.ts`); **the URL itself is discarded** (D-09) |
| `sku`             | ours                          | the billing tier the call was made at (`ts_enterprise`, etc.)                                                                                                                                                                                                                                                           |
| `pure_sab`        | **Google-derived — computed** | boolean from Google's `pureServiceAreaBusiness` (D-13)                                                                                                                                                                                                                                                                  |
| `observed_at`     | ours                          | timestamp of the observation                                                                                                                                                                                                                                                                                            |

The view `business_place_signal` (security_invoker, so RLS applies through it) reads only
`had_website_uri`, `host_class` and `observed_at`, and only from **attached** listings. It never
selects a coordinate.

### 1.3 `place_coordinates` — 10 columns (Google's lat/lng, 30-day TTL)

One row per observation whose listing had a location (D-10, D-12). This is the **only** place a
Google coordinate is stored. Coordinates are not in `place_observations`.

| Column           | Label                 | What it holds                                                                                                                                                             |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | ours                  | row key                                                                                                                                                                   |
| `org_id`         | ours                  | tenant key                                                                                                                                                                |
| `created_at`     | ours                  | timestamp                                                                                                                                                                 |
| `updated_at`     | ours                  | timestamp                                                                                                                                                                 |
| `updated_by`     | ours                  | actor key                                                                                                                                                                 |
| `observation_id` | ours                  | key into `place_observations`                                                                                                                                             |
| `lat`            | **Google — verbatim** | latitude from Google's `location`                                                                                                                                         |
| `lng`            | **Google — verbatim** | longitude from Google's `location`                                                                                                                                        |
| `observed_at`    | ours                  | when it was observed                                                                                                                                                      |
| `expires_at`     | ours                  | written as exactly `observed_at + 30 days` (0029). CHECK `pc_expiry_within_30_days` refuses anything later, and CHECK `pc_expiry_after_observed` refuses anything earlier |

Retention and access, plainly:

- **Tenant sessions cannot read any row.** `authenticated` and `anon` hold no privilege at all on
  this table (0027 `revoke all`). Any read is `42501 permission denied`, proven by
  `tests/db/places-schema.test.ts` "authenticated cannot read place coordinates". A second test in
  the same file, "a coordinate cannot be kept past 30 days", proves the CHECK.
- **No application code reads a coordinate row.** The app reaches this table only in two ways:
  - `app.places_transient_stats()` returns counts only (coordinates held, oldest age, expired
    awaiting purge) for the `/sources` card.
  - The purge deletes rows.
- **The daily purge DELETES expired rows.** It never deletes an observation.
  - It runs from Vercel Cron `/api/cron/purge-places` at `17 9 * * *` (09:17 UTC, `vercel.json`)
    through `withCronRole`. That role is `siteless_cron`, which holds EXECUTE on
    `app.purge_expired_place_coordinates` and no table privilege.
  - It deletes every row with `expires_at <= now()` and writes one `place_purge_runs` row per org.
  - The desk fallback is `pnpm purge:places`.
- **On disk, a coordinate can outlive its expiry by up to about a day** (the gap between cron
  ticks), and longer if a cron tick is skipped. Tenants cannot read it during that time. A skipped
  day shows as purge-overdue on `/sources`.
- **The database owner (`postgres`) and Supabase `service_role` keep full privileges** on this
  table, including on expired rows not yet purged. That is how Postgres/Supabase ownership works.
  The application holds no `service_role` credential: no `SERVICE_ROLE` reference exists in `src/`
  or in `src/env.ts`.
- **A local database has no scheduled purge.** Vercel Cron runs only against the deployed app.
  04-32's fixture recording writes real observations and coordinates into the **local** database.
  There, the only purge is by hand: `pnpm purge:places --target=test`.

### 1.4 `place_tiles` — 22 columns (the search grid; our geometry)

Retention: indefinite. **No Google content.** Rectangles and paths are our own quadtree over our
own geography units.

| Column              | Label                      | What it holds                                                                                                  |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                | ours                       | row key                                                                                                        |
| `org_id`            | ours                       | tenant key                                                                                                     |
| `created_at`        | ours                       | timestamp                                                                                                      |
| `updated_at`        | ours                       | timestamp                                                                                                      |
| `updated_by`        | ours                       | actor key                                                                                                      |
| `tile_key`          | ours                       | our tile key                                                                                                   |
| `unit_kind`         | ours                       | `city` / `county`                                                                                              |
| `unit_id`           | ours                       | our geography unit id (county FIPS + city name)                                                                |
| `places_type`       | ours                       | the Places type **we queried** (e.g. `plumber`) — our query parameter, from Google's published type vocabulary |
| `quad_path`         | ours                       | quadtree path                                                                                                  |
| `depth`             | ours                       | quadtree depth                                                                                                 |
| `south`             | ours                       | our rectangle bound                                                                                            |
| `west`              | ours                       | our rectangle bound                                                                                            |
| `north`             | ours                       | our rectangle bound                                                                                            |
| `east`              | ours                       | our rectangle bound                                                                                            |
| `is_leaf`           | ours                       | whether the tile was subdivided                                                                                |
| `saturated`         | ours — count of a response | the search hit Google's 60-result cap                                                                          |
| `truncated`         | ours                       | subdivision stopped at our depth/size floor                                                                    |
| `last_swept_run_id` | ours                       | run key                                                                                                        |
| `last_swept_at`     | ours                       | timestamp                                                                                                      |
| `last_checked_at`   | ours                       | timestamp of the last free IDs-only check                                                                      |
| `changed_at`        | ours — count of a response | when the tile's set of place ids last changed                                                                  |

### 1.5 `place_tile_members` — 10 columns (tile membership, D-06)

Every `place_id` Google returned in a tile, **matched or not**. This includes places that never
became businesses or leads (D-06). The free IDs-only change check diffs this set nightly: an id
that wasn't kept would read as "new" every night. Retention: **indefinite**.

| Column          | Label                      | What it holds                                             |
| --------------- | -------------------------- | --------------------------------------------------------- |
| `id`            | ours                       | row key                                                   |
| `org_id`        | ours                       | tenant key                                                |
| `created_at`    | ours                       | timestamp                                                 |
| `updated_at`    | ours                       | timestamp                                                 |
| `updated_by`    | ours                       | actor key                                                 |
| `tile_id`       | ours                       | key into `place_tiles`                                    |
| `place_id`      | **Google — verbatim**      | Google's place id                                         |
| `first_seen_at` | ours                       | first time the id appeared in this tile                   |
| `last_seen_at`  | ours                       | last time it appeared                                     |
| `gone_at`       | ours — count of a response | when it stopped appearing (revived to null if it returns) |

### 1.6 `run_searches` — 26 columns (one row per search a run made)

Retention: indefinite. Ours: keys, states, counters.

| Column                    | Label                      | What it holds                                                                             |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                      | ours                       | row key                                                                                   |
| `org_id`                  | ours                       | tenant key                                                                                |
| `created_at`              | ours                       | timestamp                                                                                 |
| `updated_at`              | ours                       | timestamp                                                                                 |
| `updated_by`              | ours                       | actor key                                                                                 |
| `run_id`                  | ours                       | run key                                                                                   |
| `tile_id`                 | ours                       | tile key                                                                                  |
| `tile_key`                | ours                       | tile key (text)                                                                           |
| `cell_key`                | ours                       | our cell key                                                                              |
| `cluster_key`             | ours                       | our industry cluster                                                                      |
| `places_type`             | ours                       | the type we queried                                                                       |
| `kind`                    | ours                       | `enterprise` / `ids_only`                                                                 |
| `depth`                   | ours                       | quadtree depth                                                                            |
| `parent_tile_key`         | ours                       | parent tile                                                                               |
| `status`                  | ours                       | `planned` / `searching` / `done` / `stopped`                                              |
| `pages_done`              | ours — count of a response | pages fetched (1–3)                                                                       |
| `results_count`           | ours — count of a response | how many places Google returned                                                           |
| `saturated`               | ours — count of a response | hit the 60 cap                                                                            |
| `subdivided`              | ours                       | we split the tile                                                                         |
| `truncated`               | ours                       | we stopped splitting                                                                      |
| `truncated_why`           | ours                       | `max_depth` / `min_size` / `novelty`                                                      |
| `change_verdict`          | ours — count of a response | `baseline` / `unchanged` / `new` / `gone` / `both` / `saturated`                          |
| `new_ids`                 | ours — count of a response | count of new place ids                                                                    |
| `gone_ids`                | ours — count of a response | count of vanished place ids                                                               |
| `inflight_reservation_id` | ours                       | our budget reservation key                                                                |
| `inflight_request_id`     | ours                       | our request id (`places:<run>:<search>:p<N>:<uuid>`, minted in `src/lib/places/meter.ts`) |

### 1.7 `run_place_outcomes` — 9 columns (per-run outcome per place, D-06)

One row per (run, `place_id`, cluster). This is where "Google places that matched nothing in the
spine" is counted **per cluster** (D-06). Unmatched places keep only their `place_id` here and in
`place_tile_members`. They never become businesses or leads. Retention: **indefinite**.

| Column        | Label                         | What it holds                                                                                                                             |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | ours                          | row key                                                                                                                                   |
| `org_id`      | ours                          | tenant key                                                                                                                                |
| `created_at`  | ours                          | timestamp                                                                                                                                 |
| `updated_at`  | ours                          | timestamp                                                                                                                                 |
| `updated_by`  | ours                          | actor key                                                                                                                                 |
| `run_id`      | ours                          | run key                                                                                                                                   |
| `place_id`    | **Google — verbatim**         | Google's place id                                                                                                                         |
| `cluster_key` | ours                          | our industry cluster                                                                                                                      |
| `outcome`     | **Google-derived — computed** | `attached` / `tentative` / `unmatched` / `outside`. `outside` is derived from Google's `formattedAddress` (a listing outside the US/area) |

### 1.8 `place_purge_runs` — 8 columns (the purge's own log)

Retention: indefinite. **No Google content.**

| Column        | Label | What it holds                       |
| ------------- | ----- | ----------------------------------- |
| `id`          | ours  | row key                             |
| `org_id`      | ours  | tenant key                          |
| `created_at`  | ours  | timestamp                           |
| `updated_at`  | ours  | timestamp                           |
| `updated_by`  | ours  | actor key                           |
| `ran_at`      | ours  | when the purge ran                  |
| `rows_purged` | ours  | how many coordinate rows it deleted |
| `trigger`     | ours  | `cron` / `desk`                     |

### 1.9 Summary of Google values at rest

| Value                                                                | Where                                                                                 | Retention                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `place_id` (verbatim)                                                | `place_attachments`, `place_observations`, `place_tile_members`, `run_place_outcomes` | indefinite (Terms §A.3 names it)                                                                                  |
| `lat`, `lng` (verbatim)                                              | `place_coordinates` only                                                              | `expires_at ≤ observed_at + 30 days`, CHECK-enforced. No tenant read. Deleted daily; on disk ≤ ~1 day past expiry |
| `had_website_uri` (derived boolean)                                  | `place_observations`                                                                  | indefinite                                                                                                        |
| `host_class` (derived six-value class; URL discarded — D-09)         | `place_observations`                                                                  | indefinite                                                                                                        |
| `pure_sab` (derived flag — D-13)                                     | `place_observations`                                                                  | indefinite                                                                                                        |
| match `score` + `features` (integer points, enums, 0/1 flags — D-05) | `place_attachments`                                                                   | indefinite                                                                                                        |
| attachment `status`, per-place `outcome` incl. `outside`             | `place_attachments`, `run_place_outcomes`                                             | indefinite                                                                                                        |
| tile membership (`place_id` per tile; first/last seen; gone — D-06)  | `place_tile_members`                                                                  | indefinite                                                                                                        |
| per-cluster unmatched counts (D-06)                                  | computed from `run_place_outcomes`                                                    | indefinite                                                                                                        |
| response counts (results, pages, new/gone ids, saturation)           | `run_searches`, `place_tiles`                                                         | indefinite                                                                                                        |
| `sku`, `observed_at`                                                 | `place_observations`                                                                  | indefinite                                                                                                        |

---

## 2. Never persisted

These fields arrive in the response (they are in the field mask, §4). They are used, if at all, in
memory during the call, and are **never written to the database, a log, the workflow event log or
a committed file**:

- `displayName` (the business name) — normalized in memory for matching, then dropped (D-05)
- `formattedAddress` — parsed in memory for street number / street / unit / ZIP / country, then dropped (D-05)
- `nationalPhoneNumber` — normalized in memory to E.164 for matching, then dropped (D-05)
- `websiteUri` — reduced to `had_website_uri` + `host_class` at call time, then dropped (D-09)
- `rating`, `userRatingCount` — parsed, not used by any code (D-21)
- `location` — kept only as §1.3 describes (30-day row). It is also compared with our spine
  point in memory, and only the resulting distance **tier** (§1.1 `distance`) persists. The
  metres (`distanceM`) are memory-only since `dc8e057`.
- `displayName` again, as a similarity: the trigram similarity (`nameSim`) is computed in memory
  and only its integer points (§1.1 `name`) persist, since `dc8e057`.
- `nextPageToken` — used to fetch the next page within the same step, never stored

**Not requested at all** (so they never arrive):

- `types`, `businessStatus` — removed from the mask and the response schema by `53e5650`,
  because no code read them. If Google sent them anyway, the schema would strip them at parse
  (the schema strips unknown keys).
- reviews and photos — `places.reviews` is not in the mask. A mutation test, M11, goes red if it
  is added.

How this is enforced, not merely intended:

- **The field mask is a hard-coded allow-list** (`src/lib/budget/field-mask-tier.ts`). The
  field-mask header is spelled in exactly one module (`src/lib/places/client.ts`), held there by a
  repo grep test. `fieldMaskTier()` refuses any unknown field.
- **The response schema strips.** `src/lib/places/response.ts` parses with zod's default strip, so
  any key Google adds is dropped at parse.
- **Matching works on normalized keys.** `src/lib/places/match.ts` `PlaceForMatch` carries
  normalized keys, not display text. `toPageRecord` (`src/lib/places/page-record.ts`) rebuilds
  every object key by key and **throws** on any feature key or value outside the allow-list.
- **The database enforces the 11-key, integer-points line.** CHECK `pa_features_numeric`
  (`app.places_features_ok`, tightened in 0030) refuses any non-numeric feature, any non-integer
  point and any key outside the 11 — including `nameSim` and `distanceM` — even if the
  application regresses (M36, A-WR-06). The observation table
  has no text column that could hold Google text: `host_class` and `sku` are CHECK-constrained
  enums.
- **Sentinel scans.** The workflow lane test (`tests/workflow/places-sweep.test.ts`, M45 / 04-22)
  runs a saturated tree and a match page. It then reads every file the workflow world wrote, plus
  each run's return value, and asserts that none contains any Places sentinel string. Positive
  controls prove the scan read real step payloads.
- **Step returns and errors.** Steps return ids, tile keys, rects, counts and enums only
  (`src/workflows/places-sweep/steps.ts`). An error is reduced to an allow-listed reason key, a
  SQLSTATE or an error name, never a message that could quote a parameter.

---

## 3. Transient sinks (outside the eight tables)

- **Vercel workflow event log** (Workflow DevKit). Every step argument and return is persisted
  there, retained for the run + 7 days on Pro. It is unencrypted on disk in the local world. It
  holds our run ids, tile keys, rectangles, counts and enums only. No Places text, which is proven
  by the M45 scan above. Searches cross the step boundary in a NUL-free wire form
  (`src/workflows/places-sweep/wire.ts`, 04-22).
- **Logs and error messages.** These carry HTTP status codes, named reasons, SQLSTATEs and our keys
  only.
  - `classifyGoogleError` returns a reason, never Google's message.
  - Nothing parsed from a response is interpolated into a log or an error
    (`src/lib/places/response.ts` header).
  - The purge route returns fixed-enum bodies.
- **The run-level audit event.** `finishRun` emits one run-level event (counts). There is no
  per-observation audit event (0027 comment: "No app.log_event: per-run volume").
- **Committed fixtures (D-20).**
  - **Today:** every Places fixture under `tests/unit/msw/fixtures/` is hand-written synthetic
    data (sidecar `places-recordings.json`: `synthetic: true`, `anonymized: false`).
  - **After a yes:** 04-32's recorder (`scripts/record-places-fixtures.ts`) anonymizes each real
    page **in memory** before writing (`scripts/lib/anonymize-places.ts`).
    - **Kept as returned:** `id` (the place id); `pureServiceAreaBusiness`; page sizes and
      whether a next-page token existed; each place's website **host class**; which fields were
      present at all.
    - **Refused:** `types` and `businessStatus`. The recorder never receives them (not
      requested since `53e5650`), and the anonymizer never copies them. `assertAnonymizedPage`
      refuses any fixture that carries either key. The msw harness also refuses them at load in
      every `places-*.json`, synthetic or recorded (`NEVER_KEPT` in
      `scripts/lib/anonymize-places.ts`).
    - **Synthesized:** name (`Synthetic <type> NNN`), address, phone (`(956) 555-01NN`), website
      (a synthetic URL of the same host class), location (a hashed point inside the searched
      rectangle), `rating` → 4, `userRatingCount` → 10, and the next-page token.
    - **Dropped:** every other key.
    - `assertAnonymizedPage` rejects any non-synthetic value at write time and again when the msw
      harness loads the fixture.
    - So a committed recording **will contain real place ids verbatim**. It will contain no
      Google text and no Google enum values.
  - **The recorder's guard.** It refuses to run until PROJECT.md Key Decisions carries a D-01
    Places row that says yes: `scripts/lib/record-guard.ts` `assertLegalRecord`. It also refuses
    any non-local database target (`assertLocalTarget`) and more than 10 requests per invocation.

---

## 4. Requested but memory-only

The Enterprise field mask (`PLACES_TEXT_SEARCH_FIELD_MASK`) requests these fields. They are
parsed, and **nothing in the code uses or persists them**:

- `places.rating`, `places.userRatingCount` (D-21). Both are Enterprise tier, so they cost nothing
  extra under the Enterprise SKU `websiteUri` already requires. They are kept in the mask
  deliberately, for Phase 6.

**No longer requested (since `53e5650`):** `places.types` and `places.businessStatus`.

- Both were Pro tier, so they cost nothing at the margin. They were requested, parsed and never
  read. A grep on 2026-09-23 found no reader in `src/`.
- Removing them does not change the SKU: the mask stays `ts_enterprise` because of `websiteUri`.
- The unit test "the Places mask requests no field nothing reads" pins the mask's exact
  contents.

The Enterprise mask is now exactly: `places.id`, `places.displayName`, `places.formattedAddress`,
`places.location`, `places.pureServiceAreaBusiness`, `places.websiteUri`,
`places.nationalPhoneNumber`, `places.rating`, `places.userRatingCount`, `nextPageToken`.

**Planned, not built — covered now so it is not a later surprise.** Phase 6 intends to persist a
**derived review-volume bucket**, a coarse category computed from `userRatingCount`. Neither the raw
count nor the rating would be stored (D-21). No column exists for it today.

The free IDs-only mask (`PLACES_IDS_ONLY_FIELD_MASK`) requests `places.id` and `nextPageToken`
only.

---

## 5. Display

- **Attribution.** The text "Google Maps" (`GoogleMapsTag`, `src/components/places/google-maps-tag.tsx`)
  renders inline wherever a Places-derived value renders (D-11, PLACE-06). A registry test pins
  this (`tests/unit/google-maps-attribution.test.tsx`, 04-28): "google maps attribution renders
  wherever a places signal renders", and "every places formatter import brings the tag with it".
  It is text, not the logo (UI Open Question 9: Google's policy allows the text "where space is
  limited").
- **No map anywhere.** Siteless renders no map of any kind: no map library, no map iframe, no
  static-map image, no tile URL. The guard `tests/unit/no-map.test.ts` (04-08) enforces this over
  `src/` and `package.json`.
- **A link OUT to Google Maps** (UI Open Question 5). "Open this listing on Google Maps" is built
  by `mapsUrlFor` in `src/lib/ui/places-format.ts` as
  `https://www.google.com/maps/search/?api=1&query=<our spine display name, our city>&query_place_id=<place_id>`.
  - It opens in a new tab, `noopener noreferrer`.
  - The query text is **our** name and city (Comptroller/Overture), never Google's.
  - It exists so a human can adjudicate a tentative match whose Google name was never stored.
- **What a user sees that is Google-derived:**
  - the website signal as a sentence (e.g. "No website listed"), with its host class;
  - the match score and its feature chips on the review card. Since `dc8e057`, the name and
    distance chips name a band ("name match", "name similar", "different name"; "within
    100 m", "within 500 m", "within 2 km") instead of printing the similarity or the metres;
  - tile, outcome and change counts on the run report;
  - `/sources` counts (place ids held, coordinates held, oldest coordinate age, last purge).

  Each one carries the "Google Maps" tag.

---

## 6. Open questions for the call

These are the questions the D-01 decision answers. They are recorded here as questions; this
document takes no position on any of them.

1. **§3.2.3(c) — "No Creating Content From Google Maps Content."** Is a derived value "content
   based on Google Maps Content"? The derived values Siteless persists indefinitely are:
   - `had_website_uri` (boolean);
   - `host_class` (six-value class);
   - `pure_sab` (flag);
   - the match `score`, and the `features`: integer points (including `name`, a coarsened
     function of the similarity to Google's name, and `distance`, a four-value tier of the
     distance to Google's location), the `signals` and `rule` enums, and 0/1 flags (§1.1). The
     similarity and the metres themselves are memory-only since `dc8e057`;
   - the per-place `outcome`, including `outside` (from Google's address);
   - tile membership and the per-cluster unmatched counts;
   - planned: the Phase 6 derived review-volume bucket.
2. **§3.2.3(d)(iii) — "use the Google Maps Core Services in a listings or directory service."**
   Is Siteless — an internal lead-prospecting tool that surfaces businesses with no website to a
   sales team, whose business records come from Comptroller and Overture and which links each to a
   Google `place_id` — a "listings or directory service"?
3. **Third-party attributions (UI Open Question 10).** `places.attributions` is not requested. The
   Places policy says "Google Maps" alone is insufficient when Google supplies third-party
   attributions. Does displaying a _derived_ signal (not Google's text) trigger that requirement?
4. **The link-out (UI Open Question 5).** Is the "Open this listing on Google Maps" link
   (`google.com/maps/search/?api=1&query=<our name, our city>&query_place_id=<place_id>`, new
   tab) acceptable?
5. **Surfaced while generating this list (not in the plan's original four).** Two items do not fit
   the four questions above:
   - Anonymized fixtures committed to git would hold real `place_id`s verbatim (§3). Since
     `53e5650` they can no longer hold Google's `types` / `businessStatus` enum values: those
     fields are not requested, and every fixture check refuses them. Real place ids in git are
     the only fixture question left.
   - The database owner and `service_role` can read coordinates until the daily purge deletes
     them, and a local database purges only by hand (§1.3).

   Does the decision cover these as they stand?

---

## Appendix — the Terms text these questions refer to

Quoted verbatim in `.planning/research/DATA-SOURCES.md` § (a) Google Places API (New), "Caching,
storage and attribution", from `cloud.google.com/maps-platform/terms` (read 2026-09-20). Re-read
the live Terms before relying on them.

> **3.2.3 Restrictions Against Misusing the Services.**
> **(a) No Scraping.** Customer will not export, extract, or otherwise scrape Google Maps Content
> for use outside the Services. For example, Customer will not: (i) pre-fetch, index, store,
> reshare, or rehost Google Maps Content outside the services; (ii) bulk download Google Maps
> tiles, Street View images, geocodes, directions, distance matrix results, roads information,
> places information, elevation values, and time zone details; (iii) copy and save business
> names, addresses, or user reviews; or (iv) use Google Maps Content with text-to-speech services.
>
> **(b) No Caching.** Customer will not cache Google Maps Content except as expressly permitted
> under the Maps Service Specific Terms.
>
> **(c) No Creating Content From Google Maps Content.** Customer will not create content based on
> Google Maps Content. … (vii) use Google Maps Content to improve machine learning and artificial
> intelligence models…
>
> **(d) No Re-Creating Google Products or Features.** … For example, Customer will not: … (iii)
> use the Google Maps Core Services in a listings or directory service or to create or augment
> an advertising product…
>
> **(e) No Use With Non-Google Maps.** … Customer will not (i) display or use Places content on
> a non-Google Map…

> **"Google Maps Content"** means any content provided through the Services (whether created by
> Google or its third-party licensors), including map and terrain data, imagery, traffic data, and
> places data (including business listings).

Maps Service Specific Terms:

> **A.3 Google ID Caching.** Customer may cache the Google ID values from the Services that return
> such field and allow caching, in accordance with its Documentation. For example, Customer may
> cache (a) place_id from Places API, Directions API, Geolocation API and Routes API…
>
> **14.1 Use without a Google Map.** Customer may use Google Maps Content from the Places API in
> Customer Applications without a corresponding Google Map.
> **14.2 No use with a non-Google map.** Customer must not use Google Maps Content from the Places
> API in conjunction with a non-Google map.
> **14.3 Caching.** Customer may temporarily cache latitude and longitude values from the
> Places API for up to 30 consecutive calendar days, after which Customer must delete the
> cached latitude and longitude values.

Places API Policies (attribution): attribution "should take the form of the Google Maps logo
whenever possible. In cases where space is limited, the text Google Maps is acceptable."

Decisions referenced: 04-CONTEXT D-01, D-02, D-05, D-06, D-09, D-10, D-11, D-12, D-13, D-20, D-21;
04-UI-SPEC Open Questions 5, 9, 10.

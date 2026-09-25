# Runbook — Google Places (the transient verifier)

Google Places API (New) is how Siteless checks whether a business has a website. It is a
**verifier, not a source**: Siteless keeps a listing's `place_id`, a derived website signal,
and the listing's coordinates for **at most 30 days**. Everything durable comes from the
Comptroller and Overture. This runbook covers the five things you operate by hand: the kill
switch, the key, the daily quota, the coordinate purge, and the test fixtures.

> **Names only.** This file never carries a key, a secret, a project id or a billing account.

---

## 1. Kill switch (D-02) — `PLACES_MODE`

| Value | What a run may do |
|---|---|
| `off` (**default**) | No Places request at all. Preset detail says Google Places is switched off. |
| `ids_only` | Text Search **Essentials** only — place ids, no `websiteUri`. Change checks. |
| `enterprise` | Text Search **Enterprise** — the `websiteUri` field the product depends on. |

- Read by `src/env.ts` (`z.enum(['off', 'ids_only', 'enterprise']).default('off')`). An unset
  variable is `off`. Nothing in the app can change it: **only a Vercel environment-variable
  edit followed by a redeploy** changes the mode.
- 🔴 **A flip does NOT stop a running run.** Workflow runs are pinned to the deployment that
  started them, **with that deployment's environment** (04-RESEARCH Pitfall 5). Flipping to
  `off` and redeploying leaves any in-flight run on the old deployment, still able to call
  Google.

### After a "no" from counsel (or any reason to stop now)

1. Vercel → Project → Settings → Environment Variables → set `PLACES_MODE` = `off`
   (Production).
2. Redeploy, so every new request and every new run sees `off`.
3. **Cancel in-flight runs**: Vercel dashboard → the project → **Workflows** → cancel each
   running run; or from the desk with the `npx workflow` CLI.
4. Set those runs' `runs` rows to `failed` (desk, as the owner, against production).
5. Why step 4 matters even if step 3 lags: every page's reserve transaction requires
   `runs.status = 'running'`. A run whose row is no longer `running` is refused its next
   reservation, so it stops at the next page **before** the next request leaves — even if
   the workflow cancel has not landed yet.

---

## 2. The key — `GOOGLE_PLACES_API_KEY`

- **Server-only.** A Vercel environment variable in **Production** (and in **Preview** only if
  danlo decides Preview deployments may spend). Never `NEXT_PUBLIC_`-prefixed, never in the
  client bundle, never in a log line.
- **Read by exactly one module:** `src/lib/places/client.ts`. It is deliberately absent from
  `src/env.ts`; `tests/unit/no-google-credential.test.ts` fails if any other file under
  `src/` names it.
  Tests overwrite it with a fake value before anything loads (`vitest.config.ts`).
- **API restriction:** Places API (New) **only**.
- **No application restriction.** Vercel functions have no fixed egress IP, so an IP
  restriction would refuse our own server; a referrer restriction does not apply to a
  server-side key. The API restriction plus server-only handling is the protection.
- Rotating: create the new key with the same API restriction, set it in Vercel, redeploy,
  then delete the old key in the Google Cloud console.

---

## 3. Daily quota (D-19)

The Google Cloud quota **Places API (New) → `SearchTextRequest per day` = 100, every other
Places method per day = 0** is the second wall. There is no single "Requests per day" row: the
quotas are per method (`docs/runbooks/google-quota.md` has the derivation). How a run meets it:

- A **daily-quota** `429 RESOURCE_EXHAUSTED` ends the run **`partial`** with reason
  **`google_daily_quota`**. It is **never retried** — the quota resets at midnight Pacific;
  the tiles already searched are complete and the rest can run tomorrow. The run report says
  so in a warning (not an error: the wall worked as designed).
- A **per-minute** 429 is retried with backoff inside the step.
- When the two cannot be told apart, the run stops (the safe direction).
- 🔴 The 100/day quota counts **IDs-only** (`ids_only`, change-check) requests too, not just
  Enterprise ones (04-RESEARCH assumption A3 — confirm on the first real day's metrics).

---

## 4. Coordinate purge (D-12)

Coordinates expire 30 days after they were observed. The database already **refuses to read**
an expired coordinate; the purge removes it from disk.

- **The job:** Vercel Cron, `vercel.json` → `/api/cron/purge-places`, schedule
  **`17 9 * * *`** (09:17 UTC ≈ 04:17 Chicago). The repo's first cron.
- **The secret:** `CRON_SECRET` — a Vercel environment variable in **Production**, at least
  **16 characters** (`src/env.ts` refuses shorter). Vercel Cron sends it as
  `Authorization: Bearer <CRON_SECRET>`; the route compares it timing-safely.
  - Unset → the route answers **503 `not_configured`** and purges nothing (it fails closed,
    never open). Wrong or missing header → **401 `unauthorized`**.
  - Success → **200** `{ ok: true, orgs, rowsPurged }`. A failure → **500 `purge_failed`**;
    the log line carries the error's name only.
- **How it runs:** as the NOLOGIN role `siteless_cron`, which may execute
  `app.purge_expired_place_coordinates` and read no table. It is cross-org, deletes every
  expired coordinate row (never an observation), and records one `place_purge_runs` row per
  org — zero included. **Idempotent**: Vercel Cron may skip or duplicate a delivery; a second
  call purges 0.
- **"Purge overdue"** on `/sources` (the Google Places (transient) card) means one of:
  - expired coordinates are waiting on disk, or
  - the last purge is more than **36 hours** old, or
  - the purge has never run and a held coordinate is already older than 36 hours.

  First check the Vercel cron log for `/api/cron/purge-places` (a 503 means `CRON_SECRET` is
  not set; a 401 means it changed without a redeploy). Then run it by hand:

  ```
  pnpm purge:places --target=prod
  ```

  (`scripts/purge-places.ts`: connects as the migration owner through the Supabase **session**
  pooler, `SUPABASE_DB_URL`, port 5432; `--target` defaults to `test`, production demands the
  explicit flag; records trigger `desk`.) The alert's "Copy the purge command" copies exactly
  that line.

---

## 5. Fixtures (D-20)

- **Never commit a raw Places payload.** A response carries business names, addresses and
  phone numbers that the Terms forbid storing; a committed fixture keeps them in git forever.
- `scripts/record-places-fixtures.ts` (plan 04-19) records real responses and **anonymizes
  them in memory before writing** — structure, pagination, counts, service-area flags and host
  classes are kept; names, addresses, phones and URL hosts are synthesized; `place_id`s are
  kept (they are exempt).
- CI never calls Google: tests replay the anonymized fixtures through msw, and
  `tests/unit/no-network.test.ts` fails when a test or a `src/` module other than
  `src/lib/places/client.ts` names the Places host.

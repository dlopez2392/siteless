# Runbook — the Google Cloud daily quota (BUDG-03)

**The second wall.** Siteless's own budget meter (`app.reserve_budget`, a single conditional
`UPDATE` against `budget_periods`) is the wall that bounds the **month**. This quota is an
independent one that bounds a **runaway day**, set in a console Siteless does not control
and cannot be talked out of by a bug in Siteless. Keep both. They stop different things.

> **Names only.** This file never carries a key, a project id or a billing account. Exactly one
> module in `src/` reads the Places key — `src/lib/places/client.ts`, server-only — and
> `tests/unit/no-google-credential.test.ts` fails if any other file names it. No test depends
> on the key existing: CI replays anonymized fixtures and never calls Google.

## D-03 — first-time setup (danlo)

Done by hand, once, by danlo: it needs his Google account and a billing account, and there is
no `gcloud` CLI at the desk. Claude does **not** do these steps and never sees the key. Do them
**in this order** — each step is a prerequisite of the next (quota editing is unavailable until
billing is attached; an API key can only be restricted to an API that is enabled).

1. **Create the Google Cloud project.** <https://console.cloud.google.com/projectcreate> →
   Project name `siteless` → **Create**. Then pick it in the project selector at the top of the
   console — every step below acts on the **selected** project, so check the name there before
   each one.
2. **Enable Places API (New).** **APIs & Services → Library** → search **"Places API (New)"** →
   open it → **Enable**.
   🔴 Not the one called just **"Places API"** — that is the legacy API, which Siteless does not
   call and which Google is retiring. The one Siteless calls has **(New)** in its name.
3. **Attach billing.** **Billing** (left menu) → **Link a billing account** → choose or create
   the account → **Set account**. The Google Maps Platform may also prompt for it the moment
   you enable the API — either path is the same link. Optional, and **not** a cap: a budget
   alert under **Billing → Budgets & alerts** (see "What it does not do" below).
4. **Set the daily quota.** Follow [The console path](#the-console-path) below:
   **Places API (New) → `Requests per day` = `100`**. Take a screenshot of the quota page
   showing `100`, and note the **date** you set it — the settings card prints it.
5. **Create the key, API-restricted.** **APIs & Services → Credentials** →
   **+ Create credentials → API key**. On the key's edit page:
   - **Name:** `siteless-places-server`.
   - **Application restrictions: None.** Vercel functions have **no fixed egress IP**, so an
     IP-address restriction would refuse Siteless's own production server; a website
     (HTTP-referrer) restriction does not apply to a server-side key. The compensating controls
     are: the key is used **server-only**, by **one sanctioned reader**
     (`src/lib/places/client.ts`), under the **100/day quota** and Siteless's **own meter**.
   - **API restrictions: Restrict key** → tick **Places API (New)** and **nothing else** →
     **OK** → **Save**.

   If enabling the API (step 2) popped up an auto-created "Maps Platform API Key", either
   restrict that one exactly as above or delete it — there must be **one** Places key, and it
   must be restricted.
6. **Store the key — two places, by name only.** Copy the key from **Show key** and put it:
   - in **`.env.local`** at the repo root (`C:\Users\danlo\prospector\.env.local`, which
     `.gitignore` already excludes) as one line, no quotes, no spaces:
     `GOOGLE_PLACES_API_KEY=<the key>`. This is what the desk scripts read
     (`scripts/record-places-fixtures.ts` loads `.env.local`); and
   - in **Vercel → `siteless` → Settings → Environment Variables → Add**: Key
     `GOOGLE_PLACES_API_KEY`, the key as the value, **Sensitive** on, environment
     **Production** only (Preview only if danlo decides Preview deployments may spend;
     never Development).

   🔴 **Never `NEXT_PUBLIC_`** — that prefix ships the value to every browser. 🔴 **Do not add
   `PLACES_MODE` in Vercel** — unset is `off`, and with `off` production sends no Places request
   even though the key is present; the mode flip is a later, separate decision (04-32).
   🔴 Never paste the key into a chat, a commit, a PR, an issue or a screenshot. Nothing asks
   for it: the checks are "is the variable **present**" (an exit code), never its value.
7. **Rotation** (a suspected leak, or routine): create a new key with the **same** API
   restriction (step 5) → replace the value in `.env.local` and in Vercel Production →
   **redeploy** (a running deployment keeps the old value until then) → confirm a request
   succeeds → **delete** the old key in **APIs & Services → Credentials**.

🔴 **The quota counts IDs-only requests too.** Text Search Essentials (IDs only) is **$0**, but
each request still spends one of the 100 per day (04-RESEARCH assumption A3 — confirm on the
first real day's metrics). A change check is free and still not unlimited.

After step 6 Claude verifies the key with **one** IDs-only request made **through the product's
own meter and client** against the **local** database (reserved and ledgered at `$0`, units 1) —
never a raw `curl` that would bypass the meter — then records the date on the settings card
(`GOOGLE_QUOTA_SET_ON` in `src/lib/budget/second-wall.ts`) and closes BUDG-03 (plan 04-31).

## The value

**Places API (New) → `Requests per day` = `100`.**

## The derivation

```
cap                            $50.00       = 50,000,000 µUSD
Text Search Enterprise         $35.00/1,000 = 35,000 µUSD/request, first 1,000 free
paid requests a $50 cap buys   50,000,000 / 35,000 = 1,428
total monthly ceiling          1,000 free + 1,428 paid = 2,428 requests
÷ 30 days                      ≈ 80.9 requests/day
round up so a weekly partition can burst (PLACE-04)  ->  100/day
runaway bound                  100 × $0.035 = $3.50/day, against $50 in an hour unbounded
```

`websiteUri` is an **Enterprise**-tier field, which is why the Enterprise price is the one
that matters: the whole product depends on that single field, so no cheaper SKU is reachable.
Cost is derived from the field mask actually sent (`fieldMaskTier()`), never from a per-call
constant.

## 🔴 What it does not do

**100/day × 30 days = 3,000 requests = $70/month, which EXCEEDS the $50.00 cap.**

The quota bounds a runaway **day**; only the app meter bounds the **month**. That is
precisely what "second wall, not the primary meter" means, and the card on
`/settings/budget` says so on screen. Anyone who reads this quota as "the spend is capped at
$50" has read it wrong.

**A budget alert is not a cap either.** Google states it verbatim:
*"Setting a budget does not automatically cap Google Cloud or Google Maps Platform usage or spending."*
A budget alert emails you after the money is gone. Keep the alert **and** the quota **and** the
meter, and be clear about which one actually stops things — only the meter refuses a call
before it is made, and only the quota refuses it if the meter is broken.

## The console path

Google Cloud console →
**Google Maps Platform → Quotas** →
API dropdown → **Places API (New)** →
quota metric **"Requests per day"** →
**⋮** → **Edit quota** →
uncheck **Unlimited** → enter **`100`** → **Submit request**.

Two equivalent paths, for when the console moves things again:

- **IAM & Admin → Quotas & System Limits** — filter by service `places.googleapis.com`.
- **APIs & Services → [the API] → Quotas → Edit Quotas**.

Prerequisites, in order: the Google Cloud project exists → **Places API (New)** is enabled
→ **billing is attached** (quota editing is unavailable without it) → then set the quota.
Take a screenshot of the quota page showing `100`, and reference it from the plan SUMMARY
that records the change.

## Two caveats Google documents

1. **Exceeding the quota returns a `limit exceeded` error.** It does not silently drop or
   queue traffic. Siteless must treat `limit exceeded` as a hard, non-retryable stop for the
   day and write a `budget_exhausted`-style event — retrying it just burns the workflow's
   retry budget against a wall that will not move until the reset.
2. **Enforcement lags the limit.** Verbatim: *"Quota limits are not always entirely precise,
   because there is some latency between when a quota is surpassed and when the enforcement
   begins."* So the quota can **overshoot** slightly. The meter cannot — it refuses inside
   the same statement that reserves. Never quote the quota as an exact ceiling.

## 🔴 Three timezones, all called "monthly"

They do not coincide, and no copy anywhere may imply they do.

| Clock | Governs | Resets |
| ----- | ------- | ------ |
| `America/Chicago` | Siteless's budget period — the $50.00 cap and the `budget_periods` month (D-11) | 12:00 AM `America/Chicago` on the 1st |
| **`US/Pacific`** | Google's **daily** quota — this `100/day` | midnight `US/Pacific`, every day |
| Google's billing month | the invoice and the free 1,000 Enterprise requests | billing-account aligned, not either of the above |

The cap-reset sentence in the UI must keep saying **"12:00 AM America/Chicago"**. A day that
has already reset in Chicago has not necessarily reset in Pacific, and the free-tier
allowance refreshes on a third schedule again.

## When to revisit the number

- **The cap changes.** The derivation is `cap ÷ Enterprise price ÷ 30`, rounded up. Redo it.
- **The price changes.** $35.00/1,000 and the 1,000 free were verified 2026-09-20; Google
  moves prices. The first real invoice is also the first chance to confirm whether each
  `pageToken` page bills separately — the research marked that MEDIUM confidence.
- **A weekly partition starts throttling.** `limit exceeded` on a legitimate sweep means the
  round-up was too tight, not that the sweep is wrong. Raise it deliberately, and update the
  runaway bound on the settings card in the same change.

The value is reversible in the console at any time and nothing in the codebase reads it
**from Google**. It is recorded once, as `GOOGLE_QUOTA_REQUESTS_PER_DAY = 100` in
`src/lib/budget/second-wall.ts` — read by the second-wall card on `/settings/budget` and by the
run-stop alert a `google_daily_quota` stop shows (`src/components/runs/run-alerts.tsx`) — and the
card's prose in `src/lib/ui/copy.ts` (`SECOND_WALL_*`) spells the same 100 and $3.50. Change the
console, that constant, the copy and this runbook **together**.

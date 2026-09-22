# Runbook — the Google Cloud daily quota (BUDG-03)

**The second wall.** Siteless's own budget meter (`app.reserve_budget`, a single conditional
`UPDATE` against `budget_periods`) is the wall that bounds the **month**. This quota is an
independent one that bounds a **runaway day**, set in a console Siteless does not control
and cannot be talked out of by a bug in Siteless. Keep both. They stop different things.

> **Names only.** This file never carries a key, a project id or a billing account. The
> Google Cloud project and the Places API (New) key **do not exist yet**; nothing in `src/`
> reads a Google credential and no test depends on one (`tests/unit/no-google-credential.test.ts`
> enforces that), so this runbook blocks nothing in Phase 2.

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

The value is reversible in the console at any time and nothing in the codebase reads it —
it is documented here and rendered on `/settings/budget` so the number and its reasoning
never drift apart.

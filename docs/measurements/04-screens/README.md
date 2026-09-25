# Phase 4 screens: built app, both themes, desk and phone

Plan 04-33 Task 2, 2026-09-25. These are for danlo's review (Task 3). UI-SPEC § Theme asks for:
- the run report in `running` and in `partial`;
- preset detail in all three `PLACES_MODE` states;
- a Google review item;
- the business detail's Google card;
- the `/sources` transient card.

That is 8 screen states × 2 viewports × 2 themes = **32 screenshots**.

## How they were shot

- **Build and servers.**
  - `$PNPM build` at `2558916`: the branch head, which differs from `e6acd7b` only by the
    mutation log.
  - Then `node node_modules/next/dist/bin/next start -p 3000`, one process per `PLACES_MODE`:
    - unset (= `off`): PID 23124;
    - `PLACES_MODE=ids_only`: PID 96300;
    - `PLACES_MODE=enterprise`: PID 123588.
  - Each mode was set on that process only. `.env.local` has no `PLACES_MODE` line, before and
    after.
  - Every server also ran with `GOOGLE_PLACES_API_KEY=not-a-real-key-04-33-screens` in its
    process environment, so even an accidental click could not reach Google with the real key.
    No UI surface reads the key.
  - Each server was stopped by that PID after its command line was checked.
- **Database.** The local `siteless_test` (the real RGV spine), through `SUPABASE_DB_POOL_URL` →
  localhost.
- **Browser.** Headless Chromium through `@playwright/test`, signed in with `auth.setup.ts`
  (`@clerk/testing` sign-in ticket for `E2E_ADMIN_EMAIL`, Clerk dev instance). The theme was
  switched through the real user-menu control, never by writing the class.
- **Checks before every screenshot:**
  - `window.innerHeight > 0` and `innerWidth > 0`;
  - `document.visibilityState === 'visible'`;
  - the screen's anchor element visible;
  - `html` carrying the theme class.
- **Viewports.**
  - Desk: 1280×800, full page.
  - Phone: 390×844 with touch and mobile emulation. It is shot through a viewport stretched to
    the page height, so the fixed tab bar and the sticky action bar sit at the bottom as on a
    phone. A plain full-page capture painted them mid-page.
  - Scale 1×.
- **Nothing was pressed** except two read-only disclosures: the run report's "Show the truncated
  tiles" toggle and the Google card's "Show earlier checks". No run, check, decide, detach or
  skip control was touched. No Google request was made.

## Seeded data (all removed afterwards)

These were seeded through the shipped definers under the tenant's claims, as
`tests/e2e/runs.spec.ts` does. Every row is prefixed `e2e-04-33-screens`.

| What | Id |
|---|---|
| Partial preset (search) | `3fab2a5c-c8a0-425f-bc3e-7eb3820f7720` |
| Partial run: `partial` / `exceeded_estimate`, 8 requests at 0 µUSD against a ceiling of 8, root tile subdivided, child `r0` still truncated (`min_size`), 1 attached + 1 tentative + 1 unmatched | `ed15c3ae-138d-4983-a5cc-abaf4ed7f877` |
| Running preset | `ade78958-3f44-48eb-9f97-06341ffd56c9` |
| Running run: 2 of 3 tiles searched, `r0` truncated, 2 requests | `aeef1408-0905-46d2-8e8d-b295783d1f3b` |
| Attached business (the same listing, observed by both runs, so the card has a two-row history) | `00003dd3-bd77-4a30-a930-450f77cf0875` ("The Bag Legendary Seafood") |
| Tentative businesses | `000168ab-bd7b-43a9-bc75-bfc8a449df20` (partial run), `0001e1b4-5a51-42ea-8e6f-7efe46142eb2` (running run) |

**Teardown.** Every row was deleted in FK order afterwards, as `runs.spec.ts`'s teardown does.
The table counts are identical to the pre-seed read: businesses 91,872, runs 3, attachments 123,
observations 123, coordinates 114, ledger 36, reservations 37, and places period `0/0`. The one
exception is **`events` (+12)**: the audit trigger's insert/update/delete rows for the two
seeded `searches` and `search_versions` (ids 4027359–4027370). The event log is an audit
trail, so they were left in place, as `runs.spec.ts` leaves them.

**The review item is real data, not seeded.** `/review?kind=google` shows the top of the queue.
That is D-04's highest-scoring tentative: attachment `9be3a718-95a3-4a7b-bad2-1eaf1b59b0d3`,
"San Juan Plumbing", a tie at 100 against "SAN JUAN PLUMBING" (95). The seeded tentative (85)
sat lower in the queue.

## The screenshots

The name pattern is `<screen>-<PLACES_MODE of the serving process>-<desk|phone>-<light|dark>.png`.

| Screen state | Files (desk/phone × light/dark) | What it proves |
|---|---|---|
| Run report, **partial** (`exceeded_estimate`) | `run-report-partial-off-{desk,phone}-{light,dark}.png` | The stop is a sentence ("Stopped at twice the estimate…"), never the key. Both warnings are amber, with the `triangle-alert` icon and a sentence. The truncation warning names the tile (list opened). The cost `$0.00` is the largest figure. "Still truncated 1" is in warning colour with the icon. A "Google Maps" tag sits under every Places-derived block (4 on the page). The page's own ledger (Requests) carries none. |
| Run report, **running** | `run-report-running-enterprise-…` | The `Running` accent-outline badge, "2 of 3 tiles searched so far", "Updated … · updating every 5 seconds" with an outline "Refresh now", and no stop alert. Truncation, tiles and outcomes are tagged (3 tags). |
| Preset detail, **off** | `preset-detail-off-…` | The muted Places-mode notice (`power-off` icon), then every run action disabled and **no accent button**. The phone sticky bar says "Places is switched off — see the note at the top." |
| Preset detail, **ids_only** | `preset-detail-ids_only-…` | The IDs-only notice (`circle-dashed`). **"Check for changes (free)"** is the accent primary. The full sweep and the partition are disabled. |
| Preset detail, **enterprise** | `preset-detail-enterprise-…` | No notice. **"Run full sweep"** is the accent primary (the phone sticky bar). The partition and the change check are enabled outline buttons. |
| Review, **Google item** | `review-google-off-…` | The Google listing card shows no Google name, address or phone, and says so. "Open this listing on Google Maps" is an outline button. The chips, the tie sentence and the "Google Maps" tag are on the card, plus a tag beside "Score 100 of 100". "Same business" is the accent. |
| Business detail, **Google card, history open** | `business-google-enterprise-…` | "No website listed" with "Google Maps · Sep 25", then the outline "Open this listing on Google Maps" and the destructive-outline "Detach this listing". History is open: two rows ("No website listed" / "Website listed — a dead Google site (business.site)"), each tagged. |
| Sources, **transient card** | `sources-transient-off-…` | A dashed card, separate from and below the four-row ledger: place ids 273 · coordinates 116 · oldest 0 days · limit 30 · last purge "Never run" · rows purged 0. The purge-overdue alert is not shown (nothing expired). |

## Probe results (every one of the 32)

A DOM probe ran before each screenshot and was read afterwards. The probe file stays in the
session scratchpad, not the repo.

- **Raw machine keys on screen: none.** The probe searched `document.body.innerText` for these
  keys, and none appeared on any screen: `exceeded_estimate`, `budget_cap_reached`,
  `google_daily_quota`, `places_unavailable`, `places_request_rejected`, `places_key_missing`,
  `places_off`, `business_site_dead`, `platform_subdomain`, `min_size`, `max_depth`.
- **Maps: none.** There was no `iframe`, `canvas`, `gmp-map`, map-classed SVG, or image from
  `maps.googleapis` / `google.com/maps` / a static-map URL on any screen.
- **"Google Maps" tag, painted.** Every visible tag computed as `rgb(94, 94, 94)` in light and
  `rgb(255, 255, 255)` in dark, with font `Roboto, sans-serif`.
- **Visible tags per screen:** run report partial 4, running 3; review 2; business card 3.
  Preset detail and `/sources` have 0, because neither shows a Places value.

## For danlo's eye (reported, not pre-judged or fixed)

1. **FIXED in `0456186` (screens not re-shot).** At 0 tiles subdividing the alert now drops
   the sentence and the button, the Tiles card shows no empty list, and (04-REVIEW-DELTA
   IN-01) the alert carries no "Google Maps" tag. As originally reported:
   **The `exceeded_estimate` stop alert does not handle zero.** On the partial run it reads
   "…0 tiles were still subdividing when it stopped; they're listed below." It then offers
   "Show the tiles still subdividing", and the Tiles card opens an empty "Tiles still
   subdividing when the run stopped (0)".
   - The fixture had no tile left mid-subdivision. A real stop at the ceiling usually leaves
     some, but zero is reachable when the ceiling lands on a run's last page.
   - A candidate fix: drop the sentence and the button at 0.
2. **The truncation warning's tile line carries a "Google Maps" tag.** The line ("McAllen ·
   roofing contractor · tile r0") is our own planner's data. This is over-attribution: harmless
   under the policy, but not strictly needed.
3. **The fixture pairs a restaurant with a roofing-contractor run.** "The Bag Legendary Seafood"
   (Food & hospitality) is attached by a home-services run. The seed picks the first unattached
   businesses by id, so this is a fixture artifact, not a matcher result.
4. **Preset estimates read "~$0.00".** McAllen × home services sits inside the 1,000 free
   Enterprise requests, as D-04 measured. That is expected, but every figure on the preset reads
   $0.00.
5. **Carried from Phase 3:** the chrome's org label is the local `orgs.display_name`
   (`bis-1790038019758308742`), not "BIS". This is local data, already deferred.
6. **The Places-mode notice names `PLACES_MODE`, `ids_only` and `enterprise` literally.** That is
   by design (Open Question 8: it tells the operator which variable to set). They are
   configuration names, not stopped-reason keys.

Reply `approved`, or list what to change.

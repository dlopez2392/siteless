/**
 * The second wall — the Google Cloud per-API daily quota (BUDG-03, D-03, D-19).
 *
 * 🔴 STATIC COPY RECORDED BY THE D-03 CHECKPOINT (04-31). THE APP CANNOT READ GOOGLE CLOUD AND
 * MUST NOT CLAIM TO. Nothing here is fetched, polled or inferred: danlo sets the quota by hand in
 * the Google Cloud console (docs/runbooks/google-quota.md § "D-03 — first-time setup") and the
 * date he reports is typed into this file by the plan that closes BUDG-03. A value here is a
 * record of what a human did, not a reading of what Google enforces today — the card on
 * /settings/budget says "set on {date}", never "is currently".
 *
 * No client-boundary directive: plain data, imported by server components and by
 * `run-alerts.tsx` alike (a client module's exports are client REFERENCES in a server tree).
 */

/** Places API (New) → SearchTextRequest per day (the quotas are per method; every other Places
 *  method's per-day quota is 0 — set 2026-09-24). The derivation is in docs/runbooks/google-quota.md;
 *  the run-stop alert (`run-alerts.tsx`) and the second-wall card both read THIS value, so the
 *  number a stopped run names and the number the settings card names cannot drift apart. */
export const GOOGLE_QUOTA_REQUESTS_PER_DAY = 100;

/** The calendar day ('YYYY-MM-DD', no zone — it never was an instant) danlo set the quota, or
 *  `null` while BUDG-03 is open. `null` renders the "not set yet" card. */
export const GOOGLE_QUOTA_SET_ON: string | null = '2026-09-24';

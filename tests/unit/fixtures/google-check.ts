import type { GoogleCheckBusiness } from '@/components/business-detail/google-check';
import type { GoogleCheckView } from '@/server/queries/businesses';

/**
 * `GoogleCheckView` fixtures for the business detail's "Google Maps check" card (04-25).
 *
 * Shared by `google-check.test.tsx` / `detach-dialog.test.tsx` (the renders) and by
 * `no-internal-leak.test.ts` ("places coordinates are never rendered"), which walks every key
 * of every fixture here and fails on a lat/lng-shaped one: the card is fed exactly what
 * `readGoogleCheck` returns, and a fixture that grew a coordinate would be the first sign the
 * read did too (Rule 32, T-4-04).
 *
 * 🔴 EVERY INSTANT IS 03:30 UTC — the evening BEFORE in America/Chicago. The unit suite runs in
 * UTC, so a component that formatted in the process zone prints the UTC day ("Sep 23") and the
 * Chicago assertion ("Sep 22") goes red. Chicago is only ever half of the pair.
 */

/** 03:30 UTC Sep 23 → 22:30 Sep 22 in Chicago (CDT). */
export const LATE_MS = Date.UTC(2026, 8, 23, 3, 30);
/** 03:30 UTC Sep 20 → Sep 19 in Chicago. */
export const MID_MS = Date.UTC(2026, 8, 20, 3, 30);
/** 03:30 UTC Sep 16 → Sep 15 in Chicago. */
export const WEEK_AGO_MS = Date.UTC(2026, 8, 16, 3, 30);
/** 03:30 UTC Sep 9 → Sep 8 in Chicago. */
export const TWO_WEEKS_AGO_MS = Date.UTC(2026, 8, 9, 3, 30);

export const IDS = {
  attachedA: '00000000-0000-4000-8000-00000000a0a1',
  attachedB: '00000000-0000-4000-8000-00000000a0a2',
  tentative: '00000000-0000-4000-8000-00000000a0b1',
  rejected: '00000000-0000-4000-8000-00000000a0c1',
  detached: '00000000-0000-4000-8000-00000000a0c2',
  runLate: '00000000-0000-4000-8000-00000000f001',
  runWeek: '00000000-0000-4000-8000-00000000f002',
  runTwoWeeks: '00000000-0000-4000-8000-00000000f003',
  runMid: '00000000-0000-4000-8000-00000000f004',
  obs1: '00000000-0000-4000-8000-00000000e001',
  obs2: '00000000-0000-4000-8000-00000000e002',
  obs3: '00000000-0000-4000-8000-00000000e003',
  obs4: '00000000-0000-4000-8000-00000000e004',
} as const;

export const PLACE = {
  a: 'ChIJ-fixture-place-a',
  b: 'ChIJ-fixture-place-b',
  t: 'ChIJ-fixture-place-t',
  r: 'ChIJ-fixture-place-r',
  d: 'ChIJ-fixture-place-d',
} as const;

/** The spine side the card is rendered for. Our own fields only — never Google text. */
export const GOOGLE_BUSINESS: GoogleCheckBusiness = {
  id: '00000000-0000-4000-8000-0000000000a1',
  displayName: 'Taquería El Ñandú',
  city: 'McAllen',
  cluster: 'Food & hospitality',
};

/** Clerk user id → display name, as the route resolves them through `actorNames`. */
export const GOOGLE_ACTORS: Record<string, string> = { user_danlo: 'danlo' };

/** Two attached, one tentative, one rejected, one detached — every row kind at once. */
export const MIXED: GoogleCheckView = {
  signal: { hadWebsiteUri: true, hostClass: 'business_site_dead', observedMs: LATE_MS },
  listings: [
    {
      attachmentId: IDS.attachedA,
      placeId: PLACE.a,
      status: 'attached',
      reason: 'score',
      score: 97,
      tieBusinessId: null,
      decidedBy: null,
      decidedMs: null,
      latest: {
        hadWebsiteUri: true,
        hostClass: 'business_site_dead',
        observedMs: LATE_MS,
        runId: IDS.runLate,
      },
    },
    {
      attachmentId: IDS.attachedB,
      placeId: PLACE.b,
      status: 'attached',
      reason: 'confirmed',
      score: 91,
      tieBusinessId: null,
      decidedBy: 'user_danlo',
      decidedMs: WEEK_AGO_MS,
      latest: { hadWebsiteUri: true, hostClass: 'social', observedMs: WEEK_AGO_MS, runId: IDS.runWeek },
    },
    {
      attachmentId: IDS.tentative,
      placeId: PLACE.t,
      status: 'tentative',
      reason: 'score',
      score: 87,
      tieBusinessId: null,
      decidedBy: null,
      decidedMs: null,
      // The read returns `latest` for a tentative listing too; the SCREEN never shows it (D-05).
      latest: { hadWebsiteUri: true, hostClass: 'other', observedMs: MID_MS, runId: IDS.runMid },
    },
    {
      attachmentId: IDS.rejected,
      placeId: PLACE.r,
      status: 'rejected',
      reason: 'rejected',
      score: 84,
      tieBusinessId: null,
      decidedBy: 'user_danlo',
      decidedMs: LATE_MS,
      latest: null,
    },
    {
      attachmentId: IDS.detached,
      placeId: PLACE.d,
      status: 'rejected',
      reason: 'detached',
      score: 96,
      tieBusinessId: null,
      // An actor the name lookup did not resolve renders as the raw id (actor-names.ts).
      decidedBy: 'user_unresolved',
      decidedMs: WEEK_AGO_MS,
      latest: {
        hadWebsiteUri: true,
        hostClass: 'directory',
        observedMs: TWO_WEEKS_AGO_MS,
        runId: IDS.runTwoWeeks,
      },
    },
  ],
  history: [
    {
      observationId: IDS.obs1,
      placeId: PLACE.a,
      observedMs: LATE_MS,
      hadWebsiteUri: true,
      hostClass: 'business_site_dead',
      runId: IDS.runLate,
    },
    {
      // The pending listing's own check: in the history, but never as a sentence (D-05).
      observationId: IDS.obs4,
      placeId: PLACE.t,
      observedMs: MID_MS,
      hadWebsiteUri: true,
      hostClass: 'other',
      runId: IDS.runMid,
    },
    {
      observationId: IDS.obs2,
      placeId: PLACE.b,
      observedMs: WEEK_AGO_MS,
      hadWebsiteUri: true,
      hostClass: 'social',
      runId: IDS.runWeek,
    },
    {
      observationId: IDS.obs3,
      placeId: PLACE.d,
      observedMs: TWO_WEEKS_AGO_MS,
      hadWebsiteUri: true,
      hostClass: 'directory',
      runId: IDS.runTwoWeeks,
    },
  ],
};

/** Exactly one attached listing and nothing else — row 1 and the listing row merge. */
export const ONE_ATTACHED: GoogleCheckView = {
  signal: { hadWebsiteUri: false, hostClass: 'none', observedMs: LATE_MS },
  listings: [
    {
      attachmentId: IDS.attachedA,
      placeId: PLACE.a,
      status: 'attached',
      reason: 'score',
      score: 97,
      tieBusinessId: null,
      decidedBy: null,
      decidedMs: null,
      latest: { hadWebsiteUri: false, hostClass: 'none', observedMs: LATE_MS, runId: IDS.runLate },
    },
  ],
  history: [
    {
      observationId: IDS.obs1,
      placeId: PLACE.a,
      observedMs: LATE_MS,
      hadWebsiteUri: false,
      hostClass: 'none',
      runId: IDS.runLate,
    },
  ],
};

/** Only a pending listing: no signal, and row 1 says so without a tag. */
export const ONLY_TENTATIVE: GoogleCheckView = {
  signal: null,
  listings: [
    {
      attachmentId: IDS.tentative,
      placeId: PLACE.t,
      status: 'tentative',
      reason: 'score',
      score: 87,
      tieBusinessId: null,
      decidedBy: null,
      decidedMs: null,
      latest: { hadWebsiteUri: true, hostClass: 'social', observedMs: LATE_MS, runId: IDS.runLate },
    },
  ],
  history: [
    {
      observationId: IDS.obs1,
      placeId: PLACE.t,
      observedMs: LATE_MS,
      hadWebsiteUri: true,
      hostClass: 'social',
      runId: IDS.runLate,
    },
  ],
};

/** Never checked. */
export const EMPTY_CHECK: GoogleCheckView = { signal: null, listings: [], history: [] };

/** Every fixture above — the no-internal-leak key walk reads this list. */
export const GOOGLE_CHECK_FIXTURES: Record<string, GoogleCheckView> = {
  MIXED,
  ONE_ATTACHED,
  ONLY_TENTATIVE,
  EMPTY_CHECK,
};

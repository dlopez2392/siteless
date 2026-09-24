/**
 * D-20. A real Text Search page, anonymized IN MEMORY before anything is written: the only path
 * from a Google response to a committed file (scripts/record-places-fixtures.ts, run at 04-32).
 *
 * KEPT, because they are what makes a recording worth more than a hand-written fixture:
 *   - `id`                        (our one durable Google value; charset-checked below)
 *   - `pureServiceAreaBusiness`   (the SAB flag — PLACE-05)
 *   - the page's size, and whether it carries a next-page token
 *   - each place's website HOST CLASS (none / dead Google site / social / directory /
 *     platform subdomain / other — src/lib/places/host-class.ts)
 *   - which fields are present at all (a place without a phone stays without one)
 *
 * SYNTHESIZED, because each is Google-authored text or a real coordinate (T-4-04, T-4-05):
 *   - `displayName`         → `{ text: 'Synthetic <type> NNN' }`
 *   - `formattedAddress`    → `NNN Synthetic St, <city>, TX 78500, USA` — or, when the original's
 *                             last segment is not `USA`, `NNN Calle Sintetica, Synthetic, Mexico`
 *                             (a foreign listing stays foreign: the out-of-area rule reads it)
 *   - `location`            → a point inside the SEARCHED rectangle, from an FNV-1a hash of the
 *                             id (deterministic per place, 4 decimals); absent stays absent
 *   - `nationalPhoneNumber` → `(956) 555-01NN`
 *   - `websiteUri`          → a synthetic URL of the SAME host class
 *   - `rating` → 4, `userRatingCount` → 10 (D-21: memory-only fields never reach git)
 *   - `nextPageToken`       → `recorded:p<N+1>` (the msw replay pages by the `:pN` suffix)
 * Every other key — `languageCode`, photos, opening hours, anything Google adds — is DROPPED.
 *
 * NEVER KEPT (2026-09-23, before D-01): `types` and `businessStatus`. The mask no longer requests
 * them and the response schema no longer parses them; were one to arrive anyway, `anonymizePage`
 * drops it like any other key, and `assertAnonymizedPage` REFUSES any fixture that still carries
 * either — a committed fixture must never hold Google's own enum values.
 *
 * `NNN` is the place's 1-based position in the recording (`(page - 1) * 20 + index + 1`).
 *
 * 🔴 A FIXPOINT. Anonymizing an anonymized page returns it unchanged (a unit test holds this),
 * which is what lets the recorder anonymize AGAIN at the moment it writes: whatever reaches
 * `writeFileSync` has passed through this function on that line, however the loop regresses.
 *
 * 🔴 NEVER ECHOES INPUT. A refusal names the key, never the value — the value may be exactly the
 * Google text being refused, and a thrown message lands in a terminal transcript.
 *
 * Pure: no I/O, no clock, no randomness. No `server-only` in the graph.
 */
import { hostClass, type HostClass } from '@/lib/places/host-class';
import { fnv1a32 } from '@/lib/places/partition';
import type { Rect } from '@/lib/places/tiling';

export type AnonymizeContext = {
  /** The rectangle the page was searched in: every synthetic location lands inside it. */
  rect: Rect;
  /** The unit's name as the operator knows it (ours, from the geo seed). */
  city: string;
  /** The Table A type the page was searched for (ours). */
  placesType: string;
  /** 1-based page number within the recording. */
  page: number;
};

type Json = Record<string, unknown>;

/** The id alphabet the database writers accept (drizzle/0029, T-4-05). */
const PLACE_ID = /^[A-Za-z0-9_-]{1,512}$/;
const TYPE_TOKEN = /^[a-z0-9_]{1,64}$/;

/**
 * Keys the mask no longer requests and no fixture may carry (2026-09-23). `anonymizePage` never
 * copies them; `assertAnonymizedPage` refuses them by name, ahead of the generic unknown-key
 * check, so the refusal says why.
 */
export const NEVER_KEPT = ['types', 'businessStatus'] as const;

/** Google's page size: NNN is unique per place across a 3-page recording. */
const PAGE_SIZE = 20;

const SYNTHETIC_URL: Record<Exclude<HostClass, 'none'>, (nnn: string) => string> = {
  business_site_dead: (n) => `https://synthetic-${n}.business.site`,
  social: (n) => `https://www.facebook.com/synthetic-${n}`,
  directory: (n) => `https://www.yelp.com/biz/synthetic-${n}`,
  platform_subdomain: (n) => `https://synthetic-${n}.wixsite.com/site`,
  other: (n) => `https://synthetic-${n}.example`,
};

function refuse(what: string): never {
  throw new Error(`anonymizePage: ${what} (the value is not echoed)`);
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A coordinate strictly inside [lo, hi], from a 32-bit hash, rounded to 4 decimals. */
function inside(lo: number, hi: number, hash: number): number {
  const u = hash / 2 ** 32; // [0, 1)
  const raw = lo + (0.05 + 0.9 * u) * (hi - lo); // inset 5% from each edge
  const rounded = Math.round(raw * 1e4) / 1e4;
  return rounded > lo && rounded < hi ? rounded : raw;
}

function assertContext(ctx: AnonymizeContext): void {
  const r = ctx.rect;
  const finite = [r.south, r.west, r.north, r.east].every((n) => Number.isFinite(n));
  if (!finite || r.south >= r.north || r.west >= r.east) refuse('the rectangle is not ordered');
  if (!Number.isInteger(ctx.page) || ctx.page < 1 || ctx.page > 3) refuse('page must be 1..3');
  if (!TYPE_TOKEN.test(ctx.placesType)) refuse('placesType is not a type token');
  if (!/^[A-Za-z][A-Za-z .'-]{0,63}$/.test(ctx.city)) refuse('city is not a plain unit name');
}

function anonymizePlace(place: unknown, index: number, ctx: AnonymizeContext): Json {
  if (!isObject(place)) refuse(`place ${index} is not an object`);
  const id = place.id;
  if (typeof id !== 'string' || !PLACE_ID.test(id)) refuse(`place ${index} id is not a place id`);

  const nnn = String((ctx.page - 1) * PAGE_SIZE + index + 1).padStart(3, '0');
  const out: Json = { id };

  if (place.pureServiceAreaBusiness !== undefined) {
    if (typeof place.pureServiceAreaBusiness !== 'boolean') {
      refuse(`place ${index} pureServiceAreaBusiness is not a boolean`);
    }
    out.pureServiceAreaBusiness = place.pureServiceAreaBusiness;
  }
  if (place.displayName !== undefined) {
    out.displayName = { text: `Synthetic ${ctx.placesType} ${nnn}` };
  }
  if (place.formattedAddress !== undefined) {
    const original = typeof place.formattedAddress === 'string' ? place.formattedAddress : '';
    const last = original.split(',').pop()?.trim() ?? '';
    out.formattedAddress =
      last === 'USA'
        ? `${nnn} Synthetic St, ${ctx.city}, TX 78500, USA`
        : `${nnn} Calle Sintetica, Synthetic, Mexico`;
  }
  if (place.location !== undefined) {
    out.location = {
      latitude: inside(ctx.rect.south, ctx.rect.north, fnv1a32(`${id}:lat`)),
      longitude: inside(ctx.rect.west, ctx.rect.east, fnv1a32(`${id}:lng`)),
    };
  }
  if (place.nationalPhoneNumber !== undefined) {
    out.nationalPhoneNumber = `(956) 555-01${nnn.slice(-2)}`;
  }
  if (place.websiteUri !== undefined) {
    const cls = hostClass(typeof place.websiteUri === 'string' ? place.websiteUri : undefined);
    // Present but empty classifies as `none`; a present value is never dropped silently —
    // it becomes `other`, the class hostClass gives anything present it cannot place.
    out.websiteUri = SYNTHETIC_URL[cls === 'none' ? 'other' : cls](nnn);
  }
  if (place.rating !== undefined) out.rating = 4;
  if (place.userRatingCount !== undefined) out.userRatingCount = 10;
  return out;
}

/** One Text Search page → its anonymized twin. Throws (naming a key, never a value) on anything
 *  that is not a page of places. */
export function anonymizePage(page: unknown, ctx: AnonymizeContext): Json {
  assertContext(ctx);
  if (!isObject(page)) refuse('the page is not an object');
  const out: Json = {};
  if (page.places !== undefined) {
    if (!Array.isArray(page.places)) refuse('places is not an array');
    if (page.places.length > PAGE_SIZE) refuse('a page carries more than 20 places');
    out.places = page.places.map((p, i) => anonymizePlace(p, i, ctx));
  }
  if (page.nextPageToken !== undefined && page.nextPageToken !== null) {
    if (ctx.page >= 3) refuse('page 3 carries a next-page token');
    out.nextPageToken = `recorded:p${ctx.page + 1}`;
  }
  return out;
}

// ─── The write-time check ──────────────────────────────────────────────────────────────────

const PLACE_KEYS = new Set([
  'id',
  'pureServiceAreaBusiness',
  'displayName',
  'formattedAddress',
  'location',
  'nationalPhoneNumber',
  'websiteUri',
  'rating',
  'userRatingCount',
]);

const SYNTHETIC_NAME = /^Synthetic [a-z0-9_]{1,64} \d{3}$/;
const SYNTHETIC_ADDRESS =
  /^(\d{3} Synthetic St, [A-Za-z][A-Za-z .'-]{0,63}, TX 78500, USA|\d{3} Calle Sintetica, Synthetic, Mexico)$/;
const SYNTHETIC_PHONE = /^\(956\) 555-01\d\d$/;
const SYNTHETIC_WEBSITE =
  /^https:\/\/(synthetic-\d{3}\.business\.site|www\.facebook\.com\/synthetic-\d{3}|www\.yelp\.com\/biz\/synthetic-\d{3}|synthetic-\d{3}\.wixsite\.com\/site|synthetic-\d{3}\.example)$/;

function fourDecimals(n: unknown): boolean {
  return (
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n * 1e4 - Math.round(n * 1e4)) < 1e-6
  );
}

/**
 * Throws unless `page` has exactly the anonymized shape: known keys only, every string one of the
 * synthetic forms above, ratings the fixed synthetic values, coordinates at 4 decimals. The
 * recorder runs it on every page before writing, and the msw harness runs it on every fixture
 * the sidecar marks `anonymized: true` — so a raw capture dropped in beside them fails at load.
 * Names the offending key, never its value.
 */
export function assertAnonymizedPage(page: unknown, label = 'page'): void {
  // Explicitly typed so TypeScript narrows after each call (a `never` function narrows only
  // when its declaration carries the type).
  const bad: (what: string) => never = (what) => {
    throw new Error(`assertAnonymizedPage: ${label} ${what} (the value is not echoed)`);
  };
  if (!isObject(page)) bad('is not an object');
  for (const key of Object.keys(page)) {
    if (key !== 'places' && key !== 'nextPageToken') bad(`carries the key ${JSON.stringify(key)}`);
  }
  if (page.nextPageToken !== undefined) {
    if (typeof page.nextPageToken !== 'string' || !/^recorded:p[23]$/.test(page.nextPageToken)) {
      bad('nextPageToken is not a recorded:pN token');
    }
  }
  if (page.places === undefined) return;
  if (!Array.isArray(page.places)) bad('places is not an array');
  (page.places as unknown[]).forEach((place, i) => {
    if (!isObject(place)) bad(`place ${i} is not an object`);
    for (const key of NEVER_KEPT) {
      if (key in place) bad(`place ${i} carries ${key}, which no fixture may hold`);
    }
    for (const key of Object.keys(place)) {
      if (!PLACE_KEYS.has(key)) bad(`place ${i} carries the key ${JSON.stringify(key)}`);
    }
    const p = place;
    if (typeof p.id !== 'string' || !PLACE_ID.test(p.id)) bad(`place ${i} id is not a place id`);
    if (p.pureServiceAreaBusiness !== undefined && typeof p.pureServiceAreaBusiness !== 'boolean') {
      bad(`place ${i} pureServiceAreaBusiness is not a boolean`);
    }
    if (p.displayName !== undefined) {
      const d = p.displayName;
      if (!isObject(d) || Object.keys(d).join() !== 'text' || typeof d.text !== 'string') {
        bad(`place ${i} displayName is not { text }`);
      }
      if (!SYNTHETIC_NAME.test((d as { text: string }).text))
        bad(`place ${i} displayName is not synthetic`);
    }
    if (p.formattedAddress !== undefined) {
      if (typeof p.formattedAddress !== 'string' || !SYNTHETIC_ADDRESS.test(p.formattedAddress)) {
        bad(`place ${i} formattedAddress is not synthetic`);
      }
    }
    if (p.location !== undefined) {
      const l = p.location;
      if (
        !isObject(l) ||
        Object.keys(l).sort().join() !== 'latitude,longitude' ||
        !fourDecimals(l.latitude) ||
        !fourDecimals(l.longitude)
      ) {
        bad(`place ${i} location is not a 4-decimal point`);
      }
    }
    if (p.nationalPhoneNumber !== undefined) {
      if (
        typeof p.nationalPhoneNumber !== 'string' ||
        !SYNTHETIC_PHONE.test(p.nationalPhoneNumber)
      ) {
        bad(`place ${i} nationalPhoneNumber is not synthetic`);
      }
    }
    if (p.websiteUri !== undefined) {
      if (typeof p.websiteUri !== 'string' || !SYNTHETIC_WEBSITE.test(p.websiteUri)) {
        bad(`place ${i} websiteUri is not synthetic`);
      }
    }
    if (p.rating !== undefined && p.rating !== 4) bad(`place ${i} rating is not the synthetic 4`);
    if (p.userRatingCount !== undefined && p.userRatingCount !== 10) {
      bad(`place ${i} userRatingCount is not the synthetic 10`);
    }
  });
}

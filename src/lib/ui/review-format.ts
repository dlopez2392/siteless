import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { APP_LOCALE } from '@/lib/time';
import { REVIEW_CHIP, REVIEW_CHIP_APART, REVIEW_CHIP_NAME } from './copy';

/**
 * `/review` display helpers (03-UI-SPEC § 1): the chip band's component vector, the distance
 * figure inside a chip, and the phone as a person reads it.
 *
 * 🔴 NO CLIENT DIRECTIVE, NO SERVER-ONLY IMPORT, NO I/O. Pure functions over the query's view,
 * so the chip band renders from a server component and `tests/unit/review-chips.test.ts`
 * drives it with plain objects. (A client module's exports would be client REFERENCES
 * inside the server component that renders the chips — Executor Rule 5.)
 *
 * 🔴 THE CHIPS ARE THE COMPONENT VECTOR, NEVER A BARE SCORE, AND THE WORDS CARRY THE MEANING.
 * Each chip is one fact about the pair, in the fixed order of the spec's example
 * (`phone exact · name 0.81 · 140 m apart · same ZIP · different cluster`). `agrees` picks the
 * Badge variant (secondary vs outline) — redundancy only; "different" and "no" already say it.
 * A fact with no chip wording in 03-UI-SPEC § Copy Table (two DIFFERENT phones, two different
 * ZIPs) renders no chip rather than an invented sentence: both values are on the cards above.
 *
 * 🔴 T-3-11: `features` carries integers, `nameSim` and `distanceM` (src/lib/resolve/score.ts).
 * Nothing here reads, or could render, a normalized name. `features` arrives as `unknown` JSON,
 * so every field is read defensively — a malformed vector drops a chip, it never throws.
 */

export type ReviewChip = {
  /** Stable React key, one per fact. Never rendered. */
  key: 'phone' | 'name' | 'distance' | 'zip' | 'cluster';
  label: string;
  /** True for an agreement chip (`secondary`), false for disagreement/absence (`outline`). */
  agrees: boolean;
};

/** The two sides' own fields the band reads beside the vector. */
export type ChipSide = { phoneE164: string | null; postal: string | null };

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function present(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/**
 * "140 m" under a kilometre, "3.1 km" from one up. `toFixed` rather than `Intl`: no component
 * or helper on this screen formats through an unpinned locale (Executor Rule 26), and a figure
 * this short never needs a grouping separator — the pair is capped at 25 km (score.ts R1).
 */
export function formatDistance(metres: number): string {
  const m = Math.max(0, metres);
  if (m < 999.5) return `${Math.round(m)} m`;
  // Round in whole hundreds of metres first: `(24950 / 1000).toFixed(1)` is "24.9" (binary
  // floating point), while 24,950 m is 25.0 km to one decimal.
  return `${(Math.round(m / 100) / 10).toFixed(1)} km`;
}

const COUNT_FORMAT = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 });

/** "1,284" — the remaining count, grouped in the PINNED locale (never the process default). */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

/**
 * The phone as a person reads it — "(956) 682-1234" — through libphonenumber-js, never `Intl`.
 * The stored value is E.164; anything the parser cannot read is shown as stored rather than
 * hidden, because a number danlo may dial must never silently disappear.
 */
export function displayPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164, 'US');
  return parsed ? parsed.formatNational() : e164;
}

export function reviewChips(
  features: Record<string, unknown>,
  a: ChipSide,
  b: ChipSide,
): ReviewChip[] {
  const chips: ReviewChip[] = [];

  // Phone: an exact, blockable match scored its points. Two absent phones is its own fact.
  const phonePoints = num(features.phone);
  if (phonePoints !== null && phonePoints > 0) {
    chips.push({ key: 'phone', label: REVIEW_CHIP.phoneExact, agrees: true });
  } else if (!present(a.phoneE164) && !present(b.phoneE164)) {
    chips.push({ key: 'phone', label: REVIEW_CHIP.noPhoneEitherSide, agrees: false });
  }

  // Name: the database's trigram similarity, two decimals, always shown when measured.
  const nameSim = num(features.nameSim);
  if (nameSim !== null) {
    const namePoints = num(features.name) ?? 0;
    chips.push({ key: 'name', label: REVIEW_CHIP_NAME(nameSim.toFixed(2)), agrees: namePoints > 0 });
  }

  // Distance: metres apart when both sides are located; otherwise say which fact is missing.
  const distanceM = num(features.distanceM);
  if (distanceM !== null) {
    const distancePoints = num(features.distance) ?? 0;
    chips.push({
      key: 'distance',
      label: REVIEW_CHIP_APART(formatDistance(distanceM)),
      agrees: distancePoints > 0,
    });
  } else if ('distanceM' in features) {
    chips.push({ key: 'distance', label: REVIEW_CHIP.noLocationOneSide, agrees: false });
  }

  // ZIP: read from the two records themselves — the scorer's own `sameValue` equality.
  if (present(a.postal) && present(b.postal) && a.postal === b.postal) {
    chips.push({ key: 'zip', label: REVIEW_CHIP.sameZip, agrees: true });
  }

  // Cluster: +5 same, −10 different, 0 when either side is unmapped (no chip — nothing to say).
  const clusterPoints = num(features.cluster);
  if (clusterPoints !== null && clusterPoints > 0) {
    chips.push({ key: 'cluster', label: REVIEW_CHIP.sameCluster, agrees: true });
  } else if (clusterPoints !== null && clusterPoints < 0) {
    chips.push({ key: 'cluster', label: REVIEW_CHIP.differentCluster, agrees: false });
  }

  return chips;
}

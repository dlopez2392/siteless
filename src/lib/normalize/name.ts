/**
 * name_norm — THE authoritative business-name normalizer (DEDUP-04, D-12).
 *
 * 🔴 TYPESCRIPT IS THE ONLY IMPLEMENTATION, AND THAT WAS SETTLED BY A REFUSAL.
 *
 * The Postgres accent-folding function is STABLE, not IMMUTABLE (its dictionary file can be
 * reloaded). Measured on PostgreSQL 18.6: a generated column over it and an expression index
 * over it were both refused with 42P17. So `name_norm` is a plain column, written by this
 * module, and SQL only ever compares already-stored values (`similarity`, `=`, `%`).
 * tests/unit/sql-never-normalizes.test.ts is the gate. An `immutable` SQL wrapper around the
 * STABLE function is forbidden: Postgres accepts the declaration without checking it, which
 * makes it a lie to the planner and a second implementation of this file.
 *
 * 🔴 AND THE TWO PIPELINES GENUINELY DISAGREE. NFD + strip-combining-marks folds Spanish
 * exactly as the SQL function does, but leaves ø æ ß œ Ł đ ı unchanged, where SQL maps them
 * to o ae ss oe L d i. The LIGATURES table below closes that gap first, so the stored key
 * matches what the SQL side would have produced. A blocker and a scorer that disagree about a
 * key produce candidate pairs that vanish when re-scored.
 *
 * TOKENISE, FILTER, RE-JOIN — NEVER REGEX-REPLACE IN PLACE. The SQL prototype showed three
 * defects on real RGV rows, one unit test each in tests/unit/normalize.test.ts:
 *   1. A regex stopword strip left a LEADING SPACE (" taqueria guanajuato"), which shifts
 *      every leading trigram and silently lowers similarity. The final trim() guards it.
 *   2. ADJACENT stopwords survived: `(^| )(de|la)( |$)` consumes the shared space, so
 *      "de la" lost only one word. A token filter removes both.
 *   3. DIGITS leak in from the source (phone numbers, store numbers). Digits are KEPT —
 *      "Taqueria Las 3 Torres" needs its 3 and "3 Amigos" is a real name — but a trailing
 *      10/11-digit run (a NANP phone number, however it was punctuated) is stripped, and
 *      `hadStoreNumber` tells the scorer the name carried a trailing number.
 *
 * Pure: no I/O, no database, no network. Linear in input length (T-3-12); no regex is built
 * from input (T-3-03).
 */

/** Characters with no canonical decomposition, folded the way the SQL dictionary folds them. */
const LIGATURES: Record<string, string> = {
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ß: 'ss',
  ø: 'o',
  Ø: 'o',
  đ: 'd',
  Đ: 'd',
  ł: 'l',
  Ł: 'l',
  ı: 'i',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
  // The capitals and the remaining Latin Extended-A strokes: none decomposes under NFD, and
  // each was measured against the SQL dictionary on PostgreSQL 18.6 (Þ→TH, Ð→D, ẞ→SS, Ħ→H,
  // Ŧ→T, Ŋ→N, Ŀ→L). Without them "Þor" normalized to "or".
  ẞ: 'ss',
  ħ: 'h',
  Ħ: 'h',
  ŧ: 't',
  Ŧ: 't',
  ŋ: 'n',
  Ŋ: 'n',
  ŀ: 'l',
  Ŀ: 'l',
};

/** Legal-form tokens. `l` and `c` catch "L.L.C." after punctuation became spaces. */
const LEGAL = new Set([
  'llc',
  'l',
  'c',
  'inc',
  'co',
  'ltd',
  'corp',
  'dba',
  'lp',
  'llp',
  'pllc',
  'plc',
  'incorporated',
  'company',
  'corporation',
]);

/** Bilingual (es/en) stopwords. */
const STOP = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'and', 'the', 'of']);

/** D-12's generic trade words — present in so many RGV names they carry no identity. */
const TRADE = new Set(['taqueria', 'carniceria', 'panaderia']);

const ALL_DIGITS = /^[0-9]+$/;

export interface NameNormDetail {
  norm: string | null;
  /**
   * True when the name ended in an all-digit run: either a phone run that was stripped, or a
   * short store number that was kept ("SMARTSTYLE 8"). The scorer reads this to forgive
   * "smartstyle 8" vs "smartstyle"; the digits themselves are never guessed away.
   */
  hadStoreNumber: boolean;
}

/**
 * How many trailing tokens form a NANP phone run: consecutive all-digit tokens at the end
 * whose digits total 10, or 11 with a leading trunk `1`. Returns 0 when there is none.
 * The longest qualifying run wins, so "1-956-263-1462" goes whole rather than leaving the 1.
 */
function trailingPhoneRun(tokens: readonly string[]): number {
  let digits = 0;
  let cut = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t === undefined || !ALL_DIGITS.test(t)) break;
    digits += t.length;
    if (digits > 11) break;
    if (digits === 10 || (digits === 11 && t.startsWith('1'))) cut = tokens.length - i;
  }
  return cut;
}

/**
 * Ligature fold → NFD → strip combining marks. Callers case-fold afterwards (the ligature
 * table already emits lowercase). The ONE diacritic fold in
 * the codebase: the name and the address key both call it, so they cannot drift apart.
 */
export function foldDiacritics(raw: string): string {
  const folded = [...raw].map((ch) => LIGATURES[ch] ?? ch).join('');
  return folded.normalize('NFD').replace(/\p{M}+/gu, '');
}

export function nameNormDetail(raw: string | null | undefined): NameNormDetail {
  if (!raw) return { norm: null, hadStoreNumber: false };

  // foldDiacritics is the ligature fold, then normalize('NFD'), then the mark strip.
  const stripped = foldDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');

  const tokens = stripped
    .split(' ')
    .filter((t) => t.length > 0)
    .filter((t) => !LEGAL.has(t) && !STOP.has(t) && !TRADE.has(t));

  const phoneRun = trailingPhoneRun(tokens);
  const kept = phoneRun > 0 ? tokens.slice(0, tokens.length - phoneRun) : tokens;
  const last = kept.at(-1);
  const hadStoreNumber = phoneRun > 0 || (last !== undefined && ALL_DIGITS.test(last));

  // 🔴 trim() is defect 1's fix, and it has a TWIN: the empty-token filter above. Mutation-
  // checked: removing either one alone leaves the suite green, because the other covers the
  // edge; removing BOTH reds 'nameNorm defect 1: no leading or trailing space'. Two guards
  // for one edge is deliberate: the plan names trim() as the fix, and neither costs anything.
  const norm = kept.join(' ').trim();
  return { norm: norm.length === 0 ? null : norm, hadStoreNumber };
}

export function nameNorm(raw: string | null | undefined): string | null {
  return nameNormDetail(raw).norm;
}

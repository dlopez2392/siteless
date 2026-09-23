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

/**
 * Legal-form tokens, stripped ONLY as a trailing run (see `stripTrailingLegal`).
 *
 * 🔴 B-CR-01: this set used to carry the single letters `l` and `c` (so "L.L.C." folded away)
 * and was applied at EVERY position. "C & L Plumbing" became "plumbing", "C&C Auto Repair"
 * became "auto repair" and "Co-Op Feed" became "op feed": distinct businesses shared a key,
 * which fed both a false auto-merge and a false chain badge. The single letters now live only
 * inside the dotted sequences in `LEGAL_SEQUENCES`, and nothing here is stripped mid-name.
 */
const LEGAL = new Set([
  'llc',
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

/**
 * Dotted legal abbreviations as they tokenise once punctuation became spaces ("L.L.C." →
 * `l l c`). Matched ONLY at the end of a segment, never as loose letters, so an initial
 * ("C & L") is identity.
 */
const LEGAL_SEQUENCES: ReadonlyArray<readonly string[]> = [
  ['p', 'l', 'l', 'c'],
  ['l', 'l', 'c'],
  ['l', 'l', 'p'],
  ['l', 'p'],
];

/** "Sun Plumbing LLC DBA Sun Pros": `dba` separates two names, each with its own tail. */
const DBA = 'dba';

/** Drop a trailing run of legal forms: `… co inc`, `… l l c`, `… llc`. Never mid-name. */
function stripTrailingLegal(tokens: readonly string[]): string[] {
  const out = [...tokens];
  for (;;) {
    const last = out.at(-1);
    if (last !== undefined && LEGAL.has(last)) {
      out.pop();
      continue;
    }
    const seq = LEGAL_SEQUENCES.find(
      (s) => s.length <= out.length && s.every((t, i) => out[out.length - s.length + i] === t),
    );
    if (seq === undefined) return out;
    out.splice(out.length - seq.length, seq.length);
  }
}

/** Split on `dba`, strip each name's own trailing legal run, re-join. */
function stripLegalForms(tokens: readonly string[]): string[] {
  const segments: string[][] = [[]];
  for (const t of tokens) {
    if (t === DBA) segments.push([]);
    else segments.at(-1)?.push(t);
  }
  return segments.flatMap(stripTrailingLegal);
}

/** Bilingual (es/en) stopwords. */
const STOP = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'and', 'the', 'of']);

/**
 * D-12's generic trade words — present in so many RGV names they carry no identity ON THEIR
 * OWN, so they are dropped to lift similarity ("Taqueria Jalisco Express" ~ "Jalisco Express").
 *
 * 🔴 B-WR-05: but NOT when exactly one identity token would be left. Surname-plus-trade is the
 * dominant RGV naming pattern, and "Taqueria Garcia", "Panaderia Garcia" and "Carniceria
 * Garcia" all collapsed to `garcia`, one key that chain detection (name_norm equality, >= 3)
 * counted as a chain and that the scorer read as a perfect name match. With one surname left,
 * the trade word IS the identity. See `dropTradeWords`.
 */
const TRADE = new Set(['taqueria', 'carniceria', 'panaderia']);

const ALL_DIGITS = /^[0-9]+$/;

/**
 * A token that identifies a business on its own: a word of two or more letters, or a number
 * ("3 Torres"). A lone letter is not — a possessive leaves one (`garcia s`).
 */
const isIdentityToken = (t: string): boolean => t.length >= 2 || ALL_DIGITS.test(t);

/**
 * Drop the trade words unless that would leave exactly ONE identity token (B-WR-05). With none
 * left the name was only trade words and stripping keeps the prior behaviour (no key); with
 * two or more left the name still carries its own identity.
 */
function dropTradeWords(tokens: readonly string[]): string[] {
  const rest = tokens.filter((t) => !TRADE.has(t));
  if (rest.length === tokens.length) return rest;
  return rest.filter(isIdentityToken).length === 1 ? [...tokens] : rest;
}

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

  const tokens = stripLegalForms(
    stripped
      .split(' ')
      .filter((t) => t.length > 0)
      .filter((t) => !STOP.has(t)),
  );

  const phoneRun = trailingPhoneRun(tokens);
  // A legal form ahead of the phone run ("Smith LLC 956-263-1462") is trailing once the
  // phone goes, so the tail is stripped again.
  const withTrade =
    phoneRun > 0 ? stripTrailingLegal(tokens.slice(0, tokens.length - phoneRun)) : tokens;
  const kept = dropTradeWords(withTrade);
  // Read from the trade-free tokens, so a kept trade word never hides a trailing number.
  const last = withTrade.filter((t) => !TRADE.has(t)).at(-1);
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

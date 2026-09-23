/**
 * phone_e164 — raw phone string → E.164, plus whether the number may be used as an identifier
 * (DEDUP-04, D-12, D-07).
 *
 * WHY A PARSER AND NOT A DIGIT REGEX. Overture `phones[]` is raw. Measured across the RGV
 * extract: 40,127 `+1…`, 6,403 bare 10-digit, 2,581 bare 11-digit and 2,263 "other"
 * (extensions, international, junk) — and the same toll-free number appears in two of those
 * forms (`8004879643` ×170, `+18004879643` ×45). libphonenumber-js folds all of them.
 *
 * 🔴 `e164` IS STORED AND DISPLAYED; `blockable` IS WHAT THE PHONE BLOCKING KEY AND THE D-07
 * TRUSTED-IDENTIFIER RULE READ. A toll-free number is a corporate switchboard, not an
 * identity. Measured: one toll-free number is shared by 215 Overture places, a
 * 23,005-pair block from a single row. Excluding the seven toll-free NPAs drops the worst
 * phone block to 32 and the phone-block pair count from 61,677 to 12,717. The number is still
 * returned — danlo may want to dial it — it just never makes two rows the same business.
 * A number carrying an extension ("x5", "ext 12") is treated the same way (B-WR-03).
 *
 * Rejected outright (e164 null): unparseable or invalid, not a US number, not 10 national
 * digits, or the 555 exchange (D-12: fictional/directory numbers).
 *
 * Pure: no I/O. Never throws — every rejection is `{ e164: null, blockable: false }`.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Kept on one unspaced line: the plan's acceptance grep (03-06) pins this literal.
// prettier-ignore
export const TOLL_FREE_NPAS = new Set(['800','833','844','855','866','877','888']);

export interface PhoneKey {
  e164: string | null;
  blockable: boolean;
}

const REJECTED: PhoneKey = { e164: null, blockable: false };

export function phoneE164(raw: string | null | undefined): PhoneKey {
  if (!raw) return { ...REJECTED };
  const p = parsePhoneNumberFromString(raw, 'US');
  if (!p || !p.isValid() || p.country !== 'US') return { ...REJECTED };
  const nsn = p.nationalNumber;
  if (nsn.length !== 10) return { ...REJECTED };
  const npa = nsn.slice(0, 3);
  const nxx = nsn.slice(3, 6);
  if (nxx === '555') return { ...REJECTED };
  // 🔴 B-WR-03: an extension is direct evidence of a shared switchboard (two practices on
  // one PBX), the same reasoning that excludes toll-free. Kept for dialling, never a key.
  return { e164: p.number, blockable: !TOLL_FREE_NPAS.has(npa) && !p.ext };
}

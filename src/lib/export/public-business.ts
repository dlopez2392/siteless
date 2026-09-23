/**
 * The business row as an outbound payload builder is allowed to see it.
 *
 * WHY THE SPLIT EXISTS. `businesses.internal_notes` is the operator's own annotation —
 * "owner is hostile, do not call before 10am" — and it is one of three name-ish fields
 * that are never interchangeable: `legal_name` (the Comptroller DBA, often mistyped),
 * `display_name` (what the triage card shows), `internal_notes` (ours, and only ours).
 *
 * BIS has the same split and lost it three times: `accounts.name` is the agency's
 * internal label for a company ("Rio Roofing — trial") and it reached customers in an
 * email from-name, in an SMS body, and in a report subject line. Each time the code was
 * reviewed and each time the internal field was simply the nearest string to hand.
 *
 * So builders take `PublicBusiness`, not `BusinessLike`: the internal field is not on the
 * value they are handed, and a leak has to be deliberate rather than convenient. The
 * runtime sentinel in tests/unit/no-internal-leak.test.ts stays anyway — a
 * `JSON.stringify(row)` of some wider object typechecks perfectly well.
 *
 * STRUCTURAL ON PURPOSE. This module imports nothing from `src/db/`. That keeps the
 * sentinel a pure unit test with no database, no connection string and no schema in its
 * import graph. Plan 07 adds the compile-time bridge proving `BusinessLike` stays a
 * subset of the real Drizzle row type, which is what stops the two drifting apart.
 */

/** The fields a business carries that any payload could plausibly reach for. */
export type BusinessLike = {
  id: string;
  orgId: string;
  /** Comptroller DBA. Often mistyped, and never the thing a human should be shown. */
  legalName: string | null;
  /** What the triage card shows. The only name that may leave the building. */
  displayName: string;
  /** THE INTERNAL ONE. Never in an export row, never in a push payload. */
  internalNotes: string | null;
  phoneE164: string | null;
  city: string | null;
  status: string;
  /**
   * INTERNAL (D-12, UI-SPEC Rule 17). The normalized match key — lowercased, unaccented,
   * legal suffixes stripped. It reads like a name and is exactly the "nearest string to
   * hand" a builder reaches for, which is why it is named here and omitted below.
   */
  nameNorm: string | null;
  /** INTERNAL. The USPS-folded street match key; the display address is `street` + `unit`. */
  streetNorm: string | null;
  /** INTERNAL. A blocking-key eligibility flag, meaningless to anybody outside the resolver. */
  phoneBlockable: boolean;
};

/**
 * What every outbound payload builder receives: the row minus everything internal — the
 * operator's annotation and the resolver's three match-key columns (Phase 3 plan 05).
 */
export type PublicBusiness = Omit<
  BusinessLike,
  'internalNotes' | 'nameNorm' | 'streetNorm' | 'phoneBlockable'
>;

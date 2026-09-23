import 'server-only';
import { sql } from 'drizzle-orm';
import {
  DETACH_FAILED,
  NOT_FOUND,
  REVIEW_GOOGLE_ALREADY_DECIDED,
  REVIEW_GOOGLE_DECISION_FAILED,
} from '@/lib/ui/copy';
import { rowsOf, type Tx } from '@/server/queries/budget';
import { readGoogleReviewRemaining } from '@/server/queries/review-queue';
import { pgFailure } from './_pg';
import { fail, type ActionResult } from './_result';

/**
 * The transactional core of the two listing actions (`record-listing-decision.ts`,
 * `detach-listing.ts`, plan 04-21, D-05 / UI OQ 6) and their refusal → result mapping.
 *
 * WHY A SEPARATE, `_`-PREFIXED MODULE (the `_merge-decisions.ts` precedent). A module carrying
 * the server directive publishes every export as a POST endpoint, so a `tx`-taking helper
 * exported from an action file would be an entry point accepting a transaction nobody opened.
 * The actions import this AFTER `requireOrg()`. It also keeps the listing copy's identifiers —
 * which spell the product name — out of the action files, where
 * `tests/unit/server-actions-guard.test.ts` refuses the bare token as a credential tripwire.
 *
 * 🔴 THE ONE WRITER IS `app.decide_place_attachment` (drizzle/0029). `place_attachments` is
 * SELECT-only for `authenticated`; the definer re-reads the listing under the caller's org
 * (42501 for a foreign OR unknown id → `not_found`, never a permission error), moves it only
 * from its from-state (`tentative` for confirm/reject, `attached` for detach — anything else is
 * 55000 → `conflict`), and takes `decided_by` from the claims' `sub`, never from input
 * (T-4-06). Its status change writes the one `events` row (place_attachments_event_upd, 0027).
 *
 * 🔴 NEVER GOOGLE TEXT (Rule 30). `businessName` is the SPINE business's `display_name`.
 *
 * 🔴 AN EXPECTED REFUSAL IS A RESULT, NOT A THROW: a definer refusal aborts the transaction, so
 * the action catches it OUTSIDE `withOrg` and maps it with the functions below.
 */

export type ListingDecision = 'attached' | 'rejected' | 'skip';

export type ListingOutcome =
  | { kind: 'decided'; businessId: string; businessName: string; remaining: number }
  | { kind: 'missing' }
  | { kind: 'already_decided' };

async function spineName(tx: Tx, businessId: string): Promise<string> {
  const row = rowsOf<{ display_name: string }>(
    await tx.execute(sql`select b.display_name from businesses b where b.id = ${businessId}`),
  )[0];
  return row?.display_name ?? '';
}

async function decided(tx: Tx, businessId: string): Promise<ListingOutcome> {
  return {
    kind: 'decided',
    businessId,
    businessName: await spineName(tx, businessId),
    // The Google listings still in the review band, read in this same transaction so the
    // queue header updates without a second round trip.
    remaining: await readGoogleReviewRemaining(tx),
  };
}

/**
 * "Same business" → `confirm`, "Not this business" → `reject`, "Skip" → nothing written.
 *
 * Skip still reads the listing under RLS, so a foreign id is the same `missing` and a decided
 * one the same `already_decided` a real decision would get.
 */
export async function decideListing(
  tx: Tx,
  input: { attachmentId: string; decision: ListingDecision },
): Promise<ListingOutcome> {
  if (input.decision === 'skip') {
    const row = rowsOf<{ business_id: string; status: string }>(
      await tx.execute(sql`
        select a.business_id, a.status
          from place_attachments a
         where a.id = ${input.attachmentId}
           and a.org_id = (select app.current_org_id())`),
    )[0];
    if (!row) return { kind: 'missing' };
    if (row.status !== 'tentative') return { kind: 'already_decided' };
    return decided(tx, row.business_id);
  }

  const verb = input.decision === 'attached' ? 'confirm' : 'reject';
  const row = rowsOf<{ business_id: string }>(
    await tx.execute(sql`
      select d.business_id
        from app.decide_place_attachment(${input.attachmentId}::uuid, ${verb}) d`),
  )[0];
  // The definer raises rather than returning nothing; an empty result is a contract break.
  if (!row) throw new Error('decideListing: decide_place_attachment returned no row');
  return decided(tx, row.business_id);
}

/** "Detach this listing": `attached` → `rejected` / `detached`. */
export async function detachOne(
  tx: Tx,
  attachmentId: string,
): Promise<{ businessId: string; businessName: string }> {
  const row = rowsOf<{ business_id: string }>(
    await tx.execute(sql`
      select d.business_id
        from app.decide_place_attachment(${attachmentId}::uuid, 'detach') d`),
  )[0];
  if (!row) throw new Error('detachOne: decide_place_attachment returned no row');
  return { businessId: row.business_id, businessName: await spineName(tx, row.business_id) };
}

/** The listing's not-found sentence — a foreign id and an unknown id are the same answer. */
export function listingNotFound<T>(): ActionResult<T> {
  return fail('not_found', NOT_FOUND('listing'));
}

/** The review queue's stale-screen answer: someone else decided this listing first. */
export function listingAlreadyDecided<T>(): ActionResult<T> {
  return fail('conflict', REVIEW_GOOGLE_ALREADY_DECIDED, { reason: 'already_decided' });
}

/** A malformed id reads as not found; a malformed decision is the generic failure. */
export function listingValidation<T>(badId: boolean): ActionResult<T> {
  return fail('validation', badId ? NOT_FOUND('listing') : REVIEW_GOOGLE_DECISION_FAILED);
}

/** A caught failure from `decideListing` → its result. `pgFailure()` walks `err.cause`. */
export function listingFailure<T>(error: unknown): ActionResult<T> {
  const failure = pgFailure(error);
  if (failure?.code === '42501') return listingNotFound();
  if (failure?.code === '55000') return listingAlreadyDecided();
  return fail('unexpected', REVIEW_GOOGLE_DECISION_FAILED);
}

/**
 * A caught failure from `detachOne` → its result. 55000 means the listing is not `attached`
 * (tentative, or already rejected/detached by someone) — `conflict`, with `detail.reason` so
 * the business screen can reload rather than retry.
 */
export function detachFailure<T>(error: unknown): ActionResult<T> {
  const failure = pgFailure(error);
  if (failure?.code === '42501') return listingNotFound();
  if (failure?.code === '55000') return fail('conflict', DETACH_FAILED, { reason: 'already_decided' });
  return fail('unexpected', DETACH_FAILED);
}

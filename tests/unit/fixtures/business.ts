import type { BusinessLike } from '@/lib/export/public-business';

/**
 * A realistic RGV business row for unit tests.
 *
 * The default `internalNotes` carries the canary ON PURPOSE. A fixture whose internal
 * field is empty, or is a bland string like "notes", cannot prove anything: the sentinel
 * scan would pass on a payload that leaked it. Every consumer of this fixture therefore
 * starts from a row whose internal annotation is unmistakable in a JSON dump.
 *
 * The three name-ish fields are all populated and all different, because the failure mode
 * they exist to prevent is a builder reaching for whichever string is nearest:
 *   legalName   'RIO ROOFING LLC'  — the Comptroller DBA, shouty and often mistyped
 *   displayName 'Rio Roofing'      — the only one a human outside may see
 *   internalNotes                  — ours, and the thing the sentinel hunts for
 */

/** Unmistakable in a JSON dump, and grep-able across the repo. */
export const CANARY = 'INTERNAL-CANARY-7f3a2b';

export function makeBusiness(overrides: Partial<BusinessLike> = {}): BusinessLike {
  return {
    id: '0f2b7c1e-3a44-4c8e-9b21-6d5c8a1e4f70',
    orgId: 'b7c4d21a-9e8f-4a15-8c3d-2f6b0e9a7135',
    legalName: 'RIO ROOFING LLC',
    displayName: 'Rio Roofing',
    internalNotes: `${CANARY} owner is hostile, do not call before 10am`,
    phoneE164: '+19565550143',
    city: 'McAllen',
    status: 'new',
    ...overrides,
  };
}

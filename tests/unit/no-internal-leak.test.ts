/**
 * THE SENTINEL. businesses.internal_notes is the operator's annotation and it must never
 * reach an export row or a push payload. BIS's equivalent — accounts.name, the agency's
 * internal label ("Rio Roofing — trial") — reached customers three times, which is why
 * this file exists before a single builder does.
 *
 * Mutation: add a builder to PAYLOAD_BUILDERS whose build() spreads the whole fixture —
 * 'no registered payload builder emits an internal annotation' goes red, and only that one.
 * Mutation (B-WR-10): make `toPublicBusiness` return its argument — 'B-WR-10: builders are
 * handed a runtime projection, so even a spreading builder cannot leak' goes red.
 *
 * Two halves, and the second is the one BIS lacks. BIS pins its registry against a
 * hard-coded key list, which catches a reorder but not a new builder file nobody
 * registered. Here the directory itself is enumerated, so "I forgot the sentinel" is not
 * a reachable state from Phase 8 onward.
 */
import * as nodeFs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPayload, PAYLOAD_BUILDERS, type PayloadBuilder } from '@/lib/export/registry';
import {
  PUBLIC_BUSINESS_KEYS,
  toPublicBusiness,
  type BusinessLike,
  type PublicBusiness,
} from '@/lib/export/public-business';
import {
  CHAIN_KEY_CANARY,
  makeBusiness,
  NAME_NORM_CANARY,
  STREET_NORM_CANARY,
} from './fixtures/business';

const CANARY = 'INTERNAL-CANARY-7f3a2b';
const EXPORT_DIR = 'src/lib/export';

/**
 * Phase 3 plan 05: the resolver's three match-key columns are INTERNAL (D-12, UI-SPEC
 * Rule 17). A compile-time assertion, because the excess-property check below only fires
 * when somebody WRITES one of these into the literal — it cannot notice PublicBusiness
 * itself being widened to include them. Remove any of the three (or, since B-WR-10,
 * `chainKey`) from the Omit<> in src/lib/export/public-business.ts and tsc fails on this line.
 */
type InternalKeysOmitted =
  Extract<
    keyof PublicBusiness,
    'internalNotes' | 'nameNorm' | 'streetNorm' | 'phoneBlockable' | 'chainKey'
  > extends never
    ? true
    : never;
const internalKeysOmitted: InternalKeysOmitted = true;

/** Key spellings a builder would emit if it spread a row, in both casings. */
const INTERNAL_KEY_NAMES = [
  'internalNotes',
  'internal_notes',
  'nameNorm',
  'name_norm',
  'streetNorm',
  'street_norm',
  'phoneBlockable',
  'phone_blockable',
  // B-WR-10: chain_key is literally name_norm (src/lib/resolve/chain.ts).
  'chainKey',
  'chain_key',
];

/** Every canary the wide fixture carries, one per internal column. */
const CANARIES = [
  CANARY,
  'owner is hostile',
  NAME_NORM_CANARY,
  STREET_NORM_CANARY,
  CHAIN_KEY_CANARY,
];

describe('internal annotations never leave the building', () => {
  it('no registered payload builder emits an internal annotation', () => {
    const fixture = makeBusiness({
      internalNotes: `${CANARY} owner is hostile, do not call before 10am`,
    });

    // Guard the fixture in both directions: the default fixture carries the canary too,
    // so a future edit that quietly drops it from tests/unit/fixtures/business.ts turns
    // this red rather than making every other consumer's scan vacuous.
    expect(makeBusiness().internalNotes).toContain(CANARY);
    expect(fixture.internalNotes).toContain('owner is hostile');
    // Same guard for the three Phase 3 internal columns: a fixture that quietly dropped
    // their canaries would make the scan below vacuous for exactly those columns.
    expect(fixture.nameNorm).toContain(NAME_NORM_CANARY);
    expect(fixture.streetNorm).toContain(STREET_NORM_CANARY);
    expect(fixture.phoneBlockable).toBe(true);
    expect(fixture.chainKey).toContain(CHAIN_KEY_CANARY);
    expect(internalKeysOmitted).toBe(true);

    // What a builder is actually handed. Written out field by field rather than
    // destructured on purpose: when a column is added to BusinessLike this object stops
    // compiling, and somebody has to decide public-or-internal instead of inheriting a
    // spread. Excess-property checking rejects internalNotes here — and, since Phase 3
    // plan 05, nameNorm, streetNorm and phoneBlockable too.
    const publicBusiness: PublicBusiness = {
      id: fixture.id,
      orgId: fixture.orgId,
      legalName: fixture.legalName,
      displayName: fixture.displayName,
      phoneE164: fixture.phoneE164,
      city: fixture.city,
      status: fixture.status,
    };
    // B-WR-10: the runtime projection builds exactly this literal from the WIDE row.
    expect(toPublicBusiness(fixture)).toEqual(publicBusiness);

    // Registered builders are run the way production runs them: handed the wide row through
    // `buildPayload`, never a pre-trimmed literal.
    const payloads = PAYLOAD_BUILDERS.map((builder) => ({
      name: builder.name,
      json: JSON.stringify(buildPayload(builder, fixture)),
    }));

    for (const payload of payloads) {
      // A builder that returned undefined would stringify to undefined and every
      // assertion below would be scanning nothing.
      expect(payload.json, payload.name).toBeTypeOf('string');
      // The whole value AND a distinctive substring of it: a builder that truncated or
      // re-wrapped the note would slip past a whole-value scan alone.
      expect(payload.json, payload.name).not.toContain(CANARY);
      expect(payload.json, payload.name).not.toContain('owner is hostile');
      expect(payload.json, payload.name).not.toContain(NAME_NORM_CANARY);
      expect(payload.json, payload.name).not.toContain(STREET_NORM_CANARY);
      expect(payload.json, payload.name).not.toContain(CHAIN_KEY_CANARY);
      for (const key of INTERNAL_KEY_NAMES) {
        expect(payload.json, `${payload.name} emits ${key}`).not.toContain(`"${key}"`);
      }
    }

    const everything = payloads.map((p) => p.json).join('\n');
    if (PAYLOAD_BUILDERS.length > 0) {
      // A scan that only proves absence passes when everything is broken — a builder
      // returning {} satisfies every assertion above. Prove the RIGHT name went out.
      expect(everything).toContain('Rio Roofing');
    } else {
      // Phase 1 has no builders. Say so out loud, so the vacuous pass is a visible,
      // deliberate state in the test output rather than an accident nobody noticed.
      expect(PAYLOAD_BUILDERS).toHaveLength(0);
    }
  });

  it('B-WR-10: builders are handed a runtime projection, so even a spreading builder cannot leak', () => {
    // `Omit<>` removes nothing at runtime: a full row held in a variable is assignable to
    // PublicBusiness, and a builder that spreads or stringifies its argument would emit every
    // internal column. `buildPayload` projects field by field before any builder sees it.
    const wide = {
      ...makeBusiness(),
      // A column BusinessLike does not even declare, as a full Drizzle row would carry.
      undeclaredColumn: `${CHAIN_KEY_CANARY} undeclared`,
    } as BusinessLike;
    expect(wide.chainKey).toContain(CHAIN_KEY_CANARY);

    const careless: PayloadBuilder = { name: 'careless', build: (b) => ({ ...b }) };
    const json = JSON.stringify(buildPayload(careless, wide));
    for (const canary of CANARIES) expect(json, canary).not.toContain(canary);
    for (const key of INTERNAL_KEY_NAMES) expect(json, key).not.toContain(`"${key}"`);
    expect(json).not.toContain('undeclaredColumn');
    // Absence alone passes when everything is broken: the public name DID go out.
    expect(json).toContain('Rio Roofing');

    // The projection is exactly the public whitelist, at runtime, not only in the type.
    expect(Object.keys(toPublicBusiness(wide)).sort()).toEqual([...PUBLIC_BUSINESS_KEYS].sort());
    expect([...PUBLIC_BUSINESS_KEYS].sort()).toEqual(
      ['city', 'displayName', 'id', 'legalName', 'orgId', 'phoneE164', 'status'].sort(),
    );
  });

  it('every module under src/lib/export is represented in the registry', () => {
    const entries = nodeFs.readdirSync(EXPORT_DIR);

    // A wrong cwd throws; a right-but-empty read would pass vacuously. Pin the two
    // modules that are known to be there so only a real absence can make this green.
    expect(entries).toContain('registry.ts');
    expect(entries).toContain('public-business.ts');

    const modules = entries.filter(
      (f) =>
        f.endsWith('.ts') &&
        !f.startsWith('_') &&
        f !== 'registry.ts' &&
        f !== 'public-business.ts',
    );
    const registered = new Set(PAYLOAD_BUILDERS.map((b) => `${b.name}.ts`));
    expect(modules.filter((m) => !registered.has(m))).toEqual([]);
  });
});

/**
 * THE SENTINEL. businesses.internal_notes is the operator's annotation and it must never
 * reach an export row or a push payload. BIS's equivalent — accounts.name, the agency's
 * internal label ("Rio Roofing — trial") — reached customers three times, which is why
 * this file exists before a single builder does.
 *
 * Mutation: add a builder to PAYLOAD_BUILDERS whose build() spreads the whole fixture —
 * 'no registered payload builder emits an internal annotation' goes red, and only that one.
 *
 * Two halves, and the second is the one BIS lacks. BIS pins its registry against a
 * hard-coded key list, which catches a reorder but not a new builder file nobody
 * registered. Here the directory itself is enumerated, so "I forgot the sentinel" is not
 * a reachable state from Phase 8 onward.
 */
import * as nodeFs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAYLOAD_BUILDERS } from '@/lib/export/registry';
import type { PublicBusiness } from '@/lib/export/public-business';
import { makeBusiness } from './fixtures/business';

const CANARY = 'INTERNAL-CANARY-7f3a2b';
const EXPORT_DIR = 'src/lib/export';

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

    // What a builder is actually handed. Written out field by field rather than
    // destructured on purpose: when a column is added to BusinessLike this object stops
    // compiling, and somebody has to decide public-or-internal instead of inheriting a
    // spread. Excess-property checking rejects internalNotes here.
    const publicBusiness: PublicBusiness = {
      id: fixture.id,
      orgId: fixture.orgId,
      legalName: fixture.legalName,
      displayName: fixture.displayName,
      phoneE164: fixture.phoneE164,
      city: fixture.city,
      status: fixture.status,
    };

    const payloads = PAYLOAD_BUILDERS.map((builder) => ({
      name: builder.name,
      json: JSON.stringify(builder.build(publicBusiness)),
    }));

    for (const payload of payloads) {
      // A builder that returned undefined would stringify to undefined and every
      // assertion below would be scanning nothing.
      expect(payload.json, payload.name).toBeTypeOf('string');
      // The whole value AND a distinctive substring of it: a builder that truncated or
      // re-wrapped the note would slip past a whole-value scan alone.
      expect(payload.json, payload.name).not.toContain(CANARY);
      expect(payload.json, payload.name).not.toContain('owner is hostile');
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

import { redirect } from 'next/navigation';

/**
 * `/` is not a screen. UI-SPEC § App shell § Routes makes it a redirect to the preset
 * list, which is the product's actual front door.
 *
 * Phase 1's three tenant-identity hooks used to live here; they moved verbatim to
 * `/settings/organization` in this plan, along with the spec that asserts them
 * (Executor Rule 7 — a retired testid fails silently, so the hook and its spec move
 * together or not at all). Nothing identifying is rendered on this route any more,
 * because nothing is rendered on this route at all.
 *
 * No auth check here on purpose: the redirect lands inside the `(app)` group, whose
 * layout runs `requireOrg()` as its first statement. Duplicating the gate here would be
 * a second place for it to drift.
 */
export default function Home() {
  redirect('/presets');
}

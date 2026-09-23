import type { PlacesModeName } from '@/lib/ui/copy';
import type { RunKind } from '@/lib/ui/run-tone';

/**
 * Which run actions a Places mode enables, and which one takes the primary slot (04-UI-SPEC
 * § Screen 2, the accent-by-mode table; D-02).
 *
 * Its own tiny module, with no client-boundary directive, because TWO sides read it: the page
 * (a server component: the summary card's cost line follows the primary action) and
 * `RunActions` (a client component: the buttons). Data exported from a client module is a
 * client REFERENCE inside a server component — `undefined` at runtime, every gate green — so the
 * table cannot live in `run-actions.tsx`. And a copy on each side would drift.
 *
 * `queueRun` enforces the same table on the server; this one only decides what is shown.
 */
export type RunActionKey = 'full' | 'partition' | 'check';

export const RUN_ACTION_ORDER: readonly RunActionKey[] = ['full', 'partition', 'check'];

/** The run kind each action starts — `RUN_KIND_LABEL`'s key, so a card row's title and the
 *  summary's cost line name the kind in the words the report and recent runs use. */
export const RUN_KIND_OF_ACTION: Record<RunActionKey, RunKind> = {
  full: 'full_sweep',
  partition: 'partition',
  check: 'change_check',
};

export const MODE_ALLOWS: Record<PlacesModeName, Record<RunActionKey, boolean>> = {
  enterprise: { full: true, partition: true, check: true },
  ids_only: { full: false, partition: false, check: true },
  off: { full: false, partition: false, check: false },
};

/**
 * The primary slot holds the first action the MODE enables, in the order full → partition →
 * check; in `off`, where none is, the inert full sweep. The card holds the other two, in the
 * fixed order — so every action exists exactly once (Rule 40).
 */
export function planRunActions(mode: PlacesModeName): {
  primary: RunActionKey;
  card: RunActionKey[];
} {
  const allows = MODE_ALLOWS[mode];
  const primary = RUN_ACTION_ORDER.find((k) => allows[k]) ?? 'full';
  return { primary, card: RUN_ACTION_ORDER.filter((k) => k !== primary) };
}

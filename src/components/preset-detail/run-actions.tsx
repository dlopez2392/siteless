'use client';

import { forwardRef, useId, type ComponentProps, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { OtherRuns, type OtherRunRow } from '@/components/preset-detail/other-runs';
import {
  RunDrawer,
  type RunPartition,
  type RunVersionOption,
} from '@/components/preset-detail/run-drawer';
import {
  MODE_ALLOWS,
  planRunActions,
  RUN_KIND_OF_ACTION,
  type RunActionKey,
} from '@/components/preset-detail/run-plan';
import { formatWeekRange } from '@/lib/time';
import {
  PRESET_CHECK_DESCRIPTION,
  PRESET_OFF_STICKY_NOTE,
  PRESET_PARTITION_DESCRIPTION,
  PRESET_PARTITION_EMPTY,
  PRESET_PARTITION_WEEK,
  RUN_CHECK_CHANGES,
  RUN_FULL_SWEEP,
  RUN_PARTITION,
  type PlacesModeName,
} from '@/lib/ui/copy';
import { RUN_KIND_LABEL } from '@/lib/ui/run-tone';
import { cn } from '@/lib/utils';

/**
 * The preset page's three ways to run (04-UI-SPEC § Screen 2; D-02, D-16).
 *
 * Rendered TWICE by the page, once per `slot`: `primary` in the title row (the phone's sticky
 * bar, moved by CSS — one DOM element) and `card` as the "Other ways to run" card under the
 * summary. Both halves derive their split from the same `planRunActions(mode)`, so between them
 * every action testid exists EXACTLY ONCE in every mode (Rule 40).
 *
 * 🔴 THE MODE IS A PROP. The page reads `env.PLACES_MODE` on the server and passes the string
 * (Rule 33). This file never reads the environment.
 *
 * 🔴 THE ACCENT GOES TO THE FIRST ENABLED ACTION, full → partition → check, AND IN `off` THERE
 * IS NONE (Rule 34). An accent button that cannot run, as a screen's focal point, is worse than none.
 *
 * 🔴 DISABLED IS `aria-disabled` + A NO-OP CLICK, NEVER THE HTML ATTRIBUTE (Rule 33). The
 * control stays in the focus order and `aria-describedby` points at the reason — the notice, or
 * the zero-cell sentence — so a mystery-disabled button cannot happen. The server action refuses
 * independently (D-02); this is an affordance, not the boundary.
 *
 * 🔴 THIS MODULE EXPORTS A COMPONENT AND TYPES ONLY. A client module's plain-data exports are
 * client REFERENCES inside a server component (`undefined` at runtime, every gate green), so the
 * page imports nothing from here but `RunActions` and erased types.
 */

export type RunActionsProps = {
  slot: 'primary' | 'card';
  mode: PlacesModeName;
  /** The Places-mode notice's element id — every mode-disabled action is described by it. */
  noticeId: string;
  /** Pre-formatted cost lines (`PRESET_COST_*`, or `PRESET_COST_NOT_PRICED`). */
  costs: Record<RunActionKey, string>;
  /** This ISO week's partition, from the same `cellsForRun` / `isoWeekOf` `queueRun` uses.
   *  `null` when the preset cannot be expanded into cells (it cannot be priced either). */
  partition: RunPartition | null;
  drawer: {
    presetName: string;
    initialVersionId: string;
    remainingLabel: string;
    isAdmin: boolean;
    /** Per kind, so a partition drawer quotes the PARTITION's range, not the full sweep's. */
    versions: Record<RunActionKey, RunVersionOption[]>;
  };
};

const TEST_ID: Record<RunActionKey, string> = {
  full: 'run-preset',
  partition: 'run-partition',
  check: 'run-check-changes',
};

/** The button says the verb ("Run this week's partition"); a card row's title names the kind. */
const LABEL: Record<RunActionKey, string> = {
  full: RUN_FULL_SWEEP,
  partition: RUN_PARTITION,
  check: RUN_CHECK_CHANGES,
};

const DISABLED_CLASS = 'cursor-not-allowed opacity-50';

type ActionButtonProps = ComponentProps<typeof Button> & {
  actionKey: RunActionKey;
  enabled: boolean;
  describedBy?: string;
};

/**
 * One run button. `forwardRef` + prop spreading because an ENABLED one is the drawer's
 * `asChild` trigger, and Radix hands its trigger props (`onClick`, `aria-expanded`, the ref)
 * through this component to the real `<button>`.
 */
const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { actionKey, enabled, describedBy, className, onClick, ...rest },
  ref,
) {
  // The no-op half of `aria-disabled`: nothing opens, nothing submits.
  const swallow = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();
  return (
    <Button
      ref={ref}
      type="button"
      {...rest}
      data-testid={TEST_ID[actionKey]}
      data-enabled={enabled ? 'true' : 'false'}
      aria-disabled={enabled ? undefined : true}
      aria-describedby={describedBy}
      onClick={enabled ? onClick : swallow}
      className={cn(className, enabled ? undefined : DISABLED_CLASS)}
    >
      {LABEL[actionKey]}
    </Button>
  );
});

export function RunActions(props: RunActionsProps) {
  const { slot, mode, noticeId, costs, partition, drawer } = props;
  const reasonId = useId();
  const emptyId = `${reasonId}-partition-empty`;
  const unpricedId = `${reasonId}-partition-cost`;
  const { primary, card } = planRunActions(mode);
  const allows = MODE_ALLOWS[mode];

  // 04-27 decision: a partition that covers ZERO cells this week would be admitted, hold one
  // micro-dollar and complete having searched nothing. It is aria-disabled and says why instead.
  // A partition that cannot be computed at all (the preset cannot be expanded into cells) has
  // no drawer to open; its cost line reads "Not priced" and describes it.
  const partitionEmpty = partition !== null && partition.cells === 0;

  function enabledOf(key: RunActionKey): boolean {
    if (!allows[key]) return false;
    if (key === 'partition') return partition !== null && partition.cells > 0;
    return true;
  }

  function describedByOf(key: RunActionKey): string | undefined {
    const ids: string[] = [];
    if (!allows[key]) ids.push(noticeId);
    if (key === 'partition' && partitionEmpty) ids.push(emptyId);
    if (key === 'partition' && partition === null) ids.push(unpricedId);
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  function trigger(key: RunActionKey, variant: 'default' | 'outline', className: string) {
    const enabled = enabledOf(key);
    const button = (
      <ActionButton
        actionKey={key}
        enabled={enabled}
        describedBy={describedByOf(key)}
        variant={enabled ? variant : 'outline'}
        className={className}
      />
    );
    if (!enabled) return button;

    const common = {
      presetName: drawer.presetName,
      versions: drawer.versions[key],
      initialVersionId: drawer.initialVersionId,
      pickable: false,
      remainingLabel: drawer.remainingLabel,
      isAdmin: drawer.isAdmin,
    };
    // `enabledOf('partition')` is only true with a partition in hand; the check is for tsc.
    if (key === 'partition' && partition) {
      return (
        <RunDrawer kind="partition" partition={partition} {...common}>
          {button}
        </RunDrawer>
      );
    }
    return (
      <RunDrawer kind={key === 'check' ? 'check' : 'full'} {...common}>
        {button}
      </RunDrawer>
    );
  }

  if (slot === 'primary') {
    /* Phone: a sticky bar ABOVE the 64px tab bar and its safe-area inset; from 640px up, the
       title row. The WRAPPER moves, not the button, so the off-mode line travels with it and
       the button stays one element (touch-target rule: one visible match per testid). */
    return (
      <div
        data-testid="run-primary-slot"
        className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex flex-col gap-2 sm:static sm:inset-auto sm:z-auto"
      >
        {trigger(primary, 'default', 'h-12 w-full shadow-lg sm:h-9 sm:w-auto sm:shadow-none')}
        {mode === 'off' ? (
          <p
            data-testid="run-off-sticky-note"
            className="bg-background text-center text-sm font-normal text-muted-foreground sm:hidden"
          >
            {PRESET_OFF_STICKY_NOTE}
          </p>
        ) : null}
      </div>
    );
  }

  const rows: OtherRunRow[] = card.map((key) => {
    // The full sweep reaches the card only when it is not the primary (ids_only). The spec gives
    // it no description: its cost line ("… · every cell") is what it has to say.
    const description =
      key === 'partition'
        ? PRESET_PARTITION_DESCRIPTION
        : key === 'check'
          ? PRESET_CHECK_DESCRIPTION
          : null;
    const extra =
      key === 'partition' && partition ? (
        <>
          <p
            data-testid="run-partition-week"
            className="text-sm font-normal tabular-nums text-muted-foreground"
          >
            {PRESET_PARTITION_WEEK(
              partition.isoWeek,
              formatWeekRange(partition.mondayIso, partition.sundayIso),
            )}
          </p>
          {partitionEmpty ? (
            <p
              id={emptyId}
              data-testid="run-partition-empty"
              className="text-sm font-normal text-muted-foreground"
            >
              {PRESET_PARTITION_EMPTY(partition.totalCells, partition.isoWeek)}
            </p>
          ) : null}
        </>
      ) : undefined;
    return {
      key,
      // The row's title names the kind ("This week's partition"); its button says the verb.
      title: RUN_KIND_LABEL[RUN_KIND_OF_ACTION[key]],
      description,
      costLine: costs[key],
      costTestId: `run-cost-${key}`,
      costId: key === 'partition' && partition === null ? unpricedId : undefined,
      extra,
      action: trigger(key, 'outline', 'h-11 w-full sm:w-auto'),
    };
  });

  return <OtherRuns rows={rows} />;
}

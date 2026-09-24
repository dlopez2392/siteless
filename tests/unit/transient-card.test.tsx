import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { TransientCard, TransientCardSkeleton } from '@/components/sources/transient-card';
import {
  PURGE_OVERDUE_HOURS,
  PURGE_PLACES_COMMAND,
  purgeOverdue,
  type TransientStats,
} from '@/lib/places/purge-status';
import {
  COPY_FAILED,
  PLACES_ACTION,
  SOURCES_TRANSIENT_EMPTY_HEADING,
  SOURCES_TRANSIENT_LABEL,
  SOURCES_TRANSIENT_LOAD_FAILED,
  SOURCES_TRANSIENT_NEVER_RUN,
  SOURCES_TRANSIENT_NONE_HELD,
  SOURCES_TRANSIENT_PURGE_COPY,
  SOURCES_TRANSIENT_TITLE,
} from '@/lib/ui/copy';

/**
 * The `/sources` transient card (04-17, D-12; 04-UI-SPEC § Screen 4, Rules 27 and 37) and the
 * pure purge-overdue rule behind its warning.
 *
 * 🔴 THE SUITE RUNS IN UTC (vitest.config.ts), so the last-purge instant below is one that is
 * a DIFFERENT DAY in Chicago than in UTC: a card that forgot the pinned zone renders
 * "Sep 23, 3:30 AM" and the Chicago assertion ("Sep 22, 10:30 PM") goes red.
 */

afterEach(cleanup);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2026-09-23T03:30:00Z — Sep 22, 10:30 PM in Chicago; Sep 23, 3:30 AM in UTC. */
const PURGED_AT = Date.UTC(2026, 8, 23, 3, 30);

const NONE: TransientStats = {
  placeIdsHeld: 0,
  coordinatesHeld: 0,
  oldestCoordinateMs: null,
  expiredAwaitingPurge: 0,
  lastPurgeMs: null,
  lastRowsPurged: null,
};

function stats(partial: Partial<TransientStats>): TransientStats {
  return { ...NONE, ...partial };
}

describe('purge overdue', () => {
  const now = PURGED_AT + 2 * HOUR;

  it('purge overdue when expired rows await purge', () => {
    // A purge that ran two hours ago does not excuse a row that is past 30 days NOW.
    expect(purgeOverdue(stats({ expiredAwaitingPurge: 1, lastPurgeMs: PURGED_AT }), now)).toBe(
      true,
    );
  });

  it('purge overdue when the last purge is more than 36 hours old', () => {
    expect(PURGE_OVERDUE_HOURS).toBe(36);
    const last = now - 36 * HOUR - 1;
    expect(purgeOverdue(stats({ lastPurgeMs: last }), now)).toBe(true);
    // Exactly 36 hours is the boundary, not past it.
    expect(purgeOverdue(stats({ lastPurgeMs: now - 36 * HOUR }), now)).toBe(false);
  });

  it('purge overdue when the purge never ran and coordinates are older than 36 hours', () => {
    const s = stats({ coordinatesHeld: 4, oldestCoordinateMs: now - 37 * HOUR });
    expect(purgeOverdue(s, now)).toBe(true);
  });

  it('not overdue when fresh', () => {
    const s = stats({
      placeIdsHeld: 9,
      coordinatesHeld: 4,
      oldestCoordinateMs: now - 12 * DAY,
      lastPurgeMs: now - 20 * HOUR,
      lastRowsPurged: 2,
    });
    expect(purgeOverdue(s, now)).toBe(false);
    // Never purged, but every coordinate is younger than 36 hours: the cron has not had
    // its first chance yet.
    const young = stats({ coordinatesHeld: 1, oldestCoordinateMs: now - 3 * HOUR });
    expect(purgeOverdue(young, now)).toBe(false);
  });

  it('not overdue before any call', () => {
    expect(purgeOverdue(NONE, now)).toBe(false);
  });
});

describe('the transient card', () => {
  it('the transient card renders its five figures before any call', () => {
    render(<TransientCard stats={NONE} nowMs={PURGED_AT} />);

    const card = screen.getByTestId('sources-transient');
    expect(card).toHaveTextContent(SOURCES_TRANSIENT_TITLE);
    for (const label of Object.values(SOURCES_TRANSIENT_LABEL)) {
      expect(card).toHaveTextContent(label);
    }
    expect(screen.getByTestId('sources-transient-place-ids')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('sources-transient-place-ids')).toHaveTextContent('0');
    expect(screen.getByTestId('sources-transient-coordinates')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('sources-transient-oldest')).toHaveTextContent(
      SOURCES_TRANSIENT_NONE_HELD,
    );
    expect(screen.getByTestId('sources-transient-oldest')).not.toHaveAttribute('data-days');
    expect(screen.getByTestId('sources-transient-last-purge')).toHaveTextContent(
      SOURCES_TRANSIENT_NEVER_RUN,
    );
    expect(screen.getByTestId('sources-transient-purged')).toHaveAttribute('data-count', '0');

    // The inline empty state: its heading and the way out, inside the card.
    const empty = within(card).getByTestId('sources-transient-empty');
    expect(empty).toHaveTextContent(SOURCES_TRANSIENT_EMPTY_HEADING);
    const action = within(empty).getByRole('link', { name: PLACES_ACTION.openPresets });
    expect(action).toHaveAttribute('href', '/presets');

    expect(screen.queryByTestId('sources-transient-purge-overdue')).toBeNull();
  });

  it('the transient card is not a ledger row', () => {
    const { container } = render(
      <TransientCard
        stats={stats({ placeIdsHeld: 3, coordinatesHeld: 2, oldestCoordinateMs: PURGED_AT })}
        nowMs={PURGED_AT + HOUR}
      />,
    );
    expect(container.querySelectorAll('[data-testid^="sources-row-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="sources-card-"]')).toHaveLength(0);
    // Every hook on it is `sources-transient*` (Rule 37).
    for (const el of container.querySelectorAll('[data-testid]')) {
      expect(el.getAttribute('data-testid')).toMatch(/^sources-transient/);
    }

    const card = screen.getByTestId('sources-transient');
    // A shadcn `Card` (Rule 6: no hand-rolled surface), with the dashed hairline.
    expect(card).toHaveAttribute('data-slot', 'card');
    expect(card).toHaveClass('border-dashed');
    expect(card).toHaveClass('border');
    // No table semantics at all: it is not a fifth row of anything.
    expect(container.querySelector('table, tr, td')).toBeNull();
  });

  it('oldest coordinates read in days with the 30-day limit', () => {
    const now = PURGED_AT + 2 * HOUR;
    render(
      <TransientCard
        stats={stats({
          placeIdsHeld: 1204,
          coordinatesHeld: 1188,
          oldestCoordinateMs: now - 12 * DAY - 5 * HOUR,
          lastPurgeMs: PURGED_AT,
          lastRowsPurged: 37,
        })}
        nowMs={now}
      />,
    );
    const oldest = screen.getByTestId('sources-transient-oldest');
    expect(oldest).toHaveAttribute('data-days', '12');
    expect(oldest).toHaveTextContent('12 days old · limit 30');

    expect(screen.getByTestId('sources-transient-place-ids')).toHaveAttribute('data-count', '1204');
    expect(screen.getByTestId('sources-transient-place-ids')).toHaveTextContent('1,204');
    expect(screen.getByTestId('sources-transient-coordinates')).toHaveTextContent('1,188');
    expect(screen.getByTestId('sources-transient-purged')).toHaveAttribute('data-count', '37');
    // Chicago, not UTC: one instant, two zones, opposite days.
    const lastPurge = screen.getByTestId('sources-transient-last-purge');
    expect(lastPurge).toHaveTextContent('Sep 22, 10:30 PM');
    expect(lastPurge).not.toHaveTextContent('Sep 23');

    expect(screen.queryByTestId('sources-transient-empty')).toBeNull();
    expect(screen.queryByTestId('sources-transient-purge-overdue')).toBeNull();
  });

  it('the overdue alert offers the desk purge command', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const now = PURGED_AT + 40 * HOUR;
    render(
      <TransientCard
        stats={stats({
          placeIdsHeld: 5,
          coordinatesHeld: 2,
          oldestCoordinateMs: now - 29 * DAY,
          expiredAwaitingPurge: 3,
          lastPurgeMs: PURGED_AT,
          lastRowsPurged: 0,
        })}
        nowMs={now}
      />,
    );
    const alert = screen.getByTestId('sources-transient-purge-overdue');
    expect(within(screen.getByTestId('sources-transient')).getByTestId(
      'sources-transient-purge-overdue',
    )).toBe(alert);
    expect(alert).toHaveTextContent('Sep 22, 10:30 PM');
    expect(alert).toHaveTextContent('40 hours ago');
    expect(alert).toHaveTextContent('3 coordinates are past 30 days');

    const copy = within(alert).getByTestId('sources-transient-purge-copy');
    expect(copy).toHaveTextContent(SOURCES_TRANSIENT_PURGE_COPY);
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(PURGE_PLACES_COMMAND).toBe('pnpm purge:places --target=prod');
    expect(writeText).toHaveBeenCalledWith('pnpm purge:places --target=prod');
  });

  it('a refused clipboard still leaves the purge command readable (C-WR-08)', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    toastError.mockClear();

    const now = PURGED_AT + 40 * HOUR;
    render(
      <TransientCard
        stats={stats({ placeIdsHeld: 5, coordinatesHeld: 2, lastPurgeMs: PURGED_AT })}
        nowMs={now}
      />,
    );
    const alert = screen.getByTestId('sources-transient-purge-overdue');
    // The command is on screen whether or not the clipboard works — the sentence doesn't name it.
    expect(within(alert).getByTestId('sources-transient-purge-command')).toHaveTextContent(
      PURGE_PLACES_COMMAND,
    );
    await act(async () => {
      fireEvent.click(within(alert).getByTestId('sources-transient-purge-copy'));
    });
    expect(writeText).toHaveBeenCalled();
    // A refused copy says so, with the command itself — never silence.
    expect(toastError).toHaveBeenCalledWith(COPY_FAILED(PURGE_PLACES_COMMAND));
  });

  it('the overdue alert names a purge that never ran', () => {
    const now = PURGED_AT;
    render(
      <TransientCard
        stats={stats({ placeIdsHeld: 2, coordinatesHeld: 2, oldestCoordinateMs: now - 3 * DAY })}
        nowMs={now}
      />,
    );
    const alert = screen.getByTestId('sources-transient-purge-overdue');
    expect(alert).toHaveTextContent('never run');
    expect(alert).toHaveTextContent('72 hours');
    expect(alert).not.toHaveTextContent(SOURCES_TRANSIENT_NEVER_RUN + ' —');
    expect(within(alert).getByTestId('sources-transient-purge-copy')).toBeInTheDocument();
  });

  it('the transient card shows its own load failure', () => {
    render(<TransientCard stats={null} nowMs={PURGED_AT} />);
    const card = screen.getByTestId('sources-transient');
    expect(card).toHaveTextContent(SOURCES_TRANSIENT_TITLE);
    const failed = within(card).getByTestId('sources-transient-load-failed');
    expect(failed).toHaveTextContent(SOURCES_TRANSIENT_LOAD_FAILED);
    expect(within(failed).getByRole('link', { name: PLACES_ACTION.tryAgain })).toHaveAttribute(
      'href',
      '/sources',
    );
    expect(screen.queryByTestId('sources-transient-place-ids')).toBeNull();
  });

  it('the transient card skeleton paints the title and the five labels', () => {
    render(<TransientCardSkeleton />);
    const card = screen.getByTestId('sources-transient-skeleton');
    expect(card).toHaveTextContent(SOURCES_TRANSIENT_TITLE);
    for (const label of Object.values(SOURCES_TRANSIENT_LABEL)) {
      expect(card).toHaveTextContent(label);
    }
  });
});

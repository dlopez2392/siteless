import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfidenceDistribution } from '@/components/sources/confidence-distribution';
import { AttributionBlock } from '@/components/sources/attribution-block';
import { SourceLedger } from '@/components/sources/source-ledger';
import { SourcesSkeleton } from '@/components/sources/sources-skeleton';
import { ATTRIBUTION_BODY, INGEST_COMMAND, SOURCES_NEVER_RUN } from '@/lib/ui/copy';
import type { SourceLedgerRow } from '@/server/queries/sources';

/**
 * `/sources` (03-17), rendered — the properties a grep cannot see.
 *
 * - Executor Rule 27: the four source rows exist with NO query rows at all.
 * - The counts are pinned through `data-count`, the number, not the formatted phrase.
 * - A failed run shows its own error, inside its own row, naming the script it was run by.
 * - The Overture distribution is closed by default, opens on its trigger, and its bars are
 *   clamped: a malformed band can neither go negative nor exceed its track (T-3-03).
 * - The attribution renders the licence sentence from the copy module, verbatim.
 *
 * The type import of `@/server/queries/sources` is erased at compile time, so the dom lane's
 * armed server-side import guard is never tripped.
 */

afterEach(cleanup);

const KEYS = ['tx_comptroller', 'tx_comptroller_closures', 'overture', 'census_geocoder'] as const;

function row(partial: Partial<SourceLedgerRow> & Pick<SourceLedgerRow, 'sourceKey'>): SourceLedgerRow {
  return {
    datasetId: null,
    sourceVersion: null,
    lastRunAt: null,
    finishedAt: null,
    status: null,
    added: 0,
    changed: 0,
    unchanged: 0,
    gone: 0,
    totalSeen: 0,
    error: null,
    confidenceBands: null,
    ...partial,
  };
}

describe('sources ledger', () => {
  it('sources ledger renders four rows before any run', () => {
    render(<SourceLedger rows={[]} />);

    const table = screen.getByTestId('sources-table');
    for (const key of KEYS) {
      const desk = within(table).getByTestId(`sources-row-${key}`);
      expect(desk).toHaveTextContent(SOURCES_NEVER_RUN);
      for (const kind of ['added', 'changed', 'unchanged', 'gone']) {
        expect(screen.getByTestId(`sources-count-${key}-${kind}`)).toHaveAttribute('data-count', '0');
        expect(screen.getByTestId(`sources-card-count-${key}-${kind}`)).toHaveAttribute(
          'data-count',
          '0',
        );
      }
      expect(screen.getByTestId(`sources-card-${key}`)).toBeInTheDocument();
    }
    // The static dataset ids the spec names on the two Comptroller rows.
    expect(within(table).getByTestId('sources-row-tx_comptroller')).toHaveTextContent('jrea-zgmq');
    expect(within(table).getByTestId('sources-row-tx_comptroller_closures')).toHaveTextContent(
      '3kx8-uryv',
    );
  });

  it('sources ledger pins counts as numbers and formats them with the pinned locale', () => {
    render(
      <SourceLedger
        rows={[
          row({
            sourceKey: 'overture',
            lastRunAt: new Date('2026-09-21T01:00:00.000Z'),
            status: 'complete',
            sourceVersion: '2026-08-19.0',
            added: 57_012,
            changed: 3,
            unchanged: 0,
            gone: 41,
          }),
        ]}
      />,
    );

    const added = screen.getByTestId('sources-count-overture-added');
    expect(added).toHaveAttribute('data-count', '57012');
    expect(added).toHaveTextContent('57,012');
    expect(screen.getByTestId('sources-card-count-overture-gone')).toHaveAttribute('data-count', '41');
    expect(screen.getByTestId('sources-status-overture')).toHaveTextContent('Complete');
    // 01:00Z is 8 PM the previous day in the RGV; the suite runs in UTC, so a formatter
    // that forgot the zone renders Sep 21 and this goes red.
    expect(screen.getByTestId('sources-row-overture')).toHaveTextContent('Sep 20, 8:00 PM');
    // The other three still render, as never run.
    expect(screen.getByTestId('sources-row-census_geocoder')).toHaveTextContent(SOURCES_NEVER_RUN);
  });

  it('a failed run shows its error in its own row with the script that re-runs it', () => {
    render(
      <SourceLedger
        rows={[
          row({
            sourceKey: 'tx_comptroller_closures',
            lastRunAt: new Date('2026-09-21T01:00:00.000Z'),
            status: 'failed',
            totalSeen: 1234,
            error: 'socrata 503 <b>not markup</b>',
          }),
          row({
            sourceKey: 'overture',
            lastRunAt: new Date('2026-09-21T01:00:00.000Z'),
            status: 'stopped',
            totalSeen: 800,
          }),
        ]}
      />,
    );

    const failed = screen.getByTestId('sources-run-failed-tx_comptroller_closures');
    expect(failed).toHaveTextContent('failed after 1,234 rows: socrata 503 <b>not markup</b>');
    expect(failed).toHaveTextContent(INGEST_COMMAND.comptroller);
    // T-3-03: third-party text is a text node, never markup.
    expect(failed.querySelector('b')).toBeNull();
    expect(screen.getByTestId('sources-status-tx_comptroller_closures')).toHaveTextContent('Failed');

    expect(screen.getByTestId('sources-run-stopped-overture')).toHaveTextContent(
      'stopped early after 800 rows',
    );
    expect(screen.getByTestId('sources-status-overture')).toHaveTextContent('Stopped early');
    // No alert on a source that did not fail or stop.
    expect(screen.queryByTestId('sources-run-failed-tx_comptroller')).toBeNull();
  });
});

describe('confidence distribution', () => {
  it('confidence distribution opens to clamped bands and the cutoff line', async () => {
    render(
      <ConfidenceDistribution
        testId="sources-confidence-toggle"
        bands={{
          '0.9-1.0': 35_270,
          '=1.0': 10,
          '0.4-0.5': 100,
          null: 5,
          '0.2-0.3': -40,
        }}
      />,
    );

    const toggle = screen.getByTestId('sources-confidence-toggle');
    expect(toggle).toHaveTextContent('Show the confidence distribution');
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveTextContent('Hide the confidence distribution');

    const content = screen.getByTestId('sources-confidence-toggle-content');
    const bands = [...content.querySelectorAll('[data-band]')].map((el) => el.getAttribute('data-band'));
    // Highest confidence first; the no-confidence bucket after every numeric band.
    expect(bands).toEqual(['=1.0', '0.9-1.0', '0.4-0.5', '0.2-0.3', 'null']);

    // A negative count renders as 0 and its bar sits at the start of the track.
    const negative = content.querySelector('[data-band="0.2-0.3"]');
    expect(negative).toHaveAttribute('data-count', '0');
    for (const indicator of content.querySelectorAll('[data-slot=progress-indicator]')) {
      const shift = Number(/translateX\(-(\d+(?:\.\d+)?)%\)/.exec(indicator.getAttribute('style') ?? '')?.[1]);
      expect(shift).toBeGreaterThanOrEqual(0);
      expect(shift).toBeLessThanOrEqual(100);
    }

    expect(screen.getByTestId('sources-confidence-toggle-cutoff')).toHaveTextContent(
      'Funnel cutoff: 0.30 — rows below this stay in the spine and never enter the lead funnel.',
    );
    // The marker sits above the first band wholly below the cutoff: 0.3 since the 03-20 desk
    // run (danlo, 2026-09-23). A re-tune of OVERTURE_CONFIDENCE_CUTOFF must red this pin.
    const marker = screen.getByTestId('sources-confidence-toggle-cutoff-marker');
    expect(marker.parentElement?.querySelector('[data-band]')).toHaveAttribute('data-band', '0.2-0.3');
  });

  it('confidence distribution renders nothing without bands', () => {
    const { container } = render(<ConfidenceDistribution testId="t" bands={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('sources skeleton and attribution', () => {
  it('the skeleton paints the four source names', () => {
    render(<SourcesSkeleton />);
    const skeleton = screen.getByTestId('sources-skeleton');
    for (const name of ['Comptroller permits', 'Comptroller closures', 'Overture places', 'Census geocoder']) {
      expect(within(skeleton).getAllByText(name).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the attribution block renders the licence sentence verbatim', () => {
    render(<AttributionBlock />);
    const block = screen.getByTestId('sources-attribution');
    expect(block).toHaveTextContent('Where this data comes from');
    expect(block).toHaveTextContent(ATTRIBUTION_BODY);
    expect(block).toHaveTextContent('CDLA-Permissive 2.0');
    expect(block).toHaveTextContent('None of this is Google data');
  });
});

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLocal } from '@/lib/time';
import {
  BUSINESS_SECTION,
  FIELD_NO_DURABLE_SOURCE,
  FIELD_NOT_STORED,
  SOURCE_NAME,
  SOURCES_COLUMN,
  STALE_SOURCE_RECORD,
} from '@/lib/ui/copy';
import type { SourceRecordRow } from '@/server/queries/businesses';

/**
 * "Source records" — one row per durable record that built this business: source, version
 * ingested, external id, first seen, last seen (03-UI-SPEC § 4, section 3).
 *
 * 🔴 A `gone` RECORD IS SAID IN WORDS (D-05). When a later complete run of the same source did
 * not see a record, its `last_seen_at` stops advancing. Left as a date, that is a silent stale
 * value nobody notices; so the last-seen slot reads "Last seen in the {version} release — not
 * in the latest run" instead. Nothing is deleted on an absence alone — this is where a human
 * finds out it happened.
 *
 * Records of businesses merged INTO this one are listed too (03-15 reads them): their values
 * stay on their own parents (D-14), and this is the list an unmerge restores from.
 */

/** Row labels with no Copy Table entry — see 03-19-SUMMARY "Copy gaps". */
const RECORD_LABEL = {
  externalId: 'External id',
  firstSeen: 'First seen',
  lastSeen: 'Last seen',
} as const;

function dateOf(at: Date | null): string {
  return at === null ? FIELD_NOT_STORED : formatLocal(at, { month: 'short', day: 'numeric', year: 'numeric' });
}

function LabelValue({ label, children, testid }: { label: string; children: string; testid?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm font-normal text-muted-foreground">{label}</dt>
      <dd data-testid={testid} className="text-base font-normal tabular-nums break-all">
        {children}
      </dd>
    </div>
  );
}

export function SourceRecords({ records }: { records: SourceRecordRow[] }) {
  return (
    <Card data-testid="business-source-records">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{BUSINESS_SECTION.sourceRecords}</CardTitle>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="text-sm font-normal text-muted-foreground">{FIELD_NO_DURABLE_SOURCE}</p>
        ) : (
          <ul className="divide-y divide-border">
            {records.map((r) => {
              const lastSeen = r.stale
                ? STALE_SOURCE_RECORD(r.sourceVersion ?? dateOf(r.lastSeenAt))
                : dateOf(r.lastSeenAt);
              return (
                <li
                  key={r.id}
                  data-testid={`business-source-record-${r.id}`}
                  data-stale={r.stale ? 'true' : 'false'}
                  className="flex flex-col gap-4 py-4"
                >
                  <p className="text-sm font-semibold">
                    {r.sourceKey === null ? FIELD_NO_DURABLE_SOURCE : SOURCE_NAME[r.sourceKey]}
                  </p>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <LabelValue label={SOURCES_COLUMN.version}>{r.sourceVersion ?? FIELD_NOT_STORED}</LabelValue>
                    <LabelValue label={RECORD_LABEL.externalId}>{r.externalId ?? FIELD_NOT_STORED}</LabelValue>
                    <LabelValue label={RECORD_LABEL.firstSeen}>{dateOf(r.firstSeenAt)}</LabelValue>
                    <LabelValue
                      label={RECORD_LABEL.lastSeen}
                      testid={`business-source-record-${r.id}-last-seen`}
                    >
                      {lastSeen}
                    </LabelValue>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

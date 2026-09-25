import { Fragment, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { PRESET_CARD } from '@/lib/ui/copy';

/**
 * "Other ways to run" (04-UI-SPEC § Screen 2): the two run actions that are not in the primary
 * slot, one `Item` row each, in the fixed order full sweep → partition → change check.
 *
 * Presentational and server-safe (no client-boundary directive): `RunActions` decides which two
 * rows exist and hands each its trigger as `action`. A row never decides whether it is enabled.
 *
 * Type and spacing are the spec's, not the `Item` primitive's defaults: the primitive's title is
 * 14/500 and its padding 10/12px, none of which is in this system (§ Typography, § Spacing).
 */
export type OtherRunRow = {
  key: 'full' | 'partition' | 'check';
  title: string;
  /** One sentence; `null` renders none (the full sweep has no spec'd description). */
  description: string | null;
  /** The pre-formatted cost line (Label 14/400 muted, tabular). */
  costLine: string;
  costTestId: string;
  /** Set when a disabled action is described by its own cost line. */
  costId?: string;
  /** Extra lines under the cost line — the partition's week, or why it is disabled. */
  extra?: ReactNode;
  /** The trigger: a 44px outline button, right-aligned on desk, full width on phone. */
  action: ReactNode;
};

export function OtherRuns({ rows }: { rows: OtherRunRow[] }) {
  return (
    <Card data-testid="preset-other-runs">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{PRESET_CARD.otherWays}</CardTitle>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-0">
          {rows.map((row, i) => (
            <Fragment key={row.key}>
              {i > 0 ? <ItemSeparator className="my-2" /> : null}
              <Item data-testid={`preset-other-run-${row.key}`} className="gap-4 px-0 py-2">
                <ItemContent className="min-w-0 basis-full sm:basis-0">
                  <ItemTitle className="line-clamp-none text-base font-normal">
                    {row.title}
                  </ItemTitle>
                  {row.description ? (
                    <ItemDescription className="line-clamp-none text-sm font-normal">
                      {row.description}
                    </ItemDescription>
                  ) : null}
                  <p
                    id={row.costId}
                    data-testid={row.costTestId}
                    className="text-sm font-normal tabular-nums text-muted-foreground"
                  >
                    {row.costLine}
                  </p>
                  {row.extra}
                </ItemContent>
                <ItemActions className="w-full sm:w-auto">{row.action}</ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

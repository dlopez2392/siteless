import { Card } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SOURCE_NAME, SOURCES_COLUMN } from '@/lib/ui/copy';
import { COUNT_KINDS, LEDGER_SOURCES } from '@/components/sources/source-ledger';

/**
 * `/sources` loading state (03-UI-SPEC § States → Loading): four row skeletons, one per
 * source, with the count columns as 14px blocks.
 *
 * 🔴 THE FOUR SOURCE NAMES ARE REAL TEXT, NOT SKELETONS. They are static structure
 * (Executor Rule 27), so they paint on first render; only the version, the last run and the
 * counts suspend. The geometry matches `SourceLedger` so nothing jumps when data lands.
 */
export function SourcesSkeleton() {
  return (
    <div data-testid="sources-skeleton" aria-busy="true" className="contents">
      <Card className="hidden gap-0 py-0 sm:flex">
        <Table>
          <TableHeader>
            <TableRow className="bg-sidebar hover:bg-sidebar">
              <TableHead className="px-4 text-sm font-semibold">{SOURCES_COLUMN.source}</TableHead>
              <TableHead className="px-4 text-sm font-semibold">{SOURCES_COLUMN.version}</TableHead>
              <TableHead className="px-4 text-sm font-semibold">{SOURCES_COLUMN.lastRun}</TableHead>
              {COUNT_KINDS.map((kind) => (
                <TableHead key={kind} className="px-4 text-right text-sm font-semibold">
                  {SOURCES_COLUMN[kind]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {LEDGER_SOURCES.map((source) => (
              <TableRow key={source.key} className="align-top hover:bg-transparent">
                <TableCell className="px-4 py-4 whitespace-normal">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-base font-semibold">{SOURCE_NAME[source.key]}</span>
                    {source.datasetId ? (
                      <span className="text-sm font-normal text-muted-foreground">
                        {source.datasetId}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="px-4 py-4">
                  <Skeleton className="h-3.5 w-24" />
                </TableCell>
                <TableCell className="px-4 py-4">
                  <Skeleton className="h-3.5 w-28" />
                </TableCell>
                {COUNT_KINDS.map((kind) => (
                  <TableCell key={kind} className="px-4 py-4">
                    <Skeleton className="ml-auto h-3.5 w-12" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ItemGroup className="gap-4 sm:hidden">
        {LEDGER_SOURCES.map((source) => (
          <Item
            key={source.key}
            variant="outline"
            className="flex-col items-stretch gap-4 bg-card p-4"
          >
            <ItemContent className="gap-1">
              <ItemTitle className="text-xl font-semibold leading-tight">
                {SOURCE_NAME[source.key]}
              </ItemTitle>
              {source.datasetId ? (
                <p className="text-sm font-normal text-muted-foreground">{source.datasetId}</p>
              ) : null}
            </ItemContent>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {COUNT_KINDS.map((kind) => (
                <div key={kind} className="flex flex-col gap-1">
                  <span className="text-sm font-normal text-muted-foreground">
                    {SOURCES_COLUMN[kind]}
                  </span>
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}

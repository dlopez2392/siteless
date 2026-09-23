import { OctagonX, Search, Store } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  BUSINESS_SEARCH_FAILED,
  BUSINESSES_EMPTY_ACTION,
  BUSINESSES_EMPTY_BODY,
  BUSINESSES_EMPTY_HEADING,
  BUSINESSES_NO_MATCH_BODY,
  BUSINESSES_NO_MATCH_HEADING,
  ERROR_ACTION,
} from '@/lib/ui/copy';
import { SearchRetryButton } from './business-filters';

/**
 * `/businesses` — the two empty states and the failed-search state (03-UI-SPEC § States).
 *
 * Every sentence is imported from `copy.ts`, never retyped: a paraphrase in a component is
 * invisible to review and permanent. No screen here ever says "No data" or "No results".
 *
 * 🔴 NO ACCENT BUTTON. `/businesses` has no primary CTA (03-UI-SPEC § Copywriting Contract);
 * the actions below are outline buttons — real 44px targets — rather than the filled accent.
 *
 * No client directive: these render inside the page's server component. The one control that
 * needs the router ("Try again") is imported from the client filters module as a COMPONENT,
 * which is what may cross that boundary; data never does (Executor Rule 5).
 */

const MEDIA = 'size-12 rounded-full bg-muted text-muted-foreground';
const TITLE = 'text-xl font-semibold leading-tight';
const BODY = 'max-w-[60ch] text-base font-normal text-muted-foreground';
/** A long pasted query must wrap inside the heading rather than widen the page. */
const TITLE_WRAPPING = `${TITLE} [overflow-wrap:anywhere]`;

/** `store` / "The spine is empty" — no business exists for this org at all. */
export function BusinessesEmpty() {
  return (
    <Empty data-testid="businesses-empty" className="border border-dashed py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon" className={MEDIA}>
          <Store className="size-6" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className={TITLE}>{BUSINESSES_EMPTY_HEADING}</EmptyTitle>
        <EmptyDescription className={BODY}>{BUSINESSES_EMPTY_BODY}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" className="h-11 w-full text-base font-normal sm:w-auto">
          <Link href="/sources" data-testid="businesses-empty-sources">
            {BUSINESSES_EMPTY_ACTION}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * `search` / "No business matches “{query}”". The person's own words are quoted back
 * verbatim, because they are the thing that matched nothing. The action is "Clear search"
 * for a typed query; the page passes "Clear filters" when only the filters narrowed the
 * list to nothing.
 */
export function BusinessesNoMatch({
  quoted,
  actionHref,
  actionLabel,
}: {
  quoted: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <Empty data-testid="businesses-no-match" className="border border-dashed py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon" className={MEDIA}>
          <Search className="size-6" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className={TITLE_WRAPPING}>{BUSINESSES_NO_MATCH_HEADING(quoted)}</EmptyTitle>
        <EmptyDescription className={BODY}>{BUSINESSES_NO_MATCH_BODY}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" className="h-11 w-full text-base font-normal sm:w-auto">
          <Link href={actionHref} scroll={false} data-testid="businesses-clear-search">
            {actionLabel}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * The search failed on the server (03-UI-SPEC § Error → Business search failed). The box
 * above is untouched — it lives outside this region — and the sentence says so. Two ways
 * out: re-run the same search, or keep the query and drop the filters.
 */
export function BusinessesSearchFailed({ clearFiltersHref }: { clearFiltersHref: string }) {
  return (
    <Alert
      role="alert"
      data-testid="businesses-search-failed"
      className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
    >
      <OctagonX aria-hidden="true" className="size-5" />
      <AlertTitle className="text-base font-semibold text-balance">
        {BUSINESS_SEARCH_FAILED}
      </AlertTitle>
      <AlertDescription className="text-inherit">
        <div className="flex flex-wrap items-center gap-2">
          <SearchRetryButton />
          <Button asChild variant="ghost" className="h-11 text-base font-normal">
            <Link href={clearFiltersHref} scroll={false} data-testid="businesses-clear-filters">
              {ERROR_ACTION.clearFilters}
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

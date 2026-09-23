import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '@/components/ui/empty';
import { BUSINESS_NOT_FOUND, ERROR_ACTION } from '@/lib/ui/copy';

/**
 * What `notFound()` on `/businesses/[id]` renders (03-UI-SPEC § Error → "Business not found").
 *
 * 🔴 ONE ANSWER FOR THREE CASES (T-3-09): a malformed id, an unknown id and another org's id
 * all land here with the same words, so the page never confirms to a wrong-tenant caller that
 * a row exists. The sentence also covers the likeliest honest cause — a record merged into
 * another — and ends with a way out. The Copy Table gives this state a sentence, not a
 * heading, so there is no invented title.
 */
export default function BusinessNotFound() {
  return (
    <Empty data-testid="business-not-found">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription className="max-w-[60ch] text-base font-normal">
          {BUSINESS_NOT_FOUND}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" className="h-11">
          <Link href="/businesses" data-testid="business-not-found-open-businesses">
            {ERROR_ACTION.openBusinesses}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}


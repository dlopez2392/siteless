'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from 'react';
import { useIsDesk } from '@/components/preset-detail/run-drawer';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BUSINESSES_FILTER_LABEL,
  BUSINESSES_FILTER_OPTION,
  BUSINESSES_SEARCH_PLACEHOLDER,
  ERROR_ACTION,
} from '@/lib/ui/copy';
import type { ClusterOption } from '@/server/queries/businesses';

/**
 * `/businesses` — the search field and the two filters (03-UI-SPEC § 3).
 *
 * 🔴 THIS COMPONENT NEVER SUSPENDS. It sits OUTSIDE the page's rows `Suspense` boundary, so
 * the field and both selects paint on first render and stay interactive while the rows load,
 * re-load, or fail. A search that blanks its own input is the worst thing this screen could
 * do (03-UI-SPEC § States → Loading), so:
 *   - the typed text is LOCAL state; the URL is written from it, never the other way round
 *     except when the URL changed from somewhere else (Clear search, the back button);
 *   - a failed search leaves the box exactly as typed — the error is the rows region's
 *     business (`BUSINESS_SEARCH_FAILED`: "Your query is still in the box").
 *
 * 🔴 `router.replace`, NEVER `push`. The back button is not a list of keystrokes.
 *
 * 🔴 THE CLUSTER OPTIONS ARRIVE AS A PROMISE, and are read in an effect rather than with
 * `use()`. The page opens ONE `withOrg` per request (the pool is `max: 1`), and the cluster
 * names come back from that same `listBusinesses` call. `use()` would suspend these controls
 * on every search — exactly what the rule above forbids — so the options are kept in state
 * that survives navigations: they fill in once and never flicker. The promise is resolved to
 * `null` on the server when the list read fails, so it never rejects here.
 *
 * 🔴 NO EXPORTED DATA. A `"use client"` module's exports are client REFERENCES in a server
 * component, plain data included (Executor Rule 5) — every string comes from `copy.ts`.
 */

const SEARCH_DEBOUNCE_MS = 300;

/** The URL parameters this screen owns. `limit` is the append pager's — a new search or a
 *  new filter always starts again at the first 50. */
const PARAM = { query: 'q', cluster: 'cluster', status: 'status', limit: 'limit' } as const;

const ANY = 'any';
const NO_CLUSTER = 'none';

const STATUS_OPTIONS = [
  { value: ANY, label: BUSINESSES_FILTER_OPTION.anyStatus },
  { value: 'active', label: BUSINESSES_FILTER_OPTION.active },
  { value: 'closed', label: BUSINESSES_FILTER_OPTION.closed },
  { value: 'merged_away', label: BUSINESSES_FILTER_OPTION.mergedAway },
] as const;

const STATUS_VALUES: ReadonlySet<string> = new Set(STATUS_OPTIONS.map((o) => o.value));

/** True once this component is running on the client with real snapshots — false during
 *  the hydration pass, when `useIsDesk()` still reports its server snapshot (`false`). */
function noopSubscribe() {
  return () => {};
}
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function BusinessFilters({ clusters }: { clusters: Promise<ClusterOption[] | null> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDesk = useIsDesk();
  const hydrated = useHydrated();
  const [, startTransition] = useTransition();

  const urlQuery = searchParams.get(PARAM.query) ?? '';
  const urlCluster = searchParams.get(PARAM.cluster) ?? ANY;
  const rawStatus = searchParams.get(PARAM.status) ?? ANY;
  const urlStatus = STATUS_VALUES.has(rawStatus) ? rawStatus : ANY;

  // --- The URL this component intends, kept current synchronously -----------------------
  // Two navigations can overlap (a select changed while the debounced search is about to
  // fire). Building the second URL from the rendered `searchParams` would drop the first
  // change, because the router has not committed it yet. So every navigation is built from
  // the latest INTENT, and the intent is re-based on the URL whenever the URL moves.
  const intent = useRef(searchParams.toString());
  const searchKey = searchParams.toString();
  useEffect(() => {
    intent.current = searchKey;
  }, [searchKey]);

  function navigate(patch: Partial<Record<'q' | 'cluster' | 'status', string | null>>) {
    const next = new URLSearchParams(intent.current);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    next.delete(PARAM.limit);
    const qs = next.toString();
    intent.current = qs;
    router.replace(qs === '' ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  // --- The search field ------------------------------------------------------------------
  const [query, setQuery] = useState(urlQuery);
  // What this component last WROTE to the URL, and the last URL value it has SEEN. When the
  // URL moves to something this component did not write (Clear search, back/forward), the
  // box follows it. When it moves to what was just written, the box is left alone — the
  // person may already have typed three more characters.
  const [lastSent, setLastSent] = useState(urlQuery);
  const [lastSeen, setLastSeen] = useState(urlQuery);
  if (urlQuery !== lastSeen) {
    setLastSeen(urlQuery);
    if (urlQuery !== lastSent) {
      setQuery(urlQuery);
      setLastSent(urlQuery);
    }
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  function commitQuery(value: string) {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = value.trim();
    const current = new URLSearchParams(intent.current).get(PARAM.query) ?? '';
    if (next === current) return;
    setLastSent(next);
    startTransition(() => navigate({ q: next }));
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitQuery(value), SEARCH_DEBOUNCE_MS);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Enter searches now rather than after the debounce. `onSubmit`, never a form
    // `action`: React resets a form's fields after an action, and this box must never blank.
    event.preventDefault();
    commitQuery(query);
  }

  // Autofocus on desk ONLY — never on a phone, where it would throw the keyboard up over the
  // list. Decided once, on the first render that has the real breakpoint: during hydration
  // `useIsDesk()` still reports its server snapshot, so deciding then would never focus on a
  // desk; deciding on every change would focus a phone rotated into landscape.
  const inputRef = useRef<HTMLInputElement>(null);
  const focusDecided = useRef(false);
  useEffect(() => {
    if (!hydrated || focusDecided.current) return;
    focusDecided.current = true;
    if (isDesk) inputRef.current?.focus();
  }, [hydrated, isDesk]);

  // --- The two filters -------------------------------------------------------------------
  // A select commits immediately. `useOptimistic` shows the chosen value while the
  // navigation is in flight, then hands back to the URL once it lands.
  const [shown, setShown] = useOptimistic({ cluster: urlCluster, status: urlStatus });

  function onCluster(value: string) {
    startTransition(() => {
      setShown((s) => ({ ...s, cluster: value }));
      navigate({ cluster: value === ANY ? null : value });
    });
  }

  function onStatus(value: string) {
    startTransition(() => {
      setShown((s) => ({ ...s, status: value }));
      navigate({ status: value === ANY ? null : value });
    });
  }

  const [clusterOptions, setClusterOptions] = useState<ClusterOption[]>([]);
  useEffect(() => {
    let live = true;
    clusters.then(
      (options) => {
        if (live && options !== null) setClusterOptions(options);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [clusters]);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <form role="search" onSubmit={onSubmit} className="min-w-0 flex-1">
        {/* The placeholder is not a label: the accessible name is set explicitly, from the
            same constant, so the field is named even once something has been typed. */}
        <Input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          data-testid="businesses-search"
          aria-label={BUSINESSES_SEARCH_PLACEHOLDER}
          placeholder={BUSINESSES_SEARCH_PLACEHOLDER}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          // 48px, Body 16/400 at every width. `md:text-base` overrides the primitive's
          // `md:text-sm`: 16px is the type contract AND what stops iOS zooming on focus.
          className="h-12 px-4 text-base font-normal md:text-base"
        />
      </form>

      <Field className="gap-2 sm:w-52">
        <FieldLabel htmlFor="businesses-filter-cluster" className="text-sm font-semibold">
          {BUSINESSES_FILTER_LABEL.cluster}
        </FieldLabel>
        <Select value={shown.cluster} onValueChange={onCluster}>
          <SelectTrigger
            id="businesses-filter-cluster"
            data-testid="businesses-filter-cluster"
            className="w-full text-base data-[size=default]:h-11 sm:data-[size=default]:h-12"
          >
            <SelectValue placeholder={BUSINESSES_FILTER_OPTION.anyCluster} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY} className="min-h-11 text-base">
              {BUSINESSES_FILTER_OPTION.anyCluster}
            </SelectItem>
            {clusterOptions.map((option) => (
              <SelectItem key={option.key} value={option.key} className="min-h-11 text-base">
                {option.displayName}
              </SelectItem>
            ))}
            <SelectItem value={NO_CLUSTER} className="min-h-11 text-base">
              {BUSINESSES_FILTER_OPTION.noClusterMapped}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field className="gap-2 sm:w-44">
        <FieldLabel htmlFor="businesses-filter-status" className="text-sm font-semibold">
          {BUSINESSES_FILTER_LABEL.status}
        </FieldLabel>
        <Select value={shown.status} onValueChange={onStatus}>
          <SelectTrigger
            id="businesses-filter-status"
            data-testid="businesses-filter-status"
            className="w-full text-base data-[size=default]:h-11 sm:data-[size=default]:h-12"
          >
            <SelectValue placeholder={BUSINESSES_FILTER_OPTION.anyStatus} />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="min-h-11 text-base">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/**
 * "Try again" for a failed search (03-UI-SPEC § Error → Business search failed). A refresh,
 * not a navigation: the URL — and so the query in the box — is exactly what it was.
 */
export function SearchRetryButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 text-base font-normal"
      data-testid="businesses-search-retry"
      aria-disabled={isPending}
      onClick={() => {
        if (isPending) return;
        startTransition(() => router.refresh());
      }}
    >
      {ERROR_ACTION.tryAgain}
    </Button>
  );
}

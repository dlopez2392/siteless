'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { formatUsd, formatUsdInput } from '@/lib/budget/money';
import { BUDGET_AUDIT_NOTE, BUDGET_CAP_HELP } from '@/lib/ui/copy';
import type { Provider } from '@/lib/budget/price-book';
import { setBudgetCap } from '@/server/actions/set-budget-cap';

/**
 * D-10's cap edit. The only UI path to the ceiling on all spend (T-2-07).
 *
 * 🔴 `onSubmit` PLUS `useTransition`, AND NEVER THE DECLARATIVE `<form>` SUBMIT PROP.
 * React resets a declaratively-submitted form even when the submission FAILED, so the
 * number the user typed vanishes at the exact moment they are told it was refused — and a
 * Radix `Select` on the same form drives its state BACKWARDS on that reset. Both are
 * recorded BIS production defects. A controlled input plus a transition keeps the typed
 * value on screen through every refusal, which is what the "cap below current spend"
 * message assumes: it tells you the floor so you can EDIT the number you already have.
 *
 * 🔴 THE ADMIN CHECK IN THE PAGE ABOVE IS AFFORDANCE, NOT A BOUNDARY, AND NEITHER IS THIS
 * COMPONENT'S EXISTENCE. `setBudgetCap` re-checks `auth().orgRole`, `app.set_budget_cap`
 * re-checks `app.current_org_role()` in SQL and raises `42501`, and `authenticated` holds
 * no UPDATE grant on `budget_periods` at all. Four layers; only the last two are boundaries
 * (T-2-02, proven in plan 02-08). So `forbidden` is branched below rather than treated as
 * unreachable — a role can change between the page render and the button press.
 *
 * 🔴 THE REFUSAL FLOOR IS THE ONE THE SERVER SENT. `bp_not_over` refuses at
 * `spent + reserved`, which is TIGHTER than UI-SPEC's "at least {spent + $1}" whenever a
 * reservation is open. The message is rendered exactly as the action composed it, never
 * re-derived here, because a user told "$13.00" and then refused at $13.00 concludes the
 * product is broken.
 *
 * 🔴 SUCCESS IS A TOAST, REFUSAL IS INLINE. UI-SPEC reserves the transient kind for
 * reversible successes — raising or lowering an audited cap is exactly that — while a
 * refusal has to persist beside the field it is about and carry the number to fix it.
 */
export function CapForm({
  provider,
  initialCapUsd,
}: {
  provider: Provider;
  /** Bare dollars and cents, no `$`: the symbol is the InputGroup's addon. */
  initialCapUsd: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialCapUsd);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorId = useId();
  const helpId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setForbidden(null);

    startTransition(async () => {
      const result = await setBudgetCap({ provider, capUsd: value });

      if (result.ok) {
        // Re-rendered from what the database actually stored, not from what was typed:
        // "50" becomes "50.00", and a value the server normalised differently shows the
        // stored truth rather than the request.
        const stored = BigInt(result.data.capMicroUsd);
        setValue(formatUsdInput(stored));
        // UI-SPEC § Copy Table → Toasts: "Monthly cap set to {amount}".
        toast.success(`Monthly cap set to ${formatUsd(stored)}`);
        // The shell's banner and the Current period card beside this one both read the
        // meter server-side; without this they would keep showing the previous cap until
        // the next navigation. `revalidatePath` in the action invalidates the cache, this
        // re-renders the tree that reads it.
        router.refresh();
        return;
      }

      if (result.code === 'forbidden') {
        setForbidden(result.message);
        return;
      }

      setError(result.message);
      inputRef.current?.focus();
    });
  }

  if (forbidden) {
    return <CapRefusedByRole message={forbidden} />;
  }

  return (
    <form
      onSubmit={handleSubmit}
      // Disabled in appearance and intent while the transition runs, never removed:
      // UI-SPEC § States → Loading is explicit that the form stays on screen.
      aria-disabled={pending}
      className="flex flex-col gap-4"
    >
      <Field>
        <FieldLabel htmlFor="budget-cap" className="text-sm font-semibold">
          Monthly cap
        </FieldLabel>
        {/* h-11 so the control clears the 44px thumb-zone floor, and the input is 16px
            (`text-base`) so iOS Safari does not zoom the viewport on focus.

            Width-capped on desk: a field for five characters stretched across a 1120px
            card reads as a search box, not as a dollar amount. Full width on phone, where
            it is the whole screen anyway. */}
        <InputGroup className="h-11 sm:max-w-[220px]">
          <InputGroupAddon>
            <InputGroupText className="text-base">$</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="budget-cap"
            ref={inputRef}
            data-testid="budget-cap-input"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${helpId}` : helpId}
            className="text-base font-normal tabular-nums"
          />
        </InputGroup>

        {error ? (
          /* Never colour-only — the icon and the sentence carry it (UI-SPEC § Forms). */
          <p
            id={errorId}
            role="alert"
            data-testid="budget-cap-error"
            className="flex items-start gap-2 text-sm font-normal text-destructive"
          >
            <CircleAlert
              data-icon="circle-alert"
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>{error}</span>
          </p>
        ) : null}

        <FieldDescription id={helpId} className="text-sm font-normal">
          {BUDGET_CAP_HELP}
        </FieldDescription>
      </Field>

      <div className="flex flex-col gap-2">
        {/* The one accent action on this screen (UI-SPEC § Accent reserved for, item 1). */}
        <Button
          type="submit"
          data-testid="budget-cap-save"
          disabled={pending}
          className="h-11 w-full text-base sm:w-fit"
        >
          {pending ? <Spinner aria-hidden="true" className="size-4" /> : null}
          Save monthly cap
        </Button>

        <p className="text-sm font-normal text-muted-foreground">{BUDGET_AUDIT_NOTE}</p>
      </div>
    </form>
  );
}

/**
 * The role check failed at the boundary rather than at the affordance — the page rendered
 * this form and the database refused anyway. Rare, and worth its own branch: the sentence
 * `setBudgetCap` returns is the same one a member sees on arrival, so the two paths to
 * "you cannot change this" read identically instead of one of them being a raw error.
 */
function CapRefusedByRole({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p
        role="alert"
        data-testid="budget-cap-forbidden"
        className="flex items-start gap-2 text-base font-normal"
      >
        <CircleAlert
          data-icon="circle-alert"
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-destructive"
        />
        <span className="max-w-[60ch]">{message}</span>
      </p>
      <Button asChild variant="outline" className="h-11 w-full sm:w-fit">
        <Link href="/spend" data-testid="budget-cap-forbidden-spend">
          Open spend view
        </Link>
      </Button>
    </div>
  );
}

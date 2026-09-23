import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Detach this listing" (04-25; 04-UI-SPEC § Screen 5, Executor Rule 42): the only way a
 * listing's signal stops counting for a business, and it ALWAYS confirms.
 *
 * 🔴 THE ACTION MODULE IS FACTORY-MOCKED. `detach-listing.ts` carries the server directive and
 * pulls in `src/db/`, whose `import 'server-only'` throws in the dom lane by design. What this
 * file proves is the DIALOG's contract — never call the action from the trigger, stay open on a
 * refusal with the true sentence, close + toast + refresh only on `ok: true`, stay modal while
 * the write is in flight. The action's own refusals are proven against the real database in
 * tests/db/listing-actions.test.ts (04-21).
 */
vi.mock('@/server/actions/detach-listing', () => ({ detachListing: vi.fn() }));
// `useIsDesk` lives in run-drawer.tsx, which also imports the queue-run action — same reason.
vi.mock('@/server/actions/queue-run', () => ({ queueRun: vi.fn() }));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const toast = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }));

import { DetachDialog } from '@/components/business-detail/detach-dialog';
import { Button } from '@/components/ui/button';
import { DETACH_ALREADY_DECIDED, DETACH_FAILED, NOT_FOUND } from '@/lib/ui/copy';
import { detachListing } from '@/server/actions/detach-listing';

const mocked = vi.mocked(detachListing);

/** Desk by default: `useIsDesk()` reads `(min-width: 1024px)` through matchMedia. */
let deskMatches = true;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: deskMatches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  deskMatches = true;
  mocked.mockReset();
  refresh.mockReset();
  toast.mockReset();
});

afterEach(cleanup);

const ATTACHMENT = '00000000-0000-4000-8000-00000000a0a1';
const BUSINESS = '00000000-0000-4000-8000-0000000000a1';
const NAME = 'Taquería El Ñandú';

function renderDialog() {
  return render(
    <DetachDialog attachmentId={ATTACHMENT} businessName={NAME}>
      <Button type="button" variant="outline" data-testid={`business-google-detach-${ATTACHMENT}`}>
        Detach this listing
      </Button>
    </DetachDialog>,
  );
}

function openDialog() {
  fireEvent.click(screen.getByTestId(`business-google-detach-${ATTACHMENT}`));
  return screen.getByTestId('business-google-detach-dialog');
}

async function pressConfirm() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('business-google-detach-confirm'));
  });
}

describe('detach confirmation', () => {
  it('the detach trigger calls no server action until confirm', async () => {
    mocked.mockResolvedValue({ ok: true, data: { businessId: BUSINESS, businessName: NAME } });
    renderDialog();
    const dialog = openDialog();
    // Rule 42: opening the dialog records nothing.
    expect(mocked).not.toHaveBeenCalled();

    const d = within(dialog);
    expect(d.getByText('Detach this Google listing from “Taquería El Ñandú”?')).toBeInTheDocument();
    const body = d.getByTestId('business-google-detach-consequences');
    expect(body).toHaveTextContent("Siteless stops using this listing's website signal");
    expect(body).toHaveTextContent('never attaches it to this business again');
    expect(body).toHaveTextContent('recorded with your name and the time');
    expect(d.getByTestId('business-google-detach-confirm')).toHaveTextContent('Detach this listing');
    expect(d.getByTestId('business-google-detach-dismiss')).toHaveTextContent('Keep it attached');
    expect(d.queryByText('Cancel')).toBeNull();
    expect(d.queryByRole('button', { name: 'Close' })).toBeNull();
    // onClick inside useTransition, never a form action (a form resets even on a refusal).
    expect(dialog.querySelector('form')).toBeNull();

    await pressConfirm();
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked).toHaveBeenCalledWith({ attachmentId: ATTACHMENT });
  });

  it('keep it attached dismisses without detaching', async () => {
    renderDialog();
    openDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId('business-google-detach-dismiss'));
    });
    await waitFor(() => expect(screen.queryByTestId('business-google-detach-dialog')).toBeNull());
    expect(mocked).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('the detach dialog keeps the listing attached on failure', async () => {
    mocked.mockResolvedValue({ ok: false, code: 'unexpected', message: DETACH_FAILED });
    renderDialog();
    openDialog();
    await pressConfirm();

    const error = await screen.findByTestId('business-google-detach-error');
    expect(error).toHaveTextContent(DETACH_FAILED);
    expect(within(error).getByTestId('business-google-detach-retry')).toHaveTextContent('Try again');
    expect(within(error).getByTestId('business-google-detach-reload')).toHaveTextContent(
      'Reload this business',
    );
    // The dialog stays open, nothing refreshed, nothing toasted.
    expect(screen.getByTestId('business-google-detach-dialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    // Try again sends the same request.
    mocked.mockResolvedValue({ ok: true, data: { businessId: BUSINESS, businessName: NAME } });
    await act(async () => {
      fireEvent.click(within(error).getByTestId('business-google-detach-retry'));
    });
    expect(mocked).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('the detach dialog reloads the business from a failure', async () => {
    mocked.mockResolvedValue({ ok: false, code: 'unexpected', message: DETACH_FAILED });
    renderDialog();
    openDialog();
    await pressConfirm();
    const error = await screen.findByTestId('business-google-detach-error');
    await act(async () => {
      fireEvent.click(within(error).getByTestId('business-google-detach-reload'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('business-google-detach-dialog')).toBeNull());
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('the detach dialog never claims a listing someone else detached is still attached', async () => {
    // 04-21 handoff: `conflict` / `already_decided` carries DETACH_FAILED as its message, whose
    // "still attached exactly as it was" is false here. The dialog says what is true and offers
    // only the reload — a retry would meet the same refusal forever.
    mocked.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: DETACH_FAILED,
      detail: { reason: 'already_decided' },
    });
    renderDialog();
    openDialog();
    await pressConfirm();

    const error = await screen.findByTestId('business-google-detach-error');
    expect(error).toHaveTextContent(DETACH_ALREADY_DECIDED);
    expect(error).not.toHaveTextContent('still attached exactly as it was');
    expect(within(error).queryByTestId('business-google-detach-retry')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(error).getByTestId('business-google-detach-reload'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('the detach dialog shows a not-found refusal as its own sentence with only the reload', async () => {
    mocked.mockResolvedValue({ ok: false, code: 'not_found', message: NOT_FOUND('listing') });
    renderDialog();
    openDialog();
    await pressConfirm();
    const error = await screen.findByTestId('business-google-detach-error');
    expect(error).toHaveTextContent(NOT_FOUND('listing'));
    expect(within(error).queryByTestId('business-google-detach-retry')).toBeNull();
    // Dismissing after a refusal no retry can fix re-reads the page.
    await act(async () => {
      fireEvent.click(screen.getByTestId('business-google-detach-dismiss'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a detach whose request never reaches the server keeps the dialog open with the detach-failed sentence', async () => {
    mocked.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderDialog();
    openDialog();
    await pressConfirm();
    const error = await screen.findByTestId('business-google-detach-error');
    expect(error).toHaveTextContent(DETACH_FAILED);
    expect(within(error).getByTestId('business-google-detach-retry')).toBeInTheDocument();
    expect(screen.getByTestId('business-google-detach-dialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('a successful detach toasts the business name, closes and refreshes', async () => {
    mocked.mockResolvedValue({ ok: true, data: { businessId: BUSINESS, businessName: NAME } });
    renderDialog();
    openDialog();
    await pressConfirm();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith('Listing detached from “Taquería El Ñandú”');
    await waitFor(() => expect(screen.queryByTestId('business-google-detach-dialog')).toBeNull());
  });

  it('while detaching the confirm reads Detaching… and the dialog stays open and modal', async () => {
    let settle: (v: Awaited<ReturnType<typeof detachListing>>) => void = () => {};
    mocked.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderDialog();
    const dialog = openDialog();
    await pressConfirm();

    const confirm = screen.getByTestId('business-google-detach-confirm');
    expect(confirm).toHaveTextContent('Detaching…');
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('business-google-detach-dismiss')).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(screen.getByTestId('business-google-detach-dialog')).toBeInTheDocument();

    await act(async () => {
      settle({ ok: false, code: 'unexpected', message: DETACH_FAILED });
    });
    expect(await screen.findByTestId('business-google-detach-error')).toHaveTextContent(DETACH_FAILED);
  });

  it('on a phone the detach confirmation is a drawer with the same contract', () => {
    deskMatches = false;
    renderDialog();
    const drawer = openDialog();
    expect(drawer).toHaveAttribute('data-slot', 'drawer-content');
    expect(within(drawer).getByTestId('business-google-detach-dismiss')).toHaveTextContent(
      'Keep it attached',
    );
    expect(mocked).not.toHaveBeenCalled();
  });
});

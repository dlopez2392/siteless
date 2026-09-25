import { expect, test, type Page } from '@playwright/test';

/**
 * D-12, end to end: the 80% warning and the 100% refusal are standing conditions in the
 * shell, on every route, and the reader cannot clear either of them.
 *
 * 🔴 ASSERTS ON `data-testid` AND NEVER ON COPY. The sentences live in
 * `src/lib/ui/copy.ts` and Phase 2 is still restyling every screen these appear on; a
 * copy assertion here would be a hook that breaks on a wording change and proves nothing
 * about whether the banner rendered.
 *
 * 🔴 THE STATE IS DRIVEN THROUGH THE PRODUCT, NOT THROUGH SQL. Lowering the cap on
 * /settings/budget is the same path a human takes, so the test exercises the meter the
 * way it is actually reached. A browser test that wrote its own budget row would be
 * asserting against a state the application never produces.
 */

const BUDGET_SETTINGS = '/settings/budget';

/** The routes the shell must carry the banner on (UI-SPEC § App shell § Routes). */
const SHELL_ROUTES = ['/presets', '/spend', BUDGET_SETTINGS, '/settings/organization'];

/**
 * Plan 02-13 built /settings/budget, so the cap control now exists and these tests are no
 * longer skipped for its absence. They are still guarded, and by a HARDER fact.
 *
 * 🔴 THE 80% TIER IS `committed * 100 >= cap * 80`, AND `committed` IS ZERO UNTIL PHASE 4.
 * Nothing in Phase 2 spends money — the Places verifier ships in Phase 4 — so the ledger is
 * empty, no reservation is ever open, and `0 * 100 >= cap * 80` is false for EVERY positive
 * cap. No value that can be typed into the cap field produces an 80% state on a meter that
 * has committed nothing. That is a property of the arithmetic, not a gap in the fixture,
 * and it is why the guard below reads the meter's real figure off `/spend` rather than
 * assuming a cap can be lowered into the threshold.
 *
 * 🔴 AND THE CAP IS COMPUTED FROM THAT FIGURE, NOT HARD-CODED. This file previously set
 * `0.05` and expected 80%; with any non-zero spend that is `committed >= cap`, which is the
 * ONE HUNDRED percent banner — so the test would have asserted the wrong tier the moment it
 * stopped being skipped. The cap is now derived as `committed × 1.15`, which puts the meter
 * at ~87% — inside [80%, 100%) by construction, and above `bp_not_over`'s floor so the
 * database accepts the change.
 *
 * Plan 02-15 runs this suite against the deployed build and must re-check that these two
 * tests EXECUTE rather than skip: a permanently skipped test reads the same as a passing
 * one in a summary line.
 */
async function capControl(page: Page) {
  await page.goto(BUDGET_SETTINGS);
  const input = page.getByTestId('budget-cap-input');
  const save = page.getByTestId('budget-cap-save');
  const present = (await input.count()) > 0 && (await save.count()) > 0;
  return { input, save, present };
}

/** What the meter says is committed this month, in dollars, read off the product's own
 *  spend view — the same `spent + reserved` the banner tiers on. */
async function committedUsd(page: Page): Promise<number> {
  await page.goto('/spend');
  const text = await page.getByTestId('spend-mtd-figure').innerText();
  return Number(text.replace(/[$,]/g, ''));
}

/** A cap that puts the CURRENT committed total inside [80%, 100%). */
function capForEightyPercent(committed: number): string {
  return (Math.ceil(committed * 115) / 100).toFixed(2);
}

/**
 * 🔴 NEVER LOWER THE CAP UNDER A LIVE RUN (04-UI-SPEC OQ 14; T-4-09).
 *
 * The two tests below lower the PRODUCTION cap to ~115% of what is committed. Since Phase 4 a
 * Places run reserves against that cap before every request, so a cap lowered mid-sweep refuses
 * the sweep's next reservation and stops it `budget_cap_reached` — an e2e run would have
 * stopped real work and cost a re-run. Before either test touches the cap it reads `/spend` →
 * By run and skips while any run is `queued` or `running`. `:visible` because the desk table
 * and the phone cards both carry a `run-status-badge` (04-14); the viewport shows one of them.
 *
 * The anchor wait matters: the By-run tab renders on click, and a count taken before the
 * content paints is zero on a page with a live run — the guard would wave the test through.
 */
async function aRunIsLive(page: Page): Promise<boolean> {
  await page.goto('/spend');
  await page.getByTestId('spend-tab-by-run').click();
  await expect(
    page.locator(
      [
        '[data-testid="spend-by-run-empty"]:visible',
        '[data-testid="spend-by-run-table"]:visible',
        '[data-testid="spend-by-run-cards"]:visible',
      ].join(', '),
    ),
  ).toHaveCount(1);
  const live = page.locator(
    [
      '[data-testid="run-status-badge"][data-status="running"]:visible',
      '[data-testid="run-status-badge"][data-status="queued"]:visible',
    ].join(', '),
  );
  return (await live.count()) > 0;
}

async function setCap(page: Page, usd: string) {
  const { input, save } = await capControl(page);
  await input.fill(usd);
  await save.click();
  await expect(page.getByTestId('budget-cap-input')).toHaveValue(usd);
}

test('budget banner: absent under 80 percent', async ({ page }) => {
  await page.goto('/presets');
  // The shell itself has to be there, or "no banner" would be true of a 404 too.
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('budget-banner-80')).toHaveCount(0);
  await expect(page.getByTestId('budget-banner-100')).toHaveCount(0);
});

test('budget banner: renders on every route at 80 percent', async ({ page }) => {
  test.skip(
    await aRunIsLive(page),
    'a Places run is live; lowering the cap now could stop it (04-UI-SPEC OQ 14)',
  );
  const { present } = await capControl(page);
  test.skip(!present, 'the cap control ships in plan 02-13; nothing can move the meter yet');

  const committed = await committedUsd(page);
  test.skip(
    committed <= 0,
    'the meter has committed nothing, and no cap puts zero above 80% of itself; the first paid call ships with the Places verifier in Phase 4',
  );

  const { input } = await capControl(page);
  const original = await input.inputValue();

  try {
    // A cap the meter is already ~87% of: over 80%, under 100%, and above the
    // `bp_not_over` floor. Derived from what the meter reads, never guessed.
    await setCap(page, capForEightyPercent(committed));

    for (const route of SHELL_ROUTES) {
      await page.goto(route);
      await expect(
        page.getByTestId('budget-banner-80'),
        `the 80% banner is missing on ${route}`,
      ).toBeVisible();
    }
  } finally {
    await setCap(page, original);
  }
});

test('budget banner: is not dismissible', async ({ page }) => {
  test.skip(
    await aRunIsLive(page),
    'a Places run is live; lowering the cap now could stop it (04-UI-SPEC OQ 14)',
  );
  const { present } = await capControl(page);
  test.skip(!present, 'the cap control ships in plan 02-13; nothing can move the meter yet');

  const committed = await committedUsd(page);
  test.skip(
    committed <= 0,
    'the meter has committed nothing, and no cap puts zero above 80% of itself; the first paid call ships with the Places verifier in Phase 4',
  );

  const { input } = await capControl(page);
  const original = await input.inputValue();

  try {
    await setCap(page, capForEightyPercent(committed));
    await page.goto('/presets');

    const banner = page.getByTestId('budget-banner-80');
    await expect(banner).toBeVisible();

    // Every control inside the banner, by accessible name. D-12: there is no way to
    // clear this, so nothing in here may offer one.
    const names = await banner.getByRole('button').evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '') + ' ' + (node.getAttribute('aria-label') ?? '')),
    );
    for (const name of names) {
      expect(name, `a control inside the banner offers to clear it: ${name}`).not.toMatch(
        /dismiss|close/i,
      );
    }
  } finally {
    await setCap(page, original);
  }
});

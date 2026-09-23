import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GoogleMapsTag } from '@/components/places/google-maps-tag';

/**
 * D-11 / PLACE-06 — Google's text attribution for Places-derived values (UI-SPEC Rule 29).
 *
 * jsdom paints nothing, so the component half pins the DOM contract (exact text, `translate`,
 * the class, the testid) and the CSS half reads `globals.css` as TEXT and pins the painted
 * literals. The computed colour in both themes (`rgb(94, 94, 94)` / `rgb(255, 255, 255)`) is
 * measured on the built app by the e2e theme probe (04-28), which is the only place a real
 * cascade exists.
 */

afterEach(cleanup);

describe('GoogleMapsTag', () => {
  it('the google maps tag is exact text with translate=no', () => {
    render(<GoogleMapsTag />);
    const tag = screen.getByTestId('google-maps-attribution');

    expect(tag.tagName).toBe('SPAN');
    // Case-sensitive and whole: "Google maps", "Google Maps " or "© Google Maps" all fail.
    expect(tag.textContent).toBe('Google Maps');
    // Browser translation would rewrite a trademark Google requires verbatim.
    expect(tag.getAttribute('translate')).toBe('no');
    expect(tag.classList.contains('google-maps-attribution')).toBe(true);
  });

  it('the google maps tag is not a badge', () => {
    // Executor Rule 22: a source tag is text. A badge is state.
    render(<GoogleMapsTag />);
    const tag = screen.getByTestId('google-maps-attribution');

    expect(tag.getAttribute('data-slot')).not.toBe('badge');
    expect(tag.hasAttribute('role')).toBe(false);
    expect(tag.children).toHaveLength(0);
  });
});

/** The body of the FIRST rule whose selector is exactly `selector` — braces are flat in this
 *  file (no nesting inside these blocks), so the first `}` after the `{` closes it. */
function blockOf(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no "${selector}" block in globals.css`);
  return match[2];
}

describe('google attribution token', () => {
  it('the attribution token is painted in both themes', () => {
    const css = nodeFs.readFileSync(nodePath.join('src', 'app', 'globals.css'), 'utf8');

    const root = blockOf(css, ':root');
    const dark = blockOf(css, '.dark');
    const theme = blockOf(css, '@theme inline');
    const rule = blockOf(css, '.google-maps-attribution');

    // Positive controls: prove each block is the real one, not an accidental empty match.
    expect(root).toContain('--warning: #B54708;');
    expect(dark).toContain('--warning: #FDB022;');
    expect(theme).toContain('--color-warning: var(--warning);');

    // Google's policy colours, as literals (Executor Rules 2 and 3): gray #5E5E5E, white.
    expect(root).toContain('--google-attribution: #5E5E5E;');
    expect(dark).toContain('--google-attribution: #FFFFFF;');
    expect(theme).toContain('--color-google-attribution: var(--google-attribution);');

    expect(rule).toContain('font-family: Roboto, sans-serif;');
    expect(rule).toContain('font-size: 14px;');
    expect(rule).toContain('font-weight: 400;');
    expect(rule).toContain('font-style: normal;');
    expect(rule).toContain('letter-spacing: normal;');
    expect(rule).toContain('white-space: nowrap;');
    expect(rule).toContain('color: var(--color-google-attribution);');

    // Never a web font: devices without Roboto take Google's permitted sans-serif fallback.
    expect(css).not.toMatch(/@font-face|fonts\.googleapis/);
  });
});

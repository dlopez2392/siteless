'use client';

import { useTheme } from 'next-themes';
import * as React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

/**
 * The three-way Light · Dark · System switch (UI-SPEC § Copy Table → Shell, and § Theme's
 * default of `system`).
 *
 * It is a `ToggleGroup` rather than a set of menu radio items for one reason: it has to
 * render in TWO places — inside the user menu's dropdown, and as the "Theme" row on
 * `/settings/organization` — and a menu radio item cannot exist outside a menu.
 *
 * 🔴 NEVER BLANK THE CONTENT TO SATISFY A STATE (Executor Rule 11). `next-themes` cannot
 * know the resolved theme until it has read the DOM, so the usual pattern of returning
 * `null` until mounted would leave a hole on first paint. Instead the group always
 * renders and only the SELECTED value waits for mount — the control is visible and
 * correctly sized from the first byte, it just has no pressed state for one frame.
 *
 * 🔴 THE HOOKS ARE PREFIXED BECAUSE THIS SWITCH RENDERS TWICE. With `testIdPrefix` left
 * at its default it emits `data-testid="theme-switch"` on the group and
 * `data-testid="theme-light"` / `"theme-dark"` / `"theme-system"` on the three options —
 * the shell hooks UI-SPEC § Accessibility names. `/settings/organization` also shows a
 * Theme row, and on a phone both instances can be on screen at once; without a prefix
 * every one of those ids resolved to TWO visible elements and `theme-tokens.spec.ts` and
 * `touch-targets.spec.ts` both failed on it. The settings row passes its own prefix, so
 * the shell's switch keeps the canonical names.
 */
export function ThemeSwitch({
  className,
  testIdPrefix = 'theme',
}: {
  className?: string;
  testIdPrefix?: string;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const options = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ] as const;

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      data-testid={`${testIdPrefix}-switch`}
      // Before hydration there is no answer yet; an empty string is Radix's own
      // "nothing pressed" and is not the same as picking one.
      value={mounted ? (theme ?? 'system') : ''}
      onValueChange={(next) => {
        // Radix emits '' when the pressed item is pressed again. Theme is not a
        // three-state-plus-off control, so an empty value is discarded rather than
        // written back as "no theme".
        if (next) setTheme(next);
      }}
      // The group lives inside a Radix dropdown on the desk. That menu owns ArrowUp /
      // ArrowDown for its own roving focus, so without this the group's own arrow-key
      // navigation would never see the event.
      onKeyDown={(event) => event.stopPropagation()}
      className={cn('w-full', className)}
      aria-label="Theme"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          data-testid={`${testIdPrefix}-${option.value}`}
          // 44px minimum hit area, MOB-01 / Executor Rule 9.
          className="min-h-11 flex-1 text-sm"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

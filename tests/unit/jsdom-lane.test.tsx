import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

// The smoke test that proves the jsdom lane exists at all. Before this phase a
// `.test.tsx` was globbed by vitest.config.ts but had neither a DOM environment nor
// a JSX transform, so it could only ever fail. It renders a real shadcn primitive
// rather than a hand-written <button> so that a broken copy-in, a broken `@` alias
// or a missing React plugin all show up here.
describe('jsdom lane', () => {
  it('jsdom lane renders a shadcn primitive', () => {
    render(<Button>Create preset</Button>);

    // Two-sided on purpose: presence alone would still pass if the accessible name
    // were wrong or empty, and an accessible-name query alone would pass vacuously
    // against a detached node.
    const button = screen.getByRole('button', { name: 'Create preset' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAccessibleName('Create preset');
  });
});

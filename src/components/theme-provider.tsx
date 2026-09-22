'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

// next-themes reads and writes the `class` on <html>, so it has to run on the client.
// It is mounted INSIDE ClerkProvider (02-UI-SPEC.md § Theme) and exported as a
// COMPONENT — a "use client" module's exports are client references inside a server
// component, so nothing here may be consumed as plain data from layout.tsx.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

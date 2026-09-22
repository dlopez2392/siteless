import { ClerkProvider } from '@clerk/nextjs';
import { Inter } from 'next/font/google';
import { ActivateSoleOrganization } from '@/components/activate-sole-organization';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import './globals.css';

// Inter, one family, per 02-UI-SPEC.md § Typography. The `nova` preset's own font,
// which `shadcn init` wrote into this file, is swapped out here by Executor Rule 15,
// which also forbids adding that font's npm package.
// The variable is `--font-sans-inter` rather than `--font-sans` because `--font-sans`
// is the Tailwind namespace declared in globals.css, where Inter is the first entry of
// the painted fallback stack.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans-inter' });

export const metadata = { title: 'Siteless' };

// Painted values, not token references: the installed PWA's status bar has to match the
// page background in each scheme (UI-SPEC § Theme). These are the same literals as
// `--background` / `.dark --background` in globals.css.
export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F6F7' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1416' },
  ],
};

// `suppressHydrationWarning` is required by next-themes: it writes the theme class onto
// <html> before React hydrates, so the server and client markup deliberately differ there.
//
// The activation element below is imported as a COMPONENT across the client boundary,
// never as a data object: a "use client" module's exports become client REFERENCES inside
// a server component and resolve to undefined at runtime with typecheck, lint and build
// all green (two recorded BIS occurrences, each a 500). ThemeProvider and Toaster are
// mounted the same way, and ThemeProvider sits INSIDE ClerkProvider (UI-SPEC § Theme).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning className={cn('font-sans', inter.variable)}>
        <body>
          <ThemeProvider>
            {/* Renders nothing. Inside ClerkProvider and above every page, so it covers
                each surface a client can reach signed-in but with no active organization —
                /, /no-access and /sign-in — instead of only whichever one someone
                remembered. */}
            <ActivateSoleOrganization />
            {children}
            <Toaster />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

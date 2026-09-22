import { ClerkProvider } from '@clerk/nextjs';
import { ActivateSoleOrganization } from '@/components/activate-sole-organization';

export const metadata = { title: 'Siteless' };

// Phase 1 is an UNSTYLED SHELL (ROADMAP note). No fonts, no theme provider, no toaster,
// no stylesheet, no class names — all of that is Phase 2's /gsd-ui-phase.
//
// The activation element below is imported as a COMPONENT across the client boundary,
// never as a data object: a "use client" module's exports become client REFERENCES inside
// a server component and resolve to undefined at runtime with typecheck, lint and build
// all green (two recorded BIS occurrences, each a 500).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          {/* Renders nothing. Inside ClerkProvider and above every page, so it covers
              each surface a client can reach signed-in but with no active organization —
              /, /no-access and /sign-in — instead of only whichever one someone
              remembered. */}
          <ActivateSoleOrganization />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

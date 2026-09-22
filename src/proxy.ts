import { clerkMiddleware } from '@clerk/nextjs/server';

// Session context ONLY. No authorization here.
//
// 🔴 This file belongs at src/proxy.ts — level with app/, NEVER inside it. Next 16
// renamed the middleware convention to this filename and the file-convention page is
// explicit that it lives "at the same level as `pages` or `app`". Placed in app/, Next
// never loads it, clerkMiddleware() never runs, and every auth() throws
// auth_signature_invalid — an error whose text points at Clerk config rather than at the
// path. The `proxy` field of /api/health is the canary for exactly that.
//
// Next made that rename partly in response to CVE-2025-29927, and @clerk/nextjs@7.9.4
// marks its own route-matcher helper @deprecated: "Use resource-based auth checks
// instead. Move auth checks into each page, layout, API route, or Server Function that
// accesses protected data." Server Functions are POSTs to the page's route, so a matcher
// refactor can silently remove coverage here. Authorization is requireOrg(), next to the
// data.
//
// This file must therefore contain no route matcher, no protect() call, and no execution
// environment declaration — the last one throws, because Node is already the default for
// this convention in Next 16. All three are enforced by a bare token grep over this file,
// so the comment above does not spell them: naming them here would trip the guards it is
// describing (the same reason src/lib/auth/sole-organization.ts avoids its two tokens).
export default clerkMiddleware();

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};

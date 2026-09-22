import { SignIn } from '@clerk/nextjs';

// The page @clerk/testing drives in tests/e2e/auth.setup.ts. NEXT_PUBLIC_CLERK_SIGN_IN_URL
// must be /sign-in (not a Clerk account-portal URL) for requireOrg()'s redirect to land
// here; plan 10 sets the same value on Vercel.
export default function SignInPage() {
  return (
    <main>
      <SignIn />
    </main>
  );
}

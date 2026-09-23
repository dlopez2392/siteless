import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

// D-14. withWorkflow compiles "use workflow" / "use step" and generates
// src/app/.well-known/workflow/v1/{flow,step,webhook/[token]}/route.js at build time.
export default withWorkflow(nextConfig);

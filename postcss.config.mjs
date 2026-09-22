// Tailwind v4 on Next 16 / Turbopack. Next's own 16.3.5 CSS guide prescribes exactly this
// package name and this file shape — there is no `tailwind.config.ts` in this project and
// none is to be created (UI-SPEC Executor Rule 13). The theme lives in `src/app/globals.css`
// behind `@theme inline`.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;

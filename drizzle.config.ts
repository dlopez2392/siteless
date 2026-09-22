import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  // Set by scripts/db.ts from TEST_DATABASE_URL (--target=test) or SUPABASE_DB_URL
  // (--target=prod). Never read directly, so there is exactly one place that decides
  // which database a migration reaches.
  dbCredentials: { url: process.env.DRIZZLE_DB_URL as string },
  // Without this, drizzle-kit treats Supabase's own roles as unmanaged and emits
  // DROP ROLE for anon / authenticated / service_role.
  entities: { roles: { provider: 'supabase' } },
  // Emits `--> statement-breakpoint` between statements. Required: a naive `;` splitter
  // cuts a $$ ... $$ PL/pgSQL body in half and produces a syntax error mid-function.
  breakpoints: true,
  strict: true,
  verbose: true,
});

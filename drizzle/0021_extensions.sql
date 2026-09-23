-- Phase 3, deliberately the FIRST migration of the phase. 03-RESEARCH Open Question A1: the
-- official `postgres:18` CI image is believed to ship contrib but no container was run
-- (Docker is absent from the research machine), so this migration is placed ahead of every
-- dependent one and the first CI run after it lands is the answer. Installed extensions
-- before this migration: plpgsql only.
--
-- Hand-written via `pnpm db:custom`. drizzle-kit remains the single migration authority.

create extension if not exists pg_trgm;
--> statement-breakpoint
create extension if not exists unaccent;
--> statement-breakpoint

-- PostGIS is NOT installed, on measured grounds (03-RESEARCH § The Architectural Fork):
-- local PG 18.6 would get 3.6.2, postgis/postgis:18-3.6 gets 3.6.x, production Supabase
-- PostgreSQL 17.6 offers only 3.3.7. Three versions of a large C extension inside the dedupe
-- predicates is the drift Phase 1 D-05a exists to prevent. Measured with the function below:
-- the 25 km hard rule over 332,738 real candidate pairs runs in 303 ms, and "every Overture
-- place within 25 km of downtown McAllen" over 56,944 points is a 52 ms parallel seq scan
-- with no index at all. earthdistance was measured too (142,503 m vs 142,343 m on the same
-- pair, from its 6,378,168 m earth radius) and rejected: a third `create extension` in three
-- environments for a 0.11 % difference.
create or replace function app.distance_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision)
returns double precision language sql immutable parallel safe as $fn$
  select 6371000.0 * 2 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2-lon1)/2), 2)))
$fn$;
--> statement-breakpoint

-- Not a SECURITY DEFINER: `language sql immutable parallel safe`, touches no table, so it
-- takes no `set search_path` (the CONVENTIONS pin applies to definers only).
grant execute on function app.distance_m(double precision, double precision, double precision, double precision) to authenticated;
--> statement-breakpoint

comment on function app.distance_m(double precision, double precision, double precision, double precision) is
  'Great-circle (haversine) distance in METRES on a 6,371,000 m sphere. Arguments are (lat1, lon1, lat2, lon2) in decimal degrees; RGV longitudes are negative. Replaces a spatial-extension ST_DWithin by design (0021): identical in dev, CI and production. Pinned by tests/db/extensions.test.ts.';

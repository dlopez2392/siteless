-- Custom SQL migration file, put your code below! --
--
-- Phase 4 review fix C-WR-10 (the purge-rule trio, SQL half). Re-runnable by design: a drop
-- `if exists` followed by a create, then revoke/grant/comment.
--
-- /sources' purge-overdue warning fired on ANY expired coordinate. Coordinates expire
-- continuously while the purge runs once a day, so up to a day of expired rows is the normal
-- state between purges, and the warning cried wolf every afternoon. The rule the UI wants is
-- "a row has been expired for more than 36 hours" (PURGE_OVERDUE_HOURS, one skipped cron's
-- slack) — which needs WHEN the longest-waiting expired row expired. This adds exactly that:
--
--   oldest_expired_ms — epoch-ms text of min(expires_at) over the org's rows with
--                       expires_at <= now(); null when none is expired.
--
-- Still counts and instants only, never a coordinate: authenticated keeps NO privilege on
-- place_coordinates (0027). The body is 0028 § 5's with the one new aggregate.
--
-- A new OUT column cannot be added by `create or replace` (42P13), so the function is dropped
-- and re-created. A re-created function takes 0000_bootstrap's default privileges again
-- (EXECUTE to anon, authenticated AND service_role), so each is revoked BY NAME and
-- authenticated re-granted. 0028 revoked public and anon only; service_role goes too here, as
-- 0030's definers did (the app holds no service_role credential, legal doc § 1.3).

drop function if exists app.places_transient_stats();
--> statement-breakpoint

create function app.places_transient_stats()
returns table (place_ids_held bigint, coordinates_held bigint, oldest_coordinate_ms text,
               expired_awaiting_purge bigint, last_purge_ms text, last_rows_purged int,
               oldest_expired_ms text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'places_transient_stats: no current org' using errcode = '42501';
  end if;

  return query
  select ids.n, co.held, co.oldest, co.expired, lp.ms, lp.rows_purged, co.oldest_expired
    from (select count(*)::bigint as n
            from (select m.place_id from place_tile_members m where m.org_id = v_org
                  union
                  select a.place_id from place_attachments a where a.org_id = v_org) u) ids
   cross join (select count(*) filter (where pc.expires_at > now())::bigint as held,
                      floor(extract(epoch from min(pc.observed_at) filter (where pc.expires_at > now())) * 1000)::bigint::text as oldest,
                      count(*) filter (where pc.expires_at <= now())::bigint as expired,
                      floor(extract(epoch from min(pc.expires_at) filter (where pc.expires_at <= now())) * 1000)::bigint::text as oldest_expired
                 from place_coordinates pc where pc.org_id = v_org) co
    left join lateral (select floor(extract(epoch from r.ran_at) * 1000)::bigint::text as ms,
                              r.rows_purged
                         from place_purge_runs r where r.org_id = v_org
                        order by r.ran_at desc, r.id desc limit 1) lp on true;
end $$;
--> statement-breakpoint

revoke execute on function app.places_transient_stats() from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.places_transient_stats() to authenticated;
--> statement-breakpoint

comment on function app.places_transient_stats() is
  'D-12 / T-4-04 / C-WR-10. The /sources transient figures for the caller''s org — place ids held, coordinates held, oldest held coordinate (epoch ms text), expired awaiting purge, last purge (epoch ms text) and its row count, and when the longest-waiting expired row expired (oldest_expired_ms, epoch ms text; null when none) — without any read grant on place_coordinates. An expired coordinate is never counted as held. Counts and instants only; no row-level coordinate read exists.';

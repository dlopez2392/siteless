-- FOUND-05 / criterion 3. Six lines that are the entire compliance story: a durable field
-- can only cite a durable source record. If the only thing that knows this roofer's phone
-- number is a Google payload, the column stays NULL and the UI says "not stored".
--
-- Hand-written (drizzle-kit generate --custom) because these are table-level constraints
-- drizzle-kit's differ does not emit; drizzle-kit remains the single migration authority
-- (D-09) — nothing here was applied by any other tool.

alter table source_records add constraint sr_ephemeral_has_expiry
  check ((retention_class = 'ephemeral') = (expires_at is not null));
--> statement-breakpoint

-- Google Places content may never be the durable record. place_id is the only field
-- exempt from the caching restriction; lat/lng may be cached 30 days; everything else
-- goes. This CHECK is what makes that a property of the table rather than a convention.
alter table source_records add constraint sr_google_is_ephemeral
  check (source_key <> 'google_places' or retention_class = 'ephemeral');
--> statement-breakpoint

-- The composite FK target. A plain FK to source_records(id) could cite anything; this
-- pair makes the retention class part of the reference.
alter table source_records add constraint sr_durable_uniq unique (id, retention_class);
--> statement-breakpoint

alter table businesses add constraint businesses_legal_name_src_fk
  foreign key (legal_name_source_id, legal_name_src_ret)
  references source_records (id, retention_class);
--> statement-breakpoint
alter table businesses add constraint businesses_display_name_src_fk
  foreign key (display_name_source_id, display_name_src_ret)
  references source_records (id, retention_class);
--> statement-breakpoint
alter table businesses add constraint businesses_phone_src_fk
  foreign key (phone_source_id, phone_src_ret)
  references source_records (id, retention_class);
--> statement-breakpoint

-- Phase 4's purge job deletes where expires_at < now(). TTL is 21 days, not 30, so a
-- missed run is not a breach. The index ships now; the job is Phase 4's.
create index sr_expiry on source_records (expires_at) where expires_at is not null;

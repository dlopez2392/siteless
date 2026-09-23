CREATE TABLE "place_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"business_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"score" integer NOT NULL,
	"features" jsonb NOT NULL,
	"tie_business_id" uuid,
	"first_seen_run_id" uuid,
	"last_seen_run_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "place_attachments_pair_key" UNIQUE("org_id","business_id","place_id"),
	CONSTRAINT "pa_status_known" CHECK (status in ('attached','tentative','rejected')),
	CONSTRAINT "pa_reason_known" CHECK (reason in ('score','tie','confirmed','rejected','detached')),
	CONSTRAINT "pa_score_range" CHECK (score between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "place_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "place_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"business_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"had_website_uri" boolean NOT NULL,
	"host_class" text NOT NULL,
	"sku" text NOT NULL,
	"pure_sab" boolean NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_observations_run_pair_key" UNIQUE("run_id","business_id","place_id"),
	CONSTRAINT "po_host_class_known" CHECK (host_class in ('none','business_site_dead','social','directory','platform_subdomain','other')),
	CONSTRAINT "po_sku_known" CHECK (sku in ('ts_essentials','ts_pro','ts_enterprise','ts_enterprise_atmosphere')),
	CONSTRAINT "po_host_class_agrees" CHECK (had_website_uri = (host_class <> 'none'))
);
--> statement-breakpoint
ALTER TABLE "place_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "place_coordinates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"observation_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "place_coordinates_observation_key" UNIQUE("observation_id"),
	CONSTRAINT "pc_expiry_within_30_days" CHECK (expires_at <= observed_at + interval '30 days'),
	CONSTRAINT "pc_expiry_after_observed" CHECK (expires_at > observed_at)
);
--> statement-breakpoint
ALTER TABLE "place_coordinates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "place_tiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"tile_key" text NOT NULL,
	"unit_kind" text NOT NULL,
	"unit_id" text NOT NULL,
	"places_type" text NOT NULL,
	"quad_path" text NOT NULL,
	"depth" integer NOT NULL,
	"south" double precision NOT NULL,
	"west" double precision NOT NULL,
	"north" double precision NOT NULL,
	"east" double precision NOT NULL,
	"is_leaf" boolean DEFAULT true NOT NULL,
	"saturated" boolean DEFAULT false NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"last_swept_run_id" uuid,
	"last_swept_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	CONSTRAINT "place_tiles_key" UNIQUE("org_id","tile_key"),
	CONSTRAINT "pt_depth_non_negative" CHECK (depth >= 0)
);
--> statement-breakpoint
ALTER TABLE "place_tiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "place_tile_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"tile_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	CONSTRAINT "place_tile_members_key" UNIQUE("tile_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "place_tile_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"run_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"tile_key" text NOT NULL,
	"cell_key" text NOT NULL,
	"cluster_key" text NOT NULL,
	"places_type" text NOT NULL,
	"kind" text NOT NULL,
	"depth" integer NOT NULL,
	"parent_tile_key" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"pages_done" integer DEFAULT 0 NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"saturated" boolean DEFAULT false NOT NULL,
	"subdivided" boolean DEFAULT false NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"truncated_why" text,
	"change_verdict" text,
	"new_ids" integer DEFAULT 0 NOT NULL,
	"gone_ids" integer DEFAULT 0 NOT NULL,
	"inflight_reservation_id" uuid,
	"inflight_request_id" text,
	CONSTRAINT "run_searches_key" UNIQUE("run_id","tile_key"),
	CONSTRAINT "rs_kind_known" CHECK (kind in ('enterprise','ids_only')),
	CONSTRAINT "rs_status_known" CHECK (status in ('planned','searching','done','stopped')),
	CONSTRAINT "rs_truncated_why_known" CHECK (truncated_why is null or truncated_why in ('max_depth','min_size','novelty')),
	CONSTRAINT "rs_change_verdict_known" CHECK (change_verdict is null or change_verdict in ('baseline','unchanged','new','gone','both','saturated'))
);
--> statement-breakpoint
ALTER TABLE "run_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run_place_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"run_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"cluster_key" text NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "run_place_outcomes_key" UNIQUE("run_id","place_id","cluster_key"),
	CONSTRAINT "rpo_outcome_known" CHECK (outcome in ('attached','tentative','unmatched','outside'))
);
--> statement-breakpoint
ALTER TABLE "run_place_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "place_purge_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows_purged" integer NOT NULL,
	"trigger" text NOT NULL,
	CONSTRAINT "ppr_rows_non_negative" CHECK (rows_purged >= 0),
	CONSTRAINT "ppr_trigger_known" CHECK (trigger in ('cron','desk'))
);
--> statement-breakpoint
ALTER TABLE "place_purge_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "kind" text DEFAULT 'full_sweep' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "partition_index" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "estimate_requests_lo" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "estimate_requests_hi" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "estimate_micro_usd_lo" bigint;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "estimate_micro_usd_hi" bigint;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "ceiling_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "place_attachments" ADD CONSTRAINT "place_attachments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_attachments" ADD CONSTRAINT "place_attachments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_attachments" ADD CONSTRAINT "place_attachments_tie_business_id_businesses_id_fk" FOREIGN KEY ("tie_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_attachments" ADD CONSTRAINT "place_attachments_first_seen_run_id_runs_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_attachments" ADD CONSTRAINT "place_attachments_last_seen_run_id_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_observations" ADD CONSTRAINT "place_observations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_observations" ADD CONSTRAINT "place_observations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_observations" ADD CONSTRAINT "place_observations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_observations" ADD CONSTRAINT "place_observations_attachment_id_place_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."place_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_coordinates" ADD CONSTRAINT "place_coordinates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_coordinates" ADD CONSTRAINT "place_coordinates_observation_id_place_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."place_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_tiles" ADD CONSTRAINT "place_tiles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_tiles" ADD CONSTRAINT "place_tiles_last_swept_run_id_runs_id_fk" FOREIGN KEY ("last_swept_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_tile_members" ADD CONSTRAINT "place_tile_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_tile_members" ADD CONSTRAINT "place_tile_members_tile_id_place_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."place_tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_searches" ADD CONSTRAINT "run_searches_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_searches" ADD CONSTRAINT "run_searches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_searches" ADD CONSTRAINT "run_searches_tile_id_place_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."place_tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_searches" ADD CONSTRAINT "run_searches_inflight_reservation_id_cost_reservations_id_fk" FOREIGN KEY ("inflight_reservation_id") REFERENCES "public"."cost_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_place_outcomes" ADD CONSTRAINT "run_place_outcomes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_place_outcomes" ADD CONSTRAINT "run_place_outcomes_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_purge_runs" ADD CONSTRAINT "place_purge_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_attachments_org_idx" ON "place_attachments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "place_attachments_queue_idx" ON "place_attachments" USING btree ("org_id","status","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "place_attachments_place_idx" ON "place_attachments" USING btree ("org_id","place_id");--> statement-breakpoint
CREATE INDEX "place_observations_org_idx" ON "place_observations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "place_observations_business_idx" ON "place_observations" USING btree ("org_id","business_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "place_coordinates_org_idx" ON "place_coordinates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "place_coordinates_expiry_idx" ON "place_coordinates" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "place_tiles_org_idx" ON "place_tiles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "place_tile_members_org_idx" ON "place_tile_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "place_tile_members_place_idx" ON "place_tile_members" USING btree ("org_id","place_id");--> statement-breakpoint
CREATE INDEX "run_searches_org_idx" ON "run_searches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "run_searches_run_idx" ON "run_searches" USING btree ("org_id","run_id");--> statement-breakpoint
CREATE INDEX "run_place_outcomes_org_idx" ON "run_place_outcomes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "run_place_outcomes_run_idx" ON "run_place_outcomes" USING btree ("org_id","run_id");--> statement-breakpoint
CREATE INDEX "place_purge_runs_org_idx" ON "place_purge_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "place_purge_runs_recent_idx" ON "place_purge_runs" USING btree ("org_id","ran_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_kind_known" CHECK (kind in ('full_sweep','partition','change_check'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_partition_index_range" CHECK (partition_index is null or partition_index between 0 and 3);--> statement-breakpoint
CREATE POLICY "place_attachments_select" ON "place_attachments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_attachments_insert" ON "place_attachments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_attachments_update" ON "place_attachments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_attachments_delete" ON "place_attachments" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_observations_select" ON "place_observations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_observations_insert" ON "place_observations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_observations_update" ON "place_observations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_observations_delete" ON "place_observations" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_coordinates_select" ON "place_coordinates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_coordinates_insert" ON "place_coordinates" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_coordinates_update" ON "place_coordinates" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_coordinates_delete" ON "place_coordinates" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tiles_select" ON "place_tiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tiles_insert" ON "place_tiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tiles_update" ON "place_tiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tiles_delete" ON "place_tiles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tile_members_select" ON "place_tile_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tile_members_insert" ON "place_tile_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tile_members_update" ON "place_tile_members" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_tile_members_delete" ON "place_tile_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_searches_select" ON "run_searches" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_searches_insert" ON "run_searches" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_searches_update" ON "run_searches" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_searches_delete" ON "run_searches" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_place_outcomes_select" ON "run_place_outcomes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_place_outcomes_insert" ON "run_place_outcomes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_place_outcomes_update" ON "run_place_outcomes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "run_place_outcomes_delete" ON "run_place_outcomes" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_purge_runs_select" ON "place_purge_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_purge_runs_insert" ON "place_purge_runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_purge_runs_update" ON "place_purge_runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "place_purge_runs_delete" ON "place_purge_runs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));
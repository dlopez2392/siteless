CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"source_key" text NOT NULL,
	"dataset_id" text,
	"source_version" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"gone" integer DEFAULT 0 NOT NULL,
	"total_seen" integer DEFAULT 0 NOT NULL,
	"stats" jsonb,
	"error" text,
	CONSTRAINT "ir_source_key_known" CHECK (source_key in ('tx_comptroller','tx_comptroller_closures','overture','census_geocoder')),
	CONSTRAINT "ir_status_known" CHECK (status in ('running','complete','stopped','failed'))
);
--> statement-breakpoint
ALTER TABLE "ingest_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "merge_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"left_id" uuid NOT NULL,
	"right_id" uuid NOT NULL,
	"block_key" text NOT NULL,
	"block_size" integer,
	"score" integer DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	CONSTRAINT "merge_candidates_pair_uniq" UNIQUE("org_id","left_id","right_id"),
	CONSTRAINT "mc_decision_known" CHECK (decision in ('pending','merged','distinct')),
	CONSTRAINT "mc_pair_ordered" CHECK (left_id < right_id)
);
--> statement-breakpoint
ALTER TABLE "merge_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"winner_id" uuid NOT NULL,
	"loser_id" uuid NOT NULL,
	"candidate_id" uuid,
	"reason" text NOT NULL,
	"score" integer,
	"features" jsonb,
	"merged_by" text NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"winner_fields_before" jsonb NOT NULL,
	"undone_by" text,
	"undone_at" timestamp with time zone,
	CONSTRAINT "bm_not_self" CHECK (winner_id <> loser_id),
	CONSTRAINT "bm_reason_known" CHECK (reason in ('auto','review'))
);
--> statement-breakpoint
ALTER TABLE "business_merges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"external_key" text NOT NULL,
	"business_id" uuid NOT NULL,
	"source_business_id" uuid NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "business_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "overture_category_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"basic_category" text NOT NULL,
	"cluster_key" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "overture_category_map_org_category_uniq" UNIQUE NULLS NOT DISTINCT("org_id","basic_category")
);
--> statement-breakpoint
ALTER TABLE "overture_category_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_records" DROP CONSTRAINT "sr_source_key_known";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "comptroller_key" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "primary_source" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "external_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "name_norm" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "street_num" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "street_norm" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "postal" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "location_match_type" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "phone_blockable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "basic_category" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "cluster_key" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "confidence" double precision;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "operating_status" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "chain_key" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "address_source_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "address_src_ret" text GENERATED ALWAYS AS ('durable') STORED;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "location_source_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "location_src_ret" text GENERATED ALWAYS AS ('durable') STORED;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "closed_at_source_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "closed_at_src_ret" text GENERATED ALWAYS AS ('durable') STORED;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_left_id_businesses_id_fk" FOREIGN KEY ("left_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_right_id_businesses_id_fk" FOREIGN KEY ("right_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_merges" ADD CONSTRAINT "business_merges_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_merges" ADD CONSTRAINT "business_merges_winner_id_businesses_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_merges" ADD CONSTRAINT "business_merges_loser_id_businesses_id_fk" FOREIGN KEY ("loser_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_merges" ADD CONSTRAINT "business_merges_candidate_id_merge_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."merge_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_aliases" ADD CONSTRAINT "business_aliases_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_aliases" ADD CONSTRAINT "business_aliases_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_aliases" ADD CONSTRAINT "business_aliases_source_business_id_businesses_id_fk" FOREIGN KEY ("source_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overture_category_map" ADD CONSTRAINT "overture_category_map_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_runs_org_idx" ON "ingest_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ingest_runs_source_idx" ON "ingest_runs" USING btree ("org_id","source_key","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "merge_candidates_org_idx" ON "merge_candidates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "merge_candidates_queue_idx" ON "merge_candidates" USING btree ("org_id","decision","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "business_merges_org_idx" ON "business_merges" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "business_merges_winner_idx" ON "business_merges" USING btree ("org_id","winner_id");--> statement-breakpoint
CREATE INDEX "business_aliases_org_idx" ON "business_aliases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "business_aliases_key_idx" ON "business_aliases" USING btree ("org_id","external_key");--> statement-breakpoint
CREATE INDEX "overture_category_map_org_idx" ON "overture_category_map" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_merged_into_id_businesses_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "sr_source_key_known" CHECK (source_key in ('overture','tx_comptroller','tx_comptroller_closures','census_geocoder','osm','county_dba','google_places','firecrawl','http_probe','dns_probe','manual'));--> statement-breakpoint
CREATE POLICY "ingest_runs_select" ON "ingest_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "ingest_runs_insert" ON "ingest_runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "ingest_runs_update" ON "ingest_runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "ingest_runs_delete" ON "ingest_runs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "merge_candidates_select" ON "merge_candidates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "merge_candidates_insert" ON "merge_candidates" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "merge_candidates_update" ON "merge_candidates" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "merge_candidates_delete" ON "merge_candidates" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_merges_select" ON "business_merges" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_merges_insert" ON "business_merges" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_merges_update" ON "business_merges" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_merges_delete" ON "business_merges" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_aliases_select" ON "business_aliases" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_aliases_insert" ON "business_aliases" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_aliases_update" ON "business_aliases" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "business_aliases_delete" ON "business_aliases" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "overture_category_map_select" ON "overture_category_map" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id is null or org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "overture_category_map_insert" ON "overture_category_map" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "overture_category_map_update" ON "overture_category_map" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id())) WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "overture_category_map_delete" ON "overture_category_map" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id()));
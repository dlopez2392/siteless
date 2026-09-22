CREATE TABLE "industry_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "industry_clusters_org_key_uniq" UNIQUE NULLS NOT DISTINCT("org_id","key")
);
--> statement-breakpoint
ALTER TABLE "industry_clusters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "industry_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"cluster_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"naics_lo" integer,
	"naics_hi" integer,
	CONSTRAINT "industry_terms_org_key_uniq" UNIQUE NULLS NOT DISTINCT("org_id","cluster_id","kind","value"),
	CONSTRAINT "it_kind_known" CHECK (kind in ('places_type','naics_range')),
	CONSTRAINT "it_naics_range_bounds" CHECK ((kind = 'naics_range') = (naics_lo is not null and naics_hi is not null))
);
--> statement-breakpoint
ALTER TABLE "industry_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"county_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_variants" text[] DEFAULT '{}'::text[] NOT NULL,
	"outlet_count" integer DEFAULT 0 NOT NULL,
	"is_rgv_seed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cities_org_county_name_uniq" UNIQUE NULLS NOT DISTINCT("org_id","county_id","name")
);
--> statement-breakpoint
ALTER TABLE "cities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "counties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"fips" text NOT NULL,
	"county_fips" integer NOT NULL,
	"comptroller_code" integer NOT NULL,
	"name" text NOT NULL,
	"is_rgv" boolean DEFAULT false NOT NULL,
	"outlet_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counties_org_fips_uniq" UNIQUE NULLS NOT DISTINCT("org_id","fips"),
	CONSTRAINT "counties_fips_identity" CHECK (county_fips = 2 * comptroller_code - 1)
);
--> statement-breakpoint
ALTER TABLE "counties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "geo_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "geo_presets_org_key_uniq" UNIQUE NULLS NOT DISTINCT("org_id","key"),
	CONSTRAINT "gp_kind_known" CHECK (kind in ('cities','counties','radius'))
);
--> statement-breakpoint
ALTER TABLE "geo_presets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outlet_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"scope" text NOT NULL,
	"county_id" uuid,
	"cluster_id" uuid NOT NULL,
	"outlets" integer NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "outlet_counts_org_scope_uniq" UNIQUE NULLS NOT DISTINCT("org_id","scope","county_id","cluster_id"),
	CONSTRAINT "oc_scope_known" CHECK (scope in ('county','state')),
	CONSTRAINT "oc_scope_target" CHECK ((scope = 'county') = (county_id is not null))
);
--> statement-breakpoint
ALTER TABLE "outlet_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "search_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"search_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"cluster_ids" uuid[] NOT NULL,
	"geo_kind" text NOT NULL,
	"geo_payload" jsonb NOT NULL,
	"estimate_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "search_versions_search_version_uniq" UNIQUE("search_id","version"),
	CONSTRAINT "sv_geo_kind_known" CHECK (geo_kind in ('cities','counties','radius'))
);
--> statement-breakpoint
ALTER TABLE "search_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"name_internal" text NOT NULL,
	"display_name" text NOT NULL,
	"current_version_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "searches_status_known" CHECK (status in ('active','archived'))
);
--> statement-breakpoint
ALTER TABLE "searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"search_version_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stopped_reason" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"calls_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "runs_status_known" CHECK (status in ('queued','running','complete','partial','refused','failed'))
);
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "industry_clusters" ADD CONSTRAINT "industry_clusters_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_terms" ADD CONSTRAINT "industry_terms_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_terms" ADD CONSTRAINT "industry_terms_cluster_id_industry_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."industry_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counties" ADD CONSTRAINT "counties_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_presets" ADD CONSTRAINT "geo_presets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_counts" ADD CONSTRAINT "outlet_counts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_counts" ADD CONSTRAINT "outlet_counts_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_counts" ADD CONSTRAINT "outlet_counts_cluster_id_industry_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."industry_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_versions" ADD CONSTRAINT "search_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_versions" ADD CONSTRAINT "search_versions_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_search_version_id_search_versions_id_fk" FOREIGN KEY ("search_version_id") REFERENCES "public"."search_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industry_clusters_org_idx" ON "industry_clusters" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "industry_terms_org_idx" ON "industry_terms" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "cities_org_idx" ON "cities" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "counties_org_idx" ON "counties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "geo_presets_org_idx" ON "geo_presets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "outlet_counts_org_idx" ON "outlet_counts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "search_versions_org_idx" ON "search_versions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "searches_org_idx" ON "searches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "runs_org_idx" ON "runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "runs_version_idx" ON "runs" USING btree ("search_version_id");--> statement-breakpoint
CREATE POLICY "industry_clusters_select" ON "industry_clusters" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id is null or org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "industry_clusters_insert" ON "industry_clusters" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "industry_clusters_update" ON "industry_clusters" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id())) WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "industry_clusters_delete" ON "industry_clusters" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "industry_terms_select" ON "industry_terms" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id is null or org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "industry_terms_insert" ON "industry_terms" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "industry_terms_update" ON "industry_terms" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id())) WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "industry_terms_delete" ON "industry_terms" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cities_select" ON "cities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id is null or org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cities_insert" ON "cities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cities_update" ON "cities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id())) WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cities_delete" ON "cities" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "counties_select" ON "counties" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id is null or org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "counties_insert" ON "counties" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "counties_update" ON "counties" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id())) WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "counties_delete" ON "counties" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "geo_presets_select" ON "geo_presets" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id is null or org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "geo_presets_insert" ON "geo_presets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "geo_presets_update" ON "geo_presets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id())) WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "geo_presets_delete" ON "geo_presets" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "outlet_counts_select" ON "outlet_counts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id is null or org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "outlet_counts_insert" ON "outlet_counts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "outlet_counts_update" ON "outlet_counts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id())) WITH CHECK (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "outlet_counts_delete" ON "outlet_counts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id is not null and org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "search_versions_select" ON "search_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "search_versions_insert" ON "search_versions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "searches_select" ON "searches" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "searches_insert" ON "searches" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "searches_update" ON "searches" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "searches_delete" ON "searches" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "runs_select" ON "runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "runs_insert" ON "runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "runs_update" ON "runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "runs_delete" ON "runs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));
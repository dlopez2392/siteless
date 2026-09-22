CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"source_key" text NOT NULL,
	"external_id" text,
	"business_id" uuid,
	"payload" jsonb,
	"payload_hash" text,
	"retention_class" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "sr_source_key_known" CHECK (source_key in ('overture','tx_comptroller','osm','county_dba','google_places','firecrawl','http_probe','dns_probe','manual')),
	CONSTRAINT "sr_retention_class_known" CHECK (retention_class in ('durable','ephemeral'))
);
--> statement-breakpoint
ALTER TABLE "source_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "legal_name_source_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "legal_name_src_ret" text GENERATED ALWAYS AS ('durable') STORED;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "display_name_source_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "display_name_src_ret" text GENERATED ALWAYS AS ('durable') STORED;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "phone_source_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "phone_src_ret" text GENERATED ALWAYS AS ('durable') STORED;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_records_org_idx" ON "source_records" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "source_records_select" ON "source_records" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "source_records_insert" ON "source_records" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "source_records_update" ON "source_records" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "source_records_delete" ON "source_records" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));
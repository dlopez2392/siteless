CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name_internal" text NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "orgs_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"legal_name" text,
	"display_name" text NOT NULL,
	"internal_notes" text,
	"phone_e164" text,
	"city" text,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_org_occurred_idx" ON "events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "businesses_org_idx" ON "businesses" USING btree ("org_id");
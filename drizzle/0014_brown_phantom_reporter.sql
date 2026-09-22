CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"provider" text NOT NULL,
	"period_start" date NOT NULL,
	"cap_micro_usd" bigint DEFAULT 50000000 NOT NULL,
	"reserved_micro_usd" bigint DEFAULT 0 NOT NULL,
	"spent_micro_usd" bigint DEFAULT 0 NOT NULL,
	"warned_80_at" timestamp with time zone,
	CONSTRAINT "budget_periods_org_provider_period_uniq" UNIQUE("org_id","provider","period_start"),
	CONSTRAINT "bp_provider_known" CHECK (provider in ('places','firecrawl','anthropic')),
	CONSTRAINT "bp_not_over" CHECK (spent_micro_usd + reserved_micro_usd <= cap_micro_usd),
	CONSTRAINT "bp_non_negative" CHECK (cap_micro_usd >= 0 and reserved_micro_usd >= 0 and spent_micro_usd >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"budget_period_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"run_id" uuid,
	"lead_id" uuid,
	"provider" text NOT NULL,
	"sku" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"micro_usd" bigint DEFAULT 0 NOT NULL,
	"cost_cents" numeric(12, 2) GENERATED ALWAYS AS (micro_usd / 10000.0) STORED,
	"request_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_ledger_request_id_key" UNIQUE("request_id"),
	CONSTRAINT "cl_micro_non_negative" CHECK (micro_usd >= 0),
	CONSTRAINT "cl_units_positive" CHECK (units > 0)
);
--> statement-breakpoint
ALTER TABLE "cost_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cost_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"budget_period_id" uuid NOT NULL,
	"run_id" uuid,
	"sku" text NOT NULL,
	"est_micro_usd" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "cr_est_positive" CHECK (est_micro_usd > 0)
);
--> statement-breakpoint
ALTER TABLE "cost_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "public"."budget_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_reservation_id_cost_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."cost_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "public"."budget_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_periods_org_idx" ON "budget_periods" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_org_period_idx" ON "cost_ledger" USING btree ("org_id","budget_period_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_run_idx" ON "cost_ledger" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "cost_reservations_org_idx" ON "cost_reservations" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "budget_periods_select" ON "budget_periods" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "budget_periods_insert" ON "budget_periods" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "budget_periods_update" ON "budget_periods" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "budget_periods_delete" ON "budget_periods" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cost_ledger_select" ON "cost_ledger" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cost_ledger_insert" ON "cost_ledger" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cost_reservations_select" ON "cost_reservations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cost_reservations_insert" ON "cost_reservations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cost_reservations_update" ON "cost_reservations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "cost_reservations_delete" ON "cost_reservations" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));
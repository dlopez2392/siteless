ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "orgs_select" ON "orgs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "orgs_update" ON "orgs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (id = (select app.current_org_id())) WITH CHECK (id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "events_select" ON "events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "events_insert" ON "events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "businesses_select" ON "businesses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "businesses_insert" ON "businesses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "businesses_update" ON "businesses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (org_id = (select app.current_org_id())) WITH CHECK (org_id = (select app.current_org_id()));--> statement-breakpoint
CREATE POLICY "businesses_delete" ON "businesses" AS PERMISSIVE FOR DELETE TO "authenticated" USING (org_id = (select app.current_org_id()));
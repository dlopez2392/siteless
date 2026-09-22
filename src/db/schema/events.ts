import { bigint, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { orgs } from './orgs';
import { tstz } from './_helpers';

// D-06: the append-only record of truth for every state change. UPDATE and DELETE are
// revoked as grants (plan 09), not merely left unpolicied — a missing policy denies by
// default today but a later `for all` policy would silently re-open it.
export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    actorId: text('actor_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('events_org_occurred_idx').on(t.orgId, t.occurredAt)],
);

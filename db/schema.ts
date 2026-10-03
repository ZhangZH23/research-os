import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable(
  'research_records',
  {
    collection: text('collection').notNull(),
    id: text('id').notNull(),
    position: integer('position').notNull(),
    payload: text('payload').notNull(),
  },
  (t) => [primaryKey({ columns: [t.collection, t.id] })],
);
export const revision = sqliteTable('workspace_revision', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  token: text('token').notNull().default(''),
});
export const leases = sqliteTable('chat_leases', {
  sessionId: text('session_id').primaryKey(),
  token: text('token').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

// Research State Engine v1 adds the engine_records collection to research_records.
// It needs no new persistent D1 table: cloud/sqlite.ts reconstructs request-local
// domain tables and registers every collection for the existing guarded CAS save.
// Initializing that local schema is not a production D1 schema migration.

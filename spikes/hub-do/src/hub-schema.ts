// Tablas SOLO del hub (§9.4). En el spike basta con tenant_meta (secuencia).
export * from './schema';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tenantMeta = sqliteTable('tenant_meta', {
  key: text().primaryKey(),
  seq: integer().notNull().default(0),
  minSchema: integer().notNull().default(1),
  createdAt: integer().notNull(),
});

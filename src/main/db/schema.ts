import { sql } from 'drizzle-orm';
import { check, int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type GameRow = typeof gamesTable.$inferSelect;
export type Session = typeof sessionsTable.$inferSelect;
export type Iteration = typeof iterationsTable.$inferSelect;
export type StateEvent = typeof stateEventsTable.$inferSelect;
export type SpendEvent = typeof spendEventsTable.$inferSelect;

export const gamesTable = sqliteTable('games', {
  id: int().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  coverUrl: text(),
  heroUrl: text(),
  igdbId: int().notNull().unique(),
  steamGridDbId: int().unique(),
  officialPlatforms: text({ mode: 'json' }).$type<string[]>(),
  hltbMain: real(),
  hltbMainExtras: real(),
  hltbCompletionist: real(),
  notes: text(),
  endless: int({ mode: 'boolean' }).notNull().default(false),
  addedAt: int({ mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessionsTable = sqliteTable(
  'sessions',
  {
    id: int().primaryKey({ autoIncrement: true }),
    iterationId: int()
      .notNull()
      .references(() => iterationsTable.id, { onDelete: 'cascade' }),
    isManual: int({ mode: 'boolean' }).notNull().default(false),
    startedAt: int({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    endedAt: int({ mode: 'timestamp_ms' }),
    durationSec: int(),
    datePrecision: text({ enum: ['year', 'month', 'day', 'datetime'] }).notNull(),
    milestone: text({ enum: ['started', 'completed', 'dropped', 'on_hold'] }),
  },
  (table) => [
    check(
      'sessions_date_precision_check',
      sql`${table.datePrecision} in ('year', 'month', 'day', 'datetime')`,
    ),
    check(
      'sessions_milestone_check',
      sql`${table.milestone} is null or ${table.milestone} in ('started', 'completed', 'dropped', 'on_hold')`,
    ),
  ],
);

export const iterationsTable = sqliteTable(
  'iterations',
  {
    id: int().primaryKey({ autoIncrement: true }),
    gameId: int()
      .notNull()
      .references(() => gamesTable.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    playedPlatform: text().notNull(),
    origin: text().notNull(),
    format: text({ enum: ['digital', 'physical'] }),
    manualTotalPlayed: real(),
    rating: int().$type<1 | 2 | 3 | 4 | 5>(),
    extraContent: int({ mode: 'boolean' }).notNull().default(false),
    startSessionId: int().references(() => sessionsTable.id),
    endSessionId: int().references(() => sessionsTable.id),
  },
  (table) => [
    check('format_check', sql`${table.format} in ('digital', 'physical')`),
    check('rating_range', sql`${table.rating} is null or (${table.rating} between 1 and 5)`),
  ],
);

export const stateEventsTable = sqliteTable(
  'state_events',
  {
    id: int().primaryKey({ autoIncrement: true }),
    iterationId: int()
      .notNull()
      .references(() => iterationsTable.id, { onDelete: 'cascade' }),
    type: text({ enum: ['started', 'completed', 'dropped', 'on_hold'] }).notNull(),
    occurredAt: int({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    datePrecision: text({ enum: ['year', 'month', 'day', 'datetime'] }).notNull(),
    note: text(),
  },
  (table) => [
    check(
      'state_events_type_check',
      sql`${table.type} in ('started', 'completed', 'dropped', 'on_hold')`,
    ),
    check(
      'state_events_date_precision_check',
      sql`${table.datePrecision} in ('year', 'month', 'day', 'datetime')`,
    ),
  ],
);

export const spendEventsTable = sqliteTable(
  'spend_events',
  {
    id: int().primaryKey({ autoIncrement: true }),
    gameId: int()
      .notNull()
      .references(() => gamesTable.id, { onDelete: 'cascade' }),
    type: text({ enum: ['purchase', 'ingame_spend'] }).notNull(),
    amount: real().notNull(),
    occurredAt: int({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    datePrecision: text({ enum: ['year', 'month', 'day', 'datetime'] }).notNull(),
    note: text(),
  },
  (table) => [
    check('spend_events_type_check', sql`${table.type} in ('purchase', 'ingame_spend')`),
    check(
      'spend_events_date_precision_check',
      sql`${table.datePrecision} in ('year', 'month', 'day', 'datetime')`,
    ),
  ],
);

// ESQUEMA COMPARTIDO escritorio <-> hub (S-01).
//
// Este fichero es el que importan TANTO el Durable Object (src/hub.ts, vía
// drizzle-orm/durable-sqlite) COMO el script de Node con @libsql/client
// (scripts/libsql-shared-schema.ts). No importa nada de Cloudflare ni de Node.
//
// Cinco tablas de §7.4 con las columnas de sync de §7.3 e ids TEXT (§7.2).
// Solo depende de drizzle-orm/sqlite-core.
//
// Decisión del spike: las DOS columnas que no son comunes (`syncDirty`, solo
// local; `syncSeq`, solo hub) viven en la misma definición. Cada lado ignora
// la otra y su índice es PARCIAL, así que no cuesta escrituras en el lado que
// no la usa: en el hub `syncDirty` es siempre 0 (el índice `where syncDirty =
// 1` no recibe entradas) y en el PC `syncSeq` es siempre null.
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const syncColumns = () => ({
  id: text().primaryKey(),
  syncCreated: text().notNull(),
  syncUpdated: text().notNull(),
  syncFields: text().notNull().default('{}'),
  syncDeleted: text(),
  syncDirty: integer().notNull().default(0),
  syncSeq: integer(),
});

// Índices de sync que lleva TODA tabla sincronizada (§7.8 + §8.4).
const syncIndexes = (name: string, t: { syncDirty: any; syncSeq: any }) => [
  index(`${name}_sync_dirty_idx`).on(t.syncDirty).where(sql`"syncDirty" = 1`),
  index(`${name}_sync_seq_idx`).on(t.syncSeq).where(sql`"syncSeq" is not null`),
];

export const games = sqliteTable(
  'games',
  {
    ...syncColumns(),
    title: text().notNull(),
    igdbId: integer(),
    steamAppId: integer(),
    raGameId: integer(),
    sgdbId: integer(),
    steamAppIdSource: text(),
    sgdbIdSource: text(),
    coverOverride: text(),
    heroOverride: text(),
    developerOverride: text(),
    publisherOverride: text(),
    genresOverride: text(),
    notes: text(),
    endless: integer().notNull().default(0),
    isEmulated: integer().notNull().default(0),
    addedAt: integer().notNull(),
    promotedAt: integer(),
    saveBackupEnabled: integer().notNull().default(0),
    saveDetectionSource: text(),
    saveLudusaviName: text(),
    saveCustomPaths: text(),
    saveKey: text(),
  },
  (t) => [
    ...syncIndexes('games', t),
    index('games_igdb_idx').on(t.igdbId),
    index('games_steam_idx').on(t.steamAppId),
  ],
);

export const playthroughs = sqliteTable(
  'playthroughs',
  {
    ...syncColumns(),
    gameId: text()
      .notNull()
      .references(() => games.id),
    customLabel: text(),
    playedPlatform: text(),
    origin: text(),
    format: text(),
    manualHours: real(),
    rating: integer(),
    extraContent: text(),
  },
  (t) => [...syncIndexes('playthroughs', t), index('playthroughs_game_idx').on(t.gameId)],
);

export const stateEvents = sqliteTable(
  'state_events',
  {
    ...syncColumns(),
    playthroughId: text()
      .notNull()
      .references(() => playthroughs.id),
    type: text().notNull(),
    occurredAt: integer().notNull(),
    datePrecision: text().notNull(),
    note: text(),
    deviceId: text(),
  },
  (t) => [...syncIndexes('state_events', t), index('state_events_pt_idx').on(t.playthroughId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    ...syncColumns(),
    playthroughId: text().references(() => playthroughs.id),
    emulatorId: text(),
    deviceId: text().notNull(),
    startedBy: text().notNull(),
    source: text().notNull(),
    startedAt: integer().notNull(),
    endedAt: integer(),
    durationSec: integer(),
    datePrecision: text().notNull(),
    lastSeenAt: integer(),
    closedBy: text(),
    note: text(),
  },
  (t) => [
    ...syncIndexes('sessions', t),
    index('sessions_pt_idx').on(t.playthroughId),
    index('sessions_device_ended_idx').on(t.deviceId, t.endedAt),
    index('sessions_emulator_idx').on(t.emulatorId),
    index('sessions_started_idx').on(t.startedAt),
  ],
);

export const achievements = sqliteTable(
  'achievements',
  {
    ...syncColumns(),
    gameId: text()
      .notNull()
      .references(() => games.id),
    source: text().notNull(),
    apiName: text().notNull(),
    displayName: text(),
    description: text(),
    iconUrl: text(),
    iconGrayUrl: text(),
    hidden: integer().notNull().default(0),
    globalPercent: real(),
    sortIndex: integer(),
  },
  (t) => [...syncIndexes('achievements', t), index('achievements_game_idx').on(t.gameId)],
);

// Registro de tablas sincronizadas: nombre en tránsito (§8.4) -> tabla.
export const syncedTables = {
  games,
  playthroughs,
  state_events: stateEvents,
  sessions,
  achievements,
} as const;
export type SyncedTableName = keyof typeof syncedTables;
// Orden padre -> hijo (para sembrar sin depender de FK diferidas).
export const tableOrder: SyncedTableName[] = [
  'games',
  'playthroughs',
  'state_events',
  'sessions',
  'achievements',
];

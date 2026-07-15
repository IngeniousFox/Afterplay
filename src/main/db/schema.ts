import { int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Nada de `check()` SQL en columnas tipo-enum (type/milestone/datePrecision/
// format) — a propósito, tras un incidente real. SQLite no permite ALTER un
// CHECK existente: cada vez que se añade un valor al enum (pasó al meter
// 'plan_to_play'), drizzle-kit genera una migración que reconstruye la tabla
// entera (CREATE __new_x + copiar filas + DROP + RENAME). Ese RENAME final no
// se replicó bien a Turso a través de @tursodatabase/sync (todavía en early
// preview): el remoto se quedó con `__new_state_events` con los datos, sin
// que la tabla real `state_events` volviera a aparecer. Los `enum: [...]` de
// abajo se quedan (son solo un tipo de TypeScript, ningún CHECK de SQL), así
// que la validación de estos campos vive SOLO en la capa de TypeScript/app,
// nunca en la base de datos — evita este tipo de migración para siempre.

export type GameRow = typeof gamesTable.$inferSelect;
export type Session = typeof sessionsTable.$inferSelect;
export type Iteration = typeof iterationsTable.$inferSelect;
export type StateEvent = typeof stateEventsTable.$inferSelect;
export type SpendEvent = typeof spendEventsTable.$inferSelect;

// Formas de INSERT ($inferInsert): distintas de las de SELECT — aquí id y las
// columnas con default son opcionales. Son la base de los inputs de los
// handlers de crear/editar que expone shared/types.ts.
export type NewGame = typeof gamesTable.$inferInsert;
export type NewSession = typeof sessionsTable.$inferInsert;
export type NewIteration = typeof iterationsTable.$inferInsert;
export type NewStateEvent = typeof stateEventsTable.$inferInsert;
export type NewSpendEvent = typeof spendEventsTable.$inferInsert;

export const gamesTable = sqliteTable('games', {
  id: int().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  coverUrl: text(),
  heroUrl: text(),
  igdbId: int().notNull().unique(),
  steamGridDbId: int().unique(),
  officialPlatforms: text({ mode: 'json' }).$type<string[]>(),
  releaseYear: int(),
  hltbMain: real(),
  hltbMainExtras: real(),
  hltbCompletionist: real(),
  notes: text(),
  executablePath: text(),
  // Bloque 2G — editables a mano en el modal de editar, ninguno viene de
  // IGDB de forma fiable salvo developer/publisher/genres (que sí se
  // rellenan solos al crear el juego, ver createGameWithDetails.ts).
  developer: text(),
  publisher: text(),
  installDirectory: text(),
  // Calculado una vez al elegir la carpeta (recorrido recursivo, ver
  // main/lib/directorySize.ts), no en cada carga del detalle — reelegir la
  // carpeta vuelve a calcularlo.
  installSizeBytes: int(),
  genres: text({ mode: 'json' }).$type<string[]>(),
  endless: int({ mode: 'boolean' }).notNull().default(false),
  // Sección Plan to Play: true = vive SOLO en /plan (fuera de Library/
  // Sessions/Stats/watcher). La fuente de verdad es esta columna, NO el
  // evento 'plan_to_play' del historial: pasar el juego a la biblioteca
  // puede añadir eventos con fechas del PASADO ("lo jugué antes") o ninguno
  // (Unplayed), así que "el evento más reciente" no sirve para saber si
  // sigue planeado.
  planned: int({ mode: 'boolean' }).notNull().default(false),
  addedAt: int({ mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessionsTable = sqliteTable('sessions', {
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
  // "Latido" del watcher: se refresca cada ciclo (~5s) mientras la sesión
  // está en marcha. Si la app muere de golpe (corte de luz, cuelgue), al
  // recuperar la sesión se cierra en este último latido en vez de quedar
  // abierta hasta el siguiente arranque — así no se pierde el tiempo jugado
  // ni se infla con el hueco de la app apagada. Null en sesiones manuales.
  lastHeartbeatAt: int({ mode: 'timestamp_ms' }),
  datePrecision: text({ enum: ['year', 'month', 'day', 'datetime'] }).notNull(),
  milestone: text({ enum: ['started', 'completed', 'dropped', 'on_hold'] }),
});

export const iterationsTable = sqliteTable('iterations', {
  id: int().primaryKey({ autoIncrement: true }),
  gameId: int()
    .notNull()
    .references(() => gamesTable.id, { onDelete: 'cascade' }),
  label: text().notNull(),
  playedPlatform: text().notNull(),
  origin: text().notNull(),
  format: text({ enum: ['digital', 'physical'] }),
  manualTotalPlayed: real(),
  // Rango 1-5 validado en TypeScript (ver $type abajo), no en SQL — mismo
  // motivo que el resto del archivo.
  rating: int().$type<1 | 2 | 3 | 4 | 5>(),
  extraContent: int({ mode: 'boolean' }).notNull().default(false),
  startSessionId: int().references(() => sessionsTable.id),
  endSessionId: int().references(() => sessionsTable.id),
});

export const stateEventsTable = sqliteTable('state_events', {
  id: int().primaryKey({ autoIncrement: true }),
  iterationId: int()
    .notNull()
    .references(() => iterationsTable.id, { onDelete: 'cascade' }),
  // 'plan_to_play' es SOLO una entrada de historial ("Planeado el X") — el
  // estado actual de un juego se deriva ignorándolo (ver games.planned).
  // Nunca aparece en ningún dropdown de estado: no se puede elegir ni
  // volver a él.
  type: text({
    enum: ['started', 'completed', 'dropped', 'on_hold', 'resting', 'plan_to_play'],
  }).notNull(),
  occurredAt: int({ mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  datePrecision: text({ enum: ['year', 'month', 'day', 'datetime'] }).notNull(),
  note: text(),
});

export const spendEventsTable = sqliteTable('spend_events', {
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
});

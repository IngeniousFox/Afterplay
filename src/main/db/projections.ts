import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from './schema';

// Proyecciones de fila completa para .select(...) y .returning(...).
//
// ¿Por qué existen? El select()/returning() SIN argumentos de drizzle infiere
// el tipo desde el modelo completo de la tabla, y con el driver RC + este
// tamaño de proyecto TypeScript se queda sin presupuesto de instanciación:
// la inferencia se degrada a any de forma NO determinista (el error salta en
// un archivo u otro según qué se compiló antes). Con proyecciones explícitas
// el tipo del resultado se construye directo del objeto, barato y estable.
// Si se añade una columna a una tabla, hay que añadirla también aquí.

export const gameColumns = {
  id: gamesTable.id,
  title: gamesTable.title,
  coverUrl: gamesTable.coverUrl,
  heroUrl: gamesTable.heroUrl,
  igdbId: gamesTable.igdbId,
  steamGridDbId: gamesTable.steamGridDbId,
  officialPlatforms: gamesTable.officialPlatforms,
  releaseYear: gamesTable.releaseYear,
  hltbMain: gamesTable.hltbMain,
  hltbMainExtras: gamesTable.hltbMainExtras,
  hltbCompletionist: gamesTable.hltbCompletionist,
  notes: gamesTable.notes,
  executablePath: gamesTable.executablePath,
  developer: gamesTable.developer,
  publisher: gamesTable.publisher,
  installDirectory: gamesTable.installDirectory,
  installSizeBytes: gamesTable.installSizeBytes,
  genres: gamesTable.genres,
  endless: gamesTable.endless,
  planned: gamesTable.planned,
  addedAt: gamesTable.addedAt,
};

export const iterationColumns = {
  id: iterationsTable.id,
  gameId: iterationsTable.gameId,
  label: iterationsTable.label,
  playedPlatform: iterationsTable.playedPlatform,
  origin: iterationsTable.origin,
  format: iterationsTable.format,
  manualTotalPlayed: iterationsTable.manualTotalPlayed,
  rating: iterationsTable.rating,
  extraContent: iterationsTable.extraContent,
  startSessionId: iterationsTable.startSessionId,
  endSessionId: iterationsTable.endSessionId,
};

export const sessionColumns = {
  id: sessionsTable.id,
  iterationId: sessionsTable.iterationId,
  isManual: sessionsTable.isManual,
  startedAt: sessionsTable.startedAt,
  endedAt: sessionsTable.endedAt,
  durationSec: sessionsTable.durationSec,
  lastHeartbeatAt: sessionsTable.lastHeartbeatAt,
  datePrecision: sessionsTable.datePrecision,
  milestone: sessionsTable.milestone,
};

export const stateEventColumns = {
  id: stateEventsTable.id,
  iterationId: stateEventsTable.iterationId,
  type: stateEventsTable.type,
  occurredAt: stateEventsTable.occurredAt,
  datePrecision: stateEventsTable.datePrecision,
  note: stateEventsTable.note,
};

export const spendEventColumns = {
  id: spendEventsTable.id,
  gameId: spendEventsTable.gameId,
  type: spendEventsTable.type,
  amount: spendEventsTable.amount,
  occurredAt: spendEventsTable.occurredAt,
  datePrecision: spendEventsTable.datePrecision,
  note: spendEventsTable.note,
};

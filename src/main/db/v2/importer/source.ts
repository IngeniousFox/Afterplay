import { DatabaseSync } from 'node:sqlite';

// Lectura de una base 1.x (`src/main/db/schema.ts`) para el importador.
//
// Se lee con SQL crudo y no con el esquema Drizzle de la 1.x a propósito:
// - los JSON (géneros, plataformas, colecciones, el texto de un recap…) se
//   copian con su TEXTO exacto, sin pasar por `JSON.parse`/`stringify`, que
//   podría cambiar un número en coma flotante o el formato;
// - las fechas llegan como los milisegundos que hay guardados y no como
//   `Date`, que es lo que se escribe en la 2.0 (misma convención,
//   `timestamp_ms`);
// - y así el importador no arrastra el driver de la 1.x: `node:sqlite` es el
//   mismo que usa la base 2.0.
//
// Cada consulta nombra sus columnas: si la base es de una versión anterior de
// la 1.x a la que le falta alguna, falla aquí con un mensaje claro en vez de
// importar a medias.

export type SqlValue = number | string | null;
type Row<C extends string> = { readonly [K in C]: SqlValue };

const GAME_COLUMNS = [
  'id',
  'title',
  'coverUrl',
  'heroUrl',
  'igdbId',
  'sgdbId',
  'officialPlatforms',
  'releaseYear',
  'hltbMain',
  'hltbMainExtras',
  'hltbCompletionist',
  'notes',
  'executablePath',
  'developer',
  'publisher',
  'installDirectory',
  'installSizeBytes',
  'genres',
  'endless',
  'isEmulated',
  'planned',
  'addedAt',
  'promotedAt',
  'saveBackupEnabled',
  'saveDetectionSource',
  'saveLudusaviName',
  'saveCustomPaths',
  'curiositiesGeneratedAt',
  'steamAppId',
  'steamAppIdManual',
  'steamAppIdCheckedAt',
  'achievementsSyncedAt',
  'achievementsUnlocksSyncedAt',
  'raGameId',
  'raCheckedAt',
  'ratingCritics',
  'ratingCriticsCount',
  'ratingUsers',
  'ratingUsersCount',
  'ratingsCheckedAt',
  'summary',
  'igdbCollections',
  'steamTags',
  'steamPositive',
  'steamNegative',
  'steamSpyCheckedAt',
  'planPinnedAt',
  'releaseDate',
  'releaseDatePrecision',
] as const;

const ITERATION_COLUMNS = [
  'id',
  'gameId',
  'label',
  'playedPlatform',
  'origin',
  'format',
  'manualTotalPlayed',
  'rating',
  'extraContent',
] as const;

const SESSION_COLUMNS = [
  'id',
  'iterationId',
  'emulatorId',
  'isManual',
  'startedAt',
  'endedAt',
  'durationSec',
  'lastHeartbeatAt',
  'startedBy',
  'datePrecision',
  'note',
] as const;

const STATE_EVENT_COLUMNS = [
  'id',
  'iterationId',
  'type',
  'occurredAt',
  'datePrecision',
  'note',
] as const;

const SPEND_COLUMNS = [
  'id',
  'gameId',
  'type',
  'amount',
  'occurredAt',
  'datePrecision',
  'note',
] as const;

const EMULATOR_COLUMNS = ['id', 'name', 'executablePath'] as const;

const ACHIEVEMENT_COLUMNS = [
  'id',
  'gameId',
  'apiName',
  'displayName',
  'description',
  'iconUrl',
  'iconGrayUrl',
  'hidden',
  'globalPercent',
  'sortIndex',
] as const;

const UNLOCK_COLUMNS = [
  'id',
  'achievementId',
  'unlockedAt',
  'dateReliable',
  'source',
  'iterationId',
  'sessionId',
] as const;

const CURIOSITY_COLUMNS = ['id', 'gameId', 'text'] as const;

const MEMORY_COLUMNS = [
  'id',
  'scopeType',
  'scopeKey',
  'payload',
  'sourceHash',
  'model',
  'promptVersion',
  'createdAt',
] as const;

const RADAR_COLUMNS = [
  'id',
  'igdbId',
  'collectionId',
  'collectionName',
  'title',
  'coverUrl',
  'releaseDate',
  'releaseDatePrecision',
  'releaseYear',
  'discoveredAt',
  'dismissedAt',
] as const;

export type LegacyGame = Row<(typeof GAME_COLUMNS)[number]>;
export type LegacyIteration = Row<(typeof ITERATION_COLUMNS)[number]>;
export type LegacySession = Row<(typeof SESSION_COLUMNS)[number]>;
export type LegacyStateEvent = Row<(typeof STATE_EVENT_COLUMNS)[number]>;
export type LegacySpend = Row<(typeof SPEND_COLUMNS)[number]>;
export type LegacyEmulator = Row<(typeof EMULATOR_COLUMNS)[number]>;
export type LegacyAchievement = Row<(typeof ACHIEVEMENT_COLUMNS)[number]>;
export type LegacyUnlock = Row<(typeof UNLOCK_COLUMNS)[number]>;
export type LegacyCuriosity = Row<(typeof CURIOSITY_COLUMNS)[number]>;
export type LegacyMemory = Row<(typeof MEMORY_COLUMNS)[number]>;
export type LegacyRadarGame = Row<(typeof RADAR_COLUMNS)[number]>;

/** Todo lo que el importador necesita de una base 1.x, ya en memoria. */
export interface LegacyData {
  readonly games: readonly LegacyGame[];
  readonly iterations: readonly LegacyIteration[];
  readonly sessions: readonly LegacySession[];
  readonly stateEvents: readonly LegacyStateEvent[];
  readonly spendEvents: readonly LegacySpend[];
  readonly emulators: readonly LegacyEmulator[];
  readonly achievements: readonly LegacyAchievement[];
  readonly unlocks: readonly LegacyUnlock[];
  readonly curiosities: readonly LegacyCuriosity[];
  readonly memories: readonly LegacyMemory[];
  readonly radarGames: readonly LegacyRadarGame[];
  /** `save_backups` no se migra (§19.5): solo se cuenta. */
  readonly saveBackupCount: number;
  /** Órdenes del buzón sin procesar (§19.7). */
  readonly pendingMailbox: number;
  /** Total de filas del buzón, procesadas o no (desaparece entero). */
  readonly mailboxCount: number;
  /**
   * El instante más reciente que la base SABE que ya pasó: el mayor de los
   * sellos que escribe la app con la hora del PC (altas, sesiones, sellos de
   * comprobación, recaps, copias de partidas, buzón). Es el techo de los
   * relojes importados (ver legacyClocks.ts): solo depende del origen, así que
   * dos PCs que importan la misma base lo calculan igual.
   */
  readonly ceilingMs: number;
}

function selectAll<C extends string>(
  db: DatabaseSync,
  table: string,
  columns: readonly C[],
  orderBy = '"id"',
): Row<C>[] {
  const sql = `SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}" ORDER BY ${orderBy}`;
  let statement;
  try {
    statement = db.prepare(sql);
  } catch (error) {
    throw new Error(
      `La base 1.x no tiene la forma esperada en "${table}" (${(error as Error).message}). ` +
        '¿Es una copia de una versión anterior de la 1.x? Ábrela antes con la 1.x actual para que se migre.',
    );
  }
  return statement.all() as Row<C>[];
}

const countOf = (db: DatabaseSync, sql: string): number =>
  Number((db.prepare(sql).get() as { n: number | null } | undefined)?.n ?? 0);

/** Lee la base 1.x entera. No escribe nada. */
export function readLegacyData(db: DatabaseSync): LegacyData {
  const games = selectAll(db, 'games', GAME_COLUMNS);
  const iterations = selectAll(db, 'iterations', ITERATION_COLUMNS);
  const sessions = selectAll(db, 'sessions', SESSION_COLUMNS);
  const stateEvents = selectAll(db, 'state_events', STATE_EVENT_COLUMNS);
  const spendEvents = selectAll(db, 'spend_events', SPEND_COLUMNS);
  const emulators = selectAll(db, 'emulators', EMULATOR_COLUMNS);
  const achievements = selectAll(db, 'achievements', ACHIEVEMENT_COLUMNS);
  const unlocks = selectAll(db, 'achievement_unlocks', UNLOCK_COLUMNS);
  const curiosities = selectAll(db, 'curiosities', CURIOSITY_COLUMNS);
  const memories = selectAll(db, 'generated_memories', MEMORY_COLUMNS);
  const radarGames = selectAll(db, 'radar_games', RADAR_COLUMNS);

  const saveBackupCount = countOf(db, 'SELECT count(*) AS n FROM save_backups');
  const mailboxCount = countOf(db, 'SELECT count(*) AS n FROM plan_mailbox');
  const pendingMailbox = countOf(
    db,
    'SELECT count(*) AS n FROM plan_mailbox WHERE "processedAt" IS NULL',
  );

  // Sellos que pone la app con la hora del PC (nunca fechas tecleadas).
  const machineStamps = [
    'SELECT max(m) AS n FROM (SELECT max("addedAt") AS m FROM games' +
      ' UNION ALL SELECT max("promotedAt") FROM games' +
      ' UNION ALL SELECT max("planPinnedAt") FROM games' +
      ' UNION ALL SELECT max("curiositiesGeneratedAt") FROM games' +
      ' UNION ALL SELECT max("steamAppIdCheckedAt") FROM games' +
      ' UNION ALL SELECT max("achievementsSyncedAt") FROM games' +
      ' UNION ALL SELECT max("achievementsUnlocksSyncedAt") FROM games' +
      ' UNION ALL SELECT max("raCheckedAt") FROM games' +
      ' UNION ALL SELECT max("ratingsCheckedAt") FROM games' +
      ' UNION ALL SELECT max("steamSpyCheckedAt") FROM games' +
      ' UNION ALL SELECT max("startedAt") FROM sessions WHERE "isManual" = 0' +
      ' UNION ALL SELECT max("endedAt") FROM sessions WHERE "isManual" = 0' +
      ' UNION ALL SELECT max("lastHeartbeatAt") FROM sessions' +
      ' UNION ALL SELECT max("createdAt") FROM generated_memories' +
      ' UNION ALL SELECT max("discoveredAt") FROM radar_games' +
      ' UNION ALL SELECT max("dismissedAt") FROM radar_games' +
      ' UNION ALL SELECT max("createdAt") FROM save_backups' +
      ' UNION ALL SELECT max("createdAt") FROM plan_mailbox' +
      ' UNION ALL SELECT max("processedAt") FROM plan_mailbox)',
  ];
  const ceilingMs = countOf(db, machineStamps[0]);

  return {
    games,
    iterations,
    sessions,
    stateEvents,
    spendEvents,
    emulators,
    achievements,
    unlocks,
    curiosities,
    memories,
    radarGames,
    saveBackupCount,
    pendingMailbox,
    mailboxCount,
    // Una base vacía no tiene sellos: cualquier valor positivo sirve (no hay
    // filas a las que dar reloj salvo la del dispositivo `legacy`).
    ceilingMs: Math.max(ceilingMs, 1),
  };
}

/** Abre una base 1.x en solo lectura, o usa la conexión que se le da. */
export function withLegacySource<T>(source: string | DatabaseSync, fn: (db: DatabaseSync) => T): T {
  if (typeof source !== 'string') return fn(source);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

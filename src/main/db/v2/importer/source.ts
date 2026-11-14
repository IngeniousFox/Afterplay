import { DatabaseSync } from 'node:sqlite';
import { ImportBlockedError } from './build';

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
  /**
   * Juegos con alguna copia de partida en la 1.x. Las copias no se importan
   * (se reindexan del bucket), pero cuentan como "registro de partida" en la
   * condición de devolver al Plan, y la validación con consultas lo necesita.
   */
  readonly saveBackupGameIds: readonly number[];
  /** Órdenes del buzón sin procesar (§19.7). */
  readonly pendingMailbox: number;
  /** Total de filas del buzón, procesadas o no (desaparece entero). */
  readonly mailboxCount: number;
  /**
   * El instante más reciente que la base SABE que ya pasó y que no está en el
   * futuro: el mayor de los sellos que escribe la app con la hora del PC
   * (altas, sesiones, sellos de comprobación, recaps, copias de partidas,
   * buzón) que no pasa de "ahora". Es el techo de los relojes importados (ver
   * legacyClocks.ts).
   *
   * Revisión, hallazgo 1: antes era el mayor sello sin más. Si la 1.x se usó
   * algún día con la hora del PC adelantada (BIOS sin pila, la hora cambiada
   * para un juego), ese sello futuro se convertía en el techo, lo importado
   * llevaba relojes futuros y, como el reloj del dispositivo arranca por
   * encima del mayor reloj guardado (`maxStoredClock`), TODO lo que se
   * escribiera después en la 2.0 saldría con relojes futuros: el hub lo
   * rechazaría, o ganaría a ediciones reales de otros PCs. Los sellos futuros
   * se cuentan (`futureStamps`) y no entran en el techo; los DATOS se
   * importan tal cual, con su fecha futura: solo se recorta el reloj.
   *
   * Sigue siendo determinista en la práctica: solo depende de "ahora" si algún
   * sello está en el futuro, y aun entonces da lo mismo en cualquier PC que
   * importe antes de esa fecha futura.
   */
  readonly ceilingMs: number;
  /** Sellos de máquina posteriores a "ahora", por `tabla.columna` (solo los que hay). */
  readonly futureStamps: Readonly<Record<string, number>>;
}

/**
 * Revisión, hallazgo 2: `node:sqlite` corta un texto en el primer carácter
 * NUL al leerlo (y `@libsql/client`, el driver de la 1.x, también: lo que el
 * usuario ve hoy en la 1.x ya es el texto cortado). Leído así, el importador
 * escribiría el texto cortado y la conciliación, que compara contra esa misma
 * lectura, lo daría por bueno. Por eso se cuentan en SQL, sobre los bytes
 * (`CAST(... AS BLOB)`), los textos con NUL de cada columna que se lee; si hay
 * alguno, la importación se niega (`readLegacyData`) diciendo cuántos y dónde,
 * sin volcar el contenido.
 */
export type NulTextCounts = Record<string, number>;

function selectAll<C extends string>(
  db: DatabaseSync,
  table: string,
  columns: readonly C[],
  nul: NulTextCounts,
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
  const counts = db
    .prepare(
      `SELECT ${columns
        .map(
          (c, i) =>
            `coalesce(sum(typeof("${c}") = 'text' AND instr(CAST("${c}" AS BLOB), x'00') > 0), 0) AS "n${i}"`,
        )
        .join(', ')} FROM "${table}"`,
    )
    .get() as Record<string, number>;
  columns.forEach((column, i) => {
    const n = Number(counts[`n${i}`]);
    if (n > 0) nul[`${table}.${column}`] = n;
  });
  return statement.all() as Row<C>[];
}

const countOf = (db: DatabaseSync, sql: string): number =>
  Number((db.prepare(sql).get() as { n: number | null } | undefined)?.n ?? 0);

/** Sellos que pone la app con la hora del PC (nunca fechas tecleadas): tabla, columna, filtro. */
const MACHINE_STAMPS: readonly (readonly [string, string, string?])[] = [
  ['games', 'addedAt'],
  ['games', 'promotedAt'],
  ['games', 'planPinnedAt'],
  ['games', 'curiositiesGeneratedAt'],
  ['games', 'steamAppIdCheckedAt'],
  ['games', 'achievementsSyncedAt'],
  ['games', 'achievementsUnlocksSyncedAt'],
  ['games', 'raCheckedAt'],
  ['games', 'ratingsCheckedAt'],
  ['games', 'steamSpyCheckedAt'],
  ['sessions', 'startedAt', '"isManual" = 0'],
  ['sessions', 'endedAt', '"isManual" = 0'],
  ['sessions', 'lastHeartbeatAt'],
  ['generated_memories', 'createdAt'],
  ['radar_games', 'discoveredAt'],
  ['radar_games', 'dismissedAt'],
  ['save_backups', 'createdAt'],
  ['plan_mailbox', 'createdAt'],
  ['plan_mailbox', 'processedAt'],
];

export interface ReadLegacyOptions {
  /** "Ahora" en ms: los sellos posteriores no cuentan para el techo (hallazgo 1). */
  readonly now: number;
}

/**
 * Lee la base 1.x entera. No escribe nada.
 *
 * Todas las lecturas van en UNA transacción de lectura (revisión, sospecha
 * "foto coherente"): si otro proceso escribiera en el origen a mitad de la
 * lectura (una base en WAL abierta por otro), cada SELECT suelta podría ver
 * un estado distinto y el plan saldría de una mezcla (una sesión sin su
 * playthrough, un recuento que no casa). Si quien llama ya tiene la conexión
 * en una transacción, se lee dentro de la suya.
 */
export function readLegacyData(db: DatabaseSync, options: ReadLegacyOptions): LegacyData {
  if (db.isTransaction) return readAll(db, options);
  db.exec('BEGIN');
  try {
    return readAll(db, options);
  } finally {
    // Solo se ha leído: deshacer y confirmar dan lo mismo, y ROLLBACK no
    // necesita escribir nada en un origen abierto en solo lectura.
    if (db.isTransaction) db.exec('ROLLBACK');
  }
}

function readAll(db: DatabaseSync, options: ReadLegacyOptions): LegacyData {
  const nul: NulTextCounts = {};
  const games = selectAll(db, 'games', GAME_COLUMNS, nul);
  const iterations = selectAll(db, 'iterations', ITERATION_COLUMNS, nul);
  const sessions = selectAll(db, 'sessions', SESSION_COLUMNS, nul);
  const stateEvents = selectAll(db, 'state_events', STATE_EVENT_COLUMNS, nul);
  const spendEvents = selectAll(db, 'spend_events', SPEND_COLUMNS, nul);
  const emulators = selectAll(db, 'emulators', EMULATOR_COLUMNS, nul);
  const achievements = selectAll(db, 'achievements', ACHIEVEMENT_COLUMNS, nul);
  const unlocks = selectAll(db, 'achievement_unlocks', UNLOCK_COLUMNS, nul);
  const curiosities = selectAll(db, 'curiosities', CURIOSITY_COLUMNS, nul);
  const memories = selectAll(db, 'generated_memories', MEMORY_COLUMNS, nul);
  const radarGames = selectAll(db, 'radar_games', RADAR_COLUMNS, nul);
  const nulTotal = Object.values(nul).reduce((sum, n) => sum + n, 0);
  if (nulTotal > 0) {
    const where = Object.entries(nul)
      .map(([column, n]) => `${column}: ${n}`)
      .join('; ');
    throw new LegacyNulTextError(
      `La base 1.x tiene ${nulTotal} texto(s) con el carácter NUL (U+0000), que SQLite no devuelve ` +
        `entero al leer (${where}). La 1.x ya los muestra cortados; edítalos en la 1.x (o quita el ` +
        'carácter) antes de importar. No se importa nada.',
      nul,
    );
  }

  const saveBackupCount = countOf(db, 'SELECT count(*) AS n FROM save_backups');
  const saveBackupGameIds = (
    db.prepare('SELECT DISTINCT "gameId" AS id FROM save_backups ORDER BY 1').all() as {
      id: number;
    }[]
  ).map((r) => Number(r.id));
  const mailboxCount = countOf(db, 'SELECT count(*) AS n FROM plan_mailbox');
  const pendingMailbox = countOf(
    db,
    'SELECT count(*) AS n FROM plan_mailbox WHERE "processedAt" IS NULL',
  );

  // El techo: el mayor sello de máquina que no pasa de "ahora" (hallazgo 1).
  let ceilingMs = 0;
  const futureStamps: Record<string, number> = {};
  for (const [table, column, filter] of MACHINE_STAMPS) {
    const row = db
      .prepare(
        `SELECT max(CASE WHEN "${column}" <= ? THEN "${column}" END) AS m, ` +
          `coalesce(sum("${column}" > ?), 0) AS f FROM "${table}"${filter ? ` WHERE ${filter}` : ''}`,
      )
      .get(options.now, options.now) as { m: number | null; f: number };
    if (row.m !== null) ceilingMs = Math.max(ceilingMs, Number(row.m));
    if (Number(row.f) > 0) futureStamps[`${table}.${column}`] = Number(row.f);
  }

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
    saveBackupGameIds,
    pendingMailbox,
    mailboxCount,
    // Una base vacía no tiene sellos: cualquier valor positivo sirve (no hay
    // filas a las que dar reloj salvo la del dispositivo `legacy`).
    ceilingMs: Math.max(ceilingMs, 1),
    futureStamps,
  };
}

/** El origen tiene textos con NUL (hallazgo 2): no se importa nada. */
export class LegacyNulTextError extends ImportBlockedError {
  /** Por `tabla.columna`, cuántos textos con NUL. Nunca el contenido. */
  readonly counts: Readonly<NulTextCounts>;

  constructor(message: string, counts: NulTextCounts) {
    super(message);
    this.name = 'LegacyNulTextError';
    this.counts = counts;
  }
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

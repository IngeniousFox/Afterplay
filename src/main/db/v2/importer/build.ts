import type { SQLInputValue } from 'node:sqlite';
import { isAddedAtArtifact } from '../../../../shared/playthroughState';
import { LEGACY_DEVICE_SHORT_ID, type Clock } from '../../../../shared/sync/clock';
import {
  clocksForNewRow,
  compactClocks,
  serializeSyncFields,
  syncUpdatedOf,
} from '../../../../shared/sync/fieldClocks';
import {
  achievementCatalogId,
  achievementUnlockId,
  externalCheckId,
  gameIdForIgdb,
  generatedMemoryId,
  radarGameId,
} from '../../../../shared/sync/ids';
import { registry, type SyncedTableName } from '../registry';
import type { AchievementCatalogItem, AchievementSource, ExternalCheckSource } from '../schema';
import { tableInfo } from '../store/columns';
import { classifyAchievements, type ClassifiedAchievement } from './achievements';
import {
  attributeAchievementStamps,
  catalogAnswerAt,
  type StampAttribution,
} from './achievementStamps';
import {
  assignLegacyClocks,
  legacyClockAt,
  nextLegacyClock,
  type ClockInput,
} from './legacyClocks';
import { legacyUuid } from './legacyIds';
import type {
  LegacyData,
  LegacyGame,
  LegacyIteration,
  LegacySession,
  LegacyStateEvent,
  SqlValue,
} from './source';

// El PLAN de la importación: todas las filas 2.0 que salen de una base 1.x,
// ya con sus ids, sus valores y sus relojes, antes de escribir nada. Es una
// función pura del origen (y de las opciones): dos PCs con la misma base
// obtienen el mismo plan, byte a byte. Escribirlo es `write.ts`; comprobarlo,
// `validate.ts` y `columnMap.ts`.

/** Id literal del dispositivo dueño de lo importado (§7.4, §19.5). */
export const LEGACY_DEVICE_ID = 'legacy';
/** Origen de los desbloqueos de emulador de la 1.x (`emu@<deviceId>`). */
export const LEGACY_EMU_ORIGIN = `emu@${LEGACY_DEVICE_ID}`;

export interface PlannedRow {
  readonly id: string;
  /** Todas las columnas de la fila, las de §7.3 incluidas. */
  readonly values: Readonly<Record<string, SQLInputValue>>;
}

export interface LegacyIdEntry {
  readonly legacyTable: string;
  readonly legacyId: number;
  readonly newId: string;
}

export interface BuildOptions {
  /** Moneda de los gastos (D-23). La 1.x solo conoce el euro (`formatMoney`). */
  readonly currency: string;
  /** Desarrollo: importar cerradas en su último latido las sesiones abiertas. */
  readonly devCloseOpenSessions: boolean;
}

/** Recuento por tabla 1.x: leídas, importadas y descartadas con su motivo. */
export interface SourceTableCount {
  read: number;
  imported: number;
  discarded: Record<string, number>;
}

export interface ImportPlan {
  readonly rows: ReadonlyMap<SyncedTableName, readonly PlannedRow[]>;
  readonly legacyIds: readonly LegacyIdEntry[];
  readonly source: Record<string, SourceTableCount>;
  /** Hechos sueltos para el informe (clasificación, recortes, pendientes…). */
  readonly facts: Record<string, number>;
  readonly context: ImportContext;
}

/** Lo que la validación necesita saber de cómo se construyó el plan. */
export interface ImportContext {
  readonly data: LegacyData;
  /** Sesiones tal como se importan (con las abiertas cerradas, si se pidió). */
  readonly sessions: readonly LegacySession[];
  readonly gameIds: ReadonlyMap<number, string>;
  readonly iterationIds: ReadonlyMap<number, string>;
  readonly sessionIds: ReadonlyMap<number, string>;
  readonly eventIds: ReadonlyMap<number, string>;
  readonly spendIds: ReadonlyMap<number, string>;
  readonly emulatorIds: ReadonlyMap<number, string>;
  readonly unlockIds: ReadonlyMap<number, string>;
  /** Iteraciones vacías de juegos planeados que no se importan (F-12). */
  readonly droppedIterations: ReadonlySet<number>;
  /** Juego 1.x → su entrada del plan (viva o con lápida). */
  readonly planEntries: ReadonlyMap<number, PlanEntryInfo>;
  /** Logro 1.x → catálogos en los que entra. */
  readonly achievementSources: ReadonlyMap<number, readonly AchievementSource[]>;
  readonly classified: readonly ClassifiedAchievement[];
  /**
   * Juego 1.x (con algún sello de logros) → el reparto de
   * `achievementsSyncedAt`/`achievementsUnlocksSyncedAt` entre las
   * comprobaciones de `external_checks` (achievementStamps.ts).
   */
  readonly achievementStamps: ReadonlyMap<number, StampAttribution>;
  readonly gamesById: ReadonlyMap<number, LegacyGame>;
  readonly iterationsById: ReadonlyMap<number, LegacyIteration>;
  readonly currency: string;
}

export interface PlanEntryInfo {
  readonly id: string;
  readonly live: boolean;
  /** Evento que da `plannedAt` (null = se usó `addedAt`). */
  readonly dateEventId: number | null;
  /** Evento cuya nota se conserva (null = sin eventos). */
  readonly noteEventId: number | null;
}

/** El importador no puede seguir sin que alguien actúe antes (§19.7). */
export class ImportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportBlockedError';
  }
}

const num = (value: SqlValue): number | null => (value === null ? null : Number(value));
const req = (value: SqlValue): number => {
  if (value === null) throw new Error('valor obligatorio nulo en la base 1.x');
  return Number(value);
};
const padKey = (id: number): string => String(id).padStart(12, '0');

/** Columnas de JSON de la 1.x: se copian con su texto, pero tienen que ser JSON válido. */
function assertJson(value: SqlValue, where: string): void {
  if (value === null) return;
  try {
    JSON.parse(String(value));
  } catch {
    throw new Error(`JSON inválido en la base 1.x: ${where}`);
  }
}

/**
 * Una fila 2.0 con sus relojes. Las columnas de `data` llevan el reloj de la
 * fila; las de `unsourced` (sin origen en la 1.x) se escriben a null con reloj
 * `BOTTOM`: nadie las ha escrito todavía (§8.3), y cualquier escritura real
 * les gana. Comprueba que no falte ni sobre ninguna columna del esquema y que
 * las enumeraciones y los NOT NULL se cumplen, para fallar aquí con contexto y
 * no en SQLite.
 */
export function makeRow(
  table: SyncedTableName,
  id: string,
  data: Readonly<Record<string, SqlValue>>,
  unsourced: readonly string[],
  clock: Clock,
  deletedClock: Clock | null = null,
): PlannedRow {
  const info = tableInfo(registry[table].table);
  for (const column of Object.keys(data)) {
    if (!info.columns.has(column)) throw new Error(`${table}.${column}: no es columna del 2.0`);
  }
  for (const column of info.dataColumns) {
    const inData = column in data;
    const inUnsourced = unsourced.includes(column);
    if (inData === inUnsourced) {
      throw new Error(
        `${table}.${column}: hay que darla o declararla sin origen (y solo una cosa)`,
      );
    }
    const meta = info.columns.get(column);
    const value = inData ? data[column] : null;
    if (meta?.notNull && value === null) throw new Error(`${table}.${column}: null en NOT NULL`);
    if (meta?.enumValues && value !== null && !meta.enumValues.includes(String(value))) {
      throw new Error(`${table}.${column}: valor fuera de la enumeración 2.0 (${String(value)})`);
    }
  }
  const provided = info.dataColumns.filter((column) => column in data);
  const { clocks } = clocksForNewRow(clock, info.dataColumns, provided);
  if (deletedClock !== null) clocks.syncDeleted = deletedClock;
  const values: Record<string, SQLInputValue> = { id };
  for (const column of info.dataColumns) values[column] = column in data ? data[column] : null;
  values.syncCreated = clock;
  values.syncUpdated = syncUpdatedOf(clock, clocks);
  values.syncFields = serializeSyncFields(compactClocks(clock, clocks, info.dataColumns));
  values.syncDeleted = deletedClock;
  values.syncDirty = 1;
  return { id, values };
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** La duración que da la 1.x al cerrar una sesión (sessionDuration.ts). */
const durationBetween = (startedAt: number, endedAt: number): number =>
  Math.max(0, Math.round((endedAt - startedAt) / 1000));

export function buildImportPlan(data: LegacyData, options: BuildOptions): ImportPlan {
  const ceiling = data.ceilingMs;
  const facts: Record<string, number> = {};
  const fact = (name: string, by = 1): void => {
    facts[name] = (facts[name] ?? 0) + by;
  };
  const source: Record<string, SourceTableCount> = {};
  const count = (table: string): SourceTableCount => {
    source[table] ??= { read: 0, imported: 0, discarded: {} };
    return source[table];
  };
  const discard = (table: string, reason: string, by = 1): void => {
    const entry = count(table);
    entry.discarded[reason] = (entry.discarded[reason] ?? 0) + by;
  };
  const rows = new Map<SyncedTableName, PlannedRow[]>();
  const push = (table: SyncedTableName, row: PlannedRow): void => {
    const list = rows.get(table) ?? [];
    list.push(row);
    rows.set(table, list);
  };
  const legacyIds: LegacyIdEntry[] = [];
  const mapId = (legacyTable: string, legacyId: number, newId: string): void => {
    legacyIds.push({ legacyTable, legacyId, newId });
  };
  const clockOf = <K extends number | string>(
    inputs: ClockInput<K>[],
    name: string,
  ): Map<K, Clock> => {
    const { clocks, clamped } = assignLegacyClocks(inputs, ceiling);
    if (clamped > 0) fact(`relojes recortados al techo del origen (${name})`, clamped);
    return clocks;
  };

  // ── Integridad del origen ────────────────────────────────────────────────
  // Una referencia rota no se puede importar (la 2.0 declara claves foráneas)
  // y adivinar a qué apuntaba sería inventar datos: se aborta con recuentos.
  const gamesById = new Map(data.games.map((g) => [g.id as number, g]));
  const iterationsById = new Map(data.iterations.map((i) => [i.id as number, i]));
  const sessionsById = new Map(data.sessions.map((s) => [s.id as number, s]));
  const emulatorsById = new Map(data.emulators.map((e) => [e.id as number, e]));
  const achievementsById = new Map(data.achievements.map((a) => [a.id as number, a]));
  const broken: Record<string, number> = {};
  const brokenIf = (condition: boolean, what: string): void => {
    if (condition) broken[what] = (broken[what] ?? 0) + 1;
  };
  for (const i of data.iterations)
    brokenIf(!gamesById.has(i.gameId as number), 'iterations.gameId');
  for (const s of data.sessions) {
    brokenIf(
      s.iterationId !== null && !iterationsById.has(s.iterationId as number),
      'sessions.iterationId',
    );
    brokenIf(
      s.emulatorId !== null && !emulatorsById.has(s.emulatorId as number),
      'sessions.emulatorId',
    );
    brokenIf(
      s.iterationId === null && s.emulatorId === null,
      'sessions sin playthrough ni emulador',
    );
  }
  for (const e of data.stateEvents)
    brokenIf(!iterationsById.has(e.iterationId as number), 'state_events.iterationId');
  for (const s of data.spendEvents)
    brokenIf(!gamesById.has(s.gameId as number), 'spend_events.gameId');
  for (const a of data.achievements)
    brokenIf(!gamesById.has(a.gameId as number), 'achievements.gameId');
  for (const u of data.unlocks) {
    brokenIf(!achievementsById.has(u.achievementId as number), 'achievement_unlocks.achievementId');
    brokenIf(
      u.iterationId !== null && !iterationsById.has(u.iterationId as number),
      'achievement_unlocks.iterationId',
    );
    brokenIf(
      u.sessionId !== null && !sessionsById.has(u.sessionId as number),
      'achievement_unlocks.sessionId',
    );
  }
  for (const c of data.curiosities)
    brokenIf(!gamesById.has(c.gameId as number), 'curiosities.gameId');
  if (Object.keys(broken).length > 0) {
    const list = Object.entries(broken).map(([k, v]) => `${k}: ${v}`);
    throw new Error(`La base 1.x tiene referencias rotas; no se importa nada. ${list.join('; ')}`);
  }

  for (const g of data.games) {
    for (const column of [
      'officialPlatforms',
      'genres',
      'saveCustomPaths',
      'igdbCollections',
      'steamTags',
    ] as const) {
      assertJson(g[column], `games.${column} (id ${String(g.id)})`);
    }
  }
  for (const m of data.memories)
    assertJson(m.payload, `generated_memories.payload (id ${String(m.id)})`);

  // ── Sesiones abiertas (§19.7) ────────────────────────────────────────────
  const open = data.sessions.filter((s) => s.endedAt === null);
  if (open.length > 0 && !options.devCloseOpenSessions) {
    throw new ImportBlockedError(
      `La base 1.x tiene ${open.length} sesión(es) abierta(s). Ciérralas en la 1.x antes de importar (§19.7): ` +
        'el importador no se inventa cuándo terminaron.',
    );
  }
  const sessions: LegacySession[] = data.sessions.map((s) => {
    if (s.endedAt !== null) return s;
    // Solo en desarrollo: cerrarla en su último latido, como haría la
    // recuperación de la 1.x tras un corte.
    const endedAt = num(s.lastHeartbeatAt) ?? req(s.startedAt);
    fact('sesiones abiertas importadas cerradas en su último latido (opción de desarrollo)');
    return { ...s, endedAt, durationSec: durationBetween(req(s.startedAt), endedAt) };
  });

  // ── Dispositivo `legacy` ─────────────────────────────────────────────────
  const firstSeen = Math.min(
    ...data.games.map((g) => req(g.addedAt)),
    ...sessions.map((s) => req(s.startedAt)),
    ceiling,
  );
  push(
    'devices',
    makeRow(
      'devices',
      LEGACY_DEVICE_ID,
      { name: 'Afterplay 1.x', kind: 'legacy', os: 'windows', firstSeenAt: firstSeen },
      ['home', 'appVersion', 'schemaVersion', 'lastSeenAt', 'revokedAt', 'installNonce'],
      legacyClockAt(firstSeen, ceiling),
    ),
  );

  // ── Juegos ───────────────────────────────────────────────────────────────
  const gameIds = new Map<number, string>();
  const seenGameIds = new Set<string>();
  for (const g of data.games) {
    const igdbId = num(g.igdbId);
    const id = igdbId !== null ? gameIdForIgdb(igdbId) : legacyUuid('games', g.id as number);
    if (seenGameIds.has(id))
      throw new Error(`dos juegos 1.x dan el mismo id 2.0 (id 1.x ${String(g.id)})`);
    seenGameIds.add(id);
    gameIds.set(g.id as number, id);
  }
  const gameClocks = clockOf(
    data.games.map((g) => ({ domainMs: num(g.addedAt), key: g.id as number })),
    'games',
  );
  count('games').read = data.games.length;
  for (const g of data.games) {
    const legacyId = g.id as number;
    const id = gameIds.get(legacyId) as string;
    const clock = gameClocks.get(legacyId) as Clock;
    const igdbId = num(g.igdbId);
    const steamAppId = num(g.steamAppId);
    const sgdbId = num(g.sgdbId);
    push(
      'games',
      makeRow(
        'games',
        id,
        {
          title: g.title,
          igdbId,
          steamAppId,
          raGameId: g.raGameId,
          sgdbId,
          steamAppIdSource:
            steamAppId === null ? null : num(g.steamAppIdManual) ? 'manual' : 'auto',
          // §19.5: un sgdbId de la 1.x es siempre una elección (manual o del alta).
          sgdbIdSource: sgdbId === null ? null : 'manual',
          // §19.5 "Elecciones manuales" (D-22): todos a override.
          coverOverride: g.coverUrl,
          heroOverride: g.heroUrl,
          developerOverride: g.developer,
          publisherOverride: g.publisher,
          genresOverride: g.genres,
          notes: g.notes,
          endless: g.endless,
          isEmulated: g.isEmulated,
          addedAt: g.addedAt,
          promotedAt: g.promotedAt,
          saveBackupEnabled: g.saveBackupEnabled,
          saveDetectionSource: g.saveDetectionSource,
          saveLudusaviName: g.saveLudusaviName,
          saveCustomPaths: g.saveCustomPaths,
          // La 1.x solo sube partidas de juegos con igdbId (`requireIgdbId`),
          // bajo el prefijo `saves/<igdbId>/…`: esa es su clave.
          saveKey: igdbId !== null ? String(igdbId) : id,
        },
        [],
        clock,
      ),
    );
    // §19.5 y D-22: la caché también recibe los valores, para que "volver al
    // automático" (override a null) enseñe lo que había.
    push(
      'game_metadata',
      makeRow(
        'game_metadata',
        id,
        {
          gameId: id,
          coverUrl: g.coverUrl,
          heroUrl: g.heroUrl,
          officialPlatforms: g.officialPlatforms,
          genres: g.genres,
          developer: g.developer,
          publisher: g.publisher,
          releaseYear: g.releaseYear,
          releaseDate: g.releaseDate,
          releaseDatePrecision: g.releaseDatePrecision,
          summary: g.summary,
          igdbCollections: g.igdbCollections,
          hltbMain: g.hltbMain,
          hltbMainExtras: g.hltbMainExtras,
          hltbCompletionist: g.hltbCompletionist,
          ratingCritics: g.ratingCritics,
          ratingCriticsCount: g.ratingCriticsCount,
          ratingUsers: g.ratingUsers,
          ratingUsersCount: g.ratingUsersCount,
          steamTags: g.steamTags,
          steamPositive: g.steamPositive,
          steamNegative: g.steamNegative,
        },
        [],
        clock,
      ),
    );
    mapId('games', legacyId, id);
    count('games').imported += 1;
  }

  // ── Logros: clasificación (antes de external_checks, que la necesita) ────
  const classified = classifyAchievements(data.achievements, data.unlocks, gamesById);
  const achievementSources = new Map<number, readonly AchievementSource[]>();
  const catalogGroups = new Map<
    string,
    { gameId: number; source: AchievementSource; items: ClassifiedAchievement[] }
  >();
  for (const entry of classified) {
    achievementSources.set(entry.achievement.id as number, entry.sources);
    fact(`logros clasificados: ${entry.basis}`);
    for (const src of entry.sources) {
      const gameId = entry.achievement.gameId as number;
      const key = `${padKey(gameId)}:${src}`;
      const group = catalogGroups.get(key) ?? { gameId, source: src, items: [] };
      group.items.push(entry);
      catalogGroups.set(key, group);
    }
  }
  const catalogSourcesByGame = new Map<number, Set<AchievementSource>>();
  for (const group of catalogGroups.values()) {
    const set = catalogSourcesByGame.get(group.gameId) ?? new Set();
    set.add(group.source);
    catalogSourcesByGame.set(group.gameId, set);
  }

  // ── external_checks (§19.5: una fila por cada …CheckedAt/…SyncedAt) ──────
  const curiositiesByGame = groupBy(data.curiosities, (c) => c.gameId as number);
  type Check = {
    gameId: number;
    source: ExternalCheckSource;
    status: 'ok' | 'empty';
    checkedAt: number;
  };
  const checks: Check[] = [];
  const achievementStamps = new Map<number, StampAttribution>();
  for (const g of data.games) {
    const gameId = g.id as number;
    const add = (src: ExternalCheckSource, at: SqlValue, ok: boolean): void => {
      if (at === null) return;
      checks.push({ gameId, source: src, status: ok ? 'ok' : 'empty', checkedAt: Number(at) });
    };
    add('steam_appid', g.steamAppIdCheckedAt, g.steamAppId !== null);
    add(
      'steam_store',
      g.steamSpyCheckedAt,
      g.steamTags !== null || g.steamPositive !== null || g.steamNegative !== null,
    );
    add('ra_match', g.raCheckedAt, g.raGameId !== null);
    add(
      'igdb_ratings',
      g.ratingsCheckedAt,
      g.ratingCritics !== null ||
        g.ratingUsers !== null ||
        g.ratingCriticsCount !== null ||
        g.ratingUsersCount !== null,
    );
    add('curiosities', g.curiositiesGeneratedAt, (curiositiesByGame.get(gameId)?.length ?? 0) > 0);

    // Los dos sellos de logros: quién los escribió, con la regla de
    // achievementStamps.ts (sin inventar horas; lo ambiguo y lo anómalo se
    // cuentan).
    const attribution = attributeAchievementStamps({
      syncedAt: num(g.achievementsSyncedAt),
      unlocksSyncedAt: num(g.achievementsUnlocksSyncedAt),
      hasSteamKey: g.steamAppId !== null,
      hasRaKey: g.raGameId !== null,
      catalogs: catalogSourcesByGame.get(gameId) ?? new Set<AchievementSource>(),
    });
    if (attribution.basis !== 'sin sellos') {
      achievementStamps.set(gameId, attribution);
      fact(`sellos de logros: ${attribution.basis}`);
      for (const c of attribution.checks)
        checks.push({ gameId, source: c.source, status: c.status, checkedAt: c.checkedAt });
      for (const reason of attribution.discarded) discard('games', reason);
    }
  }
  const checkClocks = clockOf(
    checks.map((c) => ({ domainMs: c.checkedAt, key: `${padKey(c.gameId)}:${c.source}` })),
    'external_checks',
  );
  for (const c of checks) {
    const gameId = gameIds.get(c.gameId) as string;
    push(
      'external_checks',
      makeRow(
        'external_checks',
        externalCheckId(gameId, c.source),
        { gameId, source: c.source, status: c.status, checkedAt: c.checkedAt },
        // La política de cada fuente decidirá cuándo volver a preguntar.
        ['nextCheckAt', 'error'],
        checkClocks.get(`${padKey(c.gameId)}:${c.source}`) as Clock,
      ),
    );
  }

  // ── Plan (F-12) ──────────────────────────────────────────────────────────
  const eventsByIteration = groupBy(data.stateEvents, (e) => e.iterationId as number);
  const sessionsByIteration = groupBy(sessions, (s) => s.iterationId);
  const unlocksByIteration = groupBy(data.unlocks, (u) => u.iterationId);
  const iterationsByGame = groupBy(data.iterations, (i) => i.gameId as number);
  const planEventsByGame = new Map<number, LegacyStateEvent[]>();
  for (const e of data.stateEvents) {
    if (e.type !== 'plan_to_play') continue;
    const gameId = iterationsById.get(e.iterationId as number)?.gameId as number;
    const list = planEventsByGame.get(gameId) ?? [];
    list.push(e);
    planEventsByGame.set(gameId, list);
  }

  // La iteración vacía de un planeado: la que crea createPlannedGame (y la
  // única que deja moveToPlan, con su mismo criterio de "sin registros").
  const isEmptyIteration = (i: LegacyIteration): boolean => {
    const id = i.id as number;
    const manual = num(i.manualTotalPlayed);
    return (
      (manual === null || manual === 0) &&
      i.rating === null &&
      !num(i.extraContent) &&
      !(sessionsByIteration.get(id)?.length ?? 0) &&
      !(unlocksByIteration.get(id)?.length ?? 0) &&
      (eventsByIteration.get(id) ?? []).every((e) => e.type === 'plan_to_play')
    );
  };
  const droppedIterations = new Set<number>();
  for (const g of data.games) {
    if (!num(g.planned)) continue;
    for (const i of iterationsByGame.get(g.id as number) ?? []) {
      if (isEmptyIteration(i)) droppedIterations.add(i.id as number);
      else fact('juegos planeados con un playthrough no vacío (se importa)');
    }
  }

  const planEntries = new Map<number, PlanEntryInfo>();
  type Plan = {
    gameId: number;
    live: boolean;
    plannedAt: number;
    note: SqlValue;
    pinnedAt: SqlValue;
    deleteAt: number;
  };
  const plans: Plan[] = [];
  for (const g of data.games) {
    const gameId = g.id as number;
    const events = [...(planEventsByGame.get(gameId) ?? [])].sort((a, b) => req(a.id) - req(b.id));
    const live = !!num(g.planned);
    if (!live && events.length === 0) continue;
    // plannedAt: el PRIMER plan_to_play por id (planWaitingSince); la nota: la
    // que enseña el Plan, el más reciente por fecha y luego por id
    // (getPlannedGameExtras). Con uno solo, que es lo normal, coinciden.
    const dateEvent = events[0] ?? null;
    const noteEvent =
      [...events].sort(
        (a, b) => req(b.occurredAt) - req(a.occurredAt) || req(b.id) - req(a.id),
      )[0] ?? null;
    if (events.length > 1) fact('juegos con más de un plan_to_play');
    const plannedAt = dateEvent ? req(dateEvent.occurredAt) : req(g.addedAt);
    planEntries.set(gameId, {
      id: gameIds.get(gameId) as string,
      live,
      dateEventId: dateEvent ? req(dateEvent.id) : null,
      noteEventId: noteEvent ? req(noteEvent.id) : null,
    });
    plans.push({
      gameId,
      live,
      plannedAt,
      note: noteEvent?.note ?? null,
      pinnedAt: g.planPinnedAt,
      deleteAt: num(g.promotedAt) ?? plannedAt,
    });
    if (!live) fact('plan_entries con lápida (juego ya promocionado que conserva su plan_to_play)');
  }
  const planClocks = clockOf(
    plans.map((p) => ({ domainMs: p.plannedAt, key: p.gameId })),
    'plan_entries',
  );
  for (const p of plans) {
    const id = gameIds.get(p.gameId) as string;
    const created = planClocks.get(p.gameId) as Clock;
    let deleted: Clock | null = null;
    if (!p.live) {
      // La lápida, también determinista y antigua: la promoción (o el propio
      // plan, si la 1.x no la sellaba), siempre por encima de la creación.
      const own = legacyClockAt(p.deleteAt, ceiling);
      deleted = own > created ? own : nextLegacyClock(created);
    }
    push(
      'plan_entries',
      makeRow(
        'plan_entries',
        id,
        { gameId: id, plannedAt: p.plannedAt, pinnedAt: p.pinnedAt, note: p.note },
        // Sin orden manual en la 1.x más allá de pinnedAt (ver el informe).
        ['sortKey'],
        created,
        deleted,
      ),
    );
  }

  // ── Playthroughs ─────────────────────────────────────────────────────────
  count('iterations').read = data.iterations.length;
  const iterationIds = new Map<number, string>();
  const kept = data.iterations.filter((i) => !droppedIterations.has(i.id as number));
  discard(
    'iterations',
    'iteración vacía de un juego planeado (la sustituye plan_entries, F-12)',
    droppedIterations.size,
  );
  const iterationClocks = clockOf(
    kept.map((i) => ({
      domainMs: num(gamesById.get(i.gameId as number)?.addedAt ?? null),
      key: i.id as number,
    })),
    'playthroughs',
  );
  const positions = new Map<number, number>();
  for (const [, list] of groupBy(kept, (i) => i.gameId as number)) {
    [...list]
      .sort((a, b) => req(a.id) - req(b.id))
      .forEach((i, index) => positions.set(i.id as number, index + 1));
  }
  for (const i of kept) {
    const legacyId = i.id as number;
    const id = legacyUuid('iterations', legacyId);
    iterationIds.set(legacyId, id);
    const position = positions.get(legacyId) as number;
    // La etiqueta solo se guarda si NO es la automática de su posición: así la
    // 2.0 (que la calcula por syncCreated, §7.4) enseña exactamente la misma.
    const customLabel = i.label === `Playthrough ${position}` ? null : i.label;
    if (customLabel !== null)
      fact('playthroughs con etiqueta propia (o numeración que no es su posición)');
    push(
      'playthroughs',
      makeRow(
        'playthroughs',
        id,
        {
          gameId: gameIds.get(i.gameId as number) as string,
          customLabel,
          playedPlatform: i.playedPlatform,
          origin: i.origin,
          format: i.format,
          // §19.5 "Horas manuales": la 1.x ya SUMA manualTotalPlayed a las
          // sesiones (resolveIterationHours), que es el significado único de
          // manualHours en la 2.0 (§7.5). Copiarlo conserva el total; la
          // validación lo comprueba playthrough a playthrough.
          manualHours: i.manualTotalPlayed,
          rating: i.rating,
          extraContent: i.extraContent,
        },
        [],
        iterationClocks.get(legacyId) as Clock,
      ),
    );
    mapId('iterations', legacyId, id);
    count('iterations').imported += 1;
  }

  // ── Eventos de estado ────────────────────────────────────────────────────
  count('state_events').read = data.stateEvents.length;
  const eventIds = new Map<number, string>();
  const realEvents = data.stateEvents.filter((e) => e.type !== 'plan_to_play');
  const eventClocks = clockOf(
    realEvents.map((e) => ({ domainMs: num(e.occurredAt), key: e.id as number })),
    'state_events',
  );
  for (const e of data.stateEvents) {
    if (e.type !== 'plan_to_play') continue;
    const gameId = iterationsById.get(e.iterationId as number)?.gameId as number;
    const plan = planEntries.get(gameId) as PlanEntryInfo;
    const absorbed = plan.dateEventId === e.id || plan.noteEventId === e.id;
    discard(
      'state_events',
      absorbed
        ? plan.live
          ? 'plan_to_play de un juego planeado: su fecha y su nota pasan a plan_entries'
          : 'plan_to_play de un juego promocionado: su fecha y su nota pasan a plan_entries con lápida'
        : 'plan_to_play adicional: su fecha y su nota no tienen destino',
    );
    if (!absorbed && e.note !== null) fact('notas de plan_to_play adicionales que se pierden');
    mapId('state_events', e.id as number, plan.id);
  }
  for (const e of realEvents) {
    const legacyId = e.id as number;
    const iteration = iterationsById.get(e.iterationId as number) as LegacyIteration;
    const game = gamesById.get(iteration.gameId as number) as LegacyGame;
    const id = legacyUuid('state_events', legacyId);
    eventIds.set(legacyId, id);
    // §7.5: la heurística del alta se aplica UNA vez, aquí.
    const artifact = isAddedAtArtifact(
      new Date(req(e.occurredAt)),
      new Date(req(game.addedAt)),
      game.promotedAt === null ? null : new Date(req(game.promotedAt)),
    );
    if (artifact) fact('eventos de estado con fecha desconocida (artefacto del alta)');
    push(
      'state_events',
      makeRow(
        'state_events',
        id,
        {
          playthroughId: iterationIds.get(e.iterationId as number) as string,
          type: e.type,
          occurredAt: e.occurredAt,
          datePrecision: artifact ? 'unknown' : e.datePrecision,
          note: e.note,
        },
        ['deviceId'],
        eventClocks.get(legacyId) as Clock,
      ),
    );
    mapId('state_events', legacyId, id);
    count('state_events').imported += 1;
  }

  // ── Emuladores ───────────────────────────────────────────────────────────
  count('emulators').read = data.emulators.length;
  const emulatorIds = new Map<number, string>();
  const emulatorClocks = clockOf(
    data.emulators.map((e) => ({ domainMs: null, key: e.id as number })),
    'emulators',
  );
  for (const e of data.emulators) {
    const legacyId = e.id as number;
    const id = legacyUuid('emulators', legacyId);
    emulatorIds.set(legacyId, id);
    push(
      'emulators',
      makeRow('emulators', id, { name: e.name }, [], emulatorClocks.get(legacyId) as Clock),
    );
    mapId('emulators', legacyId, id);
    count('emulators').imported += 1;
  }

  // ── Sesiones ─────────────────────────────────────────────────────────────
  count('sessions').read = sessions.length;
  const sessionIds = new Map<number, string>();
  const sessionClocks = clockOf(
    sessions.map((s) => ({ domainMs: num(s.startedAt), key: s.id as number })),
    'sessions',
  );
  for (const s of sessions) {
    const legacyId = s.id as number;
    const id = legacyUuid('sessions', legacyId);
    sessionIds.set(legacyId, id);
    if (s.iterationId === null) fact('sesiones de emulador sin asignar');
    push(
      'sessions',
      makeRow(
        'sessions',
        id,
        {
          playthroughId:
            s.iterationId === null ? null : (iterationIds.get(s.iterationId as number) as string),
          emulatorId:
            s.emulatorId === null ? null : (emulatorIds.get(s.emulatorId as number) as string),
          deviceId: LEGACY_DEVICE_ID,
          startedBy: s.startedBy,
          source: num(s.isManual) ? 'legacy_manual' : 'measured',
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationSec: s.durationSec,
          datePrecision: s.datePrecision,
          lastSeenAt: s.lastHeartbeatAt,
          note: s.note,
        },
        // La 1.x no sabe quién cerró una sesión: null no es "abierta".
        ['closedBy'],
        sessionClocks.get(legacyId) as Clock,
      ),
    );
    mapId('sessions', legacyId, id);
    count('sessions').imported += 1;
  }

  // ── Gastos ───────────────────────────────────────────────────────────────
  count('spend_events').read = data.spendEvents.length;
  const spendIds = new Map<number, string>();
  const spendClocks = clockOf(
    data.spendEvents.map((s) => ({ domainMs: num(s.occurredAt), key: s.id as number })),
    'spend_events',
  );
  for (const s of data.spendEvents) {
    const legacyId = s.id as number;
    const id = legacyUuid('spend_events', legacyId);
    spendIds.set(legacyId, id);
    push(
      'spend_events',
      makeRow(
        'spend_events',
        id,
        {
          gameId: gameIds.get(s.gameId as number) as string,
          type: s.type,
          amount: s.amount,
          currency: options.currency,
          occurredAt: s.occurredAt,
          datePrecision: s.datePrecision,
          note: s.note,
        },
        // Sin playthrough: se reparte por fecha, como en la 1.x.
        ['playthroughId'],
        spendClocks.get(legacyId) as Clock,
      ),
    );
    mapId('spend_events', legacyId, id);
    count('spend_events').imported += 1;
  }

  // ── Catálogos de logros ──────────────────────────────────────────────────
  count('achievements').read = data.achievements.length;
  const catalogs = [...catalogGroups.entries()].map(([key, group]) => {
    const game = gamesById.get(group.gameId) as LegacyGame;
    // La hora a la que contestó SU fuente (achievementStamps.ts). Si no se
    // sabe (catálogo sin sello: setSteamAppId borra los sellos y deja el
    // catálogo de RA), la fecha del alta, la más antigua posible, para que el
    // refresco lo trate como viejo.
    const attribution = achievementStamps.get(group.gameId);
    let fetchedAt = attribution ? catalogAnswerAt(attribution, group.source) : null;
    if (fetchedAt === null) {
      fetchedAt = req(game.addedAt);
      fact(
        game.achievementsSyncedAt === null
          ? 'catálogos sin achievementsSyncedAt (fetchedAt = alta del juego; EXPECTED catalogWithoutStamp)'
          : 'catálogos cuya fuente no escribió el sello (fetchedAt = alta del juego)',
      );
    }
    return { key, group, fetchedAt };
  });
  const catalogClocks = clockOf(
    catalogs.map((c) => ({ domainMs: c.fetchedAt, key: c.key })),
    'achievement_catalogs',
  );
  const importedAchievements = new Set<number>();
  for (const c of catalogs) {
    const gameId = gameIds.get(c.group.gameId) as string;
    const items: AchievementCatalogItem[] = [...c.group.items]
      .sort(
        (a, b) =>
          req(a.achievement.sortIndex) - req(b.achievement.sortIndex) ||
          req(a.achievement.id) - req(b.achievement.id),
      )
      .map(({ achievement: a }) => ({
        apiName: String(a.apiName),
        displayName: String(a.displayName),
        description: a.description === null ? null : String(a.description),
        iconUrl: a.iconUrl === null ? null : String(a.iconUrl),
        iconGrayUrl: a.iconGrayUrl === null ? null : String(a.iconGrayUrl),
        hidden: !!num(a.hidden),
        globalPercent: num(a.globalPercent),
        sortIndex: req(a.sortIndex),
      }));
    const id = achievementCatalogId(gameId, c.group.source);
    push(
      'achievement_catalogs',
      makeRow(
        'achievement_catalogs',
        id,
        { gameId, source: c.group.source, items: JSON.stringify(items), fetchedAt: c.fetchedAt },
        [],
        catalogClocks.get(c.key) as Clock,
      ),
    );
    for (const item of c.group.items) {
      const legacyId = item.achievement.id as number;
      // En conflicto un logro entra en dos catálogos: el mapa apunta al primero.
      if (importedAchievements.has(legacyId)) continue;
      importedAchievements.add(legacyId);
      mapId('achievements', legacyId, id);
    }
  }
  count('achievements').imported = importedAchievements.size;

  // ── Desbloqueos ──────────────────────────────────────────────────────────
  count('achievement_unlocks').read = data.unlocks.length;
  const unlockIds = new Map<number, string>();
  const unlockClocks = clockOf(
    data.unlocks.map((u) => ({ domainMs: num(u.unlockedAt), key: u.id as number })),
    'achievement_unlocks',
  );
  const seenUnlockIds = new Set<string>();
  for (const u of data.unlocks) {
    const legacyId = u.id as number;
    const achievement = achievementsById.get(u.achievementId as number);
    if (!achievement) throw new Error(`desbloqueo sin logro (id 1.x ${legacyId})`);
    const gameId = gameIds.get(achievement.gameId as number) as string;
    const legacySource = String(u.source);
    const src: AchievementSource = legacySource === 'ra' ? 'ra' : 'steam';
    const origin = legacySource === 'emu' ? LEGACY_EMU_ORIGIN : legacySource;
    const id = achievementUnlockId(gameId, src, String(achievement.apiName), origin);
    if (seenUnlockIds.has(id))
      throw new Error(`dos desbloqueos 1.x dan el mismo id 2.0 (id 1.x ${legacyId})`);
    seenUnlockIds.add(id);
    unlockIds.set(legacyId, id);
    push(
      'achievement_unlocks',
      makeRow(
        'achievement_unlocks',
        id,
        {
          gameId,
          source: src,
          apiName: String(achievement.apiName),
          origin,
          unlockedAt: u.unlockedAt,
          dateReliable: u.dateReliable,
          playthroughId:
            u.iterationId === null ? null : (iterationIds.get(u.iterationId as number) as string),
          sessionId:
            u.sessionId === null ? null : (sessionIds.get(u.sessionId as number) as string),
        },
        [],
        unlockClocks.get(legacyId) as Clock,
      ),
    );
    mapId('achievement_unlocks', legacyId, id);
    count('achievement_unlocks').imported += 1;
    fact(`desbloqueos de origen ${legacySource}`);
  }

  // ── Curiosidades ─────────────────────────────────────────────────────────
  count('curiosities').read = data.curiosities.length;
  const curiosityGames = data.games.filter(
    (g) => g.curiositiesGeneratedAt !== null || curiositiesByGame.has(g.id as number),
  );
  const curiosityDates = new Map<number, number>();
  for (const g of curiosityGames) {
    let at = num(g.curiositiesGeneratedAt);
    if (at === null) {
      at = req(g.addedAt);
      fact(
        'juegos con curiosidades sin curiositiesGeneratedAt (generatedAt = alta del juego; EXPECTED curiositiesWithoutStamp)',
      );
    }
    curiosityDates.set(g.id as number, at);
  }
  const curiosityClocks = clockOf(
    curiosityGames.map((g) => ({
      domainMs: curiosityDates.get(g.id as number) ?? null,
      key: g.id as number,
    })),
    'game_curiosities',
  );
  for (const g of curiosityGames) {
    const legacyGameId = g.id as number;
    const gameId = gameIds.get(legacyGameId) as string;
    const list = [...(curiositiesByGame.get(legacyGameId) ?? [])].sort(
      (a, b) => req(a.id) - req(b.id),
    );
    push(
      'game_curiosities',
      makeRow(
        'game_curiosities',
        gameId,
        {
          gameId,
          items: JSON.stringify(list.map((c) => String(c.text))),
          generatedAt: curiosityDates.get(legacyGameId) as number,
        },
        // La 1.x no guardaba el modelo.
        ['model'],
        curiosityClocks.get(legacyGameId) as Clock,
      ),
    );
    for (const c of list) {
      mapId('curiosities', c.id as number, gameId);
      count('curiosities').imported += 1;
    }
  }

  // ── Recaps ───────────────────────────────────────────────────────────────
  count('generated_memories').read = data.memories.length;
  const memoryClocks = clockOf(
    data.memories.map((m) => ({ domainMs: num(m.createdAt), key: m.id as number })),
    'generated_memories',
  );
  for (const m of data.memories) {
    const id = generatedMemoryId(String(m.scopeType), String(m.scopeKey));
    push(
      'generated_memories',
      makeRow(
        'generated_memories',
        id,
        {
          scopeType: m.scopeType,
          scopeKey: m.scopeKey,
          payload: m.payload,
          // La firma 1.x lleva ids de juego 1.x: se escribe tal cual y, ya
          // con los hechos 2.0 en el destino, `memorySignatures.ts` la
          // recalcula si casa (§19.5). El plan no puede hacerlo: necesita las
          // consultas sobre las filas ya escritas.
          sourceHash: m.sourceHash,
          model: m.model,
          promptVersion: m.promptVersion,
          createdAt: m.createdAt,
        },
        [],
        memoryClocks.get(m.id as number) as Clock,
      ),
    );
    mapId('generated_memories', m.id as number, id);
    count('generated_memories').imported += 1;
  }

  // ── Radar ────────────────────────────────────────────────────────────────
  count('radar_games').read = data.radarGames.length;
  const radarClocks = clockOf(
    data.radarGames.map((r) => ({ domainMs: num(r.discoveredAt), key: r.id as number })),
    'radar_games',
  );
  for (const r of data.radarGames) {
    const id = radarGameId(req(r.igdbId));
    push(
      'radar_games',
      makeRow(
        'radar_games',
        id,
        {
          igdbId: r.igdbId,
          collectionId: r.collectionId,
          collectionName: r.collectionName,
          title: r.title,
          coverUrl: r.coverUrl,
          releaseDate: r.releaseDate,
          releaseDatePrecision: r.releaseDatePrecision,
          releaseYear: r.releaseYear,
          discoveredAt: r.discoveredAt,
          dismissedAt: r.dismissedAt,
        },
        [],
        radarClocks.get(r.id as number) as Clock,
      ),
    );
    mapId('radar_games', r.id as number, id);
    count('radar_games').imported += 1;
  }

  // ── Lo que no se migra ───────────────────────────────────────────────────
  count('save_backups').read = data.saveBackupCount;
  discard('save_backups', 'se reindexa desde el bucket en la fase 6 (§19.5)', data.saveBackupCount);
  count('plan_mailbox').read = data.mailboxCount;
  discard(
    'plan_mailbox',
    'el buzón desaparece (§7.4); solo se exige vacío de pendientes',
    data.mailboxCount,
  );

  facts['techo de relojes (ms)'] = ceiling;
  facts[`id corto de los relojes importados: ${LEGACY_DEVICE_SHORT_ID}`] = 1;

  return {
    rows,
    legacyIds,
    source,
    facts,
    context: {
      data,
      sessions,
      gameIds,
      iterationIds,
      sessionIds,
      eventIds,
      spendIds,
      emulatorIds,
      unlockIds,
      droppedIterations,
      planEntries,
      achievementSources,
      classified,
      achievementStamps,
      gamesById,
      iterationsById,
      currency: options.currency,
    },
  };
}

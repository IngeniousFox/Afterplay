import { isAddedAtArtifact } from '../../../../shared/playthroughState';
import {
  achievementCatalogId,
  externalCheckId,
  generatedMemoryId,
  radarGameId,
} from '../../../../shared/sync/ids';
import type { ExternalCheckSource } from '../schema';
import {
  LEGACY_DEVICE_ID,
  LEGACY_EMU_ORIGIN,
  type ImportContext,
  type PlanEntryInfo,
} from './build';
import type { SqlValue } from './source';

// MAPA-1X.md CONVERTIDO EN UNA TABLA EJECUTABLE.
//
// Para CADA columna de CADA tabla del esquema 1.x (`src/main/db/schema.ts`)
// se declara qué pasa con ella:
// - `copy`: va tal cual a una columna 2.0 (con el id remapeado si es una
//   referencia);
// - `transform`: va a otro sitio o con otra forma (overrides, plan,
//   external_checks, la fuente y el origen de los logros, el catálogo en
//   JSON…), y `check` dice exactamente cómo;
// - `derived`: no se copia, pero de ella sale otra cosa que sí se comprueba;
// - `dropped`: no tiene destino, con el motivo.
//
// Lo usan dos cosas:
// - un test (`columnMap.test.ts`) que recorre el esquema 1.x y falla si una
//   columna no está declarada o si sobra una declaración: si alguien añade una
//   columna a la 1.x o cambia el mapa, no puede quedarse sin destino en
//   silencio;
// - la conciliación (`reconcile.ts`), que recorre TODAS las filas del origen y
//   comprueba en el destino cada valor declarado. Es lo que detecta la pérdida
//   de lo que no entra en ningún cálculo (una nota, una valoración, una
//   carátula elegida, el texto de un recap, la fecha de un desbloqueo), que es
//   justo lo irrecuperable.

/** Un valor que tiene que estar en el destino. */
export type Expectation = {
  /** Tabla 2.0, o `local_legacy_ids` (con id `<tabla 1.x>:<id 1.x>`). */
  readonly table: string;
  readonly id: string;
  readonly column: string;
  /** La columna destino guarda JSON: se compara por estructura. */
  readonly json?: boolean;
  /** Saca el valor de dentro de un agregado (un logro del catálogo…). */
  readonly pick?: (value: unknown) => unknown;
} & (
  | { readonly value: unknown }
  | { readonly test: (value: unknown) => boolean }
  /** La fila NO debe existir en el destino (un null que no crea fila). */
  | { readonly absent: true }
);

export type ColumnCheck = readonly Expectation[] | { readonly skip: string };

export type ColumnFate = 'copy' | 'transform' | 'derived' | 'dropped';

export type Row = Readonly<Record<string, SqlValue>>;

export interface ColumnDecl {
  readonly fate: ColumnFate;
  /** Destino legible (o motivo, si se descarta). Sale en el informe. */
  readonly to: string;
  /** Qué se espera en el destino para una fila; sin él, la columna se descarta. */
  readonly check?: (row: Row, ctx: ReconcileContext) => ColumnCheck;
}

export interface TableDecl {
  /** Si la tabla entera no se migra (no se leen sus filas), el motivo. */
  readonly rowsNotMigrated?: string;
  /** Motivo por el que UNA fila no se importa (null = se importa). */
  readonly rowSkip?: (row: Row, ctx: ReconcileContext) => string | null;
  readonly columns: Readonly<Record<string, ColumnDecl>>;
}

/** Lo que la conciliación sabe, además del contexto del plan. */
export interface ReconcileContext extends ImportContext {
  /** Curiosidad 1.x → su posición dentro de `game_curiosities.items`. */
  readonly curiosityIndex: ReadonlyMap<number, number>;
  /** Iteración 1.x importada → su posición dentro del juego (1, 2…). */
  readonly iterationPosition: ReadonlyMap<number, number>;
  readonly achievementsById: ReadonlyMap<number, Row>;
  /** Juego 1.x → fuentes de las que tiene catálogo. */
  readonly catalogSourcesByGame: ReadonlyMap<number, ReadonlySet<'steam' | 'ra'>>;
  /**
   * Id 2.0 de un recap → la firma que tiene que haber quedado tras el
   * recálculo (`memorySignatures.ts`). Sin entrada, la 1.x tal cual.
   */
  readonly memoryHashes: ReadonlyMap<string, { readonly expectedHash: string }>;
}

// ── Ayudantes ───────────────────────────────────────────────────────────────

const num = (value: SqlValue): number | null => (value === null ? null : Number(value));
const gid = (ctx: ReconcileContext, legacyGameId: SqlValue): string =>
  ctx.gameIds.get(Number(legacyGameId)) ?? `?game:${String(legacyGameId)}`;

const expect = (
  table: string,
  id: string,
  column: string,
  value: unknown,
  json = false,
): Expectation => ({
  table,
  id,
  column,
  value,
  json,
});
const absent = (table: string, id: string): Expectation => ({
  table,
  id,
  column: 'id',
  absent: true,
});
const legacyMap = (legacyTable: string, legacyId: SqlValue, newId: string): Expectation =>
  expect('local_legacy_ids', `${legacyTable}:${String(legacyId)}`, 'newId', newId);

/** `id` de una tabla 1.x: el mapa antiguo → nuevo y que la fila nueva exista. */
const idDecl = (
  legacyTable: string,
  table: string,
  newId: (row: Row, ctx: ReconcileContext) => string | null,
  to: string,
): ColumnDecl => ({
  fate: 'transform',
  to,
  check: (row, ctx) => {
    const id = newId(row, ctx);
    if (id === null) return { skip: 'sin fila 2.0' };
    return [legacyMap(legacyTable, row.id, id), expect(table, id, 'id', id)];
  },
});

/** Copia directa a la fila `idOf` de `table`. */
const copyTo = (
  table: string,
  idOf: (row: Row, ctx: ReconcileContext) => string,
  sourceColumn: string,
  targetColumn = sourceColumn,
  json = false,
): ColumnDecl => ({
  fate: targetColumn === sourceColumn ? 'copy' : 'transform',
  to: `${table}.${targetColumn}`,
  check: (row, ctx) => [expect(table, idOf(row, ctx), targetColumn, row[sourceColumn], json)],
});

const dropped = (why: string): ColumnDecl => ({ fate: 'dropped', to: why });

// ── games ───────────────────────────────────────────────────────────────────

const gameRow = (row: Row, ctx: ReconcileContext): string => gid(ctx, row.id);
const toGames = (column: string, target = column, json = false): ColumnDecl =>
  copyTo('games', gameRow, column, target, json);
const toMetadata = (column: string, json = false): ColumnDecl =>
  copyTo('game_metadata', gameRow, column, column, json);
/** Carátula, banner, desarrollador, distribuidora y géneros: a override y a la caché (§19.5, D-22). */
const toOverrideAndMetadata = (column: string, override: string, json = false): ColumnDecl => ({
  fate: 'transform',
  to: `games.${override} y game_metadata.${column}`,
  check: (row, ctx) => [
    expect('games', gameRow(row, ctx), override, row[column], json),
    expect('game_metadata', gameRow(row, ctx), column, row[column], json),
  ],
});
/** Un sello `…CheckedAt` → `external_checks(<fuente>).checkedAt`; null = sin fila. */
const toCheck = (column: string, source: ExternalCheckSource): ColumnDecl => ({
  fate: 'transform',
  to: `external_checks(${source}).checkedAt`,
  check: (row, ctx) => {
    const id = externalCheckId(gameRow(row, ctx), source);
    return row[column] === null
      ? [absent('external_checks', id)]
      : [expect('external_checks', id, 'checkedAt', row[column])];
  },
});
const isNotNull = (value: unknown): boolean => value !== null && value !== undefined;

const GAMES: TableDecl = {
  columns: {
    id: idDecl(
      'games',
      'games',
      (row, ctx) => gameRow(row, ctx),
      'games.id (UUIDv5 de igdb:<igdbId> o UUIDv7 determinista) + local_legacy_ids',
    ),
    title: toGames('title'),
    coverUrl: toOverrideAndMetadata('coverUrl', 'coverOverride'),
    heroUrl: toOverrideAndMetadata('heroUrl', 'heroOverride'),
    igdbId: toGames('igdbId'),
    sgdbId: {
      fate: 'transform',
      to: 'games.sgdbId; games.sgdbIdSource = manual si no es null',
      check: (row, ctx) => [
        expect('games', gameRow(row, ctx), 'sgdbId', row.sgdbId),
        expect('games', gameRow(row, ctx), 'sgdbIdSource', row.sgdbId === null ? null : 'manual'),
      ],
    },
    officialPlatforms: toMetadata('officialPlatforms', true),
    releaseYear: toMetadata('releaseYear'),
    hltbMain: toMetadata('hltbMain'),
    hltbMainExtras: toMetadata('hltbMainExtras'),
    hltbCompletionist: toMetadata('hltbCompletionist'),
    notes: toGames('notes'),
    executablePath: dropped('se reclama por PC en game_installs (§19.6, opción claimInstalls)'),
    developer: toOverrideAndMetadata('developer', 'developerOverride'),
    publisher: toOverrideAndMetadata('publisher', 'publisherOverride'),
    installDirectory: dropped('se reclama por PC en game_installs (§19.6, opción claimInstalls)'),
    installSizeBytes: dropped('se reclama por PC en game_installs (§19.6, opción claimInstalls)'),
    genres: toOverrideAndMetadata('genres', 'genresOverride', true),
    endless: toGames('endless'),
    isEmulated: toGames('isEmulated'),
    planned: {
      fate: 'derived',
      to: 'plan_entries viva (planned = 1) o con lápida / ausente (planned = 0)',
      check: (row, ctx) => {
        const id = gameRow(row, ctx);
        if (num(row.planned)) return [expect('plan_entries', id, 'syncDeleted', null)];
        const plan = ctx.planEntries.get(Number(row.id));
        return plan
          ? [{ table: 'plan_entries', id, column: 'syncDeleted', test: isNotNull }]
          : [absent('plan_entries', id)];
      },
    },
    addedAt: toGames('addedAt'),
    promotedAt: toGames('promotedAt'),
    saveBackupEnabled: toGames('saveBackupEnabled'),
    saveDetectionSource: toGames('saveDetectionSource'),
    saveLudusaviName: toGames('saveLudusaviName'),
    saveCustomPaths: toGames('saveCustomPaths', 'saveCustomPaths', true),
    curiositiesGeneratedAt: {
      fate: 'transform',
      to: 'game_curiosities.generatedAt y external_checks(curiosities).checkedAt',
      check: (row, ctx) => {
        const id = gameRow(row, ctx);
        const check = externalCheckId(id, 'curiosities');
        if (row.curiositiesGeneratedAt === null) {
          // Sin sello: solo hay fila de curiosidades si había curiosidades.
          return [absent('external_checks', check)];
        }
        return [
          expect('game_curiosities', id, 'generatedAt', row.curiositiesGeneratedAt),
          expect('external_checks', check, 'checkedAt', row.curiositiesGeneratedAt),
        ];
      },
    },
    steamAppId: toGames('steamAppId'),
    steamAppIdManual: {
      fate: 'transform',
      to: 'games.steamAppIdSource (manual / auto; null sin appid)',
      check: (row, ctx) => [
        expect(
          'games',
          gameRow(row, ctx),
          'steamAppIdSource',
          row.steamAppId === null ? null : num(row.steamAppIdManual) ? 'manual' : 'auto',
        ),
      ],
    },
    steamAppIdCheckedAt: toCheck('steamAppIdCheckedAt', 'steam_appid'),
    achievementsSyncedAt: {
      fate: 'transform',
      to: 'external_checks(steam_achievements / ra_achievements, según el catálogo).checkedAt y achievement_catalogs.fetchedAt',
      check: (row, ctx) => {
        const id = gameRow(row, ctx);
        const sources = ctx.achievementCheckSources.get(Number(row.id)) ?? [];
        if (row.achievementsSyncedAt === null) {
          return [
            absent('external_checks', externalCheckId(id, 'steam_achievements')),
            absent('external_checks', externalCheckId(id, 'ra_achievements')),
          ];
        }
        if (sources.length === 0)
          return { skip: 'achievementsSyncedAt sin catálogo ni clave de Steam o RA' };
        const out: Expectation[] = sources.map((source) =>
          expect(
            'external_checks',
            externalCheckId(id, source),
            'checkedAt',
            row.achievementsSyncedAt,
          ),
        );
        for (const source of ['steam', 'ra'] as const) {
          if (
            sources.includes(source === 'steam' ? 'steam_achievements' : 'ra_achievements') &&
            hasCatalog(ctx, Number(row.id), source)
          ) {
            out.push(
              expect(
                'achievement_catalogs',
                achievementCatalogId(id, source),
                'fetchedAt',
                row.achievementsSyncedAt,
              ),
            );
          }
        }
        return out;
      },
    },
    achievementsUnlocksSyncedAt: {
      fate: 'transform',
      to: 'external_checks(steam_unlocks).checkedAt (los juegos solo de RA lo tienen en ra_achievements)',
      check: (row, ctx) => {
        const id = externalCheckId(gameRow(row, ctx), 'steam_unlocks');
        if (row.achievementsUnlocksSyncedAt === null) return [absent('external_checks', id)];
        if (row.steamAppId === null && !hasCatalog(ctx, Number(row.id), 'steam')) {
          return {
            skip: 'achievementsUnlocksSyncedAt de un juego solo de RA (lo cubre ra_achievements)',
          };
        }
        return [expect('external_checks', id, 'checkedAt', row.achievementsUnlocksSyncedAt)];
      },
    },
    raGameId: toGames('raGameId'),
    raCheckedAt: toCheck('raCheckedAt', 'ra_match'),
    ratingCritics: toMetadata('ratingCritics'),
    ratingCriticsCount: toMetadata('ratingCriticsCount'),
    ratingUsers: toMetadata('ratingUsers'),
    ratingUsersCount: toMetadata('ratingUsersCount'),
    ratingsCheckedAt: toCheck('ratingsCheckedAt', 'igdb_ratings'),
    summary: toMetadata('summary'),
    igdbCollections: toMetadata('igdbCollections', true),
    steamTags: toMetadata('steamTags', true),
    steamPositive: toMetadata('steamPositive'),
    steamNegative: toMetadata('steamNegative'),
    steamSpyCheckedAt: toCheck('steamSpyCheckedAt', 'steam_store'),
    planPinnedAt: {
      fate: 'transform',
      to: 'plan_entries.pinnedAt',
      check: (row, ctx) => {
        if (!ctx.planEntries.has(Number(row.id))) {
          return row.planPinnedAt === null
            ? { skip: 'null en un juego sin plan' }
            : { skip: 'planPinnedAt de un juego sin plan ni plan_to_play: sin destino' };
        }
        return [expect('plan_entries', gameRow(row, ctx), 'pinnedAt', row.planPinnedAt)];
      },
    },
    releaseDate: toMetadata('releaseDate'),
    releaseDatePrecision: toMetadata('releaseDatePrecision'),
  },
};

function hasCatalog(ctx: ReconcileContext, legacyGameId: number, source: 'steam' | 'ra'): boolean {
  return ctx.catalogSourcesByGame.get(legacyGameId)?.has(source) ?? false;
}

// ── radar_games ─────────────────────────────────────────────────────────────

const radarRow = (row: Row): string => radarGameId(Number(row.igdbId));
const toRadar = (column: string): ColumnDecl => copyTo('radar_games', radarRow, column);
const RADAR: TableDecl = {
  columns: {
    id: idDecl(
      'radar_games',
      'radar_games',
      (row) => radarRow(row),
      'radar_games.id = igdb:<igdbId> + local_legacy_ids',
    ),
    igdbId: toRadar('igdbId'),
    collectionId: toRadar('collectionId'),
    collectionName: toRadar('collectionName'),
    title: toRadar('title'),
    coverUrl: toRadar('coverUrl'),
    releaseDate: toRadar('releaseDate'),
    releaseDatePrecision: toRadar('releaseDatePrecision'),
    releaseYear: toRadar('releaseYear'),
    discoveredAt: toRadar('discoveredAt'),
    dismissedAt: toRadar('dismissedAt'),
  },
};

// ── sessions ────────────────────────────────────────────────────────────────

const sessionRow = (row: Row, ctx: ReconcileContext): string =>
  ctx.sessionIds.get(Number(row.id)) ?? '?';
const toSessions = (column: string, target = column): ColumnDecl =>
  copyTo('sessions', sessionRow, column, target);
const SESSIONS: TableDecl = {
  columns: {
    id: idDecl(
      'sessions',
      'sessions',
      (row, ctx) => sessionRow(row, ctx),
      'sessions.id (UUIDv7 determinista) + local_legacy_ids; deviceId = legacy',
    ),
    iterationId: {
      fate: 'transform',
      to: 'sessions.playthroughId (remapeado; null = de emulador sin asignar)',
      check: (row, ctx) => [
        expect(
          'sessions',
          sessionRow(row, ctx),
          'playthroughId',
          row.iterationId === null ? null : (ctx.iterationIds.get(Number(row.iterationId)) ?? '?'),
        ),
        expect('sessions', sessionRow(row, ctx), 'deviceId', LEGACY_DEVICE_ID),
      ],
    },
    emulatorId: {
      fate: 'transform',
      to: 'sessions.emulatorId (remapeado)',
      check: (row, ctx) => [
        expect(
          'sessions',
          sessionRow(row, ctx),
          'emulatorId',
          row.emulatorId === null ? null : (ctx.emulatorIds.get(Number(row.emulatorId)) ?? '?'),
        ),
      ],
    },
    isManual: {
      fate: 'transform',
      to: 'sessions.source (1 → legacy_manual, 0 → measured)',
      check: (row, ctx) => [
        expect(
          'sessions',
          sessionRow(row, ctx),
          'source',
          num(row.isManual) ? 'legacy_manual' : 'measured',
        ),
      ],
    },
    startedAt: toSessions('startedAt'),
    endedAt: toSessions('endedAt'),
    durationSec: toSessions('durationSec'),
    lastHeartbeatAt: toSessions('lastHeartbeatAt', 'lastSeenAt'),
    startedBy: toSessions('startedBy'),
    datePrecision: toSessions('datePrecision'),
    note: toSessions('note'),
  },
};

// ── iterations → playthroughs ───────────────────────────────────────────────

const iterationRow = (row: Row, ctx: ReconcileContext): string =>
  ctx.iterationIds.get(Number(row.id)) ?? '?';
const toPlaythroughs = (column: string, target = column): ColumnDecl =>
  copyTo('playthroughs', iterationRow, column, target);
const ITERATIONS: TableDecl = {
  rowSkip: (row, ctx) =>
    ctx.droppedIterations.has(Number(row.id))
      ? 'iteración vacía de un juego planeado (la sustituye plan_entries, F-12)'
      : null,
  columns: {
    id: idDecl(
      'iterations',
      'playthroughs',
      (row, ctx) => iterationRow(row, ctx),
      'playthroughs.id (UUIDv7 determinista) + local_legacy_ids',
    ),
    gameId: {
      fate: 'copy',
      to: 'playthroughs.gameId (remapeado)',
      check: (row, ctx) => [
        expect('playthroughs', iterationRow(row, ctx), 'gameId', gid(ctx, row.gameId)),
      ],
    },
    label: {
      fate: 'transform',
      to: 'playthroughs.customLabel, null si es el automático "Playthrough <posición>"',
      check: (row, ctx) => {
        const position = ctx.iterationPosition.get(Number(row.id));
        return [
          expect(
            'playthroughs',
            iterationRow(row, ctx),
            'customLabel',
            row.label === `Playthrough ${String(position)}` ? null : row.label,
          ),
        ];
      },
    },
    playedPlatform: toPlaythroughs('playedPlatform'),
    origin: toPlaythroughs('origin'),
    format: toPlaythroughs('format'),
    manualTotalPlayed: toPlaythroughs('manualTotalPlayed', 'manualHours'),
    rating: toPlaythroughs('rating'),
    extraContent: toPlaythroughs('extraContent'),
  },
};

// ── state_events ────────────────────────────────────────────────────────────

const eventRow = (row: Row, ctx: ReconcileContext): string =>
  ctx.eventIds.get(Number(row.id)) ?? '?';
const isPlanEvent = (row: Row): boolean => row.type === 'plan_to_play';
const planOf = (
  row: Row,
  ctx: ReconcileContext,
): { gameId: number; plan: PlanEntryInfo | undefined } => {
  const gameId = Number(ctx.iterationsById.get(Number(row.iterationId))?.gameId);
  return { gameId, plan: ctx.planEntries.get(gameId) };
};
const STATE_EVENTS: TableDecl = {
  columns: {
    id: {
      fate: 'transform',
      to: 'state_events.id (UUIDv7 determinista); plan_to_play → id de su plan_entries; + local_legacy_ids',
      check: (row, ctx) => {
        if (isPlanEvent(row)) {
          const { plan } = planOf(row, ctx);
          return plan
            ? [
                legacyMap('state_events', row.id, plan.id),
                expect('plan_entries', plan.id, 'id', plan.id),
              ]
            : { skip: 'plan_to_play sin plan' };
        }
        const id = eventRow(row, ctx);
        return [legacyMap('state_events', row.id, id), expect('state_events', id, 'id', id)];
      },
    },
    iterationId: {
      fate: 'transform',
      to: 'state_events.playthroughId (remapeado); plan_to_play → plan_entries.gameId',
      check: (row, ctx) => {
        if (isPlanEvent(row)) {
          const { gameId, plan } = planOf(row, ctx);
          return plan
            ? [expect('plan_entries', plan.id, 'gameId', gid(ctx, gameId))]
            : { skip: 'plan_to_play sin plan' };
        }
        return [
          expect(
            'state_events',
            eventRow(row, ctx),
            'playthroughId',
            ctx.iterationIds.get(Number(row.iterationId)) ?? '?',
          ),
        ];
      },
    },
    type: {
      fate: 'transform',
      to: 'state_events.type; plan_to_play desaparece como tipo (lo representa plan_entries)',
      check: (row, ctx) =>
        isPlanEvent(row)
          ? { skip: 'plan_to_play: lo representa la existencia de plan_entries' }
          : [expect('state_events', eventRow(row, ctx), 'type', row.type)],
    },
    occurredAt: {
      fate: 'transform',
      to: 'state_events.occurredAt; el primer plan_to_play → plan_entries.plannedAt',
      check: (row, ctx) => {
        if (!isPlanEvent(row))
          return [expect('state_events', eventRow(row, ctx), 'occurredAt', row.occurredAt)];
        const { plan } = planOf(row, ctx);
        return plan && plan.dateEventId === Number(row.id)
          ? [expect('plan_entries', plan.id, 'plannedAt', row.occurredAt)]
          : { skip: 'plan_to_play adicional: su fecha no tiene destino' };
      },
    },
    datePrecision: {
      fate: 'transform',
      to: 'state_events.datePrecision; unknown si isAddedAtArtifact lo reconoce (§7.5)',
      check: (row, ctx) => {
        if (isPlanEvent(row)) return { skip: 'plan_to_play: plan_entries no guarda precisión' };
        const game = ctx.gamesById.get(
          Number(ctx.iterationsById.get(Number(row.iterationId))?.gameId),
        );
        const artifact =
          game !== undefined &&
          isAddedAtArtifact(
            new Date(Number(row.occurredAt)),
            new Date(Number(game.addedAt)),
            game.promotedAt === null ? null : new Date(Number(game.promotedAt)),
          );
        return [
          expect(
            'state_events',
            eventRow(row, ctx),
            'datePrecision',
            artifact ? 'unknown' : row.datePrecision,
          ),
        ];
      },
    },
    note: {
      fate: 'transform',
      to: 'state_events.note; la nota del plan_to_play que enseña el Plan → plan_entries.note',
      check: (row, ctx) => {
        if (!isPlanEvent(row))
          return [expect('state_events', eventRow(row, ctx), 'note', row.note)];
        const { plan } = planOf(row, ctx);
        return plan && plan.noteEventId === Number(row.id)
          ? [expect('plan_entries', plan.id, 'note', row.note)]
          : { skip: 'plan_to_play adicional: su nota no tiene destino' };
      },
    },
  },
};

// ── emulators ───────────────────────────────────────────────────────────────

const emulatorRow = (row: Row, ctx: ReconcileContext): string =>
  ctx.emulatorIds.get(Number(row.id)) ?? '?';
const EMULATORS: TableDecl = {
  columns: {
    id: idDecl(
      'emulators',
      'emulators',
      (row, ctx) => emulatorRow(row, ctx),
      'emulators.id (UUIDv7 determinista) + local_legacy_ids',
    ),
    name: copyTo('emulators', emulatorRow, 'name'),
    executablePath: dropped('se reclama por PC en emulator_installs (§19.6, opción claimInstalls)'),
  },
};

// ── save_backups y plan_mailbox: no se migran filas ─────────────────────────

const SAVE_REINDEX = 'save_backups se reindexa desde el bucket en la fase 6 (§19.5)';
const SAVE_BACKUPS: TableDecl = {
  rowsNotMigrated: SAVE_REINDEX,
  columns: Object.fromEntries(
    [
      'id',
      'gameId',
      'createdAt',
      'backupName',
      'r2Key',
      'sizeBytes',
      'ludusaviName',
      'differential',
      'parentBackupName',
      'machineId',
      'machineName',
      'machineHome',
      'locations',
      'hasRegistry',
    ].map((c) => [c, dropped(SAVE_REINDEX)]),
  ),
};

const MAILBOX = 'el buzón desaparece (§7.4); se exige vacío de pendientes (§19.7)';
const PLAN_MAILBOX: TableDecl = {
  rowsNotMigrated: MAILBOX,
  columns: Object.fromEntries(
    ['id', 'type', 'payload', 'createdAt', 'requestedBy', 'processedAt', 'error'].map((c) => [
      c,
      dropped(MAILBOX),
    ]),
  ),
};

// ── curiosities → game_curiosities ──────────────────────────────────────────

const CURIOSITIES: TableDecl = {
  columns: {
    id: {
      fate: 'transform',
      to: 'desaparece: fija el orden dentro de game_curiosities.items; local_legacy_ids → id del juego',
      check: (row, ctx) => [legacyMap('curiosities', row.id, gid(ctx, row.gameId))],
    },
    gameId: {
      fate: 'copy',
      to: 'game_curiosities.gameId (remapeado; una fila por juego)',
      check: (row, ctx) => [
        expect('game_curiosities', gid(ctx, row.gameId), 'gameId', gid(ctx, row.gameId)),
      ],
    },
    text: {
      fate: 'transform',
      to: 'un elemento de game_curiosities.items, en orden de id',
      check: (row, ctx) => {
        const index = ctx.curiosityIndex.get(Number(row.id)) ?? -1;
        return [
          {
            table: 'game_curiosities',
            id: gid(ctx, row.gameId),
            column: 'items',
            json: true,
            pick: (items) => (Array.isArray(items) ? (items[index] as unknown) : undefined),
            value: row.text,
          },
        ];
      },
    },
  },
};

// ── achievements → achievement_catalogs ─────────────────────────────────────

/** El elemento del catálogo con ese apiName, en cada catálogo al que va el logro. */
const catalogItem = (
  column: string,
  transform: (value: SqlValue) => unknown = (v) => v,
): ColumnDecl => ({
  fate: 'transform',
  to: `achievement_catalogs.items[].${column}`,
  check: (row, ctx) => {
    const sources = ctx.achievementSources.get(Number(row.id)) ?? [];
    return sources.map((source) => ({
      table: 'achievement_catalogs',
      id: achievementCatalogId(gid(ctx, row.gameId), source),
      column: 'items',
      json: true,
      pick: (items: unknown) => {
        const item = Array.isArray(items)
          ? (items as Record<string, unknown>[]).find(
              (entry) => entry.apiName === String(row.apiName),
            )
          : undefined;
        return item === undefined ? undefined : item[column];
      },
      value: transform(row[column]),
    }));
  },
});
const ACHIEVEMENTS: TableDecl = {
  columns: {
    id: {
      fate: 'transform',
      to: 'desaparece; local_legacy_ids → id del catálogo (<gameId>:<fuente>)',
      check: (row, ctx) => {
        const source = ctx.achievementSources.get(Number(row.id))?.[0];
        return source
          ? [legacyMap('achievements', row.id, achievementCatalogId(gid(ctx, row.gameId), source))]
          : { skip: 'sin fuente' };
      },
    },
    gameId: {
      fate: 'transform',
      to: 'achievement_catalogs.gameId (y su id <gameId>:<fuente>, fuente según achievements.ts)',
      check: (row, ctx) =>
        (ctx.achievementSources.get(Number(row.id)) ?? []).flatMap((source) => {
          const id = achievementCatalogId(gid(ctx, row.gameId), source);
          return [
            expect('achievement_catalogs', id, 'gameId', gid(ctx, row.gameId)),
            expect('achievement_catalogs', id, 'source', source),
          ];
        }),
    },
    apiName: catalogItem('apiName', (v) => String(v)),
    displayName: catalogItem('displayName', (v) => String(v)),
    description: catalogItem('description'),
    iconUrl: catalogItem('iconUrl'),
    iconGrayUrl: catalogItem('iconGrayUrl'),
    hidden: catalogItem('hidden', (v) => !!num(v)),
    globalPercent: catalogItem('globalPercent'),
    sortIndex: catalogItem('sortIndex'),
  },
};

// ── achievement_unlocks ─────────────────────────────────────────────────────

const unlockRow = (row: Row, ctx: ReconcileContext): string =>
  ctx.unlockIds.get(Number(row.id)) ?? '?';
const UNLOCKS: TableDecl = {
  columns: {
    id: idDecl(
      'achievement_unlocks',
      'achievement_unlocks',
      (row, ctx) => unlockRow(row, ctx),
      'achievement_unlocks.id = <gameId>:<fuente>:<apiName>:<origen> + local_legacy_ids',
    ),
    achievementId: {
      fate: 'transform',
      to: 'achievement_unlocks.gameId y .apiName del logro 1.x (el enlace es por gameId, fuente y apiName)',
      check: (row, ctx) => {
        const achievement = ctx.achievementsById.get(Number(row.achievementId));
        if (!achievement) return { skip: 'logro inexistente' };
        const id = unlockRow(row, ctx);
        return [
          expect('achievement_unlocks', id, 'gameId', gid(ctx, achievement.gameId)),
          expect('achievement_unlocks', id, 'apiName', String(achievement.apiName)),
        ];
      },
    },
    unlockedAt: copyTo('achievement_unlocks', unlockRow, 'unlockedAt'),
    dateReliable: copyTo('achievement_unlocks', unlockRow, 'dateReliable'),
    source: {
      fate: 'transform',
      to: 'achievement_unlocks.source y .origin (steam → steam/steam; emu → steam/emu@legacy; ra → ra/ra)',
      check: (row, ctx) => {
        const id = unlockRow(row, ctx);
        const legacy = String(row.source);
        return [
          expect('achievement_unlocks', id, 'source', legacy === 'ra' ? 'ra' : 'steam'),
          expect(
            'achievement_unlocks',
            id,
            'origin',
            legacy === 'emu' ? LEGACY_EMU_ORIGIN : legacy,
          ),
        ];
      },
    },
    iterationId: {
      fate: 'copy',
      to: 'achievement_unlocks.playthroughId (remapeado)',
      check: (row, ctx) => [
        expect(
          'achievement_unlocks',
          unlockRow(row, ctx),
          'playthroughId',
          row.iterationId === null ? null : (ctx.iterationIds.get(Number(row.iterationId)) ?? '?'),
        ),
      ],
    },
    sessionId: {
      fate: 'copy',
      to: 'achievement_unlocks.sessionId (remapeado)',
      check: (row, ctx) => [
        expect(
          'achievement_unlocks',
          unlockRow(row, ctx),
          'sessionId',
          row.sessionId === null ? null : (ctx.sessionIds.get(Number(row.sessionId)) ?? '?'),
        ),
      ],
    },
  },
};

// ── generated_memories ──────────────────────────────────────────────────────

const memoryRow = (row: Row): string =>
  generatedMemoryId(String(row.scopeType), String(row.scopeKey));
const toMemories = (column: string, json = false): ColumnDecl =>
  copyTo('generated_memories', memoryRow, column, column, json);
const MEMORIES: TableDecl = {
  columns: {
    id: idDecl(
      'generated_memories',
      'generated_memories',
      (row) => memoryRow(row),
      'generated_memories.id = <scopeType>:<scopeKey> + local_legacy_ids',
    ),
    scopeType: toMemories('scopeType'),
    scopeKey: toMemories('scopeKey'),
    payload: toMemories('payload', true),
    // §19.5: la firma se recalcula con los ids 2.0 cuando casa con los hechos
    // importados (memorySignatures.ts); la que no casa se queda tal cual. Lo
    // esperado es lo que decidió ese recálculo, y que la firma reescrita sea
    // de verdad la de los hechos 2.0 lo comprueba la validación con consultas
    // (vigencia de cada recap en la 1.x frente a la 2.0).
    sourceHash: {
      fate: 'transform',
      to: 'generated_memories.sourceHash (recalculada con ids 2.0 si casa; si no, copia)',
      check: (row, ctx) => [
        expect(
          'generated_memories',
          memoryRow(row),
          'sourceHash',
          ctx.memoryHashes.get(memoryRow(row))?.expectedHash ?? row.sourceHash,
        ),
      ],
    },
    model: toMemories('model'),
    promptVersion: toMemories('promptVersion'),
    createdAt: toMemories('createdAt'),
  },
};

// ── spend_events ────────────────────────────────────────────────────────────

const spendRow = (row: Row, ctx: ReconcileContext): string =>
  ctx.spendIds.get(Number(row.id)) ?? '?';
const toSpend = (column: string): ColumnDecl => copyTo('spend_events', spendRow, column);
const SPEND: TableDecl = {
  columns: {
    id: idDecl(
      'spend_events',
      'spend_events',
      (row, ctx) => spendRow(row, ctx),
      'spend_events.id (UUIDv7 determinista) + local_legacy_ids; currency = la de la importación',
    ),
    gameId: {
      fate: 'copy',
      to: 'spend_events.gameId (remapeado)',
      check: (row, ctx) => [
        expect('spend_events', spendRow(row, ctx), 'gameId', gid(ctx, row.gameId)),
        expect('spend_events', spendRow(row, ctx), 'currency', ctx.currency),
      ],
    },
    type: toSpend('type'),
    amount: toSpend('amount'),
    occurredAt: toSpend('occurredAt'),
    datePrecision: toSpend('datePrecision'),
    note: toSpend('note'),
  },
};

/** Cada tabla del esquema 1.x, por su nombre SQL, y cada una de sus columnas. */
export const LEGACY_COLUMN_MAP: Readonly<Record<string, TableDecl>> = {
  games: GAMES,
  radar_games: RADAR,
  sessions: SESSIONS,
  iterations: ITERATIONS,
  state_events: STATE_EVENTS,
  emulators: EMULATORS,
  save_backups: SAVE_BACKUPS,
  curiosities: CURIOSITIES,
  achievements: ACHIEVEMENTS,
  achievement_unlocks: UNLOCKS,
  generated_memories: MEMORIES,
  plan_mailbox: PLAN_MAILBOX,
  spend_events: SPEND,
};

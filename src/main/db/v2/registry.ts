import { getTableName } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

// ── Registro de tablas 2.0 ──────────────────────────────────────────────────
//
// Lo que recorren la puerta única de escritura (§8.6) y el motor de sync
// (§8.5): para cada tabla, su objeto Drizzle, su clase (§7.1), si sincroniza,
// cómo se forma su id (§7.2) y qué hay que hacer con las filas que la apuntan
// cuando se borra una de las suyas (§7.7).
//
// El borrado es lógico: borrar es poner la lápida (`syncDeleted`), y quien
// borra un padre marca también a sus hijos en la misma transacción. Las filas
// que apuntan a una tabla se reparten en dos listas, y toda clave foránea
// hacia una tabla sincronizada está en una de ellas (lo comprueba un test):
//
// - `children`: hijos de verdad. Se les pone la lápida con el padre, y la
//   lectura trata como borrado al hijo de un padre borrado (F-11). Al
//   resucitar un padre (id determinista vuelto a añadir, §8.3) sus hijos
//   siguen borrados.
// - `references`: referencias que NO son de propiedad. Borrar el padre no
//   borra la fila: o se queda como está (`keep`), o la puerta pone la columna
//   a null en la misma transacción (`nullify`, el SET NULL de la 1.x). La
//   regla de lectura de F-11 no se aplica por estas columnas: quien lea una
//   referencia a una fila borrada la trata como ausente.
//
// Las listas viven en el PADRE: al borrar una fila, la puerta mira la entrada
// de su tabla y sabe qué tocar sin recorrer el esquema entero.

export type DataClass = 'U' | 'O' | 'C' | 'L';

/** Un trozo de la clave de un id: el valor de una columna o un texto fijo. */
export type IdPart = { readonly column: string } | { readonly literal: string };

/**
 * Cómo se forma el id de una fila (§7.2). Los ids los genera
 * `src/shared/sync/ids.ts`; esto solo dice cuál toca.
 */
export type IdShape =
  /** UUIDv7, ordenable por creación. */
  | { readonly kind: 'random' }
  /**
   * UUIDv5 de las partes unidas con `:`. Con `fallback: 'random'`, si alguna
   * columna es null se usa un UUIDv7 (juegos sin igdbId).
   */
  | {
      readonly kind: 'deterministic';
      readonly parts: readonly IdPart[];
      readonly fallback?: 'random';
    }
  /** Las partes unidas con `:`, sin hash. Con una sola parte, el id es esa columna. */
  | { readonly kind: 'composite'; readonly parts: readonly IdPart[] }
  /** Lo aporta quien crea la fila y nunca se genera (el `machineId`, D-11). */
  | { readonly kind: 'given' }
  /** Tabla local: su clave primaria propia, sin forma de sync. */
  | { readonly kind: 'local' };

export type ChildLink = {
  /** Tabla hija. */
  readonly table: string;
  /** Columna de la hija que apunta al `id` del padre. */
  readonly column: string;
  /** Si existe, solo son hijas las filas con esta columna a null. */
  readonly onlyWhereNull?: string;
  readonly why: string;
};

export type ReferenceLink = {
  readonly table: string;
  readonly column: string;
  readonly onParentDelete: 'keep' | 'nullify';
  readonly why: string;
};

export type SyncedTableEntry<TTable extends SQLiteTable = SQLiteTable> = {
  readonly name: string;
  readonly table: TTable;
  readonly dataClass: 'U' | 'O' | 'C';
  readonly synced: true;
  readonly id: IdShape;
  /** Solo clase O: la columna con el dispositivo dueño (§7.1). */
  readonly owner?: { readonly column: 'deviceId' };
  /** False = nunca se le pone lápida (se da de baja de otra forma). */
  readonly deletable: boolean;
  readonly children: readonly ChildLink[];
  readonly references: readonly ReferenceLink[];
};

export type LocalTableEntry<TTable extends SQLiteTable = SQLiteTable> = {
  readonly name: string;
  readonly table: TTable;
  readonly dataClass: 'L';
  readonly synced: false;
  readonly id: { readonly kind: 'local' };
};

export type TableEntry = SyncedTableEntry | LocalTableEntry;

const synced = <TTable extends SQLiteTable>(
  table: TTable,
  entry: Omit<SyncedTableEntry<TTable>, 'name' | 'table' | 'synced'>,
): SyncedTableEntry<TTable> => ({ name: getTableName(table), table, synced: true, ...entry });

const local = <TTable extends SQLiteTable>(table: TTable): LocalTableEntry<TTable> => ({
  name: getTableName(table),
  table,
  dataClass: 'L',
  synced: false,
  id: { kind: 'local' },
});

const col = (column: string): IdPart => ({ column });

// Motivos repetidos, para que cada uno se explique una sola vez.
const DEVICE_REF =
  'Un dispositivo no se borra nunca (se da de baja con revokedAt); lo suyo sigue siendo del usuario.';
const CACHE_REF =
  'Caché re-derivable con id ligado al juego: se conserva si el juego se borra, y si se vuelve a añadir (mismo id, §8.3) aparece sin repetir llamadas ni repagar curiosidades. Los trabajos de refresco deben ignorar las de juegos borrados.';

// El orden de las claves es padre antes que hijo (lo comprueba un test): sirve
// para crear, sembrar o validar sin depender de claves foráneas diferidas.
export const registry = {
  devices: synced(schema.devices, {
    dataClass: 'U',
    id: { kind: 'given' },
    deletable: false,
    children: [],
    references: [
      { table: 'game_installs', column: 'deviceId', onParentDelete: 'keep', why: DEVICE_REF },
      { table: 'emulator_installs', column: 'deviceId', onParentDelete: 'keep', why: DEVICE_REF },
      { table: 'sessions', column: 'deviceId', onParentDelete: 'keep', why: DEVICE_REF },
      { table: 'state_events', column: 'deviceId', onParentDelete: 'keep', why: DEVICE_REF },
      { table: 'save_backups', column: 'deviceId', onParentDelete: 'keep', why: DEVICE_REF },
    ],
  }),

  games: synced(schema.games, {
    dataClass: 'U',
    // §7.2: con igdbId, UUIDv5 de `igdb:<igdbId>`; sin él, UUIDv7.
    id: {
      kind: 'deterministic',
      parts: [{ literal: 'igdb' }, col('igdbId')],
      fallback: 'random',
    },
    deletable: true,
    children: [
      {
        table: 'playthroughs',
        column: 'gameId',
        why: 'Como en la 1.x: sin juego no hay partidas.',
      },
      { table: 'plan_entries', column: 'gameId', why: 'Un juego borrado no sigue planeado.' },
      { table: 'spend_events', column: 'gameId', why: 'Como en la 1.x (cascada).' },
      {
        table: 'game_installs',
        column: 'gameId',
        why: 'El watcher no debe vigilar un juego borrado. Es la única escritura que un dispositivo hace sobre la instalación de otro.',
      },
      {
        table: 'achievement_unlocks',
        column: 'gameId',
        why: 'Como en la 1.x (cascada por el catálogo). Si el juego vuelve, cada fuente reescribe los suyos.',
      },
    ],
    references: [
      { table: 'game_metadata', column: 'gameId', onParentDelete: 'keep', why: CACHE_REF },
      { table: 'external_checks', column: 'gameId', onParentDelete: 'keep', why: CACHE_REF },
      { table: 'achievement_catalogs', column: 'gameId', onParentDelete: 'keep', why: CACHE_REF },
      { table: 'game_curiosities', column: 'gameId', onParentDelete: 'keep', why: CACHE_REF },
      {
        table: 'save_backups',
        column: 'gameId',
        onParentDelete: 'keep',
        why: 'Es el índice de objetos reales del bucket, que borrar el juego no toca. Con lápida, el PC dueño borraría sus zips locales al verla (§12.5) y el índice no volvería al resucitar el juego. Si el juego vuelve (mismo id), sus partidas reaparecen.',
      },
    ],
  }),

  game_metadata: synced(schema.gameMetadata, {
    dataClass: 'C',
    id: { kind: 'composite', parts: [col('gameId')] },
    deletable: true,
    children: [],
    references: [],
  }),

  external_checks: synced(schema.externalChecks, {
    dataClass: 'C',
    id: { kind: 'composite', parts: [col('gameId'), col('source')] },
    deletable: true,
    children: [],
    references: [],
  }),

  game_installs: synced(schema.gameInstalls, {
    dataClass: 'O',
    id: { kind: 'composite', parts: [col('gameId'), col('deviceId')] },
    owner: { column: 'deviceId' },
    deletable: true,
    children: [],
    references: [],
  }),

  emulators: synced(schema.emulators, {
    dataClass: 'U',
    id: { kind: 'random' },
    deletable: true,
    children: [
      { table: 'emulator_installs', column: 'emulatorId', why: 'Sin emulador no hay instalación.' },
      {
        table: 'sessions',
        column: 'emulatorId',
        onlyWhereNull: 'playthroughId',
        why: 'Las sesiones pendientes de asignar solo existen por el emulador (en la 1.x las borraba deleteEmulator).',
      },
    ],
    references: [
      {
        table: 'sessions',
        column: 'emulatorId',
        onParentDelete: 'keep',
        why: 'Las ya asignadas a un juego son tiempo jugado y se quedan. No se anula la columna: es un campo del dueño de la sesión y otro dispositivo no puede escribirlo (§7.4).',
      },
    ],
  }),

  emulator_installs: synced(schema.emulatorInstalls, {
    dataClass: 'O',
    id: { kind: 'composite', parts: [col('emulatorId'), col('deviceId')] },
    owner: { column: 'deviceId' },
    deletable: true,
    children: [],
    references: [],
  }),

  plan_entries: synced(schema.planEntries, {
    dataClass: 'U',
    id: { kind: 'composite', parts: [col('gameId')] },
    deletable: true,
    children: [],
    references: [],
  }),

  playthroughs: synced(schema.playthroughs, {
    dataClass: 'U',
    id: { kind: 'random' },
    deletable: true,
    children: [
      { table: 'state_events', column: 'playthroughId', why: 'El historial es del playthrough.' },
      {
        table: 'sessions',
        column: 'playthroughId',
        why: 'Como en la 1.x (cascada). Fusionar dos playthroughs mueve las sesiones antes de borrar el sobrante (§10.7).',
      },
    ],
    references: [
      {
        table: 'spend_events',
        column: 'playthroughId',
        onParentDelete: 'nullify',
        why: 'El gasto sigue siendo del juego; sin playthrough se reparte por fecha.',
      },
      {
        table: 'achievement_unlocks',
        column: 'playthroughId',
        onParentDelete: 'nullify',
        why: 'Haber sacado el logro no depende del playthrough (SET NULL en la 1.x).',
      },
    ],
  }),

  state_events: synced(schema.stateEvents, {
    dataClass: 'U',
    id: { kind: 'random' },
    deletable: true,
    children: [],
    references: [],
  }),

  sessions: synced(schema.sessions, {
    dataClass: 'O',
    id: { kind: 'random' },
    owner: { column: 'deviceId' },
    deletable: true,
    children: [],
    references: [
      {
        table: 'achievement_unlocks',
        column: 'sessionId',
        onParentDelete: 'nullify',
        why: 'Borrar una sesión no borra el hecho de haber sacado el logro (SET NULL en la 1.x).',
      },
    ],
  }),

  spend_events: synced(schema.spendEvents, {
    dataClass: 'U',
    id: { kind: 'random' },
    deletable: true,
    children: [],
    references: [],
  }),

  achievement_catalogs: synced(schema.achievementCatalogs, {
    dataClass: 'C',
    id: { kind: 'composite', parts: [col('gameId'), col('source')] },
    deletable: true,
    children: [],
    references: [],
  }),

  achievement_unlocks: synced(schema.achievementUnlocks, {
    dataClass: 'U',
    id: {
      kind: 'composite',
      parts: [col('gameId'), col('source'), col('apiName'), col('origin')],
    },
    deletable: true,
    children: [],
    references: [],
  }),

  save_backups: synced(schema.saveBackups, {
    dataClass: 'O',
    // UUIDv5 de la clave del objeto en el bucket (F-21).
    id: { kind: 'deterministic', parts: [col('r2Key')] },
    owner: { column: 'deviceId' },
    deletable: true,
    children: [],
    references: [],
  }),

  game_curiosities: synced(schema.gameCuriosities, {
    dataClass: 'C',
    id: { kind: 'composite', parts: [col('gameId')] },
    deletable: true,
    children: [],
    references: [],
  }),

  generated_memories: synced(schema.generatedMemories, {
    dataClass: 'C',
    id: { kind: 'composite', parts: [col('scopeType'), col('scopeKey')] },
    deletable: true,
    children: [],
    references: [],
  }),

  radar_games: synced(schema.radarGames, {
    dataClass: 'C',
    // `igdb:<igdbId>` en claro, no un UUIDv5 (§7.2).
    id: { kind: 'composite', parts: [{ literal: 'igdb' }, col('igdbId')] },
    deletable: true,
    children: [],
    references: [],
  }),

  local_session_beats: local(schema.localSessionBeats),
  local_sync_state: local(schema.localSyncState),
  local_save_state: local(schema.localSaveState),
  local_emu_state: local(schema.localEmuState),
  local_legacy_ids: local(schema.localLegacyIds),
  local_job_state: local(schema.localJobState),
} as const;

export type Registry = typeof registry;
export type TableName = keyof Registry;
export type SyncedTableName = {
  [K in TableName]: Registry[K] extends SyncedTableEntry ? K : never;
}[TableName];
export type LocalTableName = Exclude<TableName, SyncedTableName>;

const allEntries: readonly TableEntry[] = Object.values(registry);

/** Tablas sincronizadas, padre antes que hijo. */
export const syncedEntries: readonly SyncedTableEntry[] = allEntries.filter(
  (entry): entry is SyncedTableEntry => entry.synced,
);

export const localEntries: readonly LocalTableEntry[] = allEntries.filter(
  (entry): entry is LocalTableEntry => !entry.synced,
);

export const isSyncedTableName = (name: string): name is SyncedTableName =>
  syncedEntries.some((entry) => entry.name === name);

export const getSyncedEntry = (name: SyncedTableName): SyncedTableEntry => registry[name];

import { sql, type BuildColumns, type ColumnBuilderBase } from 'drizzle-orm';
import {
  check,
  index,
  int,
  primaryKey,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  type PrimaryKeyBuilder,
  type SQLiteTableExtraConfigValue,
  type SQLiteTableWithColumns,
} from 'drizzle-orm/sqlite-core';
import type { RecapPayload } from '../../../shared/memory/payload';

// ── Esquema de la base local 2.0 (AFTERPLAY-2.0.md §7) ──────────────────────
//
// Es el esquema de `Afterplay2.db`, la base completa de cada PC (§7.9). El de
// la 1.x (`../schema.ts`) se queda intacto: la app actual sigue usándolo hasta
// que se adapten las consultas, y el importador de la fase 8 lo lee.
//
// Convenciones heredadas de la 1.x, a propósito iguales:
// - Columnas en camelCase con el mismo nombre en TypeScript y en SQL.
// - Fechas de dominio como INTEGER en milisegundos (`timestamp_ms`).
// - Booleanos como INTEGER 0/1 (`mode: 'boolean'`).
// - JSON como TEXT (`mode: 'json'`) con su tipo en `$type`.
// - Enumeraciones SIN `CHECK` en SQL: el tipo unión vive en TypeScript y la
//   validación en la puerta de escritura. Añadir un valor no debe exigir
//   reconstruir una tabla, y en 2.x las migraciones de tablas sincronizadas
//   son solo aditivas (§8.7).
//
// Lo que cambia respecto a la 1.x:
// - Ids TEXT (§7.2). El esquema no los genera: los genera quien crea la fila
//   (`src/shared/sync/ids.ts`) y la puerta de escritura los valida.
// - Sin `$defaultFn` en las tablas sincronizadas. Un valor inventado al
//   insertar viajaría con el reloj de creación y podría pisar el valor real
//   de otro PC (§8.3: lo que no se indica al crear lleva `BOTTOM`). Las fechas
//   obligatorias las pone siempre quien escribe.
// - Sin índices ÚNICOS en las tablas sincronizadas. Las claves naturales van
//   en el id (determinista o compuesto), y un índice único no se puede
//   desactivar durante la descarga: una fila ajena que lo violara atascaría
//   el sync para siempre (la lección del agujero H-4, §7.7).
// - Claves foráneas declaradas y SIN acciones (§7.7): el borrado es lógico y
//   quien borra un padre marca a sus hijos (ver `registry.ts`).
//
// Sobre NOT NULL: a diferencia de un CHECK, `PRAGMA ignore_check_constraints`
// no lo desactiva. Por eso solo se declara en columnas que se escriben SIEMPRE
// en la misma escritura que crea la fila (título, padre, fechas de dominio,
// tipo…) o que tienen DEFAULT. La puerta de escritura debe rechazar una
// creación sin ellas, y el motor de sync debe apartar (no aplicar a ciegas)
// una fila entrante que las traiga a null, en vez de abortar la página.

// ── Enumeraciones (validadas en TypeScript, no en SQL) ──────────────────────

export const DEVICE_KINDS = ['desktop', 'web', 'legacy'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

// `linux` existe desde el principio aunque la 2.0 solo publique Windows (D-14).
export const DEVICE_OSES = ['windows', 'linux', 'web'] as const;
export type DeviceOs = (typeof DEVICE_OSES)[number];

// Origen de una clave externa: una fijada a mano no la sustituye ningún
// refresco (D-22, F-36).
export const KEY_SOURCES = ['auto', 'manual'] as const;
export type KeySource = (typeof KEY_SOURCES)[number];

export const SAVE_DETECTION_SOURCES = ['auto', 'manual'] as const;
export type SaveDetectionSource = (typeof SAVE_DETECTION_SOURCES)[number];

export const RELEASE_DATE_PRECISIONS = ['year', 'month', 'day'] as const;
export type ReleaseDatePrecision = (typeof RELEASE_DATE_PRECISIONS)[number];

// Precisión de una fecha de dominio (sesiones, gastos).
export const DATE_PRECISIONS = ['year', 'month', 'day', 'datetime'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

// Los eventos de estado añaden `unknown`: sustituye a la heurística de "cae a
// menos de 5 s del alta" (§7.5), que solo aplicará el importador.
export const STATE_EVENT_DATE_PRECISIONS = [...DATE_PRECISIONS, 'unknown'] as const;
export type StateEventDatePrecision = (typeof STATE_EVENT_DATE_PRECISIONS)[number];

export const EXTERNAL_CHECK_SOURCES = [
  'igdb',
  'igdb_ratings',
  'steam_appid',
  'steam_store',
  'steam_achievements',
  'steam_unlocks',
  'ra_match',
  'ra_achievements',
  'hltb',
  'sgdb',
  'curiosities',
] as const;
export type ExternalCheckSource = (typeof EXTERNAL_CHECK_SOURCES)[number];

// `empty` = la fuente respondió que no tiene nada; es una respuesta, no un fallo.
export const CHECK_STATUSES = ['ok', 'empty', 'error'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const PLAYTHROUGH_FORMATS = ['digital', 'physical'] as const;
export type PlaythroughFormat = (typeof PLAYTHROUGH_FORMATS)[number];

// `plan_to_play` desaparece como tipo: lo cubre `plan_entries` (F-12).
export const STATE_EVENT_TYPES = ['started', 'completed', 'dropped', 'on_hold', 'resting'] as const;
export type StateEventType = (typeof STATE_EVENT_TYPES)[number];

export const SESSION_STARTED_BY = ['watcher', 'play', 'timer'] as const;
export type SessionStartedBy = (typeof SESSION_STARTED_BY)[number];

// Sustituye a `isManual`. `legacy_manual` solo lo escribe el importador.
export const SESSION_SOURCES = ['measured', 'legacy_manual'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

export const SESSION_CLOSED_BY = ['owner', 'janitor', 'user'] as const;
export type SessionClosedBy = (typeof SESSION_CLOSED_BY)[number];

export const SPEND_TYPES = ['purchase', 'ingame_spend'] as const;
export type SpendType = (typeof SPEND_TYPES)[number];

export const ACHIEVEMENT_SOURCES = ['steam', 'ra'] as const;
export type AchievementSource = (typeof ACHIEVEMENT_SOURCES)[number];

// Quién atestigua un desbloqueo. Cada PC escribe su propia fila `emu@<su id>`
// en vez de reescribir una compartida en cada arranque (F-35).
export type UnlockOrigin = 'steam' | 'ra' | `emu@${string}`;

export const MEMORY_SCOPE_TYPES = ['month', 'year'] as const;
export type MemoryScopeType = (typeof MEMORY_SCOPE_TYPES)[number];

// ── Tipos de las columnas JSON ──────────────────────────────────────────────

// Forma compacta de los relojes por columna (§7.3): solo las columnas cuyo
// reloj es distinto de `syncCreated`.
export type SyncFields = Record<string, string>;

export type IgdbCollection = { id: number; name: string };
export type SteamTag = { name: string; votes: number };

// Un logro del catálogo. Son las columnas de la tabla `achievements` de la 1.x,
// ahora dentro del JSON de `achievement_catalogs.items` (§7.4).
export type AchievementCatalogItem = {
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  iconGrayUrl: string | null;
  hidden: boolean;
  globalPercent: number | null;
  sortIndex: number;
};

// ── Columnas comunes de sincronización (§7.3) ───────────────────────────────

// Definidas UNA vez: toda tabla sincronizada se crea con `syncedTable`, que
// las añade junto a su índice parcial de pendientes. Así no pueden divergir,
// y el test-barrera (§8.6) comprueba que ninguna tabla se las salte.
//
// `syncSeq` (§7.3) NO está aquí: es una columna del hub, que además no declara
// claves foráneas (§7.7) y tendrá su propia definición en la fase 3.
//
// Es una función (y no un objeto compartido) para que cada tabla reciba sus
// propios constructores de columna. Su tipo es el que infiere Drizzle; escribirlo
// a mano duplicaría sus tipos internos.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const syncColumns = () => ({
  // La clave primaria se declara en `syncedTable` (ver `textPrimaryKey`).
  id: text().notNull(),
  // Reloj (§8.2) de la creación más antigua conocida de la fila.
  syncCreated: text().notNull(),
  // El mayor reloj de la fila: sirve para ordenar y para saber si cambió.
  syncUpdated: text().notNull(),
  syncFields: text({ mode: 'json' }).$type<SyncFields>().notNull().default({}),
  // Reloj de la lápida; null = viva. Las lápidas no se purgan (D-25).
  syncDeleted: text(),
  // Solo local: pendiente de subir. Nunca viaja.
  syncDirty: int({ mode: 'boolean' }).notNull().default(false),
});

type SyncColumns = ReturnType<typeof syncColumns>;

// SQLite admite NULL en una PRIMARY KEY que no sea INTEGER (una rareza que
// mantiene por compatibilidad), y drizzle-kit descarta el `.notNull()` de una
// columna marcada con `.primaryKey()`. Declarando la clave como restricción de
// tabla sobre una columna NOT NULL, la migración sale `PRIMARY KEY NOT NULL`.
const textPrimaryKey = (column: AnySQLiteColumn): PrimaryKeyBuilder =>
  primaryKey({ columns: [column] });

// Lo que devuelve `sqliteTable` para un nombre y unas columnas dadas.
type TableOf<
  TName extends string,
  TColumns extends Record<string, ColumnBuilderBase>,
> = SQLiteTableWithColumns<{
  name: TName;
  schema: undefined;
  columns: BuildColumns<TName, TColumns, 'sqlite'>;
  dialect: 'sqlite';
}>;

// Nombres de las columnas comunes, para el registro y los tests.
export const SYNC_COLUMN_NAMES = Object.keys(syncColumns()) as (keyof SyncColumns)[];

const syncedTable = <TName extends string, TColumns extends Record<string, ColumnBuilderBase>>(
  name: TName,
  columns: TColumns,
  extraConfig?: (
    table: BuildColumns<TName, SyncColumns & TColumns, 'sqlite'>,
  ) => SQLiteTableExtraConfigValue[],
): TableOf<TName, SyncColumns & TColumns> => {
  // Las columnas propias no pueden reutilizar un nombre de las comunes (el
  // tipo no lo puede expresar sin colapsar la intersección a `never`).
  const clash = SYNC_COLUMN_NAMES.filter((column) => column in columns);
  if (clash.length > 0) {
    throw new Error(`${name}: columnas reservadas para el sync: ${clash.join(', ')}`);
  }
  return sqliteTable(name, { ...syncColumns(), ...columns }, (table) => [
    textPrimaryKey(table.id),
    // Parcial (§7.8): el motor pregunta "¿qué hay pendiente?" en cada ciclo, y
    // con el índice solo cuestan las filas sucias, no la base entera.
    index(`${name}_sync_dirty_idx`)
      .on(table.syncDirty)
      .where(sql`"syncDirty" = 1`),
    ...(extraConfig?.(table) ?? []),
  ]);
};

// Las tablas locales (clase L, §7.6) llevan el prefijo `local_` en el nombre:
// es lo que las distingue a simple vista y lo que comprueba el test-barrera.
const localTable = <
  TName extends `local_${string}`,
  TColumns extends Record<string, ColumnBuilderBase>,
>(
  name: TName,
  columns: TColumns,
  extraConfig?: (table: BuildColumns<TName, TColumns, 'sqlite'>) => SQLiteTableExtraConfigValue[],
): TableOf<TName, TColumns> => sqliteTable(name, columns, extraConfig);

// ── Tablas sincronizadas (§7.4) ─────────────────────────────────────────────

// `devices` (U). El id es el `machineId` que ya existe en machine-saves.json y
// en los prefijos del bucket (D-11). Hay dos especiales por inquilino: `web`
// (lo que se hace desde el móvil) y `legacy` (dueño de lo migrado de la 1.x).
// Un dispositivo no se borra nunca: darlo de baja es `revokedAt` (ver el
// registro), porque sus sesiones y backups siguen siendo del usuario.
export const devices = syncedTable('devices', {
  name: text().notNull(),
  kind: text({ enum: DEVICE_KINDS }).notNull(),
  os: text({ enum: DEVICE_OSES }).notNull(),
  // Carpeta de usuario: genera los redirects al restaurar partidas en otro PC
  // (sustituye a `save_backups.machineHome`). Null en `web` y `legacy`.
  home: text(),
  appVersion: text(),
  schemaVersion: int(),
  firstSeenAt: int({ mode: 'timestamp_ms' }).notNull(),
  // Como mucho una vez al día, para no generar ruido de sync.
  lastSeenAt: int({ mode: 'timestamp_ms' }),
  revokedAt: int({ mode: 'timestamp_ms' }),
  // Valor aleatorio propio de cada instalación (§12.6, F-24). Si al arrancar
  // el publicado no es el suyo, otra instalación usa el mismo id y se
  // bloquean la poda y los backups. §7.4 no lo lista en `devices`, pero §12.6
  // dice que se publica aquí.
  installNonce: text(),
});

// `games` (U): identidad y lo que decide el usuario. La caché externa se fue a
// `game_metadata` y `external_checks`, las rutas a `game_installs`, el plan a
// `plan_entries` y las curiosidades a `game_curiosities`.
export const games = syncedTable(
  'games',
  {
    title: text().notNull(),
    // Claves hacia las fuentes externas: indexadas, NO únicas (§7.2). Un juego
    // dado de alta sin igdbId que luego lo gana puede coexistir con el mismo
    // juego añadido por IGDB en otro PC; la interfaz ofrece fusionarlos.
    igdbId: int(),
    steamAppId: int(),
    raGameId: int(),
    sgdbId: int(),
    // Null mientras la clave correspondiente sea null.
    steamAppIdSource: text({ enum: KEY_SOURCES }),
    sgdbIdSource: text({ enum: KEY_SOURCES }),
    // Lo fijado a mano (D-22). Null = usar el valor de `game_metadata`. El
    // refresco nunca escribe aquí y el usuario nunca escribe en la caché, así
    // que ninguno pisa al otro.
    coverOverride: text(),
    heroOverride: text(),
    developerOverride: text(),
    publisherOverride: text(),
    genresOverride: text({ mode: 'json' }).$type<string[]>(),
    notes: text(),
    endless: int({ mode: 'boolean' }).notNull().default(false),
    // Se juega a través de un emulador: lo vigilado es el emulador.
    isEmulated: int({ mode: 'boolean' }).notNull().default(false),
    addedAt: int({ mode: 'timestamp_ms' }).notNull(),
    // Se conserva mientras exista la heurística de §7.5.
    promotedAt: int({ mode: 'timestamp_ms' }),
    // Capa portable de las partidas guardadas, como en la 1.x. Opt-in.
    saveBackupEnabled: int({ mode: 'boolean' }).notNull().default(false),
    saveDetectionSource: text({ enum: SAVE_DETECTION_SOURCES }),
    saveLudusaviName: text(),
    // Solo en modo manual, y siempre tokenizadas: nunca una ruta resuelta.
    saveCustomPaths: text({ mode: 'json' }).$type<string[]>(),
    // Prefijo del juego en el bucket: `igdbId` si existe, si no el `id`. Se
    // guarda (no se deriva) para que no cambie si el juego gana igdbId más
    // tarde y sus backups siguen bajo el prefijo antiguo (§12.7).
    saveKey: text(),
  },
  (t) => [
    index('games_igdb_id_idx').on(t.igdbId),
    index('games_steam_app_id_idx').on(t.steamAppId),
    index('games_ra_game_id_idx').on(t.raGameId),
    index('games_sgdb_id_idx').on(t.sgdbId),
  ],
);

// `game_metadata` (C): una fila por juego, id = gameId. Solo la escribe el
// refresco y solo los campos cuyo valor cambia (F-33).
//
// Lleva `gameId` además del id, aunque coincidan, para que todas las tablas
// "de un juego" se unan a `games` por la misma columna y su clave foránea se
// declare igual que en las demás.
export const gameMetadata = syncedTable('game_metadata', {
  gameId: text()
    .notNull()
    .references(() => games.id),
  coverUrl: text(),
  heroUrl: text(),
  officialPlatforms: text({ mode: 'json' }).$type<string[]>(),
  genres: text({ mode: 'json' }).$type<string[]>(),
  developer: text(),
  publisher: text(),
  // De él dependen las estadísticas y el emparejado con HowLongToBeat; las
  // dos siguientes son solo de presentación.
  releaseYear: int(),
  releaseDate: int({ mode: 'timestamp_ms' }),
  releaseDatePrecision: text({ enum: RELEASE_DATE_PRECISIONS }),
  // La sinopsis de IGDB (`summary`, nunca `storyline`: lleva spoilers).
  summary: text(),
  // Las colecciones de IGDB, en plural: un juego pertenece a varias líneas de
  // serie y el radar las necesita todas.
  igdbCollections: text({ mode: 'json' }).$type<IgdbCollection[]>(),
  hltbMain: real(),
  hltbMainExtras: real(),
  hltbCompletionist: real(),
  // Crítica y comunidad de IGDB, separadas a propósito.
  ratingCritics: real(),
  ratingCriticsCount: int(),
  ratingUsers: real(),
  ratingUsersCount: int(),
  steamTags: text({ mode: 'json' }).$type<SteamTag[]>(),
  // Reseñas crudas: el porcentaje se calcula al pintar.
  steamPositive: int(),
  steamNegative: int(),
});

// `external_checks` (C): una fila por juego y fuente, id `<gameId>:<source>`.
// Sustituye a las ocho variantes de `…CheckedAt`/`…SyncedAt` de la 1.x (F-34).
// La política de cada fuente vive en código; aquí solo el resultado.
export const externalChecks = syncedTable(
  'external_checks',
  {
    gameId: text()
      .notNull()
      .references(() => games.id),
    source: text({ enum: EXTERNAL_CHECK_SOURCES }).notNull(),
    status: text({ enum: CHECK_STATUSES }).notNull(),
    checkedAt: int({ mode: 'timestamp_ms' }).notNull(),
    // Cuándo volver a preguntar. Null = solo a mano.
    nextCheckAt: int({ mode: 'timestamp_ms' }),
    error: text(),
  },
  (t) => [
    // La pregunta del planificador: "¿qué toca ahora en esta fuente?" (§7.8).
    index('external_checks_source_next_idx').on(t.source, t.nextCheckAt),
    index('external_checks_game_idx').on(t.gameId),
  ],
);

// `game_installs` (O): dónde está instalado un juego en cada dispositivo, id
// `<gameId>:<deviceId>`. Solo el dueño escribe su fila; sincroniza para que la
// ficha diga "instalado en PC-A y PC-B". El watcher solo lee las suyas (§11,
// F-06). Las rutas nunca se interpretan fuera de su dispositivo (D-14).
export const gameInstalls = syncedTable(
  'game_installs',
  {
    gameId: text()
      .notNull()
      .references(() => games.id),
    deviceId: text()
      .notNull()
      .references(() => devices.id),
    executablePath: text(),
    installDirectory: text(),
    // Se calcula al elegir la carpeta, no en cada carga de la ficha.
    installSizeBytes: int(),
    // Última vez que este PC comprobó que la ruta existe. Si deja de existir
    // la fila no se borra: se queda como no verificada (§11.3).
    lastVerifiedAt: int({ mode: 'timestamp_ms' }),
  },
  (t) => [
    index('game_installs_device_idx').on(t.deviceId),
    index('game_installs_game_idx').on(t.gameId),
  ],
);

// `emulators` (U): la herramienta, sin ruta. La ruta es de cada dispositivo.
export const emulators = syncedTable('emulators', {
  name: text().notNull(),
});

// `emulator_installs` (O): id `<emulatorId>:<deviceId>`. Mismo papel que
// `game_installs` para los emuladores.
export const emulatorInstalls = syncedTable(
  'emulator_installs',
  {
    emulatorId: text()
      .notNull()
      .references(() => emulators.id),
    deviceId: text()
      .notNull()
      .references(() => devices.id),
    executablePath: text().notNull(),
  },
  (t) => [
    index('emulator_installs_emulator_idx').on(t.emulatorId),
    index('emulator_installs_device_idx').on(t.deviceId),
  ],
);

// `plan_entries` (U): una fila por juego planeado, id = gameId. Sustituye a
// `games.planned`, a la iteración vacía y al evento `plan_to_play` (F-12). Un
// juego está planeado si tiene una fila viva; promocionarlo pone la lápida y
// fija `games.promotedAt`.
export const planEntries = syncedTable('plan_entries', {
  gameId: text()
    .notNull()
    .references(() => games.id),
  plannedAt: int({ mode: 'timestamp_ms' }).notNull(),
  // "Up next". Null = cola normal.
  pinnedAt: int({ mode: 'timestamp_ms' }),
  // Orden fraccionario en texto: mover un elemento escribe una sola fila.
  sortKey: text(),
  note: text(),
});

// `playthroughs` (U), antes `iterations`. La etiqueta "Playthrough N" deja de
// guardarse: N es la posición por `syncCreated` dentro del juego, así dos PCs
// que crean "el segundo" no producen dos "Playthrough 2".
export const playthroughs = syncedTable(
  'playthroughs',
  {
    gameId: text()
      .notNull()
      .references(() => games.id),
    // Null = etiqueta automática.
    customLabel: text(),
    playedPlatform: text().notNull(),
    origin: text().notNull(),
    format: text({ enum: PLAYTHROUGH_FORMATS }),
    // Antes `manualTotalPlayed`. Un solo significado: horas no medidas que se
    // SUMAN a las sesiones (§7.5).
    manualHours: real(),
    // 1-5, validado en TypeScript.
    rating: int().$type<1 | 2 | 3 | 4 | 5>(),
    extraContent: int({ mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('playthroughs_game_idx').on(t.gameId)],
);

// `state_events` (U): el historial de estado de un playthrough. Los empates de
// `occurredAt` se deshacen por `syncCreated`, no por el id (F-09).
export const stateEvents = syncedTable(
  'state_events',
  {
    playthroughId: text()
      .notNull()
      .references(() => playthroughs.id),
    type: text({ enum: STATE_EVENT_TYPES }).notNull(),
    occurredAt: int({ mode: 'timestamp_ms' }).notNull(),
    datePrecision: text({ enum: STATE_EVENT_DATE_PRECISIONS }).notNull(),
    note: text(),
    // Informativo: dónde se registró. Null en lo importado de la 1.x.
    deviceId: text().references(() => devices.id),
  },
  (t) => [index('state_events_playthrough_idx').on(t.playthroughId)],
);

// `sessions` (O): tiempo jugado. Su dueño es `deviceId`, y solo el dueño la
// adopta, la late y la cierra (§10.1, F-01 a F-03). Quién puede escribir cada
// campo lo decide la puerta de escritura (§7.4).
//
// La regla "como mucho una sesión abierta por dispositivo y objetivo" de §7.7
// NO es un índice único a propósito: no se puede desactivar durante la
// descarga y una fila ajena que la violara atascaría el sync para siempre
// (como el agujero H-4). La impone la puerta de escritura al abrir sesiones
// propias, y la lectura tolera el caso si llega por sync.
export const sessions = syncedTable(
  'sessions',
  {
    // Null = sesión de emulador todavía sin asignar a un juego.
    playthroughId: text().references(() => playthroughs.id),
    // Qué emulador la generó; se queda puesto tras asignarla.
    emulatorId: text().references(() => emulators.id),
    // Obligatorio: dónde se jugó y quién es el dueño.
    deviceId: text()
      .notNull()
      .references(() => devices.id),
    startedBy: text({ enum: SESSION_STARTED_BY }).notNull(),
    source: text({ enum: SESSION_SOURCES }).notNull().default('measured'),
    startedAt: int({ mode: 'timestamp_ms' }).notNull(),
    endedAt: int({ mode: 'timestamp_ms' }),
    durationSec: int(),
    datePrecision: text({ enum: DATE_PRECISIONS }).notNull(),
    // Señal de vida para LOS DEMÁS, como mucho cada 60 s (§10.3). El latido
    // de 5 s es local y vive en `local_session_beats`.
    lastSeenAt: int({ mode: 'timestamp_ms' }),
    // Quién la cerró (§10.5). Null mientras está abierta.
    closedBy: text({ enum: SESSION_CLOSED_BY }),
    note: text(),
  },
  (t) => [
    index('sessions_playthrough_idx').on(t.playthroughId),
    index('sessions_device_ended_idx').on(t.deviceId, t.endedAt),
    index('sessions_emulator_idx').on(t.emulatorId),
    index('sessions_started_idx').on(t.startedAt),
    // §7.7. Es un CHECK y no otra cosa porque se puede desactivar con
    // `PRAGMA ignore_check_constraints` durante la descarga.
    check('sessions_target_check', sql`"playthroughId" IS NOT NULL OR "emulatorId" IS NOT NULL`),
  ],
);

// `spend_events` (U). Cada gasto guarda su moneda aunque la interfaz use una
// sola (D-23).
export const spendEvents = syncedTable(
  'spend_events',
  {
    gameId: text()
      .notNull()
      .references(() => games.id),
    // Opcional. Null = repartir por fecha, como en la 1.x.
    playthroughId: text().references(() => playthroughs.id),
    type: text({ enum: SPEND_TYPES }).notNull(),
    amount: real().notNull(),
    currency: text().notNull(),
    occurredAt: int({ mode: 'timestamp_ms' }).notNull(),
    datePrecision: text({ enum: DATE_PRECISIONS }).notNull(),
    note: text(),
  },
  (t) => [
    index('spend_events_game_idx').on(t.gameId),
    index('spend_events_playthrough_idx').on(t.playthroughId),
  ],
);

// `achievement_catalogs` (C), antes `achievements`: una fila por juego y
// fuente con el catálogo entero en JSON, id `<gameId>:<source>`. Fila a fila
// serían ~162.000 escrituras en el hub para sembrar; agrupado, ~1.800 (§7.4).
export const achievementCatalogs = syncedTable(
  'achievement_catalogs',
  {
    gameId: text()
      .notNull()
      .references(() => games.id),
    source: text({ enum: ACHIEVEMENT_SOURCES }).notNull(),
    items: text({ mode: 'json' }).$type<AchievementCatalogItem[]>().notNull().default([]),
    fetchedAt: int({ mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('achievement_catalogs_game_idx').on(t.gameId)],
);

// `achievement_unlocks` (U): un hecho con origen, id
// `<gameId>:<source>:<apiName>:<origin>`. Se enlaza con su logro por
// (gameId, source, apiName), no por un id de fila del catálogo. La lectura
// funde los orígenes quedándose con la fecha más temprana.
export const achievementUnlocks = syncedTable(
  'achievement_unlocks',
  {
    gameId: text()
      .notNull()
      .references(() => games.id),
    source: text({ enum: ACHIEVEMENT_SOURCES }).notNull(),
    apiName: text().notNull(),
    origin: text().$type<UnlockOrigin>().notNull(),
    unlockedAt: int({ mode: 'timestamp_ms' }).notNull(),
    // False cuando la fecha es la de un rescate y no la de la hazaña (un
    // emulador que vuelve a sellar de golpe lo que ya tenías).
    dateReliable: int({ mode: 'boolean' }).notNull().default(true),
    // Dónde cayó, si se sabe. Borrar la sesión o el playthrough no borra el
    // hecho de haberlo sacado (ver el registro).
    playthroughId: text().references(() => playthroughs.id),
    sessionId: text().references(() => sessions.id),
  },
  (t) => [
    index('achievement_unlocks_game_idx').on(t.gameId),
    index('achievement_unlocks_session_idx').on(t.sessionId),
    index('achievement_unlocks_playthrough_idx').on(t.playthroughId),
  ],
);

// `save_backups` (O): el índice de las partidas subidas al bucket, id =
// UUIDv5 de `r2Key`. Al derivarse de la clave del objeto, reconstruirlo desde
// el bucket no puede duplicar filas (F-21).
export const saveBackups = syncedTable(
  'save_backups',
  {
    gameId: text()
      .notNull()
      .references(() => games.id),
    // Sustituye a `machineId`; el nombre y la carpeta de usuario salen de
    // `devices`.
    deviceId: text()
      .notNull()
      .references(() => devices.id),
    // Nombre del zip de ludusavi: id de la versión para `restore --backup`.
    backupName: text().notNull(),
    r2Key: text().notNull(),
    sizeBytes: int().notNull().default(0),
    ludusaviName: text().notNull(),
    // Un diferencial necesita el completo del que cuelga.
    differential: int({ mode: 'boolean' }).notNull().default(false),
    parentBackupName: text(),
    // Ubicaciones que cubre, ya derivadas: el selector de destino no descarga
    // nada para preguntar dónde restaurar.
    locations: text({ mode: 'json' }).$type<string[]>(),
    hasRegistry: int({ mode: 'boolean' }).notNull().default(false),
    createdAt: int({ mode: 'timestamp_ms' }).notNull(),
    // Huella del contenido, independiente de máquina y hora (§12.2).
    contentHash: text(),
    // Huella del estado del que partía este PC (§12.3). Null en lo que viene
    // de la 1.x: sin ese eslabón no se afirma divergencia (§12.4).
    parentContentHash: text(),
  },
  (t) => [index('save_backups_game_idx').on(t.gameId)],
);

// `game_curiosities` (C): una fila por juego, id = gameId. Sustituye a la
// tabla `curiosities` y a `games.curiositiesGeneratedAt`. Regenerar es
// escribir encima.
export const gameCuriosities = syncedTable('game_curiosities', {
  gameId: text()
    .notNull()
    .references(() => games.id),
  // Las curiosidades, en orden. Una lista vacía también es una respuesta:
  // evita volver a pagar la pregunta.
  items: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
  generatedAt: int({ mode: 'timestamp_ms' }).notNull(),
  // Null en lo importado: la 1.x no guardaba con qué modelo se generaron.
  model: text(),
});

// `generated_memories` (C): recaps del Loop, id `<scopeType>:<scopeKey>`. Las
// columnas son las de la 1.x; el UNIQUE (scopeType, scopeKey) desaparece
// porque ya lo garantiza el id.
export const generatedMemories = syncedTable('generated_memories', {
  scopeType: text({ enum: MEMORY_SCOPE_TYPES }).notNull(),
  // '2026-06' para meses, '2026' para años.
  scopeKey: text().notNull(),
  payload: text({ mode: 'json' }).$type<RecapPayload>().notNull(),
  // SHA-256 de los hechos del capítulo: missing / stale / current.
  sourceHash: text().notNull(),
  model: text().notNull(),
  promptVersion: int().notNull(),
  createdAt: int({ mode: 'timestamp_ms' }).notNull(),
});

// `radar_games` (C): secuelas anunciadas de sagas tuyas, id `igdb:<igdbId>`.
// Columnas de la 1.x; el UNIQUE sobre igdbId lo garantiza ahora el id.
// `dismissedAt` es dato del usuario y se fusiona por campo como cualquier otro.
export const radarGames = syncedTable('radar_games', {
  igdbId: int().notNull(),
  // De qué saga tuya viene.
  collectionId: int(),
  collectionName: text(),
  title: text().notNull(),
  coverUrl: text(),
  releaseDate: int({ mode: 'timestamp_ms' }),
  releaseDatePrecision: text({ enum: RELEASE_DATE_PRECISIONS }),
  releaseYear: int(),
  discoveredAt: int({ mode: 'timestamp_ms' }).notNull(),
  // El descarte es para siempre, hasta que se deshace a mano.
  dismissedAt: int({ mode: 'timestamp_ms' }),
});

// ── Tablas locales (clase L, §7.6) ──────────────────────────────────────────
//
// Hechos de este PC que no interesan a los demás. Ni columnas de sync ni
// claves foráneas: no viajan, son de mantenimiento y no deben poder hacer
// fallar una descarga ni el importador. Llevan las columnas mínimas que pide
// §7.6; las fases que las usen las ajustarán.

// Latido local de 5 s de las sesiones propias abiertas (§10.3, F-05): tras un
// corte de luz, el dueño cierra la sesión en el último latido. Una fila por
// sesión con el último latido, no un registro de todos.
export const localSessionBeats = localTable(
  'local_session_beats',
  {
    sessionId: text().notNull(),
    beatAt: int({ mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [textPrimaryKey(t.sessionId)],
);

// Estado del motor de sync (§8.5). Una sola fila (id = 1).
export const localSyncState = localTable(
  'local_sync_state',
  {
    id: int().primaryKey(),
    // Cursor de descarga: la `syncSeq` del hub hasta la que se ha bajado.
    pullCursor: int().notNull().default(0),
    lastPushAt: int({ mode: 'timestamp_ms' }),
    lastPullAt: int({ mode: 'timestamp_ms' }),
    lastError: text(),
    lastErrorAt: int({ mode: 'timestamp_ms' }),
    protocolVersion: int(),
    // Id corto con el que firma su reloj este dispositivo (§8.2): 6
    // caracteres `[0-9a-z]`, nunca `000000` (reservado al barrido del hub).
    // Lo asignará el hub al emparejar (fase 3) para que no coincidan dos;
    // hasta entonces `openLocalDatabase` lo sortea la primera vez y lo guarda
    // aquí. Tiene que sobrevivir a los reinicios: si cambiase en cada arranque
    // no pasaría nada grave, pero el mismo PC firmaría con ids distintos y el
    // desempate de §8.2 dejaría de ser estable para sus propias escrituras.
    shortDeviceId: text(),
    // El `deviceId` (machineId) para el que se sorteó `shortDeviceId`.
    // Revisión, hallazgo 6: el id corto vive en la base y no en el PC; si se
    // copia `Afterplay2.db` a otro PC (estrenar equipo, restaurar una copia),
    // los dos firmarían con el mismo id corto y el desempate de §8.2 dejaría
    // de distinguirlos. Si quien abre la base no es este dispositivo, se
    // sortea otro.
    shortDeviceIdFor: text(),
  },
  () => [check('local_sync_state_single_row', sql`"id" = 1`)],
);

// Estado de partidas por juego en este PC.
export const localSaveState = localTable(
  'local_save_state',
  {
    gameId: text().notNull(),
    // Huella de la última partida que este PC subió o restauró (§12.3).
    lastSyncedHash: text(),
    // Ubicación elegida para restaurar en este PC (en la 1.x,
    // `saveLocationOverrides` de machine-saves.json).
    restoreTarget: text(),
    restoreTargetSetAt: int({ mode: 'timestamp_ms' }),
  },
  (t) => [textPrimaryKey(t.gameId)],
);

// Lectura de los ficheros de emuladores de Steam en este PC, por juego. Su
// estado es local porque depende de ficheros de este disco (§7.4,
// `external_checks`).
export const localEmuState = localTable(
  'local_emu_state',
  {
    gameId: text().notNull(),
    checkedAt: int({ mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: CHECK_STATUSES }).notNull(),
    error: text(),
  },
  (t) => [textPrimaryKey(t.gameId)],
);

// Mapa id 1.x → id 2.0 que deja el importador (§19.5): para enlaces antiguos y
// para remapear ficheros locales indexados por id antiguo.
export const localLegacyIds = localTable(
  'local_legacy_ids',
  {
    // Nombre de la tabla en la 1.x (`iterations`, no `playthroughs`).
    legacyTable: text().notNull(),
    // Los ids de la 1.x son enteros autoincrementales.
    legacyId: int().notNull(),
    newId: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.legacyTable, t.legacyId] })],
);

// Últimas ejecuciones locales de los trabajos de fondo (§14).
export const localJobState = localTable(
  'local_job_state',
  {
    job: text().notNull(),
    lastRunAt: int({ mode: 'timestamp_ms' }),
    lastOkAt: int({ mode: 'timestamp_ms' }),
    lastError: text(),
  },
  (t) => [textPrimaryKey(t.job)],
);

// ── Tipos de fila ───────────────────────────────────────────────────────────

export type DeviceRow = typeof devices.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GameMetadataRow = typeof gameMetadata.$inferSelect;
export type ExternalCheckRow = typeof externalChecks.$inferSelect;
export type GameInstallRow = typeof gameInstalls.$inferSelect;
export type EmulatorRow = typeof emulators.$inferSelect;
export type EmulatorInstallRow = typeof emulatorInstalls.$inferSelect;
export type PlanEntryRow = typeof planEntries.$inferSelect;
export type PlaythroughRow = typeof playthroughs.$inferSelect;
export type StateEventRow = typeof stateEvents.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SpendEventRow = typeof spendEvents.$inferSelect;
export type AchievementCatalogRow = typeof achievementCatalogs.$inferSelect;
export type AchievementUnlockRow = typeof achievementUnlocks.$inferSelect;
export type SaveBackupRow = typeof saveBackups.$inferSelect;
export type GameCuriositiesRow = typeof gameCuriosities.$inferSelect;
export type GeneratedMemoryRow = typeof generatedMemories.$inferSelect;
export type RadarGameRow = typeof radarGames.$inferSelect;

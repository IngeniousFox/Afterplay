import { int, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { RecapPayload } from '../../shared/memory/payload';

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
export type Emulator = typeof emulatorsTable.$inferSelect;
export type SaveBackupRow = typeof saveBackupsTable.$inferSelect;
export type CuriosityRow = typeof curiositiesTable.$inferSelect;
export type GeneratedMemoryRow = typeof generatedMemoriesTable.$inferSelect;
export type AchievementRow = typeof achievementsTable.$inferSelect;
export type AchievementUnlockRow = typeof achievementUnlocksTable.$inferSelect;

// Formas de INSERT ($inferInsert): distintas de las de SELECT — aquí id y las
// columnas con default son opcionales. Son la base de los inputs de los
// handlers de crear/editar que expone shared/types.ts.
export type NewGame = typeof gamesTable.$inferInsert;
export type NewSession = typeof sessionsTable.$inferInsert;
export type NewIteration = typeof iterationsTable.$inferInsert;
export type NewStateEvent = typeof stateEventsTable.$inferInsert;
export type NewSpendEvent = typeof spendEventsTable.$inferInsert;
export type NewEmulator = typeof emulatorsTable.$inferInsert;
export type NewSaveBackup = typeof saveBackupsTable.$inferInsert;
export type NewCuriosity = typeof curiositiesTable.$inferInsert;
export type NewGeneratedMemory = typeof generatedMemoriesTable.$inferInsert;
export type NewAchievement = typeof achievementsTable.$inferInsert;
export type NewAchievementUnlock = typeof achievementUnlocksTable.$inferInsert;

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
  // EMULADORES.md §5 — este juego se juega vía emulador, no tiene .exe
  // propio que vigilar (lo vigilado es el emulador). Flag a nivel de JUEGO
  // a propósito (y no derivado de iteration.playedPlatform === 'Emulated'):
  // cubre juegos unplayed sin iteración con plataforma aún, y solo alimenta
  // el filtro del modal de asignación, no las stats.
  isEmulated: int({ mode: 'boolean' }).notNull().default(false),
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
  // ── Partidas guardadas (PARTIDAS-GUARDADAS.md §7.1) ──────────────────
  // Capa PORTABLE: lo único de esta función que puede viajar entre PCs. Todo
  // lo que sea un hecho sobre una máquina concreta (dónde está instalado el
  // juego aquí, dónde restaurar) vive en machine-saves.json, fuera de la BD.
  // Opt-in explícito: subir partidas a un bucket es mover datos personales a
  // un servicio externo y eso no se hace por defecto (§10.5).
  saveBackupEnabled: int({ mode: 'boolean' }).notNull().default(false),
  saveDetectionSource: text({ enum: ['auto', 'manual'] }),
  // Nombre con el que ludusavi conoce el juego — evita re-emparejar por
  // título en cada operación. Es machine-independiente (sale del manifest,
  // igual en todos los PCs), por eso sí sincroniza.
  saveLudusaviName: text(),
  // Solo en modo 'manual': rutas TOKENIZADAS (<winAppData>/... , ver
  // saves/paths.ts). En modo 'auto' es null a propósito — guardar la ruta ya
  // resuelta sería justo el error que crea el problema entre PCs.
  saveCustomPaths: text({ mode: 'json' }).$type<string[]>(),
  // Curiosidades del modo ambiente: cuándo se generaron (main/curiosities).
  // Null = pendiente. Se marca TAMBIÉN cuando la generación devuelve cero
  // curiosidades — "una llamada por juego en la vida" incluye ese caso: mejor
  // un juego callado que repagarle la pregunta a la API en cada backfill.
  curiositiesGeneratedAt: int({ mode: 'timestamp_ms' }),
  // ── Logros (LOGROS.md) ───────────────────────────────────────────────────
  // El appid de Steam de este juego — el puente hacia todo el mundo Steam:
  // el schema de logros, tus desbloqueos por API, los ficheros de los
  // emuladores de Steam. Sale de IGDB (external_games) al crear el juego y
  // de un backfill para los que ya existían; null = no está en Steam (juegos
  // de consola emulados, por ejemplo). Sin UNIQUE a propósito: dos fichas de
  // IGDB (juego y edición) pueden apuntar al mismo appid.
  steamAppId: int(),
  // Cuándo se le preguntó a IGDB por el appid, haya salido o no — misma
  // convención que curiositiesGeneratedAt: null = pendiente (el backfill lo
  // reintentará), con fecha = preguntado, aunque la respuesta fuera "no está
  // en Steam". Sin esto, los ~cientos de juegos sin appid se repreguntarían
  // en cada arranque.
  steamAppIdCheckedAt: int({ mode: 'timestamp_ms' }),
  // Cuándo se trajo por última vez el CATÁLOGO de logros de este juego (los
  // que existen, no los tuyos). Misma convención: se marca aunque el juego no
  // tenga ninguno — hay juegos en Steam sin logros, y eso es una respuesta.
  achievementsSyncedAt: int({ mode: 'timestamp_ms' }),
  // Y cuándo se leyeron TUS desbloqueos de la API de Steam. Separado del
  // anterior a propósito: el catálogo no cambia casi nunca (se pide una vez),
  // pero tus desbloqueos cambian cada vez que juegas.
  achievementsUnlocksSyncedAt: int({ mode: 'timestamp_ms' }),
  // El juego en RetroAchievements (RETROACHIEVEMENTS.md §4-5) — la otra
  // fuente de logros, para lo emulado de consola que Steam no cubre. null =
  // sin emparejar (la consola no está en RA, el juego no tiene set todavía,
  // o el matching no encontró nada con confianza).
  raGameId: int(),
  // Cuándo se intentó el emparejado por última vez, saliera o no. La regla
  // de oro de RETROACHIEVEMENTS.md §6, aprendida con Isaac: ningún "no" de
  // una fuente externa se graba en piedra — se graba CON FECHA y el barrido
  // periódico lo vuelve a preguntar (los sets se publican cada semana).
  raCheckedAt: int({ mode: 'timestamp_ms' }),
  // ── Puntuaciones de IGDB ─────────────────────────────────────────────────
  // Dos números que a propósito NO se funden en uno (decisión de producto:
  // se investigaron Metacritic/RAWG/OpenCritic/MobyGames/Giant Bomb a fondo y
  // se descartaron — sin API pública, sin cobertura retro real, o de pago).
  // ratingCritics es la media de CRÍTICA que IGDB agrega, y solo existe de
  // forma fiable desde que existen agregadores (~2000): un juego de SNES no
  // la tiene. ratingUsers es la nota de la COMUNIDAD de IGDB, y ahí es al
  // revés — los clásicos retro llevan dos décadas acumulando votos, mientras
  // que un juego recién salido puede tener aún pocos. Enseñando los DOS por
  // separado, cada ficha muestra lo que de verdad tiene en vez de un hueco o
  // un número mezclado (total_rating) que ya no dice de quién es la opinión.
  ratingCritics: real(),
  ratingCriticsCount: int(),
  ratingUsers: real(),
  ratingUsersCount: int(),
  // Cuándo se preguntó por última vez — misma convención que
  // steamAppIdCheckedAt: null = nunca (juegos dados de alta antes de esta
  // función), con fecha = ya preguntado, aunque las notas salieran vacías.
  // Sin pasada de fondo que lo vigile: un juego recién salido gana votos
  // cada semana, así que el refresco es manual desde la ficha (RatingsRow).
  ratingsCheckedAt: int({ mode: 'timestamp_ms' }),
});

export const sessionsTable = sqliteTable('sessions', {
  id: int().primaryKey({ autoIncrement: true }),
  // Nullable desde EMULADORES.md §5: una sesión de emulador SIN ASIGNAR
  // todavía no pertenece a ningún playthrough (iterationId null +
  // emulatorId puesto) — vive en la bandeja "Pending" hasta que el usuario
  // la asigna a un juego. Las sesiones normales siguen llevando iterationId
  // SIEMPRE (lo garantiza la capa de app; la DB ya no puede).
  iterationId: int().references(() => iterationsTable.id, { onDelete: 'cascade' }),
  // Qué emulador generó esta sesión — se queda puesto también después de
  // asignarla (registro de origen, útil para stats/filtros futuros). SET
  // NULL y no CASCADE: borrar un emulador no debe llevarse las sesiones ya
  // asignadas a juegos (deleteEmulator limpia las pendientes él mismo).
  emulatorId: int().references(() => emulatorsTable.id, { onDelete: 'set null' }),
  // HISTÓRICO: hoy NINGÚN insert lo pone a true. Solo lo hacía
  // `addManualSession`, la vía de registrar el pasado del modelo v1, y esa
  // desapareció: el pasado ahora se registra como horas manuales en la
  // iteración (manualTotalPlayed), no fabricando sesiones. Las dos únicas
  // vías vivas (watcher/Play y emuladores) escriben false.
  //
  // La columna y los filtros `!isManual` de Stats se quedan por las filas
  // ANTIGUAS, que sí pueden traerlo a true: quitarlos metería sesiones
  // inventadas en el heatmap, las rachas y los histogramas, que solo quieren
  // tiempo medido de verdad. Si alguna vez se confirma que no queda ninguna
  // fila con true, esto se puede borrar entero con su migración.
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
  // Diario de sesión: "dónde lo dejé". Se ofrece al cerrar el juego (toast) y
  // se puede escribir o corregir después desde la propia fila de la sesión —
  // una sesión sin nota no es una tarea pendiente, la nota es opcional
  // siempre. Es lo que hace que volver a un juego tras semanas no empiece por
  // "¿y yo por dónde iba?".
  note: text(),
  // Modelo v2: una sesión es SOLO tiempo jugado real. La columna `milestone`
  // (marcadores de borde de duración 0) y las anclas start/endSessionId de
  // iterations desaparecieron — las fechas de inicio/fin de un playthrough
  // viven en su log de state_events (única fuente de verdad) y se DERIVAN en
  // las queries de lectura (ver getGameById).
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
  // Modelo v2: sin startSessionId/endSessionId — las fechas del playthrough
  // se derivan de sus sesiones y su log de state_events (ver getGameById).
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

// EMULADORES.md §5 — un emulador no es un juego, es una herramienta que el
// watcher vigila con el MISMO mecanismo que un .exe cualquiera (getWatchTargets
// deriva exeName del basename de executablePath, igual que con games).
export const emulatorsTable = sqliteTable('emulators', {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  executablePath: text().notNull(),
});

// PARTIDAS-GUARDADAS.md §7.1 — un registro por versión subida a R2. Es el
// índice que permite contestar "¿qué hay en la nube de este juego?" SIN
// tocar la red: son metadatos ya sincronizados por Turso. Descargar el zip
// solo pasa cuando el usuario pulsa restaurar (§10bis.4).
export const saveBackupsTable = sqliteTable('save_backups', {
  id: int().primaryKey({ autoIncrement: true }),
  gameId: int()
    .notNull()
    .references(() => gamesTable.id, { onDelete: 'cascade' }),
  createdAt: int({ mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  // Nombre del zip tal cual lo generó ludusavi ("backup-2026...Z.zip"): es a
  // la vez el id de la versión para `restore --backup` y el nombre del
  // objeto dentro de su prefijo en R2.
  backupName: text().notNull(),
  r2Key: text().notNull(),
  sizeBytes: int().notNull().default(0),
  ludusaviName: text().notNull(),
  // Un diferencial NO se puede restaurar solo: necesita el completo del que
  // cuelga. Guardarlo aquí evita tener que bajar el mapping.yaml solo para
  // saber qué acompañar (§9.1).
  differential: int({ mode: 'boolean' }).notNull().default(false),
  parentBackupName: text(),
  // Quién lo subió. El nombre es para la vista ("hace 2 días desde PC-Jon"),
  // el id para comparar máquinas.
  machineId: text().notNull(),
  machineName: text().notNull(),
  // El %USERPROFILE% de la máquina que hizo el backup. Es lo que permite
  // generar solo el redirect C:/Users/Lara -> C:/Users/Jon al restaurar en
  // otro PC, sin que el usuario configure nada (§8.2).
  machineHome: text().notNull(),
  // Ubicaciones distintas que cubre esta versión, ya derivadas. Guardarlas
  // aquí es lo que hace que el selector de destino no tenga que descargar
  // nada para preguntar dónde restaurar (§10bis.5).
  locations: text({ mode: 'json' }).$type<string[]>(),
  hasRegistry: int({ mode: 'boolean' }).notNull().default(false),
});

// Curiosidades de juego para el modo ambiente: hechos reales generados UNA
// vez por juego (Wikipedia como contexto + Claude, ver main/curiosities) y
// guardados aquí para siempre — sincronizan por Turso, así que la llamada a
// la API se paga una sola vez entre todas las máquinas.
export const curiositiesTable = sqliteTable('curiosities', {
  id: int().primaryKey({ autoIncrement: true }),
  gameId: int()
    .notNull()
    .references(() => gamesTable.id, { onDelete: 'cascade' }),
  text: text().notNull(),
});

// ── Logros (LOGROS.md) ─────────────────────────────────────────────────────
// El CATÁLOGO: qué logros existen en un juego. Sale del schema público de
// Steam (GetSchemaForGame), que responde para CUALQUIER appid tengas el juego
// o no — así que esto se rellena igual en un juego comprado, uno pirata o uno
// que solo tienes planeado. Es información del juego, no tuya.
export const achievementsTable = sqliteTable(
  'achievements',
  {
    id: int().primaryKey({ autoIncrement: true }),
    gameId: int()
      .notNull()
      .references(() => gamesTable.id, { onDelete: 'cascade' }),
    // El nombre INTERNO del logro ("DREAM_FK"), no el visible. Es la clave
    // con la que hablan todas las fuentes: la API de Steam y los ficheros de
    // los emuladores de Steam usan este mismo identificador.
    apiName: text().notNull(),
    displayName: text().notNull(),
    // Ausente en los logros ocultos — Steam no manda la descripción hasta
    // que lo desbloqueas, y eso es parte de la gracia.
    description: text(),
    iconUrl: text(),
    iconGrayUrl: text(),
    hidden: int({ mode: 'boolean' }).notNull().default(false),
    // Porcentaje global de jugadores que lo tienen (rareza real, medida por
    // Steam). Null si no se pudo traer. Es lo que separa "lo tiene todo el
    // mundo" de "esto lo tiene el 2%".
    globalPercent: real(),
    // El orden en el que Steam los devuelve — el mismo que ves en su web.
    sortIndex: int().notNull(),
  },
  // Un logro por (juego, nombre interno): resincronizar hace UPSERT sobre
  // esta clave en vez de duplicar el catálogo entero, igual que los recaps.
  (table) => [uniqueIndex('achievements_game_api_unique').on(table.gameId, table.apiName)],
);

// Y los DESBLOQUEOS: cuáles has sacado tú, cuándo, y por dónde nos enteramos.
//
// Diseño clave (LOGROS.md §2): un desbloqueo es un HECHO CON ORIGEN, no un
// booleano. El mismo logro puede constar por Steam y por el fichero de un
// emulador de Steam — jugaste una vuelta pirata y luego lo compraste — y las
// dos cosas son ciertas a la vez. Se guardan por separado y la ficha los
// funde al leer, quedándose con la fecha más temprana como "la primera vez
// que lo hiciste". Así ninguna fuente pisa a la otra ni hay que elegir.
export const achievementUnlocksTable = sqliteTable(
  'achievement_unlocks',
  {
    id: int().primaryKey({ autoIncrement: true }),
    achievementId: int()
      .notNull()
      .references(() => achievementsTable.id, { onDelete: 'cascade' }),
    unlockedAt: int({ mode: 'timestamp_ms' }).notNull(),
    // ¿Se puede tratar esta fecha como un MOMENTO real?
    //
    // Casi siempre sí. Pero hay un caso que la falsea en bloque, y pasó de
    // verdad: al darle a Goldberg el catálogo que le faltaba, el juego volvió
    // a reportar los 25 logros que ya tenías guardados en su partida, y el
    // emulador los selló todos con el segundo exacto en que los recibió. No
    // se perdieron —aparecieron, que es la buena noticia— pero su fecha es la
    // del rescate, no la de la hazaña.
    //
    // Marcarlos evita que el Journey y los recaps cuenten que una tarde
    // hiciste veinticinco logros de James Bond en el mismo segundo. Sigue
    // siendo cierto que los tienes; lo que no se sabe es cuándo.
    dateReliable: int({ mode: 'boolean' }).notNull().default(true),
    // 'ra' = RetroAchievements (RETROACHIEVEMENTS.md). El enum es solo de
    // TypeScript (SQLite no lleva CHECK aquí): añadir una fuente no es DDL.
    source: text({ enum: ['steam', 'emu', 'ra'] }).notNull(),
    // El playthrough y la sesión en los que caiste — se resuelven cruzando la
    // fecha del desbloqueo con tus sesiones (ver steam/matchSessions.ts).
    // Nullables porque un logro puede caer fuera de toda sesión trackeada
    // (lo sacaste antes de usar Afterplay, o jugando sin que la app mirara):
    // el desbloqueo sigue siendo cierto aunque no sepamos a qué rato pegarlo.
    // SET NULL y no CASCADE: borrar una sesión no puede borrar el hecho de
    // que sacaste el logro.
    iterationId: int().references(() => iterationsTable.id, { onDelete: 'set null' }),
    sessionId: int().references(() => sessionsTable.id, { onDelete: 'set null' }),
  },
  // Un desbloqueo por (logro, fuente): resincronizar con Steam actualiza la
  // fila en vez de acumular una nueva en cada pasada.
  (table) => [
    uniqueIndex('achievement_unlocks_source_unique').on(table.achievementId, table.source),
  ],
);

// Recaps del Loop (AFTERPLAY-LOOP.md §3.1): la prosa generada de cada periodo
// cerrado — el texto de un mes o un año de tu vida jugando, escrito por
// Sonnet a partir de los hechos locales (shared/memory/chapters.ts).
//
// UNA fila por periodo, con UNIQUE sobre (scopeType, scopeKey): regenerar
// hace UPSERT (ver insertMemory) y pisa la prosa anterior. El primer diseño
// era insert-only "y la última gana al leer", pero en la práctica cada
// regeneración masiva (cambio de prompt, cambio de modelo) multiplicaba la
// tabla entera — 366 filas para 100 periodos en un solo día de ajustes. El
// historial de regeneraciones no vale ese crecimiento sin techo. El caso de
// los dos PCs (§7.1) sigue resuelto: si ambos generan el mismo mes, el
// segundo upsert pisa al primero — mismo "último gana", ahora en escritura.
//
// sourceHash (SHA-256 de los hechos canonicalizados del capítulo) da el
// estado de cada periodo sin mirar la prosa: missing / stale (corregiste el
// pasado y los hechos ya no son los narrados) / current.
export const generatedMemoriesTable = sqliteTable(
  'generated_memories',
  {
    id: int().primaryKey({ autoIncrement: true }),
    scopeType: text({ enum: ['month', 'year'] }).notNull(),
    // '2026-06' para meses, '2026' para años (ver shared/memory/chapters.ts).
    scopeKey: text().notNull(),
    payload: text({ mode: 'json' }).$type<RecapPayload>().notNull(),
    sourceHash: text().notNull(),
    // Trazabilidad: con qué modelo y qué versión del prompt se escribió esto.
    model: text().notNull(),
    promptVersion: int().notNull(),
    createdAt: int({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex('generated_memories_scope_unique').on(table.scopeType, table.scopeKey)],
);

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

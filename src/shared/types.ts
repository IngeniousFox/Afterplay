import type {
  GameRow,
  Iteration,
  NewEmulator,
  NewGame,
  NewIteration,
  NewSpendEvent,
  NewStateEvent,
  Session,
  SpendEvent,
  StateEvent,
} from '../main/db/schema';

export type {
  Emulator,
  GameRow,
  Iteration,
  SaveBackupRow,
  Session,
  SpendEvent,
  StateEvent,
} from '../main/db/schema';

// Partidas guardadas (PARTIDAS-GUARDADAS.md) — la fuente es
// main/saves/contracts.ts, igual que igdb/hltb/sgdb reexportan la suya.
export type {
  CloudFolder,
  CloudInventory,
  CloudMachine,
  IdentityCheck,
  RecoveryResult,
  RestoreMode,
  RestorePlanFile,
  RestoreRequestInput,
  RestoreResult,
  SaveBackupsUsage,
  SavesActivityEvent,
  SavesBackupResult,
  SavesGameState,
  SavesLocalState,
  SavesScanEntry,
  SavesStatus,
} from '../main/saves/contracts';

// Escaneo de carpetas del modo "Scan your folders" (Add Game).
export type { ScanCandidate, ScannedFolder, ScanReport } from '../main/scan/contracts';

// Precisión de una fecha elegida a mano en un picker (Add/Edit Game,
// History) — 'datetime' no es una opción del picker (nadie teclea hora a
// mano), solo la llevan los eventos que la app crea ella sola en el momento
// (ver EventDatePrecision).
export type DatePrecision = 'year' | 'month' | 'day';

// Precisión guardada en la DB para un evento de estado/gasto o una sesión —
// añade 'datetime' a DatePrecision para los eventos que la propia app crea
// en vivo (estado inicial al guardar, cambios de estado, sesiones
// trackeadas), que sí llevan hora real.
export type EventDatePrecision = DatePrecision | 'datetime';

// Inputs de los handlers de escritura. Parten de las formas de INSERT de
// Drizzle pero quitando lo que el renderer nunca debe mandar (ids, campos
// que fija el main) — así el contrato del IPC queda explícito aquí.
export type CreateGameInput = Omit<NewGame, 'id'>;

export type UpdateGamePatch = Partial<Omit<NewGame, 'id' | 'addedAt'>>;

export type CreateIterationInput = Omit<NewIteration, 'id' | 'label'> & {
  label?: string | null;
};

export type UpdateIterationPatch = Partial<
  Pick<
    NewIteration,
    | 'label'
    | 'playedPlatform'
    | 'origin'
    | 'format'
    | 'manualTotalPlayed'
    | 'extraContent'
    | 'rating'
  >
>;

export type AddStateEventInput = Omit<NewStateEvent, 'id'>;

export type AddSpendEventInput = Omit<NewSpendEvent, 'id'>;

// EMULADORES.md — registrar un emulador para que el watcher lo vigile.
export type CreateEmulatorInput = Omit<NewEmulator, 'id'>;

// Sesión de emulador pendiente de asignar (bandeja "Pending" de la vista de
// Sesiones) — con el nombre del emulador ya resuelto para pintarla.
export type PendingSession = {
  id: number;
  emulatorId: number;
  emulatorName: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
};

// Corrección de una entrada del historial (lápiz de HistoryList, y las
// fechas/desenlace del Edit desde el modelo v2 — los eventos SON las fechas
// de los playthroughs). Cambiar el `type` está reservado a corregir el
// DESENLACE de un playthrough manual (Beaten → Dropped) desde Edit: ahí no
// es "reescribir el pasado", es corregir un registro tecleado — el mismo
// criterio que siempre aplicó a las fechas.
export type UpdateStateEventPatch = {
  type?: StateEvent['type'];
  occurredAt?: Date;
  datePrecision?: EventDatePrecision;
  note?: string | null;
};

export type UpdateSpendEventPatch = {
  amount?: number;
  occurredAt?: Date;
  datePrecision?: EventDatePrecision;
  note?: string | null;
};

// Input del guardado atómico del modal de añadir juego (Bloque 2F). Va en
// una sola llamada porque el main resuelve TODO lo que hace falta de fuera
// (detalle de IGDB, tiempos de HLTB, id de SteamGridDB) y escribe game +
// iteration + spendEvent + log de estados inicial dentro de una única
// transacción — así no puede quedar un juego "a medias" si algo falla a
// mitad de camino.
export type CreateGameWithDetailsInput = {
  igdbId: number;
  endless: boolean;
  // EMULADORES.md §5 — checkbox "Emulated game" del modal: sin .exe propio
  // que vigilar (el campo se oculta), sesiones vía asignación manual.
  isEmulated: boolean;
  iteration: {
    playedPlatform: string;
    origin: string;
    format: 'digital' | 'physical';
  };
  hoursPlayed: number | null;
  // Estructurado desde el picker de fecha+precisión del renderer — ya no hay
  // texto libre que adivinar en el main. Solo tiene sentido si endless es
  // false (el modal oculta estos dos campos para juegos endless).
  started: { date: Date; precision: DatePrecision } | null;
  finished: { date: Date; precision: DatePrecision } | null;
  // Vocabulario de la DB (StateEvent['type']), no el de la UI — el renderer
  // ya traduce la opción elegida en el dropdown antes de mandarla. null =
  // sin estado inicial (juego normal que se añade como Unplayed).
  initialStatus: StateEvent['type'] | null;
  note: string | null;
  // Notas generales del juego — independientes del note de arriba (que
  // cuelga del stateEvent inicial). Un desplegable propio en el modal, no
  // atado a si se marcó "jugado antes" ni a si hay estado inicial.
  gameNotes: string | null;
  moneySpent: number | null;
  // Cuándo se compró — solo tiene sentido con moneySpent puesto. null =
  // "hoy" a nivel de UI, pero se manda explícito desde el renderer (no un
  // default silencioso aquí en el main).
  moneySpentDate: { date: Date; precision: DatePrecision } | null;
  executablePath: string | null;
  // Elegidos a mano en el CoverPicker (SPEC 4.6) — null significa "sin
  // elección propia", el main usa su propio default (detail.covers[0]/
  // heroes[0], la primera candidata de IGDB) igual que hacía antes de que
  // existiera el picker.
  coverUrl: string | null;
  heroUrl: string | null;
  // Igual que coverUrl/heroUrl: null = "sin elección propia", el main busca
  // el id él solo (mismo criterio nombre+año que siempre). Puesto a mano =
  // se usa ESE id tal cual, sin buscar — para cuando el auto-match falla o
  // el usuario ya sabe cuál es el juego correcto en SteamGridDB.
  steamGridDbId: number | null;
  // Carpeta de instalación + su tamaño ya calculado (ver dialog:pickDirectory)
  // — null si no se eligió ninguna al añadir el juego.
  installDirectory: string | null;
  installSizeBytes: number | null;
};

// Sección Plan to Play — alta reducida: un juego planeado no tiene
// playthrough real todavía (ni plataforma, ni gasto, ni exe), solo el juego
// del catálogo + tus notas + la nota del historial ("por qué lo planeo").
export type CreatePlannedGameInput = {
  igdbId: number;
  note: string | null;
  gameNotes: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
  steamGridDbId: number | null;
};

// Pasar un juego planeado a la biblioteca de verdad: mismos datos que el
// alta normal (el modal de Add Game se abre prellenado) pero sobre el juego
// YA existente — nada de borrar y recrear, el historial (incluida la
// entrada de "Plan to Play") se conserva.
export type PromotePlannedGameInput = Omit<CreateGameWithDetailsInput, 'igdbId'> & {
  gameId: number;
};

// Resultado del picker de carpeta (Install directory, Add/Edit game) — el
// tamaño ya viene calculado desde el main, no hace falta un segundo viaje.
export type DirectoryPickResult = { path: string; sizeBytes: number };

// Botón Play — lanzar el .exe configurado (games:launchExecutable). 'missing'
// cuando la ruta guardada ya no existe (se movió/desinstaló el juego desde
// que se guardó); 'error' para cualquier otro fallo al abrirlo (shell.openPath
// devuelve un mensaje descriptivo, ej. permisos).
export type LaunchExecutableResult =
  { ok: true } | { ok: false; reason: 'missing' } | { ok: false; reason: 'error'; message: string };

export type { IgdbGameDetail, IgdbSearchResult } from '../main/igdb/types';

export type { HltbTimes } from '../main/hltb/types';

// SteamGridDB (Bloque 2C-ter) — igual, la fuente es main/sgdb/types.ts.
export type { GetSgdbImagesInput, SgdbImages } from '../main/sgdb/types';

// Caché local de imágenes (Bloque 2C-quater) — la fuente es main/images/cache.ts.
export type { ImageCacheType } from '../main/images/cache';

export type GameListItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  // Para la cara trasera de la card de la biblioteca (flip al pasar el
  // ratón) — null si el juego no tiene hero elegido.
  heroUrl: string | null;
  // Solo para el Genre Radar (Bloque 5E) — se usa genres[0] como género
  // "principal" del juego, igual que officialPlatforms?.[0] en otros sitios.
  genres: string[] | null;
  // EMULADORES.md — alimenta el filtro del modal de asignación de sesiones
  // pendientes (solo juegos emulados pueden recibirlas).
  isEmulated: boolean;
  // SPEC 10.8 — juegos sin final (roguelikes, simuladores, servicio). Aquí
  // solo para el filtro "Endless" de las columnas de navegación.
  endless: boolean;
  // Para el donut de "edad" de los juegos jugados (estilo resumen anual de
  // Steam): nuevos vs 1-5 / 5-10 / 10+ años respecto al año filtrado.
  releaseYear: number | null;
  totalHours: number;
  // Cuándo entró en Afterplay — el gráfico Backlog Flow de Stats acumula
  // altas por mes contra completados por mes.
  addedAt: Date;
  // Main Story de HowLongToBeat — para el "You vs HLTB" de Stats (tus horas
  // frente al tiempo oficial en juegos completados). Null si HLTB no lo
  // tenía al enriquecer el juego.
  hltbMain: number | null;
  // Playthroughs con horas manuales ("I played this before"), con el año al
  // que atribuirlas: el de su fecha de fin (o la de inicio si no hay fin), o
  // null si el playthrough no tiene ninguna fecha. Las vistas por año de
  // Stats las suman al año que toca — sin esto, esas horas solo existían
  // dentro de totalHours y desaparecían al filtrar por año. Se SUMAN a las
  // sesiones trackeadas de ese mismo playthrough, nunca las reemplazan: son
  // tiempos disjuntos (ver resolveIterationHours). El iterationId sirve para
  // emparejar cada bloque de horas manuales con su playthrough — lo usa el
  // "You vs HowLongToBeat", que compara UN playthrough concreto.
  manualIterations: { iterationId: number; hours: number; year: number | null }[];
  currentState: StateEvent['type'] | null;
  // Cuándo se tocó por última vez, para el orden "Last played" de las
  // columnas de navegación. Sale de la última SESIÓN; si el juego no tiene
  // ninguna (jugado antes del tracking, o solo marcado a mano), cae al
  // último evento de estado. null si no hay ni una cosa ni la otra.
  lastPlayedAt: Date | null;
  isLive: boolean;
  // startedAt de la sesión abierta, para el contador en vivo de la card
  // (SPEC 10.7) — null si isLive es false.
  liveSince: Date | null;
  sessionCount: number;
};

// Preferencia de formato de hora (ajustes, SPEC 3E-bis) — 24h por defecto.
// Un solo tipo compartido: el main la persiste (config/store.ts), el
// renderer la usa para formatear cualquier datetime (lib/format.ts).
export type TimeFormat = '12h' | '24h';

// Credenciales de servicios externos, editables desde Ajustes y guardadas
// cifradas en userData (ver main/config/credentials.ts) — la app funciona
// sin ninguna (modo local, sin búsqueda IGDB); null = sin configurar.
export type CredentialsValues = {
  twitchClientId: string | null;
  twitchClientSecret: string | null;
  steamGridDbApiKey: string | null;
  databaseUrl: string | null;
  databaseAuthToken: string | null;
  // Cloudflare R2 para las partidas guardadas (PARTIDAS-GUARDADAS.md §9).
  // Sin las CUATRO, la función entera queda deshabilitada — nada de
  // partidas funciona a medias (§9.2).
  r2AccountId: string | null;
  r2Bucket: string | null;
  r2AccessKeyId: string | null;
  r2SecretAccessKey: string | null;
  // Anthropic para las curiosidades de juegos del modo ambiente — una llamada
  // por juego EN LA VIDA (quedan guardadas en la DB y sincronizan por Turso).
  anthropicApiKey: string | null;
};

// ── Curiosidades de juego (modo ambiente) ──────────────────────────────────
// Hechos reales generados una vez por juego (ver main/curiosities) que el
// modo ambiente mezcla con sus frases de memoria personal.

export type CuriositySummary = {
  gameId: number;
  text: string;
};

// Estado del backfill para la tarjeta de Ajustes: cuántos juegos tienen ya
// sus curiosidades y si hay una pasada en marcha ahora mismo.
export type CuriositiesStatus = {
  totalGames: number;
  generatedGames: number;
  running: boolean;
};

// Avisos del main mientras genera: 'progress' va marcando la pasada del
// backfill; 'generated' dice que un juego concreto acaba de recibir (o
// re-confirmar) sus curiosidades — el renderer invalida y ya.
export type CuriosityActivityEvent =
  | {
      kind: 'progress';
      running: boolean;
      done: number;
      total: number;
      failed: number;
      currentTitle: string | null;
    }
  | { kind: 'generated'; gameId: number };

// ── Recaps del Loop (AFTERPLAY-LOOP.md §3) ────────────────────────────────
// La prosa de cada periodo cerrado, generada una vez y leída en el Journey y
// en Sessions. La forma del payload vive en shared/memory/payload.ts (la
// necesita también el esquema de la DB).

export type { RecapPayload } from './memory/payload';
import type { RecapPayload as MemoryRecapPayload } from './memory/payload';

// El último recap de cada periodo — lo único que el renderer necesita leer
// (el historial de regeneraciones se queda en la DB).
export type GeneratedMemorySummary = {
  scopeType: 'month' | 'year';
  scopeKey: string;
  payload: MemoryRecapPayload;
  createdAt: Date;
};

// Estado para la tarjeta de Ajustes: cuántos periodos cerrados con actividad
// están al día, cuántos sin recap y cuántos desactualizados (corregiste el
// pasado y su sourceHash ya no casa — §7.2).
export type MemoriesStatus = {
  current: number;
  missing: number;
  stale: number;
  running: boolean;
};

// Avisos del main mientras la cola trabaja. 'progress' marca la racha (misma
// gramática que las curiosidades); 'generated' dice que un periodo concreto
// acaba de recibir su recap — con el origen, porque solo los automáticos
// levantan el toast de "Your June story is ready" (§3.3): una pasada de
// backfill de 40 meses no puede disparar 40 toasts.
export type MemoryActivityEvent =
  | {
      kind: 'progress';
      running: boolean;
      done: number;
      total: number;
      failed: number;
      currentLabel: string | null;
    }
  | { kind: 'generated'; scopeType: 'month' | 'year'; scopeKey: string; origin: 'auto' | 'manual' };

// Cambio de estado suelto para el desglose "Status Changes" de Stats por
// año (Bloque 5D) — ver getAllStateEvents.ts.
export type StateEventSummary = {
  id: number;
  gameId: number;
  // Playthrough dueño del evento — "You vs HowLongToBeat" lo usa para
  // comparar las horas de ESE playthrough (el último completado), no las
  // totales del juego.
  iterationId: number;
  type: StateEvent['type'];
  occurredAt: Date;
  datePrecision: StateEvent['datePrecision'];
  // Etiqueta del playthrough dueño del evento ("Playthrough 2") — la galería
  // de completados de Stats la enseña en el tooltip de cada carátula.
  iterationLabel: string;
};

// Gasto suelto para las métricas globales de Stats (Bloque 5B) — ver
// getAllSpendEvents.ts. Sin gameId/type/note: esta vista solo suma importes
// por fecha (total y por año), no necesita más.
export type SpendEventSummary = {
  // Stats no lo usa (sus métricas son sumas globales), pero el modo ambiente
  // sí: necesita el gasto DE UN juego para poder decir su coste por hora.
  gameId: number;
  amount: number;
  occurredAt: Date;
};

// Sesión de la vista de Sesiones (Bloque 5A) con el juego ya resuelto — ver
// getAllSessions.ts. Campos explícitos (no `Session & {...}`) para reflejar
// exactamente lo que su select() devuelve.
export type SessionWithGame = {
  id: number;
  iterationId: number;
  isManual: boolean;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  lastHeartbeatAt: Date | null;
  datePrecision: EventDatePrecision;
  note: string | null;
  gameId: number;
  gameTitle: string;
  coverUrl: string | null;
};

// Un juego se acaba de cerrar y el watcher ha cerrado su sesión. Viaja del
// main al renderer para levantar el aviso con la duración y el atajo de
// escribir la nota — el renderer no puede saberlo por su cuenta: quien
// detecta que el proceso murió es el watcher.
export type SessionClosedEvent = {
  sessionId: number;
  gameId: number;
  // Playthrough dueño de la sesión recién cerrada — es donde los botones de
  // estado rápido del toast escriben su evento (AFTERPLAY-LOOP.md §6): la
  // sesión acaba de registrarse ahí, así que ese ES el playthrough activo.
  iterationId: number;
  // Decide qué botones ofrece el toast: Beaten/Dropped para juegos normales,
  // Resting para endless (un endless no se "termina").
  endless: boolean;
  gameTitle: string;
  // Para que el aviso se vea como una ficha del juego y no como un mensaje de
  // sistema: carátula a un lado y hero de fondo tras un velo (mismo lenguaje
  // que GameBanner/HeroBanner).
  coverUrl: string | null;
  heroUrl: string | null;
  durationSec: number;
  // Total del juego TRAS esta sesión — el "llevas 43h" del aviso.
  totalHours: number;
  // Esta sesión ha sido la más larga de este juego. Es la clase de dato que
  // convierte un registro en un pequeño momento.
  isLongest: boolean;
  // Solo cuando el evento viene de PULSAR la notificación de Windows: ahí no
  // toca enseñar un toast, sino abrir la ficha del juego con esa sesión
  // resaltada — que es lo que el clic estaba pidiendo.
  openGame?: boolean;
};

// Referencia al evento que fija una fecha de borde del playthrough (modelo
// v2: las fechas viven en el log de estados) — con lo justo para prellenar
// el picker del Edit y parchear el evento al guardar.
export type IterationEdgeEvent = {
  id: number;
  occurredAt: Date;
  datePrecision: EventDatePrecision;
};

export type IterationDetail = Iteration & {
  hours: number;
  // Derivadas (modelo v2): startedAt = lo más temprano entre su primera
  // sesión real y su primer evento 'started'; endedAt = la fecha del último
  // evento terminal (completed/dropped/on_hold) si el playthrough está en
  // uno de esos estados ahora.
  startedAt: Date | null;
  endedAt: Date | null;
  // Primer evento 'started' y último terminal — los "dueños" editables de
  // esas fechas en Edit. startedBySession=true significa que la fecha de
  // inicio derivada viene de una sesión MEDIDA (anterior al evento): esa no
  // se edita, una medición no se falsea.
  startEvent: IterationEdgeEvent | null;
  endEvent: IterationEdgeEvent | null;
  startedBySession: boolean;
  currentState: StateEvent['type'] | null;
  sessions: Session[];
  // Gasto atribuido a ESTE playthrough (no el total del juego) — ver
  // getGameById.ts para el algoritmo de reparto entre iteraciones.
  spend: number;
};

export type GameDetail = GameRow & {
  totalHours: number;
  currentState: StateEvent['type'] | null;
  isLive: boolean;
  totalSpend: number;
  costPerHour: number | null;
  stateHistory: StateEvent[];
  spendHistory: SpendEvent[];
  iterations: IterationDetail[];
};

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
  Session,
  SpendEvent,
  StateEvent,
} from '../main/db/schema';

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
  datePrecision?: 'year' | 'month' | 'day' | 'datetime';
  note?: string | null;
};

export type UpdateSpendEventPatch = {
  amount?: number;
  occurredAt?: Date;
  datePrecision?: 'year' | 'month' | 'day' | 'datetime';
  note?: string | null;
};

// Input del guardado atómico del modal de añadir juego (Bloque 2F). Va en
// una sola llamada porque el main resuelve TODO lo que hace falta de fuera
// (detalle de IGDB, tiempos de HLTB, id de SteamGridDB) y escribe game +
// iteration + sesiones de borde + spendEvent + stateEvent inicial dentro de
// una única transacción — así no puede quedar un juego "a medias" si algo
// falla a mitad de camino.
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
  started: { date: Date; precision: 'year' | 'month' | 'day' } | null;
  finished: { date: Date; precision: 'year' | 'month' | 'day' } | null;
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
  moneySpentDate: { date: Date; precision: 'year' | 'month' | 'day' } | null;
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
  // dentro de totalHours y desaparecían al filtrar por año. El iterationId
  // permite además EXCLUIR las sesiones trackeadas de esos playthroughs del
  // conteo por año (manual reemplaza a trackeado, nunca se suman los dos —
  // misma regla que resolveIterationHours).
  manualIterations: { iterationId: number; hours: number; year: number | null }[];
  currentState: StateEvent['type'] | null;
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
};

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
  datePrecision: 'year' | 'month' | 'day' | 'datetime';
  gameId: number;
  gameTitle: string;
  coverUrl: string | null;
};

// Referencia al evento que fija una fecha de borde del playthrough (modelo
// v2: las fechas viven en el log de estados) — con lo justo para prellenar
// el picker del Edit y parchear el evento al guardar.
export type IterationEdgeEvent = {
  id: number;
  occurredAt: Date;
  datePrecision: 'year' | 'month' | 'day' | 'datetime';
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

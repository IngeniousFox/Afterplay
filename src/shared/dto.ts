import type { EventDatePrecision } from './dateTypes';

// ── LAS ENTIDADES QUE CRUZAN AL RENDERER, A LA PWA Y AL WORKER ─────────────
//
// Hasta la fase 1 de la 2.0 (AFTERPLAY-2.0.md §15.3, fallo F-42) estos tipos
// se REEXPORTABAN tal cual desde el esquema de Drizzle (main/db/schema.ts):
// el renderer dependía de la forma física de las tablas y cualquier cambio de
// esquema arrastraba cientos de usos. Ahora se declaran aquí, a mano y sin
// importar nada de main, para que shared/ deje de saber que existe una base
// de datos.
//
// La forma es EXACTAMENTE la que inferían las tablas (ids number incluidos:
// eso cambia en la fase 2, no ahora). Y para que no se separen solas, main
// compara cada tipo de aquí con el inferido de su tabla en tiempo de
// compilación (main/db/dtoSync.ts): tocar una columna sin tocar su tipo
// propio —o al revés— rompe `npm run typecheck:node`.

// Enumerados que comparten varias entidades. Literales aquí, no derivados de
// la tabla, por la misma razón que el resto del fichero.
export type StateEventType =
  'started' | 'completed' | 'dropped' | 'on_hold' | 'resting' | 'plan_to_play';
export type SpendEventType = 'purchase' | 'ingame_spend';
export type IterationFormat = 'digital' | 'physical';
export type IterationRating = 1 | 2 | 3 | 4 | 5;

// Un juego tal como lo guarda la tabla `games`. El significado de cada
// columna está documentado en el esquema; aquí solo se fija la forma.
export type GameRow = {
  id: number;
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  igdbId: number | null;
  steamGridDbId: number | null;
  officialPlatforms: string[] | null;
  releaseYear: number | null;
  hltbMain: number | null;
  hltbMainExtras: number | null;
  hltbCompletionist: number | null;
  notes: string | null;
  executablePath: string | null;
  developer: string | null;
  publisher: string | null;
  installDirectory: string | null;
  installSizeBytes: number | null;
  genres: string[] | null;
  endless: boolean;
  isEmulated: boolean;
  planned: boolean;
  addedAt: Date;
  promotedAt: Date | null;
  saveBackupEnabled: boolean;
  saveDetectionSource: 'auto' | 'manual' | null;
  saveLudusaviName: string | null;
  saveCustomPaths: string[] | null;
  curiositiesGeneratedAt: Date | null;
  steamAppId: number | null;
  steamAppIdManual: boolean;
  steamAppIdCheckedAt: Date | null;
  achievementsSyncedAt: Date | null;
  achievementsUnlocksSyncedAt: Date | null;
  raGameId: number | null;
  raCheckedAt: Date | null;
  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
  ratingsCheckedAt: Date | null;
  summary: string | null;
  igdbCollections: { id: number; name: string }[] | null;
  steamTags: { name: string; votes: number }[] | null;
  steamPositive: number | null;
  steamNegative: number | null;
  steamSpyCheckedAt: Date | null;
  planPinnedAt: Date | null;
  releaseDate: Date | null;
  releaseDatePrecision: 'year' | 'month' | 'day' | null;
};

// Un playthrough (tabla `iterations`).
export type Iteration = {
  id: number;
  gameId: number;
  label: string;
  playedPlatform: string;
  origin: string;
  format: IterationFormat | null;
  manualTotalPlayed: number | null;
  rating: IterationRating | null;
  extraContent: boolean;
};

// Una sesión de juego (tabla `sessions`). iterationId es null en las de
// emulador todavía sin asignar (bandeja "Pending").
export type Session = {
  id: number;
  iterationId: number | null;
  emulatorId: number | null;
  isManual: boolean;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  lastHeartbeatAt: Date | null;
  startedBy: 'watcher' | 'timer';
  datePrecision: EventDatePrecision;
  note: string | null;
};

// Una entrada del log de estados (tabla `state_events`).
export type StateEvent = {
  id: number;
  iterationId: number;
  type: StateEventType;
  occurredAt: Date;
  datePrecision: EventDatePrecision;
  note: string | null;
};

// Un gasto (tabla `spend_events`).
export type SpendEvent = {
  id: number;
  gameId: number;
  type: SpendEventType;
  amount: number;
  occurredAt: Date;
  datePrecision: EventDatePrecision;
  note: string | null;
};

// Un emulador registrado (tabla `emulators`).
export type Emulator = {
  id: number;
  name: string;
  executablePath: string;
};

// Una versión de partida guardada subida al bucket (tabla `save_backups`).
export type SaveBackupRow = {
  id: number;
  gameId: number;
  createdAt: Date;
  backupName: string;
  r2Key: string;
  sizeBytes: number;
  ludusaviName: string;
  differential: boolean;
  parentBackupName: string | null;
  machineId: string;
  machineName: string;
  machineHome: string;
  locations: string[] | null;
  hasRegistry: boolean;
};

// ── LO QUE EL RENDERER PUEDE MANDAR POR EL IPC ─────────────────────────────
//
// Listas CERRADAS: cada campo está porque algún llamador del renderer (o de
// los e2e) lo manda de verdad. Antes se derivaban de las formas de INSERT
// (`Partial<Omit<NewGame, ...>>`), y eso dejaba que el renderer escribiera
// CUALQUIER columna — también las de caché externa (notas de IGDB, etiquetas
// de Steam, sellos de "ya preguntado"…), que solo debe tocar el main. Lo que
// el main necesita escribir por su cuenta tiene sus propios tipos internos en
// main/db/writeTypes.ts.

// games:update — el modal de editar (handleSave), el de notas y el de
// carátula. Fuera a propósito: steamAppId/steamAppIdManual (tienen su propio
// editor, games:setSteamAppId) y todo lo que rellenan las pasadas externas.
// El handler además DESCARTA en ejecución cualquier clave fuera de esta lista
// (ver ipc/gamePatch.ts): el tipo solo protege a quien compila contra él.
export type UpdateGamePatch = {
  title?: string;
  coverUrl?: string | null;
  heroUrl?: string | null;
  steamGridDbId?: number | null;
  notes?: string | null;
  executablePath?: string | null;
  installDirectory?: string | null;
  installSizeBytes?: number | null;
  endless?: boolean;
  isEmulated?: boolean;
};

// iterations:create — StatusCard, TvGameDetail, Add/Edit game. `label` vacío
// o null = el main autogenera "Playthrough N".
export type CreateIterationInput = {
  gameId: number;
  label?: string | null;
  playedPlatform: string;
  origin: string;
  format?: IterationFormat | null;
  manualTotalPlayed?: number | null;
};

// iterations:update — Edit game y las estrellas del panel del playthrough.
export type UpdateIterationPatch = {
  label?: string;
  playedPlatform?: string;
  origin?: string;
  format?: IterationFormat | null;
  manualTotalPlayed?: number | null;
  extraContent?: boolean;
  rating?: IterationRating | null;
};

// stateEvents:add — todos los menús de estado (ficha, TV, toast de cierre).
// occurredAt y note opcionales, como en la tabla: sin fecha, "ahora".
export type AddStateEventInput = {
  iterationId: number;
  type: StateEventType;
  occurredAt?: Date;
  datePrecision: EventDatePrecision;
  note?: string | null;
};

// spend:add — el popover de añadir gasto.
export type AddSpendEventInput = {
  gameId: number;
  type: SpendEventType;
  amount: number;
  occurredAt?: Date;
  datePrecision: EventDatePrecision;
  note?: string | null;
};

// emulators:create — la sección de emuladores de Ajustes.
export type CreateEmulatorInput = {
  name: string;
  executablePath: string;
};

import type { EventDatePrecision, StateEventDatePrecision } from './dateTypes';
import type {
  EmulatorId,
  EntityId,
  EntityIdLike,
  GameId,
  IterationId,
  SaveBackupId,
  SessionId,
  SpendEventId,
  StateEventId,
} from './entityIds';

// ── LAS ENTIDADES QUE CRUZAN AL RENDERER, A LA PWA Y AL WORKER ─────────────
//
// Hasta la fase 1 de la 2.0 (AFTERPLAY-2.0.md §15.3, fallo F-42) estos tipos
// se REEXPORTABAN tal cual desde el esquema de Drizzle (main/db/schema.ts):
// el renderer dependía de la forma física de las tablas y cualquier cambio de
// esquema arrastraba cientos de usos. Ahora se declaran aquí, a mano y sin
// importar nada de main, para que shared/ deje de saber que existe una base
// de datos.
//
// La forma es EXACTAMENTE la que inferían las tablas. Los tipos que llevan ids
// de entidad son genéricos en su representación (`Id`, por defecto
// `EntityId`): sin parámetro significan lo de siempre, y con `string` sirven a
// las consultas del esquema 2.0 mientras la app sigue en el 1.x (ver
// entityIds.ts). Los ids de servicios externos (igdbId, steamAppId…) son
// números de ESOS servicios y no participan. Y para que no se separen solas, main
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

// ── Valores que solo existen en el esquema 2.0 ──────────────────────────────
//
// Durante la fase 2 (AFTERPLAY-2.0.md §20.3.1) los DTOs solo GANAN valores
// (decisión "DTO" de src/main/db/v2/CONSULTAS.md §5.0), pero no pueden ganarlos
// para el esquema 1.x: main/db/dtoSync.ts exige que el tipo por defecto (ids
// numéricos) sea EXACTAMENTE el de las tablas 1.x, y un valor que esas tablas
// no pueden guardar sería una mentira del tipo.
//
// La representación del id ya dice de qué esquema viene la fila: número =
// 1.x (la app de hoy y, tras el cambio, el Worker hasta la fase 5), texto =
// 2.0. Así que los valores nuevos se cuelgan de ella: con `Id = string` el
// tipo los incluye y con `Id = number` sigue siendo el de siempre. El día del
// cambio (`EntityId = string`) el renderer los recibe sin tocar nada aquí, y
// el Worker, que seguirá con números, no.
type SchemaValues<Id extends EntityIdLike, Base, Added> = Id extends string ? Base | Added : Base;

// Precisión de un evento de estado. El 2.0 añade 'unknown' (R-07): el alta o
// la promoción sin fecha. Las lecturas 2.0 la devuelven tal cual.
export type StateEventPrecision<Id extends EntityIdLike = EntityId> = SchemaValues<
  Id,
  EventDatePrecision,
  StateEventDatePrecision
>;

// Quién abrió una sesión. El 2.0 añade 'play' (el botón Play, §10.2).
export type SessionStartedBy<Id extends EntityIdLike = EntityId> = SchemaValues<
  Id,
  'watcher' | 'timer',
  'play'
>;

// Un juego tal como lo guarda la tabla `games`. El significado de cada
// columna está documentado en el esquema; aquí solo se fija la forma.
export type GameRow<Id extends EntityIdLike = EntityId> = {
  id: GameId<Id>;
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
export type Iteration<Id extends EntityIdLike = EntityId> = {
  id: IterationId<Id>;
  gameId: GameId<Id>;
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
export type Session<Id extends EntityIdLike = EntityId> = {
  id: SessionId<Id>;
  iterationId: IterationId<Id> | null;
  emulatorId: EmulatorId<Id> | null;
  isManual: boolean;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  lastHeartbeatAt: Date | null;
  startedBy: SessionStartedBy<Id>;
  datePrecision: EventDatePrecision;
  note: string | null;
};

// Una entrada del log de estados (tabla `state_events`).
export type StateEvent<Id extends EntityIdLike = EntityId> = {
  id: StateEventId<Id>;
  iterationId: IterationId<Id>;
  type: StateEventType;
  occurredAt: Date;
  datePrecision: StateEventPrecision<Id>;
  note: string | null;
};

// Un gasto (tabla `spend_events`).
export type SpendEvent<Id extends EntityIdLike = EntityId> = {
  id: SpendEventId<Id>;
  gameId: GameId<Id>;
  type: SpendEventType;
  amount: number;
  occurredAt: Date;
  datePrecision: EventDatePrecision;
  note: string | null;
};

// Un emulador registrado (tabla `emulators`).
export type Emulator<Id extends EntityIdLike = EntityId> = {
  id: EmulatorId<Id>;
  name: string;
  executablePath: string;
};

// Una versión de partida guardada subida al bucket (tabla `save_backups`).
export type SaveBackupRow<Id extends EntityIdLike = EntityId> = {
  id: SaveBackupId<Id>;
  gameId: GameId<Id>;
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
export type CreateIterationInput<Id extends EntityIdLike = EntityId> = {
  gameId: GameId<Id>;
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
export type AddStateEventInput<Id extends EntityIdLike = EntityId> = {
  iterationId: IterationId<Id>;
  type: StateEventType;
  occurredAt?: Date;
  datePrecision: EventDatePrecision;
  note?: string | null;
};

// spend:add — el popover de añadir gasto.
export type AddSpendEventInput<Id extends EntityIdLike = EntityId> = {
  gameId: GameId<Id>;
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

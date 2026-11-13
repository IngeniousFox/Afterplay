import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareByCreation,
  compareEntityIds,
  entityIdSeed,
  entityIdToString,
  type EntityId,
  type EntityIdLike,
} from '../entityIds';
import type {
  AchievementEntry,
  GameDetail,
  GameListItem,
  GameRow,
  IterationDetail,
  PlannedGameItem,
  SessionClosedEvent,
  StateEventSummary,
} from '../types';
import {
  deriveGameDetail,
  type DetailIterationRow,
  type DetailSessionRow,
  type DetailSpendRow,
  type DetailStateEventRow,
} from '../domain/gameDetail';
import { hoursByGameInYear, type YearManualHours, type YearSession } from '../domain/hours';
import {
  deriveLibrary,
  type LibraryGameRow,
  type LibraryIterationRow,
  type LibraryLiveSession,
  type LibraryStateEventRow,
} from '../domain/library';
import { redistributePinStamps, type PinnedPlanRow } from '../domain/planOrder';
import {
  resolvePlaythroughForPlay,
  type PlaythroughRow,
  type ResolvePlaythroughInput,
  type PlaythroughStateEventRow,
} from '../domain/resolvePlaythrough';
import {
  playthroughClosedAt,
  splitSpendByPlaythrough,
  type SpendRow,
  type SpendStateEvent,
} from '../domain/spend';
import {
  buildChapter,
  canonicalChapterFacts,
  listClosedPeriodsWithActivity,
  type Chapter,
  type ChapterStateEvent,
  type ChapterUnlock,
  type ManualBlock,
} from '../memory/chapters';
import { deriveMoments, momentsBySession, type MemorySession } from '../memory/moments';
import { mergeUnlocksByAchievement, type UnlockCandidate } from '../mergeUnlocks';
import { planPinOrder } from '../planPinOrder';
import { latestRealStateEvent } from '../playthroughState';
import { uuidv7 } from '../sync/ids';

// LAS DOS REPRESENTACIONES DEL ID, con las mismas reglas (entityIds.ts).
//
// Durante la fase 2 conviven: las consultas 2.0 llaman a shared/domain con ids
// de texto mientras la app sigue con enteros, y después el Worker seguirá con
// enteros cuando la app ya use texto. Este fichero fija las dos mitades:
//   · En COMPILACIÓN (npm run typecheck): cada regla se llama con filas de ids
//     string y con filas de ids number sin `as any` ni parámetros de tipo
//     explícitos, y mezclar las dos en una misma llamada no compila
//     (`@ts-expect-error`). Los tests no compilan al ejecutarse (tsx), así que
//     esta mitad la vigila el typecheck, no `npm test`.
//   · En EJECUCIÓN: con ids de texto (UUIDv7 creados en el mismo orden que los
//     enteros) cada regla da EXACTAMENTE lo mismo que con sus equivalentes
//     numéricos: mismos juegos, mismo estado, mismas horas, mismos desempates.
//
// La equivalencia vale porque un UUIDv7 en minúsculas ordena por creación. Los
// ids 2.0 que NO son UUIDv7 (el de un juego sale del igdbId con UUIDv5) no
// ordenan igual que el autoincremental: con ellos los desempates por id de
// juego (los recaps) dan otro orden, igual de estable pero distinto.

// El id n en cada representación. Los UUIDv7 se crean con instantes
// crecientes, así que su orden de texto es el de los enteros.
const BASE_MS = Date.UTC(2024, 0, 1);
const TEXT_IDS = Array.from({ length: 64 }, (_, n) => uuidv7(BASE_MS + n * 1000));
const asNumber = (n: number): number => n;
const asText = (n: number): string => TEXT_IDS[n];

// Para comparar resultados: todo a JSON (mapas y conjuntos como listas) con
// cada UUID cambiado por su entero. Si las dos representaciones dan lo mismo,
// las dos cadenas son idénticas.
const unText = (json: string): string =>
  TEXT_IDS.reduce((acc, uuid, n) => acc.split(`"${uuid}"`).join(String(n)), json);
const canon = (value: unknown): string =>
  unText(
    JSON.stringify(value, (_key, inner: unknown) =>
      inner instanceof Map ? [...inner] : inner instanceof Set ? [...inner] : inner,
    ),
  );

const at = (iso: string): Date => new Date(iso);

// ── Fixtures, una vez y genéricas en la representación ─────────────────────

type LibraryFixture<Id extends EntityIdLike> = {
  games: LibraryGameRow<Id>[];
  iterations: LibraryIterationRow<Id>[];
  stateEvents: LibraryStateEventRow<Id>[];
  liveSessions: LibraryLiveSession<Id>[];
  timeZone: string;
};
type DetailFixture<Id extends EntityIdLike> = {
  iterations: DetailIterationRow<Id>[];
  sessions: DetailSessionRow<Id>[];
  stateEvents: DetailEvent<Id>[];
  spendEvents: DetailSpendRow[];
};
type SpendFixture<Id extends EntityIdLike> = {
  events: Map<Id, SpendStateEvent<Id>[]>;
  iterations: { id: Id }[];
  spends: SpendRow[];
};
type HoursFixture<Id extends EntityIdLike> = {
  gameIds: Id[];
  sessions: YearSession<Id>[];
  manual: Map<Id, YearManualHours[]>;
};
type PinFixture<Id extends EntityIdLike> = { rows: PinnedPlanRow<Id>[]; orderedIds: Id[] };
type MemoryFixture<Id extends EntityIdLike> = {
  sessions: MemorySession<Id>[];
  events: ChapterStateEvent<Id>[];
  titles: Map<Id, string>;
  manualBlocks: ManualBlock<Id>[];
  unlocks: ChapterUnlock<Id>[];
  manualHours: Map<Id, number>;
};

const libraryInput = <Id extends EntityIdLike>(id: (n: number) => Id): LibraryFixture<Id> => {
  const games: LibraryGameRow<Id>[] = [
    { id: id(1), addedAt: at('2024-01-01T10:00:00Z'), promotedAt: null },
    { id: id(2), addedAt: at('2024-01-02T10:00:00Z'), promotedAt: null },
  ];
  // Desordenadas a propósito: la suma va en orden de id.
  const iterations: LibraryIterationRow<Id>[] = [
    {
      id: id(11),
      gameId: id(1),
      manualTotalPlayed: 0.1,
      sessionCount: 2,
      trackedSeconds: 1234,
      lastSessionAt: at('2024-03-02T00:00:00Z').getTime(),
      firstSessionAt: at('2024-03-01T00:00:00Z').getTime(),
    },
    {
      id: id(10),
      gameId: id(1),
      manualTotalPlayed: 0.2,
      sessionCount: 1,
      trackedSeconds: 777,
      lastSessionAt: at('2024-02-02T00:00:00Z').getTime(),
      firstSessionAt: at('2024-02-01T00:00:00Z').getTime(),
    },
    {
      id: id(12),
      gameId: id(2),
      manualTotalPlayed: null,
      sessionCount: 0,
      trackedSeconds: null,
      lastSessionAt: null,
      firstSessionAt: null,
    },
  ];
  // Dos eventos en el MISMO instante: manda el de id más alto (dropped).
  const stateEvents: LibraryStateEventRow<Id>[] = [
    {
      id: id(20),
      gameId: id(1),
      iterationId: id(11),
      type: 'completed',
      occurredAt: at('2024-04-01T00:00:00Z'),
    },
    {
      id: id(21),
      gameId: id(1),
      iterationId: id(11),
      type: 'dropped',
      occurredAt: at('2024-04-01T00:00:00Z'),
    },
    {
      id: id(22),
      gameId: id(2),
      iterationId: id(12),
      type: 'started',
      occurredAt: at('2024-05-01T00:00:00Z'),
    },
  ];
  const liveSessions: LibraryLiveSession<Id>[] = [
    { gameId: id(2), startedAt: at('2024-05-02T00:00:00Z') },
  ];
  return { games, iterations, stateEvents, liveSessions, timeZone: 'UTC' };
};

type DetailEvent<Id extends EntityIdLike> = DetailStateEventRow<Id> & { datePrecision: 'day' };

const detailInput = <Id extends EntityIdLike>(id: (n: number) => Id): DetailFixture<Id> => {
  const iterations = [
    { id: id(11), manualTotalPlayed: 2 },
    { id: id(10), manualTotalPlayed: null },
  ];
  const sessions: DetailSessionRow<Id>[] = [
    {
      iterationId: id(10),
      isManual: false,
      startedAt: at('2024-01-05T10:00:00Z'),
      endedAt: at('2024-01-05T11:00:00Z'),
      durationSec: 3600,
    },
    {
      iterationId: id(11),
      isManual: false,
      startedAt: at('2024-06-01T10:00:00Z'),
      endedAt: null,
      durationSec: null,
    },
    {
      iterationId: null,
      isManual: false,
      startedAt: at('2024-06-02T10:00:00Z'),
      endedAt: null,
      durationSec: null,
    },
  ];
  const event = (
    n: number,
    iteration: number,
    type: DetailEvent<Id>['type'],
    iso: string,
  ): DetailEvent<Id> => ({
    id: id(n),
    iterationId: id(iteration),
    type,
    occurredAt: at(iso),
    datePrecision: 'day',
  });
  const stateEvents = [
    event(26, 10, 'plan_to_play', '2023-12-01T00:00:00Z'),
    event(21, 10, 'plan_to_play', '2023-12-02T00:00:00Z'),
    event(20, 10, 'started', '2024-01-10T00:00:00Z'),
    event(22, 10, 'completed', '2024-02-01T00:00:00Z'),
    // Mismo instante: gana el de id más alto (started), el playthrough sigue.
    event(24, 11, 'on_hold', '2024-05-01T00:00:00Z'),
    event(25, 11, 'started', '2024-05-01T00:00:00Z'),
    event(23, 11, 'started', '2024-05-01T00:00:00Z'),
  ];
  const spendEvents = [
    { amount: 60, occurredAt: at('2024-01-01T00:00:00Z') },
    { amount: 15, occurredAt: at('2024-02-01T00:00:00Z') },
    { amount: 9, occurredAt: at('2024-03-01T00:00:00Z') },
  ];
  return { iterations, sessions, stateEvents, spendEvents };
};

const playthroughInput = <Id extends EntityIdLike>(
  id: (n: number) => Id,
  lastWins: 'on_hold' | 'started',
): ResolvePlaythroughInput<Id> => {
  const playthroughs: PlaythroughRow<Id>[] = [
    { id: id(11), label: 'Playthrough 2' },
    { id: id(10), label: 'Playthrough 1' },
  ];
  // El desempate decide la rama: con el on_hold detrás se reanuda; con el
  // started detrás ya está activo y solo se usa.
  const tieLow = lastWins === 'on_hold' ? 'started' : 'on_hold';
  const events: PlaythroughStateEventRow<Id>[] = [
    { id: id(30), iterationId: id(10), type: 'started', occurredAt: at('2024-01-01T00:00:00Z') },
    { id: id(31), iterationId: id(10), type: 'completed', occurredAt: at('2024-02-01T00:00:00Z') },
    { id: id(32), iterationId: id(11), type: tieLow, occurredAt: at('2024-03-01T00:00:00Z') },
    { id: id(33), iterationId: id(11), type: lastWins, occurredAt: at('2024-03-01T00:00:00Z') },
  ];
  const now = at('2024-04-01T12:00:00Z');
  return { playthroughs, events, game: null, at: now, now };
};

const spendInput = <Id extends EntityIdLike>(id: (n: number) => Id): SpendFixture<Id> => {
  const events = new Map<Id, SpendStateEvent<Id>[]>([
    [
      id(10),
      [
        { id: id(41), type: 'completed', occurredAt: at('2024-02-01T00:00:00Z') },
        { id: id(42), type: 'started', occurredAt: at('2024-02-01T00:00:00Z') },
      ],
    ],
    [id(11), [{ id: id(43), type: 'dropped', occurredAt: at('2024-03-01T00:00:00Z') }]],
  ]);
  const iterations = [{ id: id(11) }, { id: id(10) }, { id: id(12) }];
  const spends = [
    { amount: 10, occurredAt: at('2024-01-15T00:00:00Z') },
    { amount: 20, occurredAt: at('2024-02-15T00:00:00Z') },
    { amount: 30, occurredAt: at('2024-03-15T00:00:00Z') },
  ];
  return { events, iterations, spends };
};

const hoursInput = <Id extends EntityIdLike>(id: (n: number) => Id): HoursFixture<Id> => {
  const sessions: YearSession<Id>[] = [
    { gameId: id(1), startedAt: at('2024-03-01T00:00:00Z'), durationSec: 5400 },
    { gameId: id(2), startedAt: at('2024-03-01T00:00:00Z'), durationSec: 1800 },
    { gameId: id(2), startedAt: at('2023-03-01T00:00:00Z'), durationSec: 9999 },
    { gameId: id(3), startedAt: at('2024-03-01T00:00:00Z'), durationSec: 1000 },
  ];
  const manual = new Map<Id, YearManualHours[]>([
    [
      id(1),
      [
        { hours: 4, year: 2024 },
        { hours: 9, year: 2022 },
      ],
    ],
  ]);
  return { gameIds: [id(2), id(1)], sessions, manual };
};

const pinInput = <Id extends EntityIdLike>(id: (n: number) => Id): PinFixture<Id> => {
  const rows: PinnedPlanRow<Id>[] = [
    { id: id(1), pinnedAt: 100 },
    { id: id(2), pinnedAt: 100 },
    { id: id(3), pinnedAt: 300 },
    { id: id(4), pinnedAt: null },
  ];
  return { rows, orderedIds: [id(3), id(1), id(1), id(2), id(4), id(9)] };
};

const unlockInput = <Id extends EntityIdLike>(
  id: (n: number) => Id,
): (UnlockCandidate<Id> & { source: string })[] => {
  const rows: (UnlockCandidate<Id> & { source: string })[] = [
    {
      achievementId: id(5),
      unlockedAt: at('2024-01-01T00:00:00Z'),
      dateReliable: false,
      source: 'emu',
    },
    {
      achievementId: id(5),
      unlockedAt: at('2024-02-01T00:00:00Z'),
      dateReliable: true,
      source: 'steam',
    },
    {
      achievementId: id(6),
      unlockedAt: at('2024-02-01T00:00:00Z'),
      dateReliable: true,
      source: 'steam',
    },
    {
      achievementId: id(6),
      unlockedAt: at('2024-01-01T00:00:00Z'),
      dateReliable: true,
      source: 'ra',
    },
  ];
  return rows;
};

// Siete sesiones medidas de un juego (cinco previas para que haya récord),
// dos en el mismo instante (desempata el id), un regreso tras >90 días, y un
// segundo juego con las MISMAS horas en marzo para el desempate por juego.
const memoryInput = <Id extends EntityIdLike>(id: (n: number) => Id): MemoryFixture<Id> => {
  const session = (
    n: number,
    game: number,
    iso: string,
    durationSec: number,
  ): MemorySession<Id> => {
    const startedAt = at(iso);
    return {
      id: id(n),
      gameId: id(game),
      startedAt,
      endedAt: new Date(startedAt.getTime() + durationSec * 1000),
      durationSec,
      isManual: false,
    };
  };
  const sessions = [
    session(31, 1, '2023-09-01T10:00:00', 3600),
    session(32, 1, '2023-09-02T10:00:00', 3600),
    session(33, 1, '2023-09-03T10:00:00', 3600),
    session(34, 1, '2023-09-04T10:00:00', 3600),
    session(36, 1, '2023-09-05T10:00:00', 3600),
    session(35, 1, '2023-09-05T10:00:00', 3000),
    session(37, 1, '2024-03-10T10:00:00', 7200),
    session(38, 2, '2024-03-11T10:00:00', 7200),
  ];
  const events: ChapterStateEvent<Id>[] = [
    { gameId: id(2), type: 'completed', occurredAt: at('2024-03-20T00:00:00') },
    { gameId: id(1), type: 'started', occurredAt: at('2024-03-20T00:00:00') },
    { gameId: id(2), type: 'started', occurredAt: at('2024-03-20T00:00:00') },
  ];
  const titles = new Map<Id, string>([
    [id(1), 'Uno'],
    [id(2), 'Dos'],
  ]);
  const manualBlocks: ManualBlock<Id>[] = [
    { gameId: id(2), hours: 0, anchor: at('2024-03-05T00:00:00') },
  ];
  const unlocks: ChapterUnlock<Id>[] = [
    {
      gameId: id(2),
      name: 'B',
      description: null,
      globalPercent: 5,
      unlockedAt: at('2024-03-12T00:00:00'),
    },
    {
      gameId: id(1),
      name: 'A',
      description: null,
      globalPercent: 5,
      unlockedAt: at('2024-03-12T00:00:00'),
    },
  ];
  const manualHours = new Map<Id, number>([[id(1), 1]]);
  return { sessions, events, titles, manualBlocks, unlocks, manualHours };
};

// ── Los DTOs, instanciados con las dos representaciones ────────────────────

const gameRow = <Id extends EntityIdLike>(id: Id): GameRow<Id> => ({
  id,
  title: 'Juego',
  coverUrl: null,
  heroUrl: null,
  igdbId: 1942,
  steamGridDbId: null,
  officialPlatforms: null,
  releaseYear: 2015,
  hltbMain: null,
  hltbMainExtras: null,
  hltbCompletionist: null,
  notes: null,
  executablePath: null,
  developer: null,
  publisher: null,
  installDirectory: null,
  installSizeBytes: null,
  genres: null,
  endless: false,
  isEmulated: false,
  planned: false,
  addedAt: at('2024-01-01T00:00:00Z'),
  promotedAt: null,
  saveBackupEnabled: false,
  saveDetectionSource: null,
  saveLudusaviName: null,
  saveCustomPaths: null,
  curiositiesGeneratedAt: null,
  steamAppId: 292030,
  steamAppIdManual: false,
  steamAppIdCheckedAt: null,
  achievementsSyncedAt: null,
  achievementsUnlocksSyncedAt: null,
  raGameId: null,
  raCheckedAt: null,
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
  ratingsCheckedAt: null,
  summary: null,
  igdbCollections: null,
  steamTags: null,
  steamPositive: null,
  steamNegative: null,
  steamSpyCheckedAt: null,
  planPinnedAt: null,
  releaseDate: null,
  releaseDatePrecision: null,
});

const gameDetailDto = <Id extends EntityIdLike>(id: (n: number) => Id): GameDetail<Id> => {
  const iteration: IterationDetail<Id> = {
    id: id(10),
    gameId: id(1),
    label: 'Playthrough 1',
    playedPlatform: 'PC',
    origin: 'Purchased',
    format: 'digital',
    manualTotalPlayed: null,
    rating: null,
    extraContent: false,
    hours: 1,
    startedAt: null,
    endedAt: null,
    startEvent: { id: id(20), occurredAt: at('2024-01-01T00:00:00Z'), datePrecision: 'day' },
    endEvent: null,
    startedBySession: false,
    currentState: 'started',
    sessions: [
      {
        id: id(30),
        iterationId: id(10),
        emulatorId: null,
        isManual: false,
        startedAt: at('2024-01-01T00:00:00Z'),
        endedAt: null,
        durationSec: null,
        lastHeartbeatAt: null,
        startedBy: 'watcher',
        datePrecision: 'datetime',
        note: null,
      },
    ],
    spend: 0,
  };
  return {
    ...gameRow(id(1)),
    canMoveToPlan: false,
    totalHours: 1,
    currentState: 'started',
    isLive: false,
    totalSpend: 0,
    costPerHour: null,
    stateHistory: [
      {
        id: id(20),
        iterationId: id(10),
        type: 'started',
        occurredAt: at('2024-01-01T00:00:00Z'),
        datePrecision: 'day',
        note: null,
      },
    ],
    spendHistory: [
      {
        id: id(40),
        gameId: id(1),
        type: 'purchase',
        amount: 10,
        occurredAt: at('2024-01-01T00:00:00Z'),
        datePrecision: 'day',
        note: null,
      },
    ],
    iterations: [iteration],
  };
};

const listItem = <Id extends EntityIdLike>(id: (n: number) => Id): PlannedGameItem<Id> => ({
  id: id(1),
  igdbId: null,
  steamAppId: null,
  title: 'Juego',
  coverUrl: null,
  heroUrl: null,
  genres: null,
  isEmulated: false,
  endless: false,
  releaseYear: null,
  totalHours: 0,
  addedAt: at('2024-01-01T00:00:00Z'),
  promotedAt: null,
  hltbMain: null,
  hltbMainExtras: null,
  hltbCompletionist: null,
  executablePath: null,
  manualIterations: [{ iterationId: id(10), hours: 1, year: 2024 }],
  currentState: null,
  lastPlayedAt: null,
  isLive: false,
  liveSince: null,
  sessionCount: 0,
  planPinnedAt: null,
  summary: null,
  planNote: null,
  releaseDate: null,
  releaseDatePrecision: null,
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
  steamPositive: null,
  steamNegative: null,
  steamTags: null,
});

const achievement = <Id extends EntityIdLike>(id: (n: number) => Id): AchievementEntry<Id> => ({
  id: id(5),
  apiName: 'ACH',
  displayName: 'Logro',
  description: null,
  iconUrl: null,
  iconGrayUrl: null,
  hidden: false,
  globalPercent: null,
  unlockedAt: null,
  dateReliable: true,
  sources: ['steam'],
  sessionId: id(30),
  iterationId: null,
});

const closedEvent = <Id extends EntityIdLike>(id: (n: number) => Id): SessionClosedEvent<Id> => ({
  sessionId: id(30),
  gameId: id(1),
  iterationId: id(10),
  endless: false,
  gameTitle: 'Juego',
  coverUrl: null,
  heroUrl: null,
  durationSec: 60,
  totalHours: 1,
  isLongest: false,
});

// ── COMPILACIÓN: las dos representaciones, y la mezcla rechazada ───────────
//
// Igualdad EXACTA de tipos (no solo asignabilidad en un sentido).
type SameType<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
//
// Nada de esto se ejecuta: es para el typecheck. Está dentro de una función que
// nadie llama para que las llamadas "mezcladas" no revienten en ejecución.
export const compileTimeChecks = (): void => {
  // Sin parámetro, los DTOs son los de siempre: GameRow ES GameRow<EntityId>,
  // sea EntityId lo que sea (así esto sigue compilando el día del cambio).
  const sameAsDefault: [
    SameType<GameRow, GameRow<EntityId>>,
    SameType<GameListItem, GameListItem<EntityId>>,
    SameType<GameDetail, GameDetail<EntityId>>,
    SameType<SessionClosedEvent, SessionClosedEvent<EntityId>>,
  ] = [true, true, true, true];
  const numberRow: GameRow<number> = gameRow(asNumber(1));
  const numberItem: GameListItem<number> = listItem(asNumber);
  const textDetail: GameDetail<string> = gameDetailDto(asText);
  const textSummary: StateEventSummary<string> = {
    id: asText(20),
    gameId: asText(1),
    iterationId: asText(10),
    type: 'started',
    occurredAt: at('2024-01-01T00:00:00Z'),
    datePrecision: 'day',
    iterationLabel: 'Playthrough 1',
  };
  void [
    sameAsDefault,
    numberRow,
    numberItem,
    textDetail,
    textSummary,
    achievement(asText),
    closedEvent(asText),
  ];

  // @ts-expect-error un DTO de texto no admite un id numérico dentro
  const mixedDetail: GameDetail<string> = gameDetailDto(asNumber);
  // @ts-expect-error ni al revés: un GameRow numérico no admite texto
  const mixedRow: GameRow<number> = gameRow(asText(1));
  void [mixedDetail, mixedRow];

  // Comparadores: cualquiera de las dos, nunca las dos a la vez.
  compareByCreation(1, 2);
  compareByCreation('a', 'b');
  compareEntityIds(asText(1), asText(2));
  // @ts-expect-error mezclar representaciones no ordena nada
  compareByCreation(1, 'b');
  // @ts-expect-error tampoco en el orden sin significado
  compareEntityIds(asText(1), 2);

  const n = { lib: libraryInput(asNumber), det: detailInput(asNumber), hrs: hoursInput(asNumber) };
  const t = { lib: libraryInput(asText), det: detailInput(asText), hrs: hoursInput(asText) };
  const nSpend = spendInput(asNumber);
  const tSpend = spendInput(asText);
  const nPin = pinInput(asNumber);
  const tPin = pinInput(asText);
  const nMem = memoryInput(asNumber);
  const tMem = memoryInput(asText);
  const nPlay = playthroughInput(asNumber, 'started');
  const tPlay = playthroughInput(asText, 'started');

  // El tipo del resultado sigue a la representación de la entrada.
  const nLibrary: Map<number, unknown> = deriveLibrary(n.lib);
  const tLibrary: Map<string, unknown> = deriveLibrary(t.lib);
  const nSpendSplit: Map<number, number> = splitSpendByPlaythrough(
    nSpend.iterations,
    nSpend.events,
    nSpend.spends,
  );
  const tSpendSplit: Map<string, number> = splitSpendByPlaythrough(
    tSpend.iterations,
    tSpend.events,
    tSpend.spends,
  );
  const nHours: Map<number, number> = hoursByGameInYear(
    n.hrs.gameIds,
    n.hrs.sessions,
    n.hrs.manual,
    2024,
  );
  const tHours: Map<string, number> = hoursByGameInYear(
    t.hrs.gameIds,
    t.hrs.sessions,
    t.hrs.manual,
    2024,
  );
  const nPins: Map<number, number> = redistributePinStamps(nPin.rows, nPin.orderedIds);
  const tPins: Map<string, number> = redistributePinStamps(tPin.rows, tPin.orderedIds);
  const nDecision = resolvePlaythroughForPlay(nPlay);
  const tDecision = resolvePlaythroughForPlay(tPlay);
  const nIterationId: number | undefined =
    nDecision.kind === 'create' ? undefined : nDecision.iterationId;
  const tIterationId: string | undefined =
    tDecision.kind === 'create' ? undefined : tDecision.iterationId;
  const nMoments = deriveMoments(nMem.sessions, nMem.manualHours);
  const tMoments = deriveMoments(tMem.sessions, tMem.manualHours);
  const nBySession: Map<number, unknown> = momentsBySession(nMoments);
  const tBySession: Map<string, unknown> = momentsBySession(tMoments);
  const scope = { type: 'month', year: 2024, month: 2 } as const;
  const now = at('2025-01-01T00:00:00');
  const nChapter = buildChapter(scope, nMem.sessions, nMem.events, nMem.titles, nMoments, now);
  const tChapter = buildChapter(scope, tMem.sessions, tMem.events, tMem.titles, tMoments, now);
  const tDominant: string | undefined = tChapter?.dominant?.gameId;
  void [nLibrary, tLibrary, nSpendSplit, tSpendSplit, nHours, tHours, nPins, tPins];
  void [nIterationId, tIterationId, nBySession, tBySession, tDominant];
  if (nChapter) canonicalChapterFacts(nChapter);
  if (tChapter) canonicalChapterFacts(tChapter);
  listClosedPeriodsWithActivity(nMem.sessions, nMem.events, now, nMem.manualBlocks);
  listClosedPeriodsWithActivity(tMem.sessions, tMem.events, now, tMem.manualBlocks);
  deriveGameDetail(n.det);
  deriveGameDetail(t.det);
  latestRealStateEvent(t.det.stateEvents);
  playthroughClosedAt(tSpend.events.get(asText(10)) ?? []);
  mergeUnlocksByAchievement(unlockInput(asText));
  planPinOrder([{ id: asText(1), planPinnedAt: null }], [asText(1)]);

  // Y mezclar las dos representaciones en UNA llamada no compila. Una línea
  // por caso: el error tiene que caer en la línea siguiente al comentario.
  const mixedLibrary = { ...n.lib, iterations: t.lib.iterations };
  // @ts-expect-error biblioteca: juegos numéricos con playthroughs de texto
  deriveLibrary(mixedLibrary);
  const mixedDetailInput = { ...t.det, stateEvents: n.det.stateEvents };
  // @ts-expect-error ficha: playthroughs de texto con eventos numéricos
  deriveGameDetail(mixedDetailInput);
  // @ts-expect-error gasto: playthroughs numéricos con eventos de texto
  splitSpendByPlaythrough(nSpend.iterations, tSpend.events, nSpend.spends);
  // @ts-expect-error horas del año: juegos de texto con sesiones numéricas
  hoursByGameInYear(t.hrs.gameIds, n.hrs.sessions, t.hrs.manual, 2024);
  // @ts-expect-error reparto del Plan: filas numéricas con un orden de texto
  redistributePinStamps(nPin.rows, tPin.orderedIds);
  const mixedPlay = { ...nPlay, events: tPlay.events };
  // @ts-expect-error playthrough: playthroughs numéricos con eventos de texto
  resolvePlaythroughForPlay(mixedPlay);
  // @ts-expect-error momentos: sesiones de texto con horas manuales numéricas
  deriveMoments(tMem.sessions, nMem.manualHours);
  // @ts-expect-error capítulo: sesiones numéricas con títulos de texto
  buildChapter(scope, nMem.sessions, nMem.events, tMem.titles, nMoments, now);
};

// ── EJECUCIÓN: mismo resultado con texto que con enteros ───────────────────

describe('las funciones de entityIds aceptan las dos representaciones', () => {
  it('compareByCreation da el mismo signo que la resta con enteros', () => {
    for (const [a, b] of [
      [1, 2],
      [2, 1],
      [7, 7],
      [10, 9],
    ]) {
      assert.equal(Math.sign(compareByCreation(a, b)), Math.sign(a - b));
      assert.equal(Math.sign(compareEntityIds(a, b)), Math.sign(a - b));
    }
  });

  it('con UUIDv7 en minúsculas, el orden del texto es el de creación', () => {
    for (let a = 0; a < TEXT_IDS.length; a++) {
      for (let b = 0; b < TEXT_IDS.length; b++) {
        assert.equal(Math.sign(compareByCreation(asText(a), asText(b))), Math.sign(a - b));
      }
    }
    // Y dentro del mismo milisegundo también (el generador incrementa).
    const burst = Array.from({ length: 20 }, () => uuidv7(BASE_MS + 999_000));
    assert.deepEqual([...burst].sort(compareByCreation), burst);
  });

  it('entityIdSeed: un entero es su propia semilla; un texto, un hash estable de 32 bits', () => {
    assert.equal(entityIdSeed(42), 42);
    const seed = entityIdSeed(asText(1));
    assert.equal(seed, entityIdSeed(asText(1)));
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
    assert.notEqual(entityIdSeed(asText(1)), entityIdSeed(asText(2)));
    // FNV-1a de 32 bits: valores de referencia conocidos.
    assert.equal(entityIdSeed(''), 0x811c9dc5);
    assert.equal(entityIdSeed('a'), 0xe40c292c);
  });

  it('entityIdToString vale para las dos', () => {
    assert.equal(entityIdToString(12), '12');
    assert.equal(entityIdToString(asText(3)), asText(3));
  });
});

describe('las reglas dan lo mismo con ids de texto que con enteros', () => {
  it('latestRealStateEvent desempata por id igual', () => {
    const n = latestRealStateEvent(libraryInput(asNumber).stateEvents.slice(0, 2));
    const t = latestRealStateEvent(libraryInput(asText).stateEvents.slice(0, 2));
    assert.equal(n?.type, 'dropped');
    assert.equal(canon(t), canon(n));
  });

  it('deriveLibrary: mismas horas (mismo orden de suma), estado y en vivo', () => {
    const n = deriveLibrary(libraryInput(asNumber));
    const t = deriveLibrary(libraryInput(asText));
    assert.equal(n.get(1)?.currentState, 'dropped');
    assert.equal(n.get(2)?.isLive, true);
    assert.equal(canon(t), canon(n));
  });

  it('deriveGameDetail: mismos playthroughs, fechas, estado, gasto y primer plan', () => {
    const n = deriveGameDetail(detailInput(asNumber));
    const t = deriveGameDetail(detailInput(asText));
    assert.deepEqual(
      n.iterations.map((iteration) => iteration.iteration.id),
      [10, 11],
    );
    assert.equal(n.iterations[1].currentState, 'started');
    assert.equal(n.firstPlanEvent?.id, 21);
    assert.equal(canon(t), canon(n));
  });

  it('splitSpendByPlaythrough y playthroughClosedAt reparten igual', () => {
    const nInput = spendInput(asNumber);
    const tInput = spendInput(asText);
    const n = splitSpendByPlaythrough(nInput.iterations, nInput.events, nInput.spends);
    const t = splitSpendByPlaythrough(tInput.iterations, tInput.events, tInput.spends);
    assert.equal(canon(t), canon(n));
    // El started del mismo instante y id más alto reabre el 10: se queda todo
    // lo de febrero.
    assert.equal(playthroughClosedAt(nInput.events.get(10) ?? []), null);
    assert.equal(playthroughClosedAt(tInput.events.get(asText(10)) ?? []), null);
  });

  it('hoursByGameInYear: mismos juegos, en el mismo orden, con las mismas horas', () => {
    const nInput = hoursInput(asNumber);
    const tInput = hoursInput(asText);
    const n = hoursByGameInYear(nInput.gameIds, nInput.sessions, nInput.manual, 2024, 'UTC');
    const t = hoursByGameInYear(tInput.gameIds, tInput.sessions, tInput.manual, 2024, 'UTC');
    assert.deepEqual(
      [...n],
      [
        [2, 0.5],
        [1, 5.5],
      ],
    );
    assert.equal(canon(t), canon(n));
  });

  it('resolvePlaythroughForPlay decide lo mismo, también cuando decide un desempate', () => {
    for (const lastWins of ['on_hold', 'started'] as const) {
      const n = resolvePlaythroughForPlay(playthroughInput(asNumber, lastWins));
      const t = resolvePlaythroughForPlay(playthroughInput(asText, lastWins));
      assert.equal(n.kind, lastWins === 'on_hold' ? 'resume' : 'use');
      assert.equal(canon(t), canon(n));
    }
  });

  it('redistributePinStamps y planPinOrder reparten las mismas marcas', () => {
    const nInput = pinInput(asNumber);
    const tInput = pinInput(asText);
    const n = redistributePinStamps(nInput.rows, nInput.orderedIds);
    assert.deepEqual(
      [...n],
      [
        [3, 100],
        [1, 101],
        [2, 300],
      ],
    );
    assert.equal(canon(redistributePinStamps(tInput.rows, tInput.orderedIds)), canon(n));

    const toGames = <Id extends EntityIdLike>(
      rows: PinnedPlanRow<Id>[],
    ): { id: Id; planPinnedAt: Date | null }[] =>
      rows.map((row) => ({
        id: row.id,
        planPinnedAt: row.pinnedAt === null ? null : new Date(row.pinnedAt),
      }));
    assert.equal(
      canon(planPinOrder(toGames(tInput.rows), tInput.orderedIds)),
      canon(planPinOrder(toGames(nInput.rows), nInput.orderedIds)),
    );
  });

  it('mergeUnlocksByAchievement elige la misma fila', () => {
    const n = mergeUnlocksByAchievement(unlockInput(asNumber));
    const t = mergeUnlocksByAchievement(unlockInput(asText));
    assert.equal(n.get(5)?.winner.source, 'steam');
    assert.equal(n.get(6)?.winner.source, 'ra');
    assert.equal(canon(t), canon(n));
  });

  it('deriveMoments y momentsBySession: mismos momentos, mismo desempate por sesión', () => {
    const nInput = memoryInput(asNumber);
    const tInput = memoryInput(asText);
    const n = deriveMoments(nInput.sessions, nInput.manualHours);
    const t = deriveMoments(tInput.sessions, tInput.manualHours);
    assert.ok(n.some((moment) => moment.type === 'return'));
    assert.ok(n.some((moment) => moment.type === 'longest_session'));
    assert.equal(canon(t), canon(n));
    assert.equal(canon(momentsBySession(t)), canon(momentsBySession(n)));
  });

  it('buildChapter, canonicalChapterFacts y listClosedPeriodsWithActivity cuentan lo mismo', () => {
    const scope = { type: 'month', year: 2024, month: 2 } as const;
    const now = at('2025-01-01T00:00:00');
    const build = <Id extends EntityIdLike>(
      id: (n: number) => Id,
    ): { chapter: Chapter<Id> | null; periods: unknown } => {
      const input = memoryInput(id);
      const moments = deriveMoments(input.sessions, input.manualHours);
      const chapter = buildChapter(
        scope,
        input.sessions,
        input.events,
        input.titles,
        moments,
        now,
        input.manualBlocks,
        input.unlocks,
      );
      const periods = listClosedPeriodsWithActivity(
        input.sessions,
        input.events,
        now,
        input.manualBlocks,
      );
      return { chapter, periods };
    };
    const n = build(asNumber);
    const t = build(asText);
    assert.ok(n.chapter && t.chapter);
    // Los dos juegos empatan en horas y sesiones: desempata el id del juego.
    assert.deepEqual(
      n.chapter.games.map((game) => game.gameId),
      [1, 2],
    );
    assert.equal(canon(t), canon(n));
    for (const generation of ['full', 'noAchievements', 'noDecisions'] as const) {
      assert.equal(
        unText(canonicalChapterFacts(t.chapter, generation)),
        canonicalChapterFacts(n.chapter, generation),
      );
    }
  });
});

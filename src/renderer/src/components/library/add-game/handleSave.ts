import type {
  CreateGameWithDetailsInput,
  GameDetail,
  GameRow,
  IgdbSearchResult,
} from '../../../../../shared/types';
// Imports de valor (no `import type`): estos hooks solo se usan aquí dentro
// de `ReturnType<typeof ...>`, y TypeScript no permite `typeof` sobre un
// binding importado como type-only (TS1361).
import {
  useCreateGameWithDetails,
  useCreatePlannedGame,
  usePromotePlannedGame,
} from '../../../hooks/games';
import { useCreateIteration } from '../../../hooks/iterations';
import { useAssignSession } from '../../../hooks/sessions';
import { useAddStateEvent } from '../../../hooks/stateEvents';
import type { PastStatusKey } from '../../../lib/gameStatus';
import { STATUS_TO_STATE_TYPE } from '../../../lib/gameStatus';
import { parseIsoDate } from './precisionDate';
import type { PrecisionDateValue } from './precisionDate';
import { parseOptionalNumber } from './types';
import type { AddGameFormValues, ManualPlaythroughEntry } from './types';

// Los pasos de handleSave (AddGameModal), extraídos como funciones con
// nombre — uno de los tres caminos mutuamente excluyentes que puede tomar el
// guardado (Plan to Play / promover un Plan / alta normal), más el
// constructor puro de `details` (compartido por promover y alta normal) y el
// loop de playthroughs extra. El orden de los `await` DENTRO de cada función
// es el mismo que tenía el bloque original.

// parseIsoDate (medianoche LOCAL) y no new Date(isoDate) a secas: ese parseo
// interpreta la fecha como medianoche UTC y era la única vía de guardado de
// la app que difería del resto (Edit Game, gastos, historial ya guardaban en
// local) — misma fecha elegida, timestamps distintos según el modal.
const toBackendDate = (
  value: AddGameFormValues['started'],
): { date: Date; precision: 'year' | 'month' | 'day' } | null =>
  value ? { date: parseIsoDate(value.isoDate), precision: value.precision } : null;

// Constructor puro (sin mutations) del payload que tanto promote.mutateAsync
// como createGame.mutateAsync esperan — solo tiene sentido fuera del modo
// Plan to Play (que no lleva playthrough todavía).
export const buildGameDetails = (
  values: AddGameFormValues,
): Omit<CreateGameWithDetailsInput, 'igdbId'> => {
  const initialStatus = values.playedBefore
    ? STATUS_TO_STATE_TYPE[values.pastStatus]
    : values.endless
      ? 'resting'
      : null;

  return {
    endless: values.endless,
    isEmulated: values.isEmulated,
    iteration: {
      playedPlatform: values.platform,
      origin: values.origin,
      format: values.format,
    },
    hoursPlayed: values.playedBefore ? parseOptionalNumber(values.hoursPlayed) : null,
    started: values.playedBefore && !values.endless ? toBackendDate(values.started) : null,
    finished: values.playedBefore && !values.endless ? toBackendDate(values.finished) : null,
    initialStatus,
    note: values.note.trim() || null,
    gameNotes: values.gameNotes.trim() || null,
    moneySpent: values.origin === 'Purchased' ? parseOptionalNumber(values.moneySpent) : null,
    moneySpentDate: values.origin === 'Purchased' ? toBackendDate(values.moneySpentDate) : null,
    // Un juego emulado no tiene .exe propio (el campo ni se muestra) — si
    // quedó un valor de antes de marcar el checkbox, no debe viajar.
    executablePath: values.isEmulated ? null : values.executablePath.trim() || null,
    installDirectory: values.installDirectory.trim() || null,
    installSizeBytes: values.installDirectory.trim() ? values.installSizeBytes : null,
    coverUrl: values.coverUrl,
    heroUrl: values.heroUrl,
    steamGridDbId: values.steamGridDbId,
  };
};

type ManualPlaythroughMutations = {
  addIteration: ReturnType<typeof useCreateIteration>;
  addStateEvent: ReturnType<typeof useAddStateEvent>;
};

// Forma mínima que necesita addManualPlaythrough — no ManualPlaythroughEntry
// directamente, porque EditGameModal reusa esta misma función para su modo
// "+ Add manual" (iterationMode === 'new') con SU forma de campos
// (EditGameFormValues), que nombra el estado `status` en vez de `pastStatus`.
// Cada caller adapta su propio tipo a este en la llamada.
export type ManualPlaythroughInput = {
  label: string;
  platform: string;
  origin: string;
  format: 'digital' | 'physical';
  hoursPlayed: string;
  status: PastStatusKey;
  started: PrecisionDateValue | null;
  finished: PrecisionDateValue | null;
};

// Un playthrough manual DE MÁS, más allá del primero (que createGame/
// promote ya crean junto al propio juego) — mismo guion que EditGameModal
// usa en su modo "+ Add manual": iteración + log de estados. Modelo v2: las
// fechas del playthrough SON sus eventos, no hay sesiones marcadoras.
// Compartida por AddGameModal (extraPlaythroughs) y EditGameModal
// (iterationMode === 'new') — antes eran ~25 líneas de lógica idéntica
// duplicadas en los dos modales.
export const addManualPlaythrough = async (
  gameId: number,
  entry: ManualPlaythroughInput,
  mutations: ManualPlaythroughMutations,
): Promise<void> => {
  const { addIteration, addStateEvent } = mutations;

  const iteration = await addIteration.mutateAsync({
    gameId,
    label: entry.label.trim() || null,
    playedPlatform: entry.platform,
    origin: entry.origin,
    format: entry.format,
    manualTotalPlayed: parseOptionalNumber(entry.hoursPlayed),
  });

  const isOngoing = entry.status === 'playing';

  // SPEC 4.5 — el log de una iteración siempre arranca por "started" antes
  // de un estado terminal (mismo guion que writeInitialPlaythrough.ts).
  if (entry.started && STATUS_TO_STATE_TYPE[entry.status] !== 'started') {
    await addStateEvent.mutateAsync({
      iterationId: iteration.id,
      type: 'started',
      occurredAt: parseIsoDate(entry.started.isoDate),
      datePrecision: entry.started.precision,
      note: null,
    });
  }

  const anchorDate = (!isOngoing ? entry.finished : null) ?? entry.started;
  await addStateEvent.mutateAsync({
    iterationId: iteration.id,
    type: STATUS_TO_STATE_TYPE[entry.status],
    occurredAt: anchorDate ? parseIsoDate(anchorDate.isoDate) : new Date(),
    datePrecision: anchorDate?.precision ?? 'day',
    note: null,
  });
};

// Alta reducida (Plan to Play): un juego planeado no tiene playthrough real
// todavía — solo el juego elegido, las imágenes y las notas.
export const savePlannedGame = async (
  selected: IgdbSearchResult,
  values: AddGameFormValues,
  createPlanned: ReturnType<typeof useCreatePlannedGame>,
): Promise<GameRow> =>
  createPlanned.mutateAsync({
    igdbId: selected.igdbId,
    note: values.note.trim() || null,
    gameNotes: values.gameNotes.trim() || null,
    coverUrl: values.coverUrl,
    heroUrl: values.heroUrl,
    steamGridDbId: values.steamGridDbId,
  });

type PromotedGameMutations = {
  promote: ReturnType<typeof usePromotePlannedGame>;
  addIteration: ReturnType<typeof useCreateIteration>;
  addStateEvent: ReturnType<typeof useAddStateEvent>;
};

export const savePromotedGame = async (
  promoteGame: GameDetail,
  details: Omit<CreateGameWithDetailsInput, 'igdbId'>,
  extraPlaythroughs: ManualPlaythroughEntry[],
  mutations: PromotedGameMutations,
): Promise<void> => {
  const { promote, addIteration, addStateEvent } = mutations;

  await promote.mutateAsync({ gameId: promoteGame.id, ...details });
  for (const entry of extraPlaythroughs) {
    await addManualPlaythrough(
      promoteGame.id,
      { ...entry, status: entry.pastStatus },
      { addIteration, addStateEvent },
    );
  }
};

type NewLibraryGameMutations = {
  createGame: ReturnType<typeof useCreateGameWithDetails>;
  assignSession: ReturnType<typeof useAssignSession>;
  addIteration: ReturnType<typeof useCreateIteration>;
  addStateEvent: ReturnType<typeof useAddStateEvent>;
};

export const saveNewLibraryGame = async (
  selected: IgdbSearchResult,
  details: Omit<CreateGameWithDetailsInput, 'igdbId'>,
  extraPlaythroughs: ManualPlaythroughEntry[],
  assignSessionId: number | undefined,
  mutations: NewLibraryGameMutations,
): Promise<GameRow> => {
  const { createGame, assignSession, addIteration, addStateEvent } = mutations;

  const created = await createGame.mutateAsync({ igdbId: selected.igdbId, ...details });

  // Flujo "+ Add new game" del modal de asignación (EMULADORES.md §6): la
  // sesión pendiente que lo originó se asigna sola al juego recién creado.
  if (assignSessionId !== undefined) {
    await assignSession.mutateAsync({ sessionId: assignSessionId, gameId: created.id });
  }

  for (const entry of extraPlaythroughs) {
    await addManualPlaythrough(
      created.id,
      { ...entry, status: entry.pastStatus },
      { addIteration, addStateEvent },
    );
  }

  return created;
};

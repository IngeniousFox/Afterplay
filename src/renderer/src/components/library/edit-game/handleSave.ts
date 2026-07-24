import type { GameDetail } from '../../../../../shared/types';
// Imports de valor (no `import type`): estos hooks solo se usan aquí dentro
// de `ReturnType<typeof ...>`, y TypeScript no permite `typeof` sobre un
// binding importado como type-only (TS1361).
import { useResetEndlessState, useUpdateGame } from '../../../hooks/games';
import { useCreateIteration, useUpdateIteration } from '../../../hooks/iterations';
import { useAddStateEvent, useUpdateStateEvent } from '../../../hooks/stateEvents';
import { addManualPlaythrough } from '../add-game/handleSave';
import { STATE_TO_STATUS_KEY, STATUS_TO_STATE_TYPE } from '../../../lib/gameStatus';
import { activeOrLastIteration } from '../../../lib/iterations';
import { parseIsoDate } from '../add-game/precisionDate';
import { DEFAULT_FORM_VALUES, parseOptionalNumber } from '../add-game/types';
import { edgeEventPickerValue } from './types';
import type { EditGameFormValues } from './types';

// Los tres pasos de handleSave (EditGameModal), extraídos como funciones con
// nombre — cada uno es uno de los tres caminos mutuamente excluyentes que
// puede tomar el guardado (endless / nueva iteración / iteración existente),
// más el patch base común a los tres. El orden de los `await` DENTRO de cada
// función es el mismo que tenía el bloque original: hay dependencias de
// datos reales entre ellos (p.ej. `iteration.id` solo existe tras crearla).

export const saveBaseGamePatch = async (
  game: GameDetail,
  values: EditGameFormValues,
  updateGame: ReturnType<typeof useUpdateGame>,
): Promise<void> => {
  await updateGame.mutateAsync({
    id: game.id,
    patch: {
      title: values.title.trim() || game.title,
      installDirectory: values.installDirectory.trim() || null,
      installSizeBytes: values.installDirectory.trim() ? values.installSizeBytes : null,
      // Marcarlo como emulado retira el .exe propio: lo vigilado pasa a
      // ser el emulador, no el juego (EMULADORES.md §5).
      executablePath: values.isEmulated ? null : values.executablePath.trim() || null,
      notes: values.notes.trim() || null,
      endless: values.endless,
      isEmulated: values.isEmulated,
    },
  });
};

type EndlessMutations = {
  resetEndlessState: ReturnType<typeof useResetEndlessState>;
  updateIteration: ReturnType<typeof useUpdateIteration>;
  addIteration: ReturnType<typeof useCreateIteration>;
  addStateEvent: ReturnType<typeof useAddStateEvent>;
};

// ── Juego endless ──────────────────────────────────────────────────────
// Convertirlo desde normal limpia los desenlaces y marcadores de partida
// discreta CONSERVANDO las sesiones trackeadas y las horas manuales (ver
// resetEndlessState) — sin esto el juego seguía saliendo como "Beaten" por
// un playthrough que conceptualmente ya no existe, pero borrar iteraciones
// enteras se llevaba lo medido por el watcher.
export const saveEndlessIteration = async (
  game: GameDetail,
  values: EditGameFormValues,
  mutations: EndlessMutations,
): Promise<void> => {
  const { resetEndlessState, updateIteration, addIteration, addStateEvent } = mutations;

  const converting = !game.endless;
  if (converting) {
    await resetEndlessState.mutateAsync(game.id);
  }

  // El playthrough CONTENEDOR del endless (el que agrupa sesiones, horas
  // manuales y estado — mismo shape que crea Add Game): se actualiza el
  // existente o se crea uno si no hay ninguno.
  const container = activeOrLastIteration(game.iterations);
  const manualHours = parseOptionalNumber(values.hoursPlayed);

  if (container) {
    await updateIteration.mutateAsync({
      id: container.id,
      patch: { manualTotalPlayed: manualHours },
    });
    // Tras una conversión el historial acaba de limpiarse entero (el
    // currentState del prop es una foto vieja) — el estado elegido se
    // escribe SIEMPRE; sin conversión, solo si cambió de verdad.
    const previousStatus =
      !converting && container.currentState ? STATE_TO_STATUS_KEY[container.currentState] : null;
    if (converting || values.status !== previousStatus) {
      await addStateEvent.mutateAsync({
        iterationId: container.id,
        type: STATUS_TO_STATE_TYPE[values.status],
        occurredAt: new Date(),
        datePrecision: 'datetime',
        note: null,
      });
    }
  } else {
    const iteration = await addIteration.mutateAsync({
      gameId: game.id,
      label: null,
      playedPlatform: values.platform || DEFAULT_FORM_VALUES.platform,
      origin: values.origin || DEFAULT_FORM_VALUES.origin,
      format: values.format,
      manualTotalPlayed: manualHours,
    });
    await addStateEvent.mutateAsync({
      iterationId: iteration.id,
      type: STATUS_TO_STATE_TYPE[values.status],
      occurredAt: new Date(),
      datePrecision: 'datetime',
      note: null,
    });
  }
};

type NewIterationMutations = {
  addIteration: ReturnType<typeof useCreateIteration>;
  addStateEvent: ReturnType<typeof useAddStateEvent>;
};

// Modelo v2: las fechas del playthrough manual SON sus eventos — ya no se
// crean sesiones marcadoras aparte. Misma lógica exacta que AddGameModal
// usa para sus "extraPlaythroughs" (add-game/handleSave.ts) — de ahí que
// delegue en addManualPlaythrough en vez de repetirla.
export const saveNewIteration = async (
  game: GameDetail,
  values: EditGameFormValues,
  mutations: NewIterationMutations,
): Promise<void> => {
  await addManualPlaythrough(
    game.id,
    {
      label: values.label,
      platform: values.platform,
      origin: values.origin,
      format: values.format,
      hoursPlayed: values.hoursPlayed,
      status: values.status,
      started: values.started,
      finished: values.finished,
    },
    mutations,
  );
};

type ExistingIterationMutations = {
  updateIteration: ReturnType<typeof useUpdateIteration>;
  updateStateEvent: ReturnType<typeof useUpdateStateEvent>;
  addStateEvent: ReturnType<typeof useAddStateEvent>;
};

export const saveExistingIteration = async (
  game: GameDetail,
  values: EditGameFormValues,
  iterationId: number,
  mutations: ExistingIterationMutations,
): Promise<void> => {
  const { updateIteration, updateStateEvent, addStateEvent } = mutations;

  await updateIteration.mutateAsync({
    id: iterationId,
    patch: {
      playedPlatform: values.platform,
      origin: values.origin,
      format: values.format,
      extraContent: values.extraContent,
      manualTotalPlayed: parseOptionalNumber(values.hoursPlayed),
      ...(values.label.trim() ? { label: values.label.trim() } : {}),
    },
  });

  const originalIteration = game.iterations.find((it) => it.id === iterationId);

  // Fechas Started/Finished corregidas — modelo v2: la fecha ES el evento,
  // así que corregirla es parchear ese evento. Solo si la fecha era
  // editable (había evento dueño y no venía de una sesión medida — si no,
  // ni siquiera está en el formulario) y el valor cambió de verdad. Un
  // draft a null (borrado con la X del picker) se ignora: quitar una
  // fecha del todo sería borrar el evento, no corregirlo — fuera de
  // alcance aquí (para eso está el History).
  if (originalIteration) {
    const edges = [
      {
        event: originalIteration.startedBySession ? null : originalIteration.startEvent,
        draft: values.started,
      },
      { event: originalIteration.endEvent, draft: values.finished },
    ];
    for (const { event, draft } of edges) {
      if (!event || !draft) continue;
      const original = edgeEventPickerValue(event);
      if (
        original &&
        original.isoDate === draft.isoDate &&
        original.precision === draft.precision
      ) {
        continue;
      }
      await updateStateEvent.mutateAsync({
        id: event.id,
        patch: {
          occurredAt: parseIsoDate(draft.isoDate),
          datePrecision: draft.precision,
        },
      });
    }
  }

  const previousStatus = originalIteration?.currentState
    ? STATE_TO_STATUS_KEY[originalIteration.currentState]
    : null;

  if (values.status !== previousStatus) {
    const newType = STATUS_TO_STATE_TYPE[values.status];
    // Playthrough con desenlace registrado (endEvent), cambiado a otro
    // desenlace terminal (Beaten → Dropped…): se corrige el TIPO de ese
    // mismo evento conservando su fecha, en vez de añadir uno nuevo
    // fechado hoy — que dejaba el Beaten viejo en el historial y un
    // Dropped "de hoy" sin sentido para una partida del pasado.
    const isTerminal = newType === 'completed' || newType === 'dropped' || newType === 'on_hold';
    if (originalIteration?.endEvent && isTerminal) {
      await updateStateEvent.mutateAsync({
        id: originalIteration.endEvent.id,
        patch: { type: newType },
      });
    } else {
      await addStateEvent.mutateAsync({
        iterationId,
        type: newType,
        occurredAt: new Date(),
        datePrecision: 'datetime',
        note: null,
      });
    }
  }
};

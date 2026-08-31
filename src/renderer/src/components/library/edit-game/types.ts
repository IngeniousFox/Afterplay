import type { IterationDetail, IterationEdgeEvent } from '../../../../../shared/types';
import { STATE_TO_STATUS_KEY } from '../../../lib/gameStatus';
import type { PastStatusKey } from '../../../lib/gameStatus';
import type { PrecisionDateValue } from '../add-game/DateWithPrecisionPicker';
import { toPickerValue } from '../add-game/precisionDate';
import type { ManualPlaythroughEntry } from '../add-game/types';

// Formulario único para juego + la iteración que se esté viendo/creando en
// el momento de guardar (SPEC 4.5: "nuevo manual" vs "editar existente" son
// dos modos del MISMO formulario, no dos pantallas separadas).
export type EditGameFormValues = {
  title: string;
  installDirectory: string;
  installSizeBytes: number | null;
  executablePath: string;
  notes: string;
  endless: boolean;
  isEmulated: boolean;

  // Solo dos modos: o se está editando un playthrough YA guardado, o el juego
  // no tiene ninguno todavía. El antiguo modo 'new' desapareció — los nuevos
  // ya no secuestran este formulario de uno en uno, se apilan en
  // `newPlaythroughs` como en Add Game.
  iterationMode: 'none' | 'existing';
  selectedIterationId: number | null;
  // Playthroughs manuales preparados en ESTA edición y todavía sin crear. Se
  // acumulan visualmente y solo se escriben al guardar; a partir de ahí ya son
  // playthroughs normales y aparecen en el desplegable.
  newPlaythroughs: ManualPlaythroughEntry[];
  label: string;
  started: PrecisionDateValue | null;
  finished: PrecisionDateValue | null;
  extraContent: boolean;
  status: PastStatusKey;
  platform: string;
  format: 'digital' | 'physical';
  origin: string;
  hoursPlayed: string;
};

// El valor de picker (fecha+precisión) de un evento de borde del playthrough
// (modelo v2: las fechas viven en el log de estados — ver IterationDetail).
// Un 'datetime' (eventos creados en vivo por la app, con hora real) cae a
// 'day' en el picker, que no maneja horas — pero solo degrada la precisión
// guardada si el usuario TOCA la fecha (EditGameModal solo parchea si
// cambió).
export const edgeEventPickerValue = (
  event: IterationEdgeEvent | null,
): PrecisionDateValue | null =>
  event ? toPickerValue(event.occurredAt, event.datePrecision) : null;

// La parte del formulario que sale de UNA iteración.
export type IterationFormValues = Pick<
  EditGameFormValues,
  | 'label'
  | 'started'
  | 'finished'
  | 'extraContent'
  | 'status'
  | 'platform'
  | 'format'
  | 'origin'
  | 'hoursPlayed'
>;

// El mapeo "iteración -> formulario", en UN solo sitio. Estas mismas nueve
// reglas se escribían a mano en dos: buildDefaults (EditGameModal, al abrir
// el modal) y loadIteration (IterationSection, al cambiar de playthrough en
// el desplegable o tras "Remove playthrough"). Ya habían derivado — para una
// iteración sin currentState, una caía a 'beaten' siempre y la otra a
// 'resting'/'beaten' según el tipo de juego —, y con dos copias cualquier
// campo nuevo (o cualquier cambio de la regla de startedBySession) carga el
// formulario distinto según por dónde hayas llegado a él.
//
// `endless` es el del FORMULARIO (el checkbox), no el del juego en la DB:
// decide el fallback de estado cuando la iteración no tiene ninguno, y ese
// fallback tiene que casar con el dropdown que el usuario tiene DELANTE —
// que sigue al checkbox, no a la fila de games.
export const iterationFormValues = (
  iteration: IterationDetail | null,
  endless: boolean,
): IterationFormValues => ({
  label: iteration?.label ?? '',
  // Modelo v2 — las fechas de borde SON eventos del log. Solo entran al
  // formulario (editables) cuando su dueño es un evento: un inicio que viene
  // de una sesión MEDIDA (startedBySession) se queda fuera (null) y su campo
  // se pinta en solo lectura — una medición no se falsea.
  started:
    iteration && !iteration.startedBySession ? edgeEventPickerValue(iteration.startEvent) : null,
  finished: iteration ? edgeEventPickerValue(iteration.endEvent) : null,
  extraContent: iteration?.extraContent ?? false,
  // El fallback depende del tipo de juego: un endless sin estado arranca en
  // 'resting' (su dropdown ni ofrece 'beaten'). El cast es seguro:
  // currentState sale de latestRealStateEvent, que ignora 'plan_to_play'.
  status: iteration?.currentState
    ? (STATE_TO_STATUS_KEY[iteration.currentState] as PastStatusKey)
    : endless
      ? 'resting'
      : 'beaten',
  platform: iteration?.playedPlatform ?? 'Steam',
  format: iteration?.format ?? 'digital',
  origin: iteration?.origin ?? 'Purchased',
  hoursPlayed:
    iteration?.manualTotalPlayed !== null && iteration?.manualTotalPlayed !== undefined
      ? String(iteration.manualTotalPlayed)
      : '',
});

// EMPTY_ITERATION_FIELDS desapareció con el modo 'new': ya no hace falta
// vaciar el formulario para preparar un playthrough nuevo, porque los nuevos
// viven en su propia lista (`newPlaythroughs`) y arrancan de
// EMPTY_MANUAL_PLAYTHROUGH, el mismo molde que usa Add Game.

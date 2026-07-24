import type { IterationEdgeEvent } from '../../../../../shared/types';
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

// EMPTY_ITERATION_FIELDS desapareció con el modo 'new': ya no hace falta
// vaciar el formulario para preparar un playthrough nuevo, porque los nuevos
// viven en su propia lista (`newPlaythroughs`) y arrancan de
// EMPTY_MANUAL_PLAYTHROUGH, el mismo molde que usa Add Game.

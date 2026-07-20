import type { IterationEdgeEvent } from '../../../../../shared/types';
import type { PastStatusKey } from '../../../lib/gameStatus';
import type { PrecisionDateValue } from '../add-game/DateWithPrecisionPicker';
import { toPickerValue } from '../add-game/precisionDate';

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

  iterationMode: 'none' | 'existing' | 'new';
  selectedIterationId: number | null;
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

export const EMPTY_ITERATION_FIELDS: Pick<
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
> = {
  label: '',
  started: null,
  finished: null,
  extraContent: false,
  status: 'beaten',
  platform: 'Steam',
  format: 'digital',
  origin: 'Purchased',
  hoursPlayed: '',
};

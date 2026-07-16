import type { IterationDetail, Session } from '../../../../../shared/types';
import type { PrecisionDateValue } from '../add-game/DateWithPrecisionPicker';
import { toIsoDate } from '../add-game/precisionDate';
import type { PastStatusKey } from '../add-game/types';

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

// La sesión ancla (startSessionId/endSessionId) de una iteración, pero SOLO
// si es un marcador manual (milestone puesto, duración 0 — los que crea
// "I played this before"): esas fechas las tecleó el usuario y se pueden
// corregir. Un ancla que sea una sesión real trackeada (watcher/Play,
// milestone null) devuelve null — una medición no se edita.
export const milestoneAnchor = (
  iteration: IterationDetail,
  which: 'start' | 'end',
): Session | null => {
  const anchorId = which === 'start' ? iteration.startSessionId : iteration.endSessionId;
  if (anchorId === null) return null;
  const session = iteration.sessions.find((s) => s.id === anchorId) ?? null;
  return session && session.milestone !== null ? session : null;
};

// El valor de picker (fecha+precisión) de un marcador. Los marcadores
// manuales siempre llevan precisión year/month/day, pero por robustez un
// 'datetime' inesperado cae a 'day' (el picker no maneja horas).
export const anchorPickerValue = (session: Session | null): PrecisionDateValue | null =>
  session
    ? {
        precision: session.datePrecision === 'datetime' ? 'day' : session.datePrecision,
        isoDate: toIsoDate(session.startedAt),
      }
    : null;

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

import type { PrecisionDateValue } from '../add-game/DateWithPrecisionPicker';
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

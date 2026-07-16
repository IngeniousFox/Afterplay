import type { StateEvent } from '../../../../../shared/types';
import type { StatusKey } from '../../../lib/gameStatus';
import type { PrecisionDateValue } from './DateWithPrecisionPicker';

export const PLATFORM_OPTIONS = [
  'Steam',
  'PC',
  'EA Play',
  'GOG',
  'Epic',
  'Steam Deck',
  'PlayStation 5',
  'Xbox',
  'Switch',
  'Emulated',
];

export const ORIGIN_OPTIONS = ['Purchased', 'Pirate', 'Gift', 'Subscription'];

export const FORMAT_OPTIONS: { value: 'digital' | 'physical'; label: string }[] = [
  { value: 'digital', label: 'Digital' },
  { value: 'physical', label: 'Physical' },
];

// El dropdown de Status del "jugado antes" nunca ofrece 'unplayed' — ese
// estado es justo lo que pasa cuando NO se marca ese checkbox. Tampoco
// 'plan': a Plan to Play no se puede volver ni elegirlo como estado (solo
// se entra al añadir el juego desde la sección /plan).
export type PastStatusKey = Exclude<StatusKey, 'unplayed' | 'plan'>;
export const NORMAL_STATUS_OPTIONS: PastStatusKey[] = ['beaten', 'dropped', 'playing', 'on_hold'];
// SPEC 10.8 — discrepancia resuelta: el prototipo solo ofrecía Playing/Rest
// para endless, pero la sección 4.5 exige mantener dropped disponible
// también para endless (resting se añade, no sustituye a on_hold/dropped).
export const ENDLESS_STATUS_OPTIONS: PastStatusKey[] = ['playing', 'resting', 'dropped'];

// Vocabulario de la UI (STATUS_META) -> vocabulario de la DB (StateEvent.type).
export const STATUS_TO_STATE_TYPE: Record<PastStatusKey, StateEvent['type']> = {
  playing: 'started',
  beaten: 'completed',
  dropped: 'dropped',
  on_hold: 'on_hold',
  resting: 'resting',
};

export type AddGameFormValues = {
  platform: string;
  origin: string;
  format: 'digital' | 'physical';
  endless: boolean;
  // EMULADORES.md §5 — se juega vía emulador: sin .exe propio que vigilar
  // (el campo se oculta), las sesiones llegan por asignación manual.
  isEmulated: boolean;
  playedBefore: boolean;
  started: PrecisionDateValue | null;
  finished: PrecisionDateValue | null;
  hoursPlayed: string;
  pastStatus: PastStatusKey;
  moneySpent: string;
  // Cuándo se compró — separado del resto de fechas (started/finished, que
  // son de cuándo se jugó): un gasto puede pasar mucho antes de empezar a
  // jugarlo. Precisión propia por si solo recuerdas el mes/año de compra.
  moneySpentDate: PrecisionDateValue | null;
  executablePath: string;
  // Carpeta de instalación + su tamaño ya calculado al elegirla (ver
  // InstallDirectoryField) — installSizeBytes va de la mano, nunca se
  // rellena a mano.
  installDirectory: string;
  installSizeBytes: number | null;
  note: string;
  // Notas generales del juego — independientes del note de arriba (que va
  // al stateEvent inicial). Su desplegable en el modal no depende de
  // playedBefore ni de si hay estado inicial.
  gameNotes: string;
  // Elegidas a mano en el CoverPicker (SPEC 4.6) — null = sin elección
  // propia, el backend usa su propio default (primera candidata de IGDB).
  coverUrl: string | null;
  heroUrl: string | null;
};

export const DEFAULT_FORM_VALUES: AddGameFormValues = {
  platform: 'Steam',
  origin: 'Purchased',
  format: 'digital',
  endless: false,
  isEmulated: false,
  playedBefore: false,
  started: null,
  finished: null,
  hoursPlayed: '',
  pastStatus: 'beaten',
  moneySpent: '',
  moneySpentDate: null,
  executablePath: '',
  installDirectory: '',
  installSizeBytes: null,
  note: '',
  gameNotes: '',
  coverUrl: null,
  heroUrl: null,
};

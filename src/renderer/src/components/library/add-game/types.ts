import type { PastStatusKey } from '../../../lib/gameStatus';
import type { PrecisionDateValue } from './DateWithPrecisionPicker';

export const parseOptionalNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isNaN(value) ? null : value;
};

// Agrupadas por familia (PC/launchers → PlayStation → Xbox → Nintendo →
// Emulated) — el dropdown es filtrable escribiendo, así que la lista puede
// ser larga sin hacer incómodo encontrar nada.
export const PLATFORM_OPTIONS = [
  'Steam',
  'Steam Deck',
  'PC',
  'GOG',
  'Epic',
  'EA Play',
  'Ubisoft Connect',
  'Rockstar Launcher',
  'PlayStation 1',
  'PlayStation 2',
  'PlayStation 3',
  'PlayStation 4',
  'PlayStation 5',
  'PSP',
  'Xbox',
  'Xbox 360',
  'Xbox One',
  'Xbox Series X/S',
  'NES',
  'SNES',
  'Nintendo 64',
  'GameCube',
  'Wii',
  'Wii U',
  'Switch',
  'Switch 2',
  'Game Boy',
  'Game Boy Advance',
  'Nintendo DS',
  'Nintendo 3DS',
  'Emulated',
];

export const ORIGIN_OPTIONS = ['Purchased', 'Pirate', 'Gift', 'Subscription', 'Free to Play'];
// Mismo array, en la forma {value,label} que pide SegmentedButtonGroup — el
// origen es texto plano, así que value y label siempre coinciden.
export const ORIGIN_SEGMENT_OPTIONS = ORIGIN_OPTIONS.map((option) => ({
  value: option,
  label: option,
}));

export const FORMAT_OPTIONS: { value: 'digital' | 'physical'; label: string }[] = [
  { value: 'digital', label: 'Digital' },
  { value: 'physical', label: 'Physical' },
];

// Un playthrough manual DE MÁS (más allá del primero, que vive en los campos
// sueltos started/finished/hoursPlayed/pastStatus de abajo) — mismos campos
// por-iteración que Edit Game pide en su modo "+ Add manual"
// (edit-game/IterationSection.tsx), para que "Add game" pueda registrar de
// entrada más de una partida pasada en vez de tener que añadir el resto
// luego desde Edit.
export type ManualPlaythroughEntry = {
  label: string;
  started: PrecisionDateValue | null;
  finished: PrecisionDateValue | null;
  hoursPlayed: string;
  pastStatus: PastStatusKey;
  platform: string;
  format: 'digital' | 'physical';
  origin: string;
};

export const EMPTY_MANUAL_PLAYTHROUGH: ManualPlaythroughEntry = {
  label: '',
  started: null,
  finished: null,
  hoursPlayed: '',
  pastStatus: 'beaten',
  platform: 'Steam',
  format: 'digital',
  origin: 'Purchased',
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
  // Playthroughs pasados de más, además del de arriba — ver
  // ManualPlaythroughEntry.
  extraPlaythroughs: ManualPlaythroughEntry[];
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
  // Id de SteamGridDB editable a mano — null = el backend lo busca solo por
  // nombre+año (comportamiento de siempre); puesto, se usa tal cual y el
  // CoverPicker busca fotos de ESE juego concreto.
  steamGridDbId: number | null;
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
  extraPlaythroughs: [],
  moneySpent: '',
  moneySpentDate: null,
  executablePath: '',
  installDirectory: '',
  installSizeBytes: null,
  note: '',
  gameNotes: '',
  coverUrl: null,
  heroUrl: null,
  steamGridDbId: null,
};

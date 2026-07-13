import type { StateEvent } from '../../../../../shared/types';
import type { StatusKey } from '../../../lib/gameStatus';
import type { PrecisionDateValue } from './DateWithPrecisionPicker';

export const PLATFORM_OPTIONS = [
  'Steam',
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
// estado es justo lo que pasa cuando NO se marca ese checkbox.
export type PastStatusKey = Exclude<StatusKey, 'unplayed'>;
export const NORMAL_STATUS_OPTIONS: PastStatusKey[] = ['beaten', 'dropped', 'playing', 'on_hold'];
export const ENDLESS_STATUS_OPTIONS: PastStatusKey[] = ['playing', 'resting'];

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
  playedBefore: boolean;
  started: PrecisionDateValue | null;
  finished: PrecisionDateValue | null;
  hoursPlayed: string;
  pastStatus: PastStatusKey;
  moneySpent: string;
  executablePath: string;
  note: string;
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
  playedBefore: false,
  started: null,
  finished: null,
  hoursPlayed: '',
  pastStatus: 'beaten',
  moneySpent: '',
  executablePath: '',
  note: '',
  coverUrl: null,
  heroUrl: null,
};

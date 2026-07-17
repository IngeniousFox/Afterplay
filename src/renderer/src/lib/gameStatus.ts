import { Bookmark, Circle, Moon, Pause, Play, Trophy, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StateEvent } from '../../../shared/types';

export type GameStatusMeta = {
  label: string;
  color: string;
  Icon: LucideIcon;
  // El icono de "play" se pinta relleno en el prototipo; el resto, solo con
  // contorno (el comportamiento por defecto de lucide).
  filled: boolean;
};

export type StatusKey =
  'playing' | 'beaten' | 'dropped' | 'on_hold' | 'resting' | 'unplayed' | 'plan';

// SPEC 10.2 — colores propios del estado del juego. Deliberadamente NO son
// los tokens de tema de shadcn (--primary, --destructive...) aunque algunos
// coincidan de casualidad: esta es una tabla fija de la SPEC, independiente
// de que el tema cambie el día de mañana.
export const STATUS_META: Record<StatusKey, GameStatusMeta> = {
  playing: { label: 'Playing', color: '#2fdc7e', Icon: Play, filled: true },
  beaten: { label: 'Beaten', color: '#e3b24a', Icon: Trophy, filled: false },
  dropped: { label: 'Dropped', color: '#e85d72', Icon: XCircle, filled: false },
  on_hold: { label: 'On Hold', color: '#8b93a3', Icon: Pause, filled: false },
  // Solo para juegos endless (SPEC 10.8) — el equivalente de on_hold cuando
  // no hay una partida concreta que pausar, solo un juego sin final que no se
  // está tocando ahora mismo.
  resting: { label: 'Resting', color: '#7c86c8', Icon: Moon, filled: false },
  unplayed: { label: 'Unplayed', color: '#888f8a', Icon: Circle, filled: false },
  // Sección Plan to Play — un estado "de intención", no de juego: nunca
  // aparece en ningún dropdown de estados (no se puede elegir ni volver a
  // él), solo se muestra en la sección /plan y como entrada del historial.
  plan: { label: 'Plan to play', color: '#85a3d6', Icon: Bookmark, filled: false },
};

// currentState ('started'/'completed'/...) es el vocabulario de la DB; la UI
// usa el del prototipo ('playing'/'beaten'/...) — este mapa traduce entre
// los dos.
export const STATE_TO_STATUS_KEY: Record<StateEvent['type'], StatusKey> = {
  started: 'playing',
  completed: 'beaten',
  dropped: 'dropped',
  on_hold: 'on_hold',
  resting: 'resting',
  plan_to_play: 'plan',
};

export const getGameStatusMeta = (currentState: StateEvent['type'] | null): GameStatusMeta =>
  STATUS_META[currentState === null ? 'unplayed' : STATE_TO_STATUS_KEY[currentState]];

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

import { Circle, Moon, Pause, Play, Trophy, XCircle } from 'lucide-react';
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

export type StatusKey = 'playing' | 'beaten' | 'dropped' | 'on_hold' | 'resting' | 'unplayed';

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
};

export const getGameStatusMeta = (currentState: StateEvent['type'] | null): GameStatusMeta =>
  STATUS_META[currentState === null ? 'unplayed' : STATE_TO_STATUS_KEY[currentState]];

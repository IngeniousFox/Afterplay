import { Bookmark, Circle, Moon, Pause, Play, Trophy, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StateType } from '../api';

// SPEC 10.2 — la tabla de estados del escritorio
// (src/renderer/src/lib/gameStatus.ts), con sus colores e iconos exactos.
// Deliberadamente NO son los tokens del tema aunque el verde coincida: es una
// tabla fija de la SPEC, no algo que deba moverse si el tema cambia.
//
// La diferencia con el escritorio: allí hay dos vocabularios (el de la BD,
// 'started'/'completed', y el de la UI, 'playing'/'beaten') con un mapa entre
// ellos, porque la UI también ESCRIBE estados. Aquí solo se lee, así que se
// indexa directamente por el vocabulario de la BD y el mapa sobra.
export type StatusMeta = {
  label: string;
  color: string;
  Icon: LucideIcon;
  filled: boolean;
};

const UNPLAYED: StatusMeta = { label: 'Unplayed', color: '#888f8a', Icon: Circle, filled: false };

const BY_STATE: Record<StateType, StatusMeta> = {
  started: { label: 'Playing', color: '#2fdc7e', Icon: Play, filled: true },
  completed: { label: 'Beaten', color: '#e3b24a', Icon: Trophy, filled: false },
  dropped: { label: 'Dropped', color: '#e85d72', Icon: XCircle, filled: false },
  on_hold: { label: 'On Hold', color: '#8b93a3', Icon: Pause, filled: false },
  resting: { label: 'Resting', color: '#7c86c8', Icon: Moon, filled: false },
  plan_to_play: { label: 'Plan to play', color: '#85a3d6', Icon: Bookmark, filled: false },
};

export const statusOf = (state: StateType | null): StatusMeta =>
  state === null ? UNPLAYED : BY_STATE[state];

// Acentos de identidad (src/renderer/src/lib/colors.ts).
export const GREEN = '#2fdc7e';
export const AMBER = '#e3b24a';
export const BLUE = '#85a3d6';
export const TEAL = '#2bb6a6';
export const VIOLET = '#7c86c8';

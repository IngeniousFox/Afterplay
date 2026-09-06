import { Bookmark, Circle, Moon, Pause, Play, Trophy, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { leavesEndDate } from '../../../shared/playthroughState';
import type { StateEvent } from '../../../shared/types';
import {
  createStatusMeta,
  STATE_TO_STATUS_KEY,
  type StatusKey,
  type StatusMeta,
} from '../../../shared/gameStatus';

export type { StatusKey } from '../../../shared/gameStatus';
export { STATE_TO_STATUS_KEY } from '../../../shared/gameStatus';
export type GameStatusMeta = StatusMeta<LucideIcon>;

export const STATUS_META = createStatusMeta({
  Bookmark,
  Circle,
  Moon,
  Pause,
  Play,
  Trophy,
  XCircle,
});

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

// AFTERPLAY-LOOP.md §6 — los botones de "¿y cómo acabó?" del cierre de
// sesión: "sigo jugando" es el defecto y no necesita botón (no tocar nada ya
// lo dice), así que solo se ofrecen los desenlaces. Un juego normal ofrece
// Beaten/Dropped; un endless, Resting — un endless no se "termina".
//
// Aquí, junto a las otras listas de opciones de estado, y no en cada
// pantalla: estaba copiada carácter a carácter en el toast de escritorio y en
// el panel del modo TV, que son el MISMO gesto en dos pieles. Añadir un
// desenlace rápido en uno habría dejado al sofá y al escritorio ofreciendo
// botones distintos para el mismo cierre de sesión, sin que nada avisara.
export const quickStatusOptions = (endless: boolean): PastStatusKey[] =>
  endless ? ['resting'] : ['beaten', 'dropped'];

// Vocabulario de la UI (STATUS_META) -> vocabulario de la DB (StateEvent.type).
export const STATUS_TO_STATE_TYPE: Record<PastStatusKey, StateEvent['type']> = {
  playing: 'started',
  beaten: 'completed',
  dropped: 'dropped',
  on_hold: 'on_hold',
  resting: 'resting',
};

// Estados que dejan una fecha de salida ("Finished / left") — los mismos que
// pueblan endEvent en el main (getGameById). OJO: no todos son finales.
// Beaten/Dropped SÍ cierran el playthrough (isTerminal en iterations.ts);
// On Hold solo lo deja aparcado con fecha — sigue siendo el mismo playthrough
// y volver a Playing es retomarlo, no corregirlo.
//
// DERIVADO de leavesEndDate en vez de escrito a mano: es la misma regla que
// aplica el main, solo que traducida al vocabulario de la UI. Escrita aparte
// eran dos listas que había que acordarse de tocar a la vez.
export const END_EVENT_STATUS_KEYS: PastStatusKey[] = (
  Object.keys(STATUS_TO_STATE_TYPE) as PastStatusKey[]
).filter((key) => leavesEndDate(STATUS_TO_STATE_TYPE[key]));

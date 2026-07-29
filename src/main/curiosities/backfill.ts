import { withDbAccess } from '../db';
import type { PendingCuriositiesGame } from '../db/queries/curiosities/getPendingCuriositiesGames';
import {
  getCuriositiesCounts,
  getPendingCuriositiesGames,
} from '../db/queries/curiosities/getPendingCuriositiesGames';
import type { CuriositiesStatus } from '../../shared/types';
import { enqueueCuriosities, isCuriositiesQueueRunning } from './queue';

// Los dos caminos por los que se piden curiosidades. Ninguno genera nada por
// su cuenta: los dos encolan (ver queue.ts), que es lo que garantiza que un
// juego no se pague dos veces y que las llamadas salgan de una en una.

export const getCuriositiesStatus = async (): Promise<CuriositiesStatus> => {
  const counts = await getCuriositiesCounts();
  return { ...counts, running: isCuriositiesQueueRunning() };
};

// La pasada de Ajustes. Solo lee la lista de pendientes y la encola, así que
// devuelve en milisegundos aunque queden trescientos juegos por delante.
export const runCuriositiesBackfill = async (): Promise<void> => {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const pending = await withDbAccess(() => getPendingCuriositiesGames());
  enqueueCuriosities(pending);
};

// Alta de un juego nuevo: sus curiosidades se generan solas, sin retrasar el
// guardado — mismo espíritu que warmImageCache en ipc/games. Si el juego ya
// estaba encolado (o la clave no está puesta) esto no hace nada.
export const generateCuriositiesInBackground = (game: PendingCuriositiesGame): void => {
  enqueueCuriosities([game]);
};

import type { SourceCompletion } from '../../../../../shared/types';
import type { QueryContext } from '../common/context';
import {
  completedAtOf,
  loadCatalogProgress,
  progressIsComplete,
  progressIsKnown,
  type CatalogProgress,
} from './progress';

// "¿Está completado?" por fuente (decisión R-11): lo que necesita
// `maybeCelebrateCompletion` (steam/notifications/complete.ts:42) y lo que la
// ficha, el resumen y la tarjeta de Ajustes exponen junto a sus totales.
//
// En la 1.x la tarjeta dorada salía cuando "todos los logros del juego"
// constaban, sumando Steam y RA en un solo `countDistinct`. Ahora cada
// catálogo es un hito: un juego con set de RA y logros de Steam puede
// celebrar dos veces, una por cada 100 %, y un 100 % en RA no queda
// escondido por los logros de Steam que te falten.

// La forma (`SourceCompletion`) es la compartida de `shared/types.ts`: la
// devuelven también la ficha de logros (`completion`) y, por fuente, el
// resumen y la tarjeta de Ajustes.
export type { SourceCompletion };

export const toSourceCompletion = (progress: CatalogProgress): SourceCompletion => ({
  source: progress.source,
  total: progress.total,
  unlocked: progress.unlocked.length,
  complete: progressIsComplete(progress),
  known: progressIsKnown(progress),
  completedAt: completedAtOf(progress),
});

/**
 * El completado de cada catálogo vivo de un juego vivo, Steam antes que RA.
 * `[]` si el juego no existe, tiene lápida o no tiene catálogo.
 *
 * Para la celebración: `complete` por fuente, y la clave de la memoria de
 * "ya celebrado" pasa a ser `(gameId, source)` con su `total` (el arreglo de
 * los DLC de complete.ts:29-39 sigue valiendo, ahora por fuente).
 */
export function getGameCompletion(ctx: QueryContext, gameId: string): SourceCompletion[] {
  return loadCatalogProgress(ctx, [gameId])
    .map(toSourceCompletion)
    .sort((a, b) => (a.source === b.source ? 0 : a.source === 'steam' ? -1 : 1));
}

import { and, eq } from 'drizzle-orm';
import { achievementUnlocks } from '../../schema';
import { liveUnlock } from '../common/alive';
import type { QueryContext } from '../common/context';
import { getSessionWindows, placeUnlock } from './placement';

// Volver a colgar de sus sesiones los desbloqueos YA guardados de un juego,
// sin red (steam/syncAchievements.ts:664). Hace falta porque la sesión puede
// aparecer después que el desbloqueo (una asignación a mano de una partida de
// emulador, una corrección de fechas).
//
// Respeta `dateReliable` igual que `storeUnlocks`: son los dos únicos
// escritores de `sessionId`/`playthroughId` y la regla tiene que ser la misma,
// o el segundo deshace la honestidad del primero. Un rescate no se cuelga
// aunque su segundo caiga dentro de una sesión, y el null se ESCRIBE (así se
// descuelga lo que una versión anterior hubiera colgado mal).
//
// En el 2.0 recorre las filas de todos los orígenes (la de emulador de otro
// PC también: la tabla es U, sin dueño, y el rato en que cayó es un dato del
// usuario que cualquiera de sus PCs puede recolocar). Una transacción releyendo
// todo dentro; `store.patch` sin cambios no escribe (F-33).

/**
 * Recoloca los desbloqueos vivos de un juego vivo. Devuelve cuántos quedaron
 * colgados de una sesión distinta de la que tenían (0 si el juego no tiene
 * sesiones, no existe o tiene lápida; como hoy, sin sesiones no se toca nada).
 */
export function replaceUnlockPlacements(ctx: QueryContext, gameId: string): number {
  return ctx.store.transaction(() => {
    const windows = getSessionWindows(ctx, gameId);
    if (windows.length === 0) return 0;
    const now = ctx.now();
    const rows = ctx.db
      .select({
        id: achievementUnlocks.id,
        unlockedAt: achievementUnlocks.unlockedAt,
        dateReliable: achievementUnlocks.dateReliable,
        sessionId: achievementUnlocks.sessionId,
        playthroughId: achievementUnlocks.playthroughId,
      })
      .from(achievementUnlocks)
      .where(and(eq(achievementUnlocks.gameId, gameId), liveUnlock()))
      .all();

    let placed = 0;
    for (const row of rows) {
      const placement = row.dateReliable
        ? placeUnlock(row.unlockedAt, windows, now)
        : { sessionId: null, playthroughId: null };
      if (placement.sessionId === row.sessionId && placement.playthroughId === row.playthroughId) {
        continue;
      }
      ctx.store.patch('achievement_unlocks', row.id, placement);
      if (placement.sessionId !== null && placement.sessionId !== row.sessionId) placed++;
    }
    return placed;
  });
}

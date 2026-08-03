import { count, countDistinct, eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../../db';
import { achievementsTable, achievementUnlocksTable } from '../../db/schema';
import { enqueueAchievementToasts } from './overlay';

// La celebración del 100% (LOGROS-IDEAS.md §3.6): cuando una tanda de
// desbloqueos EN VIVO deja un juego con todos sus logros, cae la tarjeta
// dorada. Solo la llaman los contextos en vivo (cierre de sesión, vigilante
// de emuladores, sondeo de RA) — la pasada masiva por 300 juegos no celebra
// nada: encontrarse un juego que YA estaba al 100% no es noticia de hoy.

// Espera a que el lote de tarjetas normales haya salido (el flush de la cola
// agrupa en ~400ms): la del 100% debe llegar DETRÁS de sus logros, como el
// broche — no fundida en el resumen "N achievements unlocked".
const AFTER_BATCH_MS = 1500;

export const maybeCelebrateCompletion = (
  gameId: number,
  gameTitle: string,
  gameHeroUrl: string | null,
): void => {
  setTimeout(() => {
    void (async () => {
      try {
        const [row] = await withDbAccess(async () =>
          getDb()
            .select({
              total: count(achievementsTable.id),
              unlocked: countDistinct(achievementUnlocksTable.achievementId),
            })
            .from(achievementsTable)
            .leftJoin(
              achievementUnlocksTable,
              eq(achievementUnlocksTable.achievementId, achievementsTable.id),
            )
            .where(eq(achievementsTable.gameId, gameId)),
        );
        if (!row || row.total === 0 || row.unlocked < row.total) return;

        // Solo ASCII en los console.log, convencion de la casa.
        console.log(`[steam] 100% de logros: ${gameTitle}`);
        enqueueAchievementToasts([
          {
            displayName: gameTitle,
            iconUrl: null,
            globalPercent: null,
            gameTitle,
            gameHeroUrl,
            celebration: true,
          },
        ]);
      } catch (error) {
        console.warn('[steam] fallo comprobando el 100%:', error);
      }
    })();
  }, AFTER_BATCH_MS);
};

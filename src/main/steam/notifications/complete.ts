import { countDistinct, eq } from 'drizzle-orm';
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

// Los juegos que YA tienen su tarjeta dorada puesta.
//
// Cada llamada programa SU propia comprobación a AFTER_BATCH_MS y no había
// memoria de nada, así que dos vaciados seguidos del vigilante de emuladores
// —su rebote es de 900 ms, o sea que dos escrituras del crack separadas ~1,1 s
// NO se funden— sacaban dos tarjetas idénticas del mismo 100%: cuando vencía el
// temporizador del primero el último logro ya estaba guardado, y el del segundo
// volvía a ver el juego completo un segundo después. storeUnlocks deduplica el
// LOGRO (y por eso una segunda FUENTE no celebra dos veces); esto deduplica la
// CELEBRACIÓN, que es otra cosa.
//
// Se recuerda CON QUE TOTAL se celebró, no solo que se celebró: un Set a
// secas tenía un agujero con los DLC. Celebras 30/30; un DLC sube el catálogo
// a 40 en un sync (que no pasa por aquí, así que nadie ve el juego
// "incompleto" ni limpia nada); si los 10 nuevos entran luego en UNA sola
// tanda, la única comprobación ya ve 40/40 con la marca puesta — y el
// segundo 100%, que es de verdad, se quedaba sin tarjeta. Comparando el
// total, un catálogo que creció desde la última celebración vuelve a
// celebrar; el mismo total sigue deduplicando los dos vaciados seguidos del
// vigilante. Vive en memoria y se pierde al reiniciar, y da igual: aquí solo
// se llega con desbloqueos NUEVOS, y en un juego ya completo no queda
// ninguno.
const celebratedAtTotal = new Map<number, number>();

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
              // countDistinct, no count: el leftJoin saca una fila por cada
              // (logro, fuente de desbloqueo), así que un logro sacado por
              // Steam Y por emulador contaba DOBLE en el total. total>unlocked
              // se quedaba true incluso al 100% real y la tarjeta dorada no
              // salía nunca — justo en la instalación de doble fuente para la
              // que existe.
              total: countDistinct(achievementsTable.id),
              unlocked: countDistinct(achievementUnlocksTable.achievementId),
            })
            .from(achievementsTable)
            .leftJoin(
              achievementUnlocksTable,
              eq(achievementUnlocksTable.achievementId, achievementsTable.id),
            )
            .where(eq(achievementsTable.gameId, gameId)),
        );
        if (!row || row.total === 0 || row.unlocked < row.total) {
          celebratedAtTotal.delete(gameId);
          return;
        }
        if (celebratedAtTotal.get(gameId) === row.total) return;
        celebratedAtTotal.set(gameId, row.total);

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

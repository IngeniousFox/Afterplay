import { appCtx } from '../../db/v2/appDb';
import { getGameCompletion } from '../../db/v2/queries/achievements';
import { enqueueAchievementToasts } from './overlay';
import type { GameId } from '../../../shared/entityIds';

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
const celebratedAtTotal = new Map<string, number>();

export const maybeCelebrateCompletion = (
  gameId: GameId,
  gameTitle: string,
  gameHeroUrl: string | null,
): void => {
  setTimeout(() => {
    void (async () => {
      try {
        // Por fuente (R-11, decisión del usuario): un 100 % de Steam y uno de
        // RetroAchievements son dos hitos distintos, cada uno con su aviso.
        // La memoria de "ya celebrado" va por (juego, fuente) y guarda el
        // total: un DLC que añade logros reabre el hito.
        const completed = getGameCompletion(appCtx(), gameId).filter((source) => {
          const key = `${gameId}:${source.source}`;
          if (!source.complete || source.total === 0) {
            celebratedAtTotal.delete(key);
            return false;
          }
          if (celebratedAtTotal.get(key) === source.total) return false;
          celebratedAtTotal.set(key, source.total);
          return true;
        });
        if (completed.length === 0) return;

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

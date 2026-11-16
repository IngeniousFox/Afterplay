import { handle } from './contractHandlers';
import { appCtx } from '../db/v2/appDb';
import { getExternalDataCounts } from '../db/v2/queries/external';
import { isExternalRefreshRunning, startExternalRefresh } from '../external/refresh';
import { refreshGameEverything } from '../external/refreshGame';
import { refreshGameRatings } from '../external/refreshRatings';
import type { ExternalDataStatus } from '../igdb/types';
import type { GameId } from '../../shared/entityIds';

// Las dos puertas del refresco de datos externos (PLAN-TO-PLAY.md §5.1). La
// pasada en sí vive en main/external/refresh.ts, con su candado y su progreso:
// aquí solo están las puertas.
export const registerExternalHandlers = (): void => {
  // Estado para la tarjeta de Ajustes — puros COUNT, sin traer filas. Incluye
  // `running` para que una pantalla que se monta con la pasada YA en marcha
  // (abrir Ajustes a mitad, volver al Plan) la vea ocupada desde el primer
  // frame, sin esperar al siguiente evento de progreso.
  handle('external:status', async (): Promise<ExternalDataStatus> => {
    const row = getExternalDataCounts(appCtx());
    return { ...row, running: isExternalRefreshRunning() };
  });

  // Puerta 1 — Ajustes: la biblioteca entera (planeados incluidos, su ficha
  // enseña lo mismo). Mantenimiento, se pulsa de higos a brevas.
  //
  // Devuelve cuántos juegos entran en la pasada y vuelve ENSEGUIDA; lo demás
  // llega por 'external:activity'. Se devuelve la promesa igualmente porque
  // lo que SÍ hace aquí (leer la lista de juegos) puede fallar, y ese error
  // debe llegar al renderer — mismo contrato que curiosities:runBackfill.
  handle('external:refreshAll', (): Promise<number> => startExternalRefresh('all'));

  // Puerta 2 — la cabecera del Plan: solo los planeados. La del día a día,
  // porque son los juegos cuyos datos deciden algo (¿cuánto dura?, ¿merece la
  // pena?, ¿ha salido ya?) y los que más se mueven por debajo.
  handle('external:refreshPlan', (): Promise<number> => startExternalRefresh('plan'));

  // Puerta 3 — la ficha de UN juego. No es una pasada: son cuatro peticiones
  // que tardan segundos, así que va directa y devuelve el parte completo por
  // el propio invoke, sin cola ni canal de eventos. Además de lo que hacen
  // las otras dos puertas, esta refresca los LOGROS, que la pasada de
  // biblioteca no toca (ver refreshGame.ts).
  handle('external:refreshGame', (_event, gameId: GameId) => refreshGameEverything(gameId));

  // Puerta 4 — el ⟳ de la card Ratings: SOLO las tres notas que esa card
  // enseña (IGDB + el % de Steam). Más estrecha que la puerta 3 a propósito:
  // un botón dentro de una card refresca lo que hay en esa card, ni más
  // —nada de logros ni de HowLongToBeat— ni menos.
  handle('external:refreshRatings', (_event, gameId: GameId) => refreshGameRatings(gameId));
};

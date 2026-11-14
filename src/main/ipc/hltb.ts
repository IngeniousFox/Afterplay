import { ipcMain } from 'electron';
import { appCtx } from '../db/v2/appDb';
import { applyHltbRefreshResult, readHltbRefreshTarget } from '../db/v2/queries/external';
import { getHltbTimes } from '../hltb/api';
import type { GameId } from '../../shared/entityIds';

export const registerHltbHandlers = (): void => {
  ipcMain.handle('hltb:getTimes', async (_event, title: string, releaseYear: number | null) => {
    return getHltbTimes(title, releaseYear);
  });

  // Volver a preguntarle a HowLongToBeat por UN juego ya dado de alta.
  //
  // Hace falta porque estos tiempos se piden en el alta
  // (resolveGameEnrichment) y ahí se quedan: la única pasada que vuelve a
  // tocarlos es la repesca de HUÉRFANOS del refresco externo (refresh.ts),
  // que solo mira juegos con los tres tiempos a null — un juego que YA tiene
  // tiempos no lo refresca nada automático. Y sí se mueven —
  // un juego recién salido tiene una media inestable (pocos envíos) que se
  // asienta con los meses, y uno que recibe contenido grande sube. Esa cifra
  // alimenta además la Deuda del Backlog, así que arrastrar estimaciones
  // tempranas de todo el plan desvía el total.
  //
  // Es una sola petición sin clave ni límites agresivos, así que va directa
  // (nada de cola como en los logros) y devuelve ya el resultado.
  //
  // Los DOS tramos que tocan la DB van cada uno en su withDbAccess, con la
  // petición de red FUERA — misma regla que el ciclo del watcher: HLTB puede
  // tardar segundos y retener el candado ahí bloquearía un swap de conexión
  // en caliente (ver attemptSyncUpgrade en db/index.ts) por una espera que no
  // tiene nada que ver con la base de datos.
  ipcMain.handle('hltb:refreshGame', async (_event, gameId: GameId) => {
    // La red fuera de cualquier transacción; la escritura relee el juego
    // (queries/external/hltbRefresh.ts) y respeta lo elegido a mano.
    const game = readHltbRefreshTarget(appCtx(), gameId);
    if (!game) return null;

    const times = await getHltbTimes(game.title, game.releaseYear);
    if (!times) return null;

    applyHltbRefreshResult(appCtx(), gameId, times);
    return times;
  });
};

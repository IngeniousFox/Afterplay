import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import { getAchievementsOverview } from '../db/queries/achievements/getAchievementsOverview';
import { getGameAchievements } from '../db/queries/achievements/getGameAchievements';
import { getSessionUnlocks } from '../db/queries/achievements/getSessionUnlocks';
import { getHiddenDescriptions } from '../steam/hiddenDescriptions';
import {
  getSteamAchievementsStatus,
  queueAchievementsRefreshForGame,
  runAchievementsBackfill,
} from '../steam/backfill';
import { runRaFullResync } from '../ra/backfill';
import { requestAchievementsStop, retryFailedAchievements } from '../steam/queue';
import { replaceUnlockPlacements } from '../steam/syncAchievements';

export const registerAchievementsHandlers = (): void => {
  handleDb('achievements:getForGame', async (_event, gameId: number) => {
    const data = await getGameAchievements(gameId);

    // Los ocultos que siguen mudos tras las dos fuentes propias (la API de
    // Steam nunca los da; el schema local solo cubre juegos de tu cuenta).
    // Solo por esos se pregunta fuera, y solo si el juego está en Steam.
    const missing = data.entries.filter((entry) => entry.hidden && !entry.description);
    if (data.steamAppId === null || missing.length === 0) return data;

    const descriptions = await getHiddenDescriptions(data.steamAppId);
    if (descriptions.size === 0) return data;

    // Se rellena SOLO en la respuesta, nunca en la base de datos: es
    // información de un tercero sobre un juego, no un dato tuyo, y no tiene
    // por qué acabar en tu biblioteca ni viajar a Turso.
    return {
      ...data,
      entries: data.entries.map((entry) =>
        entry.hidden && !entry.description
          ? { ...entry, description: descriptions.get(entry.apiName) ?? null }
          : entry,
      ),
    };
  });

  handleDb('achievements:getStatus', async () => getSteamAchievementsStatus());

  // La vista global para el bloque de trofeos de Stats (LOGROS-IDEAS.md).
  // year=null → All Time; con año, las piezas temporales se acotan a él.
  handleDb('achievements:getOverview', async (_event, year: number | null) =>
    getAchievementsOverview(year),
  );

  // Los desbloqueos colgados de sesiones, para las filas de la pantalla de
  // Sesiones — una consulta para todas en vez de una por juego.
  handleDb('achievements:getSessionUnlocks', async () => getSessionUnlocks());

  // Encola y devuelve cuántos juegos entraron: la sincronización va de uno en
  // uno por la cola (steam/queue.ts) y su progreso viaja por el canal de
  // eventos 'achievements:activity', no por esta respuesta — una pasada de
  // 300 juegos tarda minutos y ningún invoke debe colgarse tanto.
  // El full arrastra también a RetroAchievements: "Sync now" re-sincroniza
  // las DOS fuentes, o el botón mentiría a medias.
  ipcMain.handle('achievements:sync', async (_event, full: boolean) => {
    const steamQueued = await runAchievementsBackfill(full);
    const raQueued = full ? await runRaFullResync() : 0;
    return steamQueued + raQueued;
  });

  ipcMain.handle('achievements:stop', () => {
    requestAchievementsStop();
  });

  // Reintentar solo los que fallaron, sin repetir la pasada entera.
  ipcMain.handle('achievements:retryFailed', () => retryFailedAchievements());

  // Refrescar UN juego desde su ficha. Existe porque el catálogo, una vez
  // traído, no se vuelve a pedir nunca por su cuenta: la pasada del arranque
  // solo mira los que no tienen ninguno, y el "Sync now" de Ajustes son 300 y
  // pico juegos y varios minutos. Un juego vivo (un endless que sigue
  // recibiendo parches, un early access) le añade logros al catálogo con el
  // tiempo, y hasta ahora la única forma de verlos era resincronizarlo todo.
  //
  // Sin aviso flotante a propósito: lo has pedido tú mirando la lista, y la
  // lista se actualiza sola delante de ti — una tarjeta encima sobraría.
  // forceRaRematch: el botón es el "hoy le han publicado set y lo quiero YA"
  // — re-intenta el emparejado de RA aunque ya se hubiera preguntado.
  ipcMain.handle('achievements:refreshGame', (_event, gameId: number) =>
    queueAchievementsRefreshForGame(gameId, { notify: false, forceRaRematch: true }),
  );

  // Recolocar los desbloqueos ya guardados sobre las sesiones actuales, sin
  // tocar la red — para cuando se corrigen fechas o se asigna a mano una
  // sesión de emulador.
  handleDb('achievements:replacePlacements', async (_event, gameId: number) =>
    replaceUnlockPlacements(gameId),
  );
};

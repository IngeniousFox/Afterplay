import { asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { radarGamesTable } from '../db/schema';
import type { RadarGame } from '../../shared/types';
import { handleDb } from './dbHandle';

// El radar de secuelas (PLAN-TO-PLAY.md §4) — lo que la pasada semanal ha
// descubierto, para pintarlo en "On the horizon" del Plan.
export const registerRadarHandlers = (): void => {
  handleDb('radar:list', async (): Promise<RadarGame[]> => {
    const rows = await getDb()
      .select({
        id: radarGamesTable.id,
        igdbId: radarGamesTable.igdbId,
        title: radarGamesTable.title,
        coverUrl: radarGamesTable.coverUrl,
        collectionName: radarGamesTable.collectionName,
        releaseDate: radarGamesTable.releaseDate,
        releaseDatePrecision: radarGamesTable.releaseDatePrecision,
        releaseYear: radarGamesTable.releaseYear,
        discoveredAt: radarGamesTable.discoveredAt,
        dismissedAt: radarGamesTable.dismissedAt,
      })
      .from(radarGamesTable)
      // Los descartados NO viajan al renderer: un descarte es para siempre
      // (§4.3), y mandarlos para filtrarlos allí sería pagar el viaje por
      // algo que nadie va a ver.
      .where(isNull(radarGamesTable.dismissedAt))
      .orderBy(asc(radarGamesTable.releaseDate));
    return rows;
  });

  // Descartar una entrega que no te interesa. No toda secuela de una saga
  // tuya lo es — y una lista que te vuelve a proponer cada semana lo que ya
  // dijiste que no es una lista que se deja de mirar.
  handleDb('radar:dismiss', async (_event, igdbId: number) => {
    await getDb()
      .update(radarGamesTable)
      .set({ dismissedAt: new Date() })
      .where(eq(radarGamesTable.igdbId, igdbId));
    return true;
  });

  // No hay ningún canal para forzar la pasada, y no es un olvido: el radar es
  // lo único automático de todo el documento y así debe seguir (§4).
  //
  // Aquí vivía un ipcMain.handle('radar:runNow') presentado como "la vía de
  // escape para probarlo sin esperar siete días". No lo era: con
  // contextIsolation la página solo ve lo que expone `api` por contextBridge,
  // y ese canal era el único de toda la app sin pareja en preload/ — así que
  // nadie, ni desde DevTools, podía invocarlo. Un canal muerto documentado
  // como si funcionara es peor que no tenerlo.
  //
  // Para forzarla de verdad: poner radarLastRunAt en userData/config.json a
  // cualquier fecha vieja distinta de cero (un 1 vale) — el tic horario ve
  // que hace más de una semana y la lanza.
  //
  // A CERO NO, aunque sea el valor tentador: cero es el que la app usa para
  // "esto no ha corrido nunca", y runRadarPass lo lee como que esta es la
  // primera pasada de la vida — la que siembra en SILENCIO (§4.4). Forzarla
  // así la deja muda: descubre las secuelas, las guarda y no avisa de
  // ninguna, que es justo lo contrario de lo que se quiere al probarla.
};

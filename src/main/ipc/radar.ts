import { asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { radarGamesTable } from '../db/schema';
import { runRadarPass } from '../radar/pass';
import type { RadarGame } from '../../shared/types';
import { handleDb } from './dbHandle';
import { ipcMain } from 'electron';

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

  // Forzar la pasada a mano. No hay botón para esto en la UI a propósito (el
  // radar es lo único automático de todo el documento y así debe seguir),
  // pero existe el canal: es la única forma de probarlo sin esperar siete
  // días, y de recuperarse si una semana falló la red.
  ipcMain.handle('radar:runNow', async () => runRadarPass(true));
};

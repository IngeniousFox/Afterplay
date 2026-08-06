import { ipcMain } from 'electron';
import { isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { isExternalRefreshRunning, startExternalRefresh } from '../external/refresh';
import type { ExternalDataStatus } from '../igdb/types';

// Las dos puertas del refresco de datos externos (PLAN-TO-PLAY.md §5.1). La
// pasada en sí vive en main/external/refresh.ts, con su candado y su progreso:
// aquí solo están las puertas.
export const registerExternalHandlers = (): void => {
  // Estado para la tarjeta de Ajustes — puros COUNT, sin traer filas. Incluye
  // `running` para que una pantalla que se monta con la pasada YA en marcha
  // (abrir Ajustes a mitad, volver al Plan) la vea ocupada desde el primer
  // frame, sin esperar al siguiente evento de progreso.
  ipcMain.handle('external:status', async (): Promise<ExternalDataStatus> => {
    const [row] = await withDbAccess(async () =>
      getDb()
        .select({
          total: sql<number>`count(*)`,
          withRatings: sql<number>`count(*) filter (where ${gamesTable.ratingCritics} is not null or ${gamesTable.ratingUsers} is not null)`,
          withSummary: sql<number>`count(*) filter (where ${isNotNull(gamesTable.summary)})`,
          withFullDate: sql<number>`count(*) filter (where ${isNotNull(gamesTable.releaseDate)})`,
          neverChecked: sql<number>`count(*) filter (where ${isNull(gamesTable.ratingsCheckedAt)})`,
          steamEligible: sql<number>`count(*) filter (where ${isNotNull(gamesTable.steamAppId)})`,
          withSteamData: sql<number>`count(*) filter (where ${isNotNull(gamesTable.steamTags)} or ${isNotNull(gamesTable.steamPositive)})`,
        })
        .from(gamesTable),
    );
    return { ...row, running: isExternalRefreshRunning() };
  });

  // Puerta 1 — Ajustes: la biblioteca entera (planeados incluidos, su ficha
  // enseña lo mismo). Mantenimiento, se pulsa de higos a brevas.
  //
  // Devuelve cuántos juegos entran en la pasada y vuelve ENSEGUIDA; lo demás
  // llega por 'external:activity'. Se devuelve la promesa igualmente porque
  // lo que SÍ hace aquí (leer la lista de juegos) puede fallar, y ese error
  // debe llegar al renderer — mismo contrato que curiosities:runBackfill.
  ipcMain.handle('external:refreshAll', (): Promise<number> => startExternalRefresh('all'));

  // Puerta 2 — la cabecera del Plan: solo los planeados. La del día a día,
  // porque son los juegos cuyos datos deciden algo (¿cuánto dura?, ¿merece la
  // pena?, ¿ha salido ya?) y los que más se mueven por debajo.
  ipcMain.handle('external:refreshPlan', (): Promise<number> => startExternalRefresh('plan'));
};

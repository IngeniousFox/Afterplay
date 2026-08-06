import { ipcMain } from 'electron';
import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { updateGame } from '../db/queries/games/updateGame';
import { gamesTable } from '../db/schema';
import { getCollectionGames, getGameDetails, searchGames } from '../igdb/api';
import type { GameRatings } from '../igdb/types';

export const registerIgdbHandlers = (): void => {
  ipcMain.handle('igdb:search', async (_event, query: string) => {
    return searchGames(query);
  });

  ipcMain.handle('igdb:getById', async (_event, igdbId: number) => {
    return getGameDetails(igdbId);
  });

  // Los juegos de una saga (PLAN-TO-PLAY.md §3.5) — bajo demanda al abrir la
  // ficha, con caché TTL en memoria y SIN tabla: es dato decorativo y volátil.
  // Sin conexión, esto falla y la sección simplemente no se pinta.
  ipcMain.handle('igdb:collectionGames', async (_event, collectionIds: number[]) => {
    return getCollectionGames(collectionIds);
  });

  // Volver a preguntarle a IGDB por las notas de UN juego ya dado de alta.
  //
  // Hace falta por la misma razón que hltb:refreshGame: las notas se piden
  // UNA vez, en el alta, y ahí se quedan — sin esto un juego recién salido
  // (pocos votos, crítica llegando con cuentagotas) se queda clavado en la
  // foto del día que se añadió, y un clásico retro nunca refleja los votos
  // que la comunidad de IGDB sigue sumando años después.
  //
  // Los DOS tramos que tocan la DB van cada uno en su withDbAccess, con la
  // petición de red FUERA — misma regla que hltb:refreshGame: retener el
  // candado durante una llamada a IGDB bloquearía un swap de conexión en
  // caliente por una espera que no tiene nada que ver con la base de datos.
  ipcMain.handle(
    'igdb:refreshRatings',
    async (_event, gameId: number): Promise<GameRatings | null> => {
      const [game] = await withDbAccess(async () =>
        getDb()
          .select({ igdbId: gamesTable.igdbId })
          .from(gamesTable)
          .where(eq(gamesTable.id, gameId))
          .limit(1),
      );
      if (!game) return null;

      const detail = await getGameDetails(game.igdbId);
      // El juego ya no está en el catálogo de IGDB (rarísimo, pero pasa: lo
      // quitaron). No se borra lo que ya había — un dato viejo sigue siendo
      // mejor que ninguno, y esto no es motivo para vaciar la ficha.
      if (!detail) return null;

      const ratings: GameRatings = {
        ratingCritics: detail.ratingCritics,
        ratingCriticsCount: detail.ratingCriticsCount,
        ratingUsers: detail.ratingUsers,
        ratingUsersCount: detail.ratingUsersCount,
      };

      // De paso se guarda todo lo demás que el detalle ya trae en la MISMA
      // respuesta (sinopsis, sagas, fecha completa con su precisión): pedirlo
      // cuesta cero y dejarlo sin guardar sería tirar el viaje a medias. Lo
      // que devuelve el handler siguen siendo solo las notas, que es lo único
      // que la card necesita para decir cómo fue.
      await withDbAccess(async () =>
        updateGame(gameId, {
          ...ratings,
          summary: detail.summary,
          igdbCollections: detail.igdbCollections,
          releaseDate: detail.release?.date ?? null,
          releaseDatePrecision: detail.release?.precision ?? null,
          ...(detail.releaseYear !== null ? { releaseYear: detail.releaseYear } : {}),
          ratingsCheckedAt: new Date(),
        }),
      );

      return ratings;
    },
  );
};

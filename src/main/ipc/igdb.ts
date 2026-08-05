import { ipcMain } from 'electron';
import { eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { updateGame } from '../db/queries/games/updateGame';
import { gamesTable } from '../db/schema';
import { getGameDetails, getGameRatingsBatch, searchGames } from '../igdb/api';
import type { GameRatings, RatingsRefreshSummary, RatingsStatus } from '../igdb/types';

export const registerIgdbHandlers = (): void => {
  ipcMain.handle('igdb:search', async (_event, query: string) => {
    return searchGames(query);
  });

  ipcMain.handle('igdb:getById', async (_event, igdbId: number) => {
    return getGameDetails(igdbId);
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

      await withDbAccess(async () =>
        updateGame(gameId, { ...ratings, ratingsCheckedAt: new Date() }),
      );

      return ratings;
    },
  );

  // Estado del bloque Ratings de Ajustes — un par de COUNT, sin traer filas.
  ipcMain.handle('igdb:ratingsStatus', async (): Promise<RatingsStatus> => {
    const [row] = await withDbAccess(async () =>
      getDb()
        .select({
          total: sql<number>`count(*)`,
          withRatings: sql<number>`count(*) filter (where ${or(
            isNotNull(gamesTable.ratingCritics),
            isNotNull(gamesTable.ratingUsers),
          )})`,
          neverChecked: sql<number>`count(*) filter (where ${isNull(gamesTable.ratingsCheckedAt)})`,
        })
        .from(gamesTable),
    );
    return row;
  });

  // El "Refresh all" de Ajustes: las notas de TODA la biblioteca (planeados
  // incluidos — su ficha también las enseña) en 1-2 peticiones por lotes
  // (getGameRatingsBatch). Existe sobre todo por los juegos dados de alta
  // ANTES de esta función, que nacieron sin notas — pero sirve igual para
  // poner al día toda la estantería de una vez en lugar de ficha a ficha.
  ipcMain.handle('igdb:refreshAllRatings', async (): Promise<RatingsRefreshSummary> => {
    const games = await withDbAccess(async () =>
      getDb().select({ id: gamesTable.id, igdbId: gamesTable.igdbId }).from(gamesTable),
    );

    // La red FUERA del candado, como siempre; y ANTES de escribir nada — si
    // IGDB falla a mitad de los lotes, no se ha tocado ni una fila.
    const ratingsByIgdbId = await getGameRatingsBatch(games.map((game) => game.igdbId));

    const now = new Date();
    let withRatings = 0;
    await withDbAccess(async () =>
      getDb().transaction(async (tx) => {
        for (const game of games) {
          const ratings = ratingsByIgdbId.get(game.igdbId);
          if (ratings) {
            if (ratings.ratingCritics !== null || ratings.ratingUsers !== null) withRatings++;
            await tx
              .update(gamesTable)
              .set({ ...ratings, ratingsCheckedAt: now })
              .where(eq(gamesTable.id, game.id));
          } else {
            // IGDB no devolvió el juego (ya no está en el catálogo): se
            // estampa el "preguntado" sin pisar lo que hubiera — un dato
            // viejo sigue siendo mejor que ninguno.
            await tx
              .update(gamesTable)
              .set({ ratingsCheckedAt: now })
              .where(eq(gamesTable.id, game.id));
          }
        }
      }),
    );

    return { total: games.length, updated: ratingsByIgdbId.size, withRatings };
  });
};

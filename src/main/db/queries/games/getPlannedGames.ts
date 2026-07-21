import { eq, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameListItem } from '../../../../shared/types';
import { gamesTable } from '../../schema';

// Sección Plan to Play — la contrapartida de getGames(): SOLO los juegos
// planeados, que getGames() excluye. Devuelve la misma forma (GameListItem)
// a propósito: así el grid de la biblioteca y las filas de la columna de
// navegación se reutilizan tal cual. Las partes que un juego planeado no
// tiene por definición (horas, sesiones, estado real) van fijas a cero/plan
// — no hace falta ir a mirar sessions/stateEvents para saberlo.
export const getPlannedGames = async (): Promise<GameListItem[]> => {
  const db = getDb();

  const games = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      coverUrl: gamesTable.coverUrl,
      heroUrl: gamesTable.heroUrl,
      genres: gamesTable.genres,
      isEmulated: gamesTable.isEmulated,
      releaseYear: gamesTable.releaseYear,
      addedAt: gamesTable.addedAt,
      hltbMain: gamesTable.hltbMain,
    })
    .from(gamesTable)
    .where(eq(gamesTable.planned, true))
    .orderBy(sql`${gamesTable.title} collate nocase`);

  return games.map((game) => ({
    id: game.id,
    title: game.title,
    coverUrl: game.coverUrl,
    heroUrl: game.heroUrl,
    genres: game.genres,
    isEmulated: game.isEmulated,
    releaseYear: game.releaseYear,
    totalHours: 0,
    addedAt: game.addedAt,
    hltbMain: game.hltbMain,
    manualIterations: [],
    currentState: 'plan_to_play' as const,
    isLive: false,
    liveSince: null,
    sessionCount: 0,
  }));
};

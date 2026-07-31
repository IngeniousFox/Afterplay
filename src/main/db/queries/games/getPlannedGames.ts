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
      endless: gamesTable.endless,
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
    endless: game.endless,
    releaseYear: game.releaseYear,
    totalHours: 0,
    addedAt: game.addedAt,
    hltbMain: game.hltbMain,
    // Un planeado no tiene exe que lanzar — el campo existe para el Play
    // del modo TV (que tampoco enseña juegos del Plan).
    executablePath: null,
    manualIterations: [],
    currentState: 'plan_to_play' as const,
    // Un juego planeado no se ha jugado nunca, por definición — de ahí que
    // la columna de Plan to Play tampoco ofrezca ordenar por esto.
    lastPlayedAt: null,
    isLive: false,
    liveSince: null,
    sessionCount: 0,
  }));
};

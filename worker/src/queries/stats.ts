import type { StatsSummary } from '../api-types';
import type { TenantDb } from '../db';
import { buildLibraryData } from './library';

// El resumen que abre la portada del móvil.
//
// Las horas del año siguen la MISMA regla que la pantalla de Stats del
// escritorio cuando filtras por año (lib/statsTotals.ts, yearTotals):
//
//   horas de un año = sesiones fechadas ESE año
//                   + horas MANUALES atribuidas a ese año
//
// La segunda mitad es la que se me olvidó, y no es un detalle: un playthrough
// de 200h terminado en 2019 aporta 0h a la vista de 2019 si solo se miran
// sesiones, aunque su Beaten sí salga en el desglose de estados. Las horas
// manuales son lo jugado FUERA del tracking, así que se SUMAN, y el año al que
// se cuelgan sale del log de estados de su playthrough (manualHoursAnchor).
//
// Y el otro fallo que había: las sesiones venían con un tope de 200 filas, así
// que el total del año dependía de cuántas cupieran. Ahora entran todas.
export const getStatsSummary = async (db: TenantDb): Promise<StatsSummary> => {
  const { games, manualByGame, sessions } = await buildLibraryData(db);

  const thisYear = new Date().getFullYear();

  const trackedSecondsThisYear = sessions
    .filter((session) => session.startedAt.getFullYear() === thisYear)
    .reduce((sum, session) => sum + (session.durationSec ?? 0), 0);

  const manualHoursThisYear = [...manualByGame.values()]
    .flat()
    .filter((manual) => manual.year === thisYear)
    .reduce((sum, manual) => sum + manual.hours, 0);

  const hoursThisYear = trackedSecondsThisYear / 3600 + manualHoursThisYear;

  const counts = { beaten: 0, playing: 0, dropped: 0, unplayed: 0 };
  for (const game of games) {
    if (game.currentState === 'completed') counts.beaten++;
    else if (game.currentState === 'started') counts.playing++;
    else if (game.currentState === 'dropped') counts.dropped++;
    else if (game.currentState === null) counts.unplayed++;
  }

  const liveGame = games.find((game) => game.isLive && game.liveSince !== null);

  return {
    totalGames: games.length,
    playedGames: games.filter((game) => game.totalHours > 0).length,
    totalHours: games.reduce((sum, game) => sum + game.totalHours, 0),
    totalSessions: games.reduce((sum, game) => sum + game.sessionCount, 0),
    hoursThisYear,
    // Los juegos que de verdad se tocaron ESTE año — la misma distinción que
    // hace Stats entre "GAMES TRACKED" (all time) y "GAMES PLAYED" (un año).
    gamesThisYear: countGamesThisYear(games, manualByGame, sessions, thisYear),
    year: thisYear,
    ...counts,
    live: liveGame
      ? {
          gameId: liveGame.id,
          gameTitle: liveGame.title,
          coverUrl: liveGame.coverUrl,
          since: liveGame.liveSince as number,
        }
      : null,
  };
};

const countGamesThisYear = (
  games: { id: number }[],
  manualByGame: Map<number, { hours: number; year: number | null }[]>,
  sessions: { gameId: number; startedAt: Date; durationSec: number | null }[],
  year: number,
): number => {
  const hoursByGame = new Map<number, number>();
  for (const session of sessions) {
    if (session.startedAt.getFullYear() !== year) continue;
    hoursByGame.set(
      session.gameId,
      (hoursByGame.get(session.gameId) ?? 0) + (session.durationSec ?? 0) / 3600,
    );
  }
  for (const [gameId, manuals] of manualByGame) {
    const manualHours = manuals
      .filter((manual) => manual.year === year)
      .reduce((sum, manual) => sum + manual.hours, 0);
    if (manualHours > 0) hoursByGame.set(gameId, (hoursByGame.get(gameId) ?? 0) + manualHours);
  }
  return games.filter((game) => (hoursByGame.get(game.id) ?? 0) > 0).length;
};

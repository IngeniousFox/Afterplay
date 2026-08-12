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

  // OJO, desfase conocido con el escritorio: un Worker no tiene zona horaria,
  // así que este `getFullYear()` —y el de cada sesión, y el del ancla de las
  // horas manuales en library.ts— es UTC, mientras que el PC calcula el mismo
  // año en local. Una fecha con precisión de año se guardó como el 1 de enero
  // a las 00:00 locales y desde España se lee aquí como el 31 de diciembre
  // anterior: esas horas caen un año antes que en el escritorio. El arreglo
  // está en library.ts, y pide un helper en src/shared + que la PWA mande su
  // zona; ninguno de los dos se puede tocar desde este fichero.
  const thisYear = new Date().getFullYear();

  const trackedSecondsThisYear = sessions
    .filter((session) => session.startedAt.getFullYear() === thisYear)
    .reduce((sum, session) => sum + (session.durationSec ?? 0), 0);

  const manualHoursThisYear = [...manualByGame.values()]
    .flat()
    .filter((manual) => manual.year === thisYear)
    .reduce((sum, manual) => sum + manual.hours, 0);

  const hoursThisYear = trackedSecondsThisYear / 3600 + manualHoursThisYear;

  // Los SEIS cajones, no cuatro: on_hold y resting existen en el modelo y sin
  // ellos la suma no daba totalGames, así que la portada los estimaba por
  // resta y los pintaba juntos. Un juego cae en uno y solo uno — currentState
  // ya viene derivado con la regla compartida, que ignora 'plan_to_play', y
  // los planeados no entran en la biblioteca.
  const counts = { beaten: 0, playing: 0, dropped: 0, onHold: 0, resting: 0, unplayed: 0 };
  for (const game of games) {
    if (game.currentState === 'completed') counts.beaten++;
    else if (game.currentState === 'started') counts.playing++;
    else if (game.currentState === 'dropped') counts.dropped++;
    else if (game.currentState === 'on_hold') counts.onHold++;
    else if (game.currentState === 'resting') counts.resting++;
    else if (game.currentState === null) counts.unplayed++;
  }

  // `isLive` ya viene con la regla de frescura del §7.4 aplicada
  // (buildLibraryData), así que un cronómetro que alguien se dejó puesto el
  // viernes no pinta "jugando ahora" en la portada del sábado por el simple
  // hecho de que su fila siga sin endedAt.
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

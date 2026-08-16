import { yearOf } from '../../../src/shared/yearOf';
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
// que el total del año dependía de cuántas cupieran. Ahora entran todas las
// del año — el único recorte que queda es por FECHA y está calculado para no
// poder dejarse fuera ninguna (SESSION_WINDOW_MS en library.ts).
//
// Lo que este fichero NO hace, y es a propósito: pedir su propia consulta.
// Todo sale de buildLibraryData, que trae las seis en un solo viaje a Turso.
// Un `await db.select()` aquí serían 49 ms más de red, medidos.

// `timeZone` es la zona del que está mirando, que la trae la petición
// (index.ts). Sin ella el año se lee en el reloj del proceso, que en un Worker
// es UTC — ver abajo por qué eso era un desfase visible y no un detalle.
export const getStatsSummary = async (
  db: TenantDb,
  timeZone?: string | null,
): Promise<StatsSummary> => {
  const { games, manualByGame, recentSessions } = await buildLibraryData(db, timeZone);

  // ARREGLADO, y era la divergencia Home/Stats en carne viva: un Worker no
  // tiene zona horaria, así que `getFullYear()` aquí era UTC mientras el PC
  // calculaba el mismo año en local. Una fecha con precisión de AÑO se guarda
  // como el 1 de enero a las 00:00 LOCALES —o sea las 23:00Z del 31 de
  // diciembre anterior desde España—, y esas horas caían en 2018 en la portada
  // del móvil y en 2019 en Stats del escritorio. La misma pregunta con dos
  // respuestas según la pantalla.
  //
  // Ahora el año lo decide yearOf con la zona del que mira, que es el mismo
  // criterio que aplica el escritorio (allí la zona es la del proceso). Las
  // TRES lecturas de año de esta pantalla van por ahí —el año en curso, el de
  // cada sesión y el del ancla de las horas manuales (library.ts)—: si una se
  // quedara en UTC, el año se partiría por dentro.
  const thisYear = yearOf(new Date(), timeZone);

  const trackedSecondsThisYear = recentSessions
    .filter((session) => yearOf(session.startedAt, timeZone) === thisYear)
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
    gamesThisYear: countGamesThisYear(games, manualByGame, recentSessions, thisYear, timeZone),
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
  recentSessions: { gameId: number; startedAt: Date; durationSec: number | null }[],
  year: number,
  timeZone?: string | null,
): number => {
  const hoursByGame = new Map<number, number>();
  for (const session of recentSessions) {
    // Con la zona del que mira, igual que el año en curso: contar aquí en UTC
    // y allí en local dejaría a GAMES PLAYED hablando de un año distinto que
    // las horas que tiene al lado.
    if (yearOf(session.startedAt, timeZone) !== year) continue;
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

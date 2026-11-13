import { hoursByGameInYear } from '../../../src/shared/domain/hours';
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

  // Las horas del año, juego a juego, con la regla compartida
  // (hoursByGameInYear, src/shared/domain/hours.ts): la misma suma que
  // yearTotals en Stats del escritorio —sesiones de ese año más manuales
  // atribuidas a él—, y de ella salen las DOS cifras del año, para que no
  // puedan hablar de poblaciones distintas.
  const hoursByGame = hoursByGameInYear(
    games.map((game) => game.id),
    recentSessions,
    manualByGame,
    thisYear,
    timeZone,
  );
  let hoursThisYear = 0;
  let gamesThisYear = 0;
  for (const hours of hoursByGame.values()) {
    hoursThisYear += hours;
    // Los juegos que de verdad se tocaron ESTE año — la misma distinción que
    // hace Stats entre "GAMES TRACKED" (all time) y "GAMES PLAYED" (un año).
    if (hours > 0) gamesThisYear++;
  }

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
    gamesThisYear,
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

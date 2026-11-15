import type { EntityIdLike, GameId } from '../entityIds';
import type { GameListItem } from '../types';
import { yearOf } from '../yearOf';
import { hoursByGameInYear, type YearSession } from './hours';

// El resumen de la portada del móvil, escrito UNA vez (AFTERPLAY-2.0.md §15.2,
// F-26). Antes lo calculaba el Worker 1.x sobre sus propias filas
// (worker/src/queries/stats.ts); ahora sale de lo que ya devuelve la biblioteca
// del escritorio (`getGames`) más las sesiones del año.
//
// Las horas del año siguen la regla de Stats del escritorio filtrada por año:
// sesiones que ARRANCARON ese año MÁS las horas manuales atribuidas a él
// (`hoursByGameInYear`). De ella salen las DOS cifras del año, para que no
// hablen de poblaciones distintas.

/** Lo que de la biblioteca hace falta para el resumen. */
export type StatsGame<Id extends EntityIdLike> = Pick<
  GameListItem<Id>,
  | 'id'
  | 'title'
  | 'coverUrl'
  | 'totalHours'
  | 'sessionCount'
  | 'currentState'
  | 'isLive'
  | 'liveSince'
  | 'manualIterations'
>;

export type StatsSummary<Id extends EntityIdLike> = {
  totalGames: number;
  playedGames: number;
  totalHours: number;
  totalSessions: number;
  hoursThisYear: number;
  gamesThisYear: number;
  year: number;
  /** Reparto por estado actual: los cinco más "sin estado"; suma `totalGames`. */
  beaten: number;
  playing: number;
  dropped: number;
  onHold: number;
  resting: number;
  unplayed: number;
  /** La sesión abierta ahora mismo (`since` en ms), si la hay. */
  live: {
    gameId: GameId<Id>;
    gameTitle: string;
    coverUrl: string | null;
    since: number;
  } | null;
};

export function deriveStatsSummary<Id extends EntityIdLike>(input: {
  /** La biblioteca (sin los juegos del Plan). */
  games: readonly StatsGame<Id>[];
  /** Las sesiones asignadas; las de fuera del año o de juegos que no están en `games` no suman. */
  sessions: readonly YearSession<Id>[];
  now: Date;
  /** Zona IANA de quien mira; sin ella, la del proceso. */
  timeZone?: string | null;
}): StatsSummary<Id> {
  const { games, sessions, now, timeZone } = input;
  const year = yearOf(now, timeZone);

  const manualByGame = new Map(
    games.map((game) => [
      game.id,
      game.manualIterations.map((m) => ({ hours: m.hours, year: m.year })),
    ]),
  );
  const hoursByGame = hoursByGameInYear(
    games.map((game) => game.id),
    sessions,
    manualByGame,
    year,
    timeZone,
  );
  let hoursThisYear = 0;
  let gamesThisYear = 0;
  for (const hours of hoursByGame.values()) {
    hoursThisYear += hours;
    if (hours > 0) gamesThisYear++;
  }

  // Un juego cae en un cajón y solo uno; `currentState` ya viene derivado y
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

  // La más reciente de las abiertas.
  let live: StatsGame<Id> | null = null;
  for (const game of games) {
    if (!game.isLive || game.liveSince === null) continue;
    if (live === null || game.liveSince.getTime() > (live.liveSince as Date).getTime()) live = game;
  }

  return {
    totalGames: games.length,
    playedGames: games.filter((game) => game.totalHours > 0).length,
    totalHours: games.reduce((sum, game) => sum + game.totalHours, 0),
    totalSessions: games.reduce((sum, game) => sum + game.sessionCount, 0),
    hoursThisYear,
    gamesThisYear,
    year,
    ...counts,
    live: live
      ? {
          gameId: live.id,
          gameTitle: live.title,
          coverUrl: live.coverUrl,
          since: (live.liveSince as Date).getTime(),
        }
      : null,
  };
}

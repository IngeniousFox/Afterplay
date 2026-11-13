import { yearOf } from '../yearOf';
import type { GameId } from '../entityIds';

// LAS HORAS, escritas UNA vez (AFTERPLAY-2.0.md §15.2, F-26).
//
// Vivían en src/main/db/queries/games/iterationHours.ts y el Worker las
// importaba de ahí; las sumas por juego y "las horas de un año" estaban
// repetidas a mano en getGames, getGameById, worker/src/queries/library.ts,
// game.ts y stats.ts. Aquí van solo las reglas: qué cuenta como hora y cómo se
// suman. Funciones puras, sin base, sin drizzle: las usan el escritorio y el
// Worker sobre sus propias filas.

// Horas de una iteración: manualTotalPlayed son las horas jugadas FUERA del
// tracking (antes de usar Afterplay, en otro PC, en consola…) y se SUMAN a lo
// que el watcher haya medido — son tiempos disjuntos por definición, no dos
// versiones del mismo dato.
//
// Antes reemplazaba en vez de sumar, y eso rompía un caso real: un
// playthrough con horas manuales que sigue activo y al que el watcher le
// cuelga sesiones nuevas se quedaba clavado en el número manual para siempre
// (las sesiones se guardaban, se veían en el Session History, pero el total
// las ignoraba). El bug histórico que motivó el "reemplaza" era otro: contar
// dos veces la MISMA sesión por tenerla duplicada en dos sitios, no esto.
export const resolveIterationHours = (
  manualTotalPlayed: number | null,
  trackedSeconds: number,
): number => (manualTotalPlayed ?? 0) + trackedSeconds / 3600;

// Segundos medidos de un grupo de sesiones. Una sesión ABIERTA (durationSec
// null) existe y cuenta como sesión, pero todavía no aporta tiempo: su
// duración solo se conoce al cerrarla. Es lo mismo que hace el `sum()` de SQL
// de la biblioteca, que ignora los NULL.
export const trackedSecondsOf = (sessions: readonly { durationSec: number | null }[]): number => {
  let total = 0;
  for (const session of sessions) total += session.durationSec ?? 0;
  return total;
};

// ── LAS HORAS DE UN AÑO ────────────────────────────────────────────────────
//
// horas de un juego en un año = sesiones que ARRANCARON ese año
//                              + horas manuales atribuidas a ese año
//
// Es la regla de Stats del escritorio (renderer/src/lib/statsTotals.ts,
// yearTotals) y la de la portada del móvil (worker/src/queries/stats.ts). La
// segunda mitad es fácil de olvidar al reimplementar: un playthrough de 200 h
// terminado en 2019 aporta 0 h a 2019 si solo se miran sesiones. El año de
// cada bloque manual ya viene resuelto (manualHoursAnchor + yearOf, ver
// library.ts); el de cada sesión se decide aquí con yearOf y la zona del que
// mira, porque un Worker no tiene zona y su getFullYear() es UTC.
//
// Devuelve un mapa SOLO con los juegos de `gameIds` (la población la decide
// quien llama: una sesión de un juego que no está en la lista no suma), en el
// orden de `gameIds`, para que la suma total recorra los juegos en el mismo
// orden en los dos lados.
export type YearSession = { gameId: GameId; startedAt: Date; durationSec: number | null };
export type YearManualHours = { hours: number; year: number | null };

export const hoursByGameInYear = (
  gameIds: readonly GameId[],
  sessions: readonly YearSession[],
  manualByGame: ReadonlyMap<GameId, readonly YearManualHours[]>,
  year: number,
  timeZone?: string | null,
): Map<GameId, number> => {
  const trackedSecondsByGame = new Map<GameId, number>();
  for (const session of sessions) {
    if (yearOf(session.startedAt, timeZone) !== year) continue;
    trackedSecondsByGame.set(
      session.gameId,
      (trackedSecondsByGame.get(session.gameId) ?? 0) + (session.durationSec ?? 0),
    );
  }

  const hoursByGame = new Map<GameId, number>();
  for (const gameId of gameIds) {
    let manualHours = 0;
    for (const manual of manualByGame.get(gameId) ?? []) {
      if (manual.year === year) manualHours += manual.hours;
    }
    hoursByGame.set(gameId, (trackedSecondsByGame.get(gameId) ?? 0) / 3600 + manualHours);
  }
  return hoursByGame;
};

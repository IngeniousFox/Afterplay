import type { GameListItem, SessionWithGame, SpendEventSummary } from '../../../shared/types';
import type { Year } from '../components/stats/YearPicker';

// Las cifras de cabecera de un año (o de toda la vida), y el reparto de horas
// por juego del que salen. Función suelta y no hook: quien la usa la llama dos
// veces, una para el año elegido y otra para el anterior, y así las dos
// comparten literalmente la misma regla.
//
// Vive en lib/ (y no dentro de Stats.tsx, donde nació) porque es LA DEFINICIÓN
// de verdad de las cifras: la pantalla de escritorio y la del modo TV tienen
// que dar el mismo número o el usuario nos pilla — sobre todo por las horas
// manuales, que son fáciles de olvidar al reimplementar "a ojo".
//
// Horas de un juego:
//   · "All Time" -> game.totalHours, la misma fuente que Library y la ficha.
//   · Un año concreto -> las sesiones fechadas ESE año MÁS las horas manuales
//     atribuidas a él (por la fecha de fin de su playthrough, ver
//     manualHoursAnchor). Sin esa segunda parte, un playthrough de 200h
//     terminado en 2019 aportaba 0h a la vista de 2019 aunque su Beaten sí
//     saliera en el desglose de estados.
//
// SUMA las dos partes, igual que resolveIterationHours en el main: las horas
// manuales son lo jugado FUERA del tracking, así que un playthrough con horas
// manuales al que además le cuelgan sesiones aporta ambas.
export const yearTotals = (
  games: GameListItem[],
  sessions: SessionWithGame[],
  spendEvents: SpendEventSummary[],
  year: Year,
): {
  hoursByGame: Map<number, number>;
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
} => {
  const trackedSecondsByGame = new Map<number, number>();
  if (year !== 'all') {
    for (const session of sessions) {
      if (session.startedAt.getFullYear() !== year) continue;
      const current = trackedSecondsByGame.get(session.gameId) ?? 0;
      trackedSecondsByGame.set(session.gameId, current + (session.durationSec ?? 0));
    }
  }

  const hoursByGame = new Map<number, number>();
  for (const game of games) {
    if (year === 'all') {
      hoursByGame.set(game.id, game.totalHours);
      continue;
    }
    const trackedHours = (trackedSecondsByGame.get(game.id) ?? 0) / 3600;
    const manualHours = game.manualIterations
      .filter((manual) => manual.year === year)
      .reduce((sum, manual) => sum + manual.hours, 0);
    hoursByGame.set(game.id, trackedHours + manualHours);
  }

  // "All Time" cuenta la biblioteca entera; un año concreto, solo los juegos
  // que de verdad se tocaron ese año (de ahí las dos etiquetas distintas del
  // contador: GAMES TRACKED vs GAMES PLAYED).
  const totalGames =
    year === 'all'
      ? games.length
      : games.filter((game) => (hoursByGame.get(game.id) ?? 0) > 0).length;

  const totalHours = [...hoursByGame.values()].reduce((sum, hours) => sum + hours, 0);
  const totalSpent = spendEvents
    .filter((event) => year === 'all' || event.occurredAt.getFullYear() === year)
    .reduce((sum, event) => sum + event.amount, 0);

  return {
    hoursByGame,
    totalGames,
    totalHours,
    totalSpent,
    costPerHour: totalHours > 0 ? totalSpent / totalHours : null,
  };
};

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameListItem, SessionWithGame, SpendEventSummary } from '../../../../shared/types';
import { yearTotals } from '../statsTotals';

// yearTotals ya no tiene su propia regla de "horas de un año": la pide a
// hoursByGameInYear (src/shared/domain/hours.ts), la misma que usa el Worker.
// Estos casos fijan lo que daba la copia que había aquí, para que el cambio no
// mueva ni una cifra de Stats ni del modo TV. Todas las fechas son LOCALES (sin
// 'Z'): el escritorio lee el año con el reloj del que mira.

const juego = (
  id: number,
  totalHours: number,
  manual: { hours: number; year: number | null }[] = [],
): GameListItem =>
  ({
    id,
    totalHours,
    manualIterations: manual.map((m, i) => ({ iterationId: id * 100 + i, ...m })),
  }) as unknown as GameListItem;

const sesion = (gameId: number, startedAt: Date, durationSec: number | null): SessionWithGame =>
  ({ gameId, startedAt, durationSec }) as unknown as SessionWithGame;

const gasto = (amount: number, occurredAt: Date): SpendEventSummary =>
  ({ amount, occurredAt }) as unknown as SpendEventSummary;

const juegos = [
  juego(1, 300, [
    { hours: 10, year: 2025 },
    { hours: 200, year: 2019 },
  ]),
  juego(2, 4, [{ hours: 3, year: null }]),
  juego(3, 1),
];

const sesiones = [
  sesion(1, new Date(2025, 5, 1, 12), 7200),
  // Las 23:30 del 31 de diciembre en hora local siguen siendo 2025.
  sesion(1, new Date(2025, 11, 31, 23, 30), 1800),
  sesion(1, new Date(2026, 0, 1, 0, 30), 3600),
  // Una sesión abierta existe pero no aporta tiempo.
  sesion(3, new Date(2025, 2, 1, 12), null),
  // Un juego fuera de la población no suma.
  sesion(9, new Date(2025, 2, 1, 12), 3600),
];

const gastos = [gasto(20, new Date(2025, 3, 1, 12)), gasto(30, new Date(2019, 3, 1, 12))];

describe('yearTotals: las cifras de cabecera de Stats', () => {
  it('un año suma las sesiones que arrancaron ese año (hora local) y las manuales de ese año', () => {
    const totales = yearTotals(juegos, sesiones, gastos, 2025);
    assert.deepEqual(
      [...totales.hoursByGame],
      [
        [1, 12.5],
        [2, 0],
        [3, 0],
      ],
    );
    // GAMES PLAYED: solo los que se tocaron ese año.
    assert.equal(totales.totalGames, 1);
    assert.equal(totales.totalHours, 12.5);
    assert.equal(totales.totalSpent, 20);
    assert.equal(totales.costPerHour, 20 / 12.5);
  });

  it('un playthrough manual de 200 h terminado en 2019 cuenta en 2019', () => {
    const totales = yearTotals(juegos, sesiones, gastos, 2019);
    assert.equal(totales.hoursByGame.get(1), 200);
    assert.equal(totales.totalSpent, 30);
  });

  it('"All Time" usa totalHours de cada juego y cuenta la biblioteca entera', () => {
    const totales = yearTotals(juegos, sesiones, gastos, 'all');
    assert.deepEqual(
      [...totales.hoursByGame],
      [
        [1, 300],
        [2, 4],
        [3, 1],
      ],
    );
    assert.equal(totales.totalGames, 3);
    assert.equal(totales.totalHours, 305);
    assert.equal(totales.totalSpent, 50);
  });

  it('sin horas no hay coste por hora', () => {
    assert.equal(yearTotals(juegos, sesiones, gastos, 2030).costPerHour, null);
  });
});

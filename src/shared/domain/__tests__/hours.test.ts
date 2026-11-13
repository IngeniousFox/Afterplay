import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hoursByGameInYear, resolveIterationHours, trackedSecondsOf } from '../hours';

// Las reglas de las horas en su único sitio. Cubren lo que fijaban, por
// separado, getGames.test.ts / getGameById.test.ts en el escritorio y los
// tests de getStatsSummary en el Worker.

describe('las horas de un playthrough', () => {
  it('las manuales se SUMAN a lo medido, no lo reemplazan', () => {
    assert.equal(resolveIterationHours(10, 2 * 3600), 12);
    assert.equal(resolveIterationHours(null, 5400), 1.5);
  });

  it('una sesión abierta existe pero todavía no aporta tiempo', () => {
    assert.equal(trackedSecondsOf([{ durationSec: 3600 }, { durationSec: null }]), 3600);
  });
});

describe('las horas de un año (hoursByGameInYear)', () => {
  const sessions = [
    { gameId: 1, startedAt: new Date('2026-03-01T12:00:00Z'), durationSec: 7200 },
    { gameId: 1, startedAt: new Date('2025-03-01T12:00:00Z'), durationSec: 3600 },
    // Un juego que no está en la población (p. ej. uno del Plan) no suma.
    { gameId: 9, startedAt: new Date('2026-03-01T12:00:00Z'), durationSec: 3600 },
  ];

  it('son las sesiones de ese año MÁS las manuales atribuidas a él', () => {
    const manual = new Map([
      [
        1,
        [
          { hours: 10, year: 2026 },
          { hours: 50, year: 2019 },
        ],
      ],
      [2, [{ hours: 3, year: null }]],
    ]);
    const hours = hoursByGameInYear([1, 2], sessions, manual, 2026);
    assert.deepEqual(
      [...hours],
      [
        [1, 12],
        [2, 0],
      ],
    );
  });

  it('el año de cada sesión se lee en la zona del que mira, no en UTC', () => {
    // Las 23:30Z del 31 de diciembre ya son 1 de enero en Madrid.
    const late = [{ gameId: 1, startedAt: new Date('2025-12-31T23:30:00Z'), durationSec: 3600 }];
    assert.equal(hoursByGameInYear([1], late, new Map(), 2026, 'Europe/Madrid').get(1), 1);
    assert.equal(hoursByGameInYear([1], late, new Map(), 2026, 'UTC').get(1), 0);
  });
});

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { GameListItem } from '../../../../../../shared/types';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGames } from '../getGames';
import { event, openSession, session } from './helpers';

// La parte de src/main/db/__tests__/yearTotals.test.ts que depende de getGames:
// el AÑO al que se cuelga cada bloque de horas manuales (`manualIterations`).
// La cadena entera (getGames + getAllSessions + yearTotals del renderer) no se
// porta aquí: getAllSessions es de P4 y yearTotals vive en el renderer. Lo que
// getGames aporta a esa cadena es exactamente `manualIterations[].year`, y eso
// es lo que se comprueba, con los mismos escenarios.
//
// La zona horaria, clavada como en el original: el año se decide en hora LOCAL
// y media suite se juega en los bordes de fin de año.
process.env.TZ = 'Europe/Madrid';

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const juego = (title: string, manualHours?: number): { gameId: string; ptId: string } => {
  const gameId = seedGame(fx.ctx, { title, addedAt: new Date('2020-01-01T00:00:00Z') });
  const ptId = seedPlaythrough(fx.ctx, { gameId, manualHours: manualHours ?? null });
  return { gameId, ptId };
};

const named = (title: string): GameListItem<string> => {
  const found = getGames(fx.ctx).find((g) => g.title === title);
  assert.ok(found);
  return found;
};

const yearsOf = (title: string): (number | null)[] =>
  named(title).manualIterations.map((m) => m.year);

describe('el año de las horas manuales', () => {
  it('un playthrough terminado en enero deja sus horas en ese enero', () => {
    const { ptId } = juego('Elden Ring', 200);
    event(fx.ctx, ptId, 'started', '2025-03-04T20:00:00Z');
    event(fx.ctx, ptId, 'completed', '2026-01-10T18:00:00Z');
    session(fx.ctx, ptId, '2025-11-02T21:00:00Z', 3);
    assert.deepEqual(yearsOf('Elden Ring'), [2026]);
    assert.equal(named('Elden Ring').totalHours, 203);
  });

  it('sin evento de final, el año del started', () => {
    const { ptId } = juego('RimWorld', 120);
    event(fx.ctx, ptId, 'started', '2024-06-01T17:00:00Z');
    session(fx.ctx, ptId, '2026-03-01T19:00:00Z', 5);
    assert.deepEqual(yearsOf('RimWorld'), [2024]);
  });

  it('aparcar es una fecha de salida; descansar no', () => {
    const parked = juego('Disco Elysium', 30);
    event(fx.ctx, parked.ptId, 'started', '2024-02-10T18:00:00Z');
    event(fx.ctx, parked.ptId, 'on_hold', '2025-09-01T18:00:00Z');
    const resting = juego('Slay the Spire', 70);
    event(fx.ctx, resting.ptId, 'started', '2024-02-10T18:00:00Z');
    event(fx.ctx, resting.ptId, 'resting', '2025-09-01T18:00:00Z');
    assert.deepEqual(yearsOf('Disco Elysium'), [2025]);
    assert.deepEqual(yearsOf('Slay the Spire'), [2024]);
  });

  it('con varios finales manda el más reciente', () => {
    const { ptId } = juego('Outer Wilds', 22);
    event(fx.ctx, ptId, 'started', '2023-05-01T18:00:00Z');
    event(fx.ctx, ptId, 'on_hold', '2024-01-20T18:00:00Z');
    event(fx.ctx, ptId, 'completed', '2025-04-11T18:00:00Z');
    assert.deepEqual(yearsOf('Outer Wilds'), [2025]);
  });

  it('sin una sola fecha, ni en el log ni en sesiones, no tiene año', () => {
    juego('Chrono Trigger', 40);
    assert.deepEqual(yearsOf('Chrono Trigger'), [null]);
  });

  it('el paso por el Plan no le da año a nada', () => {
    // La 1.x: "un plan_to_play no le da año a nada". En 2.0 el Plan no está
    // en el log: una entrada con lápida (promocionado) no puede anclar horas.
    const { gameId } = juego('Silksong', 12);
    fx.ctx.store.create('plan_entries', { gameId, plannedAt: new Date('2026-02-01T10:00:00Z') });
    fx.ctx.store.remove('plan_entries', gameId);
    assert.deepEqual(yearsOf('Silksong'), [null]);
  });

  it('cuando el log calla, fecha la PRIMERA sesión', () => {
    const stardew = juego('Stardew Valley', 50);
    session(fx.ctx, stardew.ptId, '2026-04-10T18:00:00Z', 5);
    const terraria = juego('Terraria', 80);
    session(fx.ctx, terraria.ptId, '2024-07-05T18:00:00Z', 2);
    session(fx.ctx, terraria.ptId, '2026-03-01T18:00:00Z', 3);
    assert.deepEqual(yearsOf('Stardew Valley'), [2026]);
    assert.deepEqual(yearsOf('Terraria'), [2024]);
  });

  it('el log manda sobre las sesiones', () => {
    const { ptId } = juego('Elden Ring', 200);
    event(fx.ctx, ptId, 'completed', '2026-01-10T18:00:00Z');
    session(fx.ctx, ptId, '2025-11-02T21:00:00Z', 3);
    assert.deepEqual(yearsOf('Elden Ring'), [2026]);
  });

  it('una sesión abierta también fecha las horas manuales', () => {
    const { ptId } = juego('Hades', 15);
    openSession(fx.ctx, ptId, '2026-08-13T10:00:00Z');
    assert.deepEqual(yearsOf('Hades'), [2026]);
  });

  it('precisión de año a medianoche LOCAL: "lo terminé en 2019" es 2019', () => {
    const { ptId } = juego('Suikoden II', 60);
    // Sin Z: el instante exacto que escribe la app, a una hora del año
    // anterior en UTC.
    event(fx.ctx, ptId, 'completed', new Date('2019-01-01T00:00:00'), { datePrecision: 'year' });
    assert.deepEqual(yearsOf('Suikoden II'), [2019]);
  });

  it('cada vuelta al mismo juego deja sus horas en su propio año', () => {
    const { gameId, ptId } = juego('Dark Souls', 30);
    const ngPlus = seedPlaythrough(fx.ctx, { gameId, customLabel: 'NG+', manualHours: 12 });
    event(fx.ctx, ptId, 'completed', '2023-05-01T18:00:00Z');
    event(fx.ctx, ngPlus, 'completed', '2026-02-14T18:00:00Z');
    assert.deepEqual(named('Dark Souls').manualIterations, [
      { iterationId: ptId, hours: 30, year: 2023 },
      { iterationId: ngPlus, hours: 12, year: 2026 },
    ]);
  });

  it('la sesión en marcha cuenta como sesión pero aún no aporta horas', () => {
    const { ptId } = juego('Factorio');
    openSession(fx.ctx, ptId, '2026-08-13T10:00:00Z');
    const game = named('Factorio');
    assert.equal(game.sessionCount, 1);
    assert.equal(game.totalHours, 0);
  });
});

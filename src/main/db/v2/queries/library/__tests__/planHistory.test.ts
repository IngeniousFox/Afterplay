import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGameById } from '../getGameById';
import type { GameDetail } from '../../../../../../shared/types';
import { event, iso } from './helpers';

// Los dos eventos del Plan de la ficha (R-06, petición expresa del usuario):
// "Añadido al Plan" (`plan_entries.plannedAt` + nota, viva o con lápida) y
// "Salió del Plan" (`games.promotedAt`, solo si se promocionó). Los cuatro
// casos del encargo: planeado, promocionado, devuelto al Plan y nunca en el
// Plan.
//
// Las escrituras (promocionar, devolver al Plan) son de P2; aquí se simulan
// con la puerta tal como CONSULTAS.md §1.4 dice que las hará: promocionar =
// lápida en la entrada + `promotedAt`; devolver = `store.create` sobre la
// misma entrada (la resucita) con `plannedAt` nuevo + `promotedAt: null`.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const detail = (gameId: string): GameDetail<string> => {
  const game = getGameById(fx.ctx, gameId);
  assert.ok(game);
  return game;
};

const promote = (gameId: string, at: Date): void => {
  fx.ctx.store.transaction(() => {
    fx.ctx.store.remove('plan_entries', gameId);
    fx.ctx.store.patch('games', gameId, { promotedAt: at });
  });
};

const returnToPlan = (gameId: string, at: Date, note: string | null = null): void => {
  fx.ctx.store.transaction(() => {
    fx.ctx.store.create('plan_entries', { gameId, plannedAt: at, pinnedAt: null, note });
    fx.ctx.store.patch('games', gameId, { promotedAt: null });
  });
};

describe('planHistory: los dos eventos del Plan en la ficha', () => {
  it('planeado: "Añadido al Plan" con su nota, sin "Salió del Plan"', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Outer Wilds',
      planned: { plannedAt: new Date('2026-03-01T10:00:00Z'), note: 'Me lo recomendó Dani' },
    });
    const g = detail(gameId);
    assert.equal(g.planned, true);
    assert.deepEqual(g.planHistory, {
      plannedAt: new Date('2026-03-01T10:00:00Z'),
      note: 'Me lo recomendó Dani',
      leftAt: null,
    });
    // No es un evento de estado: el log sigue vacío.
    assert.deepEqual(g.stateHistory, []);
  });

  it('promocionado: conserva "Añadido al Plan" (entrada con lápida) y gana "Salió del Plan"', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Outer Wilds',
      planned: { plannedAt: new Date('2026-03-01T10:00:00Z'), note: 'Me lo recomendó Dani' },
    });
    promote(gameId, new Date('2026-05-10T18:00:00Z'));
    const p = seedPlaythrough(fx.ctx, { gameId });
    event(fx.ctx, p, 'started', '2026-05-10T18:00:00Z');

    const g = detail(gameId);
    assert.equal(g.planned, false);
    assert.deepEqual(g.planHistory, {
      plannedAt: new Date('2026-03-01T10:00:00Z'),
      note: 'Me lo recomendó Dani',
      leftAt: new Date('2026-05-10T18:00:00Z'),
    });
    // Los eventos del Plan no se mezclan con el log ni con la derivación.
    assert.deepEqual(
      g.stateHistory.map((e) => e.type),
      ['started'],
    );
    assert.equal(g.currentState, 'started');
  });

  it('devuelto al Plan: solo el último paso, con su fecha y nota nuevas y sin salida', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Outer Wilds',
      planned: { plannedAt: new Date('2026-03-01T10:00:00Z'), note: 'Primera nota' },
    });
    promote(gameId, new Date('2026-05-10T18:00:00Z'));
    returnToPlan(gameId, new Date('2026-07-01T09:00:00Z'), 'Para el verano');

    const g = detail(gameId);
    assert.equal(g.planned, true);
    assert.equal(g.promotedAt, null);
    assert.deepEqual(g.planHistory, {
      plannedAt: new Date('2026-07-01T09:00:00Z'),
      note: 'Para el verano',
      leftAt: null,
    });

    // Y si se vuelve a promocionar, la salida es la nueva.
    promote(gameId, new Date('2026-08-01T20:00:00Z'));
    const again = detail(gameId);
    assert.equal(iso(again.planHistory?.plannedAt), '2026-07-01T09:00:00.000Z');
    assert.equal(iso(again.planHistory?.leftAt), '2026-08-01T20:00:00.000Z');
  });

  it('nunca pasó por el Plan: planHistory es null', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hades' });
    seedPlaythrough(fx.ctx, { gameId });
    assert.equal(detail(gameId).planHistory, null);
  });

  it('un promotedAt sin entrada en el Plan (dato 1.x anterior a la columna) no inventa nada', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Antiguo',
      promotedAt: new Date('2024-01-01T00:00:00Z'),
    });
    assert.equal(detail(gameId).planHistory, null);
  });

  it('la nota vacía viaja como null', () => {
    const gameId = seedGame(fx.ctx, { title: 'Sin porqué', planned: true });
    const g = detail(gameId);
    assert.equal(g.planHistory?.note, null);
    assert.equal(g.planHistory?.leftAt, null);
  });
});

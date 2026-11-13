import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import {
  createGameWithDetails,
  createPlannedGame,
  deleteGame,
  moveToPlan,
  promotePlannedGame,
} from '../../games';
import { createInput, enrichment, planInput, promoteInput } from '../../games/__tests__/helpers';
import { getGameById } from '../getGameById';
import type { GameDetail } from '../../../../../../shared/types';
import { event, iso } from './helpers';
import { hours } from '../../common/__tests__/fixtures';

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

// La regla que separa "lápida de esta vida" de "lápida de una vida anterior"
// (I-11 e I-14): una entrada con lápida cuyo `plannedAt` es anterior al
// `addedAt` actual es de antes de volver a añadir el juego. Aquí, con las
// escrituras de verdad de `games/` (no con la puerta a mano), los casos que
// tienen que cumplirse A LA VEZ.
describe('planHistory: vida actual frente a vida anterior', () => {
  const H = { igdbId: 30003, title: 'Hades', steamAppId: 1145360 };
  const plan = (note: string | null = null): string =>
    createPlannedGame(fx.ctx, planInput({ source: { igdbId: H.igdbId }, note }), enrichment(H)).id;
  const add = (): string =>
    createGameWithDetails(fx.ctx, createInput({ source: { igdbId: H.igdbId } }), enrichment(H)).id;
  const promote = (gameId: string): void => {
    promotePlannedGame(fx.ctx, promoteInput(gameId));
  };

  it('importado de la 1.x: lápida sin promotedAt (anterior a la columna) enseña el alta en el Plan', () => {
    // Lo que deja el importador: la entrada con lápida con la fecha y la nota
    // del plan_to_play (posterior al alta) y `promotedAt` null.
    const addedAt = new Date('2024-02-01T10:00:00Z');
    const plannedAt = new Date('2024-02-01T10:00:00.002Z');
    const gameId = seedGame(fx.ctx, {
      title: 'Importado',
      addedAt,
      planned: { plannedAt, note: 'Nota del Plan 1.x' },
    });
    fx.ctx.store.remove('plan_entries', gameId);
    const g = detail(gameId);
    assert.equal(g.planned, false);
    assert.equal(g.promotedAt, null);
    assert.deepEqual(g.planHistory, { plannedAt, note: 'Nota del Plan 1.x', leftAt: null });
  });

  it('importado con plannedAt igual al alta (planeado sin evento): también se enseña', () => {
    const addedAt = new Date('2024-02-01T10:00:00Z');
    const gameId = seedGame(fx.ctx, {
      title: 'Importado',
      addedAt,
      planned: { plannedAt: addedAt },
    });
    fx.ctx.store.remove('plan_entries', gameId);
    assert.deepEqual(detail(gameId).planHistory, { plannedAt: addedAt, note: null, leftAt: null });
  });

  it('planeado → promocionado → borrado → vuelto a añadir: nada de la vida anterior', () => {
    const gameId = plan('De la otra vida');
    fx.wall.advance(hours(24));
    promote(gameId);
    fx.wall.advance(hours(24));
    assert.equal(deleteGame(fx.ctx, gameId), true);
    fx.wall.advance(hours(24));
    assert.equal(add(), gameId, 'resucita con el mismo id');
    const g = detail(gameId);
    assert.equal(g.promotedAt, null);
    assert.equal(g.planHistory, null);
  });

  it('borrado mientras estaba en el Plan y vuelto a añadir a la biblioteca: nada', () => {
    const gameId = plan('De la otra vida');
    fx.wall.advance(hours(24));
    deleteGame(fx.ctx, gameId);
    fx.wall.advance(hours(24));
    add();
    assert.equal(detail(gameId).planHistory, null);
  });

  it('borrado y vuelto a añadir AL PLAN: el paso nuevo, con su fecha y su nota', () => {
    const gameId = plan('De la otra vida');
    fx.wall.advance(hours(24));
    promote(gameId);
    deleteGame(fx.ctx, gameId);
    fx.wall.advance(hours(24));
    const plannedAt = fx.ctx.now();
    plan('De esta vida');
    assert.deepEqual(detail(gameId).planHistory, {
      plannedAt,
      note: 'De esta vida',
      leftAt: null,
    });
  });

  it('vuelto a añadir y después llevado al Plan y promocionado: se enseña el paso de esta vida', () => {
    const gameId = plan();
    fx.wall.advance(hours(24));
    promote(gameId);
    deleteGame(fx.ctx, gameId);
    fx.wall.advance(hours(24));
    add();
    fx.wall.advance(hours(24));
    const backAt = fx.ctx.now();
    moveToPlan(fx.ctx, gameId);
    assert.deepEqual(detail(gameId).planHistory, { plannedAt: backAt, note: null, leftAt: null });
    fx.wall.advance(hours(24));
    const leftAt = fx.ctx.now();
    promote(gameId);
    assert.deepEqual(detail(gameId).planHistory, { plannedAt: backAt, note: null, leftAt });
  });

  it('los tres normales con las escrituras de verdad: planeado, promocionado, ida y vuelta', () => {
    const plannedAt = fx.ctx.now();
    const gameId = plan('Por la secuela');
    assert.deepEqual(detail(gameId).planHistory, {
      plannedAt,
      note: 'Por la secuela',
      leftAt: null,
    });
    fx.wall.advance(hours(24));
    const leftAt = fx.ctx.now();
    promote(gameId);
    assert.deepEqual(detail(gameId).planHistory, {
      plannedAt,
      note: 'Por la secuela',
      leftAt,
    });
    fx.wall.advance(hours(24));
    const backAt = fx.ctx.now();
    moveToPlan(fx.ctx, gameId);
    assert.deepEqual(detail(gameId).planHistory, {
      plannedAt: backAt,
      note: 'Por la secuela',
      leftAt: null,
    });
    fx.wall.advance(hours(24));
    const leftAgain = fx.ctx.now();
    promote(gameId);
    assert.deepEqual(detail(gameId).planHistory, {
      plannedAt: backAt,
      note: 'Por la secuela',
      leftAt: leftAgain,
    });
  });
});

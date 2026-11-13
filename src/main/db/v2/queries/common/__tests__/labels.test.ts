import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  autoPlaythroughLabel,
  customLabelToStore,
  effectivePlaythroughLabel,
  nextPlaythroughPosition,
  playthroughPosition,
  playthroughPositions,
} from '../labels';
import { openQueryDb, seedGame, seedPlaythrough, type QueryFixture } from './fixtures';

// "Playthrough N" como posición (§7.4), contando las lápidas (R-03).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('posición de los playthroughs', () => {
  it('numera por orden de creación dentro de cada juego', () => {
    const a = seedGame(fx.ctx, { title: 'Celeste' });
    const b = seedGame(fx.ctx, { title: 'Hades' });
    const a1 = seedPlaythrough(fx.ctx, { gameId: a });
    const b1 = seedPlaythrough(fx.ctx, { gameId: b });
    const a2 = seedPlaythrough(fx.ctx, { gameId: a });

    const positions = playthroughPositions(fx.ctx, [a, b]);
    assert.equal(positions.get(a1), 1);
    assert.equal(positions.get(a2), 2);
    assert.equal(positions.get(b1), 1);
    assert.deepEqual(playthroughPositions(fx.ctx), positions);
    assert.deepEqual(playthroughPositions(fx.ctx, []), new Map());
  });

  it('borrar el primero no renombra el segundo (R-03)', () => {
    const game = seedGame(fx.ctx, { title: 'Celeste' });
    const first = seedPlaythrough(fx.ctx, { gameId: game });
    const second = seedPlaythrough(fx.ctx, { gameId: game });
    fx.ctx.store.remove('playthroughs', first);

    assert.equal(playthroughPosition(fx.ctx, second), 2);
    // Y el siguiente es el 3, no otro "Playthrough 2".
    assert.equal(nextPlaythroughPosition(fx.ctx, game), 3);
    assert.equal(playthroughPosition(fx.ctx, 'no-existe'), null);
  });

  it('un juego sin playthroughs empieza en el 1', () => {
    const game = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(nextPlaythroughPosition(fx.ctx, game), 1);
  });
});

describe('etiquetas', () => {
  it('la del usuario si la hay; si no, la automática', () => {
    assert.equal(autoPlaythroughLabel(3), 'Playthrough 3');
    assert.equal(effectivePlaythroughLabel(null, 2), 'Playthrough 2');
    assert.equal(effectivePlaythroughLabel('   ', 2), 'Playthrough 2');
    assert.equal(effectivePlaythroughLabel('New Game+', 2), 'New Game+');
  });

  it('lo que se guarda: null si está vacía o coincide con la automática', () => {
    assert.equal(customLabelToStore('', 1), null);
    assert.equal(customLabelToStore(null, 1), null);
    assert.equal(customLabelToStore(undefined, 1), null);
    assert.equal(customLabelToStore('  Playthrough 2 ', 2), null);
    assert.equal(customLabelToStore('Playthrough 2', 3), 'Playthrough 2');
    assert.equal(customLabelToStore(' NG+ ', 1), 'NG+');
  });
});

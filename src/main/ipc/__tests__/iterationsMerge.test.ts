import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { closeAppDbFixture, freshAppDb } from '../../db/v2/__tests__/appDbHarness';
import {
  seedGame,
  seedPlaythrough,
  seedStateEvent,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import type {
  ConcurrentPlaythrough,
  MergePlaythroughsOutcome,
} from '../../../shared/playthroughMerge';

// iterations:concurrent e iterations:merge (§10.7): lo que ve la ficha cuando
// dos PCs han abierto un playthrough cada uno. REAL: el handler, las consultas
// y la base 2.0 en memoria. DOBLADO: electron y el registro del IPC.

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();

mock.module('electron', { namedExports: { ipcMain: { handle: (): void => {} } } });
mock.module('../dbHandle', {
  namedExports: {
    handleDb: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler);
    },
  },
});

let fx: QueryFixture;
let concurrent: (gameId: string) => Promise<ConcurrentPlaythrough[]>;
let merge: (keepId: string, dropId: string) => Promise<MergePlaythroughsOutcome>;

before(async () => {
  const { registerIterationsHandlers } = await import('../iterations');
  registerIterationsHandlers();
  const concurrentHandler = handlers.get('iterations:concurrent');
  const mergeHandler = handlers.get('iterations:merge');
  assert.ok(concurrentHandler && mergeHandler, 'los handlers deberían estar registrados');
  concurrent = (gameId) => concurrentHandler({}, gameId) as Promise<ConcurrentPlaythrough[]>;
  merge = (keepId, dropId) =>
    mergeHandler({}, { keepId, dropId }) as Promise<MergePlaythroughsOutcome>;
});

beforeEach(() => {
  fx = freshAppDb();
});
after(closeAppDbFixture);

const started = (gameId: string): string => {
  const id = seedPlaythrough(fx.ctx, { gameId });
  seedStateEvent(fx.ctx, { playthroughId: id, type: 'started' });
  return id;
};

describe('iterations:concurrent', () => {
  it('con un solo playthrough en curso, nada que avisar', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    started(gameId);
    assert.deepEqual(await concurrent(gameId), []);
  });

  it('con dos en curso, los dos con su etiqueta, y el vigente es el último', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const first = started(gameId);
    const second = started(gameId);
    const list = await concurrent(gameId);
    assert.deepEqual(
      list.map((item) => [item.id, item.current]),
      [
        [first, false],
        [second, true],
      ],
    );
    assert.ok(list.every((item) => item.label.length > 0));
    assert.deepEqual(Object.keys(list[0]).sort(), ['current', 'id', 'label']);
  });
});

describe('iterations:merge', () => {
  it('fusiona y cuenta lo que ha movido', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const keep = started(gameId);
    const drop = started(gameId);
    const outcome = await merge(keep, drop);
    assert.equal(outcome.ok, true);
    assert.deepEqual(await concurrent(gameId), []);
  });

  it('el mismo playthrough dos veces: resultado con mensaje, no excepción', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const id = started(gameId);
    const outcome = await merge(id, id);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.reason, 'same_playthrough');
    assert.ok(!outcome.ok && outcome.message.length > 0);
  });

  it('juegos distintos: different_game y no se mueve nada', async () => {
    const one = started(seedGame(fx.ctx, { title: 'A' }));
    const two = started(seedGame(fx.ctx, { title: 'B' }));
    const outcome = await merge(one, two);
    assert.equal(!outcome.ok && outcome.reason, 'different_game');
  });

  it('un playthrough que ya no existe (borrado en otro PC): not_found', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const keep = started(gameId);
    const outcome = await merge(keep, 'no-existe');
    assert.equal(!outcome.ok && outcome.reason, 'not_found');
  });
});

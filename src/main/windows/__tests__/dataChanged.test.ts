import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import type { DataChanged } from '../../../shared/ipc/dataChanged';
import type { LocalDatabase } from '../../db/v2/connection';
import { openTestDb, seedBasics } from '../../db/v2/__tests__/helpers';
import { withChangeOrigin } from '../../lib/changeOrigin';

// El emisor del aviso único (§15.4): la puerta de escritura avisa UNA vez por
// transacción confirmada y con el origen con el que se escribió; el sync avisa
// con origen 'sync'. `forward` (Electron) se sustituye por un buzón.

const sent: DataChanged[] = [];
mock.module('../forward', {
  namedExports: {
    forwardToWindowAndOverlay: () => (change: DataChanged) => {
      sent.push(change);
    },
    forwardToWindow: () => () => {},
  },
});

let announceStoreChanges: typeof import('../dataChanged').announceStoreChanges;
let announceSyncChange: typeof import('../dataChanged').announceSyncChange;
before(async () => {
  ({ announceStoreChanges, announceSyncChange } = await import('../dataChanged'));
});

let local: LocalDatabase;
beforeEach(() => {
  sent.length = 0;
  local = openTestDb();
  announceStoreChanges(local.store);
});
afterEach(() => local.close());

describe('announceStoreChanges', () => {
  it('una transacción con varias filas es UN aviso con todos sus dominios', () => {
    const { gameId } = seedBasics(local.store);
    sent.length = 0;
    local.store.transaction(() => {
      local.store.patch('games', gameId, { notes: 'x' });
      local.store.create('plan_entries', { gameId, plannedAt: new Date(1) });
      local.store.create('emulators', { name: 'Dolphin' });
    });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].domains, ['games', 'plan', 'emulators']);
    assert.equal(sent[0].origin, 'local');
    assert.deepEqual(sent[0].ids?.games, [gameId]);
  });

  it('una transacción que se deshace no avisa de nada', () => {
    const { gameId } = seedBasics(local.store);
    sent.length = 0;
    assert.throws(() =>
      local.store.transaction(() => {
        local.store.patch('games', gameId, { notes: 'y' });
        throw new Error('fallo');
      }),
    );
    assert.deepEqual(sent, []);
  });

  it('lo escrito dentro de withChangeOrigin("watcher") sale con ese origen', () => {
    const { gameId } = seedBasics(local.store);
    sent.length = 0;
    withChangeOrigin('watcher', () => local.store.patch('games', gameId, { notes: 'w' }));
    local.store.patch('games', gameId, { notes: 'l' });
    assert.deepEqual(
      sent.map((change) => change.origin),
      ['watcher', 'local'],
    );
  });
});

describe('announceSyncChange', () => {
  it('traduce las tablas de una página de bajada, con origen sync', () => {
    announceSyncChange({ tables: ['spend_events'], ids: { spend_events: ['s1'] } });
    assert.deepEqual(sent, [{ domains: ['spend'], ids: { spend: ['s1'] }, origin: 'sync' }]);
  });
});

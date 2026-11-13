import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { externalCheckId, gameInstallId } from '../../../../../../shared/sync/ids';
import { rawRow } from '../../../__tests__/helpers';
import { readGameRow } from '../../common';
import {
  asOtherDevice,
  openQueryDb,
  seedCatalog,
  seedCheck,
  seedCuriosities,
  seedGame,
  seedPlaythrough,
  seedSaveBackup,
  seedSession,
  seedSpendEvent,
  seedStateEvent,
  seedUnlock,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { deleteGame } from '../deleteGame';

// games:delete en 2.0. Referencia 1.x: `deleteGame.test.ts` (la cascada se
// lleva todo lo suyo y solo lo suyo). En 2.0 son lápidas por el registro, y
// las cachés y las copias de partidas se QUEDAN, por decisión.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const isTombstoned = (table: string, id: string): boolean => {
  const row = rawRow(fx.local, table, id);
  assert.ok(row, `${table} ${id} debería existir`);
  return row.syncDeleted !== null;
};

/** Un juego con TODO poblado. Devuelve los ids por tabla. */
function gameWithEverything(title: string): Record<string, string> {
  const gameId = seedGame(fx.ctx, {
    title,
    metadata: { summary: 'Caché' },
    install: { executablePath: 'C:\\x.exe' },
    planned: true,
  });
  const playthroughId = seedPlaythrough(fx.ctx, { gameId });
  const other = asOtherDevice(fx.ctx);
  seedCheck(fx.ctx, { gameId, source: 'igdb_ratings' });
  return {
    gameId,
    playthroughId,
    stateEventId: seedStateEvent(fx.ctx, { playthroughId }),
    sessionId: seedSession(fx.ctx, { playthroughId }),
    // Abierta y en OTRO PC: la cascada la alcanza igual (decisión del usuario).
    otherOpenSessionId: other.seedSession({ playthroughId, endedAt: null }),
    otherInstallId: other.seedInstall({ gameId }),
    spendId: seedSpendEvent(fx.ctx, { gameId }),
    unlockId: seedUnlock(fx.ctx, { gameId, apiName: 'SUMMIT' }),
    catalogId: seedCatalog(fx.ctx, { gameId }),
    curiositiesId: seedCuriosities(fx.ctx, { gameId }),
    backupId: seedSaveBackup(fx.ctx, { gameId }),
    otherBackupId: other.seedSaveBackup({ gameId }),
    installId: gameInstallId(gameId, fx.ctx.deviceId),
    checkId: externalCheckId(gameId, 'igdb_ratings'),
  };
}

describe('deleteGame', () => {
  it('pone la lápida al juego y a sus hijos del registro, también la sesión abierta de otro PC', () => {
    const ids = gameWithEverything('Se borra');
    assert.equal(deleteGame(fx.ctx, ids.gameId), true);

    assert.equal(isTombstoned('games', ids.gameId), true);
    assert.equal(isTombstoned('playthroughs', ids.playthroughId), true);
    assert.equal(isTombstoned('state_events', ids.stateEventId), true);
    assert.equal(isTombstoned('sessions', ids.sessionId), true);
    assert.equal(isTombstoned('sessions', ids.otherOpenSessionId), true);
    assert.equal(isTombstoned('spend_events', ids.spendId), true);
    assert.equal(isTombstoned('plan_entries', ids.gameId), true);
    assert.equal(isTombstoned('game_installs', ids.installId), true);
    assert.equal(isTombstoned('game_installs', ids.otherInstallId), true);
    assert.equal(isTombstoned('achievement_unlocks', ids.unlockId), true);
    assert.equal(readGameRow(fx.ctx, ids.gameId), null);
  });

  it('las cachés y las copias de partidas se quedan vivas (keep)', () => {
    const ids = gameWithEverything('Se borra');
    deleteGame(fx.ctx, ids.gameId);
    assert.equal(isTombstoned('game_metadata', ids.gameId), false);
    assert.equal(isTombstoned('external_checks', ids.checkId), false);
    assert.equal(isTombstoned('achievement_catalogs', ids.catalogId), false);
    assert.equal(isTombstoned('game_curiosities', ids.curiositiesId), false);
    assert.equal(isTombstoned('save_backups', ids.backupId), false);
    assert.equal(isTombstoned('save_backups', ids.otherBackupId), false);
  });

  it('un juego vecino con su historial no pierde ni una fila', () => {
    const doomed = gameWithEverything('Se borra');
    const neighbour = seedGame(fx.ctx, { title: 'Se queda' });
    const pt = seedPlaythrough(fx.ctx, { gameId: neighbour });
    const keep = {
      playthroughs: pt,
      state_events: seedStateEvent(fx.ctx, { playthroughId: pt }),
      sessions: seedSession(fx.ctx, { playthroughId: pt }),
      spend_events: seedSpendEvent(fx.ctx, { gameId: neighbour }),
      achievement_unlocks: seedUnlock(fx.ctx, { gameId: neighbour, apiName: 'SUMMIT' }),
    };
    deleteGame(fx.ctx, doomed.gameId);
    assert.equal(isTombstoned('games', neighbour), false);
    for (const [table, id] of Object.entries(keep))
      assert.equal(isTombstoned(table, id), false, table);
  });

  it('un juego sin historial se borra igual', () => {
    const gameId = seedGame(fx.ctx, { title: 'Recién añadido' });
    assert.equal(deleteGame(fx.ctx, gameId), true);
  });

  it('un id que no existe, o ya borrado, devuelve false sin lanzar ni escribir', () => {
    assert.equal(deleteGame(fx.ctx, 'no-existe'), false);
    const gameId = seedGame(fx.ctx, { title: 'Dos clics' });
    assert.equal(deleteGame(fx.ctx, gameId), true);
    const before = rawRow(fx.local, 'games', gameId)?.syncUpdated;
    assert.equal(deleteGame(fx.ctx, gameId), false);
    assert.equal(rawRow(fx.local, 'games', gameId)?.syncUpdated, before);
  });
});

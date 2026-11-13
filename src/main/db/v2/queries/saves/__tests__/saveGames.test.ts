import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import { seedGame, type QueryFixture } from '../../common/__tests__/fixtures';
import {
  addSaveFolder,
  clearSaveDetection,
  ensureSaveKey,
  getSaveGame,
  listSaveGames,
  pairDetectedSaveNameIfUnpaired,
  removeSaveFolder,
  setDetectedSaveName,
  setSaveBackupEnabled,
  updateSaveSettings,
} from '../saveGames';
import { openSavesDb } from './fixture';

// Juegos de partidas y sus ajustes (lo que hoy escribe ipc/saves.ts sobre
// games). Datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openSavesDb();
});
afterEach(() => fx.close());

describe('listSaveGames / getSaveGame', () => {
  it('juegos vivos no planeados, con saveKey y los campos de partidas', () => {
    const celeste = seedGame(fx.ctx, {
      title: 'Celeste',
      igdbId: 26226,
      saveBackupEnabled: true,
      saveDetectionSource: 'auto',
      saveLudusaviName: 'Celeste',
    });
    const sinIgdb = seedGame(fx.ctx, { title: 'Indie sin IGDB', saveCustomPaths: ['<home>/x'] });
    seedGame(fx.ctx, { title: 'Hades', planned: true });
    const borrado = seedGame(fx.ctx, { title: 'Hollow Knight' });
    fx.ctx.store.remove('games', borrado);

    assert.deepEqual(listSaveGames(fx.ctx), [
      {
        id: celeste,
        title: 'Celeste',
        igdbId: 26226,
        saveKey: '26226',
        saveBackupEnabled: true,
        saveDetectionSource: 'auto',
        saveLudusaviName: 'Celeste',
        saveCustomPaths: null,
      },
      {
        id: sinIgdb,
        title: 'Indie sin IGDB',
        igdbId: null,
        saveKey: sinIgdb,
        saveBackupEnabled: false,
        saveDetectionSource: null,
        saveLudusaviName: null,
        saveCustomPaths: ['<home>/x'],
      },
    ]);
    assert.equal(getSaveGame(fx.ctx, celeste)?.title, 'Celeste');
    assert.equal(getSaveGame(fx.ctx, borrado), null);
  });

  it('un juego que sale del Plan (lápida en plan_entries) vuelve a aparecer', () => {
    const id = seedGame(fx.ctx, { title: 'Hades', planned: true });
    assert.equal(getSaveGame(fx.ctx, id), null);
    fx.ctx.store.remove('plan_entries', id);
    assert.equal(getSaveGame(fx.ctx, id)?.id, id);
  });
});

describe('ensureSaveKey', () => {
  it('fija igdbId o el id si falta, y nunca cambia uno existente', () => {
    const conIgdb = seedGame(fx.ctx, { title: 'Celeste', igdbId: 26226, saveKey: null });
    const sinIgdb = seedGame(fx.ctx, { title: 'Indie', saveKey: null });
    assert.equal(rawRow(fx.local, 'games', sinIgdb)?.saveKey, null);
    assert.equal(ensureSaveKey(fx.ctx, conIgdb), '26226');
    assert.equal(ensureSaveKey(fx.ctx, sinIgdb), sinIgdb);

    // Gana igdbId después: el prefijo se queda (§12.7).
    fx.ctx.store.patch('games', sinIgdb, { igdbId: 1942 });
    assert.equal(ensureSaveKey(fx.ctx, sinIgdb), sinIgdb);
    assert.equal(ensureSaveKey(fx.ctx, 'no-existe'), null);
  });
});

describe('ajustes de partidas', () => {
  it('updateSaveSettings escribe solo las columnas de partidas y no escribe sin cambios', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    assert.equal(
      updateSaveSettings(fx.ctx, id, { saveBackupEnabled: true, saveCustomPaths: ['<home>/a'] }),
      true,
    );
    const game = getSaveGame(fx.ctx, id);
    assert.equal(game?.saveBackupEnabled, true);
    assert.deepEqual(game?.saveCustomPaths, ['<home>/a']);

    markClean(fx.local, 'games');
    updateSaveSettings(fx.ctx, id, { saveBackupEnabled: true });
    assert.equal(count(fx.local, 'games', 'syncDirty = 1'), 0); // F-33

    // Claves ajenas al tipo cerrado se ignoran aunque lleguen.
    updateSaveSettings(fx.ctx, id, { title: 'Otro' } as never);
    assert.equal(getSaveGame(fx.ctx, id)?.title, 'Celeste');

    fx.ctx.store.remove('games', id);
    assert.equal(updateSaveSettings(fx.ctx, id, { saveBackupEnabled: false }), false);
  });

  it('setSaveBackupEnabled empareja con el nombre del escaneo solo si no lo estaba', () => {
    const libre = seedGame(fx.ctx, { title: 'Celeste' });
    const manual = seedGame(fx.ctx, {
      title: 'Indie',
      saveLudusaviName: 'Indie',
      saveDetectionSource: 'manual',
    });
    assert.equal(setSaveBackupEnabled(fx.ctx, libre, true, 'Celeste (2018)'), true);
    assert.equal(getSaveGame(fx.ctx, libre)?.saveLudusaviName, 'Celeste (2018)');
    assert.equal(getSaveGame(fx.ctx, libre)?.saveDetectionSource, 'auto');

    setSaveBackupEnabled(fx.ctx, manual, true, 'Otro nombre');
    assert.equal(getSaveGame(fx.ctx, manual)?.saveLudusaviName, 'Indie');
    assert.equal(getSaveGame(fx.ctx, manual)?.saveDetectionSource, 'manual');
    assert.equal(getSaveGame(fx.ctx, manual)?.saveBackupEnabled, true);

    assert.equal(setSaveBackupEnabled(fx.ctx, 'no-existe', true), false);
  });

  it('detectar pisa; el escaneo solo empareja si faltaba', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste', saveCustomPaths: ['<home>/mia'] });
    assert.equal(pairDetectedSaveNameIfUnpaired(fx.ctx, id, 'Celeste'), true);
    assert.equal(pairDetectedSaveNameIfUnpaired(fx.ctx, id, 'Otro'), false);
    assert.equal(getSaveGame(fx.ctx, id)?.saveLudusaviName, 'Celeste');

    assert.equal(setDetectedSaveName(fx.ctx, id, 'Celeste DX'), true);
    const game = getSaveGame(fx.ctx, id);
    assert.equal(game?.saveLudusaviName, 'Celeste DX');
    assert.equal(game?.saveDetectionSource, 'auto');
    assert.deepEqual(game?.saveCustomPaths, ['<home>/mia']); // las propias se conservan

    const planeado = seedGame(fx.ctx, { title: 'Hades', planned: true });
    assert.equal(setDetectedSaveName(fx.ctx, planeado, 'Hades'), false);
  });

  it('clearSaveDetection solo deshace un emparejamiento auto, sin tocar carpetas', () => {
    const auto = seedGame(fx.ctx, {
      title: 'Celeste',
      saveLudusaviName: 'Celeste',
      saveDetectionSource: 'auto',
      saveCustomPaths: ['<home>/mia'],
    });
    const manual = seedGame(fx.ctx, {
      title: 'Indie',
      saveLudusaviName: 'Indie',
      saveDetectionSource: 'manual',
    });
    assert.equal(clearSaveDetection(fx.ctx, auto), true);
    assert.equal(getSaveGame(fx.ctx, auto)?.saveLudusaviName, null);
    assert.equal(getSaveGame(fx.ctx, auto)?.saveDetectionSource, null);
    assert.deepEqual(getSaveGame(fx.ctx, auto)?.saveCustomPaths, ['<home>/mia']);
    assert.equal(clearSaveDetection(fx.ctx, manual), false);
    assert.equal(getSaveGame(fx.ctx, manual)?.saveLudusaviName, 'Indie');
  });

  it('addSaveFolder: sin duplicados; empareja en manual con el título si no lo estaba', () => {
    const id = seedGame(fx.ctx, { title: 'Indie' });
    assert.equal(addSaveFolder(fx.ctx, id, '<home>/a'), 'Indie');
    assert.equal(addSaveFolder(fx.ctx, id, '<home>/a'), 'Indie');
    assert.equal(addSaveFolder(fx.ctx, id, '<home>/b'), 'Indie');
    const game = getSaveGame(fx.ctx, id);
    assert.deepEqual(game?.saveCustomPaths, ['<home>/a', '<home>/b']);
    assert.equal(game?.saveDetectionSource, 'manual');

    const auto = seedGame(fx.ctx, {
      title: 'Celeste',
      saveLudusaviName: 'Celeste (auto)',
      saveDetectionSource: 'auto',
    });
    assert.equal(addSaveFolder(fx.ctx, auto, '<home>/c'), 'Celeste (auto)');
    assert.equal(getSaveGame(fx.ctx, auto)?.saveDetectionSource, 'auto');
    assert.equal(addSaveFolder(fx.ctx, 'no-existe', '<home>/c'), null);
  });

  it('removeSaveFolder: quitar la última de un manual lo devuelve a sin detectar', () => {
    const id = seedGame(fx.ctx, { title: 'Indie' });
    addSaveFolder(fx.ctx, id, '<home>/a');
    addSaveFolder(fx.ctx, id, '<home>/b');
    assert.equal(
      removeSaveFolder(fx.ctx, id, (stored) => stored === '<home>/a'),
      true,
    );
    assert.deepEqual(getSaveGame(fx.ctx, id)?.saveCustomPaths, ['<home>/b']);
    assert.equal(getSaveGame(fx.ctx, id)?.saveLudusaviName, 'Indie');

    removeSaveFolder(fx.ctx, id, (stored) => stored === '<home>/b');
    const game = getSaveGame(fx.ctx, id);
    assert.equal(game?.saveCustomPaths, null);
    assert.equal(game?.saveLudusaviName, null);
    assert.equal(game?.saveDetectionSource, null);

    const auto = seedGame(fx.ctx, {
      title: 'Celeste',
      saveLudusaviName: 'Celeste',
      saveDetectionSource: 'auto',
      saveCustomPaths: ['<home>/x'],
    });
    removeSaveFolder(fx.ctx, auto, () => true);
    assert.equal(getSaveGame(fx.ctx, auto)?.saveLudusaviName, 'Celeste'); // auto se queda
    assert.equal(
      removeSaveFolder(fx.ctx, 'no-existe', () => true),
      false,
    );
  });
});

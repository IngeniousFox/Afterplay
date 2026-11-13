import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { gameInstallId } from '../../../../../../shared/sync/ids';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import { updateGame } from '../updateGame';
import { T0, asOtherDevice, at, openQueryDb, seedGame, type QueryFixture } from './fixtures';

// games:update en 2.0: el ejemplo completo de escritura (CONSULTAS.md §1.4).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const dirtyCount = (): number =>
  count(fx.local, 'games', 'syncDirty = 1') + count(fx.local, 'game_installs', 'syncDirty = 1');

describe('updateGame: games', () => {
  it('título, notas, endless e isEmulated van a games y devuelve el juego releído', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    const row = updateGame(fx.ctx, id, {
      title: 'Celeste DX',
      notes: 'Cara B pendiente',
      endless: true,
      isEmulated: true,
    });
    assert.equal(row?.title, 'Celeste DX');
    assert.equal(row?.notes, 'Cara B pendiente');
    assert.equal(row?.endless, true);
    assert.equal(row?.isEmulated, true);
  });

  it('carátula y banner son overrides; null vuelve al automático [S]', () => {
    const id = seedGame(fx.ctx, {
      title: 'Celeste',
      metadata: { coverUrl: 'https://img/auto.jpg', heroUrl: 'https://img/auto-hero.jpg' },
    });
    let row = updateGame(fx.ctx, id, {
      coverUrl: 'https://img/mia.jpg',
      heroUrl: 'https://img/h.jpg',
    });
    assert.equal(row?.coverUrl, 'https://img/mia.jpg');
    assert.equal(row?.heroUrl, 'https://img/h.jpg');
    assert.equal(rawRow(fx.local, 'games', id)?.coverOverride, 'https://img/mia.jpg');
    // La caché no se toca: el usuario nunca escribe en ella (D-22).
    assert.equal(rawRow(fx.local, 'game_metadata', id)?.coverUrl, 'https://img/auto.jpg');

    row = updateGame(fx.ctx, id, { coverUrl: null });
    assert.equal(row?.coverUrl, 'https://img/auto.jpg');
    assert.equal(row?.heroUrl, 'https://img/h.jpg');
  });

  it('steamGridDbId se marca manual; null limpia los dos', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste', sgdbId: 1, sgdbIdSource: 'auto' });
    let row = updateGame(fx.ctx, id, { steamGridDbId: 42 });
    assert.equal(row?.steamGridDbId, 42);
    assert.equal(rawRow(fx.local, 'games', id)?.sgdbIdSource, 'manual');

    row = updateGame(fx.ctx, id, { steamGridDbId: null });
    assert.equal(row?.steamGridDbId, null);
    assert.equal(rawRow(fx.local, 'games', id)?.sgdbIdSource, null);
  });

  it('un patch vacío o sin cambios no escribe nada y devuelve el juego (F-33)', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste', install: { executablePath: 'C:\\c.exe' } });
    markClean(fx.local, 'games');
    markClean(fx.local, 'game_installs');
    assert.equal(updateGame(fx.ctx, id, {})?.title, 'Celeste');
    assert.equal(
      updateGame(fx.ctx, id, { title: 'Celeste', executablePath: 'C:\\c.exe' })?.title,
      'Celeste',
    );
    assert.equal(dirtyCount(), 0);
  });

  it('las claves fuera de UpdateGamePatch se ignoran', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    const patch = { notes: 'ok', steamAppId: 1, summary: 'no' } as Parameters<typeof updateGame>[2];
    updateGame(fx.ctx, id, patch);
    const raw = rawRow(fx.local, 'games', id);
    assert.equal(raw?.notes, 'ok');
    assert.equal(raw?.steamAppId, null);
  });

  it('null si el juego no existe o tiene lápida, sin escribir', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    fx.ctx.store.remove('games', id);
    markClean(fx.local, 'games');
    assert.equal(updateGame(fx.ctx, id, { title: 'X', executablePath: 'C:\\x.exe' }), null);
    assert.equal(updateGame(fx.ctx, 'no-existe', { title: 'X' }), null);
    assert.equal(dirtyCount(), 0);
    assert.equal(count(fx.local, 'game_installs'), 0);
  });
});

describe('updateGame: la instalación de este PC', () => {
  it('crea la instalación al elegir ruta, con lastVerifiedAt = ahora', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    fx.wall.advance(5_000);
    const row = updateGame(fx.ctx, id, {
      executablePath: 'C:\\Celeste\\Celeste.exe',
      installDirectory: 'C:\\Celeste',
      installSizeBytes: 1_200,
    });
    assert.equal(row?.executablePath, 'C:\\Celeste\\Celeste.exe');
    assert.equal(row?.installDirectory, 'C:\\Celeste');
    assert.equal(row?.installSizeBytes, 1_200);
    const inst = rawRow(fx.local, 'game_installs', gameInstallId(id, fx.ctx.deviceId));
    assert.equal(inst?.deviceId, fx.ctx.deviceId);
    assert.equal(inst?.lastVerifiedAt, T0 + 5_000);
  });

  it('cambiar un campo conserva los demás y refresca lastVerifiedAt', () => {
    const id = seedGame(fx.ctx, {
      title: 'Celeste',
      install: { executablePath: 'C:\\a.exe', installDirectory: 'C:\\A', lastVerifiedAt: at(0) },
    });
    fx.wall.advance(60_000);
    const row = updateGame(fx.ctx, id, { executablePath: 'C:\\b.exe' });
    assert.equal(row?.executablePath, 'C:\\b.exe');
    assert.equal(row?.installDirectory, 'C:\\A');
    assert.equal(
      rawRow(fx.local, 'game_installs', gameInstallId(id, fx.ctx.deviceId))?.lastVerifiedAt,
      T0 + 60_000,
    );
  });

  it('los tres a null borran la instalación (lápida)', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste', install: { executablePath: 'C:\\a.exe' } });
    const row = updateGame(fx.ctx, id, { executablePath: null });
    assert.equal(row?.executablePath, null);
    const inst = rawRow(fx.local, 'game_installs', gameInstallId(id, fx.ctx.deviceId));
    assert.notEqual(inst?.syncDeleted, null);
  });

  it('volver a elegir tras borrar no resucita rutas viejas', () => {
    const id = seedGame(fx.ctx, {
      title: 'Celeste',
      install: { executablePath: 'C:\\a.exe', installDirectory: 'C:\\Viejo' },
    });
    updateGame(fx.ctx, id, { executablePath: null, installDirectory: null });
    const row = updateGame(fx.ctx, id, { executablePath: 'C:\\nuevo.exe' });
    assert.equal(row?.executablePath, 'C:\\nuevo.exe');
    assert.equal(row?.installDirectory, null);
  });

  it('no toca la instalación de otra máquina', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    const other = asOtherDevice(fx.ctx);
    const theirs = other.seedInstall({ gameId: id, executablePath: 'D:\\suyo.exe' });
    updateGame(fx.ctx, id, { executablePath: 'C:\\mio.exe' });
    assert.equal(rawRow(fx.local, 'game_installs', theirs)?.executablePath, 'D:\\suyo.exe');
    assert.equal(count(fx.local, 'game_installs'), 2);
  });

  it('todo o nada: si falla una parte no queda ninguna', () => {
    const id = seedGame(fx.ctx, { title: 'Celeste' });
    assert.throws(() => updateGame(fx.ctx, id, { title: 'Nuevo', installSizeBytes: Number.NaN }));
    assert.equal(rawRow(fx.local, 'games', id)?.title, 'Celeste');
    assert.equal(count(fx.local, 'game_installs'), 0);
  });
});

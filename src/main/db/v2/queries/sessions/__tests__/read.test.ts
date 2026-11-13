import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  OTHER,
  asOtherDevice,
  at,
  hours,
  openQueryDb,
  seedEmulator,
  seedGame,
  seedPlaythrough,
  seedSession,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getAllSessions, getPendingSessions, getSessionClosedInfo } from '../read';

// Lecturas para la interfaz: entran las sesiones de todos los dispositivos y
// salen las borradas con la regla F-11. `getSessionClosedInfo` porta la parte
// del aviso de cierre de `src/main/db/__tests__/manualHoursTotals.test.ts`.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

describe('getAllSessions', () => {
  it('trae las de todos los PCs, con el juego y la carátula efectiva, más reciente primero', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Celeste',
      metadata: { coverUrl: 'https://img/auto.jpg' },
    });
    const custom = seedGame(fx.ctx, {
      title: 'Hades',
      coverOverride: 'https://img/mia.jpg',
      metadata: { coverUrl: 'https://img/auto2.jpg' },
    });
    const p1 = seedPlaythrough(fx.ctx, { gameId });
    const p2 = seedPlaythrough(fx.ctx, { gameId: custom });
    const older = seedSession(fx.ctx, { playthroughId: p1, startedAt: at(0), note: 'nota' });
    const foreign = asOtherDevice(fx.ctx).seedSession({
      playthroughId: p2,
      startedAt: at(hours(5)),
      endedAt: null,
    });

    const rows = getAllSessions(fx.ctx);

    assert.deepEqual(
      rows.map((r) => r.id),
      [foreign, older],
    );
    assert.equal(rows[0].coverUrl, 'https://img/mia.jpg');
    assert.equal(rows[0].deviceId, OTHER);
    assert.equal(rows[0].endedAt, null);
    assert.equal(rows[1].coverUrl, 'https://img/auto.jpg');
    assert.equal(rows[1].gameId, gameId);
    assert.equal(rows[1].gameTitle, 'Celeste');
    assert.equal(rows[1].iterationId, p1);
    assert.equal(rows[1].isManual, false);
    assert.equal(rows[1].note, 'nota');
    assert.equal(rows[1].closedBy, 'owner');
  });

  it('a igual inicio, la creada después primero; filtra por juego si se pide', () => {
    const gameId = seedGame(fx.ctx, { title: 'A' });
    const other = seedGame(fx.ctx, { title: 'B' });
    const p = seedPlaythrough(fx.ctx, { gameId });
    const q = seedPlaythrough(fx.ctx, { gameId: other });
    const first = seedSession(fx.ctx, { playthroughId: p, startedAt: at(0) });
    const second = seedSession(fx.ctx, { playthroughId: p, startedAt: at(0) });
    seedSession(fx.ctx, { playthroughId: q, startedAt: at(0) });

    assert.deepEqual(
      getAllSessions(fx.ctx, { gameId }).map((r) => r.id),
      [second, first],
    );
  });

  it('deja fuera las pendientes y las borradas (también por el padre, F-11)', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    seedSession(fx.ctx, { emulatorId });
    const deadGame = seedGame(fx.ctx, { title: 'Borrado' });
    const deadPt = seedPlaythrough(fx.ctx, { gameId: deadGame });
    seedSession(fx.ctx, { playthroughId: deadPt });
    tombstoneOnly(fx.ctx, 'games', deadGame);
    const gameId = seedGame(fx.ctx, { title: 'Vivo' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    const gone = seedSession(fx.ctx, { playthroughId: pt });
    fx.ctx.store.remove('sessions', gone);

    assert.deepEqual(getAllSessions(fx.ctx), []);
  });
});

describe('getPendingSessions', () => {
  it('las de emulador sin asignar de todos los PCs, con el nombre del emulador', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'DuckStation' });
    const mine = seedSession(fx.ctx, { emulatorId, startedAt: at(0) });
    const foreign = asOtherDevice(fx.ctx).seedSession({
      emulatorId,
      startedAt: at(hours(1)),
      endedAt: null,
    });
    const gameId = seedGame(fx.ctx, { title: 'X', isEmulated: true });
    seedSession(fx.ctx, { playthroughId: seedPlaythrough(fx.ctx, { gameId }), emulatorId });

    const rows = getPendingSessions(fx.ctx);

    assert.deepEqual(
      rows.map((r) => r.id),
      [foreign, mine],
    );
    assert.equal(rows[1].emulatorName, 'DuckStation');
    assert.equal(rows[1].emulatorId, emulatorId);
    assert.equal(rows[1].durationSec, 3600);
    assert.equal(rows[0].endedAt, null);
  });

  it('las de un emulador borrado no salen', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'DuckStation' });
    seedSession(fx.ctx, { emulatorId });
    tombstoneOnly(fx.ctx, 'emulators', emulatorId);
    assert.deepEqual(getPendingSessions(fx.ctx), []);
  });
});

describe('getSessionClosedInfo: el aviso de cierre da el total del juego con la regla de la casa', () => {
  it('suma las horas manuales a lo medido, como la card y la ficha', () => {
    const gameId = seedGame(fx.ctx, { title: 'Cincuenta de la otra máquina' });
    const pt = seedPlaythrough(fx.ctx, { gameId, manualHours: 50 });
    const sessionId = seedSession(fx.ctx, {
      playthroughId: pt,
      startedAt: at(0),
      endedAt: at(hours(3)),
    });

    const info = getSessionClosedInfo(fx.ctx, sessionId);

    assert.ok(info);
    assert.equal(info.totalHours, 53);
    assert.equal(info.durationSec, 3 * 3600);
    assert.equal(info.gameId, gameId);
    assert.equal(info.iterationId, pt);
    assert.equal(info.sessionId, sessionId);
  });

  it('cuenta los playthroughs sin sesiones y las sesiones de otros PCs', () => {
    const gameId = seedGame(fx.ctx, { title: 'Dos vueltas' });
    seedPlaythrough(fx.ctx, { gameId, manualHours: 20 });
    const current = seedPlaythrough(fx.ctx, { gameId });
    const sessionId = seedSession(fx.ctx, {
      playthroughId: current,
      startedAt: at(0),
      endedAt: at(hours(1.5)),
    });
    asOtherDevice(fx.ctx).seedSession({
      playthroughId: current,
      startedAt: at(-hours(10)),
      endedAt: at(-hours(8)),
    });

    assert.equal(getSessionClosedInfo(fx.ctx, sessionId)?.totalHours, 23.5);
  });

  it('carátula y banner efectivos, endless y título', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Slay the Spire',
      endless: true,
      heroOverride: 'https://img/hero-mio.jpg',
      metadata: { coverUrl: 'https://img/cover.jpg', heroUrl: 'https://img/hero.jpg' },
    });
    const sessionId = seedSession(fx.ctx, {
      playthroughId: seedPlaythrough(fx.ctx, { gameId }),
    });

    const info = getSessionClosedInfo(fx.ctx, sessionId);

    assert.equal(info?.coverUrl, 'https://img/cover.jpg');
    assert.equal(info?.heroUrl, 'https://img/hero-mio.jpg');
    assert.equal(info?.endless, true);
    assert.equal(info?.gameTitle, 'Slay the Spire');
  });

  it('isLongest con deriveMoments: hace falta historial previo y batirlo', () => {
    const gameId = seedGame(fx.ctx, { title: 'Récord' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    // LONGEST_MIN_PRIOR_SESSIONS (5) partidas antes y la sexta las bate.
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(
        seedSession(fx.ctx, {
          playthroughId: pt,
          startedAt: at(hours(24 * i)),
          endedAt: at(hours(24 * i + (i === 5 ? 5 : 1))),
        }),
      );
    }
    assert.equal(getSessionClosedInfo(fx.ctx, ids[5])?.isLongest, true);
    assert.equal(getSessionClosedInfo(fx.ctx, ids[1])?.isLongest, false);
  });

  it('null si no existe, está borrada, su juego está borrado o es una pendiente', () => {
    const gameId = seedGame(fx.ctx, { title: 'A' });
    const sessionId = seedSession(fx.ctx, { playthroughId: seedPlaythrough(fx.ctx, { gameId }) });
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const pending = seedSession(fx.ctx, { emulatorId });

    assert.equal(getSessionClosedInfo(fx.ctx, 'no-existe'), null);
    assert.equal(getSessionClosedInfo(fx.ctx, pending), null);
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.equal(getSessionClosedInfo(fx.ctx, sessionId), null);
  });
});

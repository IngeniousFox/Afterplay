import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { count } from '../../../__tests__/helpers';
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
import { closeSession, closeSessionIfOpen } from '../close';
import {
  SESSION_LAST_SEEN_INTERVAL_MS,
  heartbeatSessions,
  pruneSessionBeats,
  readSessionBeat,
} from '../heartbeat';
import { getOpenSessions } from '../open';
import { startGameSession } from '../start';
import { sessionRow } from './helpers';

// Lo que necesita `watcher.ts` (CONSULTAS.md §3.2): las abiertas PROPIAS, el
// latido en dos niveles y el punto de cierre tras un corte. El watcher en sí
// no se prueba aquí (no cambia en este paquete); estos tests fijan que,
// llamando a estas consultas con su lógica de hoy, nunca toca lo de otro PC.

let fx: QueryFixture;
let gameId: string;
let playthroughId: string;
beforeEach(() => {
  fx = openQueryDb();
  gameId = seedGame(fx.ctx, { title: 'Celeste' });
  playthroughId = seedPlaythrough(fx.ctx, { gameId });
});
afterEach(() => fx.close());

describe('getOpenSessions: solo lo de este PC (más los cronómetros)', () => {
  it('devuelve las abiertas propias con su juego, y deja fuera las cerradas y las de otro PC', () => {
    const mine = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: null });
    seedSession(fx.ctx, { playthroughId, startedAt: at(-hours(5)) });
    asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });

    const open = getOpenSessions(fx.ctx);

    assert.deepEqual(
      open.map((s) => s.sessionId),
      [mine],
    );
    assert.equal(open[0].gameId, gameId);
    assert.equal(open[0].playthroughId, playthroughId);
    assert.equal(open[0].emulatorId, null);
    assert.equal(open[0].deviceId, fx.ctx.deviceId);
    assert.equal(open[0].startedBy, 'watcher');
  });

  it('incluye las de emulador sin asignar (gameId null)', () => {
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const pending = seedSession(fx.ctx, { emulatorId, endedAt: null });

    const [open] = getOpenSessions(fx.ctx);

    assert.equal(open.sessionId, pending);
    assert.equal(open.gameId, null);
    assert.equal(open.emulatorId, emulatorId);
  });

  it('incluye los cronómetros vivos de cualquier dispositivo, con su lastSeenAt como latido', () => {
    const timer = asOtherDevice(fx.ctx).seedSession({
      playthroughId,
      startedBy: 'timer',
      startedAt: at(-hours(2)),
      lastSeenAt: at(-hours(1)),
      endedAt: null,
    });

    const [open] = getOpenSessions(fx.ctx);

    assert.equal(open.sessionId, timer);
    assert.equal(open.startedBy, 'timer');
    assert.equal(open.deviceId, OTHER);
    assert.equal(open.lastHeartbeatAt?.getTime(), at(-hours(1)).getTime());
    assert.equal(open.lastBeatAt, null);
  });

  it('deja fuera las abiertas con lápida o con el playthrough borrado (F-11)', () => {
    const deleted = seedSession(fx.ctx, { playthroughId, endedAt: null });
    tombstoneOnly(fx.ctx, 'sessions', deleted);
    const otherPt = seedPlaythrough(fx.ctx, { gameId: seedGame(fx.ctx, { title: 'B' }) });
    seedSession(fx.ctx, { playthroughId: otherPt, endedAt: null });
    tombstoneOnly(fx.ctx, 'playthroughs', otherPt);

    assert.deepEqual(getOpenSessions(fx.ctx), []);
  });

  it('lastHeartbeatAt = beatAt ?? lastSeenAt: el punto de cierre tras un corte', () => {
    const neverBeat = seedSession(fx.ctx, {
      playthroughId,
      startedAt: at(0),
      lastSeenAt: at(0),
      endedAt: null,
    });
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const beaten = seedSession(fx.ctx, {
      emulatorId,
      startedAt: at(0),
      lastSeenAt: at(hours(1)),
      endedAt: null,
    });
    heartbeatSessions(fx.ctx, [beaten], at(hours(1) + 25_000));

    const byId = new Map(getOpenSessions(fx.ctx).map((s) => [s.sessionId, s]));

    assert.equal(byId.get(neverBeat)?.lastHeartbeatAt?.getTime(), at(0).getTime());
    assert.equal(byId.get(neverBeat)?.lastBeatAt, null);
    assert.equal(byId.get(beaten)?.lastHeartbeatAt?.getTime(), at(hours(1) + 25_000).getTime());
    assert.equal(byId.get(beaten)?.lastSeenAt?.getTime(), at(hours(1)).getTime());
  });
});

describe('heartbeatSessions: latido local cada ciclo, señal de vida cada ≥60 s', () => {
  it('cada ciclo escribe el latido local; lastSeenAt solo cuando han pasado 60 s', () => {
    const session = startGameSession(fx.ctx, gameId, 'watcher');
    assert.ok(session);
    const start = session.startedAt.getTime();

    const first = heartbeatSessions(fx.ctx, [session.id], new Date(start + 5_000));
    assert.deepEqual(first.beaten, [session.id]);
    assert.deepEqual(first.signalled, []);
    assert.equal(readSessionBeat(fx.ctx, session.id)?.getTime(), start + 5_000);
    assert.equal(sessionRow(fx.ctx, session.id)?.lastSeenAt?.getTime(), start);

    const atMinute = heartbeatSessions(
      fx.ctx,
      [session.id],
      new Date(start + SESSION_LAST_SEEN_INTERVAL_MS),
    );
    assert.deepEqual(atMinute.signalled, [session.id]);
    assert.equal(
      sessionRow(fx.ctx, session.id)?.lastSeenAt?.getTime(),
      start + SESSION_LAST_SEEN_INTERVAL_MS,
    );

    // Cinco segundos después: solo local otra vez.
    const next = heartbeatSessions(
      fx.ctx,
      [session.id],
      new Date(start + SESSION_LAST_SEEN_INTERVAL_MS + 5_000),
    );
    assert.deepEqual(next.signalled, []);
    assert.equal(
      readSessionBeat(fx.ctx, session.id)?.getTime(),
      start + SESSION_LAST_SEEN_INTERVAL_MS + 5_000,
    );
  });

  it('el latido local no pasa por la puerta: no ensucia la fila ni gasta reloj', () => {
    const sessionId = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: null });
    const before = sessionRow(fx.ctx, sessionId);

    heartbeatSessions(fx.ctx, [sessionId], at(5_000));

    const after = sessionRow(fx.ctx, sessionId);
    assert.equal(after?.syncUpdated, before?.syncUpdated);
  });

  it('no late lo ajeno, lo cerrado, lo borrado ni lo inexistente', () => {
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });
    const closed = seedSession(fx.ctx, { playthroughId, startedAt: at(-hours(3)) });
    const deleted = seedSession(fx.ctx, { playthroughId, startedAt: at(-hours(9)) });
    fx.ctx.store.remove('sessions', deleted);

    const result = heartbeatSessions(
      fx.ctx,
      [foreign, closed, deleted, 'no-existe'],
      at(hours(10)),
    );

    assert.deepEqual(result.beaten, []);
    assert.deepEqual(result.skipped, [foreign, closed, deleted, 'no-existe']);
    assert.equal(count(fx.local, 'local_session_beats'), 0);
    assert.equal(sessionRow(fx.ctx, foreign)?.lastSeenAt?.getTime(), at(0).getTime());
  });

  it('pruneSessionBeats borra los latidos que ya no sirven y deja los de las abiertas propias', () => {
    const openId = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: null });
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const toClose = seedSession(fx.ctx, { emulatorId, startedAt: at(0), endedAt: null });
    heartbeatSessions(fx.ctx, [openId, toClose], at(5_000));
    closeSessionIfOpen(fx.ctx, toClose, { endedAt: at(6_000), closedBy: 'owner' });

    assert.equal(pruneSessionBeats(fx.ctx), 1);
    assert.equal(readSessionBeat(fx.ctx, toClose), null);
    assert.equal(readSessionBeat(fx.ctx, openId)?.getTime(), at(5_000).getTime());
  });
});

describe('el ciclo del watcher con las consultas de hoy no toca lo de otro PC', () => {
  it('reconciliación al arrancar: cierra las propias en su último latido, con closedBy owner', () => {
    // Una propia que latió hasta las 01:00:25 antes del corte, otra que nunca
    // latió, y una de otro PC abierta. El watcher cierra cada abierta que no
    // corre en `lastHeartbeatAt ?? startedAt` (watcher.ts, sin cambios).
    const beaten = seedSession(fx.ctx, { playthroughId, startedAt: at(0), endedAt: null });
    heartbeatSessions(fx.ctx, [beaten], at(hours(1) + 25_000));
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const silent = seedSession(fx.ctx, { emulatorId, startedAt: at(hours(2)), endedAt: null });
    const foreign = asOtherDevice(fx.ctx).seedSession({ playthroughId, endedAt: null });

    for (const session of getOpenSessions(fx.ctx)) {
      closeSession(fx.ctx, session.sessionId, {
        endedAt: session.lastHeartbeatAt ?? session.startedAt,
        closedBy: 'owner',
      });
    }

    assert.equal(sessionRow(fx.ctx, beaten)?.durationSec, 3625);
    assert.equal(sessionRow(fx.ctx, beaten)?.closedBy, 'owner');
    assert.equal(sessionRow(fx.ctx, silent)?.durationSec, 0);
    assert.equal(sessionRow(fx.ctx, foreign)?.endedAt, null);
  });
});

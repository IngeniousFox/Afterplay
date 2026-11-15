import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { parseClock, RESERVED_DEVICE_ID } from '../../../src/shared/sync/clock';
import type { Session } from '../../../src/shared/dto';
import { getAllSessions } from '../../../src/main/db/v2/queries/sessions/read';
import { getOpenSessions } from '../../../src/main/db/v2/queries/sessions/open';
import { closeSession, closeSessionIfOpen } from '../../../src/main/db/v2/queries/sessions/close';
import { heartbeatSessions } from '../../../src/main/db/v2/queries/sessions/heartbeat';
import { getWatchTargets } from '../../../src/main/db/v2/queries/sessions/watchTargets';
import { updateGame } from '../../../src/main/db/v2/queries/common/updateGame';
import { ABANDONED_SESSION_MS } from '../../core/hub';
import { addGame, openSession } from '../actions';
import { HOUR_MS, MINUTE_MS, World, convergenceProblems, type Client } from '../harness';

// Escenarios de aceptación de §17.3 de la fase 4 (sesiones, watcher e
// instalaciones por dispositivo). El watcher real no corre aquí (lee procesos e
// importa Electron): se ejercitan las MISMAS consultas que usa en cada ciclo
// (`getOpenSessions`, `heartbeatSessions`, `closeSessionIfOpen`,
// `getWatchTargets`) contra clientes reales que sincronizan con un hub real.
// E-07 (cierre ordenado al salir) se prueba con el watcher, no aquí.

let world: World | null = null;

const start = (): World => {
  world = new World();
  return world;
};

afterEach(() => {
  world?.close();
  world = null;
});

async function settle(w: World, clients?: readonly Client[]): Promise<void> {
  await w.quiesce();
  assert.deepEqual(convergenceProblems(w, clients), []);
}

const sessionIn = (client: Client, id: string): Session<string> => {
  const session = getAllSessions(client.ctx).find((s) => s.id === id);
  assert.ok(session, `${client.name} no ve la sesión ${id}`);
  return session;
};

/** Lo que hace el watcher de un PC en un ciclo con una sesión que no es suya. */
function watcherCycleTouches(client: Client, sessionId: string): boolean {
  const mine = getOpenSessions(client.ctx).some((s) => s.sessionId === sessionId);
  const beat = heartbeatSessions(client.ctx, [sessionId], client.ctx.now());
  const closed = closeSessionIfOpen(client.ctx, sessionId, {
    endedAt: client.ctx.now(),
    closedBy: 'owner',
  });
  return mine || beat.beaten.length > 0 || closed !== null;
}

describe('escenarios de la fase 4 (§17.3)', () => {
  it('E-01: B, encendido, recibe la sesión abierta de A y no la toca', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const gameId = addGame(a, 40001, { title: 'Juego largo' });
    await settle(w);

    const sessionId = openSession(a, gameId);
    assert.ok(sessionId);
    await settle(w);

    // Dos horas de partida en A; el watcher de B pasa cada rato por la sesión.
    for (let step = 0; step < 8; step++) {
      w.advance(15 * MINUTE_MS);
      heartbeatSessions(a.ctx, [sessionId], a.ctx.now());
      assert.equal(watcherCycleTouches(b, sessionId), false);
      await settle(w);
    }
    closeSession(a.ctx, sessionId, { endedAt: a.ctx.now(), closedBy: 'owner' });
    await settle(w);

    for (const client of [a, b]) {
      const session = sessionIn(client, sessionId);
      assert.equal(session.durationSec, 2 * 3600);
      assert.equal(session.closedBy, 'owner');
    }
  });

  it('E-02: B arranca el mismo juego antes de que llegue el cierre de A', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const gameId = addGame(a, 40002, { title: 'En dos PCs' });
    await settle(w);

    const fromA = openSession(a, gameId);
    assert.ok(fromA);
    await settle(w);
    w.advance(20 * MINUTE_MS);
    // La sesión abierta de A no impide que B abra la suya.
    const fromB = openSession(b, gameId);
    assert.ok(fromB);
    assert.notEqual(fromA, fromB);

    w.advance(40 * MINUTE_MS);
    closeSession(a.ctx, fromA, { endedAt: a.ctx.now(), closedBy: 'owner' });
    w.advance(30 * MINUTE_MS);
    closeSession(b.ctx, fromB, { endedAt: b.ctx.now(), closedBy: 'owner' });
    await settle(w);

    for (const client of [a, b]) {
      assert.equal(sessionIn(client, fromA).durationSec, 60 * 60);
      assert.equal(sessionIn(client, fromB).durationSec, 70 * 60);
      assert.equal(sessionIn(client, fromA).deviceId, a.ctx.deviceId);
      assert.equal(sessionIn(client, fromB).deviceId, b.ctx.deviceId);
    }
  });

  it('E-08: A muere con una sesión abierta; el hub la cierra a las 24 h en su última señal', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const gameId = addGame(a, 40008, { title: 'Corte de luz' });
    await settle(w);

    const sessionId = openSession(a, gameId);
    assert.ok(sessionId);
    w.advance(45 * MINUTE_MS);
    heartbeatSessions(a.ctx, [sessionId], a.ctx.now());
    const lastSign = a.ctx.now();
    await settle(w);
    a.cut(); // A muere y no vuelve.

    w.advance(ABANDONED_SESSION_MS - 1);
    assert.equal(w.hub.sweep().abandonedSessions, 0);
    w.advance(1);
    assert.equal(w.hub.sweep().abandonedSessions, 1);
    await settle(w, [b]);

    const session = sessionIn(b, sessionId);
    assert.equal(session.closedBy, 'janitor');
    assert.equal(session.endedAt?.getTime(), lastSign.getTime());
    assert.equal(session.durationSec, 45 * 60);
  });

  it('E-09: A estuvo 30 h offline con una sesión que cerró bien; gana el cierre de A', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const gameId = addGame(a, 40009, { title: 'Sin red' });
    await settle(w);

    const sessionId = openSession(a, gameId);
    assert.ok(sessionId);
    w.advance(30 * MINUTE_MS);
    heartbeatSessions(a.ctx, [sessionId], a.ctx.now());
    await settle(w);

    a.cut();
    w.advance(90 * MINUTE_MS);
    // A cierra bien, pero sin red.
    closeSession(a.ctx, sessionId, { endedAt: a.ctx.now(), closedBy: 'owner' });
    w.advance(28 * HOUR_MS);
    assert.equal(w.hub.sweep().abandonedSessions, 1);
    await settle(w, [b]);
    const swept = w.hubRows('sessions').get(sessionId);
    assert.equal(swept?.fields.closedBy, 'janitor');
    assert.equal(parseClock(swept!.clocks.closedBy).dev, RESERVED_DEVICE_ID);
    assert.equal(sessionIn(b, sessionId).closedBy, 'janitor');

    a.restore();
    await settle(w);
    for (const client of [a, b]) {
      const session = sessionIn(client, sessionId);
      assert.equal(session.closedBy, 'owner');
      assert.equal(session.durationSec, 2 * 3600);
    }
  });

  it('E-10: cada PC vigila su ruta; cambiar la de B no afecta a A', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const gameId = addGame(a, 40010, { title: 'Dos discos' });
    await settle(w);

    updateGame(a.ctx, gameId, { executablePath: 'C:\\Games\\DosDiscos\\game.exe' });
    updateGame(b.ctx, gameId, { executablePath: 'D:\\Juegos\\DosDiscos\\game.exe' });
    await settle(w);

    const pathOf = (client: Client): string | undefined =>
      getWatchTargets(client.ctx).find((t) => t.refId === gameId)?.exePath;
    assert.equal(pathOf(a), 'c:\\games\\dosdiscos\\game.exe');
    assert.equal(pathOf(b), 'd:\\juegos\\dosdiscos\\game.exe');

    updateGame(b.ctx, gameId, { executablePath: 'E:\\Otro\\game.exe' });
    await settle(w);
    assert.equal(pathOf(a), 'c:\\games\\dosdiscos\\game.exe');
    assert.equal(pathOf(b), 'e:\\otro\\game.exe');

    // Un juego instalado solo en A no se vigila en B.
    const onlyA = addGame(a, 40011, { title: 'Solo en A' });
    updateGame(a.ctx, onlyA, { executablePath: 'C:\\Games\\SoloA\\a.exe' });
    await settle(w);
    assert.ok(getWatchTargets(a.ctx).some((t) => t.refId === onlyA));
    assert.ok(!getWatchTargets(b.ctx).some((t) => t.refId === onlyA));
  });
});

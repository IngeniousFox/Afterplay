import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  createPlannedGame,
  reorderUpNext,
  setPlanPinned,
} from '../../../src/main/db/v2/queries/games';
import { getPlannedGames } from '../../../src/main/db/v2/queries/library';
import { getAllSessions } from '../../../src/main/db/v2/queries/sessions/read';
import { closeSession } from '../../../src/main/db/v2/queries/sessions/close';
import { startGameSession } from '../../../src/main/db/v2/queries/sessions/start';
import {
  LIVE_ELSEWHERE_MS,
  beatTimer,
  getActiveTimer,
  startTimer,
  stopTimer,
} from '../../../src/main/db/v2/queries/sessions/timer';
import { heartbeatSessions } from '../../../src/main/db/v2/queries/sessions/heartbeat';
import { enrichment, planInput } from '../../../src/main/db/v2/queries/games/__tests__/helpers';
import { externalChecks } from '../../../src/main/db/v2/schema';
import { WEB_DEVICE_ID } from '../../../src/shared/devices';
import { addGame, openSession, play } from '../actions';
import { MINUTE_MS, World, convergenceProblems, type Client } from '../harness';

// E-12 y E-13 (§17.3): las escrituras del móvil contra el hub y los PCs, con
// las mismas consultas que atiende `/api/v2` (web/writes.ts).

let world: World | null = null;
const start = (): World => (world = new World());
afterEach(() => {
  world?.close();
  world = null;
});

async function settle(w: World): Promise<void> {
  await w.quiesce();
  assert.deepEqual(convergenceProblems(w), []);
}

const pinnedAt = (client: Client, gameId: string): Date | null | undefined =>
  getPlannedGames(client.ctx).find((game) => game.id === gameId)?.planPinnedAt;

/** Las sesiones de un juego tal como las ve un PC, de la más antigua a la más reciente. */
const sessionsOf = (client: Client, gameId: string): ReturnType<typeof getAllSessions> =>
  getAllSessions(client.ctx, { gameId }).sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );

describe('E-12: el móvil escribe el plan con todos los PCs apagados (F-27)', () => {
  it('se ve fijado al instante en el hub y en cada PC cuando vuelve', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const first = createPlannedGame(
      a.ctx,
      planInput(),
      enrichment({ igdbId: 31001, title: 'Uno' }),
    );
    const second = createPlannedGame(
      a.ctx,
      planInput(),
      enrichment({ igdbId: 31002, title: 'Dos' }),
    );
    await settle(w);

    a.cut();
    b.cut();
    const seqBefore = w.hub.currentSeq();
    assert.equal(w.web().write((ctx) => setPlanPinned(ctx, first.id, true)).result, true);
    w.advance(MINUTE_MS);
    assert.equal(w.web().write((ctx) => setPlanPinned(ctx, second.id, true)).result, true);
    assert.ok(w.hub.currentSeq() > seqBefore);

    // Al instante, leyendo del hub (lo que ve la PWA)...
    const fromPhone = w.web().read((ctx) => getPlannedGames(ctx));
    assert.ok(fromPhone.find((game) => game.id === first.id)?.planPinnedAt);
    assert.ok(fromPhone.find((game) => game.id === second.id)?.planPinnedAt);
    // ...y los PCs apagados todavía no lo saben.
    assert.equal(pinnedAt(a, first.id), null);
    assert.equal(pinnedAt(b, first.id), null);

    // El móvil reordena y suelta, también sin PCs.
    w.web().write((ctx) => reorderUpNext(ctx, [second.id, first.id]));
    w.web().write((ctx) => setPlanPinned(ctx, first.id, false));

    a.restore();
    b.restore();
    await settle(w);
    for (const client of [a, b]) {
      assert.equal(pinnedAt(client, first.id), null, `${client.name}: soltado`);
      assert.ok(pinnedAt(client, second.id), `${client.name}: fijado`);
    }
  });

  it('un juego añadido desde el móvil existe al instante y los PCs lo bajan sin sellos de ficha', async () => {
    const w = start();
    const a = await w.addClient('a');
    await settle(w);
    a.cut();

    const { result } = w.web().write((ctx) =>
      createPlannedGame(
        ctx,
        planInput({ source: { igdbId: 31003 } }),
        enrichment({
          igdbId: 31003,
          title: 'Desde el móvil',
          steamAppId: null,
          steamGridDbId: null,
          hltbMain: null,
          developer: null,
          publisher: null,
          genres: null,
          officialPlatforms: null,
          summary: null,
        }),
        { stampChecks: false },
      ),
    );
    assert.equal(w.web().read((ctx) => getPlannedGames(ctx))[0].id, result.id);
    assert.equal(getPlannedGames(a.ctx).length, 0);
    assert.deepEqual(
      w.web().read((ctx) => ctx.db.select().from(externalChecks).all()),
      [],
      'sin external_checks: un PC completará la ficha',
    );

    a.restore();
    await settle(w);
    assert.equal(getPlannedGames(a.ctx)[0]?.title, 'Desde el móvil');
  });
});

describe('E-13: el cronómetro del móvil contra las sesiones de los PCs (F-28)', () => {
  it('con un cronómetro vivo ya sincronizado, el PC no abre su sesión del mismo juego', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const gameId = addGame(a, 32001, { title: 'Juego cronometrado' });
    await settle(w);

    const { result } = w.web().write((ctx) => startTimer(ctx, gameId));
    assert.equal(result.status, 'started');
    await settle(w);

    for (const client of [a, b]) {
      assert.equal(startGameSession(client.ctx, gameId, 'watcher'), null, client.name);
      assert.equal(openSession(client, gameId), null, client.name);
      const timer = sessionsOf(client, gameId);
      assert.equal(timer.length, 1);
      assert.equal(timer[0].startedBy, 'timer');
      assert.equal(timer[0].deviceId, WEB_DEVICE_ID);
    }
  });

  it('con una sesión viva de un PC ya en el hub, el cronómetro se niega y dice dónde', async () => {
    const w = start();
    const a = await w.addClient('a');
    const gameId = addGame(a, 32002, { title: 'Ya se juega' });
    await settle(w);
    const sessionId = openSession(a, gameId);
    assert.ok(sessionId);
    await settle(w);

    w.advance(5 * MINUTE_MS);
    const refused = w.web().write((ctx) => startTimer(ctx, gameId));
    assert.deepEqual(refused.result, {
      status: 'live_elsewhere',
      deviceId: a.deviceId,
      deviceName: 'PC-a',
    });
    assert.equal(
      w.web().read((ctx) => getActiveTimer(ctx)),
      null,
    );

    // El PC late (cada ≥60 s) y sigue contando como vivo pasado el umbral.
    w.advance(LIVE_ELSEWHERE_MS);
    heartbeatSessions(a.ctx, [sessionId], a.ctx.now());
    await settle(w);
    w.advance(MINUTE_MS);
    assert.equal(w.web().write((ctx) => startTimer(ctx, gameId)).result.status, 'live_elsewhere');

    // Sin latido durante el umbral (PC apagado de golpe), deja de bloquear.
    w.advance(LIVE_ELSEWHERE_MS);
    assert.equal(w.web().write((ctx) => startTimer(ctx, gameId)).result.status, 'started');
    await settle(w);
  });

  it('las horas no se cuentan dobles: partidas y cronómetro, uno detrás de otro', async () => {
    const w = start();
    const a = await w.addClient('a');
    const gameId = addGame(a, 32003, { title: 'Horas' });
    await settle(w);

    assert.ok(play(w, a, gameId, 30));
    await settle(w);

    const started = w.web().write((ctx) => startTimer(ctx, gameId)).result;
    assert.equal(started.status, 'started');
    const sessionId = started.status === 'started' ? started.timer.sessionId : '';
    await settle(w);
    // Mientras corre, el PC no suma su sesión encima.
    assert.equal(openSession(a, gameId), null);
    w.advance(20 * MINUTE_MS);
    w.web().write((ctx) => beatTimer(ctx, sessionId));
    w.advance(10 * MINUTE_MS);
    const stopped = w.web().write((ctx) => stopTimer(ctx, sessionId)).result;
    assert.equal(stopped.status, 'stopped');
    await settle(w);

    // Y al parar, el PC vuelve a poder medir.
    assert.ok(play(w, a, gameId, 15));
    await settle(w);

    const all = sessionsOf(a, gameId);
    assert.equal(all.length, 3);
    assert.deepEqual(
      all.map((session) => session.durationSec),
      [30 * 60, 30 * 60, 15 * 60],
    );
    for (let i = 1; i < all.length; i++) {
      assert.ok(
        all[i].startedAt.getTime() >= (all[i - 1].endedAt ?? all[i - 1].startedAt).getTime(),
        'ningún intervalo se pisa con el anterior',
      );
    }
    assert.equal(
      all.reduce((total, session) => total + (session.durationSec ?? 0), 0),
      75 * 60,
    );
  });

  it('LO QUE NO SE PUEDE IMPEDIR: el PC abre su sesión sin red y el móvil arranca antes de que suba', async () => {
    const w = start();
    const a = await w.addClient('a');
    const gameId = addGame(a, 32004, { title: 'Carrera' });
    await settle(w);

    // A abre su sesión sin red: el hub no sabe nada.
    a.cut();
    const local = openSession(a, gameId);
    assert.ok(local);
    // El móvil arranca el cronómetro: no ve ninguna sesión viva, y es legítimo.
    const started = w.web().write((ctx) => startTimer(ctx, gameId)).result;
    assert.equal(started.status, 'started');

    // Al volver la red, las dos filas existen: es D-15 (una por dispositivo) y
    // se suman. El sistema converge, pero las horas del tramo común van dobles.
    a.restore();
    await settle(w);
    const all = sessionsOf(a, gameId);
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((session) => session.startedBy).sort(), ['timer', 'watcher']);

    // Cada una se cierra por su dueño y todo converge.
    w.advance(10 * MINUTE_MS);
    closeSession(a.ctx, local, { endedAt: a.ctx.now(), closedBy: 'owner' });
    const timerId = all.find((session) => session.startedBy === 'timer')?.id ?? '';
    w.web().write((ctx) => stopTimer(ctx, timerId));
    await settle(w);
    assert.equal(
      sessionsOf(a, gameId).every((session) => session.endedAt !== null),
      true,
    );
  });
});

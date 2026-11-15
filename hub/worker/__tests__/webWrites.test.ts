import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ActiveTimerDto,
  PlanAddResponse,
  PlanPinResponse,
  PlanReorderResponse,
  TimerBeatResponse,
  TimerStopResponse,
} from '../../../src/shared/api/v2/writes';
import { WEB_DEVICE_ID } from '../../../src/shared/devices';
import { getPlannedGames } from '../../../src/main/db/v2/queries/library';
import { getAllSessions } from '../../../src/main/db/v2/queries/sessions';
import { externalChecks } from '../../../src/main/db/v2/schema';
import type { TenantService } from '../src/tenantService';
import { HOST, makeWorld, pairDevice, type World } from './helpers';

// Las escrituras de la PWA a través de `/api/v2` (web/writes.ts): el reparto,
// la validación del cuerpo y los códigos de error. Las reglas del cronómetro
// y del plan las prueban las consultas y los tests de convergencia; aquí se
// comprueba que llegan bien por la ruta.

interface Reply<T> {
  status: number;
  body: T & { error?: string; message?: string };
}

async function post<T>(world: World, path: string, body: unknown): Promise<Reply<T>> {
  const response = await world.call(`/api/v2${path}`, { method: 'POST', email: HOST, body });
  return { status: response.status, body: (await response.json()) as Reply<T>['body'] };
}

async function get<T>(world: World, path: string): Promise<Reply<T>> {
  const response = await world.call(`/api/v2${path}`, { email: HOST });
  return { status: response.status, body: (await response.json()) as Reply<T>['body'] };
}

/** Un mundo con el inquilino creado (un PC emparejado) y sus consultas listas. */
async function setup(): Promise<{ world: World; service: TenantService }> {
  const world = makeWorld();
  const { tenantId } = await pairDevice(world);
  const service = world.services.get(tenantId);
  assert.ok(service);
  return { world, service };
}

const IGDB = { igdbId: 1942, title: 'Hollow Knight', coverUrl: 'https://img.test/hk.jpg' };

/** Un juego de la biblioteca (no del Plan), escrito como lo escribiría un PC. */
function seedLibraryGame(service: TenantService): string {
  return service
    .queries()
    .write((ctx) => ctx.store.create('games', { title: 'Celeste', addedAt: ctx.now() }).id).result;
}

describe('POST /plan/*', () => {
  it('añadir crea el juego en el Plan al momento y no sella external_checks', async () => {
    const { world, service } = await setup();
    const added = await post<PlanAddResponse>(world, '/plan/add', { ...IGDB, releaseYear: 2017 });
    assert.equal(added.status, 200);

    const planned = service.queries().read((ctx) => getPlannedGames(ctx));
    assert.equal(planned.length, 1);
    assert.equal(planned[0].id, added.body.gameId);
    assert.equal(planned[0].title, 'Hollow Knight');
    assert.equal(planned[0].coverUrl, 'https://img.test/hk.jpg');
    assert.equal(planned[0].releaseYear, 2017);
    const checks = service.queries().read((ctx) => ctx.db.select().from(externalChecks).all());
    assert.deepEqual(checks, [], 'un PC completará la ficha: sin sellos');
  });

  it('un igdbId ya vivo es conflict y no escribe nada', async () => {
    const { world, service } = await setup();
    await post(world, '/plan/add', IGDB);
    const before = service.hub.currentSeq();
    const again = await post(world, '/plan/add', IGDB);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'conflict');
    assert.equal(service.hub.currentSeq(), before);
  });

  it('rechaza cuerpos inválidos', async () => {
    const { world } = await setup();
    for (const body of [
      {},
      { ...IGDB, igdbId: 0 },
      { ...IGDB, igdbId: '5' },
      { ...IGDB, title: '  ' },
      { ...IGDB, coverUrl: 'javascript:alert(1)' },
      { ...IGDB, releaseYear: 20170 },
      [],
    ]) {
      const reply = await post(world, '/plan/add', body);
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.equal(reply.body.error, 'invalid_request');
    }
  });

  it('fijar y soltar escriben directamente; un juego fuera del Plan es not_found', async () => {
    const { world, service } = await setup();
    const { body: added } = await post<PlanAddResponse>(world, '/plan/add', IGDB);
    const pinned = await post<PlanPinResponse>(world, '/plan/pin', { gameId: added.gameId });
    assert.deepEqual(pinned.body, { gameId: added.gameId, pinned: true });
    assert.ok(service.queries().read((ctx) => getPlannedGames(ctx))[0].planPinnedAt);

    const unpinned = await post<PlanPinResponse>(world, '/plan/unpin', { gameId: added.gameId });
    assert.equal(unpinned.body.pinned, false);
    assert.equal(service.queries().read((ctx) => getPlannedGames(ctx))[0].planPinnedAt, null);

    const missing = await post(world, '/plan/pin', { gameId: 'no-existe' });
    assert.equal(missing.status, 404);
    const noBody = await post(world, '/plan/pin', {});
    assert.equal(noBody.status, 400);
  });

  it('reordenar reparte las marcas de los fijados', async () => {
    const { world, service } = await setup();
    const ids: string[] = [];
    for (const [index, igdbId] of [11, 12].entries()) {
      const { body } = await post<PlanAddResponse>(world, '/plan/add', {
        ...IGDB,
        igdbId,
        title: `Juego ${index}`,
      });
      ids.push(body.gameId);
      world.time.now += 1000;
      await post(world, '/plan/pin', { gameId: body.gameId });
    }
    const order = (): string[] =>
      service
        .queries()
        .read((ctx) => getPlannedGames(ctx))
        .filter((game) => game.planPinnedAt)
        .sort((a, b) => a.planPinnedAt!.getTime() - b.planPinnedAt!.getTime())
        .map((game) => game.id);
    assert.deepEqual(order(), ids);

    const reply = await post<PlanReorderResponse>(world, '/plan/reorder', {
      orderedIds: [ids[1], ids[0]],
    });
    assert.equal(reply.body.applied, true);
    assert.deepEqual(order(), [ids[1], ids[0]]);

    assert.equal((await post(world, '/plan/reorder', { orderedIds: 'x' })).status, 400);
    assert.equal((await post(world, '/plan/reorder', { orderedIds: [1] })).status, 400);
  });
});

describe('/timer', () => {
  it('arrancar, latir, consultar y parar', async () => {
    const { world, service } = await setup();
    const gameId = seedLibraryGame(service);
    assert.equal((await get<ActiveTimerDto | null>(world, '/timer')).body, null);

    const started = await post<ActiveTimerDto>(world, '/timer/start', { gameId });
    assert.equal(started.status, 200);
    assert.equal(started.body.gameId, gameId);
    assert.equal(started.body.title, 'Celeste');

    world.time.now += 5 * 60_000;
    const beat = await post<TimerBeatResponse>(world, '/timer/beat', {
      sessionId: started.body.sessionId,
    });
    assert.equal(beat.body.alive, true);
    const active = await get<ActiveTimerDto>(world, '/timer');
    assert.equal(active.body.sessionId, started.body.sessionId);
    assert.equal(
      active.body.lastSeenAt,
      new Date(world.time.now).toISOString(),
      'el latido movió la señal',
    );

    world.time.now += 5 * 60_000;
    const stopped = await post<TimerStopResponse>(world, '/timer/stop', {
      sessionId: started.body.sessionId,
    });
    assert.equal(stopped.body.durationSec, 600);
    assert.equal(stopped.body.stoppedNow, true);
    assert.equal((await get<ActiveTimerDto | null>(world, '/timer')).body, null);
    const row = service
      .queries()
      .read((ctx) => getAllSessions(ctx))
      .find((session) => session.id === started.body.sessionId);
    assert.equal(row?.closedBy, 'user');
    assert.equal(row?.deviceId, WEB_DEVICE_ID);

    const again = await post<TimerStopResponse>(world, '/timer/stop', {
      sessionId: started.body.sessionId,
    });
    assert.equal(again.body.stoppedNow, false);
    assert.equal(again.body.durationSec, 600);
    const late = await post<TimerBeatResponse>(world, '/timer/beat', {
      sessionId: started.body.sessionId,
    });
    assert.equal(late.body.alive, false);
  });

  it('un segundo cronómetro es conflict', async () => {
    const { world, service } = await setup();
    const gameId = seedLibraryGame(service);
    await post(world, '/timer/start', { gameId });
    const second = await post(world, '/timer/start', { gameId });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'conflict');
  });

  it('un juego que no existe es not_found y los cuerpos rotos invalid_request', async () => {
    const { world } = await setup();
    assert.equal((await post(world, '/timer/start', { gameId: 'no-existe' })).status, 404);
    assert.equal((await post(world, '/timer/start', {})).status, 400);
    assert.equal((await post(world, '/timer/stop', { sessionId: 'no-existe' })).status, 404);
    assert.equal((await post(world, '/timer/beat', { sessionId: 7 })).status, 400);
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { WEB_DEVICE_ID } from '../../../src/shared/devices';
import { createPlannedGame, setPlanPinned } from '../../../src/main/db/v2/queries/games';
import { getPlannedGames } from '../../../src/main/db/v2/queries/library';
import { getDevices } from '../../../src/main/db/v2/queries/devices';
import { enrichment, planInput } from '../../../src/main/db/v2/queries/games/__tests__/helpers';
import { World, convergenceProblems } from '../harness';

// Las consultas del escritorio corriendo en el hub para el móvil (§13.2,
// §13.3): la base de la fase 5. Las rutas de la API van aparte.

let world: World | null = null;
afterEach(() => {
  world?.close();
  world = null;
});

async function settle(w: World): Promise<void> {
  await w.quiesce();
  assert.deepEqual(convergenceProblems(w), []);
}

describe('consultas del escritorio en el hub', () => {
  it('el móvil lee el plan con la misma consulta que el escritorio', async () => {
    const w = (world = new World());
    const a = await w.addClient('a');
    const planned = createPlannedGame(a.ctx, planInput(), enrichment({ title: 'Silksong' }));
    await settle(w);

    const fromPhone = w.web().read((ctx) => getPlannedGames(ctx));
    assert.deepEqual(fromPhone, getPlannedGames(a.ctx));
    assert.equal(fromPhone[0].id, planned.id);
  });

  it('el móvil fija un juego y el PC lo baja; el móvil aparece como dispositivo', async () => {
    const w = (world = new World());
    const a = await w.addClient('a');
    const planned = createPlannedGame(a.ctx, planInput(), enrichment());
    await settle(w);
    const before = w.hub.currentSeq();

    const { result, seq } = w.web().write((ctx) => setPlanPinned(ctx, planned.id, true));
    assert.equal(result, true);
    assert.ok(seq > before, 'la escritura del móvil tiene secuencia nueva');

    await settle(w);
    const onPc = getPlannedGames(a.ctx).find((game) => game.id === planned.id);
    assert.ok(onPc?.planPinnedAt, 'el PC ve el juego fijado');
    assert.ok(getDevices(a.ctx).some((device) => device.id === WEB_DEVICE_ID));
    // Fijar otra vez no escribe nada (F-33): ni filas ni secuencia.
    const again = w.web().write((ctx) => setPlanPinned(ctx, planned.id, true));
    assert.equal(again.seq, w.hub.currentSeq());
    assert.equal(again.seq, seq);
  });

  it('una lectura que escribe falla y no deja nada', async () => {
    const w = (world = new World());
    const a = await w.addClient('a');
    const planned = createPlannedGame(a.ctx, planInput(), enrichment());
    await settle(w);
    const before = w.hub.currentSeq();
    assert.throws(() => w.web().read((ctx) => setPlanPinned(ctx, planned.id, true)), /ha escrito/);
    assert.equal(w.hub.currentSeq(), before);
    assert.equal(w.web().read((ctx) => getPlannedGames(ctx))[0].planPinnedAt, null);
  });

  it('el reloj del móvil sobrevive a un Durable Object nuevo y nunca retrocede', async () => {
    const w = (world = new World());
    const a = await w.addClient('a');
    const planned = createPlannedGame(a.ctx, planInput(), enrichment());
    await settle(w);
    w.web().write((ctx) => setPlanPinned(ctx, planned.id, true));
    const first = String(w.hubRows('plan_entries').get(planned.id)?.clocks.pinnedAt);
    // Misma hora del hub: el reloj guardado obliga a ir por delante.
    w.web().write((ctx) => setPlanPinned(ctx, planned.id, false));
    const second = String(w.hubRows('plan_entries').get(planned.id)?.clocks.pinnedAt);
    assert.ok(second > first, `${second} > ${first}`);
  });
});

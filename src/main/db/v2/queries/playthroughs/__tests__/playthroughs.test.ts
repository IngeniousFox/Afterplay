import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BOTTOM } from '../../../../../../shared/sync/clock';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import { isStoreError } from '../../../store';
import {
  asOtherDevice,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedSpendEvent,
  seedStateEvent,
  seedUnlock,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import type { Iteration } from '../../../../../../shared/dto';
import { createIteration, deleteIteration, updateIteration } from '../playthroughs';
import { derivedDetail } from './detail';

// Crear, editar y borrar playthroughs sobre el esquema 2.0 (CONSULTAS.md
// §1.4). La 1.x no tenía tests propios de estas tres funciones (su regla de
// etiqueta vivía en `nextPlaythroughLabel`, que en 2.0 sustituye la posición
// de `common/labels.ts`); estos son los casos del contrato nuevo.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const UNKNOWN_ID = '0194c2f0-0000-7000-8000-000000000000';

const crear = (
  gameId: string,
  extra: Partial<Parameters<typeof createIteration>[1]> = {},
): Iteration<string> =>
  createIteration(fx.ctx, { gameId, playedPlatform: 'PC', origin: 'Steam', ...extra });

describe('createIteration', () => {
  it('sin etiqueta: customLabel queda sin escribir y el DTO devuelve "Playthrough N"', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const primero = crear(gameId);
    const segundo = crear(gameId, { label: '   ' });

    assert.equal(primero.label, 'Playthrough 1');
    assert.equal(segundo.label, 'Playthrough 2');
    assert.equal(rawRow(fx.local, 'playthroughs', primero.id)?.customLabel, null);
    assert.equal(rawRow(fx.local, 'playthroughs', segundo.id)?.customLabel, null);
    // Omitir no es escribir null (H-2): la columna se queda con BOTTOM ("nadie
    // la ha escrito"), no con el reloj de creación.
    const fields = JSON.parse(String(rawRow(fx.local, 'playthroughs', primero.id)?.syncFields));
    assert.equal(fields.customLabel, BOTTOM);
  });

  it('una etiqueta igual a la automática de su posición no se guarda; otra sí', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const auto = crear(gameId, { label: 'Playthrough 1' });
    const propia = crear(gameId, { label: '  NG+ ' });

    assert.equal(rawRow(fx.local, 'playthroughs', auto.id)?.customLabel, null);
    assert.equal(propia.label, 'NG+');
    assert.equal(rawRow(fx.local, 'playthroughs', propia.id)?.customLabel, 'NG+');
  });

  it('borrar el 1 no renombra el 2, y el siguiente es el 3 (R-03)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const primero = crear(gameId);
    crear(gameId);
    deleteIteration(fx.ctx, primero.id);

    const tercero = crear(gameId, { label: 'Playthrough 3' });
    assert.equal(tercero.label, 'Playthrough 3');
    assert.equal(rawRow(fx.local, 'playthroughs', tercero.id)?.customLabel, null);
  });

  it('manualTotalPlayed va a manualHours y el resto de campos tal cual', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const creado = crear(gameId, {
      playedPlatform: 'Switch',
      origin: 'eShop',
      format: 'physical',
      manualTotalPlayed: 12.5,
    });
    assert.deepEqual(
      { ...creado, id: undefined },
      {
        id: undefined,
        gameId,
        label: 'Playthrough 1',
        playedPlatform: 'Switch',
        origin: 'eShop',
        format: 'physical',
        manualTotalPlayed: 12.5,
        rating: null,
        extraContent: false,
      },
    );
    assert.equal(rawRow(fx.local, 'playthroughs', creado.id)?.manualHours, 12.5);
  });

  it('las horas manuales se SUMAN a las medidas (§7.5)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const creado = crear(gameId, { manualTotalPlayed: 10 });
    seedSession(fx.ctx, {
      playthroughId: creado.id,
      endedAt: new Date(fx.ctx.now().getTime() + 2 * 3_600_000),
    });
    assert.equal(derivedDetail(fx.ctx, gameId).totalHours, 12);
  });

  it('juego inexistente → not_found; con lápida → deleted; no se escribe nada', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    fx.ctx.store.remove('games', gameId);
    assert.throws(
      () => crear(UNKNOWN_ID),
      (e: unknown) => isStoreError(e, 'not_found'),
    );
    assert.throws(
      () => crear(gameId),
      (e: unknown) => isStoreError(e, 'deleted'),
    );
    assert.equal(count(fx.local, 'playthroughs'), 0);
  });
});

describe('updateIteration', () => {
  it('reparte el patch: label → customLabel, manualTotalPlayed → manualHours', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const pt = seedPlaythrough(fx.ctx, { gameId });

    const row = updateIteration(fx.ctx, pt, {
      label: 'Speedrun',
      playedPlatform: 'Switch',
      origin: 'eShop',
      format: 'digital',
      manualTotalPlayed: 3,
      extraContent: true,
      rating: 5,
    });

    assert.equal(row?.label, 'Speedrun');
    assert.equal(row?.manualTotalPlayed, 3);
    assert.equal(row?.rating, 5);
    assert.equal(row?.extraContent, true);
    const raw = rawRow(fx.local, 'playthroughs', pt);
    assert.equal(raw?.customLabel, 'Speedrun');
    assert.equal(raw?.manualHours, 3);
  });

  it('volver a poner la etiqueta automática (o vaciarla) guarda null', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    seedPlaythrough(fx.ctx, { gameId });
    const pt = seedPlaythrough(fx.ctx, { gameId, customLabel: 'NG+' });

    assert.equal(updateIteration(fx.ctx, pt, { label: 'Playthrough 2' })?.label, 'Playthrough 2');
    assert.equal(rawRow(fx.local, 'playthroughs', pt)?.customLabel, null);

    updateIteration(fx.ctx, pt, { label: 'NG+' });
    assert.equal(updateIteration(fx.ctx, pt, { label: '' })?.label, 'Playthrough 2');
    assert.equal(rawRow(fx.local, 'playthroughs', pt)?.customLabel, null);
  });

  it('un patch vacío o sin cambios no escribe (F-33) y devuelve la fila', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const pt = seedPlaythrough(fx.ctx, { gameId, manualHours: 4 });
    markClean(fx.local, 'playthroughs');

    assert.equal(updateIteration(fx.ctx, pt, {})?.id, pt);
    assert.equal(
      updateIteration(fx.ctx, pt, { manualTotalPlayed: 4, label: 'Playthrough 1' })?.id,
      pt,
    );
    assert.equal(count(fx.local, 'playthroughs', 'syncDirty = 1'), 0);
  });

  it('null si no existe, si está borrado o si su juego está borrado (F-11)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const borrado = seedPlaythrough(fx.ctx, { gameId });
    const huerfano = seedPlaythrough(fx.ctx, { gameId });
    fx.ctx.store.remove('playthroughs', borrado);

    assert.equal(updateIteration(fx.ctx, UNKNOWN_ID, { origin: 'GOG' }), null);
    assert.equal(updateIteration(fx.ctx, borrado, { origin: 'GOG' }), null);
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.equal(updateIteration(fx.ctx, huerfano, { origin: 'GOG' }), null);
    assert.equal(rawRow(fx.local, 'playthroughs', huerfano)?.origin, 'Steam');
  });
});

describe('deleteIteration', () => {
  it('lápida al playthrough, sus eventos y sus sesiones (también las de otro PC)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    const event = seedStateEvent(fx.ctx, { playthroughId: pt });
    const session = seedSession(fx.ctx, { playthroughId: pt });
    const ajena = asOtherDevice(fx.ctx).seedSession({ playthroughId: pt, endedAt: null });

    assert.equal(deleteIteration(fx.ctx, pt), true);

    for (const [table, id] of [
      ['playthroughs', pt],
      ['state_events', event],
      ['sessions', session],
      ['sessions', ajena],
    ] as const) {
      assert.notEqual(rawRow(fx.local, table, id)?.syncDeleted, null, `${table} ${id} con lápida`);
    }
  });

  it('los gastos y desbloqueos que lo apuntan quedan sin playthrough, no se borran', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    const session = seedSession(fx.ctx, { playthroughId: pt });
    const spend = seedSpendEvent(fx.ctx, { gameId, playthroughId: pt });
    const unlock = seedUnlock(fx.ctx, {
      gameId,
      apiName: 'ACH_1',
      playthroughId: pt,
      sessionId: session,
    });

    assert.equal(deleteIteration(fx.ctx, pt), true);

    const gasto = rawRow(fx.local, 'spend_events', spend);
    assert.equal(gasto?.syncDeleted, null);
    assert.equal(gasto?.playthroughId, null);
    const logro = rawRow(fx.local, 'achievement_unlocks', unlock);
    assert.equal(logro?.syncDeleted, null);
    assert.equal(logro?.playthroughId, null);
    // La sesión también se ha borrado, así que su referencia se anula igual.
    assert.equal(logro?.sessionId, null);
    // Y el gasto sigue contando en el juego.
    assert.equal(derivedDetail(fx.ctx, gameId).totalSpend, 10);
  });

  it('el estado del juego pasa a derivarse del playthrough que queda', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const viejo = seedPlaythrough(fx.ctx, { gameId });
    const nuevo = seedPlaythrough(fx.ctx, { gameId });
    seedStateEvent(fx.ctx, { playthroughId: viejo, type: 'completed', occurredAt: new Date(1e12) });
    seedStateEvent(fx.ctx, { playthroughId: nuevo, type: 'started', occurredAt: new Date(2e12) });

    deleteIteration(fx.ctx, nuevo);

    const detalle = derivedDetail(fx.ctx, gameId);
    assert.equal(detalle.iterations.length, 1);
    assert.equal(detalle.currentState, 'completed');
  });

  it('false si no existe, si ya estaba borrado o si su juego está borrado (F-11)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const pt = seedPlaythrough(fx.ctx, { gameId });
    const huerfano = seedPlaythrough(fx.ctx, { gameId });

    assert.equal(deleteIteration(fx.ctx, UNKNOWN_ID), false);
    assert.equal(deleteIteration(fx.ctx, pt), true);
    assert.equal(deleteIteration(fx.ctx, pt), false);
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.equal(deleteIteration(fx.ctx, huerfano), false);
    assert.equal(rawRow(fx.local, 'playthroughs', huerfano)?.syncDeleted, null);
  });
});

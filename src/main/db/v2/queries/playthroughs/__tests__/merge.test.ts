import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { count, rawRow, T0 } from '../../../__tests__/helpers';
import {
  playthroughs,
  sessions,
  spendEvents,
  stateEvents,
  achievementUnlocks,
} from '../../../schema';
import { isStoreError } from '../../../store';
import {
  asOtherDevice,
  at,
  hours,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedSpendEvent,
  seedStateEvent,
  seedUnlock,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGameById } from '../../library/getGameById';
import { getGames } from '../../library/getGames';
import { resolvePlaythroughForSession } from '../../sessions/resolvePlaythrough';
import {
  PlaythroughMergeError,
  findConcurrentActivePlaythroughs,
  isPlaythroughMergeError,
  mergePlaythroughs,
} from '../merge';

// Dos playthroughs activos del mismo juego creados offline en dos PCs (§10.7):
// la tolerancia (el vigente es el de `syncCreated` más reciente) y la
// reparación (fusionarlos). Datos inventados.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

/**
 * Dos playthroughs del mismo juego con el id AL REVÉS que el reloj: `older` se
 * creó antes (su `syncCreated` es menor) pero su id es MAYOR, porque el PC que
 * creó `newer` tenía el reloj de pared atrasado. Es el caso que el id solo no
 * sabe ordenar (F-09).
 */
function invertedPair(gameId: string): { older: string; newer: string } {
  fx.wall.set(T0 + hours(48));
  const older = seedPlaythrough(fx.ctx, { gameId });
  fx.wall.set(T0);
  const newer = seedPlaythrough(fx.ctx, { gameId });
  const clockOf = (id: string): string => String(rawRow(fx.local, 'playthroughs', id)?.syncCreated);
  assert.ok(newer < older, 'precondición: el id de `newer` es menor');
  assert.ok(clockOf(older) < clockOf(newer), 'precondición: su reloj es mayor');
  return { older, newer };
}

const startedAt = (playthroughId: string, ms: number): string =>
  seedStateEvent(fx.ctx, { playthroughId, type: 'started', occurredAt: at(ms) });

describe('findConcurrentActivePlaythroughs', () => {
  it('un juego con un solo playthrough activo no tiene nada concurrente', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const only = seedPlaythrough(fx.ctx, { gameId });
    startedAt(only, 1);
    assert.deepEqual(findConcurrentActivePlaythroughs(fx.ctx, gameId), []);
    assert.deepEqual(findConcurrentActivePlaythroughs(fx.ctx, 'no-existe'), []);
  });

  it('lista los activos en orden de creación y marca como vigente el más reciente', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const { older, newer } = invertedPair(gameId);
    startedAt(older, hours(1));
    startedAt(newer, hours(2));
    const found = findConcurrentActivePlaythroughs(fx.ctx, gameId);
    assert.deepEqual(
      found.map((entry) => [entry.id, entry.label, entry.current]),
      [
        [older, 'Playthrough 1', false],
        [newer, 'Playthrough 2', true],
      ],
    );
  });

  it('uno completado, borrado o sin eventos no cuenta', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const first = seedPlaythrough(fx.ctx, { gameId });
    const second = seedPlaythrough(fx.ctx, { gameId });
    const third = seedPlaythrough(fx.ctx, { gameId });
    seedPlaythrough(fx.ctx, { gameId }); // sin eventos
    startedAt(first, 1);
    startedAt(second, 2);
    startedAt(third, 3);
    assert.equal(findConcurrentActivePlaythroughs(fx.ctx, gameId).length, 3);

    seedStateEvent(fx.ctx, { playthroughId: first, type: 'completed', occurredAt: at(hours(1)) });
    fx.ctx.store.remove('playthroughs', second);
    assert.deepEqual(
      findConcurrentActivePlaythroughs(fx.ctx, gameId),
      [],
      'solo queda uno activo: no hay concurrencia',
    );
  });

  it('los activos de otro juego no se mezclan', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const other = seedGame(fx.ctx, { title: 'Hades' });
    startedAt(seedPlaythrough(fx.ctx, { gameId }), 1);
    startedAt(seedPlaythrough(fx.ctx, { gameId: other }), 1);
    assert.deepEqual(findConcurrentActivePlaythroughs(fx.ctx, gameId), []);
  });
});

describe('tolerancia: con dos activos manda syncCreated y no el id', () => {
  it('la sesión nueva cae en el playthrough creado después, aunque su id sea menor', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const { older, newer } = invertedPair(gameId);
    startedAt(older, hours(1));
    startedAt(newer, hours(2));
    fx.wall.set(T0 + hours(72));
    const result = resolvePlaythroughForSession(fx.ctx, gameId, fx.ctx.now());
    assert.deepEqual(result, { playthroughId: newer, kind: 'use' });
  });

  it('la ficha numera y ordena los playthroughs por syncCreated', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const { older, newer } = invertedPair(gameId);
    startedAt(older, hours(1));
    startedAt(newer, hours(2));
    const detail = getGameById(fx.ctx, gameId);
    assert.deepEqual(
      detail?.iterations.map((entry) => [entry.id, entry.label]),
      [
        [older, 'Playthrough 1'],
        [newer, 'Playthrough 2'],
      ],
    );
  });

  it('el reparto del gasto recorre los playthroughs por syncCreated', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const { older, newer } = invertedPair(gameId);
    startedAt(older, hours(1));
    seedStateEvent(fx.ctx, { playthroughId: older, type: 'completed', occurredAt: at(hours(10)) });
    startedAt(newer, hours(20));
    seedSpendEvent(fx.ctx, { gameId, amount: 30, occurredAt: at(hours(5)) });
    const detail = getGameById(fx.ctx, gameId);
    const spendOf = (id: string): number | undefined =>
      detail?.iterations.find((entry) => entry.id === id)?.spend;
    // El primero por reloj (`older`, cerrado el día 10) se queda con el gasto
    // anterior a su cierre. Por id el primero sería `newer` y se lo quedaría él.
    assert.equal(spendOf(older), 30);
    assert.equal(spendOf(newer), 0);
  });

  it('la ficha no filtra syncCreated al renderer', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const { older } = invertedPair(gameId);
    startedAt(older, hours(1));
    const detail = getGameById(fx.ctx, gameId)!;
    assert.equal('syncCreated' in detail.iterations[0], false);
    assert.equal('syncCreated' in detail.stateHistory[0], false);
  });
});

describe('mergePlaythroughs', () => {
  /** Dos playthroughs activos con de todo colgando del sobrante. */
  function scenario(): Record<string, string> & { gameId: string } {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const keepId = seedPlaythrough(fx.ctx, { gameId, manualHours: 2 });
    const dropId = seedPlaythrough(fx.ctx, { gameId, manualHours: 1.5 });
    startedAt(keepId, hours(1));
    const dropEvent = startedAt(dropId, hours(2));
    const ownSession = seedSession(fx.ctx, {
      playthroughId: dropId,
      startedAt: at(hours(3)),
      endedAt: at(hours(4)),
    });
    const keepSession = seedSession(fx.ctx, {
      playthroughId: keepId,
      startedAt: at(hours(5)),
      endedAt: at(hours(6)),
    });
    const other = asOtherDevice(fx.ctx);
    const foreignClosed = other.seedSession({
      playthroughId: dropId,
      startedAt: at(hours(7)),
      endedAt: at(hours(9)),
    });
    const foreignOpen = other.seedSession({
      playthroughId: dropId,
      startedAt: at(hours(10)),
      endedAt: null,
    });
    const spend = seedSpendEvent(fx.ctx, { gameId, playthroughId: dropId, amount: 12 });
    const unlock = seedUnlock(fx.ctx, { gameId, apiName: 'ACH_1', playthroughId: dropId });
    return {
      gameId,
      keepId,
      dropId,
      dropEvent,
      ownSession,
      keepSession,
      foreignClosed,
      foreignOpen,
      spend,
      unlock,
    };
  }

  const playthroughOf = (
    table: 'sessions' | 'state_events' | 'spend_events' | 'achievement_unlocks',
    id: string,
  ): unknown => rawRow(fx.local, table, id)?.playthroughId;

  it('mueve todo lo que cuelga del sobrante, también las sesiones de otro dispositivo', () => {
    const s = scenario();
    const result = mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId });

    assert.deepEqual(result.moved, {
      sessions: 3,
      stateEvents: 1,
      spendEvents: 1,
      achievementUnlocks: 1,
    });
    assert.equal(result.manualHoursAdded, 1.5);
    for (const id of [s.ownSession, s.foreignClosed, s.foreignOpen]) {
      assert.equal(playthroughOf('sessions', id), s.keepId);
    }
    assert.equal(playthroughOf('state_events', s.dropEvent), s.keepId);
    assert.equal(playthroughOf('spend_events', s.spend), s.keepId);
    assert.equal(playthroughOf('achievement_unlocks', s.unlock), s.keepId);
    // Las filas movidas siguen vivas (la lápida del sobrante no las arrastró).
    for (const [table, id] of [
      ['sessions', s.foreignOpen],
      ['sessions', s.ownSession],
      ['state_events', s.dropEvent],
      ['spend_events', s.spend],
      ['achievement_unlocks', s.unlock],
    ] as const) {
      assert.equal(rawRow(fx.local, table, id)?.syncDeleted, null, `${table} ${id} sigue viva`);
    }
    // El dueño de la sesión ajena no cambia: solo se movió `playthroughId`.
    assert.notEqual(rawRow(fx.local, 'sessions', s.foreignOpen)?.deviceId, fx.ctx.deviceId);
    // El sobrante tiene lápida y el que se queda sigue vivo.
    assert.notEqual(rawRow(fx.local, 'playthroughs', s.dropId)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'playthroughs', s.keepId)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'playthroughs', s.keepId)?.manualHours, 3.5);
  });

  it('las escrituras llevan reloj por campo y marcan sucias solo las filas tocadas', () => {
    const s = scenario();
    fx.local.db.$client.exec('UPDATE sessions SET syncDirty = 0');
    mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId });
    assert.equal(rawRow(fx.local, 'sessions', s.foreignClosed)?.syncDirty, 1);
    // La sesión del que se queda no se ha tocado.
    assert.equal(rawRow(fx.local, 'sessions', s.keepSession)?.syncDirty, 0);
    const fields = JSON.parse(String(rawRow(fx.local, 'sessions', s.foreignClosed)?.syncFields));
    assert.deepEqual(Object.keys(fields), ['playthroughId']);
  });

  it('tras fusionar, el estado derivado del juego es coherente', () => {
    const s = scenario();
    const totalBefore = getGameById(fx.ctx, s.gameId)!.totalHours;
    const spendBefore = getGameById(fx.ctx, s.gameId)!.totalSpend;
    assert.equal(findConcurrentActivePlaythroughs(fx.ctx, s.gameId).length, 2);

    mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId });

    const detail = getGameById(fx.ctx, s.gameId)!;
    assert.deepEqual(
      detail.iterations.map((entry) => entry.id),
      [s.keepId],
    );
    // Mismas horas y mismo gasto que antes: nada se pierde ni se cuenta dos veces.
    assert.equal(detail.totalHours, totalBefore);
    assert.equal(detail.totalSpend, spendBefore);
    assert.equal(detail.iterations[0].sessions.length, 4);
    assert.equal(detail.iterations[0].spend, 12);
    assert.equal(detail.currentState, 'started');
    assert.equal(detail.iterations[0].currentState, 'started');
    assert.equal(detail.stateHistory.length, 2);
    assert.equal(detail.isLive, true, 'la sesión abierta del otro PC sigue en marcha');
    assert.deepEqual(findConcurrentActivePlaythroughs(fx.ctx, s.gameId), []);
    // La biblioteca ve el mismo total y un solo playthrough con horas manuales.
    const listed = getGames(fx.ctx).find((game) => game.id === s.gameId)!;
    assert.equal(listed.totalHours, totalBefore);
    assert.deepEqual(
      listed.manualIterations.map((entry) => entry.iterationId),
      [s.keepId],
    );
    // Y la próxima sesión cae en el único playthrough, sin escribir nada más.
    assert.deepEqual(resolvePlaythroughForSession(fx.ctx, s.gameId, fx.ctx.now()), {
      playthroughId: s.keepId,
      kind: 'use',
    });
  });

  it('el estado final lo decide el último evento de los dos, no quién se queda', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const keepId = seedPlaythrough(fx.ctx, { gameId });
    const dropId = seedPlaythrough(fx.ctx, { gameId });
    startedAt(keepId, hours(1));
    startedAt(dropId, hours(2));
    seedStateEvent(fx.ctx, { playthroughId: dropId, type: 'completed', occurredAt: at(hours(3)) });
    mergePlaythroughs(fx.ctx, { keepId, dropId });
    assert.equal(getGameById(fx.ctx, gameId)?.currentState, 'completed');
  });

  it('con el id al revés del reloj también funciona, quedándose con el vigente', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const { older, newer } = invertedPair(gameId);
    startedAt(older, hours(1));
    startedAt(newer, hours(2));
    const [first, second] = findConcurrentActivePlaythroughs(fx.ctx, gameId);
    assert.ok(second.current);
    mergePlaythroughs(fx.ctx, { keepId: second.id, dropId: first.id });
    assert.deepEqual(
      getGameById(fx.ctx, gameId)?.iterations.map((entry) => [entry.id, entry.label]),
      // El borrado sigue contando en la numeración (R-03).
      [[newer, 'Playthrough 2']],
    );
  });

  it('las hijas que ya estaban borradas se quedan con el sobrante', () => {
    const s = scenario();
    const dead = seedStateEvent(fx.ctx, {
      playthroughId: s.dropId,
      type: 'on_hold',
      occurredAt: at(hours(2.5)),
    });
    fx.ctx.store.remove('state_events', dead);
    const result = mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId });
    assert.equal(result.moved.stateEvents, 1);
    assert.equal(playthroughOf('state_events', dead), s.dropId);
  });

  it('un sobrante sin nada colgando ni horas manuales se borra sin más', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const keepId = seedPlaythrough(fx.ctx, { gameId });
    const dropId = seedPlaythrough(fx.ctx, { gameId });
    const result = mergePlaythroughs(fx.ctx, { keepId, dropId });
    assert.deepEqual(result.moved, {
      sessions: 0,
      stateEvents: 0,
      spendEvents: 0,
      achievementUnlocks: 0,
    });
    assert.equal(result.manualHoursAdded, 0);
    assert.equal(rawRow(fx.local, 'playthroughs', keepId)?.manualHours, null);
    assert.notEqual(rawRow(fx.local, 'playthroughs', dropId)?.syncDeleted, null);
  });

  describe('errores: no se escribe nada', () => {
    const snapshot = (): Record<string, unknown[]> => ({
      playthroughs: fx.local.db.select().from(playthroughs).all(),
      sessions: fx.local.db.select().from(sessions).all(),
      events: fx.local.db.select().from(stateEvents).all(),
      spend: fx.local.db.select().from(spendEvents).all(),
      unlocks: fx.local.db.select().from(achievementUnlocks).all(),
    });

    it('el mismo playthrough dos veces', () => {
      const s = scenario();
      const before = snapshot();
      assert.throws(
        () => mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.keepId }),
        (error) => isPlaythroughMergeError(error, 'same_playthrough'),
      );
      assert.deepEqual(snapshot(), before);
    });

    it('de juegos distintos', () => {
      const s = scenario();
      const otherGame = seedGame(fx.ctx, { title: 'Hades' });
      const stranger = seedPlaythrough(fx.ctx, { gameId: otherGame });
      const before = snapshot();
      assert.throws(
        () => mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: stranger }),
        (error) => error instanceof PlaythroughMergeError && error.code === 'different_game',
      );
      assert.deepEqual(snapshot(), before);
    });

    it('uno inexistente o borrado', () => {
      const s = scenario();
      const before = snapshot();
      assert.throws(
        () => mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: 'no-existe' }),
        (error) => isStoreError(error, 'not_found'),
      );
      assert.throws(
        () => mergePlaythroughs(fx.ctx, { keepId: 'no-existe', dropId: s.dropId }),
        (error) => isStoreError(error, 'not_found'),
      );
      assert.deepEqual(snapshot(), before);

      mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId });
      // Ya fusionado: el sobrante tiene lápida, repetirlo es un error.
      assert.throws(
        () => mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId }),
        (error) => isStoreError(error, 'deleted'),
      );
      assert.throws(
        () => mergePlaythroughs(fx.ctx, { keepId: s.dropId, dropId: s.keepId }),
        (error) => isStoreError(error, 'deleted'),
      );
    });

    it('con el juego borrado (F-11) tampoco', () => {
      const s = scenario();
      fx.ctx.store.remove('games', s.gameId);
      assert.throws(
        () => mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId }),
        (error) => isStoreError(error, 'deleted'),
      );
    });

    it('un fallo a mitad de la fusión lo deshace todo', () => {
      const s = scenario();
      const before = snapshot();
      // Una escritura de la puerta que falla en el último paso: el sobrante ya
      // tiene la lápida puesta, así que `remove` devuelve vacío y la
      // comprobación final lanza.
      const failing = {
        ...fx.ctx,
        store: Object.create(fx.ctx.store, {
          remove: { value: () => ({ removed: [], nullified: [] }) },
        }),
      };
      assert.throws(
        () => mergePlaythroughs(failing, { keepId: s.keepId, dropId: s.dropId }),
        /inesperadas/,
      );
      assert.deepEqual(snapshot(), before);
      assert.equal(count(fx.local, 'sessions', `playthroughId = '${s.keepId}'`), 1);
    });
  });

  it('el patch de una sesión ajena solo toca playthroughId (no depende de reglas extra)', () => {
    const s = scenario();
    // Sin ninguna `ForeignWriteRule` registrada (openQueryDb por defecto): la
    // fusión no necesita excepciones al dueño.
    assert.doesNotThrow(() => mergePlaythroughs(fx.ctx, { keepId: s.keepId, dropId: s.dropId }));
    assert.equal(
      fx.local.db.select().from(sessions).where(eq(sessions.id, s.foreignOpen)).get()?.endedAt,
      null,
    );
  });
});

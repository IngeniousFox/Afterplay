import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { LocalDatabase } from '../connection';
import { registry, syncedEntries } from '../registry';
import {
  SESSION_FIELDS_ANY_DEVICE,
  isStoreError,
  type CreateValues,
  type ForeignWriteRule,
} from '../store';
import { LOCAL, OTHER, T0, insertSynced, openTestDb, rawRow, seedBasics } from './helpers';

// Reglas locales que no pueden ser restricciones de la base: el dueño de las
// filas O (§7.1, §7.4) y una sesión abierta por dispositivo y objetivo (§7.7).

let local: LocalDatabase;
afterEach(() => local.close());

const OTHER_CLOCK = '1763020700000-0000-otherr';

const notOwner = (error: unknown): boolean => isStoreError(error, 'not_owner');
const openSession = (error: unknown): boolean => isStoreError(error, 'open_session');

/** Una sesión de otro PC llegada por sync. */
function foreignSession(id: string, playthroughId: string, open: boolean): void {
  insertSynced(
    local,
    'sessions',
    {
      id,
      playthroughId,
      deviceId: OTHER,
      startedBy: 'watcher',
      source: 'measured',
      startedAt: T0,
      endedAt: open ? null : T0 + 60_000,
      durationSec: open ? null : 60,
      datePrecision: 'datetime',
    },
    OTHER_CLOCK,
  );
}

const session = (
  playthroughId: string | null,
  extra: { emulatorId?: string; endedAt?: Date } = {},
): CreateValues<'sessions'> => ({
  playthroughId,
  deviceId: LOCAL,
  startedBy: 'watcher' as const,
  startedAt: new Date(T0),
  datePrecision: 'datetime' as const,
  ...extra,
});

describe('regla del dueño (clase O)', () => {
  it('no se crean filas O de otro dispositivo', () => {
    local = openTestDb();
    const { gameId, playthroughId } = seedBasics(local.store);
    assert.throws(() => local.store.create('game_installs', { gameId, deviceId: OTHER }), notOwner);
    assert.throws(
      () => local.store.create('sessions', { ...session(playthroughId), deviceId: OTHER }),
      notOwner,
    );
    assert.throws(
      () =>
        local.store.create('save_backups', {
          gameId,
          deviceId: OTHER,
          backupName: 'b',
          r2Key: 'k',
          ludusaviName: 'x',
          createdAt: new Date(T0),
        }),
      notOwner,
    );
  });

  it('en una sesión ajena se pueden cambiar la nota y el playthrough, nada más', () => {
    local = openTestDb();
    const { gameId, playthroughId } = seedBasics(local.store);
    const other = local.store.create('playthroughs', {
      gameId,
      playedPlatform: 'PC',
      origin: 'GOG',
    }).id;
    foreignSession('ajena', playthroughId, false);

    assert.deepEqual(
      local.store.patch('sessions', 'ajena', { note: 'jugada en el sofá' }).changed,
      ['note'],
    );
    assert.deepEqual(local.store.patch('sessions', 'ajena', { playthroughId: other }).changed, [
      'playthroughId',
    ]);
    for (const changes of [
      { endedAt: new Date(T0 + 1) },
      { durationSec: 1 },
      { closedBy: 'user' as const },
      { startedAt: new Date(T0 + 1) },
      { lastSeenAt: new Date(T0) },
      { note: 'otra', endedAt: new Date(T0 + 1) },
    ]) {
      assert.throws(
        () => local.store.patch('sessions', 'ajena', changes),
        notOwner,
        JSON.stringify(changes),
      );
    }
    // Lo rechazado no escribe nada, ni siquiera la parte permitida.
    assert.equal(rawRow(local, 'sessions', 'ajena')?.note, 'jugada en el sofá');
    // Un campo del dueño con el MISMO valor no es un cambio y no molesta.
    assert.deepEqual(
      local.store.patch('sessions', 'ajena', { note: 'x', endedAt: new Date(T0 + 60_000) }).changed,
      ['note'],
    );
  });

  it('la sesión ajena se borra directamente solo si está cerrada', () => {
    local = openTestDb();
    const { playthroughId } = seedBasics(local.store);
    foreignSession('ajena-cerrada', playthroughId, false);
    foreignSession('ajena-abierta', playthroughId, true);
    assert.equal(local.store.remove('sessions', 'ajena-cerrada').removed.length, 1);
    assert.throws(() => local.store.remove('sessions', 'ajena-abierta'), notOwner);
    assert.equal(rawRow(local, 'sessions', 'ajena-abierta')?.syncDeleted, null);
  });

  it('las instalaciones ajenas no se tocan directamente, pero sí en la cascada', () => {
    local = openTestDb();
    const { gameId } = seedBasics(local.store);
    const id = `${gameId}:${OTHER}`;
    insertSynced(local, 'game_installs', { id, gameId, deviceId: OTHER }, OTHER_CLOCK);
    assert.throws(
      () => local.store.patch('game_installs', id, { executablePath: 'C:\\x.exe' }),
      notOwner,
    );
    assert.throws(() => local.store.remove('game_installs', id), notOwner);
    local.store.remove('games', gameId);
    assert.notEqual(rawRow(local, 'game_installs', id)?.syncDeleted, null);
  });

  it('las filas propias se escriben sin restricción', () => {
    local = openTestDb();
    const { gameId, playthroughId } = seedBasics(local.store);
    const id = local.store.create('game_installs', { gameId, deviceId: LOCAL }).id;
    local.store.patch('game_installs', id, { executablePath: 'C:\\Celeste.exe' });
    const own = local.store.create('sessions', session(playthroughId)).id;
    local.store.patch('sessions', own, { endedAt: new Date(T0 + 1000), closedBy: 'owner' });
    local.store.remove('game_installs', id);
  });

  it('el punto de extensión de la fase 4 puede admitir más escrituras ajenas', () => {
    // Por ejemplo, parar un cronómetro (sesión `timer` del dispositivo web).
    const timers: ForeignWriteRule = (write) =>
      write.kind === 'patch' && write.table === 'sessions' && write.row.startedBy === 'timer';
    local = openTestDb({ foreignWriteRules: [timers] });
    const { playthroughId } = seedBasics(local.store);
    insertSynced(
      local,
      'sessions',
      {
        id: 'timer',
        playthroughId,
        deviceId: OTHER,
        startedBy: 'timer',
        source: 'measured',
        startedAt: T0,
        datePrecision: 'datetime',
      },
      OTHER_CLOCK,
    );
    foreignSession('watcher-ajena', playthroughId, true);
    assert.deepEqual(
      local.store.patch('sessions', 'timer', { endedAt: new Date(T0 + 5000) }).changed,
      ['endedAt'],
    );
    assert.throws(
      () => local.store.patch('sessions', 'watcher-ajena', { endedAt: new Date(T0) }),
      notOwner,
    );
  });

  it('ninguna referencia `nullify` del registro apunta a un campo del dueño', () => {
    // La regla del dueño también vale para las anulaciones: si una apuntase
    // a una columna de una tabla O que otros no pueden escribir, borrar el
    // padre fallaría al llegar a una fila ajena.
    for (const parent of syncedEntries) {
      for (const ref of parent.references) {
        if (ref.onParentDelete !== 'nullify') continue;
        const target = registry[ref.table as keyof typeof registry];
        if (target.dataClass !== 'O') continue;
        assert.ok(
          ref.table === 'sessions' && SESSION_FIELDS_ANY_DEVICE.includes(ref.column),
          `${parent.name} anula ${ref.table}.${ref.column}, un campo del dueño`,
        );
      }
    }
  });
});

describe('una sesión abierta por dispositivo y objetivo (§7.7)', () => {
  it('no se abre una segunda sesión propia del mismo juego, aunque sea de otro playthrough', () => {
    local = openTestDb();
    const { gameId, playthroughId } = seedBasics(local.store);
    const second = local.store.create('playthroughs', {
      gameId,
      playedPlatform: 'PC',
      origin: 'x',
    }).id;
    local.store.create('sessions', session(playthroughId));
    assert.throws(() => local.store.create('sessions', session(playthroughId)), openSession);
    assert.throws(() => local.store.create('sessions', session(second)), openSession);
    // Cerrada sí (una sesión ya terminada que se registra a mano o al recuperar).
    local.store.create('sessions', session(second, { endedAt: new Date(T0 + 1000) }));
  });

  it('otro juego, una sesión ajena abierta o una propia con lápida no lo impiden', () => {
    local = openTestDb();
    const { playthroughId } = seedBasics(local.store);
    const otherGame = local.store.create('games', { title: 'Hades', addedAt: new Date(T0) }).id;
    const otherPt = local.store.create('playthroughs', {
      gameId: otherGame,
      playedPlatform: 'PC',
      origin: 'x',
    }).id;

    foreignSession('ajena-abierta', playthroughId, true);
    const mine = local.store.create('sessions', session(playthroughId)).id;
    local.store.create('sessions', session(otherPt));
    local.store.remove('sessions', mine);
    local.store.create('sessions', session(playthroughId));
  });

  it('el objetivo de una sesión de emulador sin asignar es su emulador', () => {
    local = openTestDb();
    const { playthroughId } = seedBasics(local.store);
    const emulatorId = local.store.create('emulators', { name: 'Dolphin' }).id;
    local.store.create('sessions', session(null, { emulatorId }));
    assert.throws(() => local.store.create('sessions', session(null, { emulatorId })), openSession);
    // Asignada a un juego, su objetivo es el juego.
    local.store.create('sessions', session(playthroughId, { emulatorId }));
  });

  it('tampoco se reabre ni se reasigna una sesión si choca con otra abierta', () => {
    local = openTestDb();
    const { playthroughId } = seedBasics(local.store);
    const emulatorId = local.store.create('emulators', { name: 'Dolphin' }).id;
    const closed = local.store.create(
      'sessions',
      session(playthroughId, { endedAt: new Date(T0 + 10) }),
    ).id;
    const unassigned = local.store.create('sessions', session(null, { emulatorId })).id;
    local.store.create('sessions', session(playthroughId));

    assert.throws(() => local.store.patch('sessions', closed, { endedAt: null }), openSession);
    assert.throws(() => local.store.patch('sessions', unassigned, { playthroughId }), openSession);
    // Otros cambios en una sesión abierta no disparan la regla.
    local.store.patch('sessions', unassigned, { note: 'x', lastSeenAt: new Date(T0) });
  });
});

// Revisión, hallazgo 5 (los dos primeros venían de __review__/store.review.test.ts).
describe('un hijo del registro no queda vivo bajo un padre con lápida', () => {
  const parentDeleted = (error: unknown): boolean => isStoreError(error, 'parent_deleted');

  it('no se crea un evento de estado en un playthrough borrado', () => {
    local = openTestDb();
    const { playthroughId } = seedBasics(local.store);
    local.store.remove('playthroughs', playthroughId);
    assert.throws(
      () =>
        local.store.create('state_events', {
          playthroughId,
          type: 'started',
          occurredAt: new Date(T0),
          datePrecision: 'day',
        }),
      parentDeleted,
      'un hijo vivo de un padre borrado queda invisible (F-11) pero se sube y ocupa',
    );
  });

  it('no se mueve una sesión a un playthrough borrado', () => {
    local = openTestDb();
    const { gameId, playthroughId } = seedBasics(local.store);
    const { id: doomed } = local.store.create('playthroughs', {
      gameId,
      playedPlatform: 'PC',
      origin: 'Steam',
    });
    local.store.remove('playthroughs', doomed);
    const { id: sessionId } = local.store.create(
      'sessions',
      session(playthroughId, { endedAt: new Date(T0 + 3_600_000) }),
    );
    // Tiempo jugado que desaparecería de todas las lecturas sin que nadie lo borre.
    assert.throws(
      () => local.store.patch('sessions', sessionId, { playthroughId: doomed }),
      parentDeleted,
    );
    assert.equal(rawRow(local, 'sessions', sessionId)?.playthroughId, playthroughId);
  });

  it('tampoco se resucita un hijo cuyo padre sigue borrado', () => {
    local = openTestDb();
    const { gameId } = seedBasics(local.store);
    local.store.create('plan_entries', { gameId, plannedAt: new Date(T0) });
    local.store.remove('games', gameId);
    assert.throws(
      () => local.store.create('plan_entries', { gameId, plannedAt: new Date(T0) }),
      parentDeleted,
    );
    // Con el juego resucitado, sí.
    local.store.create('games', { title: 'Celeste', igdbId: 26226, addedAt: new Date(T0) });
    assert.equal(
      local.store.create('plan_entries', { gameId, plannedAt: new Date(T0) }).outcome,
      'resurrected',
    );
  });

  it('una sesión de emulador ya asignada a un juego no es hija del emulador', () => {
    local = openTestDb();
    const { playthroughId } = seedBasics(local.store);
    const emulatorId = local.store.create('emulators', { name: 'Dolphin' }).id;
    const closed = { endedAt: new Date(T0 + 1000) };
    const assigned = local.store.create(
      'sessions',
      session(playthroughId, { emulatorId, ...closed }),
    );
    const unassigned = local.store.create('sessions', session(null, { emulatorId, ...closed }));
    local.store.remove('emulators', emulatorId);
    // La asignada sobrevive a la cascada y se puede seguir editando…
    assert.equal(rawRow(local, 'sessions', assigned.id)?.syncDeleted, null);
    local.store.patch('sessions', assigned.id, { note: 'sigue siendo tiempo jugado' });
    // …pero no se puede desasignar: volvería a ser hija del emulador borrado.
    assert.throws(
      () => local.store.patch('sessions', assigned.id, { playthroughId: null }),
      parentDeleted,
    );
    // Una sesión nueva sin asignar en el emulador borrado tampoco.
    assert.throws(
      () => local.store.create('sessions', session(null, { emulatorId })),
      parentDeleted,
    );
    assert.notEqual(rawRow(local, 'sessions', unassigned.id)?.syncDeleted, null);
  });

  it('un hijo huérfano llegado por sync se puede seguir editando en lo que no lo engancha', () => {
    local = openTestDb();
    const { playthroughId } = seedBasics(local.store);
    local.store.remove('playthroughs', playthroughId);
    // Un evento que otro PC creó antes de ver el borrado (F-11).
    insertSynced(local, 'state_events', {
      id: '0194c2f0-cccc-7000-8000-00000000000c',
      playthroughId,
      type: 'started',
      occurredAt: T0,
      datePrecision: 'day',
    });
    local.store.patch('state_events', '0194c2f0-cccc-7000-8000-00000000000c', { note: 'x' });
    // Y la cascada de `remove` sigue pudiendo marcarlo (pone lápidas, no crea hijos).
    local.store.remove('state_events', '0194c2f0-cccc-7000-8000-00000000000c');
  });
});

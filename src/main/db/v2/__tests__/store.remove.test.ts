import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseSyncFields } from '../../../../shared/sync/fieldClocks';
import type { LocalDatabase } from '../connection';
import { eq } from 'drizzle-orm';
import { playthroughs } from '../schema';
import { alive, isStoreError, whereAlive } from '../store';
import {
  LOCAL,
  OTHER,
  T0,
  insertSynced,
  markClean,
  openTestDb,
  rawRow,
  seedBasics,
} from './helpers';

// `remove` (§7.7): lápida a la fila y a sus hijos del registro, recursiva, en
// una transacción y con un solo reloj; `nullify` de las referencias que lo
// piden; idempotente.

let local: LocalDatabase;
beforeEach(() => {
  local = openTestDb();
});
afterEach(() => local.close());

const OTHER_CLOCK = '1763020700000-0000-otherr';

/** Un juego con todo lo que cuelga de él, incluidas filas de otro PC. */
type TreeKey =
  | 'gameId'
  | 'p1'
  | 'p2'
  | 'event'
  | 'ownSession'
  | 'p2Session'
  | 'plan'
  | 'spend'
  | 'install'
  | 'unlock'
  | 'metadata'
  | 'check'
  | 'backup';

function seedTree(): Record<TreeKey, string> {
  const { gameId, playthroughId: p1 } = seedBasics(local.store);
  const s = local.store;
  const p2 = s.create('playthroughs', { gameId, playedPlatform: 'Switch', origin: 'eShop' }).id;
  const event = s.create('state_events', {
    playthroughId: p1,
    type: 'started',
    occurredAt: new Date(T0),
    datePrecision: 'day',
  }).id;
  const ownSession = s.create('sessions', {
    playthroughId: p1,
    deviceId: LOCAL,
    startedBy: 'watcher',
    startedAt: new Date(T0),
    endedAt: new Date(T0 + 3_600_000),
    durationSec: 3600,
    datePrecision: 'datetime',
  }).id;
  const p2Session = s.create('sessions', {
    playthroughId: p2,
    deviceId: LOCAL,
    startedBy: 'play',
    startedAt: new Date(T0 + 7_200_000),
    endedAt: new Date(T0 + 7_300_000),
    datePrecision: 'datetime',
  }).id;
  // Sesión ABIERTA de otro PC, llegada por sync.
  insertSynced(
    local,
    'sessions',
    {
      id: 'sesion-ajena-abierta',
      playthroughId: p1,
      deviceId: OTHER,
      startedBy: 'watcher',
      source: 'measured',
      startedAt: T0,
      datePrecision: 'datetime',
    },
    OTHER_CLOCK,
  );
  const plan = s.create('plan_entries', { gameId, plannedAt: new Date(T0) }).id;
  const spend = s.create('spend_events', {
    gameId,
    playthroughId: p1,
    type: 'purchase',
    amount: 19.99,
    currency: 'EUR',
    occurredAt: new Date(T0),
    datePrecision: 'day',
  }).id;
  const install = s.create('game_installs', { gameId, deviceId: LOCAL }).id;
  insertSynced(
    local,
    'game_installs',
    { id: `${gameId}:${OTHER}`, gameId, deviceId: OTHER, executablePath: 'D:\\x.exe' },
    OTHER_CLOCK,
  );
  const unlock = s.create('achievement_unlocks', {
    gameId,
    source: 'steam',
    apiName: 'ACH_1',
    origin: 'steam',
    unlockedAt: new Date(T0),
    playthroughId: p1,
    sessionId: ownSession,
  }).id;
  // Referencias `keep`: la caché y el índice de partidas se quedan.
  const metadata = s.create('game_metadata', { gameId, summary: 'x' }).id;
  const check = s.create('external_checks', {
    gameId,
    source: 'igdb',
    status: 'ok',
    checkedAt: new Date(T0),
  }).id;
  const backup = s.create('save_backups', {
    gameId,
    deviceId: LOCAL,
    backupName: 'b1',
    r2Key: 'saves/celeste/b1.zip',
    ludusaviName: 'Celeste',
    createdAt: new Date(T0),
  }).id;
  return {
    gameId,
    p1,
    p2,
    event,
    ownSession,
    p2Session,
    plan,
    spend,
    install,
    unlock,
    metadata,
    check,
    backup,
  };
}

const deletedOf = (table: string, id: string): string | null => {
  const value = rawRow(local, table, id)?.syncDeleted;
  return value === null || value === undefined ? null : String(value);
};

describe('remove: cascada', () => {
  it('borrar un juego alcanza todo su árbol, filas de otros PCs incluidas', () => {
    const t = seedTree();
    markClean(local, 'games');
    const result = local.store.remove('games', t.gameId);

    const expected = [
      ['games', t.gameId],
      ['playthroughs', t.p1],
      ['state_events', t.event],
      ['sessions', t.ownSession],
      ['sessions', 'sesion-ajena-abierta'],
      ['playthroughs', t.p2],
      ['sessions', t.p2Session],
      ['plan_entries', t.plan],
      ['spend_events', t.spend],
      ['game_installs', t.install],
      ['game_installs', `${t.gameId}:${OTHER}`],
      ['achievement_unlocks', t.unlock],
    ];
    assert.deepEqual(
      result.removed.map((ref) => `${ref.table}/${ref.id}`).sort(),
      expected.map(([table, id]) => `${table}/${id}`).sort(),
    );
    // Los hijos que reciben lápida no se "anulan" además.
    assert.deepEqual(result.nullified, []);

    const clock = deletedOf('games', t.gameId);
    assert.ok(clock);
    for (const [table, id] of expected) {
      const row = rawRow(local, table, id);
      assert.equal(row?.syncDeleted, clock, `${table}/${id}: un solo reloj`);
      assert.equal(row?.syncUpdated, clock, `${table}/${id}: syncUpdated`);
      assert.equal(row?.syncDirty, 1, `${table}/${id}: pendiente de subir`);
      assert.equal(parseSyncFields(String(row?.syncFields)).syncDeleted, clock);
    }
    // La sesión ajena conserva sus campos: solo cambia la lápida.
    assert.equal(rawRow(local, 'sessions', 'sesion-ajena-abierta')?.endedAt, null);

    for (const [table, id] of [
      ['game_metadata', t.metadata],
      ['external_checks', t.check],
      ['save_backups', t.backup],
    ]) {
      assert.equal(deletedOf(table, id), null, `${table} se conserva (keep)`);
    }
  });

  it('borrar un playthrough anula sus referencias vivas, una sola escritura por fila', () => {
    const t = seedTree();
    const result = local.store.remove('playthroughs', t.p1);
    assert.deepEqual(
      result.removed.map((ref) => ref.id).sort(),
      [t.p1, t.event, t.ownSession, 'sesion-ajena-abierta'].sort(),
    );
    const byId = new Map(result.nullified.map((ref) => [ref.id, ref]));
    assert.deepEqual([...(byId.get(t.spend)?.columns ?? [])], ['playthroughId']);
    // El desbloqueo apunta al playthrough y a su sesión: un solo parche.
    assert.deepEqual([...(byId.get(t.unlock)?.columns ?? [])].sort(), [
      'playthroughId',
      'sessionId',
    ]);

    const clock = deletedOf('playthroughs', t.p1);
    const spend = rawRow(local, 'spend_events', t.spend);
    assert.equal(spend?.playthroughId, null);
    assert.equal(spend?.syncDeleted, null, 'el gasto sigue vivo');
    assert.equal(parseSyncFields(String(spend?.syncFields)).playthroughId, clock);
    const unlock = rawRow(local, 'achievement_unlocks', t.unlock);
    assert.equal(unlock?.playthroughId, null);
    assert.equal(unlock?.sessionId, null);
    assert.equal(unlock?.syncDeleted, null);
    // El otro playthrough y su sesión no se tocan.
    assert.equal(deletedOf('playthroughs', t.p2), null);
    assert.equal(deletedOf('sessions', t.p2Session), null);
  });

  it('borrar un emulador borra sus instalaciones y sus sesiones sin asignar, no las asignadas', () => {
    const { playthroughId } = seedBasics(local.store);
    const emulatorId = local.store.create('emulators', { name: 'Dolphin' }).id;
    const install = local.store.create('emulator_installs', {
      emulatorId,
      deviceId: LOCAL,
      executablePath: 'C:\\Dolphin.exe',
    }).id;
    const unassigned = local.store.create('sessions', {
      emulatorId,
      deviceId: LOCAL,
      startedBy: 'watcher',
      startedAt: new Date(T0),
      endedAt: new Date(T0 + 1000),
      datePrecision: 'datetime',
    }).id;
    const assigned = local.store.create('sessions', {
      emulatorId,
      playthroughId,
      deviceId: LOCAL,
      startedBy: 'watcher',
      startedAt: new Date(T0 + 5000),
      endedAt: new Date(T0 + 6000),
      datePrecision: 'datetime',
    }).id;
    const result = local.store.remove('emulators', emulatorId);
    assert.deepEqual(
      result.removed.map((ref) => ref.id).sort(),
      [emulatorId, install, unassigned].sort(),
    );
    assert.equal(deletedOf('sessions', assigned), null);
    assert.equal(rawRow(local, 'sessions', assigned)?.emulatorId, emulatorId, 'keep: no se anula');
  });

  it('un hijo que ya tenía lápida no se vuelve a marcar', () => {
    const t = seedTree();
    local.store.remove('state_events', t.event);
    const eventTombstone = deletedOf('state_events', t.event);
    const result = local.store.remove('games', t.gameId);
    assert.ok(!result.removed.some((ref) => ref.id === t.event));
    assert.equal(deletedOf('state_events', t.event), eventTombstone);
    assert.ok(String(deletedOf('games', t.gameId)) > String(eventTombstone));
  });
});

describe('remove: idempotencia y errores', () => {
  it('borrar dos veces no escribe nada la segunda', () => {
    const t = seedTree();
    local.store.remove('games', t.gameId);
    markClean(local, 'games');
    markClean(local, 'playthroughs');
    const before = rawRow(local, 'games', t.gameId);
    const pBefore = rawRow(local, 'playthroughs', t.p1);
    const clock = local.clock.peek();
    assert.deepEqual(local.store.remove('games', t.gameId), { removed: [], nullified: [] });
    assert.deepEqual(rawRow(local, 'games', t.gameId), before);
    assert.deepEqual(rawRow(local, 'playthroughs', t.p1), pBefore);
    assert.equal(local.clock.peek(), clock);
  });

  it('los dispositivos no se borran y una fila inexistente es un error', () => {
    seedBasics(local.store);
    assert.throws(
      () => local.store.remove('devices', LOCAL),
      (e) => isStoreError(e, 'not_deletable'),
    );
    assert.throws(
      () => local.store.remove('games', 'no-existe'),
      (e) => isStoreError(e, 'not_found'),
    );
  });

  it('la lápida gana a un reloj de la fila por delante del nuestro', () => {
    const future = `${T0 + 86_400_000}-0000-zzzzzz`;
    insertSynced(local, 'emulators', { id: 'emu-futuro', name: 'x' }, future);
    local.store.remove('emulators', 'emu-futuro');
    assert.ok(String(deletedOf('emulators', 'emu-futuro')) > future);
  });
});

describe('lecturas: solo filas vivas', () => {
  it('alive y whereAlive dejan fuera las filas con lápida', () => {
    const t = seedTree();
    local.store.remove('playthroughs', t.p1);
    const ids = local.db
      .select({ id: playthroughs.id })
      .from(playthroughs)
      .where(alive(playthroughs))
      .all()
      .map((row) => row.id);
    assert.deepEqual(ids, [t.p2]);
    const ofGame = local.db
      .select({ id: playthroughs.id })
      .from(playthroughs)
      .where(whereAlive(playthroughs, eq(playthroughs.gameId, t.gameId)))
      .all();
    assert.deepEqual(ofGame, [{ id: t.p2 }]);
  });
});

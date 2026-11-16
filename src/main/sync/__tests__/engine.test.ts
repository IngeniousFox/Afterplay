import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MAX_AHEAD_MS, formatClock, parseClock } from '../../../shared/sync/clock';
import { SyncRequestError, type SyncTransport } from '../../../shared/sync/protocol';
import { OTHER, T0, rawRow } from '../../db/v2/__tests__/helpers';
import {
  LOCAL,
  openQueryDb,
  seedGame,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import { createSyncEngine, type SyncChange, type SyncEngine } from '../engine';
import { applyEnrollment, readSyncState } from '../state';
import { FakeHub } from './fakeHub';

// El motor del cliente (§8.5) contra un hub falso en memoria. Todo con datos
// inventados y una base 2.0 de verdad en memoria por cada "PC".

interface Pc {
  fx: QueryFixture;
  engine: SyncEngine;
  changes: SyncChange[];
}

const open: QueryFixture[] = [];

afterEach(() => {
  for (const fx of open.splice(0)) fx.close();
});

function pc(
  hub: SyncTransport,
  options: { deviceId?: string; schemaVersion?: number; start?: number } = {},
): Pc {
  const fx = openQueryDb({ deviceId: options.deviceId ?? LOCAL, start: options.start });
  open.push(fx);
  const changes: SyncChange[] = [];
  const engine = createSyncEngine({
    local: fx.local,
    transport: hub,
    now: fx.wall.wall,
    onChange: (change) => changes.push(change),
    schemaVersion: options.schemaVersion,
  });
  return { fx, engine, changes };
}

const newHub = (): FakeHub => new FakeHub(T0);

/** El hub con alguna operación cambiada. Delega en `hub` (no hereda su estado: `Object.create` escribiría `seq` en el envoltorio). */
const wrapHub = (hub: FakeHub, overrides: Partial<SyncTransport>): SyncTransport => ({
  status: () => hub.status(),
  push: (request) => hub.push(request),
  pull: (since, limit) => hub.pull(since, limit),
  claimJob: () => hub.claimJob(),
  doneJob: () => hub.doneJob(),
  ...overrides,
});

const dirty = (p: Pc, table: string): number =>
  Number(
    p.fx.local.db.$client
      .prepare(`SELECT count(*) AS n FROM "${table}" WHERE "syncDirty" = 1`)
      .get()?.n,
  );

const row = (p: Pc, table: string, id: string): Record<string, unknown> | undefined =>
  rawRow(p.fx.local, table, id);

const totalDirty = (p: Pc): number =>
  ['devices', 'games'].reduce((sum, table) => sum + dirty(p, table), 0);

describe('subida', () => {
  it('sube las filas pendientes y les quita la marca', async () => {
    const hub = newHub();
    const a = pc(hub);
    const g1 = seedGame(a.fx.ctx, { title: 'Uno' });
    const g2 = seedGame(a.fx.ctx, { title: 'Dos' });
    assert.equal(dirty(a, 'games'), 2);

    const result = await a.engine.runCycle();

    assert.equal(result.status, 'ok');
    assert.equal(result.pushed, 3, 'dos juegos y la fila de este dispositivo');
    assert.equal(dirty(a, 'games'), 0);
    assert.equal(dirty(a, 'devices'), 0);
    assert.equal(hub.count('games'), 2);
    assert.equal(hub.get('games', g1)?.fields.title, 'Uno');
    assert.equal(hub.get('games', g2)?.fields.title, 'Dos');
    const state = readSyncState(a.fx.local.db);
    assert.equal(state.lastPushAt, T0);
    assert.equal(state.lastPullAt, T0);
    assert.equal(state.hubId, 'hub-1');
    assert.equal(state.lastError, null);
    assert.equal(state.protocolVersion, 1);
  });

  it('una fila que cambia durante la subida sigue pendiente', async () => {
    const hub = newHub();
    const a = pc(hub);
    const id = seedGame(a.fx.ctx, { title: 'Uno' });
    hub.beforePushReply = () => {
      a.fx.wall.advance(1000);
      a.fx.ctx.store.patch('games', id, { notes: 'editado a mitad' });
    };

    await a.engine.runCycle();

    assert.equal(row(a, 'games', id)?.syncDirty, 1, 'la edición aún no ha subido');
    assert.equal(hub.get('games', id)?.fields.notes, null);
    assert.equal(row(a, 'games', id)?.notes, 'editado a mitad', 'el eco no pisa lo local');

    await a.engine.runCycle();

    assert.equal(row(a, 'games', id)?.syncDirty, 0);
    assert.equal(hub.get('games', id)?.fields.notes, 'editado a mitad');
  });

  it('respeta pushMaxRows', async () => {
    const hub = newHub();
    hub.limits = { ...hub.limits, pushMaxRows: 3 };
    const a = pc(hub);
    for (let i = 0; i < 8; i++) seedGame(a.fx.ctx, { title: `Juego ${i}` });
    const total = totalDirty(a);

    const result = await a.engine.runCycle();

    const pushes = hub.calls.filter((c) => c.kind === 'push');
    assert.ok(pushes.every((c) => c.rows <= 3));
    assert.equal(
      pushes.reduce((s, c) => s + c.rows, 0),
      total,
    );
    assert.equal(pushes.length, Math.ceil(total / 3));
    assert.equal(result.pushed, total);
    assert.equal(totalDirty(a), 0);
  });

  it('respeta pushMaxBytes', async () => {
    const hub = newHub();
    const a = pc(hub);
    for (let i = 0; i < 6; i++) seedGame(a.fx.ctx, { title: `Juego ${i}` });
    const total = totalDirty(a);
    // Medir el cuerpo de un push de todo con los límites por defecto.
    await a.engine.runCycle();
    const whole = hub.calls.find((c) => c.kind === 'push')!.bytes;

    const b = pc(hub, { deviceId: OTHER });
    for (let i = 0; i < 6; i++) seedGame(b.fx.ctx, { title: `Otro ${i}` });
    hub.calls.length = 0;
    hub.limits = { ...hub.limits, pushMaxBytes: Math.floor(whole / 2) };
    await b.engine.runCycle();

    const pushes = hub.calls.filter((c) => c.kind === 'push');
    assert.ok(pushes.length >= 2, 'no cabe en un solo lote');
    assert.ok(
      pushes.every((c) => c.bytes <= whole / 2),
      'ningún cuerpo pasa del tope',
    );
    assert.equal(totalDirty(b), 0);
    assert.ok(total > 0);
  });

  it('una fila que no cabe en un lote pero sí en pushMaxRowBytes sube sola', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Pequeño' });
    seedGame(a.fx.ctx, { title: `Grande ${'x'.repeat(4000)}` });
    seedGame(a.fx.ctx, { title: 'Otro pequeño' });
    const total = totalDirty(a);
    hub.limits = { ...hub.limits, pushMaxBytes: 3000, pushMaxRowBytes: 64 * 1024 };

    const result = await a.engine.runCycle();

    assert.equal(result.status, 'ok');
    assert.equal(result.oversized, 0);
    assert.equal(result.pushed, total);
    assert.equal(totalDirty(a), 0);
    const pushes = hub.calls.filter((c) => c.kind === 'push');
    const big = pushes.filter((c) => c.bytes > 3000);
    assert.equal(big.length, 1, 'un solo lote grande');
    assert.equal(big[0].rows, 1, 'con la fila grande sola');
    assert.ok(big[0].bytes <= 64 * 1024);
  });

  it('un hub que no anuncia pushMaxRowBytes no recibe filas por encima de pushMaxBytes', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: `Grande ${'x'.repeat(4000)}` });
    hub.limits = { ...hub.limits, pushMaxBytes: 3000 };
    delete hub.limits.pushMaxRowBytes;

    const result = await a.engine.runCycle();

    assert.equal(result.status, 'ok');
    assert.ok(result.oversized >= 1);
    assert.ok(hub.calls.filter((c) => c.kind === 'push').every((c) => c.bytes <= 3000));
  });

  it('una fila que no cabe en ningún lote no atasca el ciclo', async () => {
    const hub = newHub();
    hub.limits = { ...hub.limits, pushMaxBytes: 100, pushMaxRowBytes: 100 };
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Grande' });
    const total = totalDirty(a);

    const result = await a.engine.runCycle();

    assert.equal(result.status, 'ok');
    assert.equal(result.oversized, total);
    assert.equal(result.pushed, 0);
    assert.equal(hub.calls.filter((c) => c.kind === 'push').length, 0);
    assert.equal(totalDirty(a), total, 'siguen pendientes');
  });

  it('un rechazo de una fila deja esa fila pendiente y sube las demás', async () => {
    const hub = newHub();
    const a = pc(hub);
    const id = seedGame(a.fx.ctx, { title: 'Uno' });
    const rejecting = wrapHub(hub, {
      push: async (request) => {
        const reply = await hub.push({
          ...request,
          rows: request.rows.filter((r) => r.table !== 'games'),
        });
        return { ...reply, rejected: [{ table: 'games', id, reason: 'invalid_row' }] };
      },
    });
    const b = pc(rejecting, { deviceId: OTHER });
    const bid = seedGame(b.fx.ctx, { title: 'Otro' });

    const result = await b.engine.runCycle();

    assert.deepEqual(result.rejected, [{ table: 'games', id, reason: 'invalid_row' }]);
    assert.equal(row(b, 'games', bid)?.syncDirty, 1);
    assert.equal(dirty(b, 'devices'), 0);
  });
});

describe('bajada', () => {
  it('fusiona por columna y guarda el cursor', async () => {
    const hub = newHub();
    const a = pc(hub);
    const b = pc(hub, { deviceId: OTHER });
    const id = seedGame(a.fx.ctx, { title: 'Compartido' });
    await a.engine.runCycle();
    await b.engine.runCycle();
    assert.equal(row(b, 'games', id)?.title, 'Compartido');

    // Cada PC edita una columna distinta de la misma fila, sin verse.
    a.fx.wall.advance(1000);
    a.fx.ctx.store.patch('games', id, { notes: 'notas de A' });
    b.fx.wall.advance(2000);
    b.fx.ctx.store.patch('games', id, { coverOverride: 'portada de B' });
    await a.engine.runCycle();
    await b.engine.runCycle();
    await a.engine.runCycle();

    for (const p of [a, b]) {
      assert.equal(row(p, 'games', id)?.notes, 'notas de A');
      assert.equal(row(p, 'games', id)?.coverOverride, 'portada de B');
      assert.equal(row(p, 'games', id)?.syncDirty, 0);
    }
    assert.equal(readSyncState(b.fx.local.db).pullCursor, hub.seq);
    assert.equal(readSyncState(a.fx.local.db).pullCursor, hub.seq);
  });

  it('aplica cada página en una transacción: un fallo no deja nada ni mueve el cursor', async () => {
    const hub = newHub();
    const a = pc(hub);
    for (const title of ['uno', 'dos', 'boom', 'tres']) seedGame(a.fx.ctx, { title });
    await a.engine.runCycle();

    const b = pc(hub, { deviceId: OTHER });
    b.fx.local.db.$client.exec(
      `CREATE TRIGGER boom BEFORE INSERT ON games WHEN NEW.title = 'boom' ` +
        `BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    const failed = await b.engine.runCycle();

    assert.equal(failed.status, 'error');
    assert.equal(failed.retry, true);
    assert.match(failed.error?.message ?? '', /boom/);
    assert.equal(
      Number(b.fx.local.db.$client.prepare('SELECT count(*) AS n FROM games').get()?.n),
      0,
      'ni siquiera las filas anteriores a la que falló',
    );
    assert.equal(readSyncState(b.fx.local.db).pullCursor, 0);
    assert.equal(
      Object.values(b.fx.local.db.$client.prepare('PRAGMA foreign_keys').get() ?? {})[0],
      1,
      'las claves foráneas vuelven a estar activas',
    );
    assert.equal(readSyncState(b.fx.local.db).lastErrorCode, 'internal');

    b.fx.local.db.$client.exec('DROP TRIGGER boom');
    const ok = await b.engine.runCycle();
    assert.equal(ok.status, 'ok');
    assert.equal(
      Number(b.fx.local.db.$client.prepare('SELECT count(*) AS n FROM games').get()?.n),
      4,
    );
    assert.equal(readSyncState(b.fx.local.db).pullCursor, hub.seq);
    assert.equal(readSyncState(b.fx.local.db).lastError, null);
  });

  it('pagina la bajada según pullPageRows', async () => {
    const hub = newHub();
    hub.limits = { ...hub.limits, pullPageRows: 2 };
    const a = pc(hub);
    for (let i = 0; i < 5; i++) seedGame(a.fx.ctx, { title: `J${i}` });
    await a.engine.runCycle();

    const b = pc(hub, { deviceId: OTHER });
    const result = await b.engine.runCycle();

    assert.equal(result.applied, 6, 'cinco juegos y el dispositivo de A (más el propio de B)');
    assert.ok(result.pages >= 3);
    assert.equal(
      Number(b.fx.local.db.$client.prepare('SELECT count(*) AS n FROM games').get()?.n),
      5,
    );
    assert.ok(hub.calls.filter((c) => c.kind === 'pull').every((c) => c.rows <= 2));
  });

  it('el reloj local pasa por encima de los relojes que llegan', async () => {
    const hub = newHub();
    const a = pc(hub, { start: T0 + 5 * 60_000 });
    hub.time = T0 + 5 * 60_000;
    const id = seedGame(a.fx.ctx, { title: 'Del futuro cercano' });
    await a.engine.runCycle();
    const incoming = String(row(a, 'games', id)?.syncUpdated);

    const b = pc(hub, { deviceId: OTHER }); // su pared va 5 min por detrás
    await b.engine.runCycle();
    // Sin el id corto, que solo desempata: lo que importa es ms y contador.
    assert.ok(b.fx.local.clock.peek().slice(0, 18) >= incoming.slice(0, 18));

    b.fx.ctx.store.patch('games', id, { notes: 'después' });
    assert.ok(String(row(b, 'games', id)?.syncUpdated) > incoming);
  });

  it('el eco de la propia subida no cambia nada ni avisa', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Mío' });

    const result = await a.engine.runCycle();

    assert.ok(result.pulled >= 2, 'el hub devuelve lo que acabamos de subir');
    assert.equal(result.applied, 0);
    assert.equal(a.changes.length, 0);
  });

  it('avisa de las tablas y los ids que cambiaron', async () => {
    const hub = newHub();
    const a = pc(hub);
    const id = seedGame(a.fx.ctx, { title: 'Nuevo' });
    await a.engine.runCycle();

    const b = pc(hub, { deviceId: OTHER });
    await b.engine.runCycle();

    assert.equal(b.changes.length, 1);
    assert.ok(b.changes[0].tables.includes('games'));
    assert.deepEqual(b.changes[0].ids.games, [id]);
  });

  it('avisa tras CADA página de bajada que aplicó algo, no solo al final del ciclo (§15.4)', async () => {
    const hub = newHub();
    hub.limits = { ...hub.limits, pullPageRows: 2 };
    const a = pc(hub);
    const ids = [0, 1, 2, 3, 4].map((i) => seedGame(a.fx.ctx, { title: `J${i}` }));
    await a.engine.runCycle();

    const b = pc(hub, { deviceId: OTHER });
    const result = await b.engine.runCycle();

    assert.ok(result.pages >= 3);
    assert.ok(b.changes.length >= 3, 'un aviso por página con filas nuevas');
    const announced = b.changes.flatMap((change) => change.ids.games ?? []);
    assert.deepEqual([...announced].sort(), [...ids].sort(), 'cada juego se avisa una sola vez');
  });

  it('una fila local pendiente sigue pendiente tras fusionar lo que llega', async () => {
    const hub = newHub();
    const a = pc(hub);
    const b0 = pc(hub, { deviceId: OTHER });
    const id = seedGame(a.fx.ctx, { title: 'Compartido' });
    await a.engine.runCycle();
    await b0.engine.runCycle();
    a.fx.wall.advance(1000);
    a.fx.ctx.store.patch('games', id, { notes: 'de A' });
    await a.engine.runCycle();

    // B edita otra columna y su subida no llega a aceptarse.
    b0.fx.wall.advance(2000);
    b0.fx.ctx.store.patch('games', id, { coverOverride: 'de B' });
    const deaf = wrapHub(hub, {
      push: () =>
        Promise.resolve({
          hubId: hub.hubId,
          epoch: hub.epoch,
          accepted: [],
          rejected: [],
          seq: hub.seq,
          serverTime: hub.time,
        }),
    });
    const b = createSyncEngine({
      local: b0.fx.local,
      transport: deaf,
      now: b0.fx.wall.wall,
    });
    await b.runCycle();

    assert.equal(row(b0, 'games', id)?.notes, 'de A');
    assert.equal(row(b0, 'games', id)?.coverOverride, 'de B');
    assert.equal(row(b0, 'games', id)?.syncDirty, 1);
  });

  it('ignora tablas desconocidas y aparta filas inválidas sin atascar el cursor', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Bueno' });
    await a.engine.runCycle();
    const ck = formatClock(T0, 0, 'zzzzzz');
    hub.inject({
      table: 'games',
      id: 'sin-titulo',
      created: ck,
      deleted: null,
      fields: { title: null, addedAt: T0 },
      clocks: { title: ck, addedAt: ck },
    });
    const noisy = wrapHub(hub, {
      pull: async (since, limit) => {
        const page = await hub.pull(since, limit);
        page.rows.push(
          {
            table: 'tabla_del_futuro',
            id: 'x',
            created: ck,
            deleted: null,
            fields: { a: 1 },
            clocks: { a: ck },
          },
          {
            table: 'games',
            id: 'reloj-roto',
            created: 'no-es-un-reloj',
            deleted: null,
            fields: { title: 'x' },
            clocks: { title: 'no-es-un-reloj' },
          },
        );
        return page;
      },
    });

    const b = pc(noisy, { deviceId: OTHER });
    const result = await b.engine.runCycle();

    assert.equal(result.status, 'ok');
    assert.equal(result.skipped, 2, 'NOT NULL a null y reloj roto');
    assert.equal(row(b, 'games', 'sin-titulo'), undefined);
    assert.equal(row(b, 'games', 'reloj-roto'), undefined);
    assert.equal(readSyncState(b.fx.local.db).pullCursor, hub.seq);
  });
});

describe('identidad del hub y esquema', () => {
  it('con un hub distinto (o su época) vuelve a subirlo todo y a bajar desde cero', async () => {
    for (const change of [{ hubId: 'hub-2' }, { epoch: 2 }]) {
      const hub = newHub();
      const a = pc(hub);
      seedGame(a.fx.ctx, { title: 'Uno' });
      seedGame(a.fx.ctx, { title: 'Dos' });
      await a.engine.runCycle();
      assert.equal(totalDirty(a), 0);

      hub.wipe(change);
      const result = await a.engine.runCycle();

      assert.equal(result.reset, 'new_hub');
      assert.equal(hub.count('games'), 2, 'se resubió todo');
      assert.equal(totalDirty(a), 0);
      assert.equal(readSyncState(a.fx.local.db).hubEpoch, hub.epoch);
    }
  });

  it('con el cursor por encima de la secuencia del hub resube todo', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Uno' });
    await a.engine.runCycle();
    assert.ok(readSyncState(a.fx.local.db).pullCursor > 0);

    hub.wipe(); // misma identidad, secuencia a cero: una copia antigua restaurada
    const result = await a.engine.runCycle();

    assert.equal(result.reset, 'hub_rewound');
    assert.equal(hub.count('games'), 1);
    assert.equal(totalDirty(a), 0);
  });

  it('la primera vez con un hub lo sube todo', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Previo' });
    // Como tras importar la 1.x: filas ya aceptadas por nadie.
    a.fx.local.db.$client.exec('UPDATE games SET syncDirty = 0');

    const result = await a.engine.runCycle();

    assert.equal(result.reset, 'new_hub');
    assert.equal(hub.count('games'), 1);
  });

  it('tras actualizar la app con esquema nuevo pone el cursor a cero y vuelve a bajar', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Uno' });
    await a.engine.runCycle();
    assert.equal(readSyncState(a.fx.local.db).lastSyncedSchemaVersion, 1);

    const updated = createSyncEngine({
      local: a.fx.local,
      transport: hub,
      now: a.fx.wall.wall,
      schemaVersion: 2,
    });
    const result = await updated.runCycle();

    assert.equal(result.reset, 'schema_changed');
    assert.ok(result.pulled > 0, 'bajó otra vez desde el cursor a cero');
    assert.equal(readSyncState(a.fx.local.db).lastSyncedSchemaVersion, 2);
    const again = await updated.runCycle();
    assert.equal(again.reset, null);
  });

  it('schema_too_old bloquea: no hay más peticiones hasta actualizar la app', async () => {
    const hub = newHub();
    const a = pc(hub);
    seedGame(a.fx.ctx, { title: 'Local' });
    hub.failures.push(
      new SyncRequestError('schema_too_old', 'viejo', 426, {
        error: 'schema_too_old',
        message: 'viejo',
        minSchema: 5,
      }),
    );

    const first = await a.engine.runCycle();
    assert.equal(first.status, 'blocked');
    assert.equal(first.retry, false);
    assert.equal(first.minSchema, 5);
    assert.equal(readSyncState(a.fx.local.db).blockedMinSchema, 5);

    const before = hub.calls.length;
    const second = await a.engine.runCycle();
    assert.equal(second.status, 'blocked');
    assert.equal(hub.calls.length, before, 'ni una petición');
    assert.equal(dirty(a, 'games'), 1, 'lo local se queda pendiente, intacto');

    const updated = createSyncEngine({
      local: a.fx.local,
      transport: hub,
      now: a.fx.wall.wall,
      schemaVersion: 5,
    });
    const third = await updated.runCycle();
    assert.equal(third.status, 'ok');
    assert.equal(readSyncState(a.fx.local.db).blockedMinSchema, null);
    assert.equal(hub.count('games'), 1);
  });

  it('también bloquea si /status ya anuncia un mínimo mayor', async () => {
    const hub = newHub();
    hub.minSchema = 7;
    const a = pc(hub);
    const result = await a.engine.runCycle();
    assert.equal(result.status, 'blocked');
    assert.equal(readSyncState(a.fx.local.db).blockedMinSchema, 7);
    assert.equal(hub.calls.filter((c) => c.kind !== 'status').length, 0);
  });
});

describe('errores', () => {
  it('unauthorized para y se anota; no se reintenta solo', async () => {
    const hub = newHub();
    const a = pc(hub);
    hub.failures.push(new SyncRequestError('unauthorized', 'token revocado', 401));

    const result = await a.engine.runCycle();

    assert.equal(result.status, 'unauthorized');
    assert.equal(result.retry, false);
    const state = readSyncState(a.fx.local.db);
    assert.equal(state.lastErrorCode, 'unauthorized');
    assert.equal(state.lastError, 'token revocado');
    assert.equal(state.lastErrorAt, T0);
  });

  it('red y cupo se reintentan; un ciclo correcto limpia el error', async () => {
    const hub = newHub();
    const a = pc(hub);
    hub.failures.push(new SyncRequestError('network', 'sin red'));
    const net = await a.engine.runCycle();
    assert.equal(net.status, 'error');
    assert.equal(net.retry, true);
    assert.equal(net.error?.code, 'network');

    hub.failures.push(new SyncRequestError('quota_exceeded', 'cupo', 503));
    const quota = await a.engine.runCycle();
    assert.equal(quota.retry, true);
    assert.equal(readSyncState(a.fx.local.db).lastErrorCode, 'quota_exceeded');

    const ok = await a.engine.runCycle();
    assert.equal(ok.status, 'ok');
    assert.equal(readSyncState(a.fx.local.db).lastError, null);
    assert.equal(readSyncState(a.fx.local.db).lastErrorCode, null);
  });

  it('un fallo a mitad de la subida no pierde la marca de lo pendiente', async () => {
    const hub = newHub();
    hub.limits = { ...hub.limits, pushMaxRows: 2 };
    const a = pc(hub);
    for (let i = 0; i < 4; i++) seedGame(a.fx.ctx, { title: `J${i}` });
    const total = totalDirty(a);
    let calls = 0;
    const flaky = wrapHub(hub, {
      push: (request) => {
        calls += 1;
        if (calls === 2) return Promise.reject(new SyncRequestError('network', 'se cayó'));
        return hub.push(request);
      },
    });
    const engine = createSyncEngine({ local: a.fx.local, transport: flaky, now: a.fx.wall.wall });

    const failed = await engine.runCycle();
    assert.equal(failed.status, 'error');
    assert.equal(totalDirty(a), total - 2, 'el primer lote sí quedó limpio');

    const ok = await engine.runCycle();
    assert.equal(ok.status, 'ok');
    assert.equal(totalDirty(a), 0);
  });

  it('un solo ciclo a la vez: una segunda llamada se une al ciclo en marcha', async () => {
    const hub = newHub();
    const a = pc(hub);
    const first = a.engine.runCycle();
    const second = a.engine.runCycle();
    assert.equal(first, second);
    assert.equal(a.engine.running, true);
    await first;
    assert.equal(a.engine.running, false);
    assert.equal(hub.calls.filter((c) => c.kind === 'status').length, 1);
  });
});

describe('reloj adelantado (§8.2, E-23)', () => {
  const HOUR = 60 * 60 * 1000;

  it('mientras la hora de pared siga adelantada informa y no re-fecha nada', async () => {
    const hub = newHub();
    const a = pc(hub);
    a.fx.wall.set(T0 + HOUR);
    const id = seedGame(a.fx.ctx, { title: 'Escrito con el reloj mal' });
    const before = String(row(a, 'games', id)?.syncUpdated);

    const result = await a.engine.runCycle();

    assert.equal(result.status, 'clock_ahead');
    assert.equal(result.error?.message, 'el reloj de este PC está adelantado');
    assert.equal(result.clockRecovered, false);
    assert.equal(row(a, 'games', id)?.syncUpdated, before, 'no gana siempre: no se toca');
    assert.equal(row(a, 'games', id)?.syncDirty, 1);
    assert.equal(hub.count('games'), 0);
    assert.equal(readSyncState(a.fx.local.db).lastErrorCode, 'clock_ahead');
  });

  it('con la hora corregida reinicia el reloj, re-fecha lo pendiente y lo vuelve a subir', async () => {
    const hub = newHub();
    const a = pc(hub);
    a.fx.wall.set(T0 + HOUR);
    const id = seedGame(a.fx.ctx, { title: 'Escrito con el reloj mal' });
    await a.engine.runCycle();

    a.fx.wall.set(T0 + 1000); // el usuario corrige la hora
    const result = await a.engine.runCycle();

    assert.equal(result.status, 'ok');
    assert.equal(result.clockRecovered, true);
    const limit = hub.time + MAX_AHEAD_MS;
    const stored = row(a, 'games', id);
    assert.ok(parseClock(String(stored?.syncUpdated)).ms <= limit);
    assert.ok(parseClock(String(stored?.syncCreated)).ms <= limit);
    assert.equal(stored?.syncDirty, 0);
    assert.equal(hub.get('games', id)?.fields.title, 'Escrito con el reloj mal');
    // Lo que se escriba ahora ya no sale del futuro.
    a.fx.ctx.store.patch('games', id, { notes: 'ya con la hora buena' });
    assert.ok(parseClock(String(row(a, 'games', id)?.syncUpdated)).ms <= limit);
    const next = await a.engine.runCycle();
    assert.equal(next.status, 'ok');
    assert.equal(hub.get('games', id)?.fields.notes, 'ya con la hora buena');
  });

  it('sigue bajando lo de los demás aunque su reloj esté mal', async () => {
    const hub = newHub();
    const a = pc(hub);
    const b = pc(hub, { deviceId: OTHER });
    const other = seedGame(b.fx.ctx, { title: 'De B' });
    await b.engine.runCycle();
    a.fx.wall.set(T0 + HOUR);
    seedGame(a.fx.ctx, { title: 'Mal fechado' });

    const result = await a.engine.runCycle();

    assert.equal(result.status, 'clock_ahead');
    assert.equal(row(a, 'games', other)?.title, 'De B');
  });
});

describe('emparejado', () => {
  it('aplica el id corto del hub al reloj en caliente y el primer ciclo lo sube todo', async () => {
    const hub = newHub();
    const a = pc(hub);
    const id = seedGame(a.fx.ctx, { title: 'Previo' });
    await a.engine.runCycle();
    const old = a.fx.local.shortDeviceId;
    const before = a.fx.local.clock.peek();

    const outcome = applyEnrollment(a.fx.local.db, { shortDeviceId: 'hub001' }, a.fx.local.clock);

    assert.equal(outcome.previousShortDeviceId, old);
    assert.equal(a.fx.local.clock.dev, 'hub001');
    const state = readSyncState(a.fx.local.db);
    assert.equal(state.shortDeviceId, 'hub001');
    assert.equal(state.hubId, null);
    assert.equal(state.pullCursor, 0);

    // Lo que se escribe ahora firma con el id nuevo y ordena por encima de lo anterior.
    a.fx.ctx.store.patch('games', id, { notes: 'tras emparejar' });
    const written = String(row(a, 'games', id)?.syncUpdated);
    assert.equal(parseClock(written).dev, 'hub001');
    assert.ok(written > before);

    hub.wipe({ hubId: 'hub-nuevo' });
    const result = await a.engine.runCycle();
    assert.equal(result.status, 'ok', 'sin reiniciar');
    assert.equal(result.reset, 'new_hub');
    assert.equal(hub.get('games', id)?.fields.notes, 'tras emparejar');
  });

  it('defensa: si el id guardado y el del reloj difieren por otra vía, no sincroniza', async () => {
    const hub = newHub();
    const a = pc(hub);
    a.fx.local.db.$client.exec("UPDATE local_sync_state SET shortDeviceId = 'other1'");
    const result = await a.engine.runCycle();
    assert.equal(result.status, 'restart_required');
    assert.equal(result.retry, false);
    assert.equal(hub.calls.length, 0);
  });

  it('rechaza ids cortos inválidos o reservados sin tocar nada', () => {
    const a = pc(newHub());
    const dev = a.fx.local.clock.dev;
    for (const bad of ['000000', 'legacy', 'ABC123', 'corto']) {
      assert.throws(() => applyEnrollment(a.fx.local.db, { shortDeviceId: bad }, a.fx.local.clock));
    }
    assert.equal(a.fx.local.clock.dev, dev);
    assert.equal(readSyncState(a.fx.local.db).shortDeviceId, dev);
  });
});

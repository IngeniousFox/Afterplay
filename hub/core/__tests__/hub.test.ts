import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOTTOM, formatClock, MAX_AHEAD_MS } from '../../../src/shared/sync/clock';
import { APP_SCHEMA_VERSION } from '../../../src/main/db/v2/schemaVersion';
import { PROTOCOL_VERSION } from '../../../src/shared/sync/protocol';
import { HubError, TenantHub } from '../hub';
import {
  T0,
  VERSION,
  clockAt,
  makeHub,
  pullAll,
  push,
  pushRequest,
  recordingStorage,
  seqOf,
  wire,
} from './helpers';
import { NodeSqlStorage } from '../node/nodeStorage';

const A = 'aaaaaa';
const B = 'bbbbbb';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HubError, `no es un HubError: ${String(error)}`);
    return error.code;
  }
  return 'no lanzó';
}

describe('push y pull', () => {
  it('sube filas y las devuelve en orden de secuencia', () => {
    const { hub } = makeHub();
    const res = push(
      hub,
      wire({ id: 'g1', at: clockAt(10, A), fields: { title: 'Hades', endless: 0 } }),
      wire({ table: 'playthroughs', id: 'p1', at: clockAt(11, A), fields: { gameId: 'g1' } }),
    );
    assert.deepEqual(res.rejected, []);
    assert.deepEqual(res.accepted, [
      { table: 'games', id: 'g1' },
      { table: 'playthroughs', id: 'p1' },
    ]);
    assert.equal(res.seq, 2);
    assert.equal(res.serverTime, T0);

    const page = hub.pull(0, 100, VERSION);
    assert.equal(page.more, false);
    assert.equal(page.next, 2);
    assert.equal(page.seq, 2);
    assert.deepEqual(
      page.rows.map((r) => [r.table, r.id]),
      [
        ['games', 'g1'],
        ['playthroughs', 'p1'],
      ],
    );
    const game = page.rows[0];
    assert.equal(game.fields.title, 'Hades');
    assert.equal(game.clocks.title, clockAt(10, A));
    // Las columnas que nadie escribió viajan con su defecto y reloj BOTTOM.
    assert.equal(game.fields.saveBackupEnabled, 0);
    assert.equal(game.clocks.saveBackupEnabled, BOTTOM);
    assert.equal(game.created, clockAt(10, A));
    assert.equal(game.deleted, null);
  });

  it('identifica al hub: hubId aleatorio estable y época', () => {
    const one = makeHub();
    const two = makeHub();
    const status = one.hub.status(VERSION);
    assert.match(status.hubId, /^[0-9a-f-]{36}$/);
    assert.notEqual(status.hubId, two.hub.status(VERSION).hubId);
    assert.equal(status.epoch, 1);
    assert.equal(status.protocolVersion, PROTOCOL_VERSION);
    assert.equal(status.minSchema, 1);
    assert.equal(status.maxSchema, APP_SCHEMA_VERSION);
    assert.equal(status.serverTime, T0);
    assert.equal(status.limits.pushMaxRows, 200);

    // Reabrir sobre el mismo almacenamiento conserva identidad y secuencia.
    push(one.hub, wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'x' } }));
    const reopened = makeHub({}, one.storage);
    assert.equal(reopened.hub.status(VERSION).hubId, status.hubId);
    assert.equal(reopened.hub.status(VERSION).seq, 1);
    assert.equal(one.hub.bumpEpoch(), 2);
    assert.equal(reopened.hub.status(VERSION).epoch, 2);
  });

  it('absorbe el eco sin subir la secuencia', () => {
    const { hub } = makeHub();
    push(hub, wire({ id: 'g1', at: clockAt(10, A), fields: { title: 'Hades' } }));
    assert.equal(seqOf(hub), 1);
    // El cliente recibe su propia fila y la vuelve a subir tal cual.
    const echo = hub.pull(0, 100, VERSION).rows;
    const res = push(hub, ...echo);
    assert.deepEqual(res.rejected, []);
    assert.equal(res.accepted.length, 1);
    assert.equal(res.seq, 1);
    assert.equal(hub.pull(1, 100, VERSION).rows.length, 0);
  });

  it('no escribe nada en tenant_meta si el lote no cambia nada', () => {
    const { hub, storage } = makeHub();
    const row = wire({ id: 'g1', at: clockAt(10, A), fields: { title: 'Hades' } });
    push(hub, row);
    const log: string[] = [];
    const recorded = recordingStorage(storage);
    const probe = new TenantHub(recorded.storage, () => T0, { tenantId: 'tenant1' });
    probe.push(pushRequest([row, row]));
    log.push(...recorded.statements.map((s) => s.sql));
    assert.ok(!log.some((sql) => /UPDATE tenant_meta SET v = \? WHERE k = 'seq'/.test(sql)));
    assert.ok(!log.some((sql) => /^INSERT INTO "games"/.test(sql)));
  });

  it('repetir un push es idempotente', () => {
    const { hub } = makeHub();
    const rows = [
      wire({ id: 'g1', at: clockAt(10, A), fields: { title: 'Hades', notes: 'n' } }),
      wire({ id: 'g2', at: clockAt(11, A), fields: { title: 'Celeste' } }),
    ];
    push(hub, ...rows);
    const before = pullAll(hub);
    for (let i = 0; i < 3; i++) assert.equal(push(hub, ...rows).seq, 2);
    assert.deepEqual(pullAll(hub), before);
  });

  it('fusiona por columna las ediciones de dos dispositivos', () => {
    const { hub } = makeHub();
    // Los dos parten de la misma fila; A cambia el título y B las notas.
    const created = clockAt(1, A);
    push(hub, wire({ id: 'g1', at: created, fields: { title: 'viejo', notes: null } }));
    push(
      hub,
      wire({
        id: 'g1',
        at: created,
        fields: { title: 'de A' },
        clocks: { title: clockAt(100, A) },
      }),
    );
    push(
      hub,
      wire({
        id: 'g1',
        at: clockAt(2, B),
        fields: { title: 'de B (más viejo)', notes: 'de B' },
        clocks: { title: clockAt(50, B), notes: clockAt(60, B) },
      }),
    );
    const [row] = pullAll(hub);
    assert.equal(row.fields.title, 'de A');
    assert.equal(row.fields.notes, 'de B');
    assert.equal(row.clocks.title, clockAt(100, A));
    assert.equal(row.clocks.notes, clockAt(60, B));
    // `created` es el menor de los dos.
    assert.equal(row.created, created);
  });

  it('conserva las columnas que un cliente más viejo no manda', () => {
    const { hub } = makeHub();
    push(
      hub,
      wire({
        id: 'g1',
        at: clockAt(1, A),
        fields: { title: 'Hades', notes: 'mis notas', steamAppId: 1145360 },
      }),
    );
    // Un cliente viejo solo conoce `title`.
    push(
      hub,
      wire({
        id: 'g1',
        at: clockAt(2, B),
        fields: { title: 'Hades II' },
        clocks: { title: clockAt(500, B) },
      }),
    );
    const [row] = pullAll(hub);
    assert.equal(row.fields.title, 'Hades II');
    assert.equal(row.fields.notes, 'mis notas');
    assert.equal(row.fields.steamAppId, 1145360);
    assert.equal(row.clocks.notes, clockAt(1, A));
  });

  it('descarta las columnas que el hub no conoce sin fallar', () => {
    const { hub } = makeHub();
    const res = push(
      hub,
      wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'x', columnaDelFuturo: 'y' } }),
    );
    assert.deepEqual(res.rejected, []);
    const [row] = pullAll(hub);
    assert.equal(row.fields.title, 'x');
    assert.ok(!('columnaDelFuturo' in row.fields));
  });

  it('una lápida gana a una edición anterior y se propaga', () => {
    const { hub } = makeHub();
    push(hub, wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'x' } }));
    push(
      hub,
      wire({
        id: 'g1',
        at: clockAt(1, A),
        fields: {},
        deleted: clockAt(200, A),
      }),
    );
    // Una edición de otro PC con reloj anterior a la lápida no la deshace: la lápida es una
    // columna más, y la edición solo gana en la columna que toca.
    push(
      hub,
      wire({
        id: 'g1',
        at: clockAt(1, A),
        fields: { title: 'y' },
        clocks: { title: clockAt(100, B) },
      }),
    );
    const [row] = pullAll(hub);
    assert.equal(row.deleted, clockAt(200, A));
    assert.equal(row.clocks.syncDeleted, clockAt(200, A));
    assert.equal(row.fields.title, 'y');
  });
});

describe('rechazos por fila', () => {
  it('rechaza un reloj adelantado más de 10 minutos y deja pasar el resto', () => {
    const { hub } = makeHub();
    const ok = wire({ id: 'ok', at: clockAt(1, A), fields: { title: 'ok' } });
    // Justo en el límite se acepta; un milisegundo más, no.
    const edge = wire({ id: 'edge', at: clockAt(MAX_AHEAD_MS, A), fields: { title: 'borde' } });
    const ahead = wire({
      id: 'ahead',
      at: clockAt(MAX_AHEAD_MS + 1, A),
      fields: { title: 'futuro' },
    });
    // El reloj adelantado puede estar solo en una columna.
    const aheadColumn = wire({
      id: 'col',
      at: clockAt(1, A),
      fields: { title: 'x' },
      clocks: { title: clockAt(MAX_AHEAD_MS + 5, A) },
    });
    const res = push(hub, ok, edge, ahead, aheadColumn);
    assert.deepEqual(
      res.accepted.map((r) => r.id),
      ['ok', 'edge'],
    );
    assert.deepEqual(res.rejected, [
      { table: 'games', id: 'ahead', reason: 'clock_ahead' },
      { table: 'games', id: 'col', reason: 'clock_ahead' },
    ]);
    assert.equal(res.seq, 2);
  });

  it('rechaza lo firmado con el id corto reservado en una fila que el hub ya tiene, pero no BOTTOM', () => {
    const { hub } = makeHub();
    push(
      hub,
      wire({ id: 'r', at: clockAt(1, A), fields: { title: 'x' } }),
      wire({ id: 'r2', at: clockAt(1, A), fields: { title: 'x' } }),
    );
    const reserved = wire({ id: 'r', at: clockAt(2, '000000'), fields: { title: 'x' } });
    const inColumn = wire({
      id: 'r2',
      at: clockAt(1, A),
      fields: { title: 'x' },
      clocks: { title: clockAt(2, '000000') },
    });
    const withBottom = wire({
      id: 'b',
      at: clockAt(1, A),
      fields: { title: 'x', notes: null },
      clocks: { notes: BOTTOM },
    });
    const res = push(hub, reserved, inColumn, withBottom);
    assert.deepEqual(res.rejected, [
      { table: 'games', id: 'r', reason: 'reserved_device' },
      { table: 'games', id: 'r2', reason: 'reserved_device' },
    ]);
    assert.deepEqual(res.accepted, [{ table: 'games', id: 'b' }]);
  });

  it('acepta el eco de un reloj reservado que el hub ya tiene y rechaza uno inventado', () => {
    const { hub, storage } = makeHub();
    push(hub, wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'x', notes: null } }));
    // Simula el barrido (§10.5): el propio hub escribe `notes` con el reloj reservado.
    const reserved = clockAt(5, '000000');
    const seq = seqOf(hub) + 1;
    storage.exec(
      `UPDATE games SET notes = 'cerrada por el hub', syncFields = json_set(syncFields, '$.notes', ?), syncUpdated = ?, syncSeq = ? WHERE id = 'g1'`,
      reserved,
      reserved,
      seq,
    );
    storage.exec(`UPDATE tenant_meta SET v = ? WHERE k = 'seq'`, seq);

    // Un cliente la baja, edita OTRA columna y sube la fila completa.
    const [row] = pullAll(hub);
    assert.equal(row.clocks.notes, reserved);
    row.fields.title = 'editado';
    row.clocks.title = clockAt(9, B);
    const res = push(hub, row);
    assert.deepEqual(res.rejected, []);
    assert.deepEqual(res.accepted, [{ table: 'games', id: 'g1' }]);
    const [after] = pullAll(hub);
    assert.equal(after.fields.title, 'editado');
    assert.equal(after.fields.notes, 'cerrada por el hub');
    assert.equal(after.clocks.notes, reserved);

    // Un cliente que inventa un `000000` que el hub no tiene: rechazado, y el resto del lote pasa.
    const forged = { ...after, clocks: { ...after.clocks, notes: clockAt(6, '000000') } };
    const other = wire({ id: 'g2', at: clockAt(2, A), fields: { title: 'y' } });
    const res2 = push(hub, forged, other);
    assert.deepEqual(res2.rejected, [{ table: 'games', id: 'g1', reason: 'reserved_device' }]);
    assert.deepEqual(res2.accepted, [{ table: 'games', id: 'g2' }]);
    // Tampoco vale el mismo reloj en otra columna de una fila que el hub sí tiene.
    const moved = { ...after, clocks: { ...after.clocks, title: reserved } };
    assert.deepEqual(
      push(hub, moved).rejected.map((r) => [r.id, r.reason]),
      [['g1', 'reserved_device']],
    );
  });

  it('acepta un reloj reservado en una fila que el hub no tiene (hub nuevo tras un barrido)', () => {
    const { hub } = makeHub();
    const fresh = wire({ id: 'g3', at: clockAt(3, '000000'), fields: { title: 'z' } });
    const res = push(hub, fresh);
    assert.deepEqual(res.rejected, []);
    assert.deepEqual(res.accepted, [{ table: 'games', id: 'g3' }]);
    // Ya existe: a partir de aquí un reloj reservado distinto del guardado se rechaza.
    const other = wire({ id: 'g3', at: clockAt(4, '000000'), fields: { title: 'z' } });
    assert.deepEqual(push(hub, other).rejected, [
      { table: 'games', id: 'g3', reason: 'reserved_device' },
    ]);
  });

  it('rechaza tablas desconocidas y filas mal formadas', () => {
    const { hub } = makeHub();
    const good = wire({ id: 'ok', at: clockAt(1, A), fields: { title: 'x' } });
    const unknown = wire({ table: 'no_existe', id: 'u', at: clockAt(1, A), fields: {} });
    const local = wire({ table: 'local_sync_state', id: 'l', at: clockAt(1, A), fields: {} });
    const noClock = wire({ id: 'nc', at: clockAt(1, A), fields: { title: 'x' } });
    delete noClock.clocks.title;
    const badClock = wire({ id: 'bc', at: clockAt(1, A), fields: { title: 'x' } });
    badClock.clocks.title = '123-0-abc';
    const badCreated = { ...wire({ id: 'bd', at: clockAt(1, A) }), created: 'ayer' };
    const emptyId = wire({ id: '', at: clockAt(1, A) });
    const badValue = wire({ id: 'bv', at: clockAt(1, A), fields: { title: 'x' } });
    (badValue.fields as Record<string, unknown>).notes = { objeto: true };
    badValue.clocks.notes = clockAt(1, A);
    const extraClock = wire({ id: 'ec', at: clockAt(1, A), fields: { title: 'x' } });
    extraClock.clocks.notes = clockAt(1, A);
    const tombstoneNoClock = wire({ id: 'tn', at: clockAt(1, A), deleted: clockAt(5, A) });
    delete tombstoneNoClock.clocks.syncDeleted;
    const res = push(
      hub,
      good,
      unknown,
      local,
      noClock,
      badClock,
      badCreated,
      emptyId,
      badValue,
      extraClock,
      tombstoneNoClock,
      null as never,
    );
    assert.deepEqual(res.accepted, [{ table: 'games', id: 'ok' }]);
    assert.deepEqual(
      res.rejected.map((r) => r.reason),
      [
        'unknown_table',
        'unknown_table',
        'invalid_row',
        'invalid_row',
        'invalid_row',
        'invalid_row',
        'invalid_row',
        'invalid_row',
        'invalid_row',
        'unknown_table',
      ],
    );
    assert.equal(res.seq, 1);
  });

  it('un lote con filas rechazadas no deja a medias las válidas', () => {
    const { hub } = makeHub();
    push(
      hub,
      wire({ id: 'a', at: clockAt(1, A), fields: { title: 'a' } }),
      wire({ id: 'x', at: clockAt(MAX_AHEAD_MS + 10, A), fields: { title: 'x' } }),
      wire({ id: 'b', at: clockAt(2, A), fields: { title: 'b' } }),
    );
    assert.deepEqual(
      pullAll(hub).map((r) => r.id),
      ['a', 'b'],
    );
  });

  it('deshace todo el lote si una escritura falla', () => {
    const { hub, storage } = makeHub();
    push(hub, wire({ id: 'a', at: clockAt(1, A), fields: { title: 'a' } }));
    // Una restricción que solo existe en este test hace fallar la segunda fila.
    storage.execScript(
      `CREATE TRIGGER boom BEFORE INSERT ON games WHEN new.id = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );
    assert.throws(() =>
      push(
        hub,
        wire({ id: 'b', at: clockAt(2, A), fields: { title: 'b' } }),
        wire({ id: 'boom', at: clockAt(3, A), fields: { title: 'boom' } }),
      ),
    );
    assert.deepEqual(
      pullAll(hub).map((r) => r.id),
      ['a'],
    );
    assert.equal(seqOf(hub), 1);
  });

  it('exige que la subida respete pushMaxRows', () => {
    const { hub } = makeHub({ limits: { pushMaxRows: 3 } });
    const rows = [1, 2, 3, 4].map((n) =>
      wire({ id: `g${n}`, at: clockAt(n, A), fields: { title: 'x' } }),
    );
    assert.equal(
      codeOf(() => push(hub, ...rows)),
      'invalid_request',
    );
    assert.equal(push(hub, ...rows.slice(0, 3)).accepted.length, 3);
    assert.equal(
      codeOf(() => hub.push({ ...VERSION, rows: 'no' as never })),
      'invalid_request',
    );
  });
});

describe('paginación del pull', () => {
  it('pagina con next/more sin perder ni repetir filas', () => {
    const { hub } = makeHub();
    for (let n = 1; n <= 7; n++) {
      push(hub, wire({ id: `g${n}`, at: clockAt(n, A), fields: { title: `t${n}` } }));
    }
    const p1 = hub.pull(0, 3, VERSION);
    assert.deepEqual(
      p1.rows.map((r) => r.id),
      ['g1', 'g2', 'g3'],
    );
    assert.equal(p1.next, 3);
    assert.equal(p1.more, true);
    const p2 = hub.pull(p1.next, 3, VERSION);
    assert.deepEqual(
      p2.rows.map((r) => r.id),
      ['g4', 'g5', 'g6'],
    );
    const p3 = hub.pull(p2.next, 3, VERSION);
    assert.deepEqual(
      p3.rows.map((r) => r.id),
      ['g7'],
    );
    assert.equal(p3.more, false);
    // Sin novedades: next no avanza.
    const p4 = hub.pull(p3.next, 3, VERSION);
    assert.deepEqual(p4.rows, []);
    assert.equal(p4.next, p3.next);
    assert.equal(p4.more, false);
  });

  it('pagina en orden de secuencia mezclando tablas', () => {
    const { hub } = makeHub();
    // games y playthroughs alternos: g1 p1 g2 p2 g3 p3 (seq 1..6).
    for (let n = 1; n <= 3; n++) {
      push(hub, wire({ id: `g${n}`, at: clockAt(n, A), fields: { title: `t${n}` } }));
      push(
        hub,
        wire({
          table: 'playthroughs',
          id: `p${n}`,
          at: clockAt(10 + n, A),
          fields: { gameId: `g${n}` },
        }),
      );
    }
    const seen: string[] = [];
    let cursor = 0;
    for (;;) {
      const page = hub.pull(cursor, 4, VERSION);
      seen.push(...page.rows.map((r) => `${r.table}:${r.id}`));
      cursor = page.next;
      if (!page.more) break;
    }
    assert.deepEqual(seen, [
      'games:g1',
      'playthroughs:p1',
      'games:g2',
      'playthroughs:p2',
      'games:g3',
      'playthroughs:p3',
    ]);
    assert.equal(cursor, 6);
  });

  it('corta la página por bytes, con al menos una fila, sin perder ninguna', () => {
    const fill = (target: TenantHub): void => {
      for (let n = 1; n <= 5; n++) {
        push(target, wire({ id: `g${n}`, at: clockAt(n, A), fields: { title: 'x'.repeat(1000) } }));
      }
    };
    // Medir una fila tal como sale y dejar sitio para dos y media.
    const probe = makeHub().hub;
    fill(probe);
    const rowBytes = Buffer.byteLength(JSON.stringify(probe.pull(0, 1, VERSION).rows[0]), 'utf8');
    const { hub } = makeHub({ pullPageMaxBytes: Math.floor(rowBytes * 2.5) });
    fill(hub);
    const pages: string[][] = [];
    let cursor = 0;
    for (;;) {
      const page = hub.pull(cursor, 100, VERSION);
      pages.push(page.rows.map((r) => r.id));
      assert.ok(page.next > cursor, 'el cursor avanza');
      cursor = page.next;
      if (!page.more) break;
    }
    assert.deepEqual(pages, [['g1', 'g2'], ['g3', 'g4'], ['g5']]);
    assert.equal(cursor, 5);

    // Una fila más grande que el tope sale sola.
    const tiny = makeHub({ pullPageMaxBytes: 10 }).hub;
    push(tiny, wire({ id: 'a', at: clockAt(1, A), fields: { title: 'grande' } }));
    push(tiny, wire({ id: 'b', at: clockAt(2, A), fields: { title: 'grande' } }));
    const first = tiny.pull(0, 100, VERSION);
    assert.deepEqual(
      first.rows.map((r) => r.id),
      ['a'],
    );
    assert.equal(first.next, 1);
    assert.equal(first.more, true);
  });

  it('una página exacta no anuncia `more`', () => {
    const { hub } = makeHub();
    for (let n = 1; n <= 4; n++)
      push(hub, wire({ id: `g${n}`, at: clockAt(n, A), fields: { title: 'x' } }));
    const page = hub.pull(0, 4, VERSION);
    assert.equal(page.rows.length, 4);
    assert.equal(page.more, false);
  });

  it('vuelve a entregar las filas que cambian durante la descarga', () => {
    const { hub } = makeHub();
    for (let n = 1; n <= 6; n++) {
      push(hub, wire({ id: `g${n}`, at: clockAt(n, A), fields: { title: `t${n}` } }));
    }
    const delivered: { id: string; title: unknown }[] = [];
    const take = (rows: { id: string; fields: Record<string, unknown> }[]): void => {
      for (const r of rows) delivered.push({ id: r.id, title: r.fields.title });
    };
    const p1 = hub.pull(0, 3, VERSION);
    take(p1.rows);
    // Entre página y página otro dispositivo edita g1 (ya entregada) y g5 (aún no).
    push(
      hub,
      wire({
        id: 'g1',
        at: clockAt(1, A),
        fields: { title: 'g1 editada' },
        clocks: { title: clockAt(100, B) },
      }),
    );
    push(
      hub,
      wire({
        id: 'g5',
        at: clockAt(5, A),
        fields: { title: 'g5 editada' },
        clocks: { title: clockAt(101, B) },
      }),
    );
    let cursor = p1.next;
    for (;;) {
      const page = hub.pull(cursor, 3, VERSION);
      take(page.rows);
      cursor = page.next;
      if (!page.more) break;
    }
    // g1 llega dos veces (la vieja y la editada) y g5 una, ya editada.
    assert.deepEqual(
      delivered.filter((d) => d.id === 'g1').map((d) => d.title),
      ['t1', 'g1 editada'],
    );
    assert.deepEqual(
      delivered.filter((d) => d.id === 'g5').map((d) => d.title),
      ['g5 editada'],
    );
    for (const id of ['g2', 'g3', 'g4', 'g6']) {
      assert.equal(delivered.filter((d) => d.id === id).length, 1, id);
    }
    assert.equal(cursor, seqOf(hub));
  });

  it('acota la página al máximo del hub y valida los argumentos', () => {
    const { hub } = makeHub({ limits: { pullPageRows: 2 } });
    for (let n = 1; n <= 5; n++)
      push(hub, wire({ id: `g${n}`, at: clockAt(n, A), fields: { title: 'x' } }));
    const page = hub.pull(0, 1000, VERSION);
    assert.equal(page.rows.length, 2);
    assert.equal(page.more, true);
    assert.equal(
      codeOf(() => hub.pull(-1, 10, VERSION)),
      'invalid_request',
    );
    assert.equal(
      codeOf(() => hub.pull(0, 0, VERSION)),
      'invalid_request',
    );
    assert.equal(
      codeOf(() => hub.pull(1.5, 10, VERSION)),
      'invalid_request',
    );
  });

  it('un cursor por delante de la secuencia no devuelve nada y deja ver seq', () => {
    const { hub } = makeHub();
    push(hub, wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'x' } }));
    const page = hub.pull(99, 10, VERSION);
    assert.deepEqual(page.rows, []);
    assert.equal(page.next, 99);
    assert.equal(page.seq, 1);
  });
});

describe('versiones', () => {
  it('rechaza otra versión de protocolo', () => {
    const { hub } = makeHub();
    const old = { protocolVersion: PROTOCOL_VERSION + 1, schemaVersion: APP_SCHEMA_VERSION };
    assert.equal(
      codeOf(() => hub.status(old)),
      'protocol_mismatch',
    );
    assert.equal(
      codeOf(() => hub.push({ ...old, rows: [] })),
      'protocol_mismatch',
    );
    assert.equal(
      codeOf(() => hub.pull(0, 10, old)),
      'protocol_mismatch',
    );
  });

  it('rechaza un esquema por debajo de minSchema y dice cuál es', () => {
    const { hub } = makeHub();
    hub.setMinSchema(1);
    assert.doesNotThrow(() => hub.status({ ...VERSION, schemaVersion: 1 }));
    const { hub: strict } = makeHub({ maxSchema: 5 });
    strict.setMinSchema(3);
    // `setMinSchema` nunca baja.
    strict.setMinSchema(2);
    assert.equal(strict.status({ ...VERSION, schemaVersion: 3 }).minSchema, 3);
    try {
      strict.push({ ...VERSION, schemaVersion: 2, rows: [] });
      assert.fail('debía lanzar');
    } catch (error) {
      assert.ok(error instanceof HubError);
      assert.equal(error.code, 'schema_too_old');
      assert.equal(error.minSchema, 3);
      assert.deepEqual(error.toBody(), {
        error: 'schema_too_old',
        message: error.message,
        minSchema: 3,
      });
    }
    assert.equal(
      codeOf(() => strict.pull(0, 10, { ...VERSION, schemaVersion: 1 })),
      'schema_too_old',
    );
  });

  it('rechaza un cliente por delante del hub y versiones que no son números', () => {
    const { hub } = makeHub();
    assert.equal(
      codeOf(() => hub.push({ ...VERSION, schemaVersion: APP_SCHEMA_VERSION + 1, rows: [] })),
      'protocol_mismatch',
    );
    assert.equal(
      codeOf(() => hub.status({} as never)),
      'invalid_request',
    );
  });

  it('status contesta a un cliente por delante con maxSchema; push y pull lo siguen rechazando', () => {
    const { hub } = makeHub();
    const ahead = { ...VERSION, schemaVersion: APP_SCHEMA_VERSION + 1 };
    assert.equal(hub.status(ahead).maxSchema, APP_SCHEMA_VERSION);
    assert.equal(
      codeOf(() => hub.pull(0, 10, ahead)),
      'protocol_mismatch',
    );
    // Un protocolo distinto sigue siendo un fallo permanente, también en status.
    assert.equal(
      codeOf(() => hub.status({ ...VERSION, protocolVersion: VERSION.protocolVersion + 1 })),
      'protocol_mismatch',
    );
  });
});

describe('límites de sentencia del Durable Object', () => {
  it('busca los ids en trozos de 99 y no pasa de 100 parámetros por sentencia', () => {
    const base = makeHub();
    const ids = Array.from({ length: 200 }, (_, n) => `g${String(n).padStart(3, '0')}`);
    base.hub.push(
      pushRequest(ids.map((id, n) => wire({ id, at: clockAt(n + 1, A), fields: { title: id } }))),
    );

    const recorded = recordingStorage(base.storage);
    const hub = new TenantHub(recorded.storage, () => T0, { tenantId: 'tenant1' });
    recorded.statements.length = 0;
    // 200 filas: todas existen y todas cambian.
    const res = hub.push(
      pushRequest(
        ids.map((id, n) =>
          wire({
            id,
            at: clockAt(n + 1, A),
            fields: { title: `${id}!` },
            clocks: { title: clockAt(1000 + n, B) },
          }),
        ),
      ),
    );
    assert.equal(res.accepted.length, 200);
    assert.equal(res.seq, 400);

    const lookups = recorded.statements.filter((s) => /WHERE "id" IN/.test(s.sql));
    assert.equal(lookups.length, 3, '200 ids = 99 + 99 + 2');
    assert.deepEqual(
      lookups.map((s) => s.params.length),
      [99, 99, 2],
    );
    for (const statement of recorded.statements) {
      assert.ok(statement.params.length <= 100, statement.sql);
      assert.ok(statement.sql.length < 100_000);
    }
    assert.equal(pullAll(hub).length, 200);
    assert.equal(pullAll(hub)[0].fields.title, 'g000!');
  });

  it('el pull no usa SELECT compuestos y cabe en 100 parámetros', () => {
    // El SQLite de los Durable Objects rechaza un UNION ALL de todas las
    // tablas ("too many terms in compound SELECT"); Node no. Visto en el hub
    // de desarrollo: el pull hace una consulta por tabla.
    const base = makeHub();
    const recorded = recordingStorage(base.storage);
    const hub = new TenantHub(recorded.storage, () => T0, { tenantId: 'tenant1' });
    recorded.statements.length = 0;
    hub.pull(0, 1000, VERSION);
    assert.ok(recorded.statements.length > 0);
    for (const statement of recorded.statements) {
      assert.ok(statement.params.length <= 100);
      assert.doesNotMatch(statement.sql, /\b(UNION|INTERSECT|EXCEPT)\b/i);
    }
  });

  it('la misma fila dos veces en un lote se fusiona como en dos lotes', () => {
    const one = makeHub();
    const two = makeHub();
    const first = wire({ id: 'g1', at: clockAt(1, A), fields: { title: 'a' } });
    const second = wire({
      id: 'g1',
      at: clockAt(1, A),
      fields: { title: 'b', notes: 'n' },
      clocks: { title: clockAt(9, B), notes: clockAt(9, B) },
    });
    push(one.hub, first, second);
    push(two.hub, first);
    push(two.hub, second);
    assert.deepEqual(pullAll(one.hub), pullAll(two.hub));
    // Un cambio dentro del lote y otro no: una sola fila, pero dos secuencias gastadas.
    assert.equal(seqOf(one.hub), 2);
  });

  it('formatClock del test coincide con el que usa el hub', () => {
    assert.equal(clockAt(0, A), formatClock(T0, 0, A));
  });
});

describe('almacenamiento de Node', () => {
  it('hace ROLLBACK al lanzar y admite transacciones anidadas', () => {
    const storage = new NodeSqlStorage();
    storage.execScript('CREATE TABLE t (n INTEGER)');
    assert.throws(() =>
      storage.transactionSync(() => {
        storage.exec('INSERT INTO t VALUES (1)');
        storage.transactionSync(() => storage.exec('INSERT INTO t VALUES (2)'));
        try {
          storage.transactionSync(() => {
            storage.exec('INSERT INTO t VALUES (3)');
            throw new Error('interna');
          });
        } catch {
          /* la interna se deshace sola */
        }
        assert.equal(storage.exec('SELECT COUNT(*) AS c FROM t')[0].c, 2);
        throw new Error('externa');
      }),
    );
    assert.equal(storage.exec('SELECT COUNT(*) AS c FROM t')[0].c, 0);
  });
});

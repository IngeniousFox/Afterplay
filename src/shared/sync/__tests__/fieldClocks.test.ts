import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOTTOM, type Clock, formatClock, HybridClock } from '../clock';
import {
  changedColumns,
  clockedColumns,
  clocksAfterPatch,
  clocksForNewRow,
  type ColumnClocks,
  compactClocks,
  DELETED_COLUMN,
  expandClocks,
  parseSyncFields,
  restampFutureClocks,
  sameValue,
  serializeSyncFields,
  syncFieldsWithAddedColumns,
  syncUpdatedOf,
} from '../fieldClocks';

// Relojes por columna (§7.3, §8.3) y las dos operaciones de la puerta de
// escritura (§8.6). La fusión entre réplicas es de la fase 3 y no está aquí.

/** Generador pseudoaleatorio con semilla (mulberry32): casos reproducibles. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLUMNS = ['title', 'notes', 'endless', 'igdbId', 'genresOverride'];
const ck = (ms: number, dev = 'aaaaaa', counter = 0): Clock => formatClock(ms, counter, dev);

describe('compacto ↔ explícito', () => {
  it(`ida y vuelta, también tras bajar syncCreated (5.000 casos con semilla)`, () => {
    const r = rng(45);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < 5000; i++) {
      // Pocos relojes posibles: muchos empates con syncCreated y muchos BOTTOM.
      const pool = [BOTTOM, ck(1000), ck(1000, 'bbbbbb'), ck(1001), ck(1001, 'aaaaaa', 1)];
      const syncCreated = pick(pool.slice(1));
      const clocks: ColumnClocks = {};
      for (const c of clockedColumns(COLUMNS)) clocks[c] = pick(pool);

      const syncFields = compactClocks(syncCreated, clocks, COLUMNS);
      for (const [c, k] of Object.entries(syncFields)) assert.notEqual(k, syncCreated, c);
      assert.deepEqual(expandClocks({ syncCreated, syncFields }, COLUMNS), clocks);

      // Lo que pasa al fusionar (H-1): syncCreated baja al menor. Recompactando
      // desde los relojes explícitos, ninguna columna cambia de reloj.
      const lower = pick([BOTTOM, ck(999), syncCreated]);
      const lowered = compactClocks(lower, clocks, COLUMNS);
      assert.deepEqual(expandClocks({ syncCreated: lower, syncFields: lowered }, COLUMNS), clocks);

      // Texto canónico: mismas claves en el mismo orden, sea cual sea el origen.
      const text = serializeSyncFields(syncFields);
      assert.deepEqual(parseSyncFields(text), syncFields);
      assert.deepEqual(Object.keys(JSON.parse(text)), Object.keys(syncFields).sort());
    }
  });

  it('una columna conocida que no trae reloj lleva BOTTOM; las desconocidas se ignoran', () => {
    const created = ck(1000);
    const sf = compactClocks(created, { title: created, mystery: ck(5) }, COLUMNS);
    assert.equal(sf.title, undefined);
    assert.equal(sf.notes, BOTTOM);
    assert.equal(sf.syncDeleted, BOTTOM);
    assert.equal(sf.mystery, undefined);
    const explicit = expandClocks(
      { syncCreated: created, syncFields: { mystery: ck(5) } },
      COLUMNS,
    );
    assert.equal(explicit.mystery, undefined);
    assert.equal(explicit.notes, created);
  });

  it('syncFields mal formado se rechaza al leer', () => {
    assert.deepEqual(parseSyncFields(null), {});
    assert.deepEqual(parseSyncFields(''), {});
    assert.throws(() => parseSyncFields('[]'), RangeError);
    assert.throws(() => parseSyncFields('{"title":"ayer"}'), RangeError);
    assert.throws(() => parseSyncFields('{'), SyntaxError);
  });

  it('las columnas de sincronización no pueden pasar por columnas de datos', () => {
    assert.throws(() => clockedColumns(['title', 'syncDeleted']), RangeError);
    assert.throws(() => clockedColumns(['id']), RangeError);
    assert.deepEqual(clockedColumns(['a']), ['a', DELETED_COLUMN]);
  });

  it('syncUpdated es el mayor reloj de la fila, syncCreated incluido', () => {
    assert.equal(syncUpdatedOf(ck(5), { a: BOTTOM, b: ck(3) }), ck(5));
    assert.equal(syncUpdatedOf(ck(5), { a: ck(7), b: ck(3) }), ck(7));
  });
});

describe('fila recién creada', () => {
  it('lo indicado lleva el reloj de creación; lo no indicado, BOTTOM (H-2)', () => {
    const clock = ck(2000);
    const row = clocksForNewRow(clock, COLUMNS, ['title', 'igdbId']);
    assert.equal(row.syncCreated, clock);
    assert.equal(row.syncUpdated, clock);
    assert.deepEqual(row.clocks, {
      title: clock,
      notes: BOTTOM,
      endless: BOTTOM,
      igdbId: clock,
      genresOverride: BOTTOM,
      // syncDeleted lleva el reloj de creación, no BOTTOM: re-añadir resucita (§8.3.3).
      syncDeleted: clock,
    });
    // Las notas que otro PC escribió en la misma fila, aunque antes, ganan a este alta.
    assert.ok(ck(1500, 'bbbbbb') > row.clocks.notes);
    assert.deepEqual(compactClocks(row.syncCreated, row.clocks, COLUMNS), {
      endless: BOTTOM,
      genresOverride: BOTTOM,
      notes: BOTTOM,
    });
  });

  it('indicar una columna con valor null también es indicarla', () => {
    const row = clocksForNewRow(ck(2000), COLUMNS, Object.keys({ title: 'X', notes: null }));
    assert.equal(row.clocks.notes, ck(2000));
  });

  it('una columna desconocida es un error, no un dato que se pierde', () => {
    assert.throws(() => clocksForNewRow(ck(2000), COLUMNS, ['titel']), RangeError);
  });
});

describe('parche sobre una fila existente', () => {
  const created = ck(1000);
  const base = clocksForNewRow(created, COLUMNS, ['title', 'endless']);
  const values = { title: 'Elden Ring', notes: null, endless: false, igdbId: null };

  it('un parche que no cambia nada no toca ningún reloj ni gasta uno', () => {
    let calls = 0;
    const now = (): Clock => {
      calls++;
      return ck(9000);
    };
    const out = clocksAfterPatch(
      base,
      values,
      { title: 'Elden Ring', notes: null, endless: false, igdbId: undefined },
      COLUMNS,
      now,
    );
    assert.equal(calls, 0);
    assert.deepEqual(out.changed, []);
    assert.deepEqual(out.clocks, base.clocks);
    assert.equal(out.syncUpdated, base.syncUpdated);
    assert.equal(out.syncCreated, base.syncCreated);
  });

  it('solo las columnas que cambian de valor reciben el reloj nuevo', () => {
    const clock = new HybridClock('aaaaaa', () => 5000, base.syncUpdated);
    const out = clocksAfterPatch(
      base,
      values,
      { title: 'Elden Ring', notes: 'difícil', endless: true },
      COLUMNS,
      () => clock.now(),
    );
    assert.deepEqual(out.changed, ['notes', 'endless']);
    assert.equal(out.clocks.title, created, 'el título re-guardado no se re-fecha');
    assert.equal(out.clocks.notes, ck(5000));
    assert.equal(out.clocks.endless, ck(5000));
    assert.equal(out.clocks.igdbId, BOTTOM);
    assert.equal(out.syncUpdated, ck(5000));
    assert.equal(out.syncCreated, created);
    assert.equal(base.clocks.notes, BOTTOM, 'no muta la entrada');
  });

  it('lápida y resurrección son parches de syncDeleted', () => {
    const tomb = clocksAfterPatch(base, values, { syncDeleted: ck(3000) }, COLUMNS, () => ck(3000));
    assert.deepEqual(tomb.changed, [DELETED_COLUMN]);
    assert.equal(tomb.clocks.syncDeleted, ck(3000));
    const back = clocksAfterPatch(
      tomb,
      { ...values, syncDeleted: ck(3000) },
      { syncDeleted: null },
      COLUMNS,
      () => ck(4000),
    );
    assert.equal(back.clocks.syncDeleted, ck(4000));
  });

  it('falla si el reloj nuevo no supera al de la fila, o si la columna no existe', () => {
    assert.throws(
      () => clocksAfterPatch(base, values, { notes: 'x' }, COLUMNS, () => ck(1000)),
      RangeError,
    );
    assert.throws(() => changedColumns(values, { titel: 'x' }, COLUMNS), RangeError);
  });

  it('compara fechas por milisegundos y JSON por estructura', () => {
    const current = {
      title: new Date('2026-01-01T00:00:00Z'),
      genresOverride: { genres: ['rpg', 'soulslike'], meta: { a: 1, b: null } },
    };
    assert.deepEqual(
      changedColumns(
        current,
        {
          title: new Date(Date.parse('2026-01-01T00:00:00Z')),
          genresOverride: { meta: { b: null, a: 1 }, genres: ['rpg', 'soulslike'] },
        },
        COLUMNS,
      ),
      [],
    );
    assert.deepEqual(
      changedColumns(current, { genresOverride: { genres: ['soulslike', 'rpg'] } }, COLUMNS),
      ['genresOverride'],
    );
    // Columna ausente en la fila = null.
    assert.deepEqual(changedColumns({}, { notes: null, igdbId: 0 }, COLUMNS), ['igdbId']);
  });
});

describe('sameValue', () => {
  const equal: [unknown, unknown][] = [
    [null, null],
    [0, -0],
    [NaN, NaN],
    [1.5, 1.5],
    ['a', 'a'],
    [true, true],
    [BigInt(7), BigInt(7)],
    [new Date(5), new Date(5)],
    [new Date(NaN), new Date(NaN)],
    [[], []],
    [{}, {}],
    [{ a: 1, b: undefined }, { a: 1 }],
    [{ a: [1, { b: [null] }] }, { a: [1, { b: [null] }] }],
    [new Uint8Array([1, 2]), new Uint8Array([1, 2])],
  ];
  const different: [unknown, unknown][] = [
    [null, 0],
    [null, ''],
    [null, false],
    [0, false],
    [1, true],
    [1, '1'],
    [1, BigInt(1)],
    [new Date(5), 5],
    [new Date(5), new Date(6)],
    [
      [1, 2],
      [2, 1],
    ],
    [[1], [1, 1]],
    [[], {}],
    [{ a: 1 }, { a: '1' }],
    [{ a: null }, {}],
    [new Uint8Array([1, 2]), new Uint8Array([1, 3])],
    [new Uint8Array([1]), [1]],
    [undefined, null],
  ];
  for (const [a, b] of equal) {
    it(`iguales: ${String(a)} y ${String(b)}`, () => {
      assert.equal(sameValue(a, b), true);
      assert.equal(sameValue(b, a), true);
    });
  }
  for (const [a, b] of different) {
    it(`distintos: ${String(a)} y ${String(b)}`, () => {
      assert.equal(sameValue(a, b), false);
      assert.equal(sameValue(b, a), false);
    });
  }
});

describe('migraciones y recuperación de reloj', () => {
  it('una columna añadida por migración nace con BOTTOM (H-6)', () => {
    const sf = syncFieldsWithAddedColumns({ notes: ck(5) }, ['platform']);
    assert.deepEqual(sf, { notes: ck(5), platform: BOTTOM });
    assert.deepEqual(Object.keys(sf), ['notes', 'platform']);
  });

  it('re-fecha solo los relojes futuros de una fila pendiente, lápida incluida', () => {
    const limit = 10_000;
    const row = {
      syncCreated: ck(20_000),
      syncUpdated: ck(30_000),
      clocks: { title: ck(20_000), notes: ck(5_000), endless: BOTTOM, syncDeleted: ck(30_000) },
      syncDeleted: ck(30_000),
    };
    const fresh = ck(9_000, 'aaaaaa', 3);
    const out = restampFutureClocks(row, limit, () => fresh);
    assert.equal(out.syncCreated, fresh);
    assert.equal(out.createdRestamped, true);
    assert.deepEqual(out.restamped, ['title', 'syncDeleted']);
    assert.deepEqual(out.clocks, {
      title: fresh,
      notes: ck(5_000),
      endless: BOTTOM,
      syncDeleted: fresh,
    });
    assert.equal(out.syncDeleted, fresh, 'el valor de la lápida es su reloj');
    assert.equal(out.syncUpdated, fresh);

    let calls = 0;
    const calm = restampFutureClocks(
      {
        ...row,
        syncCreated: ck(1),
        syncUpdated: ck(5_000),
        clocks: { notes: ck(5_000) },
        syncDeleted: null,
      },
      limit,
      () => {
        calls++;
        return fresh;
      },
    );
    assert.equal(calls, 0);
    assert.deepEqual(calm.restamped, []);
  });
});

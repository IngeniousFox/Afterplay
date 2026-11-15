import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOTTOM, formatClock } from '../clock';
import {
  canonical,
  decodeStored,
  encodeStored,
  fromWire,
  mergeRows,
  project,
  toWire,
  type RowState,
  type SqlValue,
  type TableShape,
} from '../merge';

// Propiedades algebraicas de la fusión (§8.3, §17.2) con entradas aleatorias,
// portadas del spike `spikes/sync-core/test/properties.test.ts`. Con pocos
// relojes y valores posibles salen muchos empates: el caso difícil.

const SHAPE: TableShape = { columns: ['a', 'b', 'c', 'd'] };
const CLOCKED = [...SHAPE.columns, 'syncDeleted'];
const N = Number(process.env.MERGE_CASES ?? 5_000);

/** PRNG reproducible (mulberry32), como el del spike. */
const rng = (
  seed: number,
): {
  int: (n: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  chance: (p: number) => boolean;
} => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (n) => Math.floor(next() * n),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
  };
};
type Rng = ReturnType<typeof rng>;

const T = 1_700_000_000_000;

const randClock = (r: Rng): string =>
  r.chance(0.1)
    ? BOTTOM
    : formatClock(T + r.int(4), r.int(2), r.pick(['aaaaaa', 'bbbbbb', 'cccccc']));

const randValue = (r: Rng): SqlValue => r.pick<SqlValue>([null, 0, 1, 2.5, 'x', 'y', '']);

const randRow = (r: Rng): RowState => {
  const created = randClock(r);
  const row: RowState = {
    id: 'k',
    created: created === BOTTOM ? formatClock(T, 0, 'aaaaaa') : created,
    fields: {},
    clocks: {},
  };
  for (const column of CLOCKED) {
    // Columna que esta réplica no tiene (esquemas distintos, §8.7).
    if (r.chance(0.25)) continue;
    row.fields[column] =
      column === 'syncDeleted' ? r.pick([null, formatClock(T + 2, 0, 'bbbbbb')]) : randValue(r);
    row.clocks[column] = randClock(r);
  }
  return row;
};

const key = (row: RowState): string =>
  JSON.stringify([canonical(row, SHAPE), Object.keys(row.fields).sort()]);

describe('fusión por campo: propiedades', () => {
  it(`es conmutativa (${N} casos)`, () => {
    const r = rng(42);
    for (let i = 0; i < N; i++) {
      const a = randRow(r);
      const b = randRow(r);
      assert.equal(key(mergeRows(a, b)), key(mergeRows(b, a)), JSON.stringify({ a, b }));
    }
  });

  it(`es asociativa (${N} casos)`, () => {
    const r = rng(43);
    for (let i = 0; i < N; i++) {
      const [a, b, c] = [randRow(r), randRow(r), randRow(r)];
      assert.equal(
        key(mergeRows(mergeRows(a, b), c)),
        key(mergeRows(a, mergeRows(b, c))),
        JSON.stringify({ a, b, c }),
      );
    }
  });

  it(`es idempotente: el eco no cambia nada (${N} casos)`, () => {
    const r = rng(44);
    for (let i = 0; i < N; i++) {
      const a = randRow(r);
      const b = randRow(r);
      const ab = mergeRows(a, b);
      assert.equal(key(mergeRows(a, a)), key(a));
      assert.equal(key(mergeRows(ab, b)), key(ab));
      assert.equal(key(mergeRows(ab, a)), key(ab));
    }
  });

  it(`la forma compacta de §7.3 va y vuelve, también tras bajar syncCreated (${N} casos)`, () => {
    const r = rng(45);
    for (let i = 0; i < N; i++) {
      const merged = mergeRows(randRow(r), randRow(r));
      for (const column of CLOCKED) {
        if (!(column in merged.fields)) {
          merged.fields[column] = null;
          merged.clocks[column] = BOTTOM;
        }
      }
      const decoded = decodeStored(encodeStored(merged, SHAPE), SHAPE);
      assert.deepEqual(decoded.clocks, merged.clocks);
      assert.deepEqual(decoded.fields, merged.fields);
    }
  });
});

describe('fusión por campo: casos concretos', () => {
  const c = (ms: number, dev = 'aaaaaa'): string => formatClock(T + ms, 0, dev);

  it('cada columna se queda con su escritura más reciente (E-05)', () => {
    const base = { id: 'g', created: c(0) };
    const notesFromA: RowState = {
      ...base,
      fields: { a: 'notas nuevas', b: 'carátula vieja', syncDeleted: null },
      clocks: { a: c(10), b: c(0), syncDeleted: c(0) },
    };
    const coverFromB: RowState = {
      ...base,
      fields: { a: 'notas viejas', b: 'carátula nueva', syncDeleted: null },
      clocks: { a: c(0, 'bbbbbb'), b: c(20, 'bbbbbb'), syncDeleted: c(0) },
    };
    const merged = mergeRows(notesFromA, coverFromB);
    assert.equal(merged.fields.a, 'notas nuevas');
    assert.equal(merged.fields.b, 'carátula nueva');
  });

  it('la lápida más reciente gana y una resurrección posterior la deshace', () => {
    const alive: RowState = {
      id: 'g',
      created: c(0),
      fields: { a: 'x', syncDeleted: null },
      clocks: { a: c(0), syncDeleted: c(0) },
    };
    const deleted: RowState = {
      ...alive,
      fields: { a: 'x', syncDeleted: c(5) },
      clocks: { a: c(0), syncDeleted: c(5) },
    };
    assert.equal(mergeRows(alive, deleted).fields.syncDeleted, c(5));
    const revived: RowState = { ...alive, clocks: { a: c(0), syncDeleted: c(9) } };
    assert.equal(mergeRows(deleted, revived).fields.syncDeleted, null);
  });

  it('conserva las columnas que la otra réplica no conoce (E-14)', () => {
    const newer: RowState = {
      id: 'g',
      created: c(0),
      fields: { a: 1, d: 'solo en el esquema nuevo', syncDeleted: null },
      clocks: { a: c(0), d: c(3), syncDeleted: c(0) },
    };
    const older: RowState = {
      id: 'g',
      created: c(0),
      fields: { a: 2, syncDeleted: null },
      clocks: { a: c(8), syncDeleted: c(0) },
    };
    const merged = mergeRows(newer, older);
    assert.equal(merged.fields.a, 2);
    assert.equal(merged.fields.d, 'solo en el esquema nuevo');
    assert.deepEqual(Object.keys(project(merged, { columns: ['a'] }).fields).sort(), [
      'a',
      'syncDeleted',
    ]);
  });

  it('una columna que la fila no trae se guarda con su valor por defecto y reloj BOTTOM', () => {
    const row: RowState = {
      id: 'g',
      created: c(0),
      fields: { a: 'x', syncDeleted: null },
      clocks: { a: c(0), syncDeleted: c(0) },
    };
    const stored = encodeStored(row, { columns: ['a', 'b'], defaults: { b: 0 } });
    assert.equal(stored.b, 0);
    assert.deepEqual(JSON.parse(stored.syncFields), { b: BOTTOM });
    assert.equal(stored.syncUpdated, c(0));
  });

  it('la forma en tránsito va y vuelve, con la lápida aparte', () => {
    const row: RowState = {
      id: 'g',
      created: c(0),
      fields: { a: 'x', b: null, syncDeleted: c(4) },
      clocks: { a: c(1), b: c(0), syncDeleted: c(4) },
    };
    const wire = toWire('games', row);
    assert.equal(wire.deleted, c(4));
    assert.equal('syncDeleted' in wire.fields, false);
    assert.deepEqual(fromWire(wire), row);
  });
});

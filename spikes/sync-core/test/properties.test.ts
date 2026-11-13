// Propiedades algebraicas de la fusión (§8.3, §17.2) con entradas aleatorias.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOTTOM, formatClock } from '../src/clock.ts'
import { rng, type Rng } from '../src/harness.ts'
import { canonical, decodeStored, encodeStored, mergeRows, type RowState } from '../src/merge.ts'
import type { SqlValue } from '../src/storage.ts'

const COLS = ['a', 'b', 'c', 'd', 'syncDeleted']
const N = Number(process.env.MERGE_CASES ?? 20_000)

function randClock(r: Rng): string {
  // Pocos valores → muchos empates (mismo reloj, mismo o distinto dispositivo).
  if (r.chance(0.1)) return BOTTOM
  return formatClock(1_700_000_000_000 + r.int(4), r.int(2), r.pick(['aaaaaa', 'bbbbbb', 'cccccc']))
}
function randValue(r: Rng): SqlValue {
  return r.pick<SqlValue>([null, 0, 1, 2.5, 'x', 'y', ''])
}
function randRow(r: Rng): RowState {
  const row: RowState = { id: 'k', created: randClock(r), fields: {}, clocks: {} }
  if (row.created === BOTTOM) row.created = formatClock(1_700_000_000_000, 0, 'aaaaaa')
  for (const c of COLS) {
    if (r.chance(0.25)) continue // columna que esta réplica no tiene (esquemas distintos)
    row.fields[c] = c === 'syncDeleted' ? r.pick([null, formatClock(1_700_000_000_002, 0, 'bbbbbb')]) : randValue(r)
    row.clocks[c] = randClock(r)
  }
  return row
}
const key = (x: RowState) => JSON.stringify([canonical(x, COLS), Object.keys(x.fields).sort()])

test(`fusión conmutativa (${N} casos)`, () => {
  const r = rng(42)
  for (let i = 0; i < N; i++) {
    const a = randRow(r)
    const b = randRow(r)
    assert.equal(key(mergeRows(a, b)), key(mergeRows(b, a)), JSON.stringify({ a, b }))
  }
})

test(`fusión asociativa (${N} casos)`, () => {
  const r = rng(43)
  for (let i = 0; i < N; i++) {
    const [a, b, c] = [randRow(r), randRow(r), randRow(r)]
    assert.equal(key(mergeRows(mergeRows(a, b), c)), key(mergeRows(a, mergeRows(b, c))), JSON.stringify({ a, b, c }))
  }
})

test(`fusión idempotente (${N} casos)`, () => {
  const r = rng(44)
  for (let i = 0; i < N; i++) {
    const a = randRow(r)
    const b = randRow(r)
    const ab = mergeRows(a, b)
    assert.equal(key(mergeRows(a, a)), key(a))
    assert.equal(key(mergeRows(ab, b)), key(ab), 'aplicar dos veces lo mismo no cambia nada (eco)')
    assert.equal(key(mergeRows(ab, a)), key(ab))
  }
})

test(`codificación compacta de §7.3 ida y vuelta, también tras bajar syncCreated (${N} casos)`, () => {
  const r = rng(45)
  for (let i = 0; i < N; i++) {
    const m = mergeRows(randRow(r), randRow(r))
    for (const c of COLS) if (!(c in m.fields)) ((m.fields[c] = null), (m.clocks[c] = BOTTOM))
    const enc = encodeStored(m, COLS)
    const dec = decodeStored({ id: 'k', ...enc, syncDeleted: enc.syncDeleted }, COLS)
    assert.deepEqual(dec.clocks, m.clocks)
    assert.deepEqual(dec.fields, m.fields)
  }
})

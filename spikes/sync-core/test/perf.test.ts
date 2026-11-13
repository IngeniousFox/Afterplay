// Medida sencilla de rendimiento: ~50.000 filas (el catálogo real tiene 40.452 logros).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatClock } from '../src/clock.ts'
import { MIN, World } from '../src/harness.ts'
import { canonical, mergeRows, type RowState } from '../src/merge.ts'
import { gameIdForIgdb, mergeColumns, FULL_SCHEMA } from '../src/schema.ts'

const N = Number(process.env.PERF_ROWS ?? 50_000)
const ms = (t: bigint) => Number(process.hrtime.bigint() - t) / 1e6
const now = () => process.hrtime.bigint()

test(`rendimiento con ${N} filas`, () => {
  const out: string[] = []

  // 1. Fusión pura en memoria.
  const cols = mergeColumns(FULL_SCHEMA.find((t) => t.name === 'state_events')!)
  const mk = (i: number, dev: string, ms0: number): RowState => {
    const c = formatClock(ms0 + i, 0, dev)
    const r: RowState = { id: `id${i}`, created: c, fields: {}, clocks: {} }
    for (const k of cols) ((r.fields[k] = k === 'syncDeleted' ? null : `v${i}${dev}`), (r.clocks[k] = c))
    return r
  }
  let t = now()
  let changed = 0
  for (let i = 0; i < N; i++) {
    const a = mk(i, 'aaaaaa', 1_700_000_000_000)
    const m = mergeRows(a, mk(i, 'bbbbbb', 1_700_000_000_000 + (i % 2 ? 1 : -1)))
    if (canonical(m, cols) !== canonical(a, cols)) changed++
  }
  out.push(`fusión pura (merge + forma canónica x2): ${N} filas en ${ms(t).toFixed(0)} ms`)
  assert.equal(changed, N) // la mitad cambia de valores; la otra, de syncCreated (mínimo)

  // 2. Puerta de escritura: alta de N filas en una transacción.
  const w = new World()
  const A = w.client('A', { wire: true })
  const g = A.insert('games', { title: 'Perf' }, gameIdForIgdb(1))
  const p = A.insert('playthroughs', { gameId: g })
  t = now()
  A.transaction(() => {
    for (let i = 0; i < N; i++) A.insert('state_events', { playthroughId: p, type: 'started', occurredAt: i, note: `logro ${i}` })
  })
  out.push(`puerta de escritura: ${N} altas en ${ms(t).toFixed(0)} ms`)

  // 3. Subida al hub en lotes de 1000 (con serialización JSON de ida y vuelta).
  A.checkHub(w.hub)
  const batch = A.preparePush(1000)
  const bytes = Buffer.byteLength(JSON.stringify(batch.rows))
  t = now()
  A.push(w.hub, 1000)
  out.push(`subida: ${N + 2} filas en lotes de 1000 → ${ms(t).toFixed(0)} ms (≈${(bytes / 1000).toFixed(0)} B/fila en tránsito, ${((bytes * N) / 1000 / 1e6).toFixed(1)} MB en total)`)
  assert.equal(w.hub.status().seq, N + 2)

  // 3b. Solo el hub: aplicar un lote de 1000 filas (lo que haría un DO por petición).
  const fresh = new World()
  const rows = JSON.parse(JSON.stringify(batch.rows))
  t = now()
  fresh.hub.push(rows)
  out.push(`hub: aplicar 1 lote de 1000 filas nuevas → ${ms(t).toFixed(1)} ms`)

  // 4. Pull completo paginado desde un cliente vacío.
  const C = w.client('C')
  C.checkHub(w.hub)
  t = now()
  C.pull(w.hub, 1000)
  out.push(`pull completo: ${C.stats.pulledRows} filas en ${C.stats.pullPages} páginas de 1000 → ${ms(t).toFixed(0)} ms`)
  assert.equal(C.stats.pulledRows, N + 2)
  assert.deepEqual(C.dump(), w.hubDump())

  // 5. Eco: A baja sus propias N filas (la fusión no cambia nada).
  t = now()
  A.pull(w.hub, 1000)
  out.push(`eco de la propia subida: ${N + 2} filas → ${ms(t).toFixed(0)} ms, ${A.stats.applied} escrituras`)
  assert.equal(A.stats.applied, 0)

  // 6. Refresco que cambia 1 campo en todas las filas y re-sincroniza.
  w.advance(MIN)
  t = now()
  A.transaction(() => {
    for (const r of A.db.exec(`SELECT id FROM state_events`)) A.update('state_events', r.id as string, { note: 'cambiado' })
  })
  const tUpd = ms(t)
  t = now()
  A.push(w.hub, 1000)
  const tPush = ms(t)
  t = now()
  C.pull(w.hub, 1000)
  out.push(`refresco de 1 campo en ${N} filas: puerta ${tUpd.toFixed(0)} ms, subida ${tPush.toFixed(0)} ms, pull en otro PC ${ms(t).toFixed(0)} ms`)

  for (const l of out) console.log(`  ${l}`)
})

// Propiedad de convergencia (§17.2): 3 réplicas + hub, operaciones aleatorias
// con semilla, periodos offline, relojes de pared desviados (atrasados y
// adelantados), subidas y bajadas troceadas e intercaladas en cualquier orden.
// Al final, tras sincronizar todo:
//   1. las 3 bases y el hub son idénticos (o la proyección, para el cliente viejo);
//   2. no queda nada pendiente de subir;
//   3. ORÁCULO de "ninguna escritura perdida": cada celda del hub tiene
//      exactamente la escritura de mayor reloj que alguien hizo (o BOTTOM si
//      nadie la escribió), y syncCreated es el mínimo de las creaciones.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOTTOM } from '../src/clock.ts'
import type { SyncClient } from '../src/client.ts'
import { DAY, MIN, rng, World } from '../src/harness.ts'
import { valueKey } from '../src/merge.ts'
import { FULL_SCHEMA, gameIdForIgdb, type TableDef, withoutColumns } from '../src/schema.ts'
import type { SqlValue } from '../src/storage.ts'

const SEEDS = Number(process.env.SEEDS ?? 300)
const STEPS = Number(process.env.STEPS ?? 200)
const OLD = withoutColumns(FULL_SCHEMA, { games: ['coverUrl'], playthroughs: ['rating'] })

const TEXT = [null, 'a', 'b', 'c', 'zz']
const valueFor = (table: string, col: string, r: ReturnType<typeof rng>): SqlValue => {
  const def = FULL_SCHEMA.find((t) => t.name === table)!.columns.find((c) => c.name === col)!
  if (def.type === 'TEXT') return def.notNull ? r.pick(['A', 'B', 'C']) : r.pick(TEXT)
  return r.pick([null, 0, 1, 2, 3600])
}

function ids(c: SyncClient, table: string): string[] {
  return c.db.exec(`SELECT id FROM ${table}`).map((x) => x.id as string)
}

export function runSeed(seed: number, mixedSchema: boolean, hook?: (w: World) => void) {
  const r = rng(seed)
  const w = new World(r)
  const schemas: TableDef[][] = [FULL_SCHEMA, FULL_SCHEMA, mixedSchema ? OLD : FULL_SCHEMA]
  const C = ['A', 'B', 'C'].map((n, i) => w.client(n, {}, schemas[i]))
  const online = new Map(C.map((c) => [c.name, true]))

  for (let step = 0; step < STEPS; step++) {
    w.advance(r.int(3) === 0 ? r.int(30 * MIN) : r.int(5_000))
    const c = r.pick(C)
    const op = r.int(100)
    const cols = (t: string) => (c.schema.find((x) => x.name === t)?.columns ?? []).map((x) => x.name)
    try {
      if (op < 8) {
        online.set(c.name, !online.get(c.name))
      } else if (op < 11) {
        // Reloj de pared: correcto, atrasado un día, unos minutos adelantado, o un día adelantado.
        w.skew.set(c.name, r.pick([0, 0, -DAY, -5 * MIN, 3 * MIN, DAY]))
      } else if (op < 30) {
        if (!online.get(c.name)) continue
        const kind = r.int(5)
        if (kind === 0) c.sync(w.hub, { pushLimit: 1 + r.int(4), pullLimit: 1 + r.int(4) })
        else if (kind === 1) (c.checkHub(w.hub), c.push(w.hub, 1 + r.int(3)))
        else if (kind === 2) (c.checkHub(w.hub), c.pullPage(w.hub, 1 + r.int(3)))
        else if (kind === 3) {
          // Subida en dos fases con una escritura local en medio (petición en vuelo).
          c.checkHub(w.hub)
          const b = c.preparePush(1 + r.int(4))
          const res = w.hub.push(JSON.parse(JSON.stringify(b.rows)))
          const victim = r.pick(b.rows.length ? b.rows : [undefined])
          if (victim && r.chance(0.7)) {
            const col = r.pick(cols(victim.table).filter((x) => !FULL_SCHEMA.find((t) => t.name === victim.table)!.parent || x !== FULL_SCHEMA.find((t) => t.name === victim.table)!.parent!.column))
            c.update(victim.table, victim.id, { [col]: valueFor(victim.table, col, r) })
          }
          c.ackPush(b.snap, res)
        } else {
          w.hub.sweepAbandoned('low-clock')
        }
      } else if (op < 40) {
        // Juego con id determinista (colisiones entre réplicas a propósito).
        const igdb = 1 + r.int(6)
        const vals: Record<string, SqlValue> = { title: r.pick(['T1', 'T2']), igdbId: igdb }
        if (r.chance(0.3)) vals.notes = r.pick(TEXT)
        c.insert('games', vals, gameIdForIgdb(igdb))
      } else if (op < 44) {
        c.insert('games', { title: r.pick(['R1', 'R2']), addedAt: w.t })
      } else if (op < 52) {
        const gs = ids(c, 'games')
        if (gs.length) c.insert('playthroughs', { gameId: r.pick(gs), ...(r.chance(0.5) ? { customLabel: r.pick(TEXT) } : {}) })
      } else if (op < 62) {
        const ps = ids(c, 'playthroughs')
        if (ps.length) {
          if (r.chance(0.6)) {
            const start = w.t - r.int(DAY)
            c.insert('sessions', {
              playthroughId: r.pick(ps),
              deviceId: c.name,
              startedAt: start,
              lastSeenAt: start + r.int(3600_000),
              ...(r.chance(0.5) ? { endedAt: start + 3600_000, durationSec: 3600, closedBy: 'owner' } : {})
            })
          } else c.insert('state_events', { playthroughId: r.pick(ps), type: r.pick(['started', 'completed']), occurredAt: w.t })
        }
      } else if (op < 90) {
        const table = r.pick(['games', 'playthroughs', 'sessions', 'state_events'])
        const all = ids(c, table)
        if (!all.length) continue
        const id = r.pick(all)
        const def = FULL_SCHEMA.find((t) => t.name === table)!
        const col = r.pick(cols(table))
        let v: SqlValue
        if (def.parent?.column === col) {
          const parents = ids(c, def.parent.table)
          if (!parents.length) continue // hijo huérfano a mitad de pull: su padre aún no ha llegado
          v = r.pick(parents) // re-colgar de otro padre
        } else v = valueFor(table, col, r)
        c.update(table, id, { [col]: v })
      } else {
        const table = r.pick(['games', 'playthroughs', 'sessions', 'state_events'])
        const all = ids(c, table)
        if (all.length) c.remove(table, r.pick(all))
      }
    } catch (e) {
      throw new Error(`semilla ${seed}, paso ${step}, op ${op} en ${c.name}: ${(e as Error).stack}`)
    }
  }

  // Fin: relojes corregidos, todos online, sincronizar hasta estabilizar.
  for (const c of C) w.skew.set(c.name, 0)
  w.advance(MIN)
  for (let round = 0; round < 6; round++) {
    for (const c of C) c.sync(w.hub, { pushLimit: 1 + r.int(50), pullLimit: 1 + r.int(50) })
    if (C.every((c) => c.dirtyCount() === 0 && c.cursor === w.hub.status().seq)) break
  }

  hook?.(w)
  const ctx = `semilla ${seed}${mixedSchema ? ' (esquema mixto)' : ''}`
  for (const c of C) {
    assert.equal(c.dirtyCount(), 0, `${ctx}: ${c.name} con filas sucias (${c.lastError})`)
    assert.deepEqual(c.dump(), w.hubDump(c.schema), `${ctx}: ${c.name} difiere del hub`)
    assert.equal(c.orphans, 0, `${ctx}: ${c.name} con huérfanos`)
  }

  // Oráculo.
  const best = new Map<string, { clock: string; value: SqlValue }>()
  const created = new Map<string, string>()
  const live = w.writes.filter((x) => x.client !== 'view')
  // Un re-estampado (D-7) sustituye a la celda con reloj futuro Y a toda
  // escritura anterior del mismo cliente en esa celda (versiones locales que
  // nunca salieron del PC porque el hub las rechazaba).
  const superseded = new Set<number>()
  live.forEach((x, i) => {
    if (!x.replaces) return
    for (let j = 0; j < i; j++) {
      const y = live[j]
      if (y.client === x.client && y.table === x.table && y.id === x.id && y.col === x.col && y.clock <= x.replaces) superseded.add(j)
    }
  })
  for (const [i, x] of live.entries()) {
    if (superseded.has(i)) continue
    const k = `${x.table}|${x.id}`
    if (x.col === '__created') {
      if (!created.has(k) || x.clock < created.get(k)!) created.set(k, x.clock)
      continue
    }
    const ck = `${k}|${x.col}`
    const cur = best.get(ck)
    if (!cur || x.clock > cur.clock || (x.clock === cur.clock && valueKey(x.value) > valueKey(cur.value)))
      best.set(ck, { clock: x.clock, value: x.value })
  }
  for (const t of FULL_SCHEMA) {
    for (const raw of w.hub.db.exec(`SELECT id FROM ${t.name}`)) {
      const id = raw.id as string
      const h = w.hub.get(t.name, id)!
      assert.equal(h.created, created.get(`${t.name}|${id}`), `${ctx}: syncCreated de ${t.name}/${id}`)
      for (const col of Object.keys(h.fields)) {
        const exp = best.get(`${t.name}|${id}|${col}`)
        if (!exp) {
          assert.equal(h.clocks[col], BOTTOM, `${ctx}: ${t.name}/${id}.${col} sin escrituras debería ser BOTTOM`)
          continue
        }
        assert.equal(h.clocks[col], exp.clock, `${ctx}: reloj de ${t.name}/${id}.${col}`)
        assert.deepEqual(h.fields[col], exp.value, `${ctx}: valor de ${t.name}/${id}.${col} (escritura perdida)`)
      }
    }
  }
  return { rows: Object.values(w.hubDump()).reduce((n, x) => n + x.length, 0), seq: w.hub.status().seq, recoveries: C.reduce((n, c) => n + c.stats.recoveries, 0) }
}

for (const mixed of [false, true]) {
  test(`convergencia 3 réplicas + hub, ${SEEDS} semillas × ${STEPS} pasos${mixed ? ', un cliente con esquema viejo' : ''}`, () => {
    let rows = 0
    let seq = 0
    let rec = 0
    for (let s = 1; s <= SEEDS; s++) {
      const x = runSeed(mixed ? 100_000 + s : s, mixed)
      rows += x.rows
      seq += x.seq
      rec += x.recoveries
    }
    console.log(`  [${mixed ? 'mixto' : 'mismo esquema'}] semillas=${SEEDS} filas finales=${rows} cambios en hub=${seq} recuperaciones de reloj=${rec}`)
  })
}

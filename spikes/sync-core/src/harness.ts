// Arnés de convergencia (§17.2): un hub y N clientes en un proceso, cada uno
// con su reloj de pared controlable.

import { SyncClient, type ClientOptions, type WriteLog } from './client.ts'
import { Hub } from './hub.ts'
import { canonical, decodeStored, project } from './merge.ts'
import { FULL_SCHEMA, mergeColumns, type TableDef } from './schema.ts'
import { NodeSqlStorage } from './storage.ts'

export const T0 = Date.UTC(2026, 10, 13, 12, 0, 0)
export const MIN = 60_000
export const HOUR = 3_600_000
export const DAY = 24 * HOUR

/** PRNG reproducible (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    bytes: (n: number) => {
      const b = new Uint8Array(n)
      for (let i = 0; i < n; i++) b[i] = Math.floor(next() * 256)
      return b
    }
  }
}
export type Rng = ReturnType<typeof rng>

export class World {
  t = T0
  readonly hub: Hub
  readonly clients: SyncClient[] = []
  readonly skew = new Map<string, number>()
  readonly writes: WriteLog[] = []

  constructor(
    readonly r: Rng = rng(1),
    hubId = 'hub-1',
    readonly hubSchema: TableDef[] = FULL_SCHEMA
  ) {
    this.hub = new Hub(new NodeSqlStorage(), hubSchema, { hubId, now: () => this.t, onWrite: (x) => this.writes.push(x) })
  }

  advance(ms: number) {
    this.t += ms
  }

  client(name: string, extra: Partial<ClientOptions> = {}, schema: TableDef[] = this.hubSchema): SyncClient {
    const dev = (name.toLowerCase() + '000000').slice(0, 6).replace(/[^0-9a-z]/g, '0')
    const c = new SyncClient({
      name,
      dev,
      wall: () => this.t + (this.skew.get(name) ?? 0),
      schema,
      rand: this.r.bytes,
      onWrite: (w) => this.writes.push(w),
      ...extra
    })
    this.clients.push(c)
    return c
  }

  hubDump(schema: TableDef[] = this.hubSchema, hub: Hub = this.hub): Record<string, string[]> {
    // Lectura directa de las tablas del hub, proyectada a `schema` (para
    // compararla con un cliente de esquema viejo).
    const out: Record<string, string[]> = {}
    for (const t of schema) {
      const full = mergeColumns(this.hubSchema.find((x) => x.name === t.name)!)
      const cols = mergeColumns(t)
      out[t.name] = hub.db
        .exec(`SELECT * FROM ${t.name} ORDER BY id`)
        .map((r) => `${r.id}|${canonical(project(decodeStored(r, full), cols), cols)}`)
    }
    return out
  }
}

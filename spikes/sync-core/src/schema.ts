// Esquema reducido de 4 tablas (§7.4), con las columnas comunes de §7.3.
// Simplificación del spike: `coverUrl` vive en `games` (en el diseño real está
// en `game_metadata`) para poder probar E-05 sin una quinta tabla.

import { createHash, randomBytes } from 'node:crypto'
import type { SqlValue } from './storage.ts'

export type ColType = 'TEXT' | 'INTEGER' | 'REAL'

export interface ColumnDef {
  name: string
  type: ColType
  default?: SqlValue
  notNull?: boolean
}

export interface TableDef {
  name: string
  columns: ColumnDef[]
  /** Clave foránea al padre (§7.7). Sin cascada: el borrado es lógico. */
  parent?: { column: string; table: string }
}

export const SYNC_COLS = ['syncCreated', 'syncUpdated', 'syncFields', 'syncDeleted'] as const

export const FULL_SCHEMA: TableDef[] = [
  {
    name: 'games',
    columns: [
      { name: 'title', type: 'TEXT' },
      { name: 'igdbId', type: 'INTEGER' },
      { name: 'notes', type: 'TEXT' },
      { name: 'coverUrl', type: 'TEXT' },
      { name: 'endless', type: 'INTEGER', default: 0 },
      { name: 'addedAt', type: 'INTEGER' }
    ]
  },
  {
    name: 'playthroughs',
    parent: { column: 'gameId', table: 'games' },
    columns: [
      { name: 'gameId', type: 'TEXT', notNull: true },
      { name: 'customLabel', type: 'TEXT' },
      { name: 'rating', type: 'INTEGER' },
      { name: 'manualHours', type: 'REAL', default: 0 }
    ]
  },
  {
    name: 'sessions',
    parent: { column: 'playthroughId', table: 'playthroughs' },
    columns: [
      { name: 'playthroughId', type: 'TEXT', notNull: true },
      { name: 'deviceId', type: 'TEXT', notNull: true },
      { name: 'startedAt', type: 'INTEGER' },
      { name: 'endedAt', type: 'INTEGER' },
      { name: 'durationSec', type: 'INTEGER' },
      { name: 'lastSeenAt', type: 'INTEGER' },
      { name: 'closedBy', type: 'TEXT' },
      { name: 'note', type: 'TEXT' }
    ]
  },
  {
    name: 'state_events',
    parent: { column: 'playthroughId', table: 'playthroughs' },
    columns: [
      { name: 'playthroughId', type: 'TEXT', notNull: true },
      { name: 'type', type: 'TEXT' },
      { name: 'occurredAt', type: 'INTEGER' },
      { name: 'note', type: 'TEXT' }
    ]
  }
]

/** Esquema "viejo" para E-14: le faltan columnas que el nuevo sí tiene. */
export function withoutColumns(schema: TableDef[], drop: Record<string, string[]>): TableDef[] {
  return schema.map((t) => ({
    ...t,
    columns: t.columns.filter((c) => !(drop[t.name] ?? []).includes(c.name))
  }))
}

export function tableDef(schema: TableDef[], name: string): TableDef | undefined {
  return schema.find((t) => t.name === name)
}

/** Columnas "de datos" que se fusionan: las propias + syncDeleted. */
export function mergeColumns(t: TableDef): string[] {
  return [...t.columns.map((c) => c.name), 'syncDeleted']
}

export function childrenOf(schema: TableDef[], table: string): TableDef[] {
  return schema.filter((t) => t.parent?.table === table)
}

function colSql(c: ColumnDef): string {
  const d = c.default === undefined ? '' : ` DEFAULT ${typeof c.default === 'string' ? `'${c.default}'` : c.default}`
  return `"${c.name}" ${c.type}${c.notNull ? ' NOT NULL' : ''}${d}`
}

export function ddlFor(t: TableDef, role: 'client' | 'hub'): string {
  const cols = [
    'id TEXT PRIMARY KEY',
    ...t.columns.map((c) => {
      // FK solo en el cliente. En el hub NO se declaran: el hub no puede
      // rechazar un hijo huérfano sin atascar al cliente (ver DECISIÓN D-5).
      if (role === 'client' && t.parent?.column === c.name)
        return `${colSql(c)} REFERENCES ${t.parent.table}(id) DEFERRABLE INITIALLY IMMEDIATE`
      return colSql(c)
    }),
    'syncCreated TEXT NOT NULL',
    'syncUpdated TEXT NOT NULL',
    "syncFields TEXT NOT NULL DEFAULT '{}'",
    'syncDeleted TEXT',
    role === 'client' ? 'syncDirty INTEGER NOT NULL DEFAULT 0' : 'syncSeq INTEGER NOT NULL'
  ]
  const idx =
    role === 'client'
      ? `CREATE INDEX IF NOT EXISTS ${t.name}_dirty ON ${t.name}(syncDirty) WHERE syncDirty = 1;`
      : `CREATE INDEX IF NOT EXISTS ${t.name}_seq ON ${t.name}(syncSeq);`
  const pidx = t.parent ? `CREATE INDEX IF NOT EXISTS ${t.name}_parent ON ${t.name}("${t.parent.column}");` : ''
  return `CREATE TABLE IF NOT EXISTS ${t.name} (\n  ${cols.join(',\n  ')}\n);\n${idx}\n${pidx}`
}

// ---------- Identificadores (§7.2) ----------

const NAMESPACE = '6f1c2a4e-0b7d-4c55-9a3e-1d2f3a4b5c6d' // fijo para Afterplay

function uuidBytesToString(b: Uint8Array): string {
  const h = Buffer.from(b).toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export function uuidv5(name: string, ns = NAMESPACE): string {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(nsBytes).update(name, 'utf8').digest()
  const b = new Uint8Array(hash.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  return uuidBytesToString(b)
}

/** UUIDv7. `rand` permite generarlo con una semilla en los tests. */
export function uuidv7(ms: number, rand: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  const b = new Uint8Array(16)
  const r = rand(10)
  let t = BigInt(Math.max(0, Math.floor(ms)))
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(t & 0xffn)
    t >>= 8n
  }
  b.set(r, 6)
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  return uuidBytesToString(b)
}

export function gameIdForIgdb(igdbId: number): string {
  return uuidv5(`igdb:${igdbId}`)
}

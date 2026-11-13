// Hub (`hub-core`): no importa nada de Cloudflare ni de Node; solo SqlStorage.

import { BOTTOM, type Clock, HybridClock, isClock, parseClock, successor } from './clock.ts'
import { canonical, decodeStored, encodeStored, mergeRows, project, type RowState, type WireRow } from './merge.ts'
import { ddlFor, mergeColumns, type TableDef } from './schema.ts'
import type { SqlStorage, SqlValue } from './storage.ts'

export const MAX_AHEAD_MS = 10 * 60 * 1000
export const ABANDONED_MS = 24 * 3600 * 1000

export interface HubStatus {
  hubId: string
  seq: number
  now: number
  protocolVersion: 1
}
export interface PushResult {
  accepted: string[]
  rejected: { key: string; reason: 'CLOCK_AHEAD' | 'BAD_ROW' | 'UNKNOWN_TABLE' }[]
  seq: number
  now: number
}
export interface PullResult {
  rows: WireRow[]
  next: number
  more: boolean
}

export interface HubApi {
  status(): HubStatus
  push(rows: WireRow[]): PushResult
  pull(since: number, limit: number): PullResult
}

export const rowKey = (table: string, id: string) => `${table}/${id}`

export interface HubOptions {
  hubId: string
  now: () => number
  maxAheadMs?: number
  /** Para el oráculo de los tests: escrituras propias del hub (barrido). */
  onWrite?: (w: { client: string; table: string; id: string; col: string; value: SqlValue; clock: Clock }) => void
}

export class Hub implements HubApi {
  readonly clock: HybridClock
  private readonly cols = new Map<string, string[]>()

  constructor(
    readonly db: SqlStorage,
    readonly schema: TableDef[],
    readonly opts: HubOptions
  ) {
    this.clock = new HybridClock('hubhub', opts.now)
    db.execScript(
      `CREATE TABLE IF NOT EXISTS tenant_meta (k TEXT PRIMARY KEY, v);\n` +
        schema.map((t) => ddlFor(t, 'hub')).join('\n')
    )
    if (!this.db.exec(`SELECT v FROM tenant_meta WHERE k='seq'`).length) {
      this.db.exec(`INSERT INTO tenant_meta(k, v) VALUES ('seq', 0), ('hubId', ?)`, opts.hubId)
    }
    for (const t of schema) this.cols.set(t.name, mergeColumns(t))
  }

  private get seq(): number {
    return this.db.exec(`SELECT v FROM tenant_meta WHERE k='seq'`)[0].v as number
  }

  status(): HubStatus {
    return { hubId: this.opts.hubId, seq: this.seq, now: this.opts.now(), protocolVersion: 1 }
  }

  /** Lee una fila en la forma explícita. */
  get(table: string, id: string): RowState | undefined {
    const cols = this.cols.get(table)!
    const r = this.db.exec(`SELECT * FROM ${table} WHERE id = ?`, id)[0]
    return r ? decodeStored(r, cols) : undefined
  }

  /** Fusiona una fila y, si cambió algo, le asigna la siguiente secuencia. */
  private applyOne(table: string, incoming: RowState): boolean {
    const cols = this.cols.get(table)!
    // Columnas que el hub no conoce (cliente más nuevo que el hub) se descartan:
    // la regla de despliegue (§8.7) dice que no debe pasar.
    const e = project(incoming, cols)
    const before = this.get(table, e.id)
    const merged = mergeRows(before, e)
    if (before && canonical(before, cols) === canonical(merged, cols)) return false
    const seq = this.seq + 1
    this.db.exec(`UPDATE tenant_meta SET v = ? WHERE k='seq'`, seq)
    const enc = encodeStored(merged, cols)
    const names = [...cols.filter((c) => c !== 'syncDeleted'), 'syncCreated', 'syncUpdated', 'syncFields', 'syncDeleted']
    const values = names.map((n) => (enc as Record<string, SqlValue>)[n])
    const upd = names.map((n) => `"${n}" = excluded."${n}"`).join(', ')
    this.db.exec(
      `INSERT INTO ${table} (id, ${names.map((n) => `"${n}"`).join(', ')}, syncSeq)
       VALUES (?, ${names.map(() => '?').join(', ')}, ?)
       ON CONFLICT(id) DO UPDATE SET ${upd}, syncSeq = excluded.syncSeq`,
      e.id,
      ...values,
      seq
    )
    for (const c of Object.values(merged.clocks)) this.clock.observe(c)
    return true
  }

  push(rows: WireRow[]): PushResult {
    const now = this.opts.now()
    const limit = now + (this.opts.maxAheadMs ?? MAX_AHEAD_MS)
    const res: PushResult = { accepted: [], rejected: [], seq: 0, now }
    this.db.transactionSync(() => {
      for (const r of rows) {
        const key = rowKey(r.table, r.id)
        if (!this.cols.has(r.table)) {
          res.rejected.push({ key, reason: 'UNKNOWN_TABLE' })
          continue
        }
        const clocks = [r.created, ...Object.values(r.clocks)]
        if (!clocks.every(isClock) || Object.keys(r.fields).some((c) => !(c in r.clocks))) {
          res.rejected.push({ key, reason: 'BAD_ROW' })
          continue
        }
        // §8.2: rechaza relojes adelantados más de 10 min respecto a la hora del hub.
        if (clocks.some((c) => c !== BOTTOM && parseClock(c).ms > limit)) {
          res.rejected.push({ key, reason: 'CLOCK_AHEAD' })
          continue
        }
        this.applyOne(r.table, r)
        res.accepted.push(key)
      }
    })
    res.seq = this.seq
    return res
  }

  pull(since: number, limit: number): PullResult {
    const union = this.schema.map((t) => `SELECT syncSeq FROM ${t.name} WHERE syncSeq > ?`).join(' UNION ALL ')
    const seqs = this.db.exec(`SELECT syncSeq FROM (${union}) ORDER BY syncSeq LIMIT ?`, ...this.schema.map(() => since), limit + 1)
    if (seqs.length === 0) return { rows: [], next: since, more: false }
    const page = seqs.slice(0, limit)
    const next = page[page.length - 1].syncSeq as number
    const rows: (WireRow & { seq: number })[] = []
    for (const t of this.schema) {
      const cols = this.cols.get(t.name)!
      for (const r of this.db.exec(`SELECT * FROM ${t.name} WHERE syncSeq > ? AND syncSeq <= ?`, since, next)) {
        rows.push({ table: t.name, seq: r.syncSeq as number, ...decodeStored(r, cols) })
      }
    }
    rows.sort((a, b) => a.seq - b.seq)
    return { rows: rows.map(({ seq: _s, ...w }) => w), next, more: seqs.length > limit }
  }

  /**
   * Barrido de sesiones abandonadas (§10.5).
   * mode 'hub-now'  = lo que dice el documento: el cierre se escribe con el reloj
   *                   del hub en el momento del barrido.  → PIERDE el cierre real
   *                   de un dueño que cerró offline (ver test H-3 / E-09).
   * mode 'low-clock' = DECISIÓN D-6: el cierre se escribe con el sucesor del
   *                   mayor reloj de los campos del dueño (su última señal), con un
   *                   id de dispositivo '000000'. Cualquier escritura posterior
   *                   del dueño — aunque la hiciera offline ANTES del barrido —
   *                   gana. Sigue ganando a "endedAt = null".
   */
  sweepAbandoned(mode: 'hub-now' | 'low-clock' = 'low-clock'): number {
    const now = this.opts.now()
    const cols = this.cols.get('sessions')!
    let n = 0
    this.db.transactionSync(() => {
      const open = this.db.exec(
        `SELECT * FROM sessions WHERE endedAt IS NULL AND syncDeleted IS NULL AND lastSeenAt IS NOT NULL AND lastSeenAt < ?`,
        now - ABANDONED_MS
      )
      for (const raw of open) {
        const r = decodeStored(raw, cols)
        const clock: Clock = mode === 'hub-now' ? this.clock.now() : successor(ownerBase(r), '000000')
        const lastSeen = r.fields.lastSeenAt as number
        const started = (r.fields.startedAt as number | null) ?? lastSeen
        const patch: RowState = {
          id: r.id,
          created: r.created,
          fields: { endedAt: lastSeen, durationSec: Math.max(0, Math.round((lastSeen - started) / 1000)), closedBy: 'janitor' },
          clocks: { endedAt: clock, durationSec: clock, closedBy: clock }
        }
        for (const c of Object.keys(patch.fields))
          this.opts.onWrite?.({ client: 'hub', table: 'sessions', id: r.id, col: c, value: patch.fields[c], clock })
        if (this.applyOne('sessions', patch)) n++
      }
    })
    return n
  }
}


/** Mayor reloj de los campos que solo escribe el dueño (§7.4 sessions). NO el
 *  mayor reloj de la fila: una nota editada en otro PC después no debe subir el
 *  reloj del barrido por encima de un cierre offline del dueño. */
function ownerBase(r: RowState): Clock {
  let m = r.created
  for (const c of ['startedAt', 'lastSeenAt', 'endedAt', 'durationSec', 'closedBy']) {
    const k = r.clocks[c]
    if (k && k > m) m = k
  }
  return m
}

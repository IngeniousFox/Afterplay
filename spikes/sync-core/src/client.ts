// Cliente: base local + puerta única de escritura (§8.6) + motor (§8.5).

import { BOTTOM, type Clock, HybridClock, parseClock } from './clock.ts'
import { type HubApi, MAX_AHEAD_MS, type PushResult, rowKey } from './hub.ts'
import { canonical, decodeStored, encodeStored, mergeRows, project, type RowState, valueKey, type WireRow } from './merge.ts'
import { childrenOf, ddlFor, mergeColumns, tableDef, type TableDef, uuidv7 } from './schema.ts'
import { NodeSqlStorage, type SqlStorage, type SqlValue } from './storage.ts'

export interface WriteLog {
  client: string
  table: string
  id: string
  col: string // '__created' para syncCreated
  value: SqlValue
  clock: Clock
  /** Reestampado tras reloj adelantado: esta escritura sustituye a la del reloj `replaces`. */
  replaces?: Clock
}

export interface ClientOptions {
  name: string
  dev: string
  wall: () => number
  schema: TableDef[]
  storage?: SqlStorage
  /**
   * 'off-during-pull' (DECISIÓN D-5): las FK no se comprueban al aplicar el pull;
   *   al terminar se cuenta lo huérfano con foreign_key_check (diagnóstico).
   * 'deferred-per-page': lo que dice §7.7 (FK diferidas a fin de transacción, y
   *   §8.5 dice una transacción por página). Se atasca: ver test H-4.
   */
  fkMode?: 'off-during-pull' | 'deferred-per-page'
  /** DECISIÓN D-1b: columnas no indicadas al crear llevan reloj BOTTOM. */
  bottomForDefaults?: boolean
  rand?: (n: number) => Uint8Array
  onWrite?: (w: WriteLog) => void
  /** Simula transporte JSON entre cliente y hub. */
  wire?: boolean
}

type Snapshot = { table: string; id: string; updated: Clock }

export class SyncClient {
  readonly db: SqlStorage
  readonly clock: HybridClock
  schema: TableDef[]
  private cols = new Map<string, string[]>()
  lastError: string | null = null
  orphans = 0
  stats = { pushed: 0, pulledRows: 0, pullPages: 0, applied: 0, recoveries: 0 }

  constructor(readonly opts: ClientOptions) {
    this.db = opts.storage ?? new NodeSqlStorage()
    this.schema = opts.schema
    this.db.execScript(
      `PRAGMA foreign_keys = ON;\nCREATE TABLE IF NOT EXISTS local_sync_state (k TEXT PRIMARY KEY, v);\n` +
        this.schema.map((t) => ddlFor(t, 'client')).join('\n')
    )
    this.refreshCols()
    // El reloj arranca por encima de todo lo que haya en la base (restaurar una
    // copia, reinicio): si no, una escritura local podría tener un reloj menor
    // que la fila que modifica y el "borrar syncDirty si syncUpdated no cambió"
    // dejaría de ser seguro.
    this.clock = new HybridClock(opts.dev, opts.wall, this.maxStoredClock() ?? undefined)
  }

  private refreshCols() {
    this.cols.clear()
    for (const t of this.schema) this.cols.set(t.name, mergeColumns(t))
  }

  get name() {
    return this.opts.name
  }

  private maxStoredClock(limitMs = Infinity): Clock | null {
    let m: Clock | null = null
    for (const t of this.schema) {
      for (const r of this.db.exec(`SELECT * FROM ${t.name}`)) {
        const row = decodeStored(r, this.cols.get(t.name)!)
        for (const c of [row.created, ...Object.values(row.clocks)]) {
          if (c === BOTTOM || parseClock(c).ms > limitMs) continue
          if (!m || c > m) m = c
        }
      }
    }
    return m
  }

  // ---------- estado local ----------

  private getState(k: string): SqlValue {
    return this.db.exec(`SELECT v FROM local_sync_state WHERE k = ?`, k)[0]?.v ?? null
  }
  private setState(k: string, v: SqlValue) {
    this.db.exec(`INSERT INTO local_sync_state(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v)
  }
  get cursor(): number {
    return (this.getState('cursor') as number | null) ?? 0
  }

  // ---------- lectura ----------

  read(table: string, id: string): RowState | undefined {
    const cols = this.cols.get(table)
    if (!cols) return undefined
    const r = this.db.exec(`SELECT * FROM ${table} WHERE id = ?`, id)[0]
    return r ? decodeStored(r, cols) : undefined
  }

  isDirty(table: string, id: string): boolean {
    return this.db.exec(`SELECT syncDirty FROM ${table} WHERE id = ?`, id)[0]?.syncDirty === 1
  }

  dirtyCount(): number {
    let n = 0
    for (const t of this.schema) n += this.db.exec(`SELECT count(*) n FROM ${t.name} WHERE syncDirty = 1`)[0].n as number
    return n
  }

  /** Regla de lectura de §7.7: un hijo cuyo padre (o abuelo) está borrado se trata como borrado. */
  isVisible(table: string, id: string): boolean {
    const def = tableDef(this.schema, table)!
    const r = this.read(table, id)
    if (!r || r.fields.syncDeleted !== null) return false
    if (!def.parent) return true
    const pid = r.fields[def.parent.column] as string | null
    return pid === null ? true : this.isVisible(def.parent.table, pid)
  }

  visibleIds(table: string): string[] {
    return this.db
      .exec(`SELECT id FROM ${table} ORDER BY id`)
      .map((r) => r.id as string)
      .filter((id) => this.isVisible(table, id))
  }

  /** Volcado canónico (sin syncDirty) para comparar réplicas. */
  dump(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const t of this.schema) {
      const cols = this.cols.get(t.name)!
      out[t.name] = this.db.exec(`SELECT * FROM ${t.name} ORDER BY id`).map((r) => `${r.id}|${canonical(decodeStored(r, cols), cols)}`)
    }
    return out
  }

  // ---------- puerta única de escritura (§8.6) ----------

  transaction<T>(fn: () => T): T {
    return this.db.transactionSync(fn)
  }

  private log(table: string, id: string, col: string, value: SqlValue, clock: Clock, replaces?: Clock) {
    this.opts.onWrite?.({ client: this.name, table, id, col, value, clock, replaces })
  }

  private writeRow(table: string, r: RowState, dirty: 0 | 1 | 'keep', only?: string[]) {
    const cols = this.cols.get(table)!
    const enc = encodeStored(r, cols) as Record<string, SqlValue>
    if (only) {
      // Escritura de la puerta sobre una fila existente: solo las columnas que
      // cambian. Escribir TODAS haría que SQLite comprobase la FK de una fila que
      // puede estar huérfana a mitad de un pull (padre en una página posterior)
      // y la edición del usuario fallaría (hallazgo de la prueba de convergencia).
      const set = [...only.filter((c) => c !== 'syncDeleted'), 'syncCreated', 'syncUpdated', 'syncFields', 'syncDeleted']
      this.db.exec(
        `UPDATE ${table} SET ${set.map((n) => `"${n}" = ?`).join(', ')}${dirty === 'keep' ? '' : `, syncDirty = ${dirty}`} WHERE id = ?`,
        ...set.map((n) => enc[n]),
        r.id
      )
      return
    }
    const names = [...cols.filter((c) => c !== 'syncDeleted'), 'syncCreated', 'syncUpdated', 'syncFields', 'syncDeleted']
    const upd = names.map((n) => `"${n}" = excluded."${n}"`).join(', ')
    // UPSERT y no INSERT OR REPLACE: REPLACE borra la fila y, con FK activas,
    // fallaría (o cascadearía) si tiene hijos.
    this.db.exec(
      `INSERT INTO ${table} (id, ${names.map((n) => `"${n}"`).join(', ')}, syncDirty)
       VALUES (?, ${names.map(() => '?').join(', ')}, ?)
       ON CONFLICT(id) DO UPDATE SET ${upd}${dirty === 'keep' ? '' : ', syncDirty = excluded.syncDirty'}`,
      r.id,
      ...names.map((n) => enc[n]),
      dirty === 'keep' ? 0 : dirty
    )
  }

  /** Alta. Con id determinista ya existente se comporta como "upsert" (y des-borra). */
  insert(table: string, values: Record<string, SqlValue>, id?: string): string {
    const def = tableDef(this.schema, table)
    if (!def) throw new Error(`tabla desconocida ${table}`)
    const rid = id ?? uuidv7(this.opts.wall(), this.opts.rand)
    this.transaction(() => {
      const existing = this.read(table, rid)
      if (existing) {
        const patch = { ...values }
        if (existing.fields.syncDeleted !== null) patch.syncDeleted = null
        this.writeCells(table, existing, patch)
        return
      }
      const clock = this.clock.now()
      const r: RowState = { id: rid, created: clock, fields: {}, clocks: {} }
      for (const c of def.columns) {
        if (c.name in values) {
          r.fields[c.name] = values[c.name]
          r.clocks[c.name] = clock
          this.log(table, rid, c.name, values[c.name], clock)
        } else {
          r.fields[c.name] = c.default ?? null
          // D-1b: con `bottomForDefaults` (por defecto) lo no indicado no "se escribe".
          r.clocks[c.name] = this.opts.bottomForDefaults === false ? clock : BOTTOM
          if (this.opts.bottomForDefaults === false) this.log(table, rid, c.name, r.fields[c.name], clock)
        }
      }
      // syncDeleted SÍ lleva el reloj de creación: volver a añadir un juego
      // borrado (id determinista) lo resucita (DECISIÓN D-4).
      r.fields.syncDeleted = null
      r.clocks.syncDeleted = clock
      this.log(table, rid, 'syncDeleted', null, clock)
      this.log(table, rid, '__created', null, clock)
      this.writeRow(table, r, 1)
    })
    return rid
  }

  update(table: string, id: string, patch: Record<string, SqlValue>): boolean {
    return this.transaction(() => {
      const existing = this.read(table, id)
      if (!existing) throw new Error(`no existe ${table}/${id}`)
      return this.writeCells(table, existing, patch)
    })
  }

  private writeCells(table: string, row: RowState, patch: Record<string, SqlValue>): boolean {
    const cols = this.cols.get(table)!
    const changed = Object.keys(patch).filter((c) => cols.includes(c) && valueKey(patch[c]) !== valueKey(row.fields[c]))
    if (changed.length === 0) return false
    const clock = this.clock.now()
    for (const c of changed) {
      row.fields[c] = patch[c]
      row.clocks[c] = clock
      this.log(table, row.id, c, patch[c], clock)
    }
    this.writeRow(table, row, 1, changed)
    return true
  }

  /** Borrado lógico + marca a los hijos en la misma transacción (§7.7). */
  remove(table: string, id: string): void {
    this.transaction(() => {
      const clock = this.clock.now()
      this.tombstone(table, id, clock)
    })
  }

  private tombstone(table: string, id: string, clock: Clock) {
    const row = this.read(table, id)
    if (!row || row.fields.syncDeleted !== null) return
    row.fields.syncDeleted = clock
    row.clocks.syncDeleted = clock
    this.log(table, id, 'syncDeleted', clock, clock)
    this.writeRow(table, row, 1, [])
    for (const child of childrenOf(this.schema, table)) {
      for (const c of this.db.exec(`SELECT id FROM ${child.name} WHERE "${child.parent!.column}" = ? AND syncDeleted IS NULL`, id)) {
        this.tombstone(child.name, c.id as string, clock)
      }
    }
  }

  // ---------- motor (§8.5) ----------

  private wire<T>(x: T): T {
    return this.opts.wire === false ? x : (JSON.parse(JSON.stringify(x)) as T)
  }

  /** Comprueba el hub: si es otro (o ha retrocedido), resube todo y baja desde 0 (E-24). */
  checkHub(hub: HubApi): void {
    const st = this.wire(hub.status())
    const known = this.getState('hubId')
    if (known !== st.hubId || this.cursor > st.seq) {
      this.transaction(() => {
        for (const t of this.schema) this.db.exec(`UPDATE ${t.name} SET syncDirty = 1`)
        this.setState('cursor', 0)
        this.setState('hubId', st.hubId)
      })
    }
  }

  /** Fase 1 de la subida: lee filas sucias (padres primero) y anota su syncUpdated. */
  preparePush(limit: number, pos: { t: number; id: string } = { t: 0, id: '' }) {
    const rows: WireRow[] = []
    const snap: Snapshot[] = []
    while (pos.t < this.schema.length && rows.length < limit) {
      const t = this.schema[pos.t]
      const cols = this.cols.get(t.name)!
      const got = this.db.exec(`SELECT * FROM ${t.name} WHERE syncDirty = 1 AND id > ? ORDER BY id LIMIT ?`, pos.id, limit - rows.length)
      for (const r of got) {
        rows.push({ table: t.name, ...decodeStored(r, cols) })
        snap.push({ table: t.name, id: r.id as string, updated: r.syncUpdated as Clock })
        pos.id = r.id as string
      }
      if (rows.length < limit) {
        pos.t++
        pos.id = ''
      }
    }
    return { rows, snap, pos }
  }

  /** Fase 2: limpia syncDirty SOLO si la fila no ha vuelto a cambiar (syncUpdated igual). */
  ackPush(snap: Snapshot[], res: PushResult): void {
    const ok = new Set(res.accepted)
    this.transaction(() => {
      for (const s of snap) {
        if (!ok.has(rowKey(s.table, s.id))) continue
        this.db.exec(`UPDATE ${s.table} SET syncDirty = 0 WHERE id = ? AND syncUpdated = ?`, s.id, s.updated)
      }
    })
    this.stats.pushed += res.accepted.length
  }

  push(hub: HubApi, limit = 500): PushResult[] {
    const results: PushResult[] = []
    let pos = { t: 0, id: '' }
    let clockAhead = false
    let hubNow = 0
    for (;;) {
      const b = this.preparePush(limit, pos)
      pos = b.pos
      if (b.rows.length === 0) break
      const res = this.wire(hub.push(this.wire(b.rows)))
      results.push(res)
      this.ackPush(b.snap, res)
      hubNow = res.now
      if (res.rejected.some((r) => r.reason === 'CLOCK_AHEAD')) clockAhead = true
    }
    if (clockAhead) {
      this.lastError = 'CLOCK_AHEAD: el reloj de este PC está adelantado'
      // Solo se recupera si el reloj de pared YA es razonable respecto al hub.
      if (this.opts.wall() <= hubNow + MAX_AHEAD_MS && this.recoverFromClockAhead(hubNow) > 0) {
        this.lastError = null
        results.push(...this.push(hub, limit))
      }
    }
    return results
  }

  /**
   * DECISIÓN D-7: tras un rechazo CLOCK_AHEAD y con el reloj de pared ya
   * corregido, el reloj híbrido sigue "en el futuro" (es monótono y recuerda sus
   * propias escrituras). Se reinicia al mayor reloj admisible de la base y se
   * re-estampan con la hora actual las celdas sucias con reloj futuro. Es seguro:
   * esas celdas nunca salieron de este PC (el hub las rechazó).
   */
  recoverFromClockAhead(hubNow: number): number {
    const limit = hubNow + MAX_AHEAD_MS
    let n = 0
    this.transaction(() => {
      this.clock.resetTo(this.maxStoredClock(limit))
      for (const t of this.schema) {
        const cols = this.cols.get(t.name)!
        for (const raw of this.db.exec(`SELECT * FROM ${t.name} WHERE syncDirty = 1`)) {
          const r = decodeStored(raw, cols)
          const future = (c: Clock) => c !== BOTTOM && parseClock(c).ms > limit
          if (!future(r.created) && !Object.values(r.clocks).some(future)) continue
          const fresh = this.clock.now()
          if (future(r.created)) {
            this.log(t.name, r.id, '__created', null, fresh, r.created)
            r.created = fresh
          }
          for (const c of Object.keys(r.clocks)) {
            if (!future(r.clocks[c])) continue
            if (c === 'syncDeleted' && r.fields.syncDeleted !== null) r.fields.syncDeleted = fresh
            this.log(t.name, r.id, c, r.fields[c], fresh, r.clocks[c])
            r.clocks[c] = fresh
          }
          this.writeRow(t.name, r, 1, [])
          n++
        }
      }
    })
    this.stats.recoveries++
    return n
  }

  /** Baja UNA página y la aplica en una transacción junto con el cursor. */
  pullPage(hub: HubApi, limit = 1000): boolean {
    const res = this.wire(hub.pull(this.cursor, limit))
    const fkOff = (this.opts.fkMode ?? 'off-during-pull') === 'off-during-pull'
    if (fkOff) this.db.exec('PRAGMA foreign_keys = OFF')
    try {
      this.transaction(() => {
        if (!fkOff) this.db.exec('PRAGMA defer_foreign_keys = ON')
        for (const w of res.rows) {
          const cols = this.cols.get(w.table)
          if (!cols) continue // tabla que este cliente no conoce (§8.7)
          const incoming = project(w, cols)
          const local = this.read(w.table, w.id)
          const merged = mergeRows(local, incoming)
          for (const c of Object.values(w.clocks)) this.clock.observe(c)
          this.clock.observe(w.created)
          if (local && canonical(local, cols) === canonical(merged, cols)) continue // eco
          this.writeRow(w.table, merged, 'keep')
          this.stats.applied++
        }
        this.setState('cursor', res.next)
      })
    } finally {
      if (fkOff) this.db.exec('PRAGMA foreign_keys = ON')
    }
    this.stats.pulledRows += res.rows.length
    this.stats.pullPages++
    if (!res.more && fkOff) this.orphans = this.db.exec('PRAGMA foreign_key_check').length
    return res.more
  }

  pull(hub: HubApi, limit = 1000, maxPages = Infinity): void {
    let pages = 0
    while (pages++ < maxPages && this.pullPage(hub, limit)) {
      /* sigue */
    }
  }

  sync(hub: HubApi, opts: { pushLimit?: number; pullLimit?: number } = {}): void {
    this.checkHub(hub)
    this.push(hub, opts.pushLimit)
    this.pull(hub, opts.pullLimit)
  }

  /**
   * Actualización de esquema (cliente viejo → nuevo, §8.7): añade columnas y
   * pone el cursor a 0. `stampBottom` (DECISIÓN D-9): las filas existentes
   * reciben reloj BOTTOM en las columnas nuevas; sin ello su valor por defecto
   * hereda el reloj implícito syncCreated y EMPATA con el valor real (test H-6).
   */
  upgradeSchema(newSchema: TableDef[], stampBottom: boolean): void {
    this.transaction(() => {
      for (const t of newSchema) {
        const old = tableDef(this.schema, t.name)
        if (!old) {
          this.db.execScript(ddlFor(t, 'client'))
          continue
        }
        const added = t.columns.filter((c) => !old.columns.some((o) => o.name === c.name))
        for (const c of added) {
          const d = c.default === undefined ? '' : ` DEFAULT ${typeof c.default === 'string' ? `'${c.default}'` : c.default}`
          this.db.execScript(`ALTER TABLE ${t.name} ADD COLUMN "${c.name}" ${c.type}${d}`)
        }
        if (stampBottom && added.length) {
          for (const r of this.db.exec(`SELECT id, syncFields FROM ${t.name}`)) {
            const sf = JSON.parse(r.syncFields as string) as Record<string, Clock>
            for (const c of added) sf[c.name] = BOTTOM
            const sorted: Record<string, Clock> = {}
            for (const k of Object.keys(sf).sort()) sorted[k] = sf[k]
            this.db.exec(`UPDATE ${t.name} SET syncFields = ? WHERE id = ?`, JSON.stringify(sorted), r.id as string)
          }
        }
      }
      this.schema = newSchema
      this.refreshCols()
      this.setState('cursor', 0)
    })
  }
}

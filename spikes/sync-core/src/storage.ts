// Interfaz de almacenamiento SQL SÍNCRONA y mínima.
//
// Está calcada sobre lo que ofrece el SQLite de un Durable Object:
//   ctx.storage.sql.exec(query, ...bindings)  -> cursor (síncrono)
//   ctx.storage.transactionSync(fn)           -> transacción síncrona
// El núcleo (merge, hub, cliente) solo habla con esta interfaz, de modo que el
// adaptador de DO sea una envoltura de ~10 líneas (cursor.toArray()).

import { DatabaseSync, type StatementSync } from 'node:sqlite'

export type SqlValue = string | number | null
export type SqlRow = Record<string, SqlValue>

export interface SqlStorage {
  /** Ejecuta UNA sentencia con parámetros posicionales y devuelve sus filas. */
  exec(sql: string, ...params: SqlValue[]): SqlRow[]
  /** Ejecuta varias sentencias sin parámetros (DDL). */
  execScript(sql: string): void
  /** Transacción síncrona; anidable (las internas son SAVEPOINT). */
  transactionSync<T>(fn: () => T): T
}

/** Adaptador de Node con `node:sqlite` (DatabaseSync). En memoria por defecto. */
export class NodeSqlStorage implements SqlStorage {
  readonly db: DatabaseSync
  private readonly cache = new Map<string, StatementSync>()
  private depth = 0

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path)
  }

  exec(sql: string, ...params: SqlValue[]): SqlRow[] {
    let st = this.cache.get(sql)
    if (!st) {
      st = this.db.prepare(sql)
      this.cache.set(sql, st)
    }
    return st.all(...params) as SqlRow[]
  }

  execScript(sql: string): void {
    // Tras un ALTER TABLE, un `SELECT *` ya preparado sigue devolviendo las
    // columnas antiguas en node:sqlite: se vacía la caché de sentencias.
    this.cache.clear()
    this.db.exec(sql)
  }

  transactionSync<T>(fn: () => T): T {
    const sp = `sp${this.depth}`
    if (this.depth === 0) this.db.exec('BEGIN')
    else this.db.exec(`SAVEPOINT ${sp}`)
    this.depth++
    const outer = this.depth === 1
    try {
      const r = fn()
      if (outer) this.db.exec('COMMIT')
      else this.db.exec(`RELEASE ${sp}`)
      this.depth--
      return r
    } catch (e) {
      this.depth--
      if (outer) {
        // Si el COMMIT falló (p. ej. FK diferida), la transacción puede seguir abierta.
        try {
          this.db.exec('ROLLBACK')
        } catch {
          /* ya cerrada */
        }
      } else {
        this.db.exec(`ROLLBACK TO ${sp}`)
        this.db.exec(`RELEASE ${sp}`)
      }
      throw e
    }
  }
}

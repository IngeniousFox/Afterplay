// Adaptador de `SqlStorage` sobre `node:sqlite` (§9.6, §17.2). En memoria por
// defecto o en fichero. Lo usan los tests del hub y el arnés de convergencia;
// es, de paso, la mitad de un hub autoalojado (D-19).
//
// Todo lo que importa `node:` vive bajo `hub/core/node/` para que el build del
// Worker no lo arrastre nunca.

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { SqlRow, SqlStorage, SqlValue } from '../storage';

const SCHEMA_CHANGE = /^\s*(ALTER|CREATE|DROP)\b/i;

export class NodeSqlStorage implements SqlStorage {
  readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
  }

  exec(sql: string, ...params: SqlValue[]): SqlRow[] {
    // Tras un ALTER TABLE, un `SELECT *` ya preparado sigue devolviendo las
    // columnas antiguas en node:sqlite: ante cualquier cambio de esquema se
    // vacía la caché de sentencias preparadas.
    if (SCHEMA_CHANGE.test(sql)) this.statements.clear();
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement.all(...params) as SqlRow[];
  }

  execScript(sql: string): void {
    this.statements.clear();
    this.db.exec(sql);
  }

  /**
   * Transacción síncrona. La más externa es BEGIN/COMMIT; las anidadas son
   * SAVEPOINT, como la `transactionSync` anidable de un Durable Object.
   */
  transactionSync<T>(fn: () => T): T {
    const savepoint = `sp${this.depth}`;
    const outer = this.depth === 0;
    this.db.exec(outer ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    this.depth++;
    try {
      const result = fn();
      this.db.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
      this.depth--;
      return result;
    } catch (error) {
      this.depth--;
      try {
        if (outer) this.db.exec('ROLLBACK');
        else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      } catch {
        // La transacción ya estaba cerrada (p. ej. falló el COMMIT).
      }
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

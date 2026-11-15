// Adaptador de `SqlStorage` (hub/core/storage.ts) sobre el SQLite de un Durable
// Object (§9.6). No importa `cloudflare:workers`: pide solo la forma mínima de
// `ctx.storage`, que es lo que permite probarlo con un doble en Node.

import type { SqlRow, SqlStorage, SqlValue } from '../../../core/storage';

/** Lo que usamos de `SqlStorage` de Cloudflare (el cursor devuelto por `exec`). */
export interface DoSqlCursorLike {
  toArray(): Record<string, unknown>[];
}

/** Lo que usamos de `ctx.storage`. */
export interface DoStorageLike {
  sql: { exec(query: string, ...bindings: unknown[]): DoSqlCursorLike };
  transactionSync<T>(closure: () => T): T;
}

/**
 * Parte un script DDL en sentencias. Sabe de comillas simples, dobles y
 * acentos graves, y de comentarios de línea y de bloque; no entiende `CREATE TRIGGER`
 * (su `;` interior): el hub no los usa, y si algún día los usa hay que
 * rehacer esto. Se parte aquí en vez de confiar en que `exec` acepte varias
 * sentencias a la vez, que la documentación de Cloudflare no promete para
 * parámetros y que no hemos podido comprobar en un runtime real.
 */
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    const next = script[i + 1];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < script.length && script[i] !== '\n') i++;
      current += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = script.indexOf('*/', i + 2);
      i = end === -1 ? script.length : end + 1;
      current += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';') {
      if (current.trim() !== '') out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

export class DoSqlStorage implements SqlStorage {
  constructor(private readonly storage: DoStorageLike) {}

  exec(sql: string, ...params: SqlValue[]): SqlRow[] {
    // `toArray()` agota el cursor: es lo que ejecuta y factura la sentencia.
    return this.storage.sql.exec(sql, ...params).toArray() as SqlRow[];
  }

  execScript(sql: string): void {
    for (const statement of splitStatements(sql)) this.storage.sql.exec(statement).toArray();
  }

  /**
   * Un DO no admite BEGIN ni SAVEPOINT escritos a mano: usa `transactionSync`,
   * que se puede anidar (la interna se une a la externa) y deshace todo si
   * `fn` lanza.
   */
  transactionSync<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
}

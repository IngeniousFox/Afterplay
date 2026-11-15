// Almacenamiento SQL SÍNCRONO que necesita el núcleo del hub (§9.6).
//
// Está calcado sobre lo que ofrece el SQLite de un Durable Object, para que su
// adaptador sea una envoltura de pocas líneas:
//
//   exec(sql, ...p)      -> ctx.storage.sql.exec(sql, ...p).toArray()
//   execScript(sql)      -> ctx.storage.sql.exec(sql)   (varias sentencias, sin parámetros)
//   transactionSync(fn)  -> ctx.storage.transactionSync(fn)
//
// Este fichero NO importa nada de Cloudflare ni de Node. El adaptador de Node
// (`node/nodeStorage.ts`) y el de Durable Object (en `hub/worker/`) implementan
// esta interfaz; el núcleo solo habla con ella.
//
// Límites de la API SQL de un Durable Object que el núcleo respeta (§8.4):
// 100 parámetros y 100.000 bytes por sentencia. Quien escriba sentencias nuevas
// aquí debe contar parámetros y trocear las listas largas (`chunk`).

import type { SqlRow, SqlValue } from '../../src/shared/sync/merge';

export type { SqlRow, SqlValue };

export interface SqlStorage {
  /** Ejecuta UNA sentencia con parámetros posicionales y devuelve todas sus filas. */
  exec(sql: string, ...params: SqlValue[]): SqlRow[];
  /** Ejecuta varias sentencias sin parámetros (DDL). */
  execScript(sql: string): void;
  /** Transacción síncrona. Si `fn` lanza, se deshace todo. Anidable. */
  transactionSync<T>(fn: () => T): T;
}

/** Máximo de parámetros por sentencia en un Durable Object. */
export const MAX_SQL_PARAMS = 100;

/** Tamaño de trozo para las búsquedas `id IN (...)`: 99, como dice §8.4. */
export const ID_CHUNK = 99;

/** Parte una lista en trozos de como mucho `size` elementos. */
export function chunk<T>(items: readonly T[], size: number = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

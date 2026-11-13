import type { LocalDatabase } from '../../connection';
import type { LocalDb, WriteStore } from '../../store';

// El contexto de todas las consultas 2.0 (src/main/db/v2/CONSULTAS.md §4).
//
// Toda consulta es una función SÍNCRONA que recibe esto como primer argumento.
// Nada de `getDb()` global: el driver es síncrono y la conexión es una sola
// para todo el proceso (AFTERPLAY-2.0.md §8.9), así que no hay conexión que
// cambiar en caliente ni candado que pedir, y pasarla explícita deja que cada
// test abra su base en memoria sin trucos de módulos.

export interface QueryContext {
  /** Solo LECTURAS en tablas sincronizadas (lo vigila writeBarrier.test.ts). */
  readonly db: LocalDb;
  /** La puerta única de escritura (§8.6). Única vía para escribir lo sincronizado. */
  readonly store: WriteStore;
  /** El `machineId` de este PC (D-11): el mismo con el que se abrió `store`. */
  readonly deviceId: string;
  /**
   * La hora de pared para los valores de dominio que escribe una consulta
   * (`addedAt`, `checkedAt`, `lastVerifiedAt`…). Inyectable para que los tests
   * sean deterministas; en la app es `() => new Date()`. Nunca `new Date()`
   * suelto dentro de una consulta.
   */
  readonly now: () => Date;
}

export interface CreateQueryContextOptions {
  /** Por defecto, `() => new Date()`. Los tests pasan su reloj falso. */
  readonly now?: () => Date;
}

/** El contexto a partir de la base abierta con `openLocalDatabase`. */
export function createQueryContext(
  local: Pick<LocalDatabase, 'db' | 'store' | 'deviceId'>,
  options: CreateQueryContextOptions = {},
): QueryContext {
  return {
    db: local.db,
    store: local.store,
    deviceId: local.deviceId,
    now: options.now ?? (() => new Date()),
  };
}

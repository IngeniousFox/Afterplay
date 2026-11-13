import type { DatabaseSync } from 'node:sqlite';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import type { Registry, SyncedTableName } from '../registry';
import type { SYNC_COLUMN_NAMES } from '../schema';

// Tipos públicos de la puerta de escritura. Salen de los tipos de fila de
// Drizzle a través del registro: `create('games', …)` exige las columnas de
// `games` con sus tipos de verdad (Date, boolean, el tipo del JSON…), nunca
// `any`.

/** La base Drizzle sobre `node:sqlite` (driver síncrono, §8.9). */
export type LocalDb = NodeSQLiteDatabase & { $client: DatabaseSync };

/** Las columnas de §7.3 (más `id`): solo las escribe la puerta. */
export type SyncColumnName = (typeof SYNC_COLUMN_NAMES)[number];

export type SyncedTableOf<N extends SyncedTableName> = Registry[N]['table'];

/** Fila tal como la devuelve Drizzle al leer. */
export type RowOf<N extends SyncedTableName> = SyncedTableOf<N>['$inferSelect'];

type InsertOf<N extends SyncedTableName> = SyncedTableOf<N>['$inferInsert'];

/** Columnas de datos de una tabla (sin las de §7.3). */
export type DataColumnOf<N extends SyncedTableName> = Exclude<keyof RowOf<N>, SyncColumnName> &
  string;

/**
 * Valores para crear una fila. Las columnas NOT NULL sin DEFAULT son
 * obligatorias (como en Drizzle). Lo que no se indica lleva reloj `BOTTOM`
 * (H-2): indicar `null` NO es lo mismo que omitir (ver `WriteStore.create`).
 *
 * `id` solo hace falta en las tablas de id `given` (`devices`); en las de id
 * determinista o compuesto, si se indica, debe coincidir con el calculado, y
 * en las aleatorias debe ser un UUID (el importador fecha los suyos).
 */
export type CreateValues<N extends SyncedTableName> = Omit<InsertOf<N>, SyncColumnName> & {
  id?: string;
};

/** Cambios de un parche: solo columnas de datos; `undefined` = no tocar. */
export type PatchValues<N extends SyncedTableName> = Partial<Omit<InsertOf<N>, SyncColumnName>>;

export type CreateOutcome =
  /** Fila nueva. */
  | 'created'
  /** Ya existía (id determinista o compuesto) y algún valor cambió. */
  | 'updated'
  /** Tenía lápida y vuelve a estar viva (§8.3.3). Sus hijos siguen borrados. */
  | 'resurrected'
  /** Ya existía viva con esos mismos valores: no se escribió nada. */
  | 'unchanged';

export interface CreateResult<N extends SyncedTableName> {
  readonly id: string;
  readonly outcome: CreateOutcome;
  /** Columnas que recibieron reloj (en una fila nueva, las indicadas). */
  readonly changed: readonly DataColumnOf<N>[];
}

export interface PatchResult<N extends SyncedTableName> {
  /** Columnas que cambiaron de valor. Vacío = no se escribió nada. */
  readonly changed: readonly DataColumnOf<N>[];
}

export interface RowRef {
  readonly table: SyncedTableName;
  readonly id: string;
}

export interface RemoveResult {
  /** Filas que recibieron lápida (la pedida y su cascada). Vacío si ya la tenía. */
  readonly removed: readonly RowRef[];
  /** Filas a las que se anuló una referencia (`nullify` del registro). */
  readonly nullified: readonly (RowRef & { readonly columns: readonly string[] })[];
}

/**
 * Aviso de cambios confirmados (base de `DataChanged`, §15.4, y del "sync 2 s
 * después del último cambio", §8.5). Se emite una vez por transacción
 * confirmada, con todas las tablas e ids tocados; nunca por una que se
 * deshace.
 */
export interface StoreChange {
  readonly tables: readonly SyncedTableName[];
  readonly ids: Readonly<Partial<Record<SyncedTableName, readonly string[]>>>;
}

export type StoreChangeListener = (change: StoreChange) => void;

import { getTableConfig, type SQLiteColumn, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { SYNC_COLUMN_NAMES } from '../schema';
import { StoreError } from './errors';

// Lo que la puerta necesita saber de cada columna para validar y normalizar
// valores (§8.6).
//
// La regla de oro: `sameValue` (src/shared/sync/fieldClocks.ts) decide qué
// columnas reciben reloj nuevo y considera distintos los tipos distintos (un
// `Date` frente a sus milisegundos, `true` frente a `1`). Si el parche llegase
// en una forma y la fila leída en otra, toda columna "cambiaría" en cada
// parche y volvería F-33 (el refresco reescribiendo la biblioteca). Por eso
// la puerta compara SIEMPRE en la forma en que Drizzle devuelve la fila al
// leer, y convierte el parche a esa forma haciéndolo pasar por el mismo
// camino de ida y vuelta que hará en la base (`mapToDriverValue` y
// `mapFromDriverValue` de la propia columna): un JSON pierde las claves
// `undefined` y se compara ya parseado, una fecha se compara como `Date`
// truncada a lo que guarda la columna, etc.

export type ColumnKind = 'text' | 'enum' | 'integer' | 'real' | 'boolean' | 'timestamp' | 'json';

export interface ColumnInfo {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly notNull: boolean;
  /** Tiene DEFAULT en el esquema (Drizzle lo escribe si no se indica). */
  readonly hasDefault: boolean;
  readonly enumValues: readonly string[] | undefined;
  readonly column: SQLiteColumn;
}

export interface TableInfo {
  readonly name: string;
  /** Columnas de datos: todas menos las de §7.3, en el orden del esquema. */
  readonly dataColumns: readonly string[];
  readonly columns: ReadonlyMap<string, ColumnInfo>;
  /** Objetos de columna de las de §7.3 que la puerta usa en sus consultas. */
  readonly idColumn: SQLiteColumn;
  readonly deletedColumn: SQLiteColumn;
}

const SYNC_COLUMNS = new Set<string>(SYNC_COLUMN_NAMES);

export const isSyncColumn = (name: string): boolean => SYNC_COLUMNS.has(name);

const kindOf = (column: SQLiteColumn, table: string): ColumnKind => {
  switch (column.columnType) {
    case 'SQLiteText':
      return column.enumValues && column.enumValues.length > 0 ? 'enum' : 'text';
    case 'SQLiteTextJson':
      return 'json';
    case 'SQLiteInteger':
      return 'integer';
    case 'SQLiteReal':
      return 'real';
    case 'SQLiteBoolean':
      return 'boolean';
    case 'SQLiteTimestamp':
      return 'timestamp';
    default:
      // Un tipo nuevo en el esquema tiene que pasar por aquí antes de usarse:
      // sin saber cómo se lee, la puerta no puede comparar sus valores.
      throw new Error(
        `${table}.${column.name}: tipo de columna no soportado (${column.columnType})`,
      );
  }
};

const cache = new WeakMap<SQLiteTable, TableInfo>();

export function tableInfo(table: SQLiteTable): TableInfo {
  const cached = cache.get(table);
  if (cached) return cached;
  const config = getTableConfig(table);
  const columns = new Map<string, ColumnInfo>();
  let idColumn: SQLiteColumn | undefined;
  let deletedColumn: SQLiteColumn | undefined;
  for (const column of config.columns) {
    if (column.name === 'id') idColumn = column;
    if (column.name === 'syncDeleted') deletedColumn = column;
    if (isSyncColumn(column.name)) continue;
    columns.set(column.name, {
      name: column.name,
      kind: kindOf(column, config.name),
      notNull: column.notNull,
      hasDefault: column.hasDefault,
      enumValues: column.enumValues,
      column,
    });
  }
  if (!idColumn || !deletedColumn) {
    throw new Error(`${config.name}: no es una tabla sincronizada (faltan columnas de §7.3)`);
  }
  const info: TableInfo = {
    name: config.name,
    dataColumns: [...columns.keys()],
    columns,
    idColumn,
    deletedColumn,
  };
  cache.set(table, info);
  return info;
}

const describe = (value: unknown): string => {
  if (value instanceof Date) return `Date(${value.getTime()})`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const invalid = (table: string, column: ColumnInfo, value: unknown, expected: string): never => {
  throw new StoreError(
    'invalid_value',
    `${table}.${column.name}: se esperaba ${expected} y llegó ${describe(value)}`,
  );
};

/**
 * Valida un valor que no es null para la columna. Es estricta a propósito:
 * aceptar `5` en un booleano o milisegundos en una fecha "funcionaría" (la
 * columna los convierte), pero esconde errores de quien llama y el valor
 * escrito ya no sería el que creía escribir.
 */
function validate(table: string, column: ColumnInfo, value: unknown): void {
  switch (column.kind) {
    case 'text':
      if (typeof value !== 'string') invalid(table, column, value, 'un texto');
      return;
    case 'enum':
      if (typeof value !== 'string' || !column.enumValues?.includes(value)) {
        invalid(table, column, value, `uno de ${column.enumValues?.join(' | ')}`);
      }
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        invalid(table, column, value, 'un entero');
      }
      return;
    case 'real':
      // `node:sqlite` guarda NaN como NULL sin avisar: se perdería el dato y
      // la columna NOT NULL fallaría lejos de aquí.
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalid(table, column, value, 'un número finito');
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') invalid(table, column, value, 'un booleano');
      return;
    case 'timestamp':
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        invalid(table, column, value, 'una fecha (Date) válida');
      }
      return;
    case 'json': {
      let text: string | undefined;
      try {
        text = JSON.stringify(value);
      } catch {
        text = undefined;
      }
      // `undefined` = no serializable (una función, un símbolo). Un JSON que
      // no vuelve igual tras guardarse no se puede comparar con lo leído.
      if (typeof text !== 'string') invalid(table, column, value, 'un valor JSON');
      return;
    }
  }
}

/**
 * Valor normalizado a la forma en que Drizzle lo devolverá al leer la fila.
 * `null` se queda en `null` (la obligatoriedad la comprueba quien llama, que
 * sabe si es una creación o un parche).
 */
export function normalizeValue(table: string, column: ColumnInfo, value: unknown): unknown {
  if (value === null) return null;
  validate(table, column, value);
  const driver: unknown = column.column.mapToDriverValue(value);
  return column.column.mapFromDriverValue(driver);
}

/**
 * Normaliza un objeto de valores de una tabla. Las claves con `undefined` se
 * descartan ("no tocar", como en el ORM). Falla con las claves que no son
 * columnas de datos: entre ellas las de §7.3, que solo escribe la puerta.
 */
export function normalizeValues(
  info: TableInfo,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const column = info.columns.get(name);
    if (!column) {
      const why = isSyncColumn(name)
        ? ' (columna de sincronización: solo la escribe la puerta)'
        : '';
      throw new StoreError(
        'unknown_column',
        `${info.name}.${name}: no es una columna de datos${why}`,
      );
    }
    out[name] = normalizeValue(info.name, column, value);
  }
  return out;
}

import { is, SQL } from 'drizzle-orm';
import type { SqlValue, TableShape } from '../../shared/sync/merge';
import { syncedEntries } from '../db/v2/registry';
import { tableInfo, type ColumnInfo } from '../db/v2/store/columns';

// Lo que el motor de sync necesita saber de cada tabla sincronizada para leer
// y escribir filas CRUDAS (valores de SQLite, sin pasar por Drizzle): sus
// columnas de datos, los valores por defecto de las que lo tienen y las
// sentencias SQL que se preparan una vez.
//
// Todo sale del esquema y del registro, no de listas escritas a mano: una
// tabla o columna nueva (migración aditiva, §8.7) se sincroniza sola.

export interface SyncTable {
  readonly name: string;
  readonly shape: TableShape;
  /** Columnas NOT NULL sin DEFAULT: una fila entrante que las traiga a null no se aplica. */
  readonly required: readonly string[];
  /** Columnas que escribe el UPSERT, en orden: id, datos, §7.3 (sin `syncDirty`). */
  readonly writeColumns: readonly string[];
  readonly selectDirtySql: string;
  readonly selectOneSql: string;
  readonly upsertSql: string;
  readonly ackSql: string;
  readonly markAllDirtySql: string;
}

const q = (name: string): string => `"${name}"`;

/**
 * Valor por defecto de una columna tal como lo guarda SQLite, o `undefined` si
 * no tiene uno que el motor pueda calcular (un DEFAULT que es una expresión SQL).
 * Se usa al guardar una fila que no trae una columna que este cliente sí
 * conoce (un cliente más viejo que el hub, §8.7): nace con ese valor y `BOTTOM`.
 */
function defaultOf(info: ColumnInfo): SqlValue | undefined {
  const column = info.column;
  if (!column.hasDefault) return undefined;
  const value: unknown = column.default;
  if (value === undefined || value === null || is(value, SQL)) return undefined;
  const driver: unknown = column.mapToDriverValue(value);
  if (typeof driver === 'string' || typeof driver === 'number') return driver;
  if (typeof driver === 'boolean') return driver ? 1 : 0;
  return undefined;
}

function build(entry: (typeof syncedEntries)[number]): SyncTable {
  const info = tableInfo(entry.table);
  const defaults: Record<string, SqlValue> = {};
  const required: string[] = [];
  for (const [name, column] of info.columns) {
    const value = defaultOf(column);
    if (value !== undefined) defaults[name] = value;
    if (column.notNull && !column.hasDefault) required.push(name);
  }
  const writeColumns = [
    'id',
    ...info.dataColumns,
    'syncCreated',
    'syncUpdated',
    'syncFields',
    'syncDeleted',
  ];
  const table = q(entry.name);
  const update = writeColumns
    .filter((column) => column !== 'id')
    .map((column) => `${q(column)} = excluded.${q(column)}`)
    .join(', ');
  return {
    name: entry.name,
    shape: { columns: info.dataColumns, defaults },
    required,
    writeColumns,
    selectDirtySql: `SELECT * FROM ${table} WHERE "syncDirty" = 1 AND "id" > ? ORDER BY "id" LIMIT ?`,
    selectOneSql: `SELECT * FROM ${table} WHERE "id" = ?`,
    // UPSERT y no INSERT OR REPLACE: REPLACE borra la fila y, con claves
    // foráneas, podría cascadear o fallar si tiene hijos. `syncDirty` NO está
    // en el SET: una fila local pendiente de subir sigue pendiente tras
    // fusionar lo que llega (la fusión puede no coincidir con lo del hub).
    upsertSql:
      `INSERT INTO ${table} (${writeColumns.map(q).join(', ')}, "syncDirty") ` +
      `VALUES (${writeColumns.map(() => '?').join(', ')}, 0) ` +
      `ON CONFLICT("id") DO UPDATE SET ${update}`,
    ackSql: `UPDATE ${table} SET "syncDirty" = 0 WHERE "id" = ? AND "syncUpdated" = ?`,
    markAllDirtySql: `UPDATE ${table} SET "syncDirty" = 1 WHERE "syncDirty" = 0`,
  };
}

/** Las tablas sincronizadas, padre antes que hijo (el orden del registro). */
export const syncTables: readonly SyncTable[] = syncedEntries.map(build);

const byName = new Map(syncTables.map((table) => [table.name, table]));

export const syncTableByName = (name: string): SyncTable | undefined => byName.get(name);

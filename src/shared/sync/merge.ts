// Fusión por campo (§8.3). LA MISMA función la usan el hub y el cliente.
//
// Portada de `spikes/sync-core/src/merge.ts` (fase 0; borrado, sigue en el historial de git), donde se demostró con 20.000
// casos aleatorios por propiedad que es conmutativa, asociativa e idempotente
// y que converge con varias réplicas y un hub (§20.1.2).
//
// Trabaja con VALORES DE SQL CRUDOS (`SqlValue`): lo que guarda SQLite y lo
// que viaja por el protocolo. Un booleano es 0/1, una fecha son milisegundos,
// un JSON es su texto. Ni Drizzle ni la puerta de escritura intervienen aquí:
// el motor de sync y el hub leen y escriben las filas tal cual.
//
// En memoria y en tránsito los relojes son EXPLÍCITOS: `clocks[c]` existe
// siempre que exista `fields[c]`. La forma compacta de §7.3 (`syncFields`
// solo con los relojes distintos de `syncCreated`) es solo la codificación en
// disco y se recalcula SIEMPRE tras fusionar (`encodeStored`). Decisiones del
// spike que se mantienen:
//
// - D-1: tras fusionar, `syncCreated` es el mínimo de los dos, y eso cambia el
//   reloj implícito de toda columna que no esté en `syncFields`. Por eso la
//   codificación se normaliza: `syncFields[c]` existe si y solo si el reloj de
//   `c` es distinto de `syncCreated`. La fusión "literal" no converge.
// - D-2: empate de reloj con valores distintos (ids cortos que colisionan,
//   migraciones): gana el mayor `valueKey`. Así es conmutativa en todo caso.
// - D-3: `syncDeleted` es una columna más (valor = reloj de la lápida o null,
//   con su propio reloj) y se fusiona igual que las demás.

import { BOTTOM, type Clock, maxClock } from './clock';
import { DELETED_COLUMN, compactClocks, parseSyncFields, serializeSyncFields } from './fieldClocks';

/** Un valor tal como lo guarda SQLite (sin blobs: el esquema no los usa). */
export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

/**
 * Una fila en memoria, con relojes explícitos. `fields` incluye
 * `syncDeleted` (D-3); no incluye `id` ni las demás columnas de §7.3.
 */
export interface RowState {
  id: string;
  created: Clock;
  fields: Record<string, SqlValue>;
  clocks: Record<string, Clock>;
}

/**
 * Lo que una réplica sabe de una tabla: sus columnas de datos (sin las de
 * §7.3) y el valor por defecto de las que lo tienen. El defecto se usa al
 * guardar una fila que no trae una columna que esta réplica sí conoce (un
 * cliente más viejo que el hub, §8.7): nace con ese valor y reloj `BOTTOM`.
 */
export interface TableShape {
  readonly columns: readonly string[];
  readonly defaults?: Readonly<Record<string, SqlValue>>;
}

// ---------- Fusión ----------

/** Clave de orden de un valor para el desempate D-2. */
export function valueKey(value: SqlValue): string {
  if (value === null) return '0:';
  if (typeof value === 'number') return `1:${value}`;
  return `2:${value}`;
}

/** > 0 si la celda (cb, vb) gana a la (ca, va). */
function compareCells(ca: Clock, va: SqlValue, cb: Clock, vb: SqlValue): number {
  if (cb !== ca) return cb > ca ? 1 : -1;
  const ka = valueKey(va);
  const kb = valueKey(vb);
  return kb === ka ? 0 : kb > ka ? 1 : -1;
}

export function cloneRow(row: RowState): RowState {
  return { id: row.id, created: row.created, fields: { ...row.fields }, clocks: { ...row.clocks } };
}

/**
 * Fusiona la fila entrante `incoming` sobre la almacenada `stored` (§8.3).
 * Columna a columna gana el reloj mayor; las columnas que solo tiene una de
 * las dos se conservan (§8.3.6, E-14).
 */
export function mergeRows(stored: RowState | undefined, incoming: RowState): RowState {
  if (!stored) return cloneRow(incoming);
  if (stored.id !== incoming.id) {
    throw new Error(`fusión de filas distintas: ${stored.id} / ${incoming.id}`);
  }
  const out: RowState = {
    id: stored.id,
    created: stored.created < incoming.created ? stored.created : incoming.created,
    fields: {},
    clocks: {},
  };
  const columns = new Set([...Object.keys(stored.fields), ...Object.keys(incoming.fields)]);
  for (const column of columns) {
    const inStored = column in stored.fields;
    const inIncoming = column in incoming.fields;
    const keepStored =
      inStored &&
      (!inIncoming ||
        compareCells(
          incoming.clocks[column],
          incoming.fields[column],
          stored.clocks[column],
          stored.fields[column],
        ) >= 0);
    const source = keepStored ? stored : incoming;
    out.fields[column] = source.fields[column];
    out.clocks[column] = source.clocks[column];
  }
  return out;
}

/** El mayor reloj de la fila, `created` incluido: su `syncUpdated`. */
export function rowMaxClock(row: RowState): Clock {
  let max = row.created;
  for (const clock of Object.values(row.clocks)) max = maxClock(max, clock);
  return max;
}

/** Proyecta una fila a las columnas que conoce esta réplica (cliente viejo, §8.7). */
export function project(row: RowState, shape: TableShape): RowState {
  const out: RowState = { id: row.id, created: row.created, fields: {}, clocks: {} };
  for (const column of [...shape.columns, DELETED_COLUMN]) {
    if (column in row.fields) {
      out.fields[column] = row.fields[column];
      out.clocks[column] = row.clocks[column];
    }
  }
  return out;
}

// ---------- Codificación en disco (§7.3) ----------

/** Las columnas de §7.3 que se guardan junto a los datos (sin `syncDirty`, que es local). */
export interface StoredSyncColumns {
  id: string;
  syncCreated: Clock;
  syncUpdated: Clock;
  syncFields: string;
  syncDeleted: Clock | null;
}

/**
 * La fila tal como se escribe en SQLite: sus columnas de datos según `shape`
 * más las de §7.3. Una columna de `shape` que la fila no trae lleva su valor
 * por defecto (o null) con reloj `BOTTOM`. Las columnas de la fila que
 * `shape` no conoce se descartan: solo el hub, que conoce todas, las guarda.
 */
export function encodeStored(row: RowState, shape: TableShape): SqlRow & StoredSyncColumns {
  const out: SqlRow = {};
  const clocks: Record<string, Clock> = {};
  for (const column of shape.columns) {
    const known = column in row.fields;
    out[column] = known ? row.fields[column] : (shape.defaults?.[column] ?? null);
    clocks[column] = known ? row.clocks[column] : BOTTOM;
  }
  clocks[DELETED_COLUMN] = DELETED_COLUMN in row.clocks ? row.clocks[DELETED_COLUMN] : BOTTOM;
  const known: RowState = {
    id: row.id,
    created: row.created,
    fields: { ...out, [DELETED_COLUMN]: row.fields[DELETED_COLUMN] ?? null },
    clocks,
  };
  return {
    ...out,
    id: row.id,
    syncCreated: row.created,
    syncUpdated: rowMaxClock(known),
    syncFields: serializeSyncFields(compactClocks(row.created, clocks, shape.columns)),
    syncDeleted: (row.fields[DELETED_COLUMN] ?? null) as Clock | null,
  };
}

/** Lee una fila guardada (valores crudos) a la forma explícita. */
export function decodeStored(row: SqlRow, shape: TableShape): RowState {
  const created = row.syncCreated as Clock;
  const syncFields = parseSyncFields(row.syncFields as string | null);
  const out: RowState = { id: row.id as string, created, fields: {}, clocks: {} };
  for (const column of [...shape.columns, DELETED_COLUMN]) {
    out.fields[column] = row[column] ?? null;
    out.clocks[column] = syncFields[column] ?? created;
  }
  return out;
}

/**
 * Forma canónica de una fila según `shape`: para comparar réplicas y para
 * saber si una fusión cambió algo (el hub no sube la secuencia si no, §8.4).
 */
export function canonical(row: RowState, shape: TableShape): string {
  const stored = encodeStored(row, shape);
  return JSON.stringify([
    ...shape.columns.map((column) => [column, stored[column]]),
    [DELETED_COLUMN, stored.syncDeleted],
    ['syncCreated', stored.syncCreated],
    ['syncFields', stored.syncFields],
  ]);
}

// ---------- Forma en tránsito (§8.4) ----------

/**
 * Una fila tal como viaja. `deleted` es el valor de `syncDeleted` y su reloj
 * va en `clocks.syncDeleted`; `fields` lleva las demás columnas que conoce el
 * emisor (todas, no solo las cambiadas: la fusión por columna decide).
 */
export interface WireRow {
  table: string;
  id: string;
  created: Clock;
  deleted: Clock | null;
  fields: Record<string, SqlValue>;
  clocks: Record<string, Clock>;
}

export function toWire(table: string, row: RowState): WireRow {
  const fields: Record<string, SqlValue> = {};
  for (const [column, value] of Object.entries(row.fields)) {
    if (column !== DELETED_COLUMN) fields[column] = value;
  }
  return {
    table,
    id: row.id,
    created: row.created,
    deleted: (row.fields[DELETED_COLUMN] ?? null) as Clock | null,
    fields,
    clocks: { ...row.clocks },
  };
}

export function fromWire(wire: WireRow): RowState {
  const clocks = { ...wire.clocks };
  if (!(DELETED_COLUMN in clocks)) clocks[DELETED_COLUMN] = BOTTOM;
  return {
    id: wire.id,
    created: wire.created,
    fields: { ...wire.fields, [DELETED_COLUMN]: wire.deleted },
    clocks,
  };
}

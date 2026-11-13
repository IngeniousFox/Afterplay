// Relojes por columna (AFTERPLAY-2.0.md §7.3 y §8.3).
//
// Cada columna de una fila tiene SIEMPRE un reloj. En la base se guarda en
// forma compacta: `syncCreated` + `syncFields` (solo las columnas cuyo reloj es
// distinto de `syncCreated`). Fuera de la base, en memoria y en tránsito, los
// relojes son EXPLÍCITOS: un mapa con una entrada por columna.
//
// Por qué explícitos y no "leer `syncFields` y si falta usar `syncCreated`" al
// vuelo (H-1): la fusión baja `syncCreated` al menor de los dos, y eso cambia
// el reloj implícito de toda columna que no estuviera en `syncFields`. Una
// columna que acababa de ganar quedaba re-fechada al mínimo y una tercera
// réplica con el valor viejo ya no la aceptaba: no convergía. Con relojes
// explícitos el reloj de una columna no depende de `syncCreated`, y la forma
// compacta se recalcula entera al guardar (`compactClocks`).
//
// `syncDeleted` es una columna más (§8.3.3): tiene su reloj y entra en
// `syncFields` como cualquier otra. Aquí se añade siempre sola; las listas de
// columnas que reciben estas funciones son las columnas de DATOS de la tabla.
//
// La fusión entre réplicas no está aquí (fase 3, §20.4); se apoyará en
// `expandClocks`, `compactClocks` y `syncUpdatedOf`.

import { BOTTOM, type Clock, isClock, maxClock, parseClock } from './clock';

/** Reloj explícito de cada columna, `syncDeleted` incluida. */
export type ColumnClocks = Record<string, Clock>;

/** La forma compacta de §7.3, ya parseada. */
export interface CompactClocks {
  syncCreated: Clock;
  syncFields: ColumnClocks;
}

export const DELETED_COLUMN = 'syncDeleted';

/** Columnas de §7.3 que no son datos y no pueden tener reloj propio. */
const RESERVED_COLUMNS = new Set([
  'id',
  'syncCreated',
  'syncUpdated',
  'syncFields',
  'syncDeleted',
  'syncDirty',
  'syncSeq',
]);

/** Las columnas con reloj de una tabla: sus columnas de datos más `syncDeleted`. */
export function clockedColumns(columns: readonly string[]): string[] {
  for (const column of columns) {
    if (RESERVED_COLUMNS.has(column)) {
      throw new RangeError(`${column} es una columna de sincronización, no de datos`);
    }
  }
  return [...columns, DELETED_COLUMN];
}

function sortedClocks(clocks: ColumnClocks): ColumnClocks {
  // Orden de claves fijo: dos réplicas con los mismos relojes guardan el MISMO
  // texto en `syncFields`, y así "¿cambió algo la fusión?" se puede contestar
  // comparando texto (el hub no incrementa la secuencia si no cambia nada, §8.4).
  const out: ColumnClocks = {};
  for (const key of Object.keys(clocks).sort()) out[key] = clocks[key];
  return out;
}

// ---------- Compacto ↔ explícito ----------

/**
 * Relojes explícitos a partir de la forma compacta. Las entradas de
 * `syncFields` de columnas que esta réplica no conoce se ignoran, como hace la
 * fusión con las columnas desconocidas (§8.3.6).
 */
export function expandClocks(compact: CompactClocks, columns: readonly string[]): ColumnClocks {
  const out: ColumnClocks = {};
  for (const column of clockedColumns(columns)) {
    out[column] = compact.syncFields[column] ?? compact.syncCreated;
  }
  return out;
}

/**
 * Forma compacta: `syncFields[c]` existe si y solo si el reloj de `c` es
 * distinto de `syncCreated` (§8.3.5). Una columna conocida que no está en
 * `clocks` lleva `BOTTOM`: nadie la ha escrito.
 */
export function compactClocks(
  syncCreated: Clock,
  clocks: ColumnClocks,
  columns: readonly string[],
): ColumnClocks {
  const syncFields: ColumnClocks = {};
  for (const column of clockedColumns(columns)) {
    const clock = clocks[column] ?? BOTTOM;
    if (clock !== syncCreated) syncFields[column] = clock;
  }
  return sortedClocks(syncFields);
}

/** `syncUpdated`: el mayor reloj de la fila, `syncCreated` incluido (§7.3). */
export function syncUpdatedOf(syncCreated: Clock, clocks: ColumnClocks): Clock {
  let max = syncCreated;
  for (const clock of Object.values(clocks)) max = maxClock(max, clock);
  return max;
}

/** Lee la columna `syncFields` de la base. Falla con relojes mal formados. */
export function parseSyncFields(text: string | null | undefined): ColumnClocks {
  if (text == null || text === '') return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RangeError(`syncFields no es un objeto: ${text}`);
  }
  const out: ColumnClocks = {};
  for (const [column, clock] of Object.entries(parsed)) {
    if (!isClock(clock)) throw new RangeError(`reloj mal formado en syncFields.${column}`);
    out[column] = clock;
  }
  return out;
}

/** Texto canónico para la columna `syncFields`: claves ordenadas. */
export function serializeSyncFields(syncFields: ColumnClocks): string {
  return JSON.stringify(sortedClocks(syncFields));
}

// ---------- Igualdad de valores ----------

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * ¿Son el mismo valor para la base? Decide qué columnas recibe reloj nuevo en
 * un parche, así que equivocarse en un sentido o en otro cuesta distinto:
 * - decir "distinto" de más solo gasta un reloj y una fila subida;
 * - decir "igual" de más PIERDE una edición: la columna no recibe reloj y en
 *   la fusión gana el valor viejo de otra réplica.
 * Por eso los tipos distintos son siempre distintos (`1` y `true`, `0` y
 * `null`, una fecha y su número), y solo se igualan lo que la base no distingue:
 * - números: `0` y `-0` son el mismo; `NaN` es igual a `NaN`;
 * - fechas: por milisegundos;
 * - JSON (objetos y arrays): igualdad estructural, sin importar el orden de las
 *   claves y tratando una clave con `undefined` como ausente, que es lo que
 *   queda tras `JSON.stringify`;
 * - binarios: byte a byte.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === 'number') return Number.isNaN(a) && Number.isNaN(b as number);
  if (typeof a !== 'object') return false;

  const x = a as object;
  const y = b as object;
  if (x instanceof Date || y instanceof Date) {
    if (!(x instanceof Date && y instanceof Date)) return false;
    const tx = x.getTime();
    const ty = y.getTime();
    return tx === ty || (Number.isNaN(tx) && Number.isNaN(ty));
  }
  if (x instanceof Uint8Array || y instanceof Uint8Array) {
    if (!(x instanceof Uint8Array && y instanceof Uint8Array) || x.length !== y.length) {
      return false;
    }
    return x.every((byte, i) => byte === y[i]);
  }
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!(Array.isArray(x) && Array.isArray(y)) || x.length !== y.length) return false;
    return x.every((item, i) => sameValue(item, y[i]));
  }
  if (!isPlainObject(x) || !isPlainObject(y)) return false;
  const rx = x as Record<string, unknown>;
  const ry = y as Record<string, unknown>;
  const keys = new Set([...Object.keys(rx), ...Object.keys(ry)]);
  for (const key of keys) {
    if (!sameValue(rx[key], ry[key])) return false;
  }
  return true;
}

// ---------- Las dos operaciones de la puerta de escritura (§8.6) ----------

export interface RowClocks {
  syncCreated: Clock;
  syncUpdated: Clock;
  /** Explícitos: una entrada por columna de datos más `syncDeleted`. */
  clocks: ColumnClocks;
}

/**
 * Relojes de una fila recién creada con el reloj `clock`.
 *
 * - Las columnas de `provided` (las que el llamador indica de verdad, aunque su
 *   valor sea `null`) llevan `clock`.
 * - Las demás llevan `BOTTOM` (H-2): si dos PCs dan de alta offline el mismo
 *   juego (id determinista), el segundo no pisa con valores por defecto las
 *   notas que el primero escribió después de crearlo. Con el reloj de creación
 *   en todas, el alta posterior ganaría en todas las columnas.
 * - `syncDeleted` lleva `clock`, no `BOTTOM` (§8.3.3): así volver a añadir un
 *   juego borrado, que tiene el mismo id, lo resucita.
 *
 * El llamador debe pasar en `provided` solo lo que el usuario o el proceso
 * indicaron, no los valores por defecto que rellene el ORM.
 */
export function clocksForNewRow(
  clock: Clock,
  columns: readonly string[],
  provided: Iterable<string>,
): RowClocks {
  parseClock(clock);
  const all = clockedColumns(columns);
  const given = new Set(provided);
  for (const column of given) {
    // Una columna indicada que la tabla no tiene es un error del llamador; si
    // se ignorase, ese dato se perdería en silencio.
    if (!all.includes(column)) throw new RangeError(`columna desconocida: ${column}`);
  }
  const clocks: ColumnClocks = {};
  for (const column of all) {
    clocks[column] = column === DELETED_COLUMN || given.has(column) ? clock : BOTTOM;
  }
  return { syncCreated: clock, syncUpdated: clock, clocks };
}

/**
 * Columnas de `patch` cuyo valor cambia respecto a `current` (§8.6). Las claves
 * con valor `undefined` no cuentan: en un parche significan "no tocar", como
 * en el ORM. Una clave que no es columna de la tabla es un error, por la misma
 * razón que en `clocksForNewRow`.
 */
export function changedColumns(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  columns: readonly string[],
): string[] {
  const all = clockedColumns(columns);
  const changed: string[] = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!all.includes(column)) throw new RangeError(`columna desconocida: ${column}`);
    if (!sameValue(current[column] ?? null, value)) changed.push(column);
  }
  return changed;
}

export interface PatchClocks extends RowClocks {
  /** Columnas que reciben reloj nuevo. Vacío = el parche no cambia nada. */
  changed: string[];
}

/**
 * Relojes tras aplicar `patch` a una fila existente.
 *
 * Solo las columnas que de verdad cambian de valor reciben el reloj nuevo
 * (§8.6). Si todas se reciben igual, el resultado es el de entrada y `now` NO
 * se llama: un parche sin cambios no gasta reloj, no cambia `syncUpdated` y no
 * debe marcar la fila como sucia (el refresco semanal reescribía la biblioteca
 * entera, F-33). Tampoco re-fecha columnas iguales: si lo hiciera, un valor
 * "re-guardado" ganaría a una edición real hecha antes en otra réplica.
 *
 * `syncDeleted` se trata como una columna: un parche `{ syncDeleted: reloj }`
 * es una lápida y `{ syncDeleted: null }` resucita la fila.
 *
 * Falla si el reloj nuevo no supera a `syncUpdated`: la escritura perdería en
 * la fusión contra su propio valor anterior. El arranque del reloj por encima
 * de la base (§8.2) existe para que eso no pase.
 */
export function clocksAfterPatch(
  row: RowClocks,
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  columns: readonly string[],
  now: () => Clock,
): PatchClocks {
  const changed = changedColumns(current, patch, columns);
  if (changed.length === 0) {
    return { ...row, clocks: { ...row.clocks }, changed };
  }
  const clock = now();
  parseClock(clock);
  if (clock <= row.syncUpdated) {
    throw new RangeError(`reloj ${clock} no posterior a la fila (${row.syncUpdated})`);
  }
  const clocks = { ...row.clocks };
  for (const column of changed) clocks[column] = clock;
  return {
    syncCreated: row.syncCreated,
    syncUpdated: syncUpdatedOf(row.syncCreated, clocks),
    clocks,
    changed,
  };
}

// ---------- Migraciones y recuperación de reloj ----------

/**
 * `syncFields` de una fila existente tras una migración que añade `added`
 * (§8.3, §8.7, H-6): las columnas nuevas nacen con `BOTTOM`. Si heredaran el
 * reloj implícito de creación, su valor por defecto empataría con el valor real
 * que otro dispositivo escribiera en la misma fila al crearla, y el desempate
 * por valor podría quedarse con el valor por defecto.
 */
export function syncFieldsWithAddedColumns(
  syncFields: ColumnClocks,
  added: readonly string[],
): ColumnClocks {
  const out = { ...syncFields };
  for (const column of clockedColumns(added).filter((c) => c !== DELETED_COLUMN)) {
    out[column] = BOTTOM;
  }
  return sortedClocks(out);
}

export interface RestampedRow extends RowClocks {
  /** Valor de `syncDeleted`: si era una lápida futura, pasa a ser el reloj nuevo. */
  syncDeleted: Clock | null;
  /** Columnas re-fechadas (sin contar `syncCreated`). */
  restamped: string[];
  createdRestamped: boolean;
}

/**
 * Re-fecha los relojes de una fila PENDIENTE DE SUBIR que pasan de `limitMs`
 * (§8.2, recuperación de un reloj adelantado). Es seguro solo con filas que el
 * hub rechazó, que es lo que garantiza el llamador (`syncDirty = 1`): sus
 * relojes futuros nunca salieron de este PC.
 *
 * Usa un único reloj nuevo para la fila y solo lo pide si hay algo que
 * re-fechar. La lápida guarda su reloj también como VALOR de `syncDeleted`, así
 * que ese valor cambia con su reloj.
 */
export function restampFutureClocks(
  row: RowClocks & { syncDeleted: Clock | null },
  limitMs: number,
  now: () => Clock,
): RestampedRow {
  const isFuture = (clock: Clock): boolean => parseClock(clock).ms > limitMs;
  const restamped = Object.keys(row.clocks).filter((column) => isFuture(row.clocks[column]));
  const createdRestamped = isFuture(row.syncCreated);
  if (restamped.length === 0 && !createdRestamped) {
    return { ...row, clocks: { ...row.clocks }, restamped, createdRestamped };
  }
  const fresh = now();
  const clocks = { ...row.clocks };
  for (const column of restamped) clocks[column] = fresh;
  const syncCreated = createdRestamped ? fresh : row.syncCreated;
  const syncDeleted =
    row.syncDeleted !== null && restamped.includes(DELETED_COLUMN) ? fresh : row.syncDeleted;
  return {
    syncCreated,
    syncUpdated: syncUpdatedOf(syncCreated, clocks),
    clocks,
    syncDeleted,
    restamped,
    createdRestamped,
  };
}

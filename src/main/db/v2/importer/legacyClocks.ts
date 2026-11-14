import {
  LEGACY_DEVICE_SHORT_ID,
  MAX_COUNTER,
  formatClock,
  parseClock,
  type Clock,
} from '../../../../shared/sync/clock';

// Relojes de lo importado de la 1.x (§8.2, §19.5 "Relojes").
//
// Lo que tienen que cumplir, y cómo:
// - DETERMINISTAS: dos PCs que importan la misma base escriben los mismos
//   relojes. Solo dependen de las filas del origen, nunca de la hora del PC.
// - ANTIGUOS: cualquier edición posterior hecha en la 2.0 les gana. Se derivan
//   de la fecha de dominio de cada fila (alta, inicio de sesión, fecha del
//   evento…), que es pasada, y las fechas que caen en el futuro (un gasto
//   tecleado con fecha de mañana) se recortan al TECHO del origen: el instante
//   más reciente que la propia base sabe que ya ha pasado (`ceilingMs` en
//   source.ts). El techo nunca pasa de la hora de la importación (los sellos
//   de máquina en el futuro no cuentan: revisión, hallazgo 1), así que lo
//   importado siempre pierde contra lo que se escriba después y no arrastra el
//   reloj del dispositivo al futuro.
// - ORDEN: dentro de cada tabla, los relojes crecen estrictamente en el orden
//   (fecha de dominio, id antiguo). Con eso, dos eventos del mismo playthrough
//   a la misma hora se desempatan por `syncCreated` igual que la 1.x lo hacía
//   por id (F-09), y los playthroughs de un juego (que toman la fecha del alta
//   del juego) quedan en el orden de su id antiguo, que es de donde sale
//   "Playthrough N" (§7.4).
// - Firmados con el id corto reservado `legacy` (LEGACY_DEVICE_SHORT_ID), que
//   ningún dispositivo puede usar.

/** El milisegundo más bajo que se usa: el 0 lo tiene `BOTTOM`. */
const MIN_MS = 1;

export interface ClockInput<K extends number | string> {
  /** Fecha de dominio en ms, o null si la fila no tiene (va al principio). */
  readonly domainMs: number | null;
  /** Desempate estable: el id antiguo, o una clave de texto para las agrupadas. */
  readonly key: K;
}

export interface ClockAssignment<K extends number | string> {
  readonly clocks: Map<K, Clock>;
  /** Filas cuya fecha superaba el techo y se recortaron. */
  readonly clamped: number;
}

const compareKeys = (a: number | string, b: number | string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** El siguiente reloj del importador, estrictamente mayor que `clock`. */
export function nextLegacyClock(clock: Clock): Clock {
  const { ms, counter } = parseClock(clock);
  return counter >= MAX_COUNTER
    ? formatClock(ms + 1, 0, LEGACY_DEVICE_SHORT_ID)
    : formatClock(ms, counter + 1, LEGACY_DEVICE_SHORT_ID);
}

/** Reloj del importador para un milisegundo, recortado a [1, techo]. */
export function legacyClockAt(ms: number, ceilingMs: number): Clock {
  const value = Math.min(Math.max(Math.trunc(ms), MIN_MS), ceilingMs);
  return formatClock(value, 0, LEGACY_DEVICE_SHORT_ID);
}

/**
 * Relojes de las filas de UNA tabla: ordena por (fecha recortada, clave) y
 * asigna a cada una el mayor entre "su fecha" y "el siguiente al anterior".
 * Las claves deben ser únicas dentro de la tabla.
 */
export function assignLegacyClocks<K extends number | string>(
  rows: readonly ClockInput<K>[],
  ceilingMs: number,
): ClockAssignment<K> {
  let clamped = 0;
  const prepared = rows.map((row) => {
    const raw = row.domainMs ?? MIN_MS;
    if (raw > ceilingMs) clamped += 1;
    return { key: row.key, ms: Math.min(Math.max(Math.trunc(raw), MIN_MS), ceilingMs) };
  });
  prepared.sort((a, b) => a.ms - b.ms || compareKeys(a.key, b.key));
  const clocks = new Map<K, Clock>();
  let previous: Clock | null = null;
  for (const row of prepared) {
    if (clocks.has(row.key)) throw new Error(`clave de reloj repetida: ${String(row.key)}`);
    const own = formatClock(row.ms, 0, LEGACY_DEVICE_SHORT_ID);
    const clock: Clock = previous !== null && own <= previous ? nextLegacyClock(previous) : own;
    clocks.set(row.key, clock);
    previous = clock;
  }
  return { clocks, clamped };
}

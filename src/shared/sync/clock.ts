// Reloj lógico híbrido por dispositivo (AFTERPLAY-2.0.md §8.2).
//
// Portado del prototipo validado en spikes/sync-core/src/clock.ts (fase 0; borrado, sigue en el historial de git). Formato de
// ancho fijo, comparable como TEXTO:
//
//   <milisegundos, 13 dígitos>-<contador, 4 dígitos>-<id corto, 6 [0-9a-z]>
//
// Que se pueda comparar como texto es la clave de todo: SQLite ordena y compara
// `syncUpdated` sin parsear, y la fusión (§8.3) decide con un simple `>`. Por
// eso cualquier reloj que no tenga exactamente este ancho se rechaza al
// construirlo o leerlo: uno de 14 dígitos de milisegundos, o un contador de 5,
// rompería el orden en silencio.
//
// Lo que depende del hub (rechazo de relojes adelantados en la subida, hora de
// `/status`, asignación del id corto al emparejar) no vive aquí; aquí solo están
// las piezas que ese código usará.

export type Clock = string;

/**
 * "Nadie ha escrito esto todavía": menor que cualquier reloj real. Lo llevan las
 * columnas que no se indican al crear una fila (H-2) y las que añade una
 * migración (H-6). Ningún dispositivo puede producirlo: el milisegundo 0 no lo
 * da ningún reloj de pared y el id corto `000000` está reservado.
 */
export const BOTTOM: Clock = '0000000000000-0000-000000';

/**
 * Id corto reservado. Lo usa el barrido de sesiones abandonadas del hub
 * (§10.5, H-3) con `successor`: así su escritura queda justo por encima de la
 * del dueño pero por debajo de cualquier escritura real del dueño en el mismo
 * milisegundo y contador. El hub no debe asignárselo a ningún dispositivo.
 */
export const RESERVED_DEVICE_ID = '000000';

/**
 * Id corto con el que firma el importador de la 1.x (§19.5) los relojes de lo
 * importado. Reservado por lo mismo que `RESERVED_DEVICE_ID`: si un dispositivo
 * real lo usara, sus escrituras empatarían en id corto con las importadas y el
 * desempate de §8.2 dejaría de distinguirlas. Tiene la forma de un id corto
 * normal (6 caracteres `[0-9a-z]`) para que los relojes importados pasen las
 * mismas validaciones que cualquier otro.
 */
export const LEGACY_DEVICE_SHORT_ID = 'legacy';

/**
 * ¿Es un id corto que ningún dispositivo puede usar? Lo consultan quien sortea
 * el id corto de un dispositivo (y el hub, al asignarlo en la fase 3).
 */
export function isReservedDeviceShortId(value: string): boolean {
  return value === RESERVED_DEVICE_ID || value === LEGACY_DEVICE_SHORT_ID;
}

/** 4 dígitos de contador: 10.000 escrituras por milisegundo (§8.2). */
export const MAX_COUNTER = 9999;

/** El mayor milisegundo que cabe en 13 dígitos (año 2286). */
const MAX_MS = 9_999_999_999_999;

/**
 * Cuánto puede adelantarse un reloj respecto a la hora del hub antes de que el
 * hub rechace la fila (§8.2). Vive aquí porque lo necesitan los dos lados: el
 * hub para rechazar y el cliente para saber qué celdas re-fechar al recuperarse.
 */
export const MAX_AHEAD_MS = 10 * 60 * 1000;

const CLOCK_RE = /^\d{13}-\d{4}-[0-9a-z]{6}$/;
const DEVICE_RE = /^[0-9a-z]{6}$/;

export interface ClockParts {
  ms: number;
  counter: number;
  dev: string;
}

export function isClock(value: unknown): value is Clock {
  return typeof value === 'string' && CLOCK_RE.test(value);
}

export function isDeviceShortId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_RE.test(value);
}

export function formatClock(ms: number, counter: number, dev: string): Clock {
  // Validar aquí y no confiar en el llamador: un número fuera de rango no
  // produce un error visible, produce un reloj con otro ancho que se ordena mal.
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_MS) {
    throw new RangeError(`milisegundo de reloj fuera de rango: ${ms}`);
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new RangeError(`contador de reloj fuera de rango: ${counter}`);
  }
  if (!isDeviceShortId(dev)) throw new RangeError(`id corto de dispositivo inválido: ${dev}`);
  return `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${dev}`;
}

export function parseClock(clock: Clock): ClockParts {
  if (!isClock(clock)) throw new RangeError(`reloj mal formado: ${String(clock)}`);
  return {
    ms: Number(clock.slice(0, 13)),
    counter: Number(clock.slice(14, 18)),
    dev: clock.slice(19),
  };
}

/** Orden total de los relojes (el id corto desempata). Negativo si `a` < `b`. */
export function compareClocks(a: Clock, b: Clock): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function maxClock(a: Clock, b: Clock): Clock {
  return a > b ? a : b;
}

/**
 * El mayor de una lista de relojes, o `BOTTOM` si no hay ninguno. Con
 * `limitMs` se ignoran los que pasan de ese milisegundo.
 *
 * Es la entrada del arranque (§8.2: el reloj empieza por encima del mayor reloj
 * de la base, que importa al restaurar una copia) y de la recuperación de un
 * reloj adelantado (se reinicia al mayor reloj ADMISIBLE, `horaDelHub +
 * MAX_AHEAD_MS`, porque los que pasan de ahí son justo los que hay que
 * re-fechar).
 */
export function maxClockOf(
  clocks: Iterable<Clock | null | undefined>,
  limitMs: number = Infinity,
): Clock {
  let max = BOTTOM;
  for (const clock of clocks) {
    if (clock == null) continue;
    // parseClock valida: un texto mal formado puede ser "mayor" que cualquier
    // reloj y arrastraría el arranque a un futuro imposible.
    const { ms } = parseClock(clock);
    if (clock <= max || ms > limitMs) continue;
    max = clock;
  }
  return max;
}

/**
 * Sucesor inmediato de un reloj con otro id corto. Lo usa el barrido de §10.5
 * (H-3) con `RESERVED_DEVICE_ID`: su cierre gana al reloj del dueño que ve, pero
 * pierde ante cualquier cierre real que el dueño hiciera después, aunque fuera
 * offline y antes del barrido.
 */
export function successor(clock: Clock, dev: string): Clock {
  const p = parseClock(clock);
  if (p.counter >= MAX_COUNTER) return formatClock(p.ms + 1, 0, dev);
  return formatClock(p.ms, p.counter + 1, dev);
}

/**
 * El reloj de un dispositivo. Estrictamente creciente mientras viva la
 * instancia, aunque el reloj de pared retroceda.
 */
export class HybridClock {
  private device: string;
  private readonly wall: () => number;
  private ms = 0;
  private counter = 0;

  /**
   * @param initial el mayor reloj que haya en la base (`maxClockOf`). Sin él,
   *   tras restaurar una copia hecha con un reloj de pared adelantado, una
   *   escritura local podría salir con un reloj MENOR que el de la fila que
   *   modifica: perdería en la fusión y, en el motor, "limpiar `syncDirty` si
   *   `syncUpdated` no cambió" (§8.5) dejaría de ser seguro.
   */
  constructor(dev: string, wall: () => number = Date.now, initial?: Clock | null) {
    if (!isDeviceShortId(dev)) throw new RangeError(`id corto de dispositivo inválido: ${dev}`);
    if (isReservedDeviceShortId(dev)) {
      throw new RangeError(`el id corto ${dev} está reservado (hub o importador de la 1.x)`);
    }
    this.device = dev;
    this.wall = wall;
    if (initial) this.observe(initial);
  }

  /** Id corto con el que firma ahora el reloj. */
  get dev(): string {
    return this.device;
  }

  /**
   * Cambia el id corto en caliente: el hub asigna el definitivo al emparejar
   * (§8.2) y el reloj ya está en marcha, compartido con la puerta de escritura.
   * Ms y contador no se tocan, así que el siguiente reloj sigue siendo mayor que
   * todo lo emitido u observado (con el mismo ms y contador solo cambia el
   * desempate, y `now()` siempre avanza uno de los dos antes de emitir).
   */
  setDev(dev: string): void {
    if (!isDeviceShortId(dev)) throw new RangeError(`id corto de dispositivo inválido: ${dev}`);
    if (isReservedDeviceShortId(dev)) {
      throw new RangeError(`el id corto ${dev} está reservado (hub o importador de la 1.x)`);
    }
    this.device = dev;
  }

  /** Reloj para una escritura local: `max(pared, último visto)`, +1 en el contador si coincide. */
  now(): Clock {
    const wall = Math.floor(this.wall());
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else if (this.counter >= MAX_COUNTER) {
      // Contador agotado (§8.2). Pasa de verdad con el reloj de pared atrasado:
      // el milisegundo se congela en el último reloj visto y TODAS las
      // escrituras caen en el contador. Avanzar un milisegundo mantiene el ancho
      // fijo y el orden; el reloj corre un poco por delante de la pared, nada más.
      this.ms += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return formatClock(this.ms, this.counter, this.device);
  }

  /** Al recibir una fila: adelantarse hasta el mayor reloj visto (§8.2). */
  observe(clock: Clock): void {
    const p = parseClock(clock);
    if (p.ms > this.ms || (p.ms === this.ms && p.counter > this.counter)) {
      this.ms = p.ms;
      this.counter = p.counter;
    }
  }

  /**
   * Olvida el estado y vuelve a `clock` (o a cero). Es la recuperación de un
   * reloj de pared adelantado (§8.2): el reloj lógico recuerda sus propias
   * escrituras futuras y, sin olvidarlas, el hub rechazaría para siempre todo lo
   * que este PC escriba aunque ya se haya corregido la hora. Solo es seguro tras
   * re-fechar las celdas pendientes con reloj futuro (`restampFutureClocks`),
   * que el hub nunca aceptó.
   */
  resetTo(clock: Clock | null): void {
    this.ms = 0;
    this.counter = 0;
    if (clock) this.observe(clock);
  }

  /** El último reloj emitido u observado, sin avanzar. */
  peek(): Clock {
    return formatClock(this.ms, this.counter, this.device);
  }
}

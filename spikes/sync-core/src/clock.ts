// Reloj lógico híbrido (§8.2).
// Formato de ancho fijo, comparable como texto:
//   <ms, 13 dígitos>-<contador, 4 dígitos>-<id corto del dispositivo, 6 car.>

export type Clock = string

/** Reloj "fondo": menor que cualquier reloj real. Lo llevan las columnas que
 *  nadie ha escrito (valor por defecto) — ver DECISIÓN D-1 en merge.ts. */
export const BOTTOM: Clock = '0000000000000-0000-000000'

const CLOCK_RE = /^\d{13}-\d{4}-[0-9a-z]{6}$/
const MAX_COUNTER = 9999

export function isClock(s: unknown): s is Clock {
  return typeof s === 'string' && CLOCK_RE.test(s)
}

export function formatClock(ms: number, counter: number, dev: string): Clock {
  return `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${dev}`
}

export function parseClock(c: Clock): { ms: number; counter: number; dev: string } {
  return { ms: Number(c.slice(0, 13)), counter: Number(c.slice(14, 18)), dev: c.slice(19) }
}

export function maxClock(a: Clock, b: Clock): Clock {
  return a > b ? a : b
}

/** Sucesor inmediato de un reloj, con otro id de dispositivo. Si `dev` es
 *  '000000' queda por debajo de cualquier escritura real del mismo ms+contador. */
export function successor(c: Clock, dev: string): Clock {
  const p = parseClock(c)
  if (p.counter >= MAX_COUNTER) return formatClock(p.ms + 1, 0, dev)
  return formatClock(p.ms, p.counter + 1, dev)
}

export class HybridClock {
  private ms = 0
  private counter = 0

  constructor(
    readonly dev: string,
    private wall: () => number,
    initial?: Clock
  ) {
    if (!/^[0-9a-z]{6}$/.test(dev)) throw new Error(`id corto inválido: ${dev}`)
    if (initial) this.observe(initial)
  }

  setWall(wall: () => number): void {
    this.wall = wall
  }

  /** Reloj para una escritura local. Estrictamente creciente. */
  now(): Clock {
    const w = Math.floor(this.wall())
    if (w > this.ms) {
      this.ms = w
      this.counter = 0
    } else if (this.counter >= MAX_COUNTER) {
      // DECISIÓN D-8: desbordamiento del contador. Con el reloj de pared
      // atrasado el ms se congela y todo va al contador; 4 dígitos = 10.000
      // escrituras. Se avanza el ms en 1 (el reloj "corre" un poco por delante).
      this.ms += 1
      this.counter = 0
    } else {
      this.counter += 1
    }
    return formatClock(this.ms, this.counter, this.dev)
  }

  /** Al recibir: adelantarse hasta el mayor reloj visto. */
  observe(c: Clock): void {
    if (c === BOTTOM) return
    const p = parseClock(c)
    if (p.ms > this.ms || (p.ms === this.ms && p.counter > this.counter)) {
      this.ms = p.ms
      this.counter = p.counter
    }
  }

  /** Olvida el estado (para recuperarse de un reloj de pared adelantado). */
  resetTo(c: Clock | null): void {
    this.ms = 0
    this.counter = 0
    if (c) this.observe(c)
  }

  peek(): Clock {
    return formatClock(this.ms, this.counter, this.dev)
  }
}

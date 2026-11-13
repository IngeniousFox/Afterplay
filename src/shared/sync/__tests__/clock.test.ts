import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOTTOM,
  compareClocks,
  formatClock,
  HybridClock,
  isClock,
  isReservedDeviceShortId,
  LEGACY_DEVICE_SHORT_ID,
  MAX_AHEAD_MS,
  MAX_COUNTER,
  maxClockOf,
  parseClock,
  RESERVED_DEVICE_ID,
  successor,
} from '../clock';

// Reloj lógico híbrido (§8.2). Lo que depende del hub (rechazo de relojes
// adelantados, hora de /status) no se prueba aquí; sí las piezas que usará.

/** Generador pseudoaleatorio con semilla (mulberry32): casos reproducibles. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEVS = ['aaaaaa', 'b0b0b0', 'zz9zz9', '0a0a0a'];

describe('formato del reloj', () => {
  it('tiene ancho fijo y se lee de vuelta', () => {
    const clock = formatClock(1_763_020_800_123, 7, 'a1b2c3');
    assert.equal(clock, '1763020800123-0007-a1b2c3');
    assert.ok(isClock(clock));
    assert.deepEqual(parseClock(clock), { ms: 1_763_020_800_123, counter: 7, dev: 'a1b2c3' });
  });

  it('rechaza lo que rompería el ancho fijo (y con él el orden como texto)', () => {
    assert.throws(() => formatClock(10_000_000_000_000, 0, 'aaaaaa'), RangeError);
    assert.throws(() => formatClock(-1, 0, 'aaaaaa'), RangeError);
    assert.throws(() => formatClock(1.5, 0, 'aaaaaa'), RangeError);
    assert.throws(() => formatClock(1, MAX_COUNTER + 1, 'aaaaaa'), RangeError);
    assert.throws(() => formatClock(1, 0, 'AAAAAA'), RangeError);
    assert.throws(() => formatClock(1, 0, 'web'), RangeError);
    assert.throws(() => parseClock('1763020800123-0007-a1b2c'), RangeError);
    assert.equal(isClock('1763020800123-7-a1b2c3'), false);
    assert.equal(isClock(null), false);
  });

  it('BOTTOM es un reloj válido y menor que cualquier otro', () => {
    assert.ok(isClock(BOTTOM));
    const r = rng(1);
    for (let i = 0; i < 2000; i++) {
      const c = formatClock(
        Math.floor(r() * 1e12) + 1,
        Math.floor(r() * 10_000),
        DEVS[i % DEVS.length],
      );
      assert.ok(BOTTOM < c && compareClocks(BOTTOM, c) < 0);
    }
    // Incluso el menor reloj que puede emitir un dispositivo real.
    assert.ok(BOTTOM < formatClock(0, 0, '000001'));
  });

  it('el orden como texto es el orden total (ms, contador, id corto)', () => {
    const r = rng(2);
    const parts = Array.from({ length: 3000 }, () => ({
      ms: Math.floor(r() * 5) + 1_700_000_000_000,
      counter: Math.floor(r() * 3) * 4000,
      dev: DEVS[Math.floor(r() * DEVS.length)],
    }));
    const tuple = (a: (typeof parts)[number], b: (typeof parts)[number]): number =>
      a.ms - b.ms || a.counter - b.counter || (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0);
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1];
      const b = parts[i];
      const byText = compareClocks(
        formatClock(a.ms, a.counter, a.dev),
        formatClock(b.ms, b.counter, b.dev),
      );
      assert.equal(Math.sign(byText), Math.sign(tuple(a, b)));
    }
  });
});

describe('HybridClock', () => {
  it('es estrictamente creciente aunque el reloj de pared retroceda o se pare', () => {
    const r = rng(3);
    let wall = 1_700_000_000_000;
    const clock = new HybridClock('aaaaaa', () => wall);
    let prev = BOTTOM;
    for (let i = 0; i < 20_000; i++) {
      const step = r();
      if (step < 0.3) wall += Math.floor(r() * 50);
      else if (step < 0.35) wall -= Math.floor(r() * 100_000); // retrocede
      const next = clock.now();
      assert.ok(next > prev, `${next} > ${prev}`);
      assert.ok(parseClock(next).ms >= Math.floor(wall), 'nunca por detrás de la pared');
      prev = next;
    }
  });

  it('dos escrituras en el mismo milisegundo van al contador', () => {
    const clock = new HybridClock('aaaaaa', () => 5000);
    assert.equal(clock.now(), '0000000005000-0000-aaaaaa');
    assert.equal(clock.now(), '0000000005000-0001-aaaaaa');
    assert.equal(clock.peek(), '0000000005000-0001-aaaaaa');
  });

  it('contador agotado: avanza un milisegundo y sigue creciendo (H-7)', () => {
    // Reloj de pared atrasado respecto a lo último visto: el ms se congela.
    const clock = new HybridClock('aaaaaa', () => 1000, formatClock(5_000_000, 0, 'bbbbbb'));
    let prev = clock.peek();
    for (let i = 0; i < 25_000; i++) {
      const next = clock.now();
      assert.ok(next > prev);
      assert.ok(isClock(next));
      prev = next;
    }
    assert.equal(parseClock(prev).ms, 5_000_002, '25.000 escrituras = 2 ms y medio');

    const edge = new HybridClock('aaaaaa', () => 0, formatClock(42, MAX_COUNTER, 'bbbbbb'));
    assert.equal(edge.now(), formatClock(43, 0, 'aaaaaa'));
  });

  it('observe adelanta el reloj hasta el mayor visto, y nunca lo atrasa', () => {
    const clock = new HybridClock('aaaaaa', () => 1000);
    const remote = formatClock(9_000, 3, 'zzzzzz');
    clock.observe(remote);
    const next = clock.now();
    assert.ok(next > remote);
    assert.equal(next, formatClock(9_000, 4, 'aaaaaa'));

    clock.observe(formatClock(2_000, 0, 'zzzzzz'));
    clock.observe(BOTTOM);
    assert.ok(clock.now() > next, 'un reloj viejo no lo hace retroceder');

    // Mismo ms y contador, otro dispositivo: la siguiente escritura local ya gana.
    const twin = formatClock(9_000, 9, 'zzzzzz');
    clock.observe(twin);
    assert.ok(clock.now() > twin);

    assert.throws(() => clock.observe('basura'), RangeError);
  });

  it('arranca por encima del mayor reloj de la base (restaurar una copia)', () => {
    // La copia se hizo con un reloj de pared adelantado un día.
    const stored = [
      formatClock(1_700_086_400_000, 12, 'bbbbbb'),
      BOTTOM,
      null,
      formatClock(1_700_000_000_000, 0, 'aaaaaa'),
    ];
    const clock = new HybridClock('aaaaaa', () => 1_700_000_000_500, maxClockOf(stored));
    const first = clock.now();
    assert.ok(stored.every((c) => c === null || first > c));
  });

  it('se recupera de un reloj de pared adelantado con resetTo (§8.2)', () => {
    let wall = 1_700_000_000_000 + 3 * 3600_000; // tres horas adelantado
    const clock = new HybridClock('aaaaaa', () => wall);
    const future = clock.now();
    wall = 1_700_000_000_000; // se corrige la hora
    assert.ok(clock.now() > future, 'sin reiniciar, sigue en el futuro');

    const hubNow = 1_700_000_000_000;
    const limit = hubNow + MAX_AHEAD_MS;
    const stored = [future, formatClock(hubNow - 60_000, 0, 'bbbbbb')];
    clock.resetTo(maxClockOf(stored, limit));
    const after = clock.now();
    assert.ok(parseClock(after).ms <= limit, 'ya no está en el futuro');
    assert.ok(after > stored[1], 'pero sigue por encima de lo admisible que había');

    clock.resetTo(null);
    assert.equal(parseClock(clock.peek()).ms, 0);
  });

  it('no acepta ids cortos mal formados ni los reservados (hub e importador)', () => {
    assert.throws(() => new HybridClock('web'), RangeError);
    assert.throws(() => new HybridClock('ABCDEF'), RangeError);
    assert.throws(() => new HybridClock(RESERVED_DEVICE_ID), RangeError);
    // El importador de la 1.x firma con él: ningún dispositivo puede usarlo.
    assert.throws(() => new HybridClock(LEGACY_DEVICE_SHORT_ID), RangeError);
    assert.ok(isReservedDeviceShortId(LEGACY_DEVICE_SHORT_ID));
    assert.ok(isReservedDeviceShortId(RESERVED_DEVICE_ID));
    assert.ok(!isReservedDeviceShortId('a1b2c3'));
    // Tiene la forma de un id corto normal: sus relojes son relojes válidos.
    assert.ok(isClock(formatClock(1, 0, LEGACY_DEVICE_SHORT_ID)));
    assert.ok(isClock(new HybridClock('a1b2c3').now()), 'usa Date.now por defecto');
  });
});

describe('maxClockOf y successor', () => {
  it('maxClockOf: BOTTOM si no hay nada; con límite ignora los futuros', () => {
    assert.equal(maxClockOf([]), BOTTOM);
    assert.equal(maxClockOf([null, undefined, BOTTOM]), BOTTOM);
    const a = formatClock(1000, 0, 'aaaaaa');
    const b = formatClock(5000, 0, 'aaaaaa');
    assert.equal(maxClockOf([a, b]), b);
    assert.equal(maxClockOf([a, b], 4999), a);
    assert.throws(() => maxClockOf(['zzzz']), RangeError);
  });

  it('successor con el id reservado: gana al reloj, pierde ante la siguiente escritura real (§10.5)', () => {
    const owner = formatClock(1000, 4, 'aaaaaa');
    const janitor = successor(owner, RESERVED_DEVICE_ID);
    assert.ok(janitor > owner);
    assert.ok(janitor < formatClock(1000, 5, 'aaaaaa'));
    assert.equal(
      successor(formatClock(1000, MAX_COUNTER, 'aaaaaa'), 'bbbbbb'),
      formatClock(1001, 0, 'bbbbbb'),
    );
  });
});

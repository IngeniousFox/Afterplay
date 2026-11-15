import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CycleResult } from '../engine';
import { SyncScheduler, type SchedulerTimers } from '../scheduler';

// El planificador (§8.5) con temporizadores y hora falsos. Los ciclos son
// funciones que controla el test: se resuelven cuando él quiere.

class FakeClock implements SchedulerTimers {
  now = 1_000_000;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Avanza el tiempo disparando los temporizadores que vencen, en orden. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

/** Deja correr las promesas pendientes. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const result = (patch: Partial<CycleResult> = {}): CycleResult => ({
  status: 'ok',
  retry: false,
  error: null,
  pushed: 0,
  rejected: [],
  oversized: 0,
  pulled: 0,
  applied: 0,
  skipped: 0,
  pages: 0,
  reset: null,
  clockRecovered: false,
  minSchema: null,
  ...patch,
});

const failure = (patch: Partial<CycleResult> = {}): CycleResult =>
  result({
    status: 'error',
    retry: true,
    error: { code: 'network', message: 'sin red' },
    ...patch,
  });

interface Rig {
  clock: FakeClock;
  scheduler: SyncScheduler;
  /** Instantes (hora falsa) en que arrancó cada ciclo. */
  starts: number[];
  /** Los ciclos que han empezado y no se han resuelto. */
  pending: ((value: CycleResult) => void)[];
  results: CycleResult[];
  /** Cola de resultados que devuelve cada ciclo al instante; si está vacía, queda pendiente. */
  queue: CycleResult[];
  concurrent: { max: number };
}

function rig(options: { debounceMs?: number; intervalMs?: number } = {}): Rig {
  const clock = new FakeClock();
  const starts: number[] = [];
  const pending: ((value: CycleResult) => void)[] = [];
  const results: CycleResult[] = [];
  const queue: CycleResult[] = [];
  const concurrent = { max: 0 };
  let active = 0;
  const scheduler = new SyncScheduler({
    timers: clock,
    now: () => clock.now,
    ...options,
    onResult: (value) => results.push(value),
    runCycle: async () => {
      starts.push(clock.now);
      active += 1;
      concurrent.max = Math.max(concurrent.max, active);
      try {
        const immediate = queue.shift();
        if (immediate) return immediate;
        return await new Promise<CycleResult>((resolve) => pending.push(resolve));
      } finally {
        active -= 1;
      }
    },
  });
  return { clock, scheduler, starts, pending, results, queue, concurrent };
}

describe('planificador', () => {
  it('el arranque lanza un ciclo y devuelve al terminar', async () => {
    const r = rig();
    r.queue.push(result());
    await r.scheduler.start();
    assert.equal(r.starts.length, 1);
    assert.equal(r.results.length, 1);
  });

  it('el arranque no espera más que su límite si el ciclo tarda', async () => {
    const r = rig();
    let returned = false;
    void r.scheduler.start(10_000).then(() => {
      returned = true;
    });
    await settle();
    assert.equal(returned, false);
    await r.clock.advance(9_999);
    assert.equal(returned, false);
    await r.clock.advance(1);
    assert.equal(returned, true);
    assert.equal(r.scheduler.isRunning, true, 'el ciclo sigue en segundo plano');
    r.pending[0](result());
    await settle();
    assert.equal(r.scheduler.isRunning, false);
  });

  it('agrupa los cambios locales: un ciclo 2 s después del último', async () => {
    const r = rig();
    r.queue.push(result(), result());
    await r.scheduler.start();
    r.starts.length = 0;

    r.scheduler.notifyLocalChange();
    await r.clock.advance(1500);
    r.scheduler.notifyLocalChange(); // reinicia la espera
    await r.clock.advance(1500);
    assert.equal(r.starts.length, 0, 'solo han pasado 1,5 s desde el último cambio');
    await r.clock.advance(500);
    assert.equal(r.starts.length, 1);
  });

  it('repite cada 60 s tras un ciclo correcto', async () => {
    const r = rig();
    r.queue.push(result(), result(), result());
    await r.scheduler.start();
    assert.equal(r.starts.length, 1);
    await r.clock.advance(59_999);
    assert.equal(r.starts.length, 1);
    await r.clock.advance(1);
    assert.equal(r.starts.length, 2);
    await r.clock.advance(60_000);
    assert.equal(r.starts.length, 3);
  });

  it('nunca dos ciclos a la vez: un cambio durante el ciclo lo repite al terminar', async () => {
    const r = rig();
    void r.scheduler.start(0);
    await settle();
    assert.equal(r.starts.length, 1);

    r.scheduler.notifyLocalChange();
    r.scheduler.wake();
    await r.clock.advance(5000);
    assert.equal(r.starts.length, 1, 'el primero sigue en marcha');
    assert.equal(r.concurrent.max, 1);

    r.queue.push(result());
    r.pending[0](result());
    await settle();
    assert.equal(r.starts.length, 2, 'se repitió una vez, no dos');
    assert.equal(r.concurrent.max, 1);
  });

  it('tras un fallo espera cada vez más (5 s, 10 s, 20 s…) hasta el tope', async () => {
    const r = rig();
    r.queue.push(failure(), failure(), failure(), failure(), failure(), failure(), failure());
    await r.scheduler.start();
    assert.equal(r.starts.length, 1);

    const waits: number[] = [];
    let last = r.clock.now;
    for (let i = 0; i < 6; i++) {
      const before = r.starts.length;
      // avanza de 1 s en 1 s hasta que arranca el siguiente
      while (r.starts.length === before) await r.clock.advance(1000);
      waits.push(r.clock.now - last);
      last = r.clock.now;
    }
    assert.deepEqual(waits, [5000, 10_000, 20_000, 40_000, 80_000, 160_000]);
    assert.equal(r.scheduler.consecutiveFailures, 7);

    // El tope son 5 minutos.
    const before = r.starts.length;
    r.queue.push(failure());
    while (r.starts.length === before) await r.clock.advance(1000);
    assert.equal(r.clock.now - last, 300_000);
  });

  it('un cambio local durante la espera no lanza un ciclo, pero wake() sí y borra la espera', async () => {
    const r = rig();
    r.queue.push(failure());
    await r.scheduler.start();
    assert.equal(r.starts.length, 1);

    r.scheduler.notifyLocalChange();
    await r.clock.advance(2500);
    assert.equal(r.starts.length, 1, 'con la red caída no se reintenta a cada edición');

    r.queue.push(result());
    r.scheduler.wake();
    await settle();
    assert.equal(r.starts.length, 2);
    assert.equal(r.scheduler.consecutiveFailures, 0);
  });

  it('un resultado que no se arregla solo pausa hasta resume()', async () => {
    const r = rig();
    r.queue.push(result({ status: 'unauthorized', retry: false }));
    await r.scheduler.start();
    assert.equal(r.scheduler.isPaused, true);

    r.scheduler.notifyLocalChange();
    r.scheduler.wake();
    await r.clock.advance(10 * 60_000);
    assert.equal(r.starts.length, 1, 'ni cambios, ni despertar, ni el periódico');
    assert.equal(r.clock.pending, 0);

    r.queue.push(result());
    r.scheduler.resume();
    await settle();
    assert.equal(r.starts.length, 2);
    assert.equal(r.scheduler.isPaused, false);
  });

  it('flushOnQuit espera al ciclo en marcha, corre uno último y deja de planificar', async () => {
    const r = rig();
    void r.scheduler.start(0);
    await settle();
    assert.equal(r.starts.length, 1);

    const flushed = r.scheduler.flushOnQuit();
    await settle();
    assert.equal(r.starts.length, 1, 'aún espera al ciclo en marcha');
    r.queue.push(result());
    r.pending[0](result());
    assert.equal(await flushed, 'flushed');
    assert.equal(r.starts.length, 2);

    r.scheduler.notifyLocalChange();
    await r.clock.advance(5 * 60_000);
    assert.equal(r.starts.length, 2, 'ya no planifica nada');
    assert.equal(r.clock.pending, 0);
  });

  it('flushOnQuit corta a los 5 s si el hub no responde', async () => {
    const r = rig();
    let outcome: string | null = null;
    void r.scheduler.flushOnQuit().then((value) => {
      outcome = value;
    });
    await settle();
    assert.equal(r.starts.length, 1);
    await r.clock.advance(4999);
    assert.equal(outcome, null);
    await r.clock.advance(1);
    assert.equal(outcome, 'timeout');
  });

  it('flushOnQuit no hace nada si está pausado', async () => {
    const r = rig();
    r.queue.push(result({ status: 'blocked', retry: false }));
    await r.scheduler.start();
    assert.equal(await r.scheduler.flushOnQuit(), 'skipped');
    assert.equal(r.starts.length, 1);
  });

  it('un ciclo que lanza una excepción cuenta como fallo y no rompe el planificador', async () => {
    const clock = new FakeClock();
    let calls = 0;
    const scheduler = new SyncScheduler({
      timers: clock,
      now: () => clock.now,
      runCycle: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('inesperado')) : Promise.resolve(result());
      },
    });
    await scheduler.start();
    assert.equal(scheduler.consecutiveFailures, 1);
    await clock.advance(5000);
    assert.equal(calls, 2);
    assert.equal(scheduler.consecutiveFailures, 0);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { convergenceProblems } from '../harness';
import { libraryIds, visibleSessions } from '../actions';
import { runSimulation } from '../simulation';

// Propiedades de convergencia (§17.2): secuencias aleatorias de escrituras
// locales (por las consultas reales), cortes de red y sincronizaciones sobre
// 3 clientes y un hub. Al final, tras sincronizar todos hasta aquietar, todas
// las bases son idénticas al hub en cada tabla sincronizada (misma forma
// canónica por fila y mismo conjunto de filas), sin nada pendiente.
//
// Reproducible: la semilla de la ejecución `i` es `CONVERGENCE_SEED + i`.
// Variables de entorno:
//   CONVERGENCE_RUNS   número de ejecuciones (por defecto 40; la de relojes, la mitad)
//   CONVERGENCE_STEPS  pasos por ejecución (por defecto 100)
//   CONVERGENCE_SEED   semilla base (por defecto 20261115)
// Para repetir una que falló: CONVERGENCE_SEED=<semilla del fallo> CONVERGENCE_RUNS=1
// (la de relojes usa la semilla base + 100000: se repite con ese número y RUNS=1).

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const RUNS = envInt('CONVERGENCE_RUNS', 40);
const STEPS = envInt('CONVERGENCE_STEPS', 100);
const BASE_SEED = envInt('CONVERGENCE_SEED', 20261115);
const CLOCK_RUNS = Math.max(1, Math.floor(RUNS / 2));
const CLOCK_SEED_OFFSET = 100_000;

/** Una ejecución completa y sus comprobaciones finales. Devuelve escrituras y rondas. */
async function runAndCheck(options: {
  seed: number;
  steps: number;
  clockFaults?: boolean;
}): Promise<{ writes: number; rounds: number }> {
  const sim = await runSimulation(options);
  const { world, trace } = sim;
  // Lo que hace falta para reproducir y entender un fallo: la semilla y el final del rastro.
  const context = (): string =>
    `\nsemilla ${options.seed} (CONVERGENCE_SEED=${options.seed} CONVERGENCE_RUNS=1)\n` +
    trace.slice(-60).join('\n');
  try {
    let rounds: number;
    try {
      rounds = await world.quiesce(15);
    } catch (error) {
      throw new Error(`${(error as Error).message}${context()}`);
    }
    assert.deepEqual(convergenceProblems(world), [], `las bases no convergen${context()}`);

    // Lo que ve el usuario también es lo mismo en todos los PCs.
    const [first, ...rest] = world.clients;
    for (const other of rest) {
      assert.deepEqual(
        libraryIds(other),
        libraryIds(first),
        `biblioteca de ${other.name}${context()}`,
      );
      assert.deepEqual(
        visibleSessions(other),
        visibleSessions(first),
        `sesiones de ${other.name}${context()}`,
      );
    }
    return { writes: sim.writes, rounds };
  } finally {
    world.close();
  }
}

describe('convergencia con escrituras, cortes de red y sincronizaciones aleatorias', () => {
  it(`${RUNS} ejecuciones de ${STEPS} pasos con 3 clientes acaban idénticas al hub`, async () => {
    let writes = 0;
    let rounds = 0;
    for (let run = 0; run < RUNS; run++) {
      const done = await runAndCheck({ seed: BASE_SEED + run, steps: STEPS });
      writes += done.writes;
      rounds += done.rounds;
    }
    // Defensa contra una simulación vacía que pasaría por no hacer nada.
    assert.ok(writes > RUNS * 5, `pocas escrituras (${writes}): la simulación no ejerce nada`);
    console.log(
      `convergencia: ${RUNS} ejecuciones, ${writes} escrituras, ${rounds} rondas finales`,
    );
  });

  it(`${CLOCK_RUNS} ejecuciones con relojes de pared adelantados que se corrigen`, async () => {
    for (let run = 0; run < CLOCK_RUNS; run++) {
      await runAndCheck({
        seed: BASE_SEED + CLOCK_SEED_OFFSET + run,
        steps: STEPS,
        clockFaults: true,
      });
    }
  });

  it('el arnés sabe fallar: una fila del hub manipulada a mano se detecta', async () => {
    const { world } = await runSimulation({ seed: BASE_SEED, steps: STEPS });
    try {
      await world.quiesce(15);
      assert.deepEqual(convergenceProblems(world), []);
      const games = world.storage.exec('SELECT id FROM games LIMIT 1');
      assert.ok(games.length > 0, 'la simulación creó algún juego');
      world.storage.exec(
        'UPDATE games SET title = ? WHERE id = ?',
        'manipulado',
        String(games[0].id),
      );
      assert.notDeepEqual(convergenceProblems(world), []);
    } finally {
      world.close();
    }
  });
});

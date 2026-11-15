import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { insertMemory } from '../../../src/main/db/v2/queries/loop/memories';
import { createJobClaims, memoryJobKey, runLeased } from '../../../src/main/sync/jobClaims';
import { HOUR_MS, World, convergenceProblems, type Client } from '../harness';

// E-11 (§17.3, F-32): dos PCs encendidos a primeros de mes; el recap del mes
// anterior se genera UNA vez. Y las reglas de §14.3 sobre un hub real.
//
// El generador es falso (cuenta llamadas y escribe un recap inventado con la
// consulta real): ni modelo de pago ni red. La concesión es la REAL: el
// `TenantHub` de hub-core detrás del transporte de proceso, y el servicio de
// concesiones del cliente (`jobClaims.ts`) y la misma `runLeased` que usa la
// cola de recaps de la app.

let world: World | null = null;

afterEach(() => {
  world?.close();
  world = null;
});

const MONTH = '2026-06';
const KEY = memoryJobKey('month', MONTH);

/** Lo que hace la cola de recaps de un PC con el recap del mes que falta. */
function recapJob(
  client: Client,
  generator: { calls: number; refuse: boolean },
): ReturnType<typeof runLeased<boolean>> {
  const claims = createJobClaims({ transport: () => client.transport });
  return runLeased(
    claims,
    { kind: 'memory', key: KEY },
    async () => {
      generator.calls++;
      if (generator.refuse) return false;
      insertMemory(client.ctx, {
        scopeType: 'month',
        scopeKey: MONTH,
        payload: {
          headline: 'Un mes inventado',
          narrative: 'Texto de prueba.',
          highlights: [],
          closingLine: 'Fin.',
        },
        sourceHash: 'hash-de-prueba',
        model: 'modelo-falso',
        promptVersion: 1,
      });
      return true;
    },
    (written) => (written ? null : 'el modelo rechazo generar el recap'),
  );
}

const memories = (client: Client): number => client.rows('generated_memories').size;

describe('E-11: el recap del mes anterior se genera una sola vez (F-32)', () => {
  it('dos PCs encendidos a la vez: una sola generación, y el recap llega a los dos', async () => {
    world = new World();
    const a = await world.addClient('a');
    const b = await world.addClient('b');
    await world.quiesce();

    const generator = { calls: 0, refuse: false };
    const [runA, runB] = await Promise.all([recapJob(a, generator), recapJob(b, generator)]);

    assert.equal(generator.calls, 1, 'el modelo se llama una sola vez');
    assert.equal([runA, runB].filter((run) => run.ran).length, 1);
    const denied = [runA, runB].find((run) => !run.ran);
    assert.equal(denied && !denied.ran && denied.reason, 'skip_denied');

    await world.quiesce();
    assert.deepEqual(convergenceProblems(world), []);
    for (const client of [a, b]) assert.equal(memories(client), 1, client.name);
    assert.equal(world.hubRows('generated_memories').size, 1);
  });

  it('el segundo PC llega cuando el primero ya generó pero aún no ha subido: tampoco paga', async () => {
    world = new World();
    const a = await world.addClient('a');
    const b = await world.addClient('b');
    await world.quiesce();

    const generator = { calls: 0, refuse: false };
    assert.ok((await recapJob(a, generator)).ran);
    // B arranca ahora: A no ha sincronizado, B no ve el recap y lo da por pendiente.
    assert.equal(memories(b), 0);
    const second = await recapJob(b, generator);
    assert.equal(second.ran, false);
    assert.equal(generator.calls, 1);

    await world.quiesce();
    assert.deepEqual(convergenceProblems(world), []);
    assert.equal(memories(b), 1);
  });

  it('un rechazo del modelo queda en la concesión: ningún PC lo repaga a diario', async () => {
    world = new World();
    const a = await world.addClient('a');
    const b = await world.addClient('b');
    await world.quiesce();

    const generator = { calls: 0, refuse: true };
    const first = await recapJob(a, generator);
    assert.ok(first.ran && first.value === false);

    // Al día siguiente, dentro del plazo de la concesión, ni A ni B lo reintentan.
    world.advance(12 * HOUR_MS);
    assert.equal((await recapJob(a, generator)).ran, false);
    assert.equal((await recapJob(b, generator)).ran, false);
    assert.equal(generator.calls, 1);

    // El hub guarda el motivo del fallo.
    const lease = world.storage.exec(
      `SELECT outcome, reason FROM job_leases WHERE kind = 'memory'`,
    );
    assert.deepEqual(
      lease.map((row) => ({ outcome: row.outcome, reason: row.reason })),
      [{ outcome: 'failed', reason: 'el modelo rechazo generar el recap' }],
    );

    // Caducada la concesión (24 h) se puede volver a intentar, una vez.
    world.advance(13 * HOUR_MS);
    generator.refuse = false;
    assert.ok((await recapJob(b, generator)).ran);
    assert.equal(generator.calls, 2);
    assert.equal((await recapJob(a, generator)).ran, false);
    await world.quiesce();
    assert.deepEqual(convergenceProblems(world), []);
  });

  it('con el hub sin responder el recap de pago NO se genera', async () => {
    world = new World();
    const a = await world.addClient('a');
    await world.quiesce();

    a.cut();
    const generator = { calls: 0, refuse: false };
    const run = await recapJob(a, generator);
    assert.equal(run.ran, false);
    assert.equal(!run.ran && run.reason, 'skip_unavailable');
    assert.equal(generator.calls, 0);

    // Al volver la conexión, se genera.
    a.restore();
    assert.ok((await recapJob(a, generator)).ran);
    assert.equal(generator.calls, 1);
  });

  it('un trabajo barato (radar) corre en local con el hub sin responder', async () => {
    world = new World();
    const a = await world.addClient('a');
    await world.quiesce();

    a.cut();
    const claims = createJobClaims({ transport: () => a.transport });
    let ran = 0;
    const run = await runLeased(claims, { kind: 'radar', key: '2026-W27' }, async () => ++ran);
    assert.ok(run.ran);
    assert.equal(ran, 1);
  });

  it('el radar semanal lo hace un solo PC de la persona', async () => {
    world = new World();
    const a = await world.addClient('a');
    const b = await world.addClient('b');
    await world.quiesce();

    let passes = 0;
    const pass = (client: Client): ReturnType<typeof runLeased<number>> =>
      runLeased(
        createJobClaims({ transport: () => client.transport }),
        { kind: 'radar', key: '2026-W27' },
        async () => ++passes,
      );
    const runs = await Promise.all([pass(a), pass(b)]);
    assert.equal(passes, 1);
    assert.equal(runs.filter((run) => run.ran).length, 1);
  });
});

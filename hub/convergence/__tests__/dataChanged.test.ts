import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { dataChangedFromTables } from '../../../src/shared/ipc/dataChanged';
import {
  addSpendEvent,
  deleteSpendEvent,
  getAllSpendEvents,
  updateSpendEvent,
} from '../../../src/main/db/v2/queries/playthroughs/spend';
import { addGame } from '../actions';
import { World, convergenceProblems, type Client } from '../harness';

// Escenario de aceptación de §17.3 de la fase 7: E-22. "Un cambio de gasto
// llega por sync con la pantalla de estadísticas abierta" → "La pantalla se
// actualiza sin reiniciar" (F-39).
//
// Este es el primer eslabón de la cadena, con hub real y dos clientes reales:
// el motor del que RECIBE el gasto avisa de las tablas que cambió, y ese aviso
// se traduce al dominio `spend` con la misma función que usa el main
// (`dataChangedFromTables`, origen 'sync'). Los eslabones siguientes tienen su
// propio test: dominio → consultas del renderer
// (src/renderer/src/hooks/__tests__/domainQueryKeys.test.ts) y la pantalla
// abierta de verdad (e2e/data-changed.spec.ts).

let world: World | null = null;

const start = (): World => {
  world = new World();
  return world;
};

afterEach(() => {
  world?.close();
  world = null;
});

const totalSpent = (client: Client): number =>
  getAllSpendEvents(client.ctx).reduce((sum, event) => sum + event.amount, 0);

/** Lo último que el motor del cliente avisó al bajar, ya como aviso de cambio de datos. */
const lastNotice = (client: Client): ReturnType<typeof dataChangedFromTables> => {
  const change = client.changes.at(-1);
  assert.ok(change, `${client.name}: el motor no avisó de ningún cambio`);
  return dataChangedFromTables(change.tables, change.ids, 'sync');
};

describe('E-22: un cambio de gasto llega por sync', () => {
  it('el PC que recibe un gasto nuevo avisa del dominio spend, con el id', async () => {
    const w = start();
    const a = await w.addClient('A');
    const b = await w.addClient('B');
    const gameId = addGame(a, 1001);
    await w.quiesce();
    assert.equal(totalSpent(b), 0);

    // B tiene la pantalla de Estadísticas abierta: parte de sus avisos vacíos.
    b.changes.length = 0;

    const spend = addSpendEvent(a.ctx, {
      gameId,
      type: 'purchase',
      amount: 25,
      datePrecision: 'day',
    });
    await a.syncOk();
    await b.syncOk();

    // Lo que la pantalla de B va a leer ya es lo nuevo...
    assert.equal(totalSpent(b), 25);
    // ...y el motor avisó de ello como pide el renderer.
    const notice = lastNotice(b);
    assert.equal(notice.origin, 'sync');
    assert.ok(notice.domains.includes('spend'), JSON.stringify(notice));
    assert.deepEqual(notice.ids?.spend, [spend.id]);
    assert.deepEqual(convergenceProblems(w), []);
  });

  it('editar y borrar un gasto ajeno también avisan de spend', async () => {
    const w = start();
    const a = await w.addClient('A');
    const b = await w.addClient('B');
    const gameId = addGame(a, 1002);
    const spend = addSpendEvent(a.ctx, {
      gameId,
      type: 'purchase',
      amount: 10,
      datePrecision: 'day',
    });
    await w.quiesce();
    assert.equal(totalSpent(b), 10);

    b.changes.length = 0;
    w.advance(60_000);
    updateSpendEvent(a.ctx, spend.id, { amount: 40 });
    await a.syncOk();
    await b.syncOk();
    assert.equal(totalSpent(b), 40);
    assert.ok(lastNotice(b).domains.includes('spend'));

    b.changes.length = 0;
    w.advance(60_000);
    assert.equal(deleteSpendEvent(a.ctx, spend.id), true);
    await a.syncOk();
    await b.syncOk();
    assert.equal(totalSpent(b), 0);
    assert.ok(lastNotice(b).domains.includes('spend'));
    assert.deepEqual(convergenceProblems(w), []);
  });

  it('un ciclo sin nada nuevo no avisa de nada', async () => {
    const w = start();
    const a = await w.addClient('A');
    const b = await w.addClient('B');
    addGame(a, 1003);
    await w.quiesce();
    b.changes.length = 0;
    await b.syncOk();
    assert.deepEqual(b.changes, []);
  });
});

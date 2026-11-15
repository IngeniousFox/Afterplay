import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  openQueryDb,
  seedCatalog,
  seedGame,
  seedPlaythrough,
  seedUnlock,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGameById } from '../getGameById';
import { getGames } from '../getGames';
import { getPlannedGameExtras, getPlannedGames } from '../getPlannedGames';
import { countWork, event, openSession, session, syncedSession, type WorkCounter } from './helpers';

// PRESUPUESTOS DE TRABAJO, portados de src/main/db/__tests__/presupuestos.test.ts
// y queryPerformance.test.ts (las partes de biblioteca, ficha y Plan).
//
// Como allí, NO se cronometra: se cuentan CONSULTAS (el detector de N+1) y
// FILAS que cruzan el driver (lo que de verdad cuesta). Los números son fotos
// con margen, no objetivos: si un cambio honesto los rompe, se suben Y se
// explica aquí por qué. Cada presupuesto lleva al lado su aserción de
// resultado. Los tiempos reales sobre el banco grande están en
// performance.test.ts.

let fx: QueryFixture;
let work: WorkCounter;
beforeEach(() => {
  fx = openQueryDb();
  work = countWork(fx);
});
afterEach(() => {
  work.restore();
  fx.close();
});

// Una biblioteca pequeña con las formas que la app produce.
const sembrarBiblioteca = (juegos: number): string[] => {
  const ids: string[] = [];
  for (let i = 0; i < juegos; i++) {
    const gameId = seedGame(fx.ctx, { title: `Juego ${String(i).padStart(3, '0')}` });
    ids.push(gameId);
    const ptId = seedPlaythrough(fx.ctx, { gameId });
    event(fx.ctx, ptId, 'started', '2026-01-05T18:00:00Z');
    session(fx.ctx, ptId, '2026-01-05T18:00:00Z', 2);
    session(fx.ctx, ptId, '2026-01-06T18:00:00Z', 1.5);
    if (i % 3 === 0) event(fx.ctx, ptId, 'completed', '2026-02-01T20:00:00Z');
  }
  return ids;
};

describe('presupuestos: la lista de la biblioteca', () => {
  it('getGames no hace una consulta por juego, pase lo que pase con el tamaño', () => {
    sembrarBiblioteca(5);
    const [pocos, gastoPocos] = work.measure(() => getGames(fx.ctx));
    sembrarBiblioteca(20);
    const [muchos, gastoMuchos] = work.measure(() => getGames(fx.ctx));
    assert.equal(pocos.length, 5);
    assert.equal(muchos.length, 25);
    assert.equal(gastoPocos.queries, gastoMuchos.queries, 'hay un N+1 nuevo en getGames');
    assert.ok(gastoMuchos.queries <= 3, `getGames ha hecho ${gastoMuchos.queries} consultas`);
  });

  it('getGames no se trae más filas que las que hay que agregar', () => {
    // 10 juegos + 10 playthroughs agregados + 14 eventos = 34, como en la 1.x.
    sembrarBiblioteca(10);
    const [lista, gasto] = work.measure(() => getGames(fx.ctx));
    assert.equal(lista.length, 10);
    assert.ok(gasto.rows <= 40, `getGames se ha traído ${gasto.rows} filas; el presupuesto son 40`);
  });

  it('una biblioteca vacía se para tras leer los juegos, aunque haya historial planeado', () => {
    const gameId = seedGame(fx.ctx, { title: 'Planeado', planned: true });
    session(fx.ctx, seedPlaythrough(fx.ctx, { gameId }), '2024-01-01T12:00:00Z', 3);
    const [games, gasto] = work.measure(() => getGames(fx.ctx));
    assert.deepEqual(games, []);
    assert.deepEqual(gasto, { queries: 1, rows: 0 });
  });

  it('el historial de sesiones crece y el presupuesto no (queryPerformance)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Crece' });
    const ptId = seedPlaythrough(fx.ctx, { gameId, manualHours: 12.5 });
    event(fx.ctx, ptId, 'started', '2024-01-01T12:00:00Z');
    syncedSession(fx.ctx, ptId, '2024-01-01T12:00:00Z', 1, 'legacy_manual');
    // Con una sesión abierta hay una consulta más, constante (el dispositivo de la
    // sesión en vivo, §10.8): se mide ya con ella abierta para comparar lo mismo.
    openSession(fx.ctx, ptId, '2025-01-01T12:00:00Z');
    const [, inicial] = work.measure(() => getGames(fx.ctx));
    for (let index = 0; index < 500; index++) {
      syncedSession(fx.ctx, ptId, new Date(1704110400000 + index * 3_600_000).toISOString(), 0.5);
    }
    const [[game], crecido] = work.measure(() => getGames(fx.ctx));
    const detail = getGameById(fx.ctx, gameId);
    assert.deepEqual(crecido, inicial);
    assert.deepEqual(crecido, { queries: 4, rows: 4 });
    assert.equal(game.sessionCount, 502);
    assert.equal(game.totalHours, 263.5);
    assert.equal(game.totalHours, detail?.totalHours);
    assert.equal(game.isLive, true);
    assert.equal(game.liveSince?.toISOString(), '2025-01-01T12:00:00.000Z');
  });

  it('SQLite usa el índice de sesiones por playthrough', () => {
    const gameId = seedGame(fx.ctx, { title: 'Índice' });
    const ptId = seedPlaythrough(fx.ctx, { gameId });
    session(fx.ctx, ptId, '2024-01-01T12:00:00Z', 2);
    const plan = fx.local.db.$client
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE playthroughId = ?')
      .all(ptId) as { detail: string }[];
    assert.ok(
      plan.some((row) => row.detail.includes('USING INDEX sessions_playthrough_idx')),
      JSON.stringify(plan),
    );
  });
});

describe('presupuestos: la ficha de un juego', () => {
  it('getGameById cuesta lo mismo con un playthrough que con seis', () => {
    const gameId = seedGame(fx.ctx, { title: 'Rejugado' });
    session(fx.ctx, seedPlaythrough(fx.ctx, { gameId }), '2026-01-05T18:00:00Z', 2);
    const [uno, gastoUno] = work.measure(() => getGameById(fx.ctx, gameId));
    for (let i = 2; i <= 6; i++) {
      session(fx.ctx, seedPlaythrough(fx.ctx, { gameId }), `2026-0${i}-05T18:00:00Z`, 1);
    }
    const [seis, gastoSeis] = work.measure(() => getGameById(fx.ctx, gameId));
    assert.equal(uno?.iterations.length, 1);
    assert.equal(seis?.iterations.length, 6);
    assert.equal(gastoUno.queries, gastoSeis.queries, 'hay un N+1 nuevo en getGameById');
    // Juego, playthroughs, posiciones, sesiones, eventos, gastos,
    // canMoveToPlan y paso por el Plan: 8, fijas.
    assert.ok(gastoSeis.queries <= 8, `getGameById ha hecho ${gastoSeis.queries} consultas`);
  });

  it('la ficha no se trae los logros de toda la biblioteca', () => {
    const conLogros = seedGame(fx.ctx, { title: 'Con logros' });
    session(fx.ctx, seedPlaythrough(fx.ctx, { gameId: conLogros }), '2026-01-05T18:00:00Z', 2);
    seedCatalog(fx.ctx, { gameId: conLogros });
    seedUnlock(fx.ctx, { gameId: conLogros, apiName: 'ACH_1' });
    const otro = seedGame(fx.ctx, { title: 'Otro juego' });
    seedCatalog(fx.ctx, {
      gameId: otro,
      items: Array.from({ length: 200 }, (_, i) => ({ apiName: `ajeno_${i}` })),
    });
    for (let i = 0; i < 50; i++) seedUnlock(fx.ctx, { gameId: otro, apiName: `ajeno_${i}` });

    const [ficha, gasto] = work.measure(() => getGameById(fx.ctx, conLogros));
    assert.equal(ficha?.title, 'Con logros');
    assert.ok(gasto.rows < 20, `la ficha se ha traído ${gasto.rows} filas`);
  });
});

describe('presupuestos: el Plan', () => {
  it('getPlannedGames y sus extras no consultan por juego planeado', () => {
    for (let i = 0; i < 12; i++) {
      seedGame(fx.ctx, { title: `Planeado ${i}`, planned: { note: `nota ${i}` } });
    }
    const [plan, gasto] = work.measure(() => getPlannedGames(fx.ctx));
    const [extras, gastoExtras] = work.measure(() => getPlannedGameExtras(fx.ctx));
    assert.equal(plan.length, 12);
    assert.equal(extras.length, 12);
    assert.ok(gasto.queries <= 2, `getPlannedGames ha hecho ${gasto.queries} consultas`);
    assert.ok(gastoExtras.queries <= 2, `getPlannedGameExtras ha hecho ${gastoExtras.queries}`);
  });
});

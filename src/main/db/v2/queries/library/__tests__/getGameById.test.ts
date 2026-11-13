import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  asOtherDevice,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSpendEvent,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGameById } from '../getGameById';
import { getGames } from '../getGames';
import type { GameDetail, IterationDetail } from '../../../../../../shared/types';
import { event, iso, openSession, session, syncedSession } from './helpers';

// getGameById sobre el 2.0. Portado de src/main/db/__tests__/getGameById.test.ts
// con los ids que devuelven los seeds. La 1.x probaba también que un
// `plan_to_play` posterior no tapara el desenlace: en 2.0 ese evento no existe
// (el Plan es `plan_entries`), así que esos casos se portan como "el paso por
// el Plan no toca la derivación", y los dos eventos del Plan tienen su propio
// fichero (planHistory.test.ts). Más los casos propios del 2.0: lápidas y
// F-11, valores efectivos, instalación de este PC, "Playthrough N" por
// posición (R-03) y la precisión 'unknown' (R-07).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const detail = (gameId: string): GameDetail<string> => {
  const game = getGameById(fx.ctx, gameId);
  if (!game) throw new Error(`getGameById(${gameId}) devolvió null y el test esperaba la ficha`);
  return game;
};

const sessionIds = (iteration: IterationDetail<string>): string[] =>
  iteration.sessions.map((s) => s.id).sort();

const spend = (
  gameId: string,
  occurredAt: string,
  amount: number,
  type: 'purchase' | 'ingame_spend' = 'purchase',
): string => seedSpendEvent(fx.ctx, { gameId, occurredAt: new Date(occurredAt), amount, type });

const game = (title = 'Juego de prueba'): string => seedGame(fx.ctx, { title });

const pt = (gameId: string, extra: { customLabel?: string; manualHours?: number } = {}): string =>
  seedPlaythrough(fx.ctx, { gameId, ...extra });

describe('la ficha de un juego y sus playthroughs', () => {
  it('cada playthrough se lleva SOLO sus sesiones, y el total suma las de todos', () => {
    const gameId = game('Hollow Knight');
    const first = pt(gameId, { customLabel: 'Primera vuelta' });
    const second = pt(gameId, { customLabel: 'Steel Soul' });
    const otherGame = game('Celeste');
    session(fx.ctx, pt(otherGame), '2026-01-10T18:00:00Z', 5);
    const s1 = session(fx.ctx, first, '2026-01-10T18:00:00Z', 2);
    const s2 = session(fx.ctx, first, '2026-01-11T18:00:00Z', 1.5);
    const s3 = session(fx.ctx, second, '2026-02-01T20:00:00Z', 3);

    const g = detail(gameId);
    assert.deepEqual(
      g.iterations.map((i) => i.label),
      ['Primera vuelta', 'Steel Soul'],
    );
    assert.deepEqual(sessionIds(g.iterations[0]), [s1, s2].sort());
    assert.deepEqual(sessionIds(g.iterations[1]), [s3]);
    assert.equal(g.iterations[0].hours, 3.5);
    assert.equal(g.iterations[1].hours, 3);
    assert.equal(g.totalHours, 6.5);
  });

  it('un juego sin playthroughs devuelve la ficha vacía y no pierde su gasto', () => {
    const gameId = game('Recién añadido');
    spend(gameId, '2026-01-05T00:00:00Z', 59.99);
    const g = detail(gameId);
    assert.deepEqual(g.iterations, []);
    assert.equal(g.totalHours, 0);
    assert.equal(g.currentState, null);
    assert.equal(g.isLive, false);
    assert.equal(g.totalSpend, 59.99);
    assert.equal(g.costPerHour, null);
  });

  it('un id que no existe, o un juego con lápida, devuelve null', () => {
    assert.equal(getGameById(fx.ctx, 'no-existe'), null);
    const gameId = game('Borrado');
    fx.ctx.store.remove('games', gameId);
    assert.equal(getGameById(fx.ctx, gameId), null);
  });

  it('una sesión abierta pone el juego EN VIVO y todavía no suma horas', () => {
    const gameId = game();
    const p = pt(gameId);
    session(fx.ctx, p, '2026-01-10T18:00:00Z', 2);
    openSession(fx.ctx, p, '2026-01-11T20:00:00Z');
    const g = detail(gameId);
    assert.equal(g.isLive, true);
    assert.equal(g.totalHours, 2);
    assert.equal(g.iterations[0].sessions.length, 2);
  });
});

describe('las fechas derivadas de un playthrough', () => {
  it('el inicio es la primera sesión cuando el watcher se adelantó al evento', () => {
    const gameId = game();
    const p = pt(gameId);
    session(fx.ctx, p, '2026-01-10T18:00:00Z', 2);
    session(fx.ctx, p, '2026-01-12T18:00:00Z', 1);
    const startedId = event(fx.ctx, p, 'started', '2026-01-11T00:00:00Z', { datePrecision: 'day' });
    const [it0] = detail(gameId).iterations;
    assert.equal(iso(it0.startedAt), '2026-01-10T18:00:00.000Z');
    assert.equal(it0.startedBySession, true);
    assert.equal(it0.startEvent?.id, startedId);
  });

  it('el inicio es el evento cuando es anterior a toda sesión', () => {
    const gameId = game();
    const p = pt(gameId);
    const startedId = event(fx.ctx, p, 'started', '2026-03-01T00:00:00Z', { datePrecision: 'day' });
    session(fx.ctx, p, '2026-08-01T18:00:00Z', 2);
    const [it0] = detail(gameId).iterations;
    assert.equal(iso(it0.startedAt), '2026-03-01T00:00:00.000Z');
    assert.equal(it0.startedBySession, false);
    assert.equal(it0.startEvent?.id, startedId);
    assert.equal(it0.startEvent?.datePrecision, 'day');
  });

  it('con la sesión y el evento en el mismo instante gana el evento', () => {
    const gameId = game();
    const p = pt(gameId);
    session(fx.ctx, p, '2026-05-05T12:00:00Z', 1);
    event(fx.ctx, p, 'started', '2026-05-05T12:00:00Z');
    const [it0] = detail(gameId).iterations;
    assert.equal(iso(it0.startedAt), '2026-05-05T12:00:00.000Z');
    assert.equal(it0.startedBySession, false);
  });

  it('el inicio es el PRIMER started: reanudar tras una pausa no lo reescribe', () => {
    const gameId = game();
    const p = pt(gameId);
    const firstStart = event(fx.ctx, p, 'started', '2026-01-10T00:00:00Z');
    event(fx.ctx, p, 'on_hold', '2026-02-01T00:00:00Z');
    event(fx.ctx, p, 'started', '2026-03-01T00:00:00Z');
    const [it0] = detail(gameId).iterations;
    assert.equal(iso(it0.startedAt), '2026-01-10T00:00:00.000Z');
    assert.equal(it0.startEvent?.id, firstStart);
    assert.equal(it0.currentState, 'started');
    assert.equal(it0.endedAt, null);
    assert.equal(it0.endEvent, null);
  });

  it('un playthrough reabierto no tiene fin aunque arrastre un completed antiguo', () => {
    const gameId = game();
    const p = pt(gameId);
    event(fx.ctx, p, 'started', '2026-01-01T00:00:00Z');
    event(fx.ctx, p, 'completed', '2026-02-01T00:00:00Z');
    event(fx.ctx, p, 'started', '2026-05-01T00:00:00Z');
    const g = detail(gameId);
    assert.equal(g.iterations[0].currentState, 'started');
    assert.equal(g.iterations[0].endedAt, null);
    assert.equal(g.iterations[0].endEvent, null);
    assert.deepEqual(
      g.stateHistory.map((e) => e.type),
      ['started', 'completed', 'started'],
    );
  });

  it('on_hold deja fecha de salida y resting no', () => {
    const parkedId = game('Aparcado');
    const parkedPt = pt(parkedId);
    event(fx.ctx, parkedPt, 'started', '2026-01-01T00:00:00Z');
    const onHoldId = event(fx.ctx, parkedPt, 'on_hold', '2026-04-01T00:00:00Z');
    const endlessId = seedGame(fx.ctx, { title: 'Endless', endless: true });
    const endlessPt = pt(endlessId);
    event(fx.ctx, endlessPt, 'started', '2026-01-01T00:00:00Z');
    event(fx.ctx, endlessPt, 'resting', '2026-04-01T00:00:00Z');

    const [parked] = detail(parkedId).iterations;
    assert.equal(parked.currentState, 'on_hold');
    assert.equal(iso(parked.endedAt), '2026-04-01T00:00:00.000Z');
    assert.equal(parked.endEvent?.id, onHoldId);
    const [endless] = detail(endlessId).iterations;
    assert.equal(endless.currentState, 'resting');
    assert.equal(endless.endedAt, null);
    assert.equal(endless.endEvent, null);
  });

  it('un playthrough sin sesiones ni eventos sale Unplayed y sin ninguna fecha', () => {
    const gameId = game();
    pt(gameId);
    const [it0] = detail(gameId).iterations;
    assert.equal(it0.currentState, null);
    assert.equal(it0.startedAt, null);
    assert.equal(it0.endedAt, null);
    assert.equal(it0.startEvent, null);
    assert.equal(it0.endEvent, null);
    assert.equal(it0.startedBySession, false);
    assert.equal(it0.hours, 0);
    assert.equal(it0.spend, 0);
  });

  it('dos eventos con la misma fecha exacta: manda el último registrado', () => {
    const gameId = game();
    const p = pt(gameId);
    event(fx.ctx, p, 'completed', '2026-03-01T00:00:00Z', { datePrecision: 'day' });
    const droppedId = event(fx.ctx, p, 'dropped', '2026-03-01T00:00:00Z', { datePrecision: 'day' });
    const g = detail(gameId);
    assert.equal(g.currentState, 'dropped');
    assert.equal(g.iterations[0].endEvent?.id, droppedId);
    // stateHistory viaja en orden de fecha y, a igual fecha, de creación.
    assert.deepEqual(
      g.stateHistory.map((e) => e.type),
      ['completed', 'dropped'],
    );
  });
});

describe('el paso por el Plan no toca la derivación (antes: plan_to_play posterior)', () => {
  it('el estado y el fin siguen siendo los del completed del pasado', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Promovido del Plan',
      planned: { plannedAt: new Date('2026-08-13T10:00:00Z') },
      promotedAt: new Date('2026-08-14T10:00:00Z'),
    });
    fx.ctx.store.remove('plan_entries', gameId);
    const p = pt(gameId);
    event(fx.ctx, p, 'started', '2023-05-01T00:00:00Z');
    const completedId = event(fx.ctx, p, 'completed', '2023-06-01T00:00:00Z');
    const g = detail(gameId);
    assert.equal(g.currentState, 'completed');
    assert.equal(iso(g.iterations[0].endedAt), '2023-06-01T00:00:00.000Z');
    assert.equal(g.iterations[0].endEvent?.id, completedId);
    // El Plan ya no está en stateHistory: está en planHistory.
    assert.deepEqual(
      g.stateHistory.map((e) => e.type),
      ['started', 'completed'],
    );
    assert.equal(iso(g.planHistory?.plannedAt), '2026-08-13T10:00:00.000Z');
  });

  it('la ventana de gasto se cierra con el completed', () => {
    const gameId = game('Elden Ring');
    const first = pt(gameId);
    event(fx.ctx, first, 'started', '2023-05-01T00:00:00Z');
    event(fx.ctx, first, 'completed', '2023-06-01T00:00:00Z');
    const second = pt(gameId);
    event(fx.ctx, second, 'started', '2026-07-01T00:00:00Z');
    spend(gameId, '2023-04-20T00:00:00Z', 60);
    spend(gameId, '2026-07-05T00:00:00Z', 25);
    const g = detail(gameId);
    assert.equal(g.iterations[0].spend, 60);
    assert.equal(g.iterations[1].spend, 25);
    assert.equal(g.totalSpend, 85);
    assert.equal(g.currentState, 'started');
    assert.equal(g.iterations[0].currentState, 'completed');
  });
});

describe('el reparto del gasto entre playthroughs', () => {
  it('un gasto anterior a todo cae en el primer playthrough', () => {
    const gameId = game();
    const first = pt(gameId);
    event(fx.ctx, first, 'started', '2026-06-01T00:00:00Z');
    event(fx.ctx, first, 'completed', '2026-07-01T00:00:00Z');
    const second = pt(gameId);
    event(fx.ctx, second, 'started', '2026-08-01T00:00:00Z');
    spend(gameId, '2026-01-02T00:00:00Z', 40);
    const g = detail(gameId);
    assert.equal(g.iterations[0].spend, 40);
    assert.equal(g.iterations[1].spend, 0);
  });

  it('cada gasto cae en el primer playthrough que seguía abierto en su fecha', () => {
    const gameId = game();
    const first = pt(gameId);
    event(fx.ctx, first, 'started', '2024-01-01T00:00:00Z');
    event(fx.ctx, first, 'completed', '2024-03-01T00:00:00Z');
    const second = pt(gameId);
    event(fx.ctx, second, 'started', '2025-01-01T00:00:00Z');
    event(fx.ctx, second, 'dropped', '2025-02-01T00:00:00Z');
    const third = pt(gameId);
    event(fx.ctx, third, 'started', '2026-01-01T00:00:00Z');
    spend(gameId, '2023-12-01T00:00:00Z', 50);
    spend(gameId, '2024-02-01T00:00:00Z', 10);
    spend(gameId, '2024-06-01T00:00:00Z', 20);
    spend(gameId, '2026-05-01T00:00:00Z', 5);
    const g = detail(gameId);
    assert.deepEqual(
      g.iterations.map((i) => i.spend),
      [60, 20, 5],
    );
    assert.equal(g.totalSpend, 85);
  });

  it('on_hold no cierra la ventana', () => {
    const gameId = game();
    const parked = pt(gameId, { customLabel: 'PC, aparcado' });
    event(fx.ctx, parked, 'started', '2026-01-01T00:00:00Z');
    event(fx.ctx, parked, 'on_hold', '2026-02-01T00:00:00Z');
    const other = pt(gameId, { customLabel: 'Switch, terminado' });
    event(fx.ctx, other, 'started', '2026-03-01T00:00:00Z');
    event(fx.ctx, other, 'completed', '2026-04-01T00:00:00Z');
    spend(gameId, '2026-05-01T00:00:00Z', 30);
    const g = detail(gameId);
    assert.equal(g.iterations[0].spend, 30);
    assert.equal(g.iterations[1].spend, 0);
  });

  it('el gasto posterior al cierre del último playthrough se lo queda ese último', () => {
    const gameId = game();
    const only = pt(gameId);
    event(fx.ctx, only, 'started', '2026-01-01T00:00:00Z');
    event(fx.ctx, only, 'completed', '2026-02-01T00:00:00Z');
    spend(gameId, '2026-06-01T00:00:00Z', 15, 'ingame_spend');
    const g = detail(gameId);
    assert.equal(g.iterations[0].spend, 15);
    assert.equal(g.totalSpend, 15);
  });

  it('un gasto en el instante exacto del cierre se queda en el playthrough que cerraba', () => {
    const gameId = game();
    const first = pt(gameId);
    event(fx.ctx, first, 'started', '2026-01-01T00:00:00Z');
    event(fx.ctx, first, 'completed', '2026-03-01T00:00:00Z', { datePrecision: 'day' });
    const second = pt(gameId);
    event(fx.ctx, second, 'started', '2026-09-01T00:00:00Z');
    spend(gameId, '2026-03-01T00:00:00Z', 20);
    const g = detail(gameId);
    assert.equal(g.iterations[0].spend, 20);
    assert.equal(g.iterations[1].spend, 0);
    assert.equal(g.totalSpend, 20);
  });

  it('un milisegundo después del cierre ya es del siguiente', () => {
    const gameId = game();
    const first = pt(gameId);
    event(fx.ctx, first, 'started', '2026-01-01T00:00:00Z');
    event(fx.ctx, first, 'completed', '2026-03-01T00:00:00Z', { datePrecision: 'day' });
    const second = pt(gameId);
    event(fx.ctx, second, 'started', '2026-09-01T00:00:00Z');
    spend(gameId, '2026-03-01T00:00:00.001Z', 20);
    const g = detail(gameId);
    assert.equal(g.iterations[0].spend, 0);
    assert.equal(g.iterations[1].spend, 20);
  });

  it('el coste por hora sale del gasto y las horas TOTALES del juego', () => {
    const gameId = game();
    pt(gameId, { manualHours: 3 });
    const second = pt(gameId);
    session(fx.ctx, second, '2026-01-10T18:00:00Z', 1);
    spend(gameId, '2026-01-01T00:00:00Z', 100);
    const g = detail(gameId);
    assert.equal(g.totalHours, 4);
    assert.equal(g.totalSpend, 100);
    assert.equal(g.costPerHour, 25);
  });
});

describe('las horas de cada playthrough', () => {
  it('las horas manuales se SUMAN a lo medido', () => {
    const gameId = game();
    const p = pt(gameId, { manualHours: 40 });
    session(fx.ctx, p, '2026-01-10T18:00:00Z', 2);
    const g = detail(gameId);
    assert.equal(g.iterations[0].hours, 42);
    assert.equal(g.iterations[0].manualTotalPlayed, 40);
    assert.equal(g.totalHours, 42);
  });

  it('getGames y getGameById cuentan las mismas horas y las mismas sesiones', () => {
    const gameId = game('El mismo juego');
    const first = pt(gameId, { manualHours: 12.5 });
    session(fx.ctx, first, '2026-01-10T18:00:00Z', 2);
    const second = pt(gameId);
    session(fx.ctx, second, '2026-02-10T18:00:00Z', 1.5);
    openSession(fx.ctx, second, '2026-03-10T18:00:00Z');
    event(fx.ctx, second, 'started', '2026-02-10T00:00:00Z');
    // Una sesión de otro PC también cuenta en los dos sitios.
    asOtherDevice(fx.ctx).seedSession({
      playthroughId: first,
      startedAt: new Date('2026-01-20T18:00:00Z'),
    });

    const detailed = detail(gameId);
    const [listed] = getGames(fx.ctx);
    assert.equal(listed.totalHours, detailed.totalHours);
    assert.equal(listed.currentState, detailed.currentState);
    assert.equal(listed.isLive, detailed.isLive);
    assert.equal(
      listed.sessionCount,
      detailed.iterations.reduce((total, i) => total + i.sessions.length, 0),
    );
  });

  it('una sesión legacy_manual NO arrastra el inicio ni lo marca como medido', () => {
    // `isManual` de la 1.x es `source = 'legacy_manual'` en 2.0 (solo la
    // escribe el importador): llega aquí por debajo de la puerta.
    const gameId = game();
    const p = pt(gameId);
    syncedSession(fx.ctx, p, '2020-01-01T00:00:00Z', 30, 'legacy_manual');
    const startedId = event(fx.ctx, p, 'started', '2026-01-10T00:00:00Z');
    const [it0] = detail(gameId).iterations;
    assert.equal(iso(it0.startedAt), '2026-01-10T00:00:00.000Z');
    assert.equal(it0.startedBySession, false);
    assert.equal(it0.startEvent?.id, startedId);
    assert.equal(it0.hours, 30);
    assert.equal(it0.sessions[0].isManual, true);
  });

  it('una sesión medida posterior a otra manual sigue mandando sobre el evento', () => {
    const gameId = game();
    const p = pt(gameId);
    syncedSession(fx.ctx, p, '2020-01-01T00:00:00Z', 30, 'legacy_manual');
    session(fx.ctx, p, '2026-01-05T18:00:00Z', 2);
    event(fx.ctx, p, 'started', '2026-01-10T00:00:00Z');
    const [it0] = detail(gameId).iterations;
    assert.equal(iso(it0.startedAt), '2026-01-05T18:00:00.000Z');
    assert.equal(it0.startedBySession, true);
  });

  it('con SOLO horas manuales y ningún evento no hay fecha de inicio', () => {
    const gameId = game();
    const p = pt(gameId);
    syncedSession(fx.ctx, p, '2020-01-01T00:00:00Z', 30, 'legacy_manual');
    const [it0] = detail(gameId).iterations;
    assert.equal(it0.startedAt, null);
    assert.equal(it0.startedBySession, false);
    assert.equal(it0.startEvent, null);
    assert.equal(it0.hours, 30);
  });
});

// ══ PROPIOS DEL 2.0 ═══════════════════════════════════════════════════════

describe('la ficha 2.0 · filas vivas y F-11', () => {
  it('lo borrado no sale: playthrough, sesión, evento y gasto con lápida', () => {
    const gameId = game();
    const kept = pt(gameId);
    const removed = pt(gameId, { manualHours: 9 });
    session(fx.ctx, kept, '2026-01-10T18:00:00Z', 1);
    const deadSession = session(fx.ctx, kept, '2026-01-11T18:00:00Z', 4);
    const deadEvent = event(fx.ctx, kept, 'completed', '2026-01-12T00:00:00Z');
    spend(gameId, '2026-01-01T00:00:00Z', 10);
    const deadSpend = spend(gameId, '2026-01-02T00:00:00Z', 99);
    fx.ctx.store.remove('sessions', deadSession);
    fx.ctx.store.remove('state_events', deadEvent);
    fx.ctx.store.remove('spend_events', deadSpend);
    fx.ctx.store.remove('playthroughs', removed);

    const g = detail(gameId);
    assert.deepEqual(
      g.iterations.map((i) => i.id),
      [kept],
    );
    assert.equal(g.iterations[0].sessions.length, 1);
    assert.deepEqual(g.stateHistory, []);
    assert.deepEqual(
      g.spendHistory.map((s) => s.amount),
      [10],
    );
    assert.equal(g.totalHours, 1);
    assert.equal(g.totalSpend, 10);
  });

  it('F-11: los hijos VIVOS de un playthrough con lápida (sin cascada) no salen', () => {
    const gameId = game();
    const kept = pt(gameId);
    const orphaned = pt(gameId);
    session(fx.ctx, kept, '2026-01-10T18:00:00Z', 1);
    session(fx.ctx, orphaned, '2026-02-10T18:00:00Z', 6);
    openSession(fx.ctx, orphaned, '2026-02-11T18:00:00Z');
    event(fx.ctx, orphaned, 'completed', '2026-02-12T00:00:00Z');
    tombstoneOnly(fx.ctx, 'playthroughs', orphaned);

    const g = detail(gameId);
    assert.equal(g.iterations.length, 1);
    assert.equal(g.totalHours, 1);
    assert.equal(g.isLive, false);
    assert.deepEqual(g.stateHistory, []);
    assert.equal(g.currentState, null);
  });

  it('un gasto con su playthrough borrado sigue contando (referencia nullify, no hijo)', () => {
    const gameId = game();
    const p = pt(gameId);
    seedSpendEvent(fx.ctx, {
      gameId,
      playthroughId: p,
      amount: 30,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    });
    fx.ctx.store.remove('playthroughs', p);
    const g = detail(gameId);
    assert.equal(g.totalSpend, 30);
    assert.deepEqual(g.iterations, []);
  });
});

describe('la ficha 2.0 · el juego tal como lo ve la app', () => {
  it('valores efectivos (override frente a caché) y rutas de ESTE PC', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Celeste',
      metadata: {
        coverUrl: 'https://img/cache.jpg',
        heroUrl: 'https://img/cache-hero.jpg',
        developer: 'Maddy Makes Games',
        publisher: 'Matt Makes Games',
        genres: ['Platform'],
        summary: 'Sube la montaña.',
      },
      coverOverride: 'https://img/mia.jpg',
      developerOverride: 'EXOK',
      install: { executablePath: 'C:\\Celeste\\Celeste.exe', installDirectory: 'C:\\Celeste' },
    });
    asOtherDevice(fx.ctx).seedInstall({ gameId, executablePath: 'D:\\otro\\Celeste.exe' });

    const g = detail(gameId);
    assert.equal(g.coverUrl, 'https://img/mia.jpg');
    assert.equal(g.heroUrl, 'https://img/cache-hero.jpg');
    assert.equal(g.developer, 'EXOK');
    assert.equal(g.publisher, 'Matt Makes Games');
    assert.deepEqual(g.genres, ['Platform']);
    assert.equal(g.summary, 'Sube la montaña.');
    assert.equal(g.executablePath, 'C:\\Celeste\\Celeste.exe');
    assert.equal(g.installDirectory, 'C:\\Celeste');
  });

  it('un juego instalado solo en otra máquina no tiene ruta en este PC', () => {
    const gameId = game('Allí');
    asOtherDevice(fx.ctx).seedInstall({ gameId, installDirectory: 'D:\\B' });
    const g = detail(gameId);
    assert.equal(g.executablePath, null);
    assert.equal(g.installDirectory, null);
    assert.equal(g.installSizeBytes, null);
  });

  it('las sesiones viajan con los campos del DTO 2.0 (play, lastSeenAt, otro PC)', () => {
    const gameId = game();
    const p = pt(gameId);
    session(fx.ctx, p, '2026-01-10T18:00:00Z', 1, { startedBy: 'play', note: 'Con Ana' });
    asOtherDevice(fx.ctx).seedSession({
      playthroughId: p,
      startedAt: new Date('2026-01-11T18:00:00Z'),
    });
    const sessions = detail(gameId).iterations[0].sessions;
    assert.equal(sessions.length, 2);
    const [mine, theirs] = sessions;
    assert.equal(mine.startedBy, 'play');
    assert.equal(mine.note, 'Con Ana');
    assert.equal(mine.isManual, false);
    assert.equal(mine.iterationId, p);
    assert.equal(iso(mine.lastHeartbeatAt), '2026-01-10T19:00:00.000Z');
    assert.equal(mine.datePrecision, 'datetime');
    assert.equal(iso(theirs.startedAt), '2026-01-11T18:00:00.000Z');
  });
});

describe('la ficha 2.0 · "Playthrough N" por posición (R-03)', () => {
  it('la etiqueta automática es la posición; la del usuario manda', () => {
    const gameId = game();
    pt(gameId);
    pt(gameId, { customLabel: 'NG+' });
    pt(gameId);
    assert.deepEqual(
      detail(gameId).iterations.map((i) => i.label),
      ['Playthrough 1', 'NG+', 'Playthrough 3'],
    );
  });

  it('borrar el 1 no convierte el 2 en "Playthrough 1"', () => {
    const gameId = game();
    const first = pt(gameId);
    pt(gameId);
    fx.ctx.store.remove('playthroughs', first);
    assert.deepEqual(
      detail(gameId).iterations.map((i) => i.label),
      ['Playthrough 2'],
    );
  });

  it('una etiqueta en blanco es la automática', () => {
    const gameId = game();
    pt(gameId, { customLabel: '   ' });
    assert.equal(detail(gameId).iterations[0].label, 'Playthrough 1');
  });
});

describe("la ficha 2.0 · la precisión 'unknown' (R-07)", () => {
  it('el papeleo del alta viaja tal cual en stateHistory y en el borde del playthrough', () => {
    const addedAt = new Date('2026-02-01T10:00:00Z');
    const gameId = seedGame(fx.ctx, { title: 'Alta jugando', addedAt });
    const p = pt(gameId);
    const startedId = event(fx.ctx, p, 'started', addedAt, { datePrecision: 'unknown' });
    const g = detail(gameId);
    assert.deepEqual(
      g.stateHistory.map((e) => [e.id, e.datePrecision]),
      [[startedId, 'unknown']],
    );
    // El estado sí vale (está jugando) aunque la fecha no conste.
    assert.equal(g.currentState, 'started');
    assert.equal(g.iterations[0].startEvent?.id, startedId);
    assert.equal(g.iterations[0].startEvent?.datePrecision, 'unknown');
  });
});

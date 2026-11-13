import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type {
  GameAchievements,
  GameDetail,
  GameListItem,
  OwnedGameRef,
  PlannedGameListItem,
  SessionWithGame,
} from '../../../../../shared/types';
import { rawRow } from '../../__tests__/helpers';
import {
  getAchievementsOverview,
  getAchievementsStatus,
  getGameAchievements,
  getPendingAchievementsGames,
  getSessionUnlocks,
  storeSteamCatalog,
  storeUnlocks,
  markSteamUnlocksSynced,
  type SteamCatalogDefinition,
} from '../achievements';
import { canMoveToPlan, type QueryContext } from '../common';
import {
  OTHER,
  asOtherDevice,
  hours,
  openQueryDb,
  type QueryFixture,
} from '../common/__tests__/fixtures';
import { applyRefreshPassGame, selectRefreshTargets } from '../external';
import {
  createGameWithDetails,
  createPlannedGame,
  deleteGame,
  isGameWriteError,
  moveToPlan,
  promotePlannedGame,
  setSteamAppId,
} from '../games';
import { createInput, enrichment, planInput, promoteInput } from '../games/__tests__/helpers';
import { getGameById, getGames, getOwnedGames, getPlannedGames } from '../library';
import {
  addSpendEvent,
  addStateEvent,
  getAllSpendEvents,
  getAllStateEvents,
} from '../playthroughs';
import {
  closeSessionIfOpen,
  getAllSessions,
  getOpenSessions,
  heartbeatSessions,
  startGameSession,
} from '../sessions';

// LA PRUEBA DE QUE LAS PIEZAS FUNCIONAN JUNTAS (integración de P1-P8).
//
// Cada paquete se escribió y se probó solo, con `seed*` para preparar lo que
// escribían los demás. Aquí no: una historia completa se cuenta SOLO con las
// funciones públicas de los paquetes (alta, Plan, sesiones, estados, gasto,
// logros, borrado), y en cada paso se pregunta lo mismo a todas las lecturas
// (biblioteca, ficha con `planHistory`, Plan, sesiones, logros) para
// comprobar que cuentan lo mismo. Lo único sembrado a mano es la otra máquina
// (`asOtherDevice`), porque ninguna consulta de este PC crea filas de otro.
//
// Datos inventados.

const HADES = { igdbId: 30003, title: 'Hades', steamAppId: 1145360 };
const SILKSONG_APP = 1030300;

const defs = (...apiNames: string[]): SteamCatalogDefinition[] =>
  apiNames.map((apiName, sortIndex) => ({
    apiName,
    displayName: `Logro ${apiName}`,
    description: null,
    iconUrl: null,
    iconGrayUrl: null,
    hidden: false,
    sortIndex,
  }));

let fx: QueryFixture;
let ctx: QueryContext;
beforeEach(() => {
  fx = openQueryDb();
  ctx = fx.ctx;
});
afterEach(() => fx.close());

/** Lo que cada pantalla dice de un juego, para comparar entre lecturas. */
interface Views {
  readonly library: GameListItem<string> | null;
  readonly planned: PlannedGameListItem<string> | null;
  readonly detail: GameDetail<string> | null;
  readonly sessions: SessionWithGame<string>[];
  readonly achievements: GameAchievements<string>;
  readonly owned: OwnedGameRef<string> | null;
}

function views(gameId: string): Views {
  return {
    library: getGames(ctx).find((game) => game.id === gameId) ?? null,
    planned: getPlannedGames(ctx).find((game) => game.id === gameId) ?? null,
    detail: getGameById(ctx, gameId),
    sessions: getAllSessions(ctx, { gameId }),
    achievements: getGameAchievements(ctx, gameId),
    owned: getOwnedGames(ctx).find((game) => game.id === gameId) ?? null,
  };
}

/** Las invariantes que tienen que cumplirse en cualquier momento de la historia. */
function assertCoherent(gameId: string): Views {
  const v = views(gameId);
  if (!v.detail) {
    // Borrado (o inexistente): nadie lo enseña.
    assert.equal(v.library, null, 'la biblioteca enseña un juego sin ficha');
    assert.equal(v.planned, null, 'el Plan enseña un juego sin ficha');
    assert.equal(v.owned, null, 'el escaneo cuenta un juego sin ficha');
    assert.deepEqual(v.sessions, []);
    assert.deepEqual(v.achievements.entries, []);
    return v;
  }
  const { detail } = v;
  // Planeado: o en la biblioteca o en el Plan, nunca en los dos ni en ninguno.
  assert.equal(detail.planned, v.planned !== null, 'ficha y Plan discrepan');
  assert.equal(!detail.planned, v.library !== null, 'ficha y biblioteca discrepan');
  assert.equal(v.owned?.planned, detail.planned, 'el escaneo discrepa del Plan');
  // Un planeado tiene paso por el Plan vivo; uno de la biblioteca no.
  if (detail.planned) {
    assert.ok(detail.planHistory, 'un planeado sin planHistory');
    assert.equal(detail.planHistory.leftAt, null);
    assert.deepEqual(v.planned?.addedAt, detail.planHistory.plannedAt, 'espera del Plan');
    assert.equal(detail.canMoveToPlan, false);
  } else if (detail.planHistory) {
    assert.notEqual(detail.planHistory.leftAt, null, 'en la biblioteca pero sin "Salió del Plan"');
  }
  // El gesto de la ficha y la condición de la escritura son la misma.
  if (!detail.planned) assert.equal(detail.canMoveToPlan, canMoveToPlan(ctx, gameId));
  // Biblioteca y ficha cuentan lo mismo.
  if (v.library) {
    assert.equal(v.library.totalHours, detail.totalHours, 'horas');
    assert.equal(v.library.currentState, detail.currentState, 'estado');
    assert.equal(v.library.isLive, detail.isLive, 'en vivo');
  }
  // Las sesiones de la ficha son las de la pantalla de Sesiones, campo a campo.
  const fromDetail = detail.iterations
    .flatMap((iteration) => iteration.sessions)
    .map((s) => ({ id: s.id, deviceId: s.deviceId, closedBy: s.closedBy, endedAt: s.endedAt }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const fromSessions = v.sessions
    .map((s) => ({ id: s.id, deviceId: s.deviceId, closedBy: s.closedBy, endedAt: s.endedAt }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(fromDetail, fromSessions, 'ficha y Sesiones discrepan');
  assert.equal(
    detail.isLive,
    v.sessions.some((s) => s.endedAt === null),
  );
  return v;
}

describe('integración · una historia completa con las funciones públicas', () => {
  it('planear → promocionar → jugar → completar → gastar → logros → no vuelve al Plan', () => {
    // ── Planear ──
    const planned = createPlannedGame(ctx, planInput({ note: 'Por la secuela' }), enrichment());
    const gameId = planned.id;
    let v = assertCoherent(gameId);
    assert.equal(v.detail?.planned, true);
    assert.deepEqual(v.detail?.planHistory, {
      plannedAt: fx.ctx.now(),
      note: 'Por la secuela',
      leftAt: null,
    });
    assert.deepEqual(v.detail?.iterations, []);

    // ── Promocionar ──
    fx.wall.advance(hours(24));
    const promotedAt = ctx.now();
    promotePlannedGame(ctx, promoteInput(gameId));
    v = assertCoherent(gameId);
    assert.equal(v.detail?.planned, false);
    assert.deepEqual(v.detail?.planHistory?.leftAt, promotedAt);
    assert.equal(v.detail?.iterations.length, 1);
    assert.equal(v.detail?.iterations[0]?.label, 'Playthrough 1');
    // Recién promocionado y sin tocar: aún podría volver al Plan.
    assert.equal(v.detail?.canMoveToPlan, true);
    const playthroughId = v.detail?.iterations[0]?.id as string;

    // ── Sesión abierta por el watcher ──
    fx.wall.advance(hours(1));
    const startedAt = ctx.now();
    const session = startGameSession(ctx, gameId, 'watcher');
    assert.ok(session);
    assert.equal(
      session.iterationId,
      playthroughId,
      'la sesión cae en el playthrough promocionado',
    );
    v = assertCoherent(gameId);
    assert.equal(v.library?.isLive, true);
    assert.equal(v.detail?.currentState, 'started');
    assert.equal(v.detail?.canMoveToPlan, false);
    assert.deepEqual(
      getOpenSessions(ctx).map((open) => open.sessionId),
      [session.id],
    );
    assert.equal(v.sessions[0]?.deviceId, ctx.deviceId);
    assert.equal(v.sessions[0]?.closedBy, null);

    // ── Latido ──
    fx.wall.advance(hours(0.5));
    const beat = heartbeatSessions(ctx, [session.id], ctx.now());
    assert.deepEqual(beat.signalled, [session.id]);
    v = assertCoherent(gameId);
    assert.deepEqual(v.sessions[0]?.lastHeartbeatAt, ctx.now());
    assert.deepEqual(
      v.detail?.iterations[0]?.sessions[0]?.lastHeartbeatAt,
      v.sessions[0]?.lastHeartbeatAt,
    );

    // ── Cierre ──
    fx.wall.advance(hours(0.5));
    const closed = closeSessionIfOpen(ctx, session.id, { endedAt: ctx.now(), closedBy: 'owner' });
    assert.equal(closed?.durationSec, 3600);
    v = assertCoherent(gameId);
    assert.equal(v.library?.isLive, false);
    assert.equal(v.detail?.totalHours, 1);
    assert.equal(v.sessions[0]?.closedBy, 'owner');
    assert.deepEqual(getOpenSessions(ctx), []);

    // ── Marcar completado ──
    fx.wall.advance(hours(1));
    addStateEvent(ctx, {
      iterationId: playthroughId,
      type: 'completed',
      datePrecision: 'datetime',
    });
    v = assertCoherent(gameId);
    assert.equal(v.detail?.currentState, 'completed');
    const events = getAllStateEvents(ctx).filter((event) => event.gameId === gameId);
    assert.deepEqual(
      events.map((event) => [event.type, event.iterationLabel]),
      [
        ['started', 'Playthrough 1'],
        ['completed', 'Playthrough 1'],
      ],
    );
    assert.deepEqual(
      v.detail?.stateHistory.map((event) => event.id),
      events.map((event) => event.id),
      'la ficha y Stats ven los mismos eventos',
    );

    // ── Gasto ──
    const spend = addSpendEvent(ctx, {
      gameId,
      type: 'purchase',
      amount: 20,
      datePrecision: 'day',
    });
    v = assertCoherent(gameId);
    assert.equal(v.detail?.totalSpend, 20);
    assert.equal(rawRow(fx.local, 'spend_events', spend.id)?.currency, 'EUR');
    assert.deepEqual(
      getAllSpendEvents(ctx)
        .filter((row) => row.gameId === gameId)
        .map((row) => row.amount),
      [20],
    );

    // ── Catálogo y desbloqueos de logros ──
    const catalog = storeSteamCatalog(ctx, {
      gameId,
      appId: SILKSONG_APP,
      definitions: defs('A', 'B', 'C'),
      percentages: new Map([
        ['A', 50],
        ['B', 4],
        ['C', 1],
      ]),
    });
    assert.equal(catalog.status, 'stored');
    // Un desbloqueo dentro de la sesión jugada: tiene que colgarse de ella.
    const toasts = storeUnlocks(ctx, {
      gameId,
      feed: 'steam',
      unlocks: [{ apiName: 'B', unlockedAt: new Date(startedAt.getTime() + hours(0.25)) }],
      fallbackDate: ctx.now(),
      expectedAppId: SILKSONG_APP,
    });
    assert.equal(toasts.length, 1);
    assert.equal(markSteamUnlocksSynced(ctx, gameId, SILKSONG_APP), true);
    v = assertCoherent(gameId);
    const unlocked = v.achievements.entries.filter((entry) => entry.unlockedAt !== null);
    assert.equal(v.achievements.entries.length, 3);
    assert.deepEqual(
      unlocked.map((entry) => [entry.apiName, entry.sessionId, entry.iterationId]),
      [['B', session.id, playthroughId]],
    );
    assert.deepEqual(v.achievements.completion, [
      {
        source: 'steam',
        total: 3,
        unlocked: 1,
        complete: false,
        known: true,
        completedAt: null,
      },
    ]);
    assert.deepEqual(
      getSessionUnlocks(ctx).map((row) => [row.sessionId, row.achievementId]),
      [[session.id, unlocked[0]?.id]],
    );
    const overview = getAchievementsOverview(ctx, null);
    assert.equal(overview.totalUnlocked, 1);
    assert.equal(overview.totalCatalog, 3);
    assert.equal(overview.hallOfFame[0]?.achievementId, unlocked[0]?.id);
    const status = getAchievementsStatus(ctx, {
      running: false,
      failedGames: 0,
      hasApiKey: true,
      hasUserId: true,
      hasRaCredentials: false,
    });
    assert.deepEqual(status.bySource.steam, {
      syncedGames: 1,
      totalAchievements: 3,
      unlockedAchievements: 1,
      perfectGames: 0,
    });
    assert.equal(status.unlockedAchievements, overview.totalUnlocked);
    // Ya sincronizado: la pasada del arranque no lo vuelve a pedir.
    assert.equal(
      getPendingAchievementsGames(ctx, false).some((game) => game.id === gameId),
      false,
    );
    // El sello de la ficha y el de la vista común del juego dicen lo mismo.
    assert.deepEqual(v.detail?.achievementsUnlocksSyncedAt, v.achievements.unlocksSyncedAt);

    // ── Devolverlo al Plan ya no se puede: tiene historia ──
    assert.equal(v.detail?.canMoveToPlan, false);
    assert.throws(
      () => moveToPlan(ctx, gameId),
      (error) => isGameWriteError(error, 'cannot_move_to_plan'),
    );
    assertCoherent(gameId);
  });

  it('otro juego va y vuelve del Plan conservando su playthrough; se borra y se vuelve a añadir', () => {
    const silksong = createGameWithDetails(ctx, createInput(), enrichment()).id;
    const added = createGameWithDetails(
      ctx,
      createInput({ source: { igdbId: HADES.igdbId } }),
      enrichment(HADES),
    );
    const gameId = added.id;
    let v = assertCoherent(gameId);
    assert.equal(v.detail?.planHistory, null, 'nunca pasó por el Plan');
    assert.equal(v.detail?.canMoveToPlan, true);
    const playthroughId = v.detail?.iterations[0]?.id;

    // ── Al Plan ──
    fx.wall.advance(hours(24));
    const backAt = ctx.now();
    moveToPlan(ctx, gameId);
    v = assertCoherent(gameId);
    assert.deepEqual(v.detail?.planHistory, { plannedAt: backAt, note: null, leftAt: null });
    // El "tiempo esperando" cuenta desde la última entrada al Plan.
    assert.deepEqual(v.planned?.addedAt, backAt);
    assert.deepEqual(
      v.detail?.iterations.map((iteration) => iteration.id),
      [playthroughId],
      'se conserva el playthrough vacío',
    );

    // ── Y de vuelta a la biblioteca ──
    fx.wall.advance(hours(24));
    const leftAt = ctx.now();
    promotePlannedGame(ctx, promoteInput(gameId, { initialStatus: 'started' }));
    v = assertCoherent(gameId);
    assert.deepEqual(v.detail?.planHistory, { plannedAt: backAt, note: null, leftAt });
    assert.deepEqual(
      v.detail?.iterations.map((iteration) => [iteration.id, iteration.label]),
      [[playthroughId, 'Playthrough 1']],
      'reutiliza el playthrough y no acaba llamándose "Playthrough 2"',
    );
    // Con papeleo de alta ("jugando" sin fecha) ya no puede volver.
    assert.equal(v.detail?.canMoveToPlan, false);
    assert.equal(v.detail?.iterations[0]?.startEvent?.datePrecision, 'unknown');

    // ── Borrarlo ──
    const session = startGameSession(ctx, gameId, 'play');
    assert.ok(session);
    assert.equal(deleteGame(ctx, gameId), true);
    v = assertCoherent(gameId);
    assert.equal(v.detail, null);
    assert.equal(getOpenSessions(ctx).length, 0, 'la sesión abierta cae con el juego');
    assert.equal(
      getAllSessions(ctx).some((row) => row.id === session.id),
      false,
    );
    // El otro juego no se entera.
    assertCoherent(silksong);
    assert.ok(getGames(ctx).some((game) => game.id === silksong));

    // ── Volver a añadirlo (mismo igdbId: resucita) ──
    fx.wall.advance(hours(24));
    const readdedAt = ctx.now();
    const again = createGameWithDetails(
      ctx,
      createInput({ source: { igdbId: HADES.igdbId } }),
      enrichment(HADES),
    );
    assert.equal(again.id, gameId, 'el id determinista resucita el juego');
    v = assertCoherent(gameId);
    assert.deepEqual(v.detail?.addedAt, readdedAt);
    assert.equal(v.detail?.promotedAt, null);
    // Una vida nueva: ni sesiones ni eventos ni paso por el Plan de la anterior.
    assert.deepEqual(v.sessions, []);
    assert.deepEqual(v.detail?.stateHistory, []);
    assert.equal(v.detail?.planHistory, null, 'el Plan de la vida anterior no se enseña');
    assert.equal(v.detail?.iterations.length, 1);
    // R-03: la etiqueta cuenta los playthroughs con lápida, también los de la
    // vida anterior (ver CONSULTAS.md §5.0).
    assert.equal(v.detail?.iterations[0]?.label, 'Playthrough 2');
    assert.equal(v.detail?.canMoveToPlan, true);
  });

  it('añadir un juego que ya existe vivo es un error y no duplica', () => {
    createGameWithDetails(ctx, createInput(), enrichment());
    assert.throws(
      () => createGameWithDetails(ctx, createInput(), enrichment()),
      (error) => isGameWriteError(error, 'already_exists'),
    );
    assert.throws(
      () => createPlannedGame(ctx, planInput(), enrichment()),
      (error) => isGameWriteError(error, 'already_exists'),
    );
    assert.equal(getGames(ctx).length, 1);
    assert.equal(getPlannedGames(ctx).length, 0);
  });
});

describe('integración · una segunda máquina con una sesión abierta del mismo juego', () => {
  it('cada PC ve las dos, pero solo cierra y late la suya', () => {
    const gameId = createGameWithDetails(ctx, createInput(), enrichment()).id;
    const playthroughId = getGameById(ctx, gameId)?.iterations[0]?.id as string;
    const other = asOtherDevice(ctx);

    fx.wall.advance(hours(1));
    const theirs = other.seedSession({ playthroughId, endedAt: null, startedBy: 'watcher' });
    // Una abierta en OTRO PC no impide abrir la mía (D-15).
    const mine = startGameSession(ctx, gameId, 'watcher');
    assert.ok(mine);
    assert.equal(mine.iterationId, playthroughId);

    let v = assertCoherent(gameId);
    assert.deepEqual(
      v.sessions.map((s) => [s.deviceId, s.endedAt]).sort(),
      [
        [OTHER, null],
        [ctx.deviceId, null],
      ].sort(),
    );
    assert.equal(v.library?.isLive, true);
    // El watcher de este PC solo sigue la suya.
    assert.deepEqual(
      getOpenSessions(ctx).map((open) => open.sessionId),
      [mine.id],
    );

    // Latir y cerrar solo afectan a la mía.
    fx.wall.advance(hours(1));
    const beat = heartbeatSessions(ctx, [mine.id, theirs], ctx.now());
    assert.deepEqual(beat.signalled, [mine.id]);
    assert.deepEqual(beat.skipped, [theirs]);
    assert.equal(
      closeSessionIfOpen(ctx, theirs, { endedAt: ctx.now(), closedBy: 'user' }),
      null,
      'no se cierra la sesión de otro PC',
    );
    closeSessionIfOpen(ctx, mine.id, { endedAt: ctx.now(), closedBy: 'user' });
    v = assertCoherent(gameId);
    // La suya sigue abierta: el juego sigue "en vivo" en todas las lecturas.
    assert.equal(v.detail?.isLive, true);
    assert.equal(v.library?.isLive, true);
    assert.equal(v.detail?.totalHours, 1, 'solo cuenta lo cerrado');

    // Marcar completado cierra solo las propias (R-10); la ajena queda abierta.
    addStateEvent(ctx, {
      iterationId: playthroughId,
      type: 'completed',
      datePrecision: 'datetime',
    });
    v = assertCoherent(gameId);
    assert.equal(v.detail?.currentState, 'completed');
    assert.equal(v.sessions.find((s) => s.id === theirs)?.endedAt, null);
    // Con una sesión viva (de quien sea) no puede volver al Plan.
    assert.equal(v.detail?.canMoveToPlan, false);
  });
});

describe('integración · contratos entre paquetes', () => {
  it('(a) corregir un appid automático deja el juego pendiente para la pasada de logros', () => {
    const gameId = createGameWithDetails(ctx, createInput(), enrichment()).id;
    storeSteamCatalog(ctx, {
      gameId,
      appId: SILKSONG_APP,
      definitions: defs('A'),
      percentages: new Map([['A', 10]]),
    });
    markSteamUnlocksSynced(ctx, gameId, SILKSONG_APP);
    const pending = (): boolean =>
      getPendingAchievementsGames(ctx, false).some((game) => game.id === gameId);
    assert.equal(pending(), false);

    const [target] = selectRefreshTargets(ctx, 'all').filter((row) => row.gameId === gameId);
    assert.ok(target);
    const outcome = applyRefreshPassGame(ctx, {
      target,
      igdb: null,
      appId: { kind: 'corrected', appId: 777 },
    });
    assert.deepEqual(outcome, { status: 'applied', appIdChanged: 'corrected', discarded: [] });
    // `external/` borra las comprobaciones de Steam y `achievements/` lo ve
    // como "nunca preguntado": vuelve a la cola con el appid nuevo.
    assert.equal(pending(), true);
    assert.equal(getPendingAchievementsGames(ctx, false)[0]?.steamAppId, 777);
    // Y una respuesta en vuelo para el appid viejo ya no escribe nada.
    const stale = storeUnlocks(ctx, {
      gameId,
      feed: 'steam',
      unlocks: [{ apiName: 'A', unlockedAt: ctx.now() }],
      fallbackDate: ctx.now(),
      expectedAppId: SILKSONG_APP,
    });
    assert.deepEqual(stale, []);
    assert.equal(getGameAchievements(ctx, gameId).completion[0]?.known, false);
  });

  it('(b) tras setSteamAppId, los logros se vuelven a escribir sin recuperar nada viejo', () => {
    const gameId = createGameWithDetails(ctx, createInput(), enrichment()).id;
    const playthroughId = getGameById(ctx, gameId)?.iterations[0]?.id as string;
    const session = startGameSession(ctx, gameId, 'watcher');
    assert.ok(session);
    storeSteamCatalog(ctx, {
      gameId,
      appId: SILKSONG_APP,
      definitions: defs('A', 'OLD'),
      percentages: new Map([
        ['A', 10],
        ['OLD', 20],
      ]),
    });
    storeUnlocks(ctx, {
      gameId,
      feed: 'steam',
      unlocks: [{ apiName: 'A', unlockedAt: ctx.now() }],
      fallbackDate: ctx.now(),
    });
    markSteamUnlocksSynced(ctx, gameId, SILKSONG_APP);
    const before = getGameAchievements(ctx, gameId);
    assert.equal(before.entries.find((e) => e.apiName === 'A')?.sessionId, session.id);
    closeSessionIfOpen(ctx, session.id, { endedAt: ctx.now(), closedBy: 'owner' });

    // R-09: el appid manual nuevo se lleva catálogo y desbloqueos de Steam.
    fx.wall.advance(hours(24));
    setSteamAppId(ctx, gameId, 4242);
    let achievements = getGameAchievements(ctx, gameId);
    assert.deepEqual(achievements.entries, []);
    assert.deepEqual(achievements.completion, []);
    assert.equal(getAchievementsOverview(ctx, null).totalUnlocked, 0);
    assert.ok(getPendingAchievementsGames(ctx, false).some((game) => game.id === gameId));

    // El catálogo del producto bueno comparte un apiName con el viejo ('A').
    storeSteamCatalog(ctx, {
      gameId,
      appId: 4242,
      definitions: defs('A', 'NEW'),
      percentages: new Map([
        ['A', 30],
        ['NEW', 40],
      ]),
    });
    achievements = getGameAchievements(ctx, gameId);
    // Ni el logro retirado del catálogo viejo ('OLD') ni el desbloqueo viejo de 'A'.
    assert.deepEqual(
      achievements.entries.map((e) => [e.apiName, e.unlockedAt, e.globalPercent]),
      [
        ['A', null, 30],
        ['NEW', null, 40],
      ],
    );
    assert.equal(achievements.completion[0]?.known, false, 'steam_unlocks se olvidó');

    // Volver a desbloquear 'A' en el producto nuevo: fila resucitada SIN la
    // sesión ni el playthrough de antes (la fecha cae fuera de toda sesión).
    const unlockedAt = ctx.now();
    const toasts = storeUnlocks(ctx, {
      gameId,
      feed: 'steam',
      unlocks: [{ apiName: 'A', unlockedAt }],
      fallbackDate: unlockedAt,
      expectedAppId: 4242,
    });
    assert.equal(toasts.length, 1, 'cuenta como nuevo: el viejo estaba borrado');
    markSteamUnlocksSynced(ctx, gameId, 4242);
    achievements = getGameAchievements(ctx, gameId);
    const a = achievements.entries.find((e) => e.apiName === 'A');
    assert.deepEqual([a?.unlockedAt, a?.sessionId, a?.iterationId], [unlockedAt, null, null]);
    assert.notEqual(a?.iterationId, playthroughId);
    assert.deepEqual(
      achievements.completion.map((c) => [c.total, c.unlocked, c.known]),
      [[2, 1, true]],
    );
    assert.equal(getAchievementsOverview(ctx, null).totalUnlocked, 1);
  });
});

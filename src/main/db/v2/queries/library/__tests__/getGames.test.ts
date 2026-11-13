import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { GameListItem } from '../../../../../../shared/types';
import {
  asOtherDevice,
  openQueryDb,
  seedEmulator,
  seedGame,
  seedPlaythrough,
  seedSession,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGames } from '../getGames';
import { event, openSession, session, syncedSession } from './helpers';

// getGames sobre el 2.0. Portado de src/main/db/__tests__/getGames.test.ts
// (los mismos casos, con los ids que devuelven los seeds en vez de enteros) y
// de harness.smoke.test.ts, más los casos propios del 2.0: lápidas y F-11,
// valores efectivos, la instalación de este PC frente a la de otro, planeado =
// `plan_entries` viva y el papeleo del alta = `'unknown'` (R-07).
//
// Lo que se protege es la DERIVACIÓN: horas, sesiones, en vivo, "Last played"
// y estado no están guardados en ninguna columna.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const list = (): GameListItem<string>[] => getGames(fx.ctx);

const onlyGame = (): GameListItem<string> => {
  const games = list();
  assert.equal(games.length, 1, 'este escenario debería devolver un único juego');
  return games[0];
};

const gameNamed = (title: string): GameListItem<string> => {
  const found = list().find((game) => game.title === title);
  assert.ok(found, `no salió "${title}" en la lista`);
  return found;
};

/** Un juego con un playthrough, como `makeGame` + `makeIteration` de la 1.x. */
const gameWithPlaythrough = (
  title: string,
  playthrough: { manualHours?: number | null; customLabel?: string } = {},
  game: { addedAt?: Date; isEmulated?: boolean } = {},
): { gameId: string; ptId: string } => {
  const gameId = seedGame(fx.ctx, { title, ...game });
  const ptId = seedPlaythrough(fx.ctx, { gameId, ...playthrough });
  return { gameId, ptId };
};

describe('andamio (harness.smoke)', () => {
  it('cada test arranca con la base vacía', () => {
    assert.deepEqual(list(), []);
  });

  it('las consultas reales leen de la base del test', () => {
    const { ptId } = gameWithPlaythrough('Celeste');
    session(fx.ctx, ptId, '2026-01-02T10:00:00Z', 2);
    const games = list();
    assert.equal(games.length, 1);
    assert.equal(games[0].totalHours, 2);
    assert.equal(games[0].sessionCount, 1);
  });
});

// ══ HORAS ═════════════════════════════════════════════════════════════════

describe('getGames · las horas de un juego', () => {
  it('las horas manuales se SUMAN a las trackeadas del mismo playthrough', () => {
    const { ptId } = gameWithPlaythrough('Elden Ring', { manualHours: 90 });
    session(fx.ctx, ptId, '2026-01-10T18:00:00Z', 2);
    session(fx.ctx, ptId, '2026-01-11T18:00:00Z', 1.5);
    assert.equal(onlyGame().totalHours, 93.5);
  });

  it('el total del juego es la suma de sus playthroughs', () => {
    const gameId = seedGame(fx.ctx, { title: 'Hollow Knight' });
    const first = seedPlaythrough(fx.ctx, { gameId });
    const steelSoul = seedPlaythrough(fx.ctx, {
      gameId,
      customLabel: 'Steel Soul',
      manualHours: 10,
    });
    session(fx.ctx, first, '2026-01-10T18:00:00Z', 1);
    session(fx.ctx, steelSoul, '2026-02-10T18:00:00Z', 3);
    assert.equal(onlyGame().totalHours, 14);
  });

  it('la sesión en marcha todavía no aporta horas: entran al cerrarla', () => {
    const { ptId } = gameWithPlaythrough('Balatro');
    session(fx.ctx, ptId, '2026-01-10T18:00:00Z', 2);
    openSession(fx.ctx, ptId, '2026-01-11T20:00:00Z');
    const game = onlyGame();
    assert.equal(game.totalHours, 2);
    assert.equal(game.sessionCount, 2);
    assert.equal(game.isLive, true);
  });

  it('un juego sin playthroughs sale entero y a cero', () => {
    seedGame(fx.ctx, { title: 'Silksong', addedAt: new Date('2026-01-05T12:00:00Z') });
    const game = onlyGame();
    assert.equal(game.totalHours, 0);
    assert.equal(game.sessionCount, 0);
    assert.equal(game.isLive, false);
    assert.equal(game.liveSince, null);
    assert.equal(game.currentState, null);
    assert.equal(game.lastPlayedAt, null);
    assert.deepEqual(game.manualIterations, []);
  });

  it('una sesión de emulador sin asignar no le suma horas ni sesiones a nadie', () => {
    const { ptId } = gameWithPlaythrough('Chrono Trigger', {}, { isEmulated: true });
    session(fx.ctx, ptId, '2026-03-01T18:00:00Z', 1);
    const emulatorId = seedEmulator(fx.ctx, { name: 'RetroArch' });
    const start = new Date('2026-03-02T18:00:00Z');
    seedSession(fx.ctx, {
      emulatorId,
      startedAt: start,
      endedAt: new Date(start.getTime() + 5 * 3_600_000),
    });
    const game = onlyGame();
    assert.equal(game.totalHours, 1);
    assert.equal(game.sessionCount, 1);
  });

  it('un playthrough vacío conserva sus horas manuales sin sesión fantasma (queryPerformance)', () => {
    const { ptId } = gameWithPlaythrough('Vacío', { manualHours: 4.5 });
    event(fx.ctx, ptId, 'completed', '2023-12-01T12:00:00Z');
    const game = onlyGame();
    assert.equal(game.totalHours, 4.5);
    assert.equal(game.sessionCount, 0);
    assert.equal(game.isLive, false);
    assert.equal(game.liveSince, null);
    assert.deepEqual(game.manualIterations, [{ iterationId: ptId, hours: 4.5, year: 2023 }]);
    assert.equal(game.lastPlayedAt?.toISOString(), '2023-12-01T12:00:00.000Z');
  });
});

// ══ SESIONES Y "EN VIVO" ══════════════════════════════════════════════════

describe('getGames · el contador de sesiones y el badge PLAYING', () => {
  it('la sesión abierta cuenta como una sesión más', () => {
    const { ptId } = gameWithPlaythrough('Hades');
    session(fx.ctx, ptId, '2026-01-10T18:00:00Z', 1);
    session(fx.ctx, ptId, '2026-01-11T18:00:00Z', 1);
    openSession(fx.ctx, ptId, '2026-01-12T18:00:00Z');
    assert.equal(onlyGame().sessionCount, 3);
  });

  it('cuenta las sesiones de todos los playthroughs, y cada una una sola vez', () => {
    const gameId = seedGame(fx.ctx, { title: 'Dark Souls' });
    const first = seedPlaythrough(fx.ctx, { gameId });
    const second = seedPlaythrough(fx.ctx, { gameId, customLabel: 'NG+' });
    session(fx.ctx, first, '2026-01-10T18:00:00Z', 1);
    session(fx.ctx, first, '2026-01-11T18:00:00Z', 1);
    session(fx.ctx, second, '2026-05-01T18:00:00Z', 1);
    const game = onlyGame();
    assert.equal(game.sessionCount, 3);
    assert.equal(game.totalHours, 3);
  });

  it('está en vivo desde que arrancó la sesión abierta, no desde la última cerrada', () => {
    const { ptId } = gameWithPlaythrough('Vampire Survivors');
    session(fx.ctx, ptId, '2026-01-02T10:00:00Z', 2);
    openSession(fx.ctx, ptId, '2026-01-12T21:15:00Z');
    const game = onlyGame();
    assert.equal(game.isLive, true);
    assert.equal(game.liveSince?.toISOString(), '2026-01-12T21:15:00.000Z');
  });

  it('sin ninguna sesión abierta el juego no está en vivo', () => {
    const { ptId } = gameWithPlaythrough('Tunic');
    session(fx.ctx, ptId, '2026-01-02T10:00:00Z', 2);
    const game = onlyGame();
    assert.equal(game.isLive, false);
    assert.equal(game.liveSince, null);
  });

  it('con dos sesiones abiertas a la vez manda el arranque más reciente', () => {
    const gameId = seedGame(fx.ctx, { title: 'Deep Rock Galactic' });
    const first = seedPlaythrough(fx.ctx, { gameId });
    const second = seedPlaythrough(fx.ctx, { gameId });
    openSession(fx.ctx, first, '2026-04-01T18:00:00Z');
    // La puerta no deja abrir otra del mismo juego en este PC: llega por sync.
    syncedSession(fx.ctx, second, '2026-04-01T19:00:00Z', null);
    const game = onlyGame();
    assert.equal(game.isLive, true);
    assert.equal(game.sessionCount, 2);
    assert.equal(game.liveSince?.toISOString(), '2026-04-01T19:00:00.000Z');
    assert.equal(game.lastPlayedAt?.toISOString(), '2026-04-01T19:00:00.000Z');
  });

  it('el desempate de liveSince no depende del orden de inserción', () => {
    const gameId = seedGame(fx.ctx, { title: 'Satisfactory' });
    const first = seedPlaythrough(fx.ctx, { gameId });
    const second = seedPlaythrough(fx.ctx, { gameId });
    openSession(fx.ctx, first, '2026-05-02T21:00:00Z');
    syncedSession(fx.ctx, second, '2026-05-02T10:00:00Z', null);
    assert.equal(onlyGame().liveSince?.toISOString(), '2026-05-02T21:00:00.000Z');
  });

  it('2.0: la sesión abierta en OTRO PC también enciende el badge (toda abierta cuenta)', () => {
    const { ptId } = gameWithPlaythrough('Hades');
    session(fx.ctx, ptId, '2026-01-10T18:00:00Z', 1);
    asOtherDevice(fx.ctx).seedSession({
      playthroughId: ptId,
      startedAt: new Date('2026-01-12T18:00:00Z'),
      endedAt: null,
    });
    const game = onlyGame();
    assert.equal(game.isLive, true);
    assert.equal(game.liveSince?.toISOString(), '2026-01-12T18:00:00.000Z');
    assert.equal(game.sessionCount, 2);
  });
});

// ══ LAST PLAYED ═══════════════════════════════════════════════════════════

describe('getGames · cuándo se jugó por última vez', () => {
  it('cuenta cuándo se DEJÓ de jugar, no cuándo se arrancó', () => {
    const { ptId } = gameWithPlaythrough('Outer Wilds');
    session(fx.ctx, ptId, '2026-01-10T18:00:00Z', 3);
    assert.equal(onlyGame().lastPlayedAt?.toISOString(), '2026-01-10T21:00:00.000Z');
  });

  it('en una sesión abierta manda su arranque', () => {
    const { ptId } = gameWithPlaythrough('Factorio');
    session(fx.ctx, ptId, '2026-01-10T18:00:00Z', 2);
    openSession(fx.ctx, ptId, '2026-01-12T09:00:00Z');
    assert.equal(onlyGame().lastPlayedAt?.toISOString(), '2026-01-12T09:00:00.000Z');
  });

  it('sin sesiones vale el evento de estado, si la fecha la pusiste tú', () => {
    const { ptId } = gameWithPlaythrough(
      'Bloodborne',
      {},
      { addedAt: new Date('2026-01-01T09:00:00Z') },
    );
    event(fx.ctx, ptId, 'completed', '2023-05-04T00:00:00Z');
    const game = onlyGame();
    assert.equal(game.lastPlayedAt?.toISOString(), '2023-05-04T00:00:00.000Z');
    assert.equal(game.currentState, 'completed');
  });

  it("el papeleo del alta ('unknown') no dice cuándo jugaste, pero sí el estado", () => {
    // R-07: en 2.0 el alta sin fecha escribe `occurredAt = addedAt` con
    // precisión 'unknown'. Ese es EXACTAMENTE el papeleo.
    const addedAt = new Date('2026-02-01T10:00:00.000Z');
    const { ptId } = gameWithPlaythrough('Journey', {}, { addedAt });
    event(fx.ctx, ptId, 'completed', addedAt, { datePrecision: 'unknown' });
    const game = onlyGame();
    assert.equal(game.lastPlayedAt, null);
    assert.equal(game.currentState, 'completed');
  });

  it('2.0: sin la heurística de los 5 s, un evento real tecleado junto al alta SÍ cuenta', () => {
    // Con la regla 1.x este evento (2,5 s después del alta) se tiraba como
    // papeleo. En 2.0 solo es papeleo lo que dice 'unknown'.
    const addedAt = new Date('2026-02-01T10:00:00.000Z');
    const { ptId } = gameWithPlaythrough('Journey', {}, { addedAt });
    event(fx.ctx, ptId, 'started', '2026-02-01T10:00:02.500Z');
    assert.equal(onlyGame().lastPlayedAt?.toISOString(), '2026-02-01T10:00:02.500Z');
  });

  it('una fecha tecleada el mismo día del alta sí vale', () => {
    const addedAt = new Date('2026-02-01T18:30:00.000Z');
    const { ptId } = gameWithPlaythrough('Inside', {}, { addedAt });
    event(fx.ctx, ptId, 'completed', '2026-02-01T00:00:00Z', { datePrecision: 'day' });
    assert.equal(onlyGame().lastPlayedAt?.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('una fecha buena de un evento antiguo sobrevive aunque el último sea el papeleo', () => {
    const addedAt = new Date('2026-02-01T10:00:00.000Z');
    const { ptId } = gameWithPlaythrough('Nier Automata', {}, { addedAt });
    event(fx.ctx, ptId, 'started', '2024-03-15T00:00:00Z', { datePrecision: 'day' });
    event(fx.ctx, ptId, 'completed', addedAt, { datePrecision: 'unknown' });
    const game = onlyGame();
    assert.equal(game.lastPlayedAt?.toISOString(), '2024-03-15T00:00:00.000Z');
    assert.equal(game.currentState, 'completed');
  });

  it('planear no es jugar: un juego promocionado sin eventos queda sin fecha y sin estado', () => {
    // La 1.x lo probaba con un `plan_to_play` suelto. En 2.0 el paso por el
    // Plan es la entrada con lápida y `promotedAt`: nada en el log.
    const gameId = seedGame(fx.ctx, {
      title: 'Pentiment',
      addedAt: new Date('2026-01-01T09:00:00Z'),
      promotedAt: new Date('2026-01-05T00:00:00Z'),
      planned: { plannedAt: new Date('2026-01-01T09:00:00Z') },
    });
    fx.ctx.store.remove('plan_entries', gameId);
    seedPlaythrough(fx.ctx, { gameId });
    const game = onlyGame();
    assert.equal(game.lastPlayedAt, null);
    assert.equal(game.currentState, null);
  });

  it('habiendo sesiones, un evento tecleado POSTERIOR sí manda', () => {
    const { ptId } = gameWithPlaythrough(
      'Persona 5',
      {},
      { addedAt: new Date('2026-01-01T09:00:00Z') },
    );
    session(fx.ctx, ptId, '2026-01-02T20:00:00Z', 2);
    event(fx.ctx, ptId, 'completed', '2026-06-01T00:00:00Z', { datePrecision: 'day' });
    assert.equal(onlyGame().lastPlayedAt?.toISOString(), '2026-06-01T00:00:00.000Z');
  });

  it('el borde contrario: con la sesión por delante del evento, manda la sesión', () => {
    const { ptId } = gameWithPlaythrough(
      'Hades',
      {},
      { addedAt: new Date('2026-01-01T09:00:00Z') },
    );
    event(fx.ctx, ptId, 'completed', '2026-02-10T00:00:00Z', { datePrecision: 'day' });
    session(fx.ctx, ptId, '2026-03-05T20:00:00Z', 1);
    assert.equal(onlyGame().lastPlayedAt?.toISOString(), '2026-03-05T21:00:00.000Z');
  });

  it('el papeleo del alta sigue sin contar aunque el juego tenga sesiones', () => {
    const addedAt = new Date('2026-08-01T10:00:00.000Z');
    const { ptId } = gameWithPlaythrough('Cocoon', {}, { addedAt });
    session(fx.ctx, ptId, '2026-01-15T18:00:00Z', 2);
    event(fx.ctx, ptId, 'completed', addedAt, { datePrecision: 'unknown' });
    const game = onlyGame();
    assert.equal(game.lastPlayedAt?.toISOString(), '2026-01-15T20:00:00.000Z');
    assert.equal(game.currentState, 'completed');
  });

  it('devolverlo al Plan después de jugarlo no adelanta la fecha', () => {
    // El "plan_to_play posterior a la última sesión" de la 1.x: en 2.0 el
    // Plan no escribe en el log, y la lista tampoco ve el juego mientras siga
    // planeado. Al promocionarlo otra vez, la fecha sigue siendo la sesión.
    const gameId = seedGame(fx.ctx, {
      title: 'Tinykin',
      addedAt: new Date('2026-01-01T09:00:00Z'),
    });
    const ptId = seedPlaythrough(fx.ctx, { gameId });
    session(fx.ctx, ptId, '2026-02-01T18:00:00Z', 1);
    fx.ctx.store.create('plan_entries', { gameId, plannedAt: new Date('2026-07-01T00:00:00Z') });
    assert.deepEqual(list(), []);
    fx.ctx.store.remove('plan_entries', gameId);
    assert.equal(onlyGame().lastPlayedAt?.toISOString(), '2026-02-01T19:00:00.000Z');
  });
});

// ══ ESTADO ACTUAL ═════════════════════════════════════════════════════════

describe('getGames · el estado actual derivado del log', () => {
  it('manda el evento más reciente del juego, esté en el playthrough que esté', () => {
    const gameId = seedGame(fx.ctx, { title: 'Skyrim' });
    const first = seedPlaythrough(fx.ctx, { gameId });
    const second = seedPlaythrough(fx.ctx, { gameId });
    event(fx.ctx, first, 'completed', '2026-01-05T00:00:00Z');
    event(fx.ctx, second, 'started', '2026-03-01T00:00:00Z');
    assert.equal(onlyGame().currentState, 'started');
  });

  it('a igualdad de fecha exacta gana el último registrado', () => {
    const { ptId } = gameWithPlaythrough('Celeste');
    event(fx.ctx, ptId, 'on_hold', '2026-02-10T00:00:00Z', { datePrecision: 'day' });
    event(fx.ctx, ptId, 'completed', '2026-02-10T00:00:00Z', { datePrecision: 'day' });
    assert.equal(onlyGame().currentState, 'completed');
  });

  it('el paso por el Plan no es un estado ni tapa un completed del pasado', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Disco Elysium',
      addedAt: new Date('2026-02-01T09:00:00Z'),
      planned: { plannedAt: new Date('2026-01-05T00:00:00Z') },
    });
    fx.ctx.store.remove('plan_entries', gameId);
    const ptId = seedPlaythrough(fx.ctx, { gameId });
    event(fx.ctx, ptId, 'completed', '2023-08-01T00:00:00Z', { datePrecision: 'day' });
    const game = onlyGame();
    assert.equal(game.currentState, 'completed');
    assert.equal(game.lastPlayedAt?.toISOString(), '2023-08-01T00:00:00.000Z');
  });

  it('haber jugado horas no inventa un estado', () => {
    const { ptId } = gameWithPlaythrough('Rocket League');
    session(fx.ctx, ptId, '2026-01-10T18:00:00Z', 4);
    const game = onlyGame();
    assert.equal(game.currentState, null);
    assert.equal(game.totalHours, 4);
  });
});

// ══ QUÉ JUEGOS SALEN, Y EN QUÉ ORDEN ══════════════════════════════════════

describe('getGames · la lista en sí', () => {
  it('los juegos planeados (plan_entries viva) no salen, tengan las horas que tengan', () => {
    const plannedId = seedGame(fx.ctx, { title: 'Aardvark planeado', planned: true });
    const plannedPt = seedPlaythrough(fx.ctx, { gameId: plannedId, manualHours: 50 });
    session(fx.ctx, plannedPt, '2026-01-10T18:00:00Z', 5);
    const { ptId } = gameWithPlaythrough('Zeta jugado');
    session(fx.ctx, ptId, '2026-01-11T18:00:00Z', 2);

    const games = list();
    assert.deepEqual(
      games.map((game) => game.title),
      ['Zeta jugado'],
    );
    assert.equal(games[0].totalHours, 2);
    assert.equal(games[0].sessionCount, 1);
  });

  it('2.0: una entrada del Plan con lápida (promocionado) ya no lo excluye', () => {
    const gameId = seedGame(fx.ctx, { title: 'Promocionado', planned: true });
    fx.ctx.store.remove('plan_entries', gameId);
    assert.deepEqual(
      list().map((game) => game.id),
      [gameId],
    );
  });

  it('orden alfabético insensible a mayúsculas', () => {
    seedGame(fx.ctx, { title: 'zelda' });
    seedGame(fx.ctx, { title: 'Baba Is You' });
    seedGame(fx.ctx, { title: 'animal crossing' });
    seedGame(fx.ctx, { title: 'Celeste' });
    assert.deepEqual(
      list().map((game) => game.title),
      ['animal crossing', 'Baba Is You', 'Celeste', 'zelda'],
    );
  });

  it('cada juego se lleva lo suyo: horas, sesiones y estado no se mezclan', () => {
    const a = gameWithPlaythrough('Alpha');
    session(fx.ctx, a.ptId, '2026-01-10T18:00:00Z', 2);
    event(fx.ctx, a.ptId, 'completed', '2026-01-11T00:00:00Z');
    const b = gameWithPlaythrough('Beta', { manualHours: 7 });
    openSession(fx.ctx, b.ptId, '2026-01-12T18:00:00Z');

    const alpha = gameNamed('Alpha');
    const beta = gameNamed('Beta');
    assert.deepEqual(
      [alpha.totalHours, alpha.sessionCount, alpha.currentState, alpha.isLive],
      [2, 1, 'completed', false],
    );
    assert.deepEqual(
      [beta.totalHours, beta.sessionCount, beta.currentState, beta.isLive],
      [7, 1, null, true],
    );
  });
});

// ══ HORAS MANUALES POR AÑO ════════════════════════════════════════════════

describe('getGames · a qué año se cuelgan las horas manuales', () => {
  it('mandan la fecha de FIN del playthrough, no la de inicio', () => {
    const { ptId } = gameWithPlaythrough('Elden Ring', { manualHours: 90 });
    event(fx.ctx, ptId, 'started', '2022-11-01T12:00:00Z');
    event(fx.ctx, ptId, 'completed', '2023-04-20T12:00:00Z');
    assert.deepEqual(onlyGame().manualIterations, [{ iterationId: ptId, hours: 90, year: 2023 }]);
  });

  it('sin ninguna fecha, las horas manuales no tienen año', () => {
    const { ptId } = gameWithPlaythrough('Terraria', { manualHours: 40 });
    assert.deepEqual(onlyGame().manualIterations, [{ iterationId: ptId, hours: 40, year: null }]);
  });

  it('cada playthrough manual viaja por separado, en orden de creación', () => {
    const gameId = seedGame(fx.ctx, { title: 'Dark Souls' });
    const first = seedPlaythrough(fx.ctx, { gameId, manualHours: 60 });
    const second = seedPlaythrough(fx.ctx, { gameId, customLabel: 'NG+', manualHours: 25 });
    event(fx.ctx, first, 'completed', '2021-06-15T12:00:00Z');
    event(fx.ctx, second, 'dropped', '2024-09-10T12:00:00Z');
    const game = onlyGame();
    assert.deepEqual(game.manualIterations, [
      { iterationId: first, hours: 60, year: 2021 },
      { iterationId: second, hours: 25, year: 2024 },
    ]);
    assert.equal(game.totalHours, 85);
  });

  it('un playthrough en curso cuelga sus horas de la fecha de inicio', () => {
    const { ptId } = gameWithPlaythrough('Baldurs Gate 3', { manualHours: 12 });
    event(fx.ctx, ptId, 'started', '2025-08-20T12:00:00Z');
    assert.deepEqual(onlyGame().manualIterations, [{ iterationId: ptId, hours: 12, year: 2025 }]);
  });

  it('el papeleo del alta no decide el año de las horas manuales', () => {
    const addedAt = new Date('2026-08-01T10:00:00.000Z');
    const { ptId } = gameWithPlaythrough('Half-Life 2', { manualHours: 50 }, { addedAt });
    event(fx.ctx, ptId, 'completed', addedAt, { datePrecision: 'unknown' });
    const game = onlyGame();
    assert.equal(game.lastPlayedAt, null);
    assert.deepEqual(game.manualIterations, [{ iterationId: ptId, hours: 50, year: null }]);
  });

  it('filtrar el papeleo no se lleva por delante una fecha tecleada del mismo playthrough', () => {
    const addedAt = new Date('2026-08-01T10:00:00.000Z');
    const { ptId } = gameWithPlaythrough('Portal 2', { manualHours: 20 }, { addedAt });
    event(fx.ctx, ptId, 'started', '2019-04-10T00:00:00Z', { datePrecision: 'day' });
    event(fx.ctx, ptId, 'completed', addedAt, { datePrecision: 'unknown' });
    const game = onlyGame();
    assert.deepEqual(game.manualIterations, [{ iterationId: ptId, hours: 20, year: 2019 }]);
    assert.equal(game.currentState, 'completed');
  });

  it('una fecha tecleada el mismo día del alta sí ancla las horas manuales', () => {
    const addedAt = new Date('2026-08-01T18:30:00.000Z');
    const { ptId } = gameWithPlaythrough('Stray', { manualHours: 30 }, { addedAt });
    event(fx.ctx, ptId, 'completed', '2026-08-01T00:00:00Z', { datePrecision: 'day' });
    const game = onlyGame();
    assert.deepEqual(game.manualIterations, [{ iterationId: ptId, hours: 30, year: 2026 }]);
    assert.equal(game.lastPlayedAt?.toISOString(), '2026-08-01T00:00:00.000Z');
  });
});

// ══ PROPIOS DEL 2.0 ═══════════════════════════════════════════════════════

describe('getGames · filas vivas y regla F-11', () => {
  it('un juego con lápida no sale, y se lleva lo suyo', () => {
    const gone = gameWithPlaythrough('Borrado');
    session(fx.ctx, gone.ptId, '2026-01-10T18:00:00Z', 5);
    fx.ctx.store.remove('games', gone.gameId);
    gameWithPlaythrough('Vivo');
    assert.deepEqual(
      list().map((game) => game.title),
      ['Vivo'],
    );
  });

  it('las sesiones, eventos y playthroughs con lápida no cuentan', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const kept = seedPlaythrough(fx.ctx, { gameId });
    const removed = seedPlaythrough(fx.ctx, { gameId, manualHours: 30 });
    session(fx.ctx, kept, '2026-01-10T18:00:00Z', 2);
    const deadSession = session(fx.ctx, kept, '2026-01-11T18:00:00Z', 4);
    const deadEvent = event(fx.ctx, kept, 'completed', '2026-01-12T00:00:00Z');
    session(fx.ctx, removed, '2026-01-13T18:00:00Z', 8);
    fx.ctx.store.remove('sessions', deadSession);
    fx.ctx.store.remove('state_events', deadEvent);
    fx.ctx.store.remove('playthroughs', removed);

    const game = onlyGame();
    assert.equal(game.totalHours, 2);
    assert.equal(game.sessionCount, 1);
    assert.equal(game.currentState, null);
    assert.deepEqual(game.manualIterations, []);
    assert.equal(game.lastPlayedAt?.toISOString(), '2026-01-10T20:00:00.000Z');
  });

  it('F-11: sesión y evento VIVOS de un playthrough con lápida (sync a medias) no cuentan', () => {
    const gameId = seedGame(fx.ctx, { title: 'Celeste' });
    const kept = seedPlaythrough(fx.ctx, { gameId });
    const orphaned = seedPlaythrough(fx.ctx, { gameId });
    session(fx.ctx, kept, '2026-01-10T18:00:00Z', 1);
    session(fx.ctx, orphaned, '2026-02-10T18:00:00Z', 6);
    openSession(fx.ctx, orphaned, '2026-02-11T18:00:00Z');
    event(fx.ctx, orphaned, 'completed', '2026-02-12T00:00:00Z');
    // Solo la lápida del padre, sin la cascada: los hijos siguen vivos.
    tombstoneOnly(fx.ctx, 'playthroughs', orphaned);

    const game = onlyGame();
    assert.equal(game.totalHours, 1);
    assert.equal(game.sessionCount, 1);
    assert.equal(game.isLive, false);
    assert.equal(game.currentState, null);
  });

  it('F-11: playthrough vivo de un juego con lápida sin cascada no sale en ningún juego', () => {
    const gone = gameWithPlaythrough('Borrado');
    session(fx.ctx, gone.ptId, '2026-01-10T18:00:00Z', 5);
    tombstoneOnly(fx.ctx, 'games', gone.gameId);
    gameWithPlaythrough('Vivo');
    const games = list();
    assert.deepEqual(
      games.map((game) => [game.title, game.totalHours]),
      [['Vivo', 0]],
    );
  });
});

describe('getGames · valores efectivos e instalación', () => {
  it('carátula, banner y géneros: el override del usuario manda sobre la caché', () => {
    const metadata = {
      coverUrl: 'https://img/cache-cover.jpg',
      heroUrl: 'https://img/cache-hero.jpg',
      genres: ['Platform'],
      releaseYear: 2018,
      hltbMain: 8,
      hltbMainExtras: 19.5,
      hltbCompletionist: 40,
    };
    seedGame(fx.ctx, { title: 'Automático', igdbId: 26226, steamAppId: 504230, metadata });
    seedGame(fx.ctx, {
      title: 'Elegido',
      metadata,
      coverOverride: 'https://img/mia.jpg',
      heroOverride: 'https://img/mia-hero.jpg',
      genresOverride: ['Indie'],
    });

    const auto = gameNamed('Automático');
    assert.equal(auto.coverUrl, metadata.coverUrl);
    assert.equal(auto.heroUrl, metadata.heroUrl);
    assert.deepEqual(auto.genres, ['Platform']);
    assert.equal(auto.igdbId, 26226);
    assert.equal(auto.steamAppId, 504230);
    assert.equal(auto.releaseYear, 2018);
    assert.deepEqual([auto.hltbMain, auto.hltbMainExtras, auto.hltbCompletionist], [8, 19.5, 40]);

    const mine = gameNamed('Elegido');
    assert.equal(mine.coverUrl, 'https://img/mia.jpg');
    assert.equal(mine.heroUrl, 'https://img/mia-hero.jpg');
    assert.deepEqual(mine.genres, ['Indie']);
  });

  it('executablePath es el de ESTE PC; el de otra máquina no sale', () => {
    const here = seedGame(fx.ctx, { title: 'Aquí', install: { executablePath: 'C:\\A\\a.exe' } });
    const there = seedGame(fx.ctx, { title: 'Allí' });
    const other = asOtherDevice(fx.ctx);
    other.seedInstall({ gameId: there, executablePath: 'D:\\B\\b.exe' });
    other.seedInstall({ gameId: here, executablePath: 'D:\\otra.exe' });

    assert.equal(gameNamed('Aquí').executablePath, 'C:\\A\\a.exe');
    assert.equal(gameNamed('Allí').executablePath, null);
  });

  it('addedAt, promotedAt, endless e isEmulated viajan tal cual', () => {
    seedGame(fx.ctx, {
      title: 'Hades',
      addedAt: new Date('2025-01-01T00:00:00Z'),
      promotedAt: new Date('2025-02-01T00:00:00Z'),
      endless: true,
      isEmulated: true,
    });
    const game = onlyGame();
    assert.equal(game.addedAt.toISOString(), '2025-01-01T00:00:00.000Z');
    assert.equal(game.promotedAt?.toISOString(), '2025-02-01T00:00:00.000Z');
    assert.equal(game.endless, true);
    assert.equal(game.isEmulated, true);
  });
});

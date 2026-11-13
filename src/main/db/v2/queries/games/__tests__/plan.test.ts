import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { gameIdForIgdb, gameInstallId } from '../../../../../../shared/sync/ids';
import { count, markClean, rawRow } from '../../../__tests__/helpers';
import { playthroughPositions, readGameRow } from '../../common';
import {
  T0,
  at,
  day,
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSaveBackup,
  seedSession,
  seedSpendEvent,
  seedStateEvent,
  seedUnlock,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { createGameWithDetails } from '../createGameWithDetails';
import { createPlannedGame } from '../createPlannedGame';
import { deleteGame } from '../deleteGame';
import { isGameWriteError } from '../errors';
import { canMoveToPlan, moveToPlan } from '../moveToPlan';
import { reorderUpNext, setPlanPinned } from '../planPins';
import { promotePlannedGame } from '../promotePlannedGame';
import { EUR, createInput, enrichment, planInput, promoteInput, steamEnrichment } from './helpers';

// El Plan en 2.0: alta, promoción, vuelta al Plan (R-06), Up next. Referencias
// 1.x: `plan.test.ts` (alta, pin, reorden, promoción) y `moveToPlan.test.ts`.
// Las lecturas del Plan (lista, extras, notas) son de P1 y no se portan aquí.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

type Row = Record<string, unknown>;
const all = (query: string, ...params: (string | number)[]): Row[] =>
  fx.local.db.$client.prepare(query).all(...params) as Row[];
const playthroughsOf = (gameId: string): Row[] =>
  all('SELECT * FROM playthroughs WHERE gameId = ? ORDER BY syncCreated, id', gameId);
const liveEventsOf = (gameId: string): Row[] =>
  all(
    `SELECT e.* FROM state_events e JOIN playthroughs p ON p.id = e.playthroughId
     WHERE p.gameId = ? AND e.syncDeleted IS NULL ORDER BY e.syncCreated, e.id`,
    gameId,
  );
const plan = (gameId: string): Row | undefined => rawRow(fx.local, 'plan_entries', gameId);
const pinnedAtOf = (gameId: string): number | null => (plan(gameId)?.pinnedAt as number) ?? null;

/** Un juego en el Plan, montado con las fixtures (sin depender del alta). */
const planned = (
  title: string,
  options: { pinnedAt?: Date | null; note?: string | null; plannedAt?: Date } = {},
): string => seedGame(fx.ctx, { title, planned: options });

const DAY = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

// ══ EL ALTA EN EL PLAN ══════════════════════════════════════════════════════

describe('createPlannedGame', () => {
  it('deja el juego planeado con su porqué en plan_entries, sin playthrough ni plan_to_play [S]', () => {
    const game = createPlannedGame(
      fx.ctx,
      planInput({ note: 'Me lo recomendó Dani', gameNotes: 'La edición física está agotada' }),
      enrichment(),
    );
    assert.equal(game.id, gameIdForIgdb(20001));
    assert.equal(game.planned, true);
    assert.equal(game.title, 'Silksong');
    // Las dos notas no se pisan: el porqué va al Plan; las del juego, a games.
    assert.equal(game.notes, 'La edición física está agotada');
    assert.equal(plan(game.id)?.note, 'Me lo recomendó Dani');
    assert.equal(plan(game.id)?.plannedAt, T0);
    // El enriquecimiento aterriza entero.
    assert.equal(game.coverUrl, 'https://covers/silksong.jpg');
    assert.equal(game.steamGridDbId, 5555);
    // Nada de Up next por el alta.
    assert.equal(game.planPinnedAt, null);
    // Ni iteración vacía ni evento: el primer playthrough lo crea la promoción.
    assert.equal(count(fx.local, 'playthroughs'), 0);
    assert.equal(count(fx.local, 'state_events'), 0);
    assert.equal(count(fx.local, 'spend_events'), 0);
    assert.equal(count(fx.local, 'sessions'), 0);
  });

  it('sin nota no consta nada: la columna se omite (H-2)', () => {
    const game = createPlannedGame(fx.ctx, planInput({ note: null }), enrichment());
    const clocks = JSON.parse(String(plan(game.id)?.syncFields)) as Record<string, string>;
    assert.ok('note' in clocks && 'pinnedAt' in clocks);
  });

  it('un juego de Steam sin igdbId se planea con id aleatorio', () => {
    const game = createPlannedGame(
      fx.ctx,
      planInput({ source: { steamAppId: 99 } }),
      steamEnrichment(),
    );
    assert.equal(game.planned, true);
    assert.equal(game.igdbId, null);
    assert.equal(rawRow(fx.local, 'games', game.id)?.saveKey, game.id);
  });

  it('ya en la biblioteca: already_exists, sin escribir', () => {
    createGameWithDetails(fx.ctx, createInput(), enrichment(), EUR);
    assert.throws(
      () => createPlannedGame(fx.ctx, planInput(), enrichment()),
      (error) => isGameWriteError(error, 'already_exists'),
    );
    assert.equal(count(fx.local, 'plan_entries'), 0);
  });

  it('planear un juego borrado lo resucita planeado, con la nota nueva y sin el pin de antes', () => {
    const first = createPlannedGame(fx.ctx, planInput({ note: 'Antes' }), enrichment());
    setPlanPinned(fx.ctx, first.id, true);
    deleteGame(fx.ctx, first.id);
    fx.wall.advance(1_000);
    const again = createPlannedGame(fx.ctx, planInput({ note: null }), enrichment());
    assert.equal(again.id, first.id);
    assert.equal(again.planned, true);
    assert.equal(again.planPinnedAt, null);
    assert.equal(plan(again.id)?.note, null);
    assert.equal(plan(again.id)?.plannedAt, T0 + 1_000);
  });
});

// ══ PROMOCIONAR ════════════════════════════════════════════════════════════

describe('promotePlannedGame', () => {
  it('lápida a la entrada del Plan (conserva plannedAt y nota) y promotedAt = ahora (R-06)', () => {
    const gameId = planned('Silksong', { note: 'Me lo recomendó Dani', plannedAt: day(-30) });
    const addedAt = rawRow(fx.local, 'games', gameId)?.addedAt;
    fx.wall.advance(5_000);
    const game = promotePlannedGame(fx.ctx, promoteInput(gameId, { hoursPlayed: 4.5 }), EUR);
    assert.equal(game.id, gameId);
    assert.equal(game.planned, false);
    assert.deepEqual(game.promotedAt, at(5_000));
    // addedAt no se toca: de él sale la espera del Plan.
    assert.equal(game.addedAt.getTime(), addedAt);
    const entry = plan(gameId);
    assert.notEqual(entry?.syncDeleted, null);
    assert.equal(entry?.plannedAt, day(-30).getTime());
    assert.equal(entry?.note, 'Me lo recomendó Dani');
  });

  it('crea el primer playthrough con lo que pregunta el modal [S]', () => {
    const gameId = planned('Silksong');
    promotePlannedGame(fx.ctx, promoteInput(gameId, { hoursPlayed: 4.5 }), EUR);
    const pts = playthroughsOf(gameId);
    assert.equal(pts.length, 1);
    assert.deepEqual(
      [pts[0].playedPlatform, pts[0].origin, pts[0].format, pts[0].manualHours, pts[0].customLabel],
      ['Nintendo Switch', 'Gift', 'physical', 4.5, null],
    );
  });

  it('R-07: el papeleo sin fechas se ancla en promotedAt con precisión unknown', () => {
    const gameId = planned('Silksong', { plannedAt: day(-200) });
    fx.wall.advance(7_000);
    promotePlannedGame(
      fx.ctx,
      promoteInput(gameId, { initialStatus: 'completed', hoursPlayed: 50 }),
      EUR,
    );
    assert.deepEqual(
      liveEventsOf(gameId).map((e) => [e.type, e.occurredAt, e.datePrecision]),
      [['completed', T0 + 7_000, 'unknown']],
    );
  });

  it('SPEC 4.5: un estado terminal estrena "started" por delante, y la nota va en el elegido', () => {
    const gameId = planned('Silksong');
    promotePlannedGame(
      fx.ctx,
      promoteInput(gameId, {
        initialStatus: 'completed',
        started: { date: DAY('2026-01-05'), precision: 'day' },
        finished: { date: DAY('2026-02-10'), precision: 'day' },
        note: 'Final verdadero a la segunda',
      }),
      EUR,
    );
    assert.deepEqual(
      liveEventsOf(gameId).map((e) => [e.type, e.occurredAt, e.note]),
      [
        ['started', DAY('2026-01-05').getTime(), null],
        ['completed', DAY('2026-02-10').getTime(), 'Final verdadero a la segunda'],
      ],
    );
    assert.equal(count(fx.local, 'sessions'), 0);
  });

  it('sin estado inicial no hay eventos, y el gasto solo si lo hubo, con fecha y precisión', () => {
    const quiet = planned('Silksong');
    promotePlannedGame(fx.ctx, promoteInput(quiet), EUR);
    assert.equal(liveEventsOf(quiet).length, 0);
    assert.equal(count(fx.local, 'spend_events'), 0);

    const paid = planned('Hades');
    promotePlannedGame(
      fx.ctx,
      promoteInput(paid, {
        moneySpent: 19.99,
        moneySpentDate: { date: DAY('2026-06-01'), precision: 'month' },
      }),
      EUR,
    );
    const [spend] = all('SELECT * FROM spend_events WHERE gameId = ?', paid);
    assert.deepEqual(
      [spend.type, spend.amount, spend.currency, spend.occurredAt, spend.datePrecision],
      ['purchase', 19.99, 'EUR', DAY('2026-06-01').getTime(), 'month'],
    );
  });

  it('el pin de Up next no sobrevive a la promoción', () => {
    const gameId = planned('Silksong', { pinnedAt: day(-1) });
    const game = promotePlannedGame(fx.ctx, promoteInput(gameId), EUR);
    assert.equal(game.planPinnedAt, null);
    assert.equal(game.planned, false);
  });

  it('el arte, SteamGridDB y las notas del Plan sobreviven si el modal no trae elección; si la trae, manda', () => {
    const gameId = seedGame(fx.ctx, {
      title: 'Silksong',
      planned: true,
      coverOverride: 'cover-del-plan',
      heroOverride: 'hero-del-plan',
      sgdbId: 5555,
      sgdbIdSource: 'manual',
      notes: 'Comprarlo en físico',
    });
    let game = promotePlannedGame(
      fx.ctx,
      promoteInput(gameId, { coverUrl: '', gameNotes: null }),
      EUR,
    );
    assert.deepEqual(
      [game.coverUrl, game.heroUrl, game.steamGridDbId, game.notes],
      ['cover-del-plan', 'hero-del-plan', 5555, 'Comprarlo en físico'],
    );

    moveToPlan(fx.ctx, gameId);
    game = promotePlannedGame(
      fx.ctx,
      promoteInput(gameId, {
        coverUrl: 'cover-elegida',
        heroUrl: 'hero-elegida',
        steamGridDbId: 77,
        gameNotes: 'Al final, digital',
      }),
      EUR,
    );
    assert.deepEqual(
      [game.coverUrl, game.heroUrl, game.steamGridDbId, game.notes],
      ['cover-elegida', 'hero-elegida', 77, 'Al final, digital'],
    );

    // La cadena vacía en las notas SÍ se escribe: solo null es "sin elección".
    moveToPlan(fx.ctx, gameId);
    game = promotePlannedGame(fx.ctx, promoteInput(gameId, { gameNotes: '' }), EUR);
    assert.equal(game.notes, '');
  });

  it('endless, emulado y la instalación de este PC van con la promoción', () => {
    const gameId = planned('Silksong');
    const game = promotePlannedGame(
      fx.ctx,
      promoteInput(gameId, {
        endless: true,
        isEmulated: true,
        executablePath: 'C:\\S\\s.exe',
        installDirectory: 'C:\\S',
        installSizeBytes: 10,
      }),
      EUR,
    );
    assert.equal(game.endless, true);
    assert.equal(game.isEmulated, true);
    assert.equal(game.executablePath, 'C:\\S\\s.exe');
    assert.equal(
      rawRow(fx.local, 'game_installs', gameInstallId(gameId, fx.ctx.deviceId))?.lastVerifiedAt,
      T0,
    );
  });

  it('promocionar dos veces no cuela y no deja nada a medias', () => {
    const gameId = planned('Silksong');
    promotePlannedGame(
      fx.ctx,
      promoteInput(gameId, {
        initialStatus: 'started',
        started: { date: DAY('2026-01-05'), precision: 'day' },
        moneySpent: 19.99,
      }),
      EUR,
    );
    assert.throws(
      () => promotePlannedGame(fx.ctx, promoteInput(gameId, { initialStatus: 'completed' }), EUR),
      (error) =>
        isGameWriteError(error, 'not_planned') && /no está en Plan to Play/.test(error.message),
    );
    assert.deepEqual(
      liveEventsOf(gameId).map((e) => e.type),
      ['started'],
    );
    assert.equal(count(fx.local, 'spend_events'), 1);
    assert.equal(playthroughsOf(gameId).length, 1);

    assert.throws(
      () => promotePlannedGame(fx.ctx, promoteInput('no-existe'), EUR),
      (error) =>
        isGameWriteError(error, 'not_found') && /No existe el juego no-existe/.test(error.message),
    );
    const deleted = planned('Borrado');
    deleteGame(fx.ctx, deleted);
    assert.throws(
      () => promotePlannedGame(fx.ctx, promoteInput(deleted), EUR),
      (error) => isGameWriteError(error, 'not_found'),
    );
  });

  it('todo o nada: un fallo a mitad no deja ni la lápida del Plan', () => {
    const gameId = planned('Silksong');
    assert.throws(() =>
      promotePlannedGame(fx.ctx, promoteInput(gameId, { hoursPlayed: Number.NaN }), EUR),
    );
    assert.equal(plan(gameId)?.syncDeleted, null);
    assert.equal(rawRow(fx.local, 'games', gameId)?.promotedAt, null);
    assert.equal(count(fx.local, 'playthroughs'), 0);
  });
});

// ══ DEVOLVER AL PLAN ═══════════════════════════════════════════════════════

/** Un juego de la biblioteca recién añadido, con su playthrough vacío. */
const library = (
  title: string,
  extra: Parameters<typeof seedGame>[1] = { title },
): {
  gameId: string;
  playthroughId: string;
} => {
  const gameId = seedGame(fx.ctx, { ...extra, title });
  return { gameId, playthroughId: seedPlaythrough(fx.ctx, { gameId }) };
};

describe('moveToPlan', () => {
  it('resucita la entrada con plannedAt nuevo, promotedAt a null; conserva juego, alta, playthrough y compra', () => {
    const { gameId, playthroughId } = library('Comprado sin jugar', {
      title: 'x',
      addedAt: day(-400),
      promotedAt: day(-100),
      coverOverride: 'cover-del-plan',
      notes: 'Jugarlo en vacaciones',
    });
    seedSpendEvent(fx.ctx, { gameId, amount: 19.99 });
    assert.equal(canMoveToPlan(fx.ctx, gameId), true);
    fx.wall.advance(3_000);

    const moved = moveToPlan(fx.ctx, gameId);
    assert.equal(moved.planned, true);
    assert.equal(moved.promotedAt, null);
    assert.deepEqual(moved.addedAt, day(-400));
    assert.equal(moved.coverUrl, 'cover-del-plan');
    assert.equal(moved.notes, 'Jugarlo en vacaciones');
    assert.equal(plan(gameId)?.plannedAt, T0 + 3_000);
    assert.equal(canMoveToPlan(fx.ctx, gameId), false);
    // El playthrough vacío se conserva (desviación de la nota 1, ver moveToPlan.ts).
    assert.deepEqual(
      playthroughsOf(gameId).map((pt) => [pt.id, pt.syncDeleted]),
      [[playthroughId, null]],
    );
    assert.equal(count(fx.local, 'spend_events', 'syncDeleted IS NULL'), 1);
  });

  it('IDA Y VUELTA varias veces: dos momentos visibles cada vez, la nota se conserva y sigue siendo "Playthrough 1"', () => {
    const gameId = createPlannedGame(fx.ctx, planInput({ note: 'El porqué' }), enrichment()).id;
    for (let round = 1; round <= 3; round++) {
      fx.wall.advance(60_000);
      const promoted = promotePlannedGame(fx.ctx, promoteInput(gameId), EUR);
      const promotedAt = fx.ctx.now().getTime();
      assert.equal(promoted.planned, false, `vuelta ${round}`);
      assert.equal(promoted.promotedAt?.getTime(), promotedAt);
      assert.notEqual(plan(gameId)?.syncDeleted, null);
      assert.equal(plan(gameId)?.note, 'El porqué');

      fx.wall.advance(60_000);
      const back = moveToPlan(fx.ctx, gameId);
      assert.equal(back.planned, true, `vuelta ${round}`);
      assert.equal(back.promotedAt, null);
      assert.equal(back.planPinnedAt, null);
      assert.equal(plan(gameId)?.syncDeleted, null);
      assert.equal(plan(gameId)?.plannedAt, fx.ctx.now().getTime());
      assert.equal(plan(gameId)?.note, 'El porqué');
    }
    // Un solo playthrough en toda la historia: la promoción reutiliza el vacío.
    const pts = playthroughsOf(gameId);
    assert.equal(pts.length, 1);
    assert.equal(playthroughPositions(fx.ctx, [gameId]).get(String(pts[0].id)), 1);
    // Y una última promoción lo deja en la biblioteca.
    assert.equal(promotePlannedGame(fx.ctx, promoteInput(gameId), EUR).planned, false);
  });

  it('volver al Plan suelta el pin que tuviera la entrada', () => {
    const gameId = planned('Silksong', { pinnedAt: day(-1) });
    promotePlannedGame(fx.ctx, promoteInput(gameId), EUR);
    assert.equal(moveToPlan(fx.ctx, gameId).planPinnedAt, null);
    assert.equal(pinnedAtOf(gameId), null);
  });

  it('sin ningún playthrough vivo también se puede (no hay nada que perder)', () => {
    const { gameId, playthroughId } = library('Silksong');
    fx.ctx.store.remove('playthroughs', playthroughId);
    assert.equal(canMoveToPlan(fx.ctx, gameId), true);
    assert.equal(moveToPlan(fx.ctx, gameId).planned, true);
    // Y al promocionar se crea uno nuevo.
    promotePlannedGame(fx.ctx, promoteInput(gameId), EUR);
    assert.equal(playthroughsOf(gameId).filter((pt) => pt.syncDeleted === null).length, 1);
  });

  it('rechaza un juego que ganó una sesión después de abrir la ficha', () => {
    const { gameId, playthroughId } = library('Silksong');
    assert.equal(canMoveToPlan(fx.ctx, gameId), true);
    seedSession(fx.ctx, { playthroughId });
    assert.throws(
      () => moveToPlan(fx.ctx, gameId),
      (error) => isGameWriteError(error, 'cannot_move_to_plan'),
    );
    assert.equal(readGameRow(fx.ctx, gameId)?.planned, false);
    assert.equal(count(fx.local, 'plan_entries'), 0);
  });

  it('rechaza un juego ya planeado, y uno que no existe', () => {
    const gameId = planned('Silksong');
    markClean(fx.local, 'plan_entries');
    assert.throws(
      () => moveToPlan(fx.ctx, gameId),
      (error) =>
        isGameWriteError(error, 'cannot_move_to_plan') &&
        error.message === 'This game has play records or is already in Plan to Play.',
    );
    assert.equal(count(fx.local, 'plan_entries', 'syncDirty = 1'), 0);
    assert.throws(
      () => moveToPlan(fx.ctx, 'no-existe'),
      (error) => isGameWriteError(error, 'not_found'),
    );
  });

  const blockers: [string, (gameId: string, playthroughId: string) => void][] = [
    ['un estado real', (_g, pt) => void seedStateEvent(fx.ctx, { playthroughId: pt })],
    ['horas manuales', (_g, pt) => void fx.ctx.store.patch('playthroughs', pt, { manualHours: 2 })],
    ['una valoración', (_g, pt) => void fx.ctx.store.patch('playthroughs', pt, { rating: 4 })],
    [
      'contenido extra',
      (_g, pt) => void fx.ctx.store.patch('playthroughs', pt, { extraContent: true }),
    ],
    ['otro playthrough', (gameId) => void seedPlaythrough(fx.ctx, { gameId })],
    ['una sesión', (_g, pt) => void seedSession(fx.ctx, { playthroughId: pt })],
    [
      'gasto dentro del juego',
      (gameId) => void seedSpendEvent(fx.ctx, { gameId, type: 'ingame_spend', amount: 4.99 }),
    ],
    ['un logro desbloqueado', (gameId) => void seedUnlock(fx.ctx, { gameId, apiName: 'ACH_1' })],
    ['una copia de partida', (gameId) => void seedSaveBackup(fx.ctx, { gameId })],
  ];
  for (const [label, addRecord] of blockers) {
    it(`no ofrece ni ejecuta la vuelta si hay ${label}`, () => {
      const { gameId, playthroughId } = library('Silksong');
      addRecord(gameId, playthroughId);
      assert.equal(canMoveToPlan(fx.ctx, gameId), false);
      assert.throws(
        () => moveToPlan(fx.ctx, gameId),
        (error) => isGameWriteError(error),
      );
      assert.equal(readGameRow(fx.ctx, gameId)?.planned, false);
    });
  }

  it('lo que tiene lápida no bloquea: un evento, una sesión o un logro borrados', () => {
    const { gameId, playthroughId } = library('Silksong');
    fx.ctx.store.remove('state_events', seedStateEvent(fx.ctx, { playthroughId }));
    fx.ctx.store.remove('sessions', seedSession(fx.ctx, { playthroughId }));
    fx.ctx.store.remove('achievement_unlocks', seedUnlock(fx.ctx, { gameId, apiName: 'ACH_1' }));
    fx.ctx.store.remove('playthroughs', seedPlaythrough(fx.ctx, { gameId, rating: 5 }));
    assert.equal(canMoveToPlan(fx.ctx, gameId), true);
  });

  it('un juego borrado no se puede devolver', () => {
    const { gameId } = library('Silksong');
    deleteGame(fx.ctx, gameId);
    assert.equal(canMoveToPlan(fx.ctx, gameId), false);
  });
});

// ══ UP NEXT ═══════════════════════════════════════════════════════════════

describe('setPlanPinned', () => {
  it('fijar pone marca (ahora o la indicada) y soltar la quita', () => {
    const gameId = planned('Silksong');
    assert.equal(setPlanPinned(fx.ctx, gameId, true), true);
    assert.equal(pinnedAtOf(gameId), T0);
    assert.equal(setPlanPinned(fx.ctx, gameId, false), true);
    assert.equal(pinnedAtOf(gameId), null);
    assert.equal(setPlanPinned(fx.ctx, gameId, true, at(-5)), true);
    assert.equal(pinnedAtOf(gameId), T0 - 5);
  });

  it('volver a fijar te manda al final de la estantería', () => {
    const gameId = planned('Silksong', { pinnedAt: DAY('2000-01-01') });
    setPlanPinned(fx.ctx, gameId, false);
    fx.wall.advance(1);
    setPlanPinned(fx.ctx, gameId, true);
    assert.equal(pinnedAtOf(gameId), T0 + 1);
  });

  it('un juego ya promocionado no se fija ni se suelta: false y su entrada no se toca', () => {
    const gameId = planned('Celeste', { pinnedAt: day(-3) });
    fx.ctx.store.remove('plan_entries', gameId);
    markClean(fx.local, 'plan_entries');
    assert.equal(setPlanPinned(fx.ctx, gameId, true), false);
    assert.equal(setPlanPinned(fx.ctx, gameId, false), false);
    assert.equal(pinnedAtOf(gameId), day(-3).getTime());
    assert.equal(count(fx.local, 'plan_entries', 'syncDirty = 1'), 0);
    assert.equal(setPlanPinned(fx.ctx, 'no-existe', true), false);
  });

  it('un juego borrado (entrada viva solo por F-11) tampoco', () => {
    const gameId = planned('Celeste');
    deleteGame(fx.ctx, gameId);
    assert.equal(setPlanPinned(fx.ctx, gameId, true), false);
  });

  it('fijar con la misma marca no escribe (F-33)', () => {
    const gameId = planned('Silksong', { pinnedAt: day(-1) });
    markClean(fx.local, 'plan_entries');
    assert.equal(setPlanPinned(fx.ctx, gameId, true, day(-1)), true);
    assert.equal(count(fx.local, 'plan_entries', 'syncDirty = 1'), 0);
  });
});

const T1 = DAY('2026-03-01');
const T2 = DAY('2026-03-02');
const T3 = DAY('2026-03-03');

describe('reorderUpNext', () => {
  it('reparte las marcas que YA existen: las mismas fechas, en el orden nuevo', () => {
    const alpha = planned('Alpha', { pinnedAt: T1 });
    const beta = planned('Beta', { pinnedAt: T2 });
    const cosmo = planned('Cosmo', { pinnedAt: T3 });
    assert.equal(reorderUpNext(fx.ctx, [cosmo, alpha, beta]), true);
    assert.deepEqual(
      [pinnedAtOf(cosmo), pinnedAtOf(alpha), pinnedAtOf(beta)],
      [T1.getTime(), T2.getTime(), T3.getTime()],
    );
  });

  it('dos fijados en el mismo milisegundo se separan por uno', () => {
    const alpha = planned('Alpha', { pinnedAt: T1 });
    const beta = planned('Beta', { pinnedAt: T1 });
    const cosmo = planned('Cosmo', { pinnedAt: T1 });
    assert.equal(reorderUpNext(fx.ctx, [cosmo, beta, alpha]), true);
    assert.deepEqual(
      [pinnedAtOf(cosmo), pinnedAtOf(beta), pinnedAtOf(alpha)],
      [T1.getTime(), T1.getTime() + 1, T1.getTime() + 2],
    );
  });

  it('con menos de dos fijados devuelve false y no toca nada', () => {
    const alpha = planned('Alpha', { pinnedAt: T1 });
    const loose = planned('Beta');
    assert.equal(reorderUpNext(fx.ctx, []), false);
    assert.equal(reorderUpNext(fx.ctx, [alpha]), false);
    assert.equal(reorderUpNext(fx.ctx, [alpha, loose]), false);
    assert.equal(pinnedAtOf(alpha), T1.getTime());
    assert.equal(pinnedAtOf(loose), null);
  });

  it('los ids desconocidos se ignoran', () => {
    const alpha = planned('Alpha', { pinnedAt: T1 });
    const beta = planned('Beta', { pinnedAt: T2 });
    assert.equal(reorderUpNext(fx.ctx, [beta, 'no-existe', alpha]), true);
    assert.deepEqual([pinnedAtOf(beta), pinnedAtOf(alpha)], [T1.getTime(), T2.getTime()]);
  });

  it('un juego que ya no está en el Plan no entra en el reparto aunque conserve su marca', () => {
    const ghost = planned('Ghost', { pinnedAt: T3 });
    fx.ctx.store.remove('plan_entries', ghost);
    const alpha = planned('Alpha', { pinnedAt: T1 });
    const beta = planned('Beta', { pinnedAt: T2 });
    assert.equal(reorderUpNext(fx.ctx, [ghost, beta, alpha]), true);
    assert.equal(pinnedAtOf(ghost), T3.getTime());
    assert.deepEqual([pinnedAtOf(beta), pinnedAtOf(alpha)], [T1.getTime(), T2.getTime()]);
  });

  it('a los fijados que no le mandaste no los toca (ni los escribe)', () => {
    const alpha = planned('Alpha', { pinnedAt: T1 });
    const beta = planned('Beta', { pinnedAt: T2 });
    const cosmo = planned('Cosmo', { pinnedAt: T3 });
    markClean(fx.local, 'plan_entries');
    assert.equal(reorderUpNext(fx.ctx, [cosmo, alpha]), true);
    assert.deepEqual(
      [pinnedAtOf(cosmo), pinnedAtOf(alpha), pinnedAtOf(beta)],
      [T1.getTime(), T3.getTime(), T2.getTime()],
    );
    assert.equal(rawRow(fx.local, 'plan_entries', beta)?.syncDirty, 0);
  });

  it('un id repetido no finge una estantería de dos, ni roba sitio en un reorden de verdad', () => {
    const alpha = planned('Alpha', { pinnedAt: T1 });
    assert.equal(reorderUpNext(fx.ctx, [alpha, alpha]), false);
    assert.equal(pinnedAtOf(alpha), T1.getTime());
    const beta = planned('Beta', { pinnedAt: T2 });
    assert.equal(reorderUpNext(fx.ctx, [beta, alpha, beta]), true);
    assert.deepEqual([pinnedAtOf(beta), pinnedAtOf(alpha)], [T1.getTime(), T2.getTime()]);
  });
});

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { achievementUnlockId } from '../../../../../../shared/sync/ids';
import {
  LOCAL,
  OTHER,
  asOtherDevice,
  openQueryDb,
  seedCatalog,
  seedGame,
  seedUnlock,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { markSteamUnlocksSynced, storeUnlocks, type UnlockInput } from '../storeUnlocks';
import { readCheck } from '../../common/checks';
import {
  catalogue,
  onlyStored,
  openSession,
  playthrough,
  session,
  storedFor,
  syncUpdatedOf,
} from './helpers';

// Port del antiguo steam/__tests__/storeUnlocks.test.ts (1.x, retirado) al esquema 2.0,
// caso por caso, más los propios del 2.0 (origen por PC, R-15, guardas de
// identidad, "no escribe si nada cambia"). La vía `emu` de la 1.x es aquí
// `feed: 'emu'`, que escribe filas `emu@<este PC>` del catálogo de Steam.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const FALLBACK = new Date('2026-03-01T12:00:00Z');
const EMU = `emu@${LOCAL}`;

const unlock = (apiName: string, iso: string | null): UnlockInput => ({
  apiName,
  unlockedAt: iso === null ? null : new Date(iso),
});
const sameSecond = (iso: string, ...apiNames: string[]): UnlockInput[] =>
  apiNames.map((apiName) => unlock(apiName, iso));

type Feed = 'steam' | 'emu' | 'ra';
const store = (
  gameId: string,
  feed: Feed,
  unlocks: UnlockInput[],
  fallbackDate = FALLBACK,
  extra: { expectedAppId?: number; expectedRaGameId?: number } = {},
): ReturnType<typeof storeUnlocks> =>
  storeUnlocks(fx.ctx, { gameId, feed, unlocks, fallbackDate, ...extra });

const announced = (fresh: { displayName: string }[]): string[] =>
  fresh.map((toast) => toast.displayName).sort();

const game = (title = 'Juego'): string => seedGame(fx.ctx, { title });

// ══ 1. QUÉ ES NUEVO ════════════════════════════════════════════════════════

describe('storeUnlocks: solo es nuevo lo que no constaba ya', () => {
  it('la primera tanda se anuncia entera; repetirla no anuncia nada', () => {
    const gameId = game('Hollow Knight');
    catalogue(fx.ctx, gameId, ['GRIMM', 'HORNET']);
    const tanda = [
      unlock('GRIMM', '2026-01-10T18:30:00Z'),
      unlock('HORNET', '2026-01-10T19:00:00Z'),
    ];

    assert.deepEqual(announced(store(gameId, 'steam', tanda)), ['Logro GRIMM', 'Logro HORNET']);
    assert.deepEqual(store(gameId, 'steam', tanda), []);
    assert.equal(storedFor(fx.ctx, gameId).length, 2);
  });

  it('en una tanda mixta se anuncia solo el que faltaba', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['A', 'B', 'C']);
    store(gameId, 'steam', [
      unlock('A', '2026-01-10T18:00:00Z'),
      unlock('B', '2026-01-10T18:10:00Z'),
    ]);
    const fresh = store(gameId, 'steam', [
      unlock('A', '2026-01-10T18:00:00Z'),
      unlock('B', '2026-01-10T18:10:00Z'),
      unlock('C', '2026-01-10T18:20:00Z'),
    ]);
    assert.deepEqual(announced(fresh), ['Logro C']);
    assert.equal(storedFor(fx.ctx, gameId).length, 3);
  });

  it('lo que ya constaba por OTRO origen no vuelve a ser nuevo, aunque guarde su propia fila', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['GRIMM']);
    assert.equal(store(gameId, 'emu', [unlock('GRIMM', '2026-01-10T18:30:00Z')]).length, 1);
    assert.deepEqual(store(gameId, 'steam', [unlock('GRIMM', '2026-01-10T18:31:00Z')]), []);
    assert.deepEqual(
      storedFor(fx.ctx, gameId).map((row) => [row.origin, row.unlockedAt]),
      [
        [EMU, '2026-01-10T18:30:00.000Z'],
        ['steam', '2026-01-10T18:31:00.000Z'],
      ],
    );
  });

  it('un desbloqueo que no está en el catálogo se ignora entero, sin fila y sin aviso', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['EXISTE']);
    const fresh = store(gameId, 'emu', [
      unlock('EXISTE', '2026-01-10T18:00:00Z'),
      unlock('FANTASMA', '2026-01-10T18:05:00Z'),
    ]);
    assert.deepEqual(announced(fresh), ['Logro EXISTE']);
    assert.equal(onlyStored(fx.ctx, gameId).apiName, 'EXISTE');
  });

  it('cada juego se deduplica por su cuenta aunque compartan el nombre interno del logro', () => {
    const unJuego = game('Portal');
    const otroJuego = game('Half-Life');
    catalogue(fx.ctx, unJuego, ['ACH_WIN_ONE']);
    catalogue(fx.ctx, otroJuego, ['ACH_WIN_ONE']);
    store(unJuego, 'steam', [unlock('ACH_WIN_ONE', '2026-01-10T18:00:00Z')]);
    const fresh = store(otroJuego, 'steam', [unlock('ACH_WIN_ONE', '2026-01-11T18:00:00Z')]);
    assert.equal(fresh.length, 1);
    assert.equal(storedFor(fx.ctx, unJuego).length, 1);
    assert.equal(storedFor(fx.ctx, otroJuego).length, 1);
  });

  it('el aviso viaja con los datos del catálogo y sin el juego: lo rellena quien encola', () => {
    const gameId = game();
    seedCatalog(fx.ctx, {
      gameId,
      items: [
        {
          apiName: 'GRIMM',
          displayName: 'Nightmare King',
          iconUrl: 'https://cdn/grimm.jpg',
          globalPercent: 3.4,
        },
      ],
    });
    const [toast] = store(gameId, 'steam', [unlock('GRIMM', '2026-01-10T18:00:00Z')]);
    assert.deepEqual(toast, {
      displayName: 'Nightmare King',
      iconUrl: 'https://cdn/grimm.jpg',
      globalPercent: 3.4,
      gameTitle: '',
      gameHeroUrl: null,
    });
  });

  it('una tanda vacía no anuncia nada ni toca la base', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['A']);
    assert.deepEqual(store(gameId, 'steam', []), []);
    assert.deepEqual(storedFor(fx.ctx, gameId), []);
  });

  it('el mismo logro repetido dentro de la tanda se anuncia UNA sola vez', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['GRIMM']);
    const fresh = store(gameId, 'emu', [
      unlock('GRIMM', '2026-01-10T18:00:00Z'),
      unlock('GRIMM', '2026-01-10T18:00:00Z'),
    ]);
    assert.equal(fresh.length, 1);
    assert.equal(storedFor(fx.ctx, gameId).length, 1);
  });

  it('un duplicado dentro de la tanda tampoco cuenta doble para la regla del bloque', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['R1', 'R2', 'R3']);
    const pt = playthrough(fx.ctx, gameId);
    const sessionId = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 3);
    const tanda = sameSecond('2026-01-10T19:00:00Z', 'R1', 'R2', 'R3');
    store(gameId, 'emu', [...tanda, ...tanda]);
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 3);
    assert.ok(stored.every((row) => row.dateReliable && row.sessionId === sessionId));
  });
});

// ══ 2. DE QUÉ RATO FUE ═════════════════════════════════════════════════════

describe('storeUnlocks: el logro se cuelga de la sesión en la que cayó', () => {
  it('un desbloqueo dentro de una sesión se queda con esa sesión y su playthrough', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['GRIMM']);
    const pt = playthrough(fx.ctx, gameId);
    const sessionId = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 2);
    store(gameId, 'steam', [unlock('GRIMM', '2026-01-10T19:12:00Z')]);
    const stored = onlyStored(fx.ctx, gameId);
    assert.equal(stored.sessionId, sessionId);
    assert.equal(stored.playthroughId, pt);
  });

  it('un desbloqueo anterior a toda sesión no se cuelga de ninguna', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['VIEJO']);
    session(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z', 2);
    store(gameId, 'steam', [unlock('VIEJO', '2023-05-01T12:00:00Z')]);
    const stored = onlyStored(fx.ctx, gameId);
    assert.equal(stored.sessionId, null);
    assert.equal(stored.playthroughId, null);
    assert.equal(stored.unlockedAt, '2023-05-01T12:00:00.000Z');
    assert.equal(stored.dateReliable, true);
  });

  it('los dos minutos de gracia al cerrar salvan el logro del jefe final', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['DENTRO', 'FUERA']);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z', 2);
    store(gameId, 'steam', [
      unlock('DENTRO', '2026-01-10T20:02:00Z'),
      unlock('FUERA', '2026-01-10T20:02:01Z'),
    ]);
    assert.deepEqual(
      storedFor(fx.ctx, gameId).map((row) => [row.apiName, row.sessionId]),
      [
        ['DENTRO', sessionId],
        ['FUERA', null],
      ],
    );
  });

  it('el instante exacto de inicio ya cuenta como dentro, y el anterior no', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['JUSTO', 'ANTES']);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z', 2);
    store(gameId, 'steam', [
      unlock('JUSTO', '2026-01-10T18:00:00Z'),
      unlock('ANTES', '2026-01-10T17:59:59Z'),
    ]);
    assert.deepEqual(
      storedFor(fx.ctx, gameId).map((row) => [row.apiName, row.sessionId]),
      [
        ['ANTES', null],
        ['JUSTO', sessionId],
      ],
    );
  });

  it('una sesión todavía abierta llega hasta ahora mismo (el reloj de ctx)', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['EN_VIVO', 'ANTES_DE_EMPEZAR', 'FUTURO']);
    const sessionId = openSession(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z');
    // "Ahora" es el reloj del contexto, no Date.now().
    fx.wall.set(Date.parse('2026-01-10T20:00:00Z'));
    store(gameId, 'steam', [
      unlock('EN_VIVO', '2026-01-10T19:30:00Z'),
      unlock('ANTES_DE_EMPEZAR', '2026-01-10T17:00:00Z'),
      // Más allá de ahora + gracia: no cae en la sesión abierta.
      unlock('FUTURO', '2026-01-10T20:30:00Z'),
    ]);
    assert.deepEqual(
      storedFor(fx.ctx, gameId).map((row) => [row.apiName, row.sessionId]),
      [
        ['ANTES_DE_EMPEZAR', null],
        ['EN_VIVO', sessionId],
        ['FUTURO', null],
      ],
    );
  });

  it('con dos playthroughs, el logro se cuelga del playthrough de SU sesión', () => {
    const gameId = game('Dark Souls');
    catalogue(fx.ctx, gameId, ['NG', 'NG_PLUS']);
    const primera = playthrough(fx.ctx, gameId);
    const segunda = playthrough(fx.ctx, gameId);
    const s1 = session(fx.ctx, primera, '2026-01-10T18:00:00Z', 2);
    const s2 = session(fx.ctx, segunda, '2026-06-10T18:00:00Z', 2);
    store(gameId, 'steam', [
      unlock('NG', '2026-01-10T19:00:00Z'),
      unlock('NG_PLUS', '2026-06-10T19:00:00Z'),
    ]);
    assert.deepEqual(
      storedFor(fx.ctx, gameId).map((row) => [row.apiName, row.sessionId, row.playthroughId]),
      [
        ['NG', s1, primera],
        ['NG_PLUS', s2, segunda],
      ],
    );
  });

  it('una sesión de OTRO juego a la misma hora no se lleva el logro', () => {
    const gameId = game('Celeste');
    const vecino = game('Otro juego');
    catalogue(fx.ctx, gameId, ['CUMBRE']);
    session(fx.ctx, playthrough(fx.ctx, vecino), '2026-01-10T18:00:00Z', 3);
    store(gameId, 'steam', [unlock('CUMBRE', '2026-01-10T19:00:00Z')]);
    const stored = onlyStored(fx.ctx, gameId);
    assert.equal(stored.sessionId, null);
    assert.equal(stored.playthroughId, null);
  });

  it('volver a pasar el mismo desbloqueo lo RECOLOCA sin duplicar la fila', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['GRIMM']);
    store(gameId, 'steam', [unlock('GRIMM', '2026-01-10T19:00:00Z')]);
    assert.equal(onlyStored(fx.ctx, gameId).sessionId, null);
    const pt = playthrough(fx.ctx, gameId);
    const sessionId = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 2);
    assert.deepEqual(store(gameId, 'steam', [unlock('GRIMM', '2026-01-10T19:00:00Z')]), []);
    const stored = onlyStored(fx.ctx, gameId);
    assert.equal(stored.sessionId, sessionId);
    assert.equal(stored.playthroughId, pt);
  });

  it('en el solape del margen de gracia gana la sesión que estabas JUGANDO', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['EN_EL_SOLAPE']);
    const pt = playthrough(fx.ctx, gameId);
    const laQueCerre = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 1);
    const laQueEstabaJugando = session(fx.ctx, pt, '2026-01-10T19:01:00Z', 1);
    store(gameId, 'steam', [unlock('EN_EL_SOLAPE', '2026-01-10T19:01:30Z')]);
    const stored = onlyStored(fx.ctx, gameId);
    assert.equal(stored.sessionId, laQueEstabaJugando);
    assert.notEqual(stored.sessionId, laQueCerre);
  });

  it('el solape se resuelve igual aunque las sesiones se hayan grabado al revés', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['EN_EL_SOLAPE']);
    const pt = playthrough(fx.ctx, gameId);
    const laQueEstabaJugando = session(fx.ctx, pt, '2026-01-10T19:01:00Z', 1);
    session(fx.ctx, pt, '2026-01-10T18:00:00Z', 1);
    store(gameId, 'steam', [unlock('EN_EL_SOLAPE', '2026-01-10T19:01:30Z')]);
    assert.equal(onlyStored(fx.ctx, gameId).sessionId, laQueEstabaJugando);
  });

  it('sin sesión posterior, la gracia sigue recogiendo el logro de la que cerró', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['JEFE_FINAL']);
    const pt = playthrough(fx.ctx, gameId);
    session(fx.ctx, pt, '2026-01-10T16:00:00Z', 1);
    const laQueCerre = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 1);
    store(gameId, 'steam', [unlock('JEFE_FINAL', '2026-01-10T19:01:30Z')]);
    assert.equal(onlyStored(fx.ctx, gameId).sessionId, laQueCerre);
  });

  it('dos sesiones que arrancan en el mismo instante: gana la creada después, siempre la misma', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['EMPATE']);
    const primera = playthrough(fx.ctx, gameId);
    const segunda = playthrough(fx.ctx, gameId);
    // Una de otro PC (no choca con la regla de una sesión abierta propia).
    session(fx.ctx, primera, '2026-01-10T18:00:00Z', 1);
    fx.wall.advance(1000);
    const creadaDespues = asOtherDevice(fx.ctx).seedSession({
      playthroughId: segunda,
      startedAt: new Date('2026-01-10T18:00:00Z'),
    });
    store(gameId, 'steam', [unlock('EMPATE', '2026-01-10T18:30:00Z')]);
    assert.equal(onlyStored(fx.ctx, gameId).sessionId, creadaDespues);
  });
});

// ══ 3. CUÁNDO NO HAY QUE FIARSE DE LA FECHA ════════════════════════════════

describe('storeUnlocks: una fecha que no es un momento no cuelga de ninguna sesión', () => {
  it('los 25 del rescate de Goldberg se guardan y se anuncian, pero sin fecha fiable ni sesión', () => {
    const gameId = game('007');
    const nombres = Array.from({ length: 25 }, (_, index) => `BOND_${index}`);
    catalogue(fx.ctx, gameId, nombres);
    session(fx.ctx, playthrough(fx.ctx, gameId), '2026-02-01T18:00:00Z', 3);
    const fresh = store(gameId, 'emu', sameSecond('2026-02-01T19:30:00Z', ...nombres));
    assert.equal(fresh.length, 25);
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 25);
    assert.ok(
      stored.every(
        (row) => !row.dateReliable && row.sessionId === null && row.playthroughId === null,
      ),
    );
    assert.ok(stored.every((row) => row.unlockedAt === '2026-02-01T19:30:00.000Z'));
  });

  it('cuatro en el mismo segundo siguen siendo una racha creíble; cinco ya no', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['C1', 'C2', 'C3', 'C4', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z', 3);
    store(gameId, 'emu', [
      ...sameSecond('2026-01-10T19:00:00Z', 'C1', 'C2', 'C3', 'C4'),
      ...sameSecond('2026-01-10T20:00:00Z', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5'),
    ]);
    const stored = storedFor(fx.ctx, gameId);
    const cuatro = stored.filter((row) => row.apiName.startsWith('C'));
    const cinco = stored.filter((row) => row.apiName.startsWith('Q'));
    assert.deepEqual([cuatro.length, cinco.length], [4, 5]);
    assert.ok(cuatro.every((row) => row.dateReliable && row.sessionId === sessionId));
    assert.ok(cinco.every((row) => !row.dateReliable && row.sessionId === null));
  });

  it('el bloque solo envenena SU segundo: el resto de la tanda conserva su sesión', () => {
    const gameId = game();
    const bloque = ['B1', 'B2', 'B3', 'B4', 'B5'];
    catalogue(fx.ctx, gameId, [...bloque, 'DE_VERDAD']);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-02-01T18:00:00Z', 3);
    store(gameId, 'emu', [
      ...sameSecond('2026-02-01T19:30:00Z', ...bloque),
      unlock('DE_VERDAD', '2026-02-01T20:15:00Z'),
    ]);
    const stored = storedFor(fx.ctx, gameId);
    const bueno = stored.find((row) => row.apiName === 'DE_VERDAD');
    assert.equal(bueno?.dateReliable, true);
    assert.equal(bueno?.sessionId, sessionId);
    const rescatados = stored.filter((row) => row.apiName !== 'DE_VERDAD');
    assert.equal(rescatados.length, 5);
    assert.ok(rescatados.every((row) => !row.dateReliable && row.sessionId === null));
  });

  it('sin fecha propia se guarda la de respaldo, marcada como no fiable y sin sesión', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['SIN_FECHA']);
    session(fx.ctx, playthrough(fx.ctx, gameId), '2026-03-01T11:00:00Z', 3);
    assert.equal(store(gameId, 'steam', [unlock('SIN_FECHA', null)]).length, 1);
    const stored = onlyStored(fx.ctx, gameId);
    assert.equal(stored.unlockedAt, FALLBACK.toISOString());
    assert.equal(stored.dateReliable, false);
    assert.equal(stored.sessionId, null);
    assert.equal(stored.playthroughId, null);
  });

  it('un desbloqueo sin fecha propia no se vuelve a fechar en cada pasada (ni escribe)', () => {
    const gameId = game('Team Fortress 2');
    catalogue(fx.ctx, gameId, ['SIN_FECHA']);
    store(gameId, 'steam', [unlock('SIN_FECHA', null)]);
    const id = achievementUnlockId(gameId, 'steam', 'SIN_FECHA', 'steam');
    const before = syncUpdatedOf(fx.ctx, 'achievement_unlocks', id);
    assert.deepEqual(
      store(gameId, 'steam', [unlock('SIN_FECHA', null)], new Date('2026-03-02T09:00:00Z')),
      [],
    );
    const stored = onlyStored(fx.ctx, gameId);
    assert.equal(stored.unlockedAt, FALLBACK.toISOString());
    assert.equal(stored.dateReliable, false);
    assert.equal(syncUpdatedOf(fx.ctx, 'achievement_unlocks', id), before);
  });

  it('si la fuente deja de dar la fecha, la que ya constaba se conserva', () => {
    const gameId = game();
    const nombres = ['B1', 'B2', 'B3', 'B4', 'B5'];
    catalogue(fx.ctx, gameId, nombres);
    store(gameId, 'emu', sameSecond('2026-02-20T10:00:00Z', ...nombres));
    store(
      gameId,
      'emu',
      nombres.map((apiName) => unlock(apiName, null)),
      new Date('2026-04-01T08:00:00Z'),
    );
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 5);
    assert.ok(
      stored.every((row) => row.unlockedAt === '2026-02-20T10:00:00.000Z' && !row.dateReliable),
    );
  });

  it('un desbloqueo sin fecha NO arrastra a los demás al bloque, aunque sean muchos', () => {
    const gameId = game();
    const sinFecha = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'];
    catalogue(fx.ctx, gameId, [...sinFecha, 'CON_FECHA']);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-03-01T11:00:00Z', 3);
    store(gameId, 'steam', [
      ...sinFecha.map((apiName) => unlock(apiName, null)),
      unlock('CON_FECHA', FALLBACK.toISOString()),
    ]);
    const conFecha = storedFor(fx.ctx, gameId).find((row) => row.apiName === 'CON_FECHA');
    assert.equal(conFecha?.dateReliable, true);
    assert.equal(conFecha?.sessionId, sessionId);
  });

  it('un rescate en bloque ya NO pisa la fecha buena que estaba guardada', () => {
    const gameId = game('007');
    const nombres = ['B1', 'B2', 'B3', 'B4', 'B5'];
    catalogue(fx.ctx, gameId, nombres);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z', 3);
    store(
      gameId,
      'emu',
      nombres.map((apiName, index) => unlock(apiName, `2026-01-10T19:0${index}:00Z`)),
    );
    const antes = storedFor(fx.ctx, gameId);
    assert.equal(antes.length, 5);
    assert.ok(antes.every((row) => row.dateReliable && row.sessionId === sessionId));
    assert.deepEqual(store(gameId, 'emu', sameSecond('2026-02-20T10:00:00Z', ...nombres)), []);
    assert.deepEqual(storedFor(fx.ctx, gameId), antes);
  });

  it('una fecha NO fiable sí se deja pisar por la buena que llegue después', () => {
    const gameId = game();
    const nombres = ['B1', 'B2', 'B3', 'B4', 'B5'];
    catalogue(fx.ctx, gameId, nombres);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z', 3);
    store(gameId, 'emu', sameSecond('2026-02-20T10:00:00Z', ...nombres));
    assert.ok(storedFor(fx.ctx, gameId).every((row) => !row.dateReliable));
    store(
      gameId,
      'emu',
      nombres.map((apiName, index) => unlock(apiName, `2026-01-10T19:0${index}:00Z`)),
    );
    const stored = storedFor(fx.ctx, gameId);
    assert.ok(stored.every((row) => row.dateReliable && row.sessionId === sessionId));
    assert.deepEqual(
      stored.map((row) => row.unlockedAt),
      [0, 1, 2, 3, 4].map((index) => `2026-01-10T19:0${index}:00.000Z`),
    );
  });

  it('el bloque se mide por INSTANTE: troceado de uno en uno también se detecta', () => {
    const gameId = game();
    const nombres = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6'];
    catalogue(fx.ctx, gameId, nombres);
    session(fx.ctx, playthrough(fx.ctx, gameId), '2026-02-01T18:00:00Z', 3);
    for (const apiName of nombres) store(gameId, 'emu', [unlock(apiName, '2026-02-01T19:30:00Z')]);
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 6);
    assert.ok(
      stored.every(
        (row) => !row.dateReliable && row.sessionId === null && row.playthroughId === null,
      ),
    );
    assert.ok(stored.every((row) => row.unlockedAt === '2026-02-01T19:30:00.000Z'));
  });

  it('cuatro de uno en uno siguen siendo una racha creíble (RA)', () => {
    const gameId = game();
    const nombres = ['C1', 'C2', 'C3', 'C4'];
    catalogue(fx.ctx, gameId, nombres, 'ra');
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-02-01T18:00:00Z', 3);
    for (const apiName of nombres) store(gameId, 'ra', [unlock(apiName, '2026-02-01T19:30:00Z')]);
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 4);
    assert.ok(stored.every((row) => row.source === 'ra' && row.origin === 'ra'));
    assert.ok(stored.every((row) => row.dateReliable && row.sessionId === sessionId));
  });

  it('repetir la misma tanda no convierte una racha en bloque', () => {
    const gameId = game();
    const nombres = ['C1', 'C2', 'C3', 'C4'];
    catalogue(fx.ctx, gameId, nombres);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-02-01T18:00:00Z', 3);
    const tanda = sameSecond('2026-02-01T19:30:00Z', ...nombres);
    store(gameId, 'steam', tanda);
    store(gameId, 'steam', tanda);
    store(gameId, 'steam', tanda);
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 4);
    assert.ok(stored.every((row) => row.dateReliable && row.sessionId === sessionId));
  });

  it('el censo de un bloque no cruza orígenes: el rescate del crack no ensucia a Steam', () => {
    const gameId = game();
    const delCrack = ['B1', 'B2', 'B3', 'B4'];
    catalogue(fx.ctx, gameId, [...delCrack, 'DE_STEAM']);
    const sessionId = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-02-01T18:00:00Z', 3);
    store(gameId, 'emu', sameSecond('2026-02-01T19:30:00Z', ...delCrack));
    store(gameId, 'steam', [unlock('DE_STEAM', '2026-02-01T19:30:00Z')]);
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 5);
    assert.ok(stored.every((row) => row.dateReliable && row.sessionId === sessionId));
  });
});

// ══ 4. LO PROPIO DEL 2.0 ═══════════════════════════════════════════════════

describe('storeUnlocks: identidad, orígenes y la puerta (2.0)', () => {
  it('cada PC escribe su propia fila de emulador y no toca la del otro (F-35)', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['A', 'B', 'C', 'D', 'E']);
    // El otro PC ya tiene cuatro con el mismo instante (una racha, fiable).
    for (const apiName of ['A', 'B', 'C', 'D']) {
      seedUnlock(fx.ctx, {
        gameId,
        apiName,
        origin: `emu@${OTHER}`,
        unlockedAt: new Date('2026-02-01T19:30:00Z'),
      });
    }
    // El quinto en este PC con ese mismo instante no forma bloque con los del
    // otro: cada PC tiene su reloj y su fichero de crack.
    const fresh = store(gameId, 'emu', [unlock('E', '2026-02-01T19:30:00Z')]);
    assert.equal(fresh.length, 1);
    const stored = storedFor(fx.ctx, gameId);
    assert.equal(stored.length, 5);
    assert.ok(stored.every((row) => row.dateReliable));
    assert.deepEqual(
      stored.filter((row) => row.origin === EMU).map((row) => row.apiName),
      ['E'],
    );
    // Y lo que ya tenía otro PC no es nuevo aquí.
    assert.deepEqual(store(gameId, 'emu', [unlock('A', '2026-02-02T10:00:00Z')]), []);
  });

  it('un juego borrado no recibe desbloqueos ni resucita los suyos (R-15)', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['A']);
    store(gameId, 'steam', [unlock('A', '2026-01-10T18:00:00Z')]);
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(store(gameId, 'steam', [unlock('A', '2026-01-10T18:00:00Z')]), []);
    assert.deepEqual(storedFor(fx.ctx, gameId), []);
  });

  it('con expectedAppId, una respuesta en vuelo para el appid anterior no escribe nada', () => {
    const gameId = seedGame(fx.ctx, { title: 'Corregido', steamAppId: 441 });
    catalogue(fx.ctx, gameId, ['A']);
    assert.deepEqual(
      store(gameId, 'steam', [unlock('A', '2026-01-10T18:00:00Z')], FALLBACK, {
        expectedAppId: 440,
      }),
      [],
    );
    assert.deepEqual(storedFor(fx.ctx, gameId), []);
    assert.equal(
      store(gameId, 'steam', [unlock('A', '2026-01-10T18:00:00Z')], FALLBACK, {
        expectedAppId: 441,
      }).length,
      1,
    );
  });

  it('con expectedRaGameId, igual para el set de RetroAchievements', () => {
    const gameId = seedGame(fx.ctx, { title: 'RA', raGameId: 2 });
    catalogue(fx.ctx, gameId, ['777'], 'ra');
    assert.deepEqual(
      store(gameId, 'ra', [unlock('777', '2026-01-10T18:00:00Z')], FALLBACK, {
        expectedRaGameId: 1,
      }),
      [],
    );
    assert.equal(
      store(gameId, 'ra', [unlock('777', '2026-01-10T18:00:00Z')], FALLBACK, {
        expectedRaGameId: 2,
      }).length,
      1,
    );
  });

  it('la vía decide el catálogo: un crack de Steam no cuelga logros del catálogo de RA', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['777'], 'ra');
    assert.deepEqual(store(gameId, 'emu', [unlock('777', '2026-01-10T18:00:00Z')]), []);
    assert.deepEqual(storedFor(fx.ctx, gameId), []);
  });

  it('una fila con lápida (p. ej. tras cambiar el appid) se reescribe entera, sin recuperar lo viejo', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['A']);
    const pt = playthrough(fx.ctx, gameId);
    const sessionId = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 2);
    store(gameId, 'steam', [unlock('A', '2026-01-10T18:30:00Z')]);
    assert.equal(onlyStored(fx.ctx, gameId).sessionId, sessionId);
    fx.ctx.store.remove('achievement_unlocks', achievementUnlockId(gameId, 'steam', 'A', 'steam'));
    // Vuelve sin fecha: nueva, con la de respaldo y sin la sesión de antes.
    const fresh = store(gameId, 'steam', [unlock('A', null)]);
    assert.equal(fresh.length, 1);
    assert.deepEqual(onlyStored(fx.ctx, gameId), {
      apiName: 'A',
      source: 'steam',
      origin: 'steam',
      unlockedAt: FALLBACK.toISOString(),
      dateReliable: false,
      sessionId: null,
      playthroughId: null,
    });
  });

  it('la misma tanda repetida no escribe nada (F-33): el reloj de la fila no se mueve', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['A']);
    session(fx.ctx, playthrough(fx.ctx, gameId), '2026-01-10T18:00:00Z', 2);
    store(gameId, 'steam', [unlock('A', '2026-01-10T18:30:00Z')]);
    const id = achievementUnlockId(gameId, 'steam', 'A', 'steam');
    const before = syncUpdatedOf(fx.ctx, 'achievement_unlocks', id);
    store(gameId, 'steam', [unlock('A', '2026-01-10T18:30:00Z')]);
    assert.equal(syncUpdatedOf(fx.ctx, 'achievement_unlocks', id), before);
  });

  it('una sesión borrada no se lleva el logro', () => {
    const gameId = game();
    catalogue(fx.ctx, gameId, ['A']);
    const pt = playthrough(fx.ctx, gameId);
    const sessionId = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 2);
    fx.ctx.store.remove('sessions', sessionId);
    store(gameId, 'steam', [unlock('A', '2026-01-10T18:30:00Z')]);
    assert.equal(onlyStored(fx.ctx, gameId).sessionId, null);
  });
});

describe('markSteamUnlocksSynced (R-05)', () => {
  it('apunta ec(steam_unlocks) solo si el juego vive y sigue con ese appid', () => {
    const gameId = seedGame(fx.ctx, { title: 'Steam', steamAppId: 440 });
    assert.equal(markSteamUnlocksSynced(fx.ctx, gameId, 441), false);
    assert.equal(readCheck(fx.ctx, gameId, 'steam_unlocks'), undefined);
    assert.equal(markSteamUnlocksSynced(fx.ctx, gameId, 440), true);
    assert.equal(readCheck(fx.ctx, gameId, 'steam_unlocks')?.status, 'ok');
    fx.ctx.store.remove('games', gameId);
    assert.equal(markSteamUnlocksSynced(fx.ctx, gameId, 440), false);
  });
});

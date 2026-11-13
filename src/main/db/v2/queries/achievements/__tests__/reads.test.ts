import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { AchievementSource, UnlockOrigin } from '../../../schema';
import {
  LOCAL,
  OTHER,
  openQueryDb,
  seedCatalog,
  seedCheck,
  seedGame,
  seedUnlock,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getGameAchievements, getSessionUnlocks } from '../gameAchievements';
import { achievementKey, parseAchievementKey } from '../ids';
import { getAchievementsOverview } from '../overview';
import { replaceUnlockPlacements } from '../replacePlacements';
import { playthrough, session, storedFor } from './helpers';

// Port de src/main/db/__tests__/achievements.test.ts: las tres puertas que
// pintan logros (ficha, Sesiones, Stats) y el escritor que recoloca, sobre el
// esquema 2.0. Lo que se blinda es el FUNDIDO: el mismo trofeo puede constar
// por varios orígenes y las tres pantallas tienen que contestar lo mismo.
//
// Traducción de las fuentes de la 1.x: `steam` → origen `steam`; `emu` →
// `emu@<este PC>`; y donde la 1.x usaba `ra` como "otra fuente más del MISMO
// logro", aquí va `emu@<otro PC>` (en el 2.0 un logro de RA es de OTRO
// catálogo; los casos de RA van aparte, abajo).

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const EMU = `emu@${LOCAL}` as UnlockOrigin;
const EMU_OTHER = `emu@${OTHER}` as UnlockOrigin;

type LogroSpec = {
  api: string;
  rareza?: number | null;
  oculto?: boolean;
  orden?: number;
  icono?: string | null;
  iconoApagado?: string | null;
  descripcion?: string | null;
};

const catalogo = (
  gameId: string,
  specs: LogroSpec[],
  source: AchievementSource = 'steam',
): string[] => {
  seedCatalog(fx.ctx, {
    gameId,
    source,
    items: specs.map((spec, index) => ({
      apiName: spec.api,
      globalPercent: spec.rareza ?? null,
      hidden: spec.oculto ?? false,
      sortIndex: spec.orden ?? index,
      iconUrl: spec.icono ?? null,
      iconGrayUrl: spec.iconoApagado ?? null,
      description: spec.descripcion ?? null,
    })),
  });
  return specs.map((spec) => achievementKey(gameId, source, spec.api));
};

const consta = (
  key: string,
  origin: UnlockOrigin,
  iso: string,
  extra: { fiable?: boolean; sessionId?: string; playthroughId?: string } = {},
): string => {
  const ref = parseAchievementKey(key);
  if (!ref) throw new Error(`clave inválida: ${key}`);
  return seedUnlock(fx.ctx, {
    gameId: ref.gameId,
    source: ref.source,
    apiName: ref.apiName,
    origin,
    unlockedAt: new Date(iso),
    dateReliable: extra.fiable ?? true,
    sessionId: extra.sessionId ?? null,
    playthroughId: extra.playthroughId ?? null,
  });
};

/** Un juego con los desbloqueos de Steam YA PREGUNTADOS (regla 2). */
const juegoPreguntado = (title = 'Juego preguntado'): string => {
  const gameId = seedGame(fx.ctx, { title });
  seedCheck(fx.ctx, {
    gameId,
    source: 'steam_unlocks',
    checkedAt: new Date('2026-08-01T12:00:00Z'),
  });
  return gameId;
};

const juegoAlRatio = (unlocked: number, total: number, title: string): string => {
  const gameId = juegoPreguntado(title);
  const ids = catalogo(
    gameId,
    Array.from({ length: total }, (_, index) => ({ api: `${title}_${index}` })),
  );
  for (const id of ids.slice(0, unlocked)) consta(id, 'steam', '2026-03-15T12:00:00Z');
  return gameId;
};

const isoDe = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

// ══ LA FICHA ═══════════════════════════════════════════════════════════════

describe('getGameAchievements — el fundido de orígenes', () => {
  it('una fuente fiable gana a una que no, aunque su fecha sea posterior', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, EMU, '2025-03-01T12:00:00Z', { fiable: false });
    consta(logro, 'steam', '2026-02-01T12:00:00Z');
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    assert.equal(isoDe(entry.unlockedAt), '2026-02-01T12:00:00.000Z');
    assert.equal(entry.dateReliable, true);
  });

  it('empatadas en fiabilidad manda la MÁS TEMPRANA — y con ella viajan su sesión y su playthrough', () => {
    const gameId = juegoPreguntado();
    const primera = playthrough(fx.ctx, gameId);
    const segunda = playthrough(fx.ctx, gameId);
    const vieja = session(fx.ctx, primera, '2026-01-10T18:00:00Z', 2);
    const nueva = session(fx.ctx, segunda, '2026-02-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, 'steam', '2026-02-01T19:00:00Z', { sessionId: nueva, playthroughId: segunda });
    consta(logro, EMU_OTHER, '2026-01-10T19:00:00Z', { sessionId: vieja, playthroughId: primera });
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    assert.equal(isoDe(entry.unlockedAt), '2026-01-10T19:00:00.000Z');
    assert.equal(entry.sessionId, vieja);
    assert.equal(entry.iterationId, primera);
  });

  it('entre dos fechas NO fiables también gana la más temprana, y sigue sin ser fiable', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, EMU, '2026-05-01T12:00:00Z', { fiable: false });
    consta(logro, EMU_OTHER, '2026-03-01T12:00:00Z', { fiable: false });
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    assert.equal(isoDe(entry.unlockedAt), '2026-03-01T12:00:00.000Z');
    assert.equal(entry.dateReliable, false);
  });

  it('las fuentes se acumulan TODAS, gane la que gane; varios PCs con emulador son UN "emu"', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, EMU, '2025-03-01T12:00:00Z', { fiable: false });
    consta(logro, 'steam', '2026-02-01T12:00:00Z');
    consta(logro, EMU_OTHER, '2026-04-01T12:00:00Z');
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    assert.deepEqual([...entry.sources].sort(), ['emu', 'steam']);
    assert.equal(isoDe(entry.unlockedAt), '2026-02-01T12:00:00.000Z');
  });

  it('un logro sin desbloquear sale con unlockedAt null, sin fuentes y sin sesión', () => {
    const gameId = juegoPreguntado();
    const [sacado, pendiente] = catalogo(gameId, [{ api: 'FIRST' }, { api: 'LAST' }]);
    consta(sacado, 'steam', '2026-02-01T12:00:00Z');
    const bloqueado = getGameAchievements(fx.ctx, gameId).entries.find(
      (entry) => entry.id === pendiente,
    );
    assert.equal(bloqueado?.unlockedAt, null);
    assert.deepEqual(bloqueado?.sources, []);
    assert.equal(bloqueado?.sessionId, null);
    assert.equal(bloqueado?.iterationId, null);
    assert.equal(bloqueado?.dateReliable, true);
  });

  it('la vitrina va en el orden de Steam (sortIndex)', () => {
    const gameId = juegoPreguntado();
    catalogo(gameId, [
      { api: 'TERCERO', orden: 2 },
      { api: 'PRIMERO', orden: 0 },
      { api: 'SEGUNDO', orden: 1 },
    ]);
    assert.deepEqual(
      getGameAchievements(fx.ctx, gameId).entries.map((entry) => entry.apiName),
      ['PRIMERO', 'SEGUNDO', 'TERCERO'],
    );
  });

  it('los desbloqueos de OTRO juego no se cuelan aunque compartan el nombre interno', () => {
    const mio = juegoPreguntado('El mío');
    const otro = juegoPreguntado('El otro');
    const [logroMio] = catalogo(mio, [{ api: 'ACHIEVEMENT_1' }]);
    const [logroOtro] = catalogo(otro, [{ api: 'ACHIEVEMENT_1' }]);
    consta(logroOtro, 'steam', '2026-02-01T12:00:00Z');
    const { entries } = getGameAchievements(fx.ctx, mio);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, logroMio);
    assert.equal(entries[0].unlockedAt, null);
  });

  it('a un logro oculto NO se le tapa la descripción', () => {
    const gameId = juegoPreguntado();
    catalogo(gameId, [{ api: 'SECRETO', oculto: true, descripcion: 'Mata al dragón' }]);
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    assert.equal(entry.hidden, true);
    assert.equal(entry.description, 'Mata al dragón');
  });

  it('un juego sin catálogo devuelve sus sellos de sincronización y cero entradas', () => {
    const gameId = seedGame(fx.ctx, { title: 'Sin logros', steamAppId: 620 });
    seedCheck(fx.ctx, {
      gameId,
      source: 'steam_achievements',
      status: 'empty',
      checkedAt: new Date('2026-02-01T12:00:00Z'),
    });
    seedCheck(fx.ctx, {
      gameId,
      source: 'steam_unlocks',
      checkedAt: new Date('2026-02-02T12:00:00Z'),
    });
    const result = getGameAchievements(fx.ctx, gameId);
    assert.deepEqual(result.entries, []);
    assert.equal(result.steamAppId, 620);
    assert.equal(isoDe(result.syncedAt), '2026-02-01T12:00:00.000Z');
    assert.equal(isoDe(result.unlocksSyncedAt), '2026-02-02T12:00:00.000Z');
  });

  it('un fallo no cuenta como sincronizado (la 1.x no dejaba sello)', () => {
    const gameId = seedGame(fx.ctx, { title: 'Fallido', steamAppId: 620 });
    seedCheck(fx.ctx, { gameId, source: 'steam_achievements', status: 'error' });
    assert.equal(getGameAchievements(fx.ctx, gameId).syncedAt, null);
  });

  it('un juego que no existe, o borrado, contesta vacío sin lanzar', () => {
    const vacio = {
      steamAppId: null,
      syncedAt: null,
      unlocksSyncedAt: null,
      entries: [],
      completion: [],
    };
    assert.deepEqual(getGameAchievements(fx.ctx, 'no-existe'), { gameId: 'no-existe', ...vacio });
    const gameId = juegoPreguntado();
    catalogo(gameId, [{ api: 'A' }]);
    fx.ctx.store.remove('games', gameId);
    assert.deepEqual(getGameAchievements(fx.ctx, gameId), { gameId, ...vacio });
  });

  it('una sesión o un playthrough borrados no viajan con el logro (F-11)', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const sesion = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'A' }]);
    consta(logro, 'steam', '2026-01-10T19:00:00Z', { sessionId: sesion, playthroughId: pt });
    // Solo la lápida del playthrough, como si la de la sesión no hubiera llegado.
    tombstoneOnly(fx.ctx, 'playthroughs', pt);
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    assert.equal(entry.sessionId, null);
    assert.equal(entry.iterationId, null);
    assert.notEqual(entry.unlockedAt, null);
  });
});

describe('getGameAchievements — dos catálogos y completado por fuente (R-11)', () => {
  it('Steam primero y luego RA, cada uno con su clave; el completado va por fuente', () => {
    const gameId = seedGame(fx.ctx, { title: 'Clásico', steamAppId: 10, raGameId: 20 });
    seedCheck(fx.ctx, { gameId, source: 'ra_achievements' });
    const [ra1, ra2] = catalogo(gameId, [{ api: '1' }, { api: '2' }], 'ra');
    const [st1] = catalogo(gameId, [{ api: 'WIN' }, { api: 'LOSE' }]);
    consta(ra1, 'ra', '2026-01-10T12:00:00Z');
    consta(ra2, 'ra', '2026-01-11T12:00:00Z');
    consta(st1, 'steam', '2026-01-12T12:00:00Z');

    const result = getGameAchievements(fx.ctx, gameId);
    assert.deepEqual(
      result.entries.map((entry) => entry.id),
      [st1, achievementKey(gameId, 'steam', 'LOSE'), ra1, ra2],
    );
    assert.deepEqual(result.entries[2].sources, ['ra']);
    assert.deepEqual(
      result.completion.map((c) => [c.source, c.unlocked, c.total, c.complete, c.known]),
      [
        ['steam', 1, 2, false, true],
        ['ra', 2, 2, true, true],
      ],
    );
    assert.equal(isoDe(result.completion[1].completedAt), '2026-01-11T12:00:00.000Z');
    // unlocksSyncedAt también se alimenta de RA (catálogo y desbloqueos llegan juntos).
    assert.notEqual(result.unlocksSyncedAt, null);
  });

  it('catálogo solo de RA y Steam contestando después "sin logros": cada sello de su fuente', () => {
    // El caso que destapó la validación de la importación: los desbloqueos
    // los trajo RA (18:20) y Steam solo preguntó por el catálogo (18:24).
    const gameId = seedGame(fx.ctx, { title: 'Clásico', steamAppId: 10, raGameId: 20 });
    catalogo(gameId, [{ api: '1' }], 'ra');
    seedCheck(fx.ctx, {
      gameId,
      source: 'ra_achievements',
      checkedAt: new Date('2026-08-03T18:20:00Z'),
    });
    seedCheck(fx.ctx, {
      gameId,
      source: 'steam_achievements',
      status: 'empty',
      checkedAt: new Date('2026-08-03T18:24:05Z'),
    });
    const result = getGameAchievements(fx.ctx, gameId);
    assert.equal(isoDe(result.syncedAt), '2026-08-03T18:24:05.000Z');
    assert.equal(isoDe(result.unlocksSyncedAt), '2026-08-03T18:20:00.000Z');
  });
});

// ══ LA PANTALLA DE SESIONES ═══════════════════════════════════════════════

describe('getSessionUnlocks — un trofeo, UNA sesión', () => {
  it('el mismo trofeo no puede aparecer en dos sesiones: cuelga del origen ganador', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const delCrack = session(fx.ctx, pt, '2025-05-01T18:00:00Z', 2);
    const deSteam = session(fx.ctx, pt, '2026-02-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, EMU, '2025-05-01T19:00:00Z', { fiable: false, sessionId: delCrack });
    consta(logro, 'steam', '2026-02-01T19:00:00Z', { sessionId: deSteam });
    const unlocks = getSessionUnlocks(fx.ctx);
    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].sessionId, deSteam);
    assert.equal(unlocks[0].achievementId, logro);
  });

  it('la sesión del trofeo es exactamente la misma que enseña la ficha', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const temprana = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 2);
    const tardia = session(fx.ctx, pt, '2026-03-10T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, 'steam', '2026-03-10T19:00:00Z', { sessionId: tardia });
    consta(logro, EMU_OTHER, '2026-01-10T19:00:00Z', { sessionId: temprana });
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    const [unlock] = getSessionUnlocks(fx.ctx);
    assert.equal(unlock.sessionId, entry.sessionId);
    assert.equal(unlock.sessionId, temprana);
  });

  it('si el origen ganador no cayó en ninguna sesión, el trofeo no cuelga de ninguna fila', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const delCrack = session(fx.ctx, pt, '2026-05-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, EMU, '2026-05-01T19:00:00Z', { fiable: false, sessionId: delCrack });
    consta(logro, 'steam', '2019-07-04T12:00:00Z');
    assert.deepEqual(getSessionUnlocks(fx.ctx), []);
    assert.equal(getGameAchievements(fx.ctx, gameId).entries[0].sessionId, null);
  });

  it('los desbloqueos huérfanos (sin sesión en ningún origen) no salen', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'VIEJO' }]);
    consta(logro, 'steam', '2019-07-04T12:00:00Z');
    assert.deepEqual(getSessionUnlocks(fx.ctx), []);
  });

  it('cada fila trae lo justo para pintarse, y llega de cualquier juego', () => {
    const uno = juegoPreguntado('Celeste');
    const otro = juegoPreguntado('Hollow Knight');
    const s1 = session(fx.ctx, playthrough(fx.ctx, uno), '2026-01-10T18:00:00Z', 2);
    const s2 = session(fx.ctx, playthrough(fx.ctx, otro), '2026-01-11T18:00:00Z', 2);
    const [logroUno] = catalogo(uno, [
      { api: 'SUMMIT', rareza: 1.8, icono: 'https://icono/summit.jpg' },
    ]);
    const [logroOtro] = catalogo(otro, [{ api: 'PANTHEON' }]);
    consta(logroUno, 'steam', '2026-01-10T19:00:00Z', { sessionId: s1 });
    consta(logroOtro, 'steam', '2026-01-11T19:00:00Z', { sessionId: s2 });
    const unlocks = getSessionUnlocks(fx.ctx);
    assert.equal(unlocks.length, 2);
    assert.deepEqual(
      unlocks.find((unlock) => unlock.achievementId === logroUno),
      {
        sessionId: s1,
        achievementId: logroUno,
        displayName: 'SUMMIT',
        iconUrl: 'https://icono/summit.jpg',
        globalPercent: 1.8,
      },
    );
  });

  it('tres orígenes en tres sesiones distintas siguen siendo UNA fila', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const enero = session(fx.ctx, pt, '2026-01-10T18:00:00Z', 2);
    const febrero = session(fx.ctx, pt, '2026-02-10T18:00:00Z', 2);
    const marzo = session(fx.ctx, pt, '2026-03-10T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, EMU, '2026-01-10T19:00:00Z', { fiable: false, sessionId: enero });
    consta(logro, EMU_OTHER, '2026-02-10T19:00:00Z', { sessionId: febrero });
    consta(logro, 'steam', '2026-03-10T19:00:00Z', { sessionId: marzo });
    assert.deepEqual(
      getSessionUnlocks(fx.ctx).map((unlock) => unlock.sessionId),
      [febrero],
    );
  });

  it('esta consulta se fía de sessionId: la regla del rescate la aplica QUIEN ESCRIBE', () => {
    const gameId = juegoPreguntado();
    const sesion = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-05-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'RESCATADO' }]);
    consta(logro, EMU, '2026-05-01T19:00:00Z', { fiable: false, sessionId: sesion });
    assert.deepEqual(
      getSessionUnlocks(fx.ctx).map((unlock) => unlock.sessionId),
      [sesion],
    );
  });

  it('un juego borrado no deja trofeos en la pantalla de Sesiones', () => {
    const gameId = juegoPreguntado();
    const sesion = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-05-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'A' }]);
    consta(logro, 'steam', '2026-05-01T19:00:00Z', { sessionId: sesion });
    tombstoneOnly(fx.ctx, 'games', gameId);
    assert.deepEqual(getSessionUnlocks(fx.ctx), []);
  });
});

// ══ EL ESCRITOR: replaceUnlockPlacements ══════════════════════════════════

const colgadoDe = (
  gameId: string,
  apiName: string,
  origin: string,
): [string | null, string | null] => {
  const row = storedFor(fx.ctx, gameId).find((r) => r.apiName === apiName && r.origin === origin);
  if (!row) throw new Error(`sin fila ${apiName} ${origin}`);
  return [row.sessionId, row.playthroughId];
};

describe('replaceUnlockPlacements — recolocar sin inventarse momentos', () => {
  it('un rescate NO se cuelga de la sesión aunque su segundo caiga dentro', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const sesion = session(fx.ctx, pt, '2026-05-01T18:00:00Z', 2);
    const [deVerdad, r1, r2] = catalogo(gameId, [
      { api: 'DE_VERDAD' },
      { api: 'RESCATE_1' },
      { api: 'RESCATE_2' },
    ]);
    consta(deVerdad, 'steam', '2026-05-01T18:40:00Z');
    consta(r1, EMU, '2026-05-01T19:00:00Z', { fiable: false });
    consta(r2, EMU, '2026-05-01T19:00:00Z', { fiable: false });
    assert.equal(replaceUnlockPlacements(fx.ctx, gameId), 1);
    assert.deepEqual(colgadoDe(gameId, 'DE_VERDAD', 'steam'), [sesion, pt]);
    assert.deepEqual(colgadoDe(gameId, 'RESCATE_1', EMU), [null, null]);
    assert.deepEqual(colgadoDe(gameId, 'RESCATE_2', EMU), [null, null]);
  });

  it('descuelga el rescate que una recolocación vieja hubiera colgado mal', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const sesion = session(fx.ctx, pt, '2026-05-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'RESCATADO' }]);
    consta(logro, EMU, '2026-05-01T19:00:00Z', {
      fiable: false,
      sessionId: sesion,
      playthroughId: pt,
    });
    assert.equal(replaceUnlockPlacements(fx.ctx, gameId), 0);
    assert.deepEqual(colgadoDe(gameId, 'RESCATADO', EMU), [null, null]);
  });

  it('recolocar no le mete a la pantalla de Sesiones trofeos que no jugaste ese rato', () => {
    const gameId = juegoPreguntado();
    const sesion = session(fx.ctx, playthrough(fx.ctx, gameId), '2026-05-01T18:00:00Z', 2);
    const [deVerdad, rescate] = catalogo(gameId, [{ api: 'DE_VERDAD' }, { api: 'RESCATE' }]);
    consta(deVerdad, 'steam', '2026-05-01T18:40:00Z');
    consta(rescate, EMU, '2026-05-01T19:00:00Z', { fiable: false });
    replaceUnlockPlacements(fx.ctx, gameId);
    assert.deepEqual(
      getSessionUnlocks(fx.ctx).map((unlock) => [unlock.sessionId, unlock.displayName]),
      [[sesion, 'DE_VERDAD']],
    );
  });

  it('un desbloqueo fiable fuera de toda sesión sigue sin colgar de ninguna', () => {
    const gameId = juegoPreguntado();
    session(fx.ctx, playthrough(fx.ctx, gameId), '2026-05-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'VIEJO' }]);
    consta(logro, 'steam', '2019-07-04T12:00:00Z');
    assert.equal(replaceUnlockPlacements(fx.ctx, gameId), 0);
    assert.deepEqual(colgadoDe(gameId, 'VIEJO', 'steam'), [null, null]);
  });

  it('recoloca también la fila de emulador de otro PC (la tabla no tiene dueño)', () => {
    const gameId = juegoPreguntado();
    const pt = playthrough(fx.ctx, gameId);
    const sesion = session(fx.ctx, pt, '2026-05-01T18:00:00Z', 2);
    const [logro] = catalogo(gameId, [{ api: 'A' }]);
    consta(logro, EMU_OTHER, '2026-05-01T18:30:00Z');
    assert.equal(replaceUnlockPlacements(fx.ctx, gameId), 1);
    assert.deepEqual(colgadoDe(gameId, 'A', EMU_OTHER), [sesion, pt]);
  });
});

// ══ LA VISTA GLOBAL ════════════════════════════════════════════════════════

describe('getAchievementsOverview — las dos reglas que cruzan todo', () => {
  it('una fecha no fiable cuenta en el total pero JAMÁS en un año (regla 1)', () => {
    const gameId = juegoPreguntado();
    const [real, rescatado] = catalogo(gameId, [{ api: 'REAL' }, { api: 'RESCATADO' }]);
    consta(real, 'steam', '2026-03-15T12:00:00Z');
    consta(rescatado, EMU, '2026-03-15T12:00:00Z', { fiable: false });
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.equal(overview.totalUnlocked, 2);
    assert.deepEqual(overview.unlockedByYear, [{ year: 2026, total: 1, rare: 0, ultra: 0 }]);
  });

  it('el mismo logro por dos orígenes es UN desbloqueo, no dos', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'SUMMIT' }]);
    consta(logro, EMU, '2026-03-01T12:00:00Z');
    consta(logro, 'steam', '2026-03-15T12:00:00Z');
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.equal(overview.totalUnlocked, 1);
    assert.equal(overview.totalCatalog, 1);
    assert.deepEqual(overview.unlockedByYear, [{ year: 2026, total: 1, rare: 0, ultra: 0 }]);
  });

  it('la ficha y la vista global cuentan los mismos desbloqueos para el mismo juego', () => {
    const gameId = juegoPreguntado();
    const [uno, dos] = catalogo(gameId, [{ api: 'A' }, { api: 'B' }, { api: 'C' }]);
    consta(uno, 'steam', '2026-01-10T12:00:00Z');
    consta(uno, EMU, '2025-01-10T12:00:00Z', { fiable: false });
    consta(dos, EMU_OTHER, '2026-02-10T12:00:00Z');
    const enLaFicha = getGameAchievements(fx.ctx, gameId).entries.filter(
      (e) => e.unlockedAt !== null,
    ).length;
    assert.equal(enLaFicha, 2);
    assert.equal(getAchievementsOverview(fx.ctx, null).totalUnlocked, enLaFicha);
  });

  it('la fecha del fundido coincide entre la ficha (JS) y el resumen (SQL)', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'A', rareza: 1 }]);
    consta(logro, EMU, '2024-01-10T12:00:00Z', { fiable: false });
    consta(logro, 'steam', '2026-01-10T12:00:00Z');
    consta(logro, EMU_OTHER, '2025-06-10T12:00:00Z');
    const [entry] = getGameAchievements(fx.ctx, gameId).entries;
    const [fama] = getAchievementsOverview(fx.ctx, null).hallOfFame;
    assert.equal(isoDe(fama.unlockedAt), isoDe(entry.unlockedAt));
    assert.equal(isoDe(fama.unlockedAt), '2025-06-10T12:00:00.000Z');
  });

  it('un juego sin desbloqueos preguntados NO es un juego al 0% (regla 2)', () => {
    const sinPreguntar = seedGame(fx.ctx, { title: 'Nunca preguntado' });
    catalogo(sinPreguntar, [{ api: 'A' }, { api: 'B' }, { api: 'C' }, { api: 'D' }]);
    juegoAlRatio(3, 4, 'Preguntado');
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.equal(overview.totalCatalog, 8);
    assert.deepEqual(
      overview.almostThere.map((game) => game.title),
      ['Preguntado'],
    );
    assert.deepEqual(overview.perfectGames, []);
  });

  it('la memoria de catálogos se invalida cuando la fila cambia (reloj de sync)', () => {
    const gameId = juegoAlRatio(3, 4, 'Cambiante');
    assert.equal(getAchievementsOverview(fx.ctx, null).totalCatalog, 4);
    assert.equal(getAchievementsOverview(fx.ctx, null).almostThere.length, 1);
    // El catálogo crece (un DLC): la memoria no puede seguir diciendo 4.
    seedCatalog(fx.ctx, {
      gameId,
      items: Array.from({ length: 8 }, (_, index) => ({ apiName: `Cambiante_${index}` })),
    });
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.equal(overview.totalCatalog, 8);
    assert.deepEqual(overview.almostThere, []);
  });

  it('un juego borrado no cuenta ni en el catálogo ni en los desbloqueos', () => {
    const gameId = juegoAlRatio(2, 2, 'Borrado');
    fx.ctx.store.remove('games', gameId);
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.equal(overview.totalCatalog, 0);
    assert.equal(overview.totalUnlocked, 0);
  });
});

describe('getAchievementsOverview — el muro del 100%', () => {
  it('la fecha del cierre es la del ÚLTIMO logro', () => {
    const gameId = juegoPreguntado('Perfecto');
    const ids = catalogo(gameId, [{ api: 'A' }, { api: 'B' }, { api: 'C' }]);
    consta(ids[0], 'steam', '2026-01-10T12:00:00Z');
    consta(ids[1], 'steam', '2026-06-20T12:00:00Z');
    consta(ids[2], 'steam', '2026-03-15T12:00:00Z');
    const [perfecto] = getAchievementsOverview(fx.ctx, null).perfectGames;
    assert.equal(perfecto.title, 'Perfecto');
    assert.equal(perfecto.total, 3);
    assert.equal(perfecto.source, 'steam');
    assert.equal(isoDe(perfecto.completedAt), '2026-06-20T12:00:00.000Z');
  });

  it('con un solo rescate por medio el 100% se queda sin fecha, pero sigue en el muro', () => {
    const gameId = juegoPreguntado('Medio rescatado');
    const ids = catalogo(gameId, [{ api: 'A' }, { api: 'B' }]);
    consta(ids[0], 'steam', '2026-01-10T12:00:00Z');
    consta(ids[1], EMU, '2026-06-20T12:00:00Z', { fiable: false });
    const todo = getAchievementsOverview(fx.ctx, null);
    assert.equal(todo.perfectGames.length, 1);
    assert.equal(todo.perfectGames[0].completedAt, null);
    assert.deepEqual(getAchievementsOverview(fx.ctx, 2026).perfectGames, []);
  });

  it('con año filtrado, el muro son los perfeccionados ESE año', () => {
    const viejo = juegoPreguntado('Cerrado en 2025');
    const nuevo = juegoPreguntado('Cerrado en 2026');
    const [logroViejo] = catalogo(viejo, [{ api: 'A' }]);
    const [logroNuevo] = catalogo(nuevo, [{ api: 'A' }]);
    consta(logroViejo, 'steam', '2025-06-20T12:00:00Z');
    consta(logroNuevo, 'steam', '2026-06-20T12:00:00Z');
    assert.deepEqual(
      getAchievementsOverview(fx.ctx, 2026).perfectGames.map((game) => game.title),
      ['Cerrado en 2026'],
    );
  });

  it('el muro ordena por tamaño del catálogo', () => {
    juegoAlRatio(2, 2, 'Pequeño');
    juegoAlRatio(30, 30, 'Grande');
    assert.deepEqual(
      getAchievementsOverview(fx.ctx, null).perfectGames.map((game) => game.title),
      ['Grande', 'Pequeño'],
    );
  });

  it('por fuente (R-11): un 100% de RA no lo esconden los logros de Steam que faltan, y no se suman', () => {
    const gameId = seedGame(fx.ctx, { title: 'Clásico', steamAppId: 10, raGameId: 20 });
    seedCheck(fx.ctx, { gameId, source: 'ra_achievements' });
    seedCheck(fx.ctx, { gameId, source: 'steam_unlocks' });
    const ra = catalogo(gameId, [{ api: '1' }, { api: '2' }], 'ra');
    const steam = catalogo(gameId, [{ api: 'A' }, { api: 'B' }, { api: 'C' }, { api: 'D' }]);
    for (const key of ra) consta(key, 'ra', '2026-02-01T12:00:00Z');
    for (const key of steam.slice(0, 3)) consta(key, 'steam', '2026-02-02T12:00:00Z');

    const overview = getAchievementsOverview(fx.ctx, null);
    assert.deepEqual(
      overview.perfectGames.map((game) => [game.title, game.source, game.total]),
      [['Clásico', 'ra', 2]],
    );
    assert.deepEqual(
      overview.almostThere.map((game) => [game.title, game.source, game.unlocked, game.total]),
      [['Clásico', 'steam', 3, 4]],
    );
    // El cuarto de Steam lo completa: dos hitos, dos entradas en el muro.
    consta(steam[3], 'steam', '2026-02-03T12:00:00Z');
    assert.deepEqual(
      getAchievementsOverview(fx.ctx, null).perfectGames.map((game) => [game.source, game.total]),
      [
        ['steam', 4],
        ['ra', 2],
      ],
    );
  });

  it('RA usa su propio sello para la regla 2: sin ec(ra_achievements) ni desbloqueos no es un 0%', () => {
    const gameId = seedGame(fx.ctx, { title: 'Sin preguntar a RA', raGameId: 5 });
    catalogo(gameId, [{ api: '1' }], 'ra');
    assert.deepEqual(getAchievementsOverview(fx.ctx, null).almostThere, []);
  });
});

describe('getAchievementsOverview — almost there', () => {
  it('el umbral es el 75% INCLUIDO, y el 100% ya no es "casi"', () => {
    juegoAlRatio(3, 4, 'Justo en el umbral');
    juegoAlRatio(7, 10, 'Por debajo');
    juegoAlRatio(4, 4, 'Perfecto');
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.deepEqual(
      overview.almostThere.map((game) => game.title),
      ['Justo en el umbral'],
    );
    assert.equal(overview.almostThere[0].unlocked, 3);
    assert.equal(overview.almostThere[0].total, 4);
  });

  it('ordena por cercanía al 100% y se corta en seis juegos', () => {
    juegoAlRatio(6, 8, 'r750');
    juegoAlRatio(7, 9, 'r778');
    juegoAlRatio(8, 10, 'r800');
    juegoAlRatio(9, 11, 'r818');
    juegoAlRatio(7, 8, 'r875');
    juegoAlRatio(8, 9, 'r889');
    juegoAlRatio(9, 10, 'r900');
    assert.deepEqual(
      getAchievementsOverview(fx.ctx, null).almostThere.map((game) => game.title),
      ['r900', 'r889', 'r875', 'r818', 'r800', 'r778'],
    );
  });

  it('lo que falta va de lo MÁS común a lo menos, cortado en cinco y con el icono apagado', () => {
    const gameId = juegoPreguntado('Casi');
    const ids = catalogo(gameId, [
      ...Array.from({ length: 18 }, (_, index) => ({ api: `HECHO_${index}` })),
      { api: 'FALTA_23', rareza: 23, icono: 'color-23', iconoApagado: 'gris-23' },
      { api: 'FALTA_22', rareza: 22, icono: 'color-22' },
      { api: 'FALTA_21', rareza: 21 },
      { api: 'FALTA_20', rareza: 20 },
      { api: 'FALTA_19', rareza: 19 },
      { api: 'FALTA_18', rareza: 18 },
    ]);
    for (const id of ids.slice(0, 18)) consta(id, 'steam', '2026-03-15T12:00:00Z');
    const [casi] = getAchievementsOverview(fx.ctx, null).almostThere;
    assert.deepEqual(
      casi.missing.map((logro) => logro.displayName),
      ['FALTA_23', 'FALTA_22', 'FALTA_21', 'FALTA_20', 'FALTA_19'],
    );
    assert.equal(casi.missing[0].iconUrl, 'gris-23');
    assert.equal(casi.missing[1].iconUrl, 'color-22');
    assert.equal(casi.missing[0].achievementId, achievementKey(gameId, 'steam', 'FALTA_23'));
  });

  it('los ocultos siguen siendo spoiler: viaja el nombre, jamás la descripción', () => {
    const gameId = juegoPreguntado('Con secretos');
    const ids = catalogo(gameId, [
      { api: 'HECHO_1' },
      { api: 'HECHO_2' },
      { api: 'HECHO_3' },
      { api: 'SECRETO', oculto: true, descripcion: 'Mata al dragón final' },
    ]);
    for (const id of ids.slice(0, 3)) consta(id, 'steam', '2026-03-15T12:00:00Z');
    const [casi] = getAchievementsOverview(fx.ctx, null).almostThere;
    assert.deepEqual(Object.keys(casi.missing[0]).sort(), [
      'achievementId',
      'displayName',
      'globalPercent',
      'hidden',
      'iconUrl',
    ]);
    assert.equal(casi.missing[0].hidden, true);
  });

  it('con un año filtrado, "almost there" viene vacío', () => {
    juegoAlRatio(3, 4, 'Casi');
    assert.deepEqual(getAchievementsOverview(fx.ctx, 2026).almostThere, []);
  });
});

describe('getAchievementsOverview — fama y rareza', () => {
  it('el salón de la fama va de lo más raro a lo menos y se corta en diez', () => {
    const gameId = juegoPreguntado('Cazado');
    const ids = catalogo(
      gameId,
      Array.from({ length: 12 }, (_, index) => ({ api: `P${index + 1}`, rareza: index + 1 })),
    );
    for (const id of ids) consta(id, 'steam', '2026-03-15T12:00:00Z');
    const { hallOfFame } = getAchievementsOverview(fx.ctx, null);
    assert.equal(hallOfFame.length, 10);
    assert.deepEqual(
      hallOfFame.map((logro) => logro.globalPercent),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(hallOfFame[0].gameTitle, 'Cazado');
    assert.equal(hallOfFame[0].achievementId, ids[0]);
  });

  it('un logro sin rareza conocida no entra en la fama, pero sí en el total', () => {
    const gameId = juegoPreguntado();
    const [conRareza, sinRareza] = catalogo(gameId, [
      { api: 'RARO', rareza: 2 },
      { api: 'DESCONOCIDO', rareza: null },
    ]);
    consta(conRareza, 'steam', '2026-03-15T12:00:00Z');
    consta(sinRareza, 'steam', '2026-03-16T12:00:00Z');
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.equal(overview.totalUnlocked, 2);
    assert.deepEqual(
      overview.hallOfFame.map((logro) => logro.displayName),
      ['RARO'],
    );
    assert.deepEqual(overview.rarityProfile, { common: 0, rare: 0, ultra: 1 });
  });

  it('la fama enseña el logro pero no el momento cuando la fecha no es fiable', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'RESCATADO', rareza: 0.9 }]);
    consta(logro, EMU, '2026-03-15T12:00:00Z', { fiable: false });
    const [fama] = getAchievementsOverview(fx.ctx, null).hallOfFame;
    assert.equal(fama.displayName, 'RESCATADO');
    assert.equal(fama.unlockedAt, null);
  });

  it('el perfil de rareza corta en 10 y en 5 EXACTOS', () => {
    const gameId = juegoPreguntado();
    const ids = catalogo(gameId, [
      { api: 'COMUN', rareza: 10 },
      { api: 'RARO_ALTO', rareza: 9.9 },
      { api: 'RARO_BORDE', rareza: 5 },
      { api: 'ULTRA', rareza: 4.9 },
    ]);
    for (const id of ids) consta(id, 'steam', '2026-03-15T12:00:00Z');
    assert.deepEqual(getAchievementsOverview(fx.ctx, null).rarityProfile, {
      common: 1,
      rare: 2,
      ultra: 1,
    });
  });

  it('"raro" significa LO MISMO en todas las cifras de la respuesta', () => {
    const gameId = juegoPreguntado();
    const ids = catalogo(gameId, [
      { api: 'COMUN', rareza: 40 },
      { api: 'RARO', rareza: 7 },
      { api: 'ULTRA', rareza: 1 },
    ]);
    for (const id of ids) consta(id, 'steam', '2026-03-15T12:00:00Z');
    const overview = getAchievementsOverview(fx.ctx, 2026);
    assert.deepEqual(overview.yearTotals, { total: 3, rare: 1, ultra: 1 });
    assert.deepEqual(overview.rarityProfile, { common: 1, rare: 1, ultra: 1 });
    assert.deepEqual(overview.unlockedByYear, [{ year: 2026, total: 3, rare: 1, ultra: 1 }]);
    assert.deepEqual(
      overview.topGames?.map((game) => [game.total, game.rare, game.ultra]),
      [[3, 1, 1]],
    );
    const month = overview.unlockedByMonth?.[2];
    assert.equal((month?.rare ?? 0) + (month?.ultra ?? 0), 2);
  });
});

describe('getAchievementsOverview — el año filtrado', () => {
  it('con año, fama y totales solo miran ESE año y solo fechas fiables', () => {
    const gameId = juegoPreguntado();
    const [delAño, deAntes, rescatado] = catalogo(gameId, [
      { api: 'DEL_AÑO', rareza: 2 },
      { api: 'DE_ANTES', rareza: 1 },
      { api: 'RESCATADO', rareza: 0.5 },
    ]);
    consta(delAño, 'steam', '2026-03-15T12:00:00Z');
    consta(deAntes, 'steam', '2025-06-10T12:00:00Z');
    consta(rescatado, EMU, '2026-07-01T12:00:00Z', { fiable: false });
    const overview = getAchievementsOverview(fx.ctx, 2026);
    assert.deepEqual(
      overview.hallOfFame.map((logro) => logro.displayName),
      ['DEL_AÑO'],
    );
    assert.deepEqual(overview.yearTotals, { total: 1, rare: 0, ultra: 1 });
    assert.equal(overview.totalUnlocked, 3);
    assert.equal(overview.totalCatalog, 3);
  });

  it('los doce meses SIEMPRE, con sus ceros y con los tres cubos de rareza', () => {
    const gameId = juegoPreguntado();
    const ids = catalogo(gameId, [
      { api: 'COMUN', rareza: 50 },
      { api: 'RARO', rareza: 7 },
      { api: 'ULTRA', rareza: 1 },
    ]);
    consta(ids[0], 'steam', '2026-03-15T12:00:00Z');
    consta(ids[1], 'steam', '2026-03-16T12:00:00Z');
    consta(ids[2], 'steam', '2026-11-10T12:00:00Z');
    const meses = getAchievementsOverview(fx.ctx, 2026).unlockedByMonth;
    assert.equal(meses?.length, 12);
    assert.deepEqual(meses?.[2], { month: 2, total: 2, common: 1, rare: 1, ultra: 0 });
    assert.deepEqual(meses?.[10], { month: 10, total: 1, common: 0, rare: 0, ultra: 1 });
    assert.deepEqual(meses?.[0], { month: 0, total: 0, common: 0, rare: 0, ultra: 0 });
    for (const mes of meses ?? []) assert.equal(mes.common + mes.rare + mes.ultra, mes.total);
  });

  it('los juegos del año se ordenan por cantidad y desempatan por título', () => {
    const muchos = juegoPreguntado('Zelda');
    const pocosA = juegoPreguntado('Braid');
    const pocosB = juegoPreguntado('Alba');
    const idsMuchos = catalogo(muchos, [{ api: 'A' }, { api: 'B', rareza: 7 }]);
    const [idA] = catalogo(pocosA, [{ api: 'A' }]);
    const [idB] = catalogo(pocosB, [{ api: 'A' }]);
    for (const id of [...idsMuchos, idA, idB]) consta(id, 'steam', '2026-03-15T12:00:00Z');
    assert.deepEqual(
      getAchievementsOverview(fx.ctx, 2026).topGames?.map((game) => [
        game.title,
        game.total,
        game.rare,
        game.ultra,
      ]),
      [
        ['Zelda', 2, 1, 0],
        ['Alba', 1, 0, 0],
        ['Braid', 1, 0, 0],
      ],
    );
  });

  it('en All Time no hay lecturas anuales', () => {
    const gameId = juegoPreguntado();
    const [logro] = catalogo(gameId, [{ api: 'A' }]);
    consta(logro, 'steam', '2026-03-15T12:00:00Z');
    const overview = getAchievementsOverview(fx.ctx, null);
    assert.equal(overview.yearTotals, null);
    assert.equal(overview.unlockedByMonth, null);
    assert.equal(overview.topGames, null);
  });

  it('la gráfica de años sigue siendo de SIEMPRE aunque haya un año filtrado', () => {
    const gameId = juegoPreguntado();
    const ids = catalogo(gameId, [{ api: 'VIEJO' }, { api: 'NUEVO' }]);
    consta(ids[0], 'steam', '2024-05-10T12:00:00Z');
    consta(ids[1], 'steam', '2026-03-15T12:00:00Z');
    assert.deepEqual(getAchievementsOverview(fx.ctx, 2026).unlockedByYear, [
      { year: 2024, total: 1, rare: 0, ultra: 0 },
      { year: 2026, total: 1, rare: 0, ultra: 0 },
    ]);
  });

  it('la biblioteca vacía contesta ceros y listas vacías, no undefined', () => {
    assert.deepEqual(getAchievementsOverview(fx.ctx, null), {
      totalUnlocked: 0,
      totalCatalog: 0,
      yearTotals: null,
      topGames: null,
      unlockedByMonth: null,
      unlockedByYear: [],
      hallOfFame: [],
      perfectGames: [],
      almostThere: [],
      rarityProfile: { common: 0, rare: 0, ultra: 0 },
    });
  });
});

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { achievementUnlocksTable, achievementsTable, gamesTable } from '../../db/schema';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import type { SteamAchievementDef, SteamUnlock } from '../api';
import type { PendingAchievementsGame } from '../queue';
import type { EmuUnlock } from '../emu/parsers';

// QUÉ SE DA POR SINCRONIZADO Y QUÉ NO — la decisión de syncGameAchievements
// que más caro sale cuando falla, porque es de una sola dirección: la única
// pasada AUTOMÁTICA (la del arranque) solo mira los juegos con
// achievementsSyncedAt a null, así que estampar esa fecha por error saca al
// juego de la lista PARA SIEMPRE. No hay reintento, no hay TTL, no hay aviso:
// el juego se queda con cero logros y la tarjeta de Ajustes diciendo que está
// al día, y la única salida es que el usuario adivine que tiene que pulsar
// "Sync now".
//
// Y el catálogo vacío que dispara esa decisión llega por tres motivos que la
// Web API aplasta en la misma respuesta ([]): el juego sin logros, el juego que
// aún no ha salido y la CLAVE mal pegada o revocada. Distinguirlos es todo el
// trabajo de este test — con una errata en la clave, el fallo no es un juego,
// son los 541.
//
// La base es la REAL del andamio (lo que se comprueba es lo que quedó en
// `games` y en `achievements`, no a quién se llamó). Lo falso es Steam y las
// dos fuentes locales, que aquí no pintan nada: leen disco y registro.

let schemaResponse: SteamAchievementDef[] = [];
let percentagesResponse: Map<string, number> | null = null;
let playerUnlocks: SteamUnlock[] | null = null;
let steamUserId: string | null = null;
let emuUnlocks: EmuUnlock[] = [];
const emuAppIdsRead: number[] = [];
const steamAppIdsRead: number[] = [];

mock.module('../api', {
  namedExports: {
    getAchievementSchema: async (): Promise<SteamAchievementDef[]> => schemaResponse,
    getGlobalPercentages: async (): Promise<Map<string, number> | null> => percentagesResponse,
    getPlayerUnlocks: async (appId: number): Promise<SteamUnlock[] | null> => {
      steamAppIdsRead.push(appId);
      return playerUnlocks;
    },
    getSteamUserId: (): string | null => steamUserId,
  },
});

// Las dos fuentes locales (el schema .bin del Steam de este PC y los ficheros
// de los emuladores) miran disco y registro de Windows: fuera del proceso de
// test no existen, y no son lo que aquí se prueba.
mock.module('../localSchema', {
  namedExports: {
    getLocalAchievementTexts: async (): Promise<Map<string, unknown>> => new Map(),
  },
});
mock.module('../emu/goldbergCatalog', {
  namedExports: { ensureGoldbergCatalog: async (): Promise<number> => 0 },
});
mock.module('../emu/readUnlocks', {
  namedExports: {
    readEmuUnlocksForGame: (appId: number): { unlocks: EmuUnlock[]; emus: string[] } => {
      emuAppIdsRead.push(appId);
      return { unlocks: emuUnlocks, emus: emuUnlocks.length ? ['Goldberg'] : [] };
    },
  },
});

// Y los avisos en pantalla, que arrastran Electron (BrowserWindow y, por
// images/cache, app.getPath). Sin estos dobles el módulo bajo prueba ni
// siquiera carga bajo tsx.
mock.module('../notifications/overlay', {
  namedExports: { enqueueAchievementToasts: (): void => {} },
});
mock.module('../notifications/complete', {
  namedExports: { maybeCelebrateCompletion: (): void => {} },
});

let db: TestDb;
let syncGameAchievements: typeof import('../syncAchievements').syncGameAchievements;
let setSteamAppId: typeof import('../../db/queries/games/setSteamAppId').setSteamAppId;

before(async () => {
  ({ syncGameAchievements } = await import('../syncAchievements'));
  ({ setSteamAppId } = await import('../../db/queries/games/setSteamAppId'));
});
beforeEach(async () => {
  db = await freshDb();
  schemaResponse = [];
  percentagesResponse = null;
  playerUnlocks = null;
  steamUserId = null;
  emuUnlocks = [];
  emuAppIdsRead.length = 0;
  steamAppIdsRead.length = 0;
});
after(() => cleanupDbs());

// ── Fábricas locales ───────────────────────────────────────────────────────

const def = (apiName: string, sortIndex = 0): SteamAchievementDef => ({
  apiName,
  displayName: `Logro ${apiName}`,
  description: 'Lo que hay que hacer',
  iconUrl: null,
  iconGrayUrl: null,
  hidden: false,
  sortIndex,
});

const pending = (id: number): PendingAchievementsGame => ({
  id,
  title: 'Juego de prueba',
  steamAppId: 440,
  executablePath: null,
  installDirectory: null,
  heroUrl: null,
});

// La marca de "ya se le trajo el catálogo": null = sigue pendiente, y es lo
// único que hace que el arranque lo vuelva a mirar.
const syncedAtOf = async (gameId: number): Promise<Date | null> => {
  const [row] = await db
    .select({ syncedAt: gamesTable.achievementsSyncedAt })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId));
  return row.syncedAt;
};

const catalogOf = async (gameId: number): Promise<string[]> => {
  const rows = await db
    .select({ apiName: achievementsTable.apiName })
    .from(achievementsTable)
    .where(eq(achievementsTable.gameId, gameId));
  return rows.map((row) => row.apiName).sort();
};

describe('syncGameAchievements: un catálogo vacío no siempre significa lo mismo', () => {
  it('does not write an in-flight response for the previous App ID', async () => {
    const gameId = await makeGame(db, { steamAppId: 441, steamAppIdManual: true });
    schemaResponse = [def('OLD_WIN')];
    percentagesResponse = new Map([['OLD_WIN', 10]]);

    const result = await syncGameAchievements(pending(gameId));

    assert.equal(result.catalogCount, 0);
    assert.deepEqual(await catalogOf(gameId), []);
  });

  it('after correcting the App ID, reads both crack and Steam unlocks for the new ID', async () => {
    const gameId = await makeGame(db, { steamAppId: 100 });
    await db
      .insert(achievementsTable)
      .values({ gameId, apiName: 'WRONG', displayName: 'Wrong game', sortIndex: 0 });
    await setSteamAppId(gameId, 440);
    schemaResponse = [def('CRACK_WIN'), def('STEAM_WIN', 1)];
    percentagesResponse = new Map([
      ['CRACK_WIN', 12],
      ['STEAM_WIN', 30],
    ]);
    emuUnlocks = [{ apiName: 'CRACK_WIN', unlockedAt: new Date('2026-01-01') }];
    playerUnlocks = [{ apiName: 'STEAM_WIN', unlockedAt: new Date('2026-01-02') }];
    steamUserId = '123';

    const result = await syncGameAchievements(pending(gameId));

    assert.equal(result.unlockedCount, 2);
    assert.deepEqual(emuAppIdsRead, [440]);
    assert.deepEqual(steamAppIdsRead, [440]);
    assert.deepEqual(await catalogOf(gameId), ['CRACK_WIN', 'STEAM_WIN']);
    assert.deepEqual(
      (await db.select().from(achievementUnlocksTable)).map((row) => row.source).sort(),
      ['emu', 'steam'],
    );
  });

  it('una clave inválida NO marca el juego como sincronizado, y al corregirla se recupera solo', async () => {
    // ARREGLADO, y era el peor de los tres. Una key con una errata (o revocada
    // por Valve) es un 403 de GetSchemaForGame, que getAchievementSchema
    // aplasta en []. El testigo elegido para distinguir "sin logros" de "sin
    // publicar" es la rareza, que NO manda la clave: contesta 200 y con el mapa
    // lleno. Con la guarda mirando solo si el testigo era null, la pasada
    // entraba, no insertaba nada y estampaba la fecha: 541 juegos marcados como
    // sincronizados y con cero logros, y ni corregir la clave lo deshacía
    // porque ya no quedaba ninguno pendiente que mirar.
    const gameId = await makeGame(db, { steamAppId: 440 });
    schemaResponse = [];
    percentagesResponse = new Map([
      ['TF_SCOUT', 34.2],
      ['TF_SOLDIER', 21.5],
    ]);

    const result = await syncGameAchievements(pending(gameId));

    assert.equal(result.catalogCount, 0);
    assert.equal(result.unlocksKnown, false);
    assert.deepEqual(await catalogOf(gameId), []);
    assert.equal(await syncedAtOf(gameId), null);

    // El usuario corrige la clave: el mismo juego sigue pendiente, así que la
    // pasada del arranque lo recoge y esta vez sí trae su catálogo.
    schemaResponse = [def('TF_SCOUT', 0), def('TF_SOLDIER', 1)];
    const segunda = await syncGameAchievements(pending(gameId));

    assert.equal(segunda.catalogCount, 2);
    assert.deepEqual(await catalogOf(gameId), ['TF_SCOUT', 'TF_SOLDIER']);
    assert.notEqual(await syncedAtOf(gameId), null);
  });

  it('un juego con stats y CERO logros sí se marca: ahí el vacío es la respuesta', async () => {
    // El borde contrario, y el que impide que el arreglo se convierta en
    // repreguntar la biblioteca entera cada arranque: 7 Days to Die tiene stats
    // y ni un logro, la rareza contesta con un mapa VACÍO y ese [] es verdad.
    const gameId = await makeGame(db, { steamAppId: 440 });
    schemaResponse = [];
    percentagesResponse = new Map();

    const result = await syncGameAchievements(pending(gameId));

    assert.equal(result.catalogCount, 0);
    assert.deepEqual(await catalogOf(gameId), []);
    assert.notEqual(await syncedAtOf(gameId), null);
  });

  it('un juego que todavía no ha salido no se marca: su "no" caduca el día del lanzamiento', async () => {
    // Enter the kOS anuncia logros en su ficha de Steam y aun así da 403 en los
    // dos endpoints. Marcarlo sería grabar como definitivo un "no" que caduca
    // solo, y sus 34 logros no aparecerían nunca.
    const gameId = await makeGame(db, { steamAppId: 440 });
    schemaResponse = [];
    percentagesResponse = null;

    await syncGameAchievements(pending(gameId));

    assert.equal(await syncedAtOf(gameId), null);
  });

  it('con catálogo de verdad se guardan los logros, su rareza y la fecha', async () => {
    // El camino feliz, para que los tres de arriba no puedan pasar por estar
    // rotos todos en la misma dirección.
    const gameId = await makeGame(db, { steamAppId: 440 });
    schemaResponse = [def('TF_SCOUT', 0), def('TF_SOLDIER', 1)];
    percentagesResponse = new Map([['TF_SCOUT', 34.2]]);

    const result = await syncGameAchievements(pending(gameId));

    assert.equal(result.catalogCount, 2);
    assert.deepEqual(await catalogOf(gameId), ['TF_SCOUT', 'TF_SOLDIER']);
    assert.notEqual(await syncedAtOf(gameId), null);

    const [scout] = await db
      .select({
        globalPercent: achievementsTable.globalPercent,
        displayName: achievementsTable.displayName,
      })
      .from(achievementsTable)
      .where(eq(achievementsTable.apiName, 'TF_SCOUT'));
    assert.equal(scout.globalPercent, 34.2);
    assert.equal(scout.displayName, 'Logro TF_SCOUT');
  });
});

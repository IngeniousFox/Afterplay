import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { radarGamesTable } from '../../db/schema';
import type { RadarActivityEvent } from '../../../shared/types';

// runRadarPass: "LA PRIMERA PASADA DE LA VIDA SIEMBRA EN SILENCIO" (§4.4).
//
// Lo que se blinda: la primera vez que el radar corre en la vida de un
// proceso puede descubrir de golpe TODO lo anunciado de doscientas
// colecciones — docenas de secuelas. Avisar de todas ellas de golpe el
// primer día no es una noticia, es spam, así que esa primera pasada tiene
// que sembrar la tabla (los descubrimientos SÍ se guardan, para que el Plan
// los enseñe si los abres) pero SIN disparar el aviso flotante.
//
// Y la parte que de verdad puede romperse en un refactor sin que nadie lo
// note, documentada tal cual en pass.ts: "la primera" NO es solo
// `radarLastRunAt === 0`. El sellado de la semana puede quedar pendiente
// (el refresco externo estaba ocupado) y entonces esa marca se queda a
// cero — pero la pasada YA CORRIÓ. Sin una segunda señal en memoria
// (`alreadySown`), CUALQUIER pasada mientras la marca siga a cero se
// creería "la primera" y avisaría mudo para siempre, aunque sea la
// pasada número diez.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: la base de datos es real (andamio con las
// migraciones del repo) y refreshMembership/findAnnounced corren de verdad
// contra ella. Lo doblado es todo lo que toca la red o un candado ajeno:
// igdb/api (getGameExternalBatch, getUpcomingCollectionGames),
// external/adoptIgdb, external/sgdbBackfill, external/refresh y el propio
// notificador de radar/notify.
//
// ORDEN DE LOS TESTS: runRadarPass guarda `alreadySown` y `unsealedPasses`
// en variables de módulo, EN MEMORIA, a propósito (misma vida que el
// candado de external/refresh.ts que vigilan). Eso significa que estos dos
// tests de la sección "la primera pasada" tienen que leerse EN SECUENCIA,
// como si fueran el mismo proceso corriendo dos pasadas seguidas — no dos
// escenarios independientes. Se documenta aquí porque es exactamente el
// tipo de acoplamiento que un `--test-concurrency` alegre rompería.

let externalDataByIgdbId = new Map<
  number,
  {
    ratingCritics: number | null;
    ratingCriticsCount: number | null;
    ratingUsers: number | null;
    ratingUsersCount: number | null;
    summary: string | null;
    igdbCollections: { id: number; name: string }[] | null;
    releaseDate: Date | null;
    releaseDatePrecision: 'year' | 'month' | 'day' | null;
    releaseYear: number | null;
  }
>();
let upcomingByCollection: {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  releaseDate: Date | null;
  releaseDatePrecision: 'year' | 'month' | 'day' | null;
  collectionIds: number[];
  editions: [];
}[] = [];

mock.module('../../igdb/api', {
  namedExports: {
    getGameExternalBatch: async (igdbIds: number[]): Promise<Map<number, unknown>> => {
      const result = new Map<number, unknown>();
      for (const id of igdbIds) {
        const data = externalDataByIgdbId.get(id);
        if (data) result.set(id, data);
      }
      return result;
    },
    getUpcomingCollectionGames: async (): Promise<typeof upcomingByCollection> =>
      upcomingByCollection,
  },
});

mock.module('../../external/adoptIgdb', {
  namedExports: {
    findAdoptionCandidates: async (): Promise<never[]> => [],
    adoptIgdbForCandidates: async (): Promise<number> => 0,
  },
});

mock.module('../../external/sgdbBackfill', {
  namedExports: {
    fillMissingSgdbIds: async (): Promise<number> => 0,
  },
});

// El candado del refresco externo: controlable por test para poder probar
// tanto "estaba libre y selló" como "estaba ocupado y no selló", que es
// justo la rama que abre el agujero de alreadySown.
let externalRefreshRunning = false;
const startExternalRefreshCalls: string[] = [];
mock.module('../../external/refresh', {
  namedExports: {
    isExternalRefreshRunning: (): boolean => externalRefreshRunning,
    startExternalRefresh: async (scope: string): Promise<number> => {
      startExternalRefreshCalls.push(scope);
      return 0;
    },
  },
});

// El aviso flotante: lo único que importa aquí es SI se llamó y con qué.
const notifyCalls: RadarActivityEvent[] = [];
mock.module('../notify', {
  namedExports: {
    notifyRadarActivity: (event: RadarActivityEvent): void => {
      notifyCalls.push(event);
    },
    setRadarNotifier: (): void => {},
  },
});

// El config.json real depende de `app.getPath` (Electron) — aquí un
// almacén en memoria mínimo, con solo la clave que runRadarPass toca.
const config = { radarLastRunAt: 0 };
const setConfigCalls: number[] = [];
mock.module('../../config/store', {
  namedExports: {
    getConfigValue: (key: 'radarLastRunAt'): number => config[key],
    setConfigValue: (key: 'radarLastRunAt', value: number): void => {
      config[key] = value;
      setConfigCalls.push(value);
    },
  },
});

let runRadarPass: typeof import('../pass').runRadarPass;

before(async () => {
  ({ runRadarPass } = await import('../pass'));
});

// El log de cada pasada es correcto en la app, ruido en el test.
const realLog = console.log;
const realWarn = console.warn;
before(() => {
  console.log = (): void => {};
  console.warn = (): void => {};
});
after(() => {
  console.log = realLog;
  console.warn = realWarn;
  cleanupDbs();
});

let db: TestDb;

const leerRadarGames = async (): Promise<{ igdbId: number }[]> =>
  db.select({ igdbId: radarGamesTable.igdbId }).from(radarGamesTable);

// ── Guardas de entrada, independientes del estado de módulo ────────────────
// (No tocan `running`/`alreadySown`: runRadarPass sale ANTES de sellar nada.)

describe('runRadarPass — guardas de entrada', () => {
  beforeEach(async () => {
    db = await freshDb();
  });

  it('sin claves de Twitch configuradas, no hace nada y no toca la tabla', async () => {
    const antes = { ...process.env };
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
    try {
      const resultado = await runRadarPass(true);
      assert.equal(resultado, null);
      assert.deepEqual(await leerRadarGames(), []);
      assert.equal(notifyCalls.length, 0);
    } finally {
      process.env = antes;
    }
  });

  it('con la marca reciente y sin forzar, no hace nada (aunque haya claves)', async () => {
    process.env.TWITCH_CLIENT_ID = 'x';
    process.env.TWITCH_CLIENT_SECRET = 'y';
    config.radarLastRunAt = Date.now(); // "ya corrió hace un segundo"
    const resultado = await runRadarPass(false);
    assert.equal(resultado, null);
  });
});

// ── La secuencia real: primera pasada muda, y el porqué de alreadySown ─────

describe('runRadarPass — la primera pasada de la vida siembra en silencio', () => {
  before(async () => {
    db = await freshDb();
    process.env.TWITCH_CLIENT_ID = 'test-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
    config.radarLastRunAt = 0;

    // Tu único juego en biblioteca, ya en IGDB, perteneciente a la saga 555.
    await makeGame(db, { title: 'Fable', igdbId: 100, planned: false });
    externalDataByIgdbId = new Map([
      [
        100,
        {
          ratingCritics: null,
          ratingCriticsCount: null,
          ratingUsers: null,
          ratingUsersCount: null,
          summary: null,
          igdbCollections: [{ id: 555, name: 'Fable Saga' }],
          releaseDate: null,
          releaseDatePrecision: null,
          releaseYear: null,
        },
      ],
    ]);
  });

  it('descubre y GUARDA las secuelas anunciadas, pero no dispara el aviso flotante', async () => {
    // El refresco externo está OCUPADO: esta pasada no llega a sellar la
    // semana (radarLastRunAt se queda a 0). Es la rama que, sin
    // `alreadySown`, haría que la SIGUIENTE pasada también se creyera "la
    // primera".
    externalRefreshRunning = true;
    upcomingByCollection = [201, 202, 203].map((igdbId) => ({
      igdbId,
      title: `Fable ${igdbId}`,
      coverUrl: null,
      releaseYear: 2027,
      releaseDate: null,
      releaseDatePrecision: null,
      collectionIds: [555],
      editions: [],
    }));

    const resultado = await runRadarPass();
    assert.deepEqual(resultado, { collections: 1, discovered: 3, seeding: true });

    // Sembrado de verdad: las tres filas están en la tabla.
    const filas = await leerRadarGames();
    assert.deepEqual(
      filas.map((f) => f.igdbId).sort((a, b) => a - b),
      [201, 202, 203],
    );

    // Y MUDO: cero avisos flotantes pese a tres descubrimientos.
    assert.equal(notifyCalls.length, 0);

    // Y sin sellar: el refresco externo estaba ocupado.
    assert.equal(config.radarLastRunAt, 0);
  });

  it('la SIGUIENTE pasada ya no es "la primera" aunque la marca siga a cero: si hay algo nuevo, avisa', async () => {
    // Ahora el refresco externo está libre: esta pasada SÍ debe sellar. Y
    // aparece UNA secuela más (204); las tres de antes ya están en la tabla
    // y no cuentan como "fresh".
    externalRefreshRunning = false;
    upcomingByCollection = [
      ...upcomingByCollection,
      {
        igdbId: 204,
        title: 'Fable 204',
        coverUrl: null,
        releaseYear: 2028,
        releaseDate: null,
        releaseDatePrecision: null,
        collectionIds: [555],
        editions: [],
      },
    ];

    const resultado = await runRadarPass();
    // La aserción central de este test: seeding false aunque
    // radarLastRunAt siga en 0 desde el arranque — porque alreadySown ya
    // se puso a true en la pasada anterior.
    assert.deepEqual(resultado, { collections: 1, discovered: 1, seeding: false });

    // Y esta vez SÍ avisa, con el conteo de lo nuevo (1, no 4).
    assert.deepEqual(notifyCalls, [{ discovered: 1 }]);

    // Las cuatro filas conviven en la tabla.
    const filas = await leerRadarGames();
    assert.deepEqual(
      filas.map((f) => f.igdbId).sort((a, b) => a - b),
      [201, 202, 203, 204],
    );

    // Y esta vez sí se sella: el refresco externo estaba libre. Una sola
    // llamada a startExternalRefresh en TODA la secuencia: la pasada
    // anterior lo encontró ocupado y ni lo intentó (claimExternalRefresh
    // se limita a preguntar cuando el candado ya está tomado).
    assert.ok(config.radarLastRunAt > 0);
    assert.deepEqual(startExternalRefreshCalls, ['all']);
  });

  it('un juego que ya añadiste a la biblioteca desaparece del radar (deja de ser "pendiente")', async () => {
    // Añades tú mismo, desde la ficha, uno de los descubrimientos (204).
    await makeGame(db, { title: 'Fable 204', igdbId: 204, planned: false });
    // Y aparece SU appid en IGDB también, para que la fase 1 lo procese sin
    // reventar por falta de datos externos.
    externalDataByIgdbId.set(204, {
      ratingCritics: null,
      ratingCriticsCount: null,
      ratingUsers: null,
      ratingUsersCount: null,
      summary: null,
      igdbCollections: [{ id: 555, name: 'Fable Saga' }],
      releaseDate: null,
      releaseDatePrecision: null,
      releaseYear: null,
    });

    // force: true porque la pasada anterior SÍ selló la semana (el
    // refresco externo ya estaba libre) — sin forzar, esta simplemente no
    // arrancaría (todavía no ha pasado una semana), que es la guarda que
    // cubre el describe de arriba y no lo que este test quiere probar.
    await runRadarPass(true);

    // 204 ya no está en el horizonte: es tuyo, no un descubrimiento.
    const filas = await leerRadarGames();
    assert.deepEqual(
      filas.map((f) => f.igdbId).sort((a, b) => a - b),
      [201, 202, 203],
    );
  });
});

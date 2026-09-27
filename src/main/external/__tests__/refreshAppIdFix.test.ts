import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { gamesTable } from '../../db/schema';
import type { ExternalRefreshEvent } from '../../../shared/types';

// EL APPID CORREGIDO Y LO QUE ARRASTRA — en las dos rutas que lo corrigen sin
// tener al usuario mirando una ficha: la pasada de biblioteca (refresh.ts) y el
// ⟳ de la card Ratings (refreshRatings.ts).
//
// Cuando la revision descubre que el appid guardado era el de OTRO producto
// —"Trails in the Sky 2nd Chapter", el remake sin salir, llevaba el del
// original de 2015— no cambia un numero: cambia QUE JUEGO es ese juego en
// Steam. Y de ese numero cuelgan tres cosas, no dos:
//
//   1. Las etiquetas y las reseñas guardadas, que eran del producto viejo: a
//      null antes de escribir lo que Steam conteste.
//   2. El appid nuevo, en la misma transaccion que todo lo demas.
//   3. Los LOGROS, que es lo que faltaba: el catalogo y los desbloqueos
//      guardados siguen siendo los del juego viejo, y la pasada de logros del
//      arranque solo recoge a los que tienen achievementsSyncedAt a null
//      (steam/backfill.ts), asi que un juego ya sincronizado con el appid
//      equivocado no volvia a entrar JAMAS salvo pulsando "Sync now" a mano.
//      Solo el boton de la ficha lo hacia; la pasada de biblioteca no.
//
// Y el re-encolado va DESPUES de la transaccion a proposito, porque la cola
// relee el appid de la base de datos: si corriera antes, pediria los logros del
// appid viejo. Eso tambien se comprueba aqui, mirando la fila en el momento de
// la llamada.
//
// QUE ES REAL Y QUE ES DOBLE: la base es real (harness con las migraciones del
// repo) y runPass corre entera. Doblado, todo lo que sale a la red y la cola de
// logros; el notificador tambien, porque el final de la pasada es asincrono y
// su evento 'done' es la unica señal fiable de "ya termino".

// gameId -> el appid que la fila tenia EN EL MOMENTO de encolar sus logros.
const queued: { gameId: number; notify: boolean | undefined; appIdEntonces: number | null }[] = [];

mock.module('../../steam/backfill', {
  namedExports: {
    queueAchievementsRefreshForGame: async (
      gameId: number,
      options?: { notify?: boolean },
    ): Promise<boolean> => {
      const [row] = await db
        .select({ steamAppId: gamesTable.steamAppId })
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId));
      queued.push({ gameId, notify: options?.notify, appIdEntonces: row?.steamAppId ?? null });
      return true;
    },
  },
});

// igdbId -> appid bueno. Lo que devolveria findSteamAppIdCorrections.
let fixes = new Map<number, number>();
// Y lo mismo para UN juego, que es como lo pide el ⟳ de la card Ratings.
let fixForOne: number | undefined = undefined;

mock.module('../steamAppIdFix', {
  namedExports: {
    findSteamAppIdFixes: async (): Promise<Map<number, number>> => fixes,
    findSteamAppIdFix: async (): Promise<number | undefined> => fixForOne,
  },
});

// El detalle de IGDB que necesita el ⟳ de Ratings para llegar a mirar el
// appid: lo unico que importa aqui es que exista.
const detalle = (igdbId: number): Record<string, unknown> => ({
  igdbId,
  parentIgdbId: null,
  directSteamAppId: null,
  title: 'Trails in the Sky 2nd Chapter',
  summary: null,
  igdbCollections: null,
  release: null,
  releaseYear: null,
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
});

mock.module('../../igdb/api', {
  namedExports: {
    getGameExternalBatch: async (): Promise<Map<number, never>> => new Map<number, never>(),
    getSteamAppIds: async (): Promise<Map<number, never>> => new Map<number, never>(),
    getGameDetails: async (igdbId: number): Promise<Record<string, unknown>> => detalle(igdbId),
    resolveAchievementsSteamAppId: async (): Promise<null> => null,
  },
});

mock.module('../../hltb/api', {
  namedExports: {
    getHltbTimes: async (): Promise<null> => null,
  },
});

mock.module('../../steam/tags', {
  namedExports: {
    getSteamTags: async (): Promise<Map<number, never>> => new Map<number, never>(),
  },
});

mock.module('../../steam/reviews', {
  namedExports: {
    // null = Steam no supo nada de este appid. Es justo el caso del remake sin
    // salir: su pagina existe pero aun no tiene ni una reseña.
    getSteamReviewCounts: async (): Promise<null> => null,
    STEAM_REVIEWS_DELAY_MS: 0,
  },
});

mock.module('../adoptIgdb', {
  namedExports: {
    findAdoptionCandidates: async (): Promise<never[]> => [],
    adoptIgdbForCandidates: async (): Promise<number> => 0,
  },
});

mock.module('../sgdbBackfill', {
  namedExports: {
    fillMissingSgdbIds: async (): Promise<number> => 0,
  },
});

let doneEvent: ExternalRefreshEvent | null = null;
let resolveDone: (() => void) | null = null;
const waitForDone = (): Promise<void> =>
  new Promise((resolve) => {
    resolveDone = resolve;
  });

mock.module('../notify', {
  namedExports: {
    notifyExternalActivity: (event: ExternalRefreshEvent): void => {
      if (event.phase === 'done') {
        doneEvent = event;
        resolveDone?.();
        resolveDone = null;
      }
    },
  },
});

let startExternalRefresh: typeof import('../refresh').startExternalRefresh;
let refreshGameRatings: typeof import('../refreshRatings').refreshGameRatings;
let db: TestDb;

before(async () => {
  ({ startExternalRefresh } = await import('../refresh'));
  ({ refreshGameRatings } = await import('../refreshRatings'));
});

beforeEach(async () => {
  db = await freshDb();
  queued.length = 0;
  fixes = new Map();
  fixForOne = undefined;
  doneEvent = null;
});

after(() => {
  cleanupDbs();
});

const filaDe = async (
  id: number,
): Promise<{
  steamAppId: number | null;
  steamTags: { name: string; votes: number }[] | null;
  steamPositive: number | null;
}> => {
  const [row] = await db
    .select({
      steamAppId: gamesTable.steamAppId,
      steamTags: gamesTable.steamTags,
      steamPositive: gamesTable.steamPositive,
    })
    .from(gamesTable)
    .where(eq(gamesTable.id, id));
  return row;
};

describe('la pasada de biblioteca cuando el appid apuntaba a otro producto', () => {
  it('respects an App ID fixed by the user', async () => {
    const gameId = await makeGame(db, {
      title: 'User matched game',
      igdbId: 710,
      steamAppId: 123456,
      steamAppIdManual: true,
    });
    fixes = new Map([[710, 999999]]);

    const done = waitForDone();
    await startExternalRefresh('all');
    await done;

    assert.equal((await filaDe(gameId)).steamAppId, 123456);
    assert.deepEqual(queued, []);
  });

  it('corrige el appid, tira lo del producto viejo y re-encola sus logros', async () => {
    const remake = await makeGame(db, {
      title: 'Trails in the Sky 2nd Chapter',
      igdbId: 700,
      steamAppId: 251150,
      steamTags: [{ name: 'JRPG', votes: 900 }],
      steamPositive: 3000,
      // Ya sincronizado: sin re-encolar, la pasada de logros del arranque no
      // volveria a mirarlo nunca (solo recoge los que lo tienen a null).
      achievementsSyncedAt: new Date('2026-08-01T00:00:00Z'),
    });
    fixes = new Map([[700, 3005430]]);

    const done = waitForDone();
    await startExternalRefresh('all');
    await done;

    const fila = await filaDe(remake);
    assert.equal(fila.steamAppId, 3005430);
    assert.equal(fila.steamTags, null, 'las etiquetas eran del juego de 2015');
    assert.equal(fila.steamPositive, null, 'y sus tres mil reseñas tambien');

    assert.deepEqual(
      queued.map((call) => call.gameId),
      [remake],
      'el juego corregido vuelve a la cola de logros',
    );
    assert.equal(queued[0].notify, false, 'una pasada masiva no lanza avisos flotantes');
    assert.equal(
      queued[0].appIdEntonces,
      3005430,
      'se encola DESPUES de escribir: la cola lee el appid de la base',
    );
    assert.equal(doneEvent?.error, null);
    assert.equal(doneEvent?.summary?.appIdsFixed, 1);
  });

  it('sin correcciones no se encola nada: el appid bueno es identidad del juego', async () => {
    await makeGame(db, { title: 'Con su appid de siempre', igdbId: 701, steamAppId: 400 });

    const done = waitForDone();
    await startExternalRefresh('all');
    await done;

    assert.deepEqual(queued, [], 'un refresco normal no re-sincroniza los logros de nadie');
    assert.equal(doneEvent?.summary?.appIdsFixed, 0);
  });
});

// El ⟳ de la card Ratings corrige el MISMO appid por la misma via, asi que
// arrastra el mismo problema: sin esto, el juego se quedaba con los logros del
// producto viejo para siempre — y encima ninguna de las otras dos rutas iba a
// arreglarlo despues, porque el appid ya habia quedado bueno y la revision no
// vuelve a encontrar nada que corregir.
describe('el boton de refrescar las notas cuando el appid apuntaba a otro producto', () => {
  it('does not replace a manually fixed App ID', async () => {
    const gameId = await makeGame(db, {
      igdbId: 811,
      steamAppId: 123456,
      steamAppIdManual: true,
    });
    fixForOne = 999999;

    await refreshGameRatings(gameId);

    assert.equal((await filaDe(gameId)).steamAppId, 123456);
    assert.deepEqual(queued, []);
  });

  it('corrige el appid, tira las reseñas del producto viejo y re-encola sus logros', async () => {
    const remake = await makeGame(db, {
      title: 'Trails in the Sky 2nd Chapter',
      igdbId: 800,
      steamAppId: 251150,
      steamPositive: 3000,
      achievementsSyncedAt: new Date('2026-08-01T00:00:00Z'),
    });
    fixForOne = 3005430;

    await refreshGameRatings(remake);

    const fila = await filaDe(remake);
    assert.equal(fila.steamAppId, 3005430);
    assert.equal(fila.steamPositive, null, 'las reseñas eran del juego de 2015');
    assert.deepEqual(
      queued.map((call) => call.gameId),
      [remake],
    );
    assert.equal(queued[0].notify, false, 'lo estas mirando: no hace falta aviso flotante');
    assert.equal(
      queued[0].appIdEntonces,
      3005430,
      'se encola DESPUES de escribir: la cola lee el appid de la base',
    );
  });

  it('sin correccion, este boton sigue sin tocar los logros', async () => {
    const juego = await makeGame(db, {
      title: 'Con su appid de siempre',
      igdbId: 801,
      steamAppId: 400,
    });

    await refreshGameRatings(juego);

    assert.deepEqual(queued, [], 'este boton refresca notas, no logros');
  });
});

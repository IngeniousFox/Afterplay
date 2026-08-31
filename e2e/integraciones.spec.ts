import { missingFor } from './credentials';
import { expect, test } from './fixtures';
import type {
  CollectionGame,
  GameFullRefreshResult,
  IgdbGameDetail,
  RatingsRefreshResult,
  SgdbImages,
} from '../src/shared/types';

// LAS INTEGRACIONES DE VERDAD, CONTRA LAS APIS DE VERDAD.
//
// Estos son los tests que justifican tener credenciales en .env.test, y
// existen por una cicatriz concreta: en agosto de 2026 HowLongToBeat rotó su
// API (/api/bleed pasó a devolver 404 y todo se movió a /api/search/site).
// Ni un test se enteró — la suite entera dobla la red, como debe —, y el
// fallo se descubrió porque el dueño vio fichas sin tiempos. Un scraper
// contra una API no oficial se va a romper otra vez; lo único que se puede
// elegir es si nos enteramos el mismo día o meses después.
//
// LO QUE PRUEBAN es la cadena ENTERA por donde pasa un dato de verdad:
// renderer -> preload -> IPC -> main -> cliente HTTP -> API externa -> y de
// vuelta con la forma que la app espera. Por eso van por `api` (lo que usa la
// app) y no llamando al módulo por dentro: un canal de IPC renombrado o una
// firma de preload cambiada también los pone rojos.
//
// SON DISTINTOS AL RESTO y conviene saberlo: dependen de la red y de que un
// tercero siga en pie, así que pueden ponerse rojos sin que nadie haya tocado
// el repo. Eso NO es ruido: es exactamente la noticia que se quiere. Cuando
// uno falle, lo primero es mirar si la API cambió — no "arreglar el test".
//
// Sin .env.test se saltan solos diciendo qué falta. Los de HLTB y la tienda
// de Steam no necesitan ninguna clave y corren siempre.
//
// `globalThis.api` y no `window.api` a propósito: dentro de evaluate() el
// identificador `window` resolvería a la Page de Playwright de este fichero,
// no al global de la página. Va TIPADO con la firma real del preload (ver
// e2e/global.d.ts), así que renombrar un método allí pone rojo el typecheck
// de los tests en vez de fallar en ejecución.

type HltbResult = {
  hltbMain: number | null;
  hltbMainExtras: number | null;
  hltbCompletionist: number | null;
};

type Failed = { e2eError: string };

const failed = (value: unknown): value is Failed =>
  typeof value === 'object' && value !== null && 'e2eError' in value;

test.describe('integraciones externas', () => {
  test('HowLongToBeat sigue contestando con la forma que la app espera', async ({ afterplay }) => {
    const { window: page } = afterplay;

    // Un juego de 2017 con miles de envíos: si HLTB contesta, este tiene
    // tiempos. Elegido a propósito para que un vacío signifique "HLTB cambió
    // algo" y no "ese juego es demasiado de nicho".
    const times = await page.evaluate(async () => {
      try {
        return await globalThis.api.hltb.getTimes('Hollow Knight', 2017);
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(times) ? times.e2eError : 'ok',
      'HLTB falló — mira si rotó su API otra vez (src/main/hltb/client.ts)',
    ).toBe('ok');
    expect(times, 'HLTB no reconoció Hollow Knight: eso ya es la señal').not.toBeNull();

    // La forma EXACTA que guardan las columnas de games: si HLTB renombrara
    // sus campos, el cliente devolvería nulls y esto lo cazaría.
    const result = times as HltbResult;
    expect(typeof result.hltbMain).toBe('number');
    // Y una cifra con sentido: este juego no dura 0 horas ni 5.000.
    expect(result.hltbMain ?? 0).toBeGreaterThan(5);
    expect(result.hltbMain ?? 0).toBeLessThan(200);
  });

  test('la tienda de Steam sigue encontrando juegos por título', async ({ afterplay }) => {
    const { window: page } = afterplay;

    // El respaldo del alta cuando IGDB no tiene el juego (steam/store.ts). No
    // necesita clave: es la tienda pública.
    const results = await page.evaluate(async () => {
      try {
        return await globalThis.api.igdb.searchSteam('Hollow Knight');
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(results) ? results.e2eError : 'ok',
      'la tienda de Steam falló — mira src/main/steam/store.ts',
    ).toBe('ok');
    expect(Array.isArray(results)).toBe(true);
    expect((results as unknown[]).length).toBeGreaterThan(0);
  });

  test('IGDB sigue respondiendo a una búsqueda del alta', async ({ afterplay }) => {
    const missing = missingFor('TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET');
    test.skip(missing !== null, missing ?? '');

    const { window: page } = afterplay;

    // La misma llamada que hace el buscador del modal de añadir juego, con
    // las claves de .env.test: cubre además el token de Twitch (que caduca y
    // se renueva solo, igdb/auth.ts).
    const results = await page.evaluate(async () => {
      try {
        return await globalThis.api.igdb.search('Hollow Knight');
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(results) ? results.e2eError : 'ok',
      'IGDB falló — ¿caducaron las claves de .env.test?',
    ).toBe('ok');
    expect(Array.isArray(results)).toBe(true);
    expect((results as unknown[]).length).toBeGreaterThan(0);
  });

  test('IGDB sigue trayendo el detalle completo que necesita la ficha', async ({ afterplay }) => {
    const missing = missingFor('TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET');
    test.skip(missing !== null, missing ?? '');

    const { window: page } = afterplay;

    // getById es la llamada de la ficha de un juego dado de alta por IGDB. Se
    // busca primero (como hace el modal de alta) para no clavar a mano un
    // igdbId que un día deje de existir. Lo que se prueba es la FORMA: si IGDB
    // apaga un campo en silencio o cambia su schema, aquí sale a la primera
    // fila con un tipo o un valor que no cuadra.
    const detail = await page.evaluate(async () => {
      try {
        const results = await globalThis.api.igdb.search('Hollow Knight');
        const first = results[0];
        if (!first) return { e2eError: 'la búsqueda no encontró Hollow Knight' };
        return await globalThis.api.igdb.getById(first.igdbId);
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(detail) ? detail.e2eError : 'ok',
      'igdb.getById falló — mira getGameDetails en src/main/igdb/api.ts',
    ).toBe('ok');
    expect(detail, 'IGDB no devolvió detalle para Hollow Knight').not.toBeNull();

    const d = detail as IgdbGameDetail;
    expect(typeof d.title).toBe('string');
    expect(d.title.length).toBeGreaterThan(0);
    // Sin carátula la ficha se ve rota — este juego la tiene, así que null
    // aquí es la señal de que IGDB dejó de mandarla o el parser dejó de leerla.
    expect(typeof d.coverUrl).toBe('string');
    expect(d.releaseYear).toBe(2017);
    expect(Array.isArray(d.genres)).toBe(true);
    expect(d.genres.length).toBeGreaterThan(0);
    expect(typeof d.summary).toBe('string');
    expect((d.summary ?? '').length).toBeGreaterThan(0);
  });

  test('IGDB no vuelve a devolver vacío al pedir dos sagas de golpe', async ({ afterplay }) => {
    const missing = missingFor('TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET');
    test.skip(missing !== null, missing ?? '');
    test.setTimeout(60_000);

    const { window: page } = afterplay;

    // Hubo una regresión real de sintaxis en la query de getCollectionGames
    // (igdb/api.ts) que hacía que pedir MÁS DE UN id de colección a la vez
    // devolviera SIEMPRE un array vacío — con un solo id funcionaba, así que
    // sobrevivió sin que nadie la notara hasta que el carrusel de una saga
    // con más de un id de colección se quedó en blanco. Por eso este test
    // pide DOS sagas conocidas JUNTAS y exige que las DOS aparezcan, no solo
    // que la respuesta no esté vacía (que ya la pasaría un "solo devuelvo la
    // primera y callo la segunda").
    const outcome = await page.evaluate(async () => {
      try {
        const collectionIdFor = async (query: string): Promise<number> => {
          const results = await globalThis.api.igdb.search(query);
          const first = results[0];
          if (!first) throw new Error(`sin resultados de IGDB para "${query}"`);
          const detail = await globalThis.api.igdb.getById(first.igdbId);
          const collection = detail?.igdbCollections?.[0];
          if (!collection) throw new Error(`"${query}" no tiene saga en IGDB`);
          return collection.id;
        };

        const [collectionA, collectionB] = await Promise.all([
          collectionIdFor('Halo Infinite'),
          collectionIdFor("Uncharted 4: A Thief's End"),
        ]);
        const games = await globalThis.api.igdb.collectionGames([collectionA, collectionB]);
        return { collectionA, collectionB, games };
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(outcome) ? outcome.e2eError : 'ok',
      'collectionGames con dos ids falló — mira getCollectionGames en src/main/igdb/api.ts',
    ).toBe('ok');

    const { collectionA, collectionB, games } = outcome as {
      collectionA: number;
      collectionB: number;
      games: CollectionGame[];
    };
    expect(Array.isArray(games)).toBe(true);
    expect(
      games.length,
      'vacío al pedir dos ids: la regresión de sintaxis ha vuelto',
    ).toBeGreaterThan(0);

    const hasCollection = (id: number): boolean => games.some((g) => g.collectionIds.includes(id));
    expect(hasCollection(collectionA), 'faltan los juegos de la primera saga pedida').toBe(true);
    expect(hasCollection(collectionB), 'faltan los juegos de la segunda saga pedida').toBe(true);
  });

  test('SteamGridDB devuelve carátulas con una url utilizable', async ({ afterplay }) => {
    const missing = missingFor('STEAMGRIDDB_API_KEY');
    test.skip(missing !== null, missing ?? '');

    const { window: page } = afterplay;

    // Clave garantizada en .env.test y CERO tests hoy. Esto alimenta el
    // CoverPicker de la ficha: se busca por título+año, como hace la app
    // cuando el juego todavía no tiene un sgdbId propio guardado.
    const images = await page.evaluate(async () => {
      try {
        return await globalThis.api.sgdb.getImages({ title: 'Hollow Knight', releaseYear: 2017 });
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(images) ? images.e2eError : 'ok',
      'SteamGridDB falló — mira src/main/sgdb/api.ts',
    ).toBe('ok');

    const img = images as SgdbImages;
    expect(Array.isArray(img.grids)).toBe(true);
    expect(
      img.grids.length,
      'SteamGridDB no encontró ni una carátula de Hollow Knight',
    ).toBeGreaterThan(0);
    expect(img.grids[0].url.startsWith('http')).toBe(true);
    expect(img.heroes.length).toBeGreaterThan(0);
    expect(img.heroes[0].url.startsWith('http')).toBe(true);
  });

  test('external.refreshGame hace la pasada completa de un juego — la que habría cazado la rotación de HLTB', async ({
    afterplay,
  }) => {
    const missing = missingFor('TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET');
    test.skip(missing !== null, missing ?? '');
    test.setTimeout(60_000);

    const { window: page } = afterplay;

    // El id 1 del seed es "Assassin's Creed II" (appid 33230, sin igdbId
    // guardado — nunca se dio de alta desde IGDB). Este es EXACTAMENTE el
    // botón que habría cazado en vivo la rotación de HowLongToBeat de agosto
    // de 2026: pide IGDB, HowLongToBeat y Steam, y encola los logros, todo de
    // una vez.
    const result = await page.evaluate(async () => {
      try {
        return await globalThis.api.external.refreshGame(1);
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(result) ? result.e2eError : 'ok',
      'external.refreshGame falló — src/main/external/refreshGame.ts',
    ).toBe('ok');
    expect(result, 'el juego 1 no existe en este sandbox — revisa e2e/seed.ts').not.toBeNull();

    const r = result as GameFullRefreshResult;
    // El veredicto que de verdad importa para esta cicatriz: si HLTB rota
    // otra vez, este campo se pone 'failed' y el test se pone rojo el mismo
    // día en vez de meses después.
    expect(
      r.hltb,
      'HowLongToBeat falló en la pasada completa — ¿rotó su API otra vez? (src/main/hltb/client.ts)',
    ).toBe('updated');
    expect(['updated', 'adopted']).toContain(r.igdb);
    // El seed ya le puso el appid de Steam a este juego: no hay appid nuevo
    // que encontrar, así que el veredicto tiene que ser justo este.
    expect(r.steam).toBe('had-it');

    // Y que de verdad ESCRIBIÓ, no que solo contestó bien.
    const game = await page.evaluate(() => globalThis.api.games.getById(1));
    expect(
      game?.hltbMain ?? null,
      'la pasada dijo hltb: updated pero no escribió nada',
    ).not.toBeNull();
    expect(game?.hltbMain ?? 0).toBeGreaterThan(0);
  });

  test('external.refreshRatings es una ruta distinta: sin igdbId solo toca Steam', async ({
    afterplay,
  }) => {
    test.setTimeout(60_000);

    const { window: page } = afterplay;

    // El ⟳ de la card Ratings, a diferencia del botón de "actualizar todo" de
    // arriba, NO adopta un igdbId nuevo — eso es cosa exclusiva de
    // refreshGame.ts. Todo el seed tiene igdbId a null, así que en el id 2
    // ("Strange Horticulture", appid 1574580) esta ruta se queda SOLO con
    // Steam: es la decisión real que separa un botón del otro, y por eso el
    // test exige `ratings: null` en vez de limitarse a "no lanzó".
    const result = await page.evaluate(async () => {
      try {
        return await globalThis.api.external.refreshRatings(2);
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(result) ? result.e2eError : 'ok',
      'external.refreshRatings falló — src/main/external/refreshRatings.ts',
    ).toBe('ok');
    expect(result, 'el juego 2 no existe en este sandbox — revisa e2e/seed.ts').not.toBeNull();

    const r = result as RatingsRefreshResult;
    expect(r.ratings, 'sin igdbId no debería haber notas de IGDB en esta ruta').toBeNull();
    expect(r.steam).toBe('updated');

    const game = await page.evaluate(() => globalThis.api.games.getById(2));
    expect(typeof game?.steamPositive).toBe('number');
    expect(typeof game?.steamNegative).toBe('number');
  });

  test('hltb.refreshGame relee HowLongToBeat y ESCRIBE los tiempos nuevos', async ({
    afterplay,
  }) => {
    test.setTimeout(60_000);

    const { window: page } = afterplay;

    // El juego 1 (Assassin's Creed II) ya trae tiempos del seed — por eso NO
    // basta con comprobar que la fila tiene números después de refrescar: eso
    // sería cierto igual aunque el paso de ESCRITURA estuviera roto y se
    // hubiera limitado a conservar los del alta. Se compara el valor que
    // devuelve la llamada con el que queda de verdad guardado en la fila.
    const times = await page.evaluate(async () => {
      try {
        return await globalThis.api.hltb.refreshGame(1);
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(times) ? times.e2eError : 'ok',
      'hltb.refreshGame falló — mira si HLTB rotó su API otra vez (src/main/hltb/client.ts)',
    ).toBe('ok');
    expect(times, "HLTB no reconoció Assassin's Creed II al refrescar").not.toBeNull();

    const t = times as HltbResult;
    expect(t.hltbMain ?? 0).toBeGreaterThan(0);

    const game = await page.evaluate(() => globalThis.api.games.getById(1));
    expect(game?.hltbMain, 'la fila no tiene el valor que la llamada acaba de devolver').toBe(
      t.hltbMain,
    );
    expect(game?.hltbMainExtras).toBe(t.hltbMainExtras);
    expect(game?.hltbCompletionist).toBe(t.hltbCompletionist);
  });

  test('Steam Web API: achievements.refreshGame trae el catálogo con forma completa', async ({
    afterplay,
  }) => {
    const missing = missingFor('STEAM_API_KEY');
    test.skip(missing !== null, missing ?? '');
    test.setTimeout(60_000);

    const { window: page } = afterplay;

    // Terraria (id 5 del seed, appid 105600): catálogo de logros grande y
    // estable para probar la cadena entera con la clave de .env.test —
    // encolar, esperar el evento 'synced' de achievements:activity (el
    // resultado NO viaja en la respuesta del invoke, ver
    // achievements:refreshGame en ipc/achievements.ts), y leer lo que quedó
    // guardado con getForGame.
    const queued = await page.evaluate(async () => {
      try {
        (globalThis as { __synced?: unknown[] }).__synced = [];
        globalThis.api.achievements.onActivity((event) => {
          if (event.kind === 'synced') {
            (globalThis as { __synced?: unknown[] }).__synced?.push(event);
          }
        });
        return await globalThis.api.achievements.refreshGame(5);
      } catch (error) {
        return { e2eError: error instanceof Error ? error.message : String(error) };
      }
    });

    expect(
      failed(queued) ? queued.e2eError : 'ok',
      'achievements.refreshGame falló al encolar — src/main/steam/backfill.ts',
    ).toBe('ok');
    expect(
      queued,
      'no entró en la cola: Terraria tiene appid de Steam en el seed, así que debería',
    ).toBe(true);

    await page.waitForFunction(
      () =>
        (globalThis as { __synced?: { gameId: number }[] }).__synced?.some((e) => e.gameId === 5),
      undefined,
      { timeout: 30_000 },
    );

    const achievements = await page.evaluate(() => globalThis.api.achievements.getForGame(5));
    expect(achievements.steamAppId).toBe(105600);
    expect(
      achievements.syncedAt,
      'el catálogo llegó pero no se marcó como sincronizado',
    ).not.toBeNull();
    expect(
      achievements.entries.length,
      'Terraria sin logros: la Steam Web API no contestó como se esperaba',
    ).toBeGreaterThan(0);

    const first = achievements.entries[0];
    expect(typeof first.apiName).toBe('string');
    expect(first.apiName.length).toBeGreaterThan(0);
    expect(typeof first.displayName).toBe('string');
    expect(first.displayName.length).toBeGreaterThan(0);
    // El icono puede faltar en un logro oculto sin desbloquear, pero no en
    // TODOS: si esto falla, Steam dejó de mandar icon_gray/icon en el catálogo.
    expect(achievements.entries.some((entry) => entry.iconUrl !== null)).toBe(true);
  });
});

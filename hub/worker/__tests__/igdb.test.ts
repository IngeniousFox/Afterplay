import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seedGame } from '../../../src/main/db/v2/queries/common/__tests__/fixtures';
import { SYNC_ROUTES } from '../../../src/shared/sync/protocol';
import type { GameMedia, IgdbSearchResult, SagaEntry } from '../../../src/shared/api/v2/igdb';
import { IGDB_SECRET_PURPOSE } from '../src/igdbCredentials';
import { IgdbClient } from '../src/web/igdbClient';
import { openSecret } from '../../core/secretBox';
import { HOST, makeWorld, pairDevice, type World } from './helpers';

// Claves de IGDB del hub (F-29): subida cifrada, rutas de la PWA y cliente de
// IGDB. Todo con valores inventados y un `fetch` falso: nada de red.

const SECRETS_KEY = 'clave-maestra-de-prueba-con-mas-de-32-caracteres';
const KEYS = { clientId: 'cliente-de-prueba', clientSecret: 'secreto-de-prueba' };

interface FakeCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Un Twitch e IGDB falsos que contestan según la URL y el cuerpo APICalypse. */
function fakeIgdb(
  respondGames: (body: string) => unknown = () => [],
  options: { tokenStatus?: number; gamesStatus?: () => number } = {},
): { fetch: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body);
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) }, body });
    if (url.startsWith('https://id.twitch.tv/')) {
      if (options.tokenStatus) return new Response('{}', { status: options.tokenStatus });
      return Response.json({ access_token: 'token-de-prueba', expires_in: 3600 });
    }
    const status = options.gamesStatus?.() ?? 200;
    if (status !== 200) return new Response('{}', { status });
    return Response.json(respondGames(body));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const upload = (world: World, token: string, body: unknown = KEYS): Promise<Response> =>
  world.call(SYNC_ROUTES.igdbCredentials, { token, body });

const get = (world: World, path: string): Promise<Response> =>
  world.call(`/api/v2${path}`, { email: HOST });

async function readyWorld(
  respondGames?: (body: string) => unknown,
  options?: Parameters<typeof fakeIgdb>[1],
): Promise<{ world: World; token: string; tenantId: string; igdb: ReturnType<typeof fakeIgdb> }> {
  const igdb = fakeIgdb(respondGames, options);
  const world = makeWorld(HOST, { secretsKey: SECRETS_KEY, fetch: igdb.fetch });
  const { token, tenantId } = await pairDevice(world);
  return { world, token, tenantId, igdb };
}

describe('POST /sync/v1/igdb-credentials', () => {
  it('guarda las claves cifradas: en el almacenamiento no hay nada en claro', async () => {
    const { world, token, tenantId } = await readyWorld();

    const response = await upload(world, token);

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { stored: true });
    assert.ok(!text.includes(KEYS.clientSecret), 'la respuesta no devuelve las claves');

    const storage = (world.services.get(tenantId) as unknown as { igdbStore: unknown })
      .igdbStore as {
      storage: { exec(sql: string): Record<string, unknown>[] };
    };
    const rows = storage.storage.exec('SELECT envelope FROM worker_igdb_credentials');
    assert.equal(rows.length, 1);
    const envelope = String(rows[0].envelope);
    assert.match(envelope, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    assert.ok(!envelope.includes(KEYS.clientId) && !envelope.includes(KEYS.clientSecret));
    // Y con la clave del Worker se abre al contenido exacto.
    assert.deepEqual(
      JSON.parse(await openSecret(SECRETS_KEY, IGDB_SECRET_PURPOSE, tenantId, envelope)),
      KEYS,
    );
  });

  it('subir otras claves sustituye a las anteriores', async () => {
    const { world, token, igdb } = await readyWorld(() => []);
    await upload(world, token);
    await upload(world, token, { clientId: 'cliente-nuevo', clientSecret: 'secreto-nuevo' });

    await get(world, '/search?q=zelda');

    const withToken = igdb.calls.filter((call) => call.url.startsWith('https://id.twitch.tv/'));
    assert.match(withToken[0].body, /client_id=cliente-nuevo/);
  });

  it('sin HUB_SECRETS_KEY responde un error claro y no guarda nada', async () => {
    const world = makeWorld(HOST, {});
    const { token, tenantId } = await pairDevice(world);

    const response = await upload(world, token);

    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string; message: string };
    assert.equal(body.error, 'internal');
    assert.match(body.message, /HUB_SECRETS_KEY/);
    assert.ok(!JSON.stringify(body).includes(KEYS.clientSecret));
    const service = world.services.get(tenantId) as unknown as {
      igdbStore: { has(): boolean };
    };
    assert.equal(service.igdbStore.has(), false);
  });

  it('con una HUB_SECRETS_KEY demasiado corta tampoco guarda nada', async () => {
    const world = makeWorld(HOST, { secretsKey: 'corta' });
    const { token, tenantId } = await pairDevice(world);

    const response = await upload(world, token);

    assert.equal(response.status, 500);
    const service = world.services.get(tenantId) as unknown as { igdbStore: { has(): boolean } };
    assert.equal(service.igdbStore.has(), false);
  });

  it('exige el token del dispositivo', async () => {
    const { world } = await readyWorld();
    assert.equal((await world.call(SYNC_ROUTES.igdbCredentials, { body: KEYS })).status, 401);
    assert.equal(
      (
        await world.call(SYNC_ROUTES.igdbCredentials, {
          token: 'ap1.abc.desconocido-0123456789',
          body: KEYS,
        })
      ).status,
      401,
    );
  });

  it('rechaza cuerpos que no son dos textos y solo admite POST', async () => {
    const { world, token } = await readyWorld();
    assert.equal((await upload(world, token, { clientId: 'solo-uno' })).status, 400);
    assert.equal((await upload(world, token, { clientId: 1, clientSecret: 2 })).status, 400);
    assert.equal(
      (await upload(world, token, { clientId: 'con espacio', clientSecret: 'x' })).status,
      400,
    );
    const get405 = await world.call(SYNC_ROUTES.igdbCredentials, { token, method: 'GET' });
    assert.equal(get405.status, 405);
  });
});

describe('GET /api/v2/search', () => {
  it('sin claves subidas responde igdb_not_configured', async () => {
    const { world, igdb } = await readyWorld();

    const response = await get(world, '/search?q=zelda');

    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: string; message: string };
    assert.equal(body.error, 'igdb_not_configured');
    assert.match(body.message, /abre Afterplay en tu PC/);
    assert.equal(igdb.calls.length, 0);
  });

  it('busca con el token de Twitch, une las dos búsquedas y ordena por popularidad', async () => {
    const { world, token, igdb } = await readyWorld((body) => {
      if (body.includes('search "')) {
        return [
          { id: 1, name: 'Fangame', total_rating_count: 2 },
          {
            id: 2,
            name: 'Zelda',
            cover: { image_id: 'co1' },
            first_release_date: 1_000_000_000,
            total_rating_count: 900,
          },
          { id: 5, name: 'Edición', version_parent: 2 },
          { id: 6, name: 'DLC', game_type: 1 },
        ];
      }
      return [
        { id: 2, name: 'Zelda' },
        { id: 3, name: 'Zelda II', total_rating_count: 50 },
      ];
    });
    await upload(world, token);

    const response = await get(world, '/search?q=zelda');

    assert.equal(response.status, 200);
    const results = (await response.json()) as IgdbSearchResult[];
    assert.deepEqual(
      results.map((r) => r.igdbId),
      [2, 3, 1],
    );
    assert.deepEqual(results[0], {
      igdbId: 2,
      title: 'Zelda',
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.webp',
      releaseYear: 2001,
      owned: null,
    });
    const igdbCalls = igdb.calls.filter((call) => call.url.startsWith('https://api.igdb.com/'));
    assert.equal(igdbCalls.length, 2);
    for (const call of igdbCalls) {
      assert.equal(call.headers.Authorization, 'Bearer token-de-prueba');
      assert.equal(call.headers['Client-ID'], KEYS.clientId);
    }
  });

  it('el token de Twitch se reutiliza entre peticiones y se renueva al caducar', async () => {
    const { world, token, igdb } = await readyWorld(() => []);
    await upload(world, token);
    const twitch = (): number =>
      igdb.calls.filter((call) => call.url.startsWith('https://id.twitch.tv/')).length;

    await get(world, '/search?q=zelda');
    await get(world, '/search?q=mario');
    assert.equal(twitch(), 1);

    world.time.now += 3600_000;
    await get(world, '/search?q=metroid');
    assert.equal(twitch(), 2);
  });

  it('escapa las comillas del texto y recorta lo larguísimo', async () => {
    const { world, token, igdb } = await readyWorld(() => []);
    await upload(world, token);

    await get(world, `/search?q=${encodeURIComponent('a"b\\c')}`);
    await get(world, `/search?q=${'x'.repeat(500)}`);

    const bodies = igdb.calls.filter((c) => c.url.includes('/games')).map((c) => c.body);
    assert.ok(bodies[0].includes('search "a\\"b\\\\c"'));
    assert.ok(bodies.some((b) => b.includes(`search "${'x'.repeat(150)}"`)));
    assert.ok(!bodies.some((b) => b.includes('x'.repeat(151))));
  });

  it('un texto de menos de 2 letras da vacío sin tocar la red', async () => {
    const { world, token, igdb } = await readyWorld();
    await upload(world, token);

    const response = await get(world, '/search?q=a');

    assert.deepEqual(await response.json(), []);
    assert.equal(igdb.calls.length, 0);
  });

  it('Twitch rechaza las claves: igdb_unavailable sin repetir las claves', async () => {
    const { world, token } = await readyWorld(undefined, { tokenStatus: 403 });
    await upload(world, token);

    const response = await get(world, '/search?q=zelda');

    assert.equal(response.status, 502);
    const text = await response.text();
    assert.equal((JSON.parse(text) as { error: string }).error, 'igdb_unavailable');
    assert.ok(!text.includes(KEYS.clientSecret) && !text.includes(KEYS.clientId));
  });

  it('un 401 de IGDB descarta el token y reintenta una vez', async () => {
    let first = true;
    const { world, token, igdb } = await readyWorld(() => [], {
      gamesStatus: () => {
        if (first) {
          first = false;
          return 401;
        }
        return 200;
      },
    });
    await upload(world, token);

    const response = await get(world, '/search?q=zelda');

    assert.equal(response.status, 200);
    assert.equal(igdb.calls.filter((c) => c.url.startsWith('https://id.twitch.tv/')).length, 2);
  });
});

describe('IgdbClient: tiempo máximo y errores de red', () => {
  const client = (fetchImpl: typeof fetch, timeoutMs = 20): IgdbClient =>
    new IgdbClient({
      loadCredentials: async () => KEYS,
      now: () => 0,
      fetch: fetchImpl,
      timeoutMs,
    });

  it('una petición que no contesta se corta al pasar el tiempo máximo', async () => {
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('abortada')));
      })) as typeof fetch;

    await assert.rejects(client(hanging).search('zelda'), (error: unknown) => {
      const e = error as { code?: string; message: string };
      return e.code === 'igdb_unavailable' && /tiempo agotado/.test(e.message);
    });
  });

  it('un fallo de red es igdb_unavailable y no deja pasar el mensaje original', async () => {
    const broken = (async () => {
      throw new Error(`fallo con client_secret=${KEYS.clientSecret}`);
    }) as typeof fetch;

    await assert.rejects(client(broken).search('zelda'), (error: unknown) => {
      const e = error as { code?: string; message: string };
      return e.code === 'igdb_unavailable' && !e.message.includes(KEYS.clientSecret);
    });
  });

  it('sin claves es igdb_not_configured', async () => {
    const noKeys = new IgdbClient({ loadCredentials: async () => null, now: () => 0 });
    await assert.rejects(
      noKeys.search('zelda'),
      (error: unknown) => (error as { code?: string }).code === 'igdb_not_configured',
    );
  });

  it('sin fetch inyectado llama al global suelto, sin otro this (Workers lo exige)', async () => {
    const original = globalThis.fetch;
    const fake = fakeIgdb(() => []);
    let calledLoose: boolean | null = null;
    globalThis.fetch = function (this: unknown, input: string | URL | Request, init?: RequestInit) {
      calledLoose = this === undefined || this === globalThis;
      return fake.fetch(input, init);
    } as typeof fetch;
    try {
      const withGlobal = new IgdbClient({ loadCredentials: async () => KEYS, now: () => 0 });
      assert.deepEqual(await withGlobal.search('zelda'), []);
      assert.equal(calledLoose, true, 'fetch llamado como método');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('dos peticiones a la vez comparten UNA petición de token', async () => {
    const igdb = fakeIgdb(() => []);
    const shared = client(igdb.fetch, 1000);
    await Promise.all([shared.search('zelda'), shared.search('mario')]);
    assert.equal(igdb.calls.filter((c) => c.url.startsWith('https://id.twitch.tv/')).length, 1);
  });
});

describe('rutas de la ficha: saga y media', () => {
  /** Un hub con juegos de prueba y las claves ya subidas. */
  async function withGames(respondGames: (body: string) => unknown): Promise<{
    world: World;
    ids: { base: string; inLibrary: string; planned: string; noIgdb: string; noCollection: string };
    calls: FakeCall[];
  }> {
    const { world, token, tenantId, igdb } = await readyWorld(respondGames);
    await upload(world, token);
    const service = world.services.get(tenantId);
    assert.ok(service);
    const ids = service.queries().write((ctx) => ({
      base: seedGame(ctx, {
        title: 'Capítulo 1',
        igdbId: 100,
        metadata: { igdbCollections: [{ id: 7, name: 'Saga de prueba' }] },
      }),
      inLibrary: seedGame(ctx, { title: 'Capítulo 2', igdbId: 101 }),
      planned: seedGame(ctx, { title: 'Capítulo 3', igdbId: 102, planned: true }),
      noIgdb: seedGame(ctx, { title: 'De Steam' }),
      noCollection: seedGame(ctx, { title: 'Suelto', igdbId: 200 }),
    })).result;
    return { world, ids, calls: igdb.calls };
  }

  it('search: marca lo que ya está en tu biblioteca o en tu Plan', async () => {
    const { world } = await withGames(() => [
      { id: 101, name: 'Capítulo 2', total_rating_count: 30 },
      { id: 102, name: 'Capítulo 3', total_rating_count: 20 },
      { id: 103, name: 'Capítulo 4', total_rating_count: 10 },
    ]);

    const response = await get(world, '/search?q=capitulo');

    assert.equal(response.status, 200);
    const results = (await response.json()) as IgdbSearchResult[];
    assert.deepEqual(
      results.map((r) => [r.igdbId, r.owned]),
      [
        [101, 'library'],
        [102, 'plan'],
        [103, null],
      ],
    );
  });

  it('saga: capítulos de IGDB cruzados con tu biblioteca y tu Plan', async () => {
    const { world, ids } = await withGames(() => [
      { id: 100, name: 'Capítulo 1', first_release_date: 946_684_800, game_type: 0 },
      { id: 101, name: 'Capítulo 2', first_release_date: 1_041_379_200, game_type: 0 },
      { id: 102, name: 'Capítulo 3', first_release_date: 1_136_073_600, game_type: 0 },
      {
        id: 103,
        name: 'Capítulo 4',
        cover: { image_id: 'co4' },
        first_release_date: 1_230_768_000,
        game_type: 0,
      },
      { id: 104, name: 'Edición', first_release_date: 1_230_768_000, game_type: 8 },
    ]);

    const response = await get(world, `/games/${ids.base}/saga`);

    assert.equal(response.status, 200);
    const saga = (await response.json()) as SagaEntry[];
    assert.deepEqual(
      saga.map((e) => [e.igdbId, e.libraryId, e.planned, e.releaseYear]),
      [
        [100, ids.base, false, 2000],
        [101, ids.inLibrary, false, 2003],
        [102, ids.planned, true, 2006],
        [103, null, false, 2009],
      ],
    );
    assert.equal(
      saga[3].coverUrl,
      'https://images.igdb.com/igdb/image/upload/t_cover_big/co4.webp',
    );
  });

  it('saga: pide a IGDB las colecciones del juego', async () => {
    const { world, ids, calls } = await withGames(() => []);
    await get(world, `/games/${ids.base}/saga`);
    assert.ok(calls.some((c) => c.body.includes('collections = (7)')));
  });

  it('saga y media: un juego sin colecciones o sin igdbId da vacío sin tocar IGDB', async () => {
    const { world, ids, calls } = await withGames(() => []);
    const before = calls.length;

    assert.deepEqual(await (await get(world, `/games/${ids.noCollection}/saga`)).json(), []);
    assert.deepEqual(await (await get(world, `/games/${ids.noIgdb}/media`)).json(), {
      screenshots: [],
      videoId: null,
    });
    assert.equal(calls.length, before);
  });

  it('un juego que no existe es not_found', async () => {
    const { world } = await withGames(() => []);
    assert.equal((await get(world, '/games/no-existe/saga')).status, 404);
    assert.equal((await get(world, '/games/no-existe/media')).status, 404);
  });

  it('media: capturas en 1080p y el mejor tráiler', async () => {
    const { world, ids, calls } = await withGames(() => [
      {
        id: 100,
        screenshots: [{ image_id: 'sc1' }, { image_id: 'sc2' }],
        videos: [
          { video_id: 'diario', name: 'Dev Diary 3' },
          { video_id: 'jugable', name: 'Gameplay Trailer' },
          { video_id: 'lanzamiento', name: 'Launch Trailer' },
        ],
      },
    ]);

    const response = await get(world, `/games/${ids.base}/media`);

    assert.equal(response.status, 200);
    const media = (await response.json()) as GameMedia;
    assert.deepEqual(media, {
      screenshots: [
        'https://images.igdb.com/igdb/image/upload/t_1080p/sc1.webp',
        'https://images.igdb.com/igdb/image/upload/t_1080p/sc2.webp',
      ],
      videoId: 'lanzamiento',
    });
    assert.ok(calls.some((c) => c.body.includes('where id = 100;')));
  });

  it('sin claves subidas, la saga y el media responden igdb_not_configured', async () => {
    const world = makeWorld(HOST, { secretsKey: SECRETS_KEY, fetch: fakeIgdb().fetch });
    const { tenantId } = await pairDevice(world);
    const service = world.services.get(tenantId);
    assert.ok(service);
    const id = service.queries().write((ctx) =>
      seedGame(ctx, {
        title: 'Con saga',
        igdbId: 100,
        metadata: { igdbCollections: [{ id: 7, name: 'Saga' }] },
      }),
    ).result;

    for (const sub of ['saga', 'media']) {
      const response = await get(world, `/games/${id}/${sub}`);
      assert.equal(response.status, 409);
      assert.equal(((await response.json()) as { error: string }).error, 'igdb_not_configured');
    }
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  ApiFailure,
  REQUEST_TIMEOUT_MS,
  addToPlan,
  fetchGame,
  fetchStats,
  reorderPlan,
  searchGames,
  startTimer,
} from '../api';

// El cliente de la API contra un `fetch` falso: URL y cuerpo de cada ruta, el
// tope de espera, el reconocimiento de la sesión de Access caducada y el mapeo
// de los códigos de error del hub a mensajes.

type Call = { url: string; init: RequestInit };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

const stub = (respond: (call: Call) => Response | Promise<Response>): Call[] => {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const failure = async (promise: Promise<unknown>): Promise<ApiFailure> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiFailure, 'se esperaba un ApiFailure');
    return error;
  }
  throw new Error('se esperaba un fallo');
};

describe('rutas', () => {
  it('lee de /api/v2 con el id de texto codificado', async () => {
    const calls = stub(() => json({ id: 'a/b' }));
    await fetchGame('a/b');
    assert.equal(calls[0].url, '/api/v2/games/a%2Fb');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(calls[0].init.body, undefined);
  });

  it('manda siempre la zona horaria del navegador en las estadísticas', async () => {
    const calls = stub(() => json({}));
    await fetchStats();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.equal(calls[0].url, `/api/v2/stats/summary?tz=${encodeURIComponent(zone)}`);
  });

  it('codifica la búsqueda', async () => {
    const calls = stub(() => json([]));
    await searchGames('zelda & link');
    assert.equal(calls[0].url, '/api/v2/search?q=zelda%20%26%20link');
  });

  it('escribe JSON en las rutas POST', async () => {
    const calls = stub(() => json({ applied: true }));
    await reorderPlan(['g2', 'g1']);
    assert.equal(calls[0].url, '/api/v2/plan/reorder');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { orderedIds: ['g2', 'g1'] });
    assert.equal(
      (calls[0].init.headers as Record<string, string>)['Content-Type'],
      'application/json',
    );
  });

  it('añade al Plan solo lo que da la búsqueda', async () => {
    const calls = stub(() => json({ gameId: 'g1' }));
    await addToPlan({ igdbId: 7, title: 'Example', coverUrl: null, releaseYear: 2001 });
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      igdbId: 7,
      title: 'Example',
      coverUrl: null,
      releaseYear: 2001,
    });
  });
});

describe('sesión de Access caducada', () => {
  it('una redirección opaca es una sesión caducada', async () => {
    stub(
      () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() }) as Response,
    );
    const error = await failure(fetchStats());
    assert.equal(error.code, 'session_expired');
    assert.match(error.message, /session has expired/i);
  });

  it('una página HTML en vez de JSON es una sesión caducada', async () => {
    stub(() => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }));
    assert.equal((await failure(fetchStats())).code, 'session_expired');
  });

  it('un 401 o 403 sin cuerpo JSON es una sesión caducada', async () => {
    stub(() => new Response('', { status: 403, headers: { 'Content-Type': 'text/html' } }));
    assert.equal((await failure(fetchStats())).code, 'session_expired');
    stub(() => new Response('', { status: 401 }));
    assert.equal((await failure(fetchStats())).code, 'session_expired');
  });

  it('el 401 del hub también lo es', async () => {
    stub(() => json({ error: 'unauthorized', message: 'sesión de Access no válida' }, 401));
    assert.equal((await failure(fetchStats())).code, 'session_expired');
  });

  it('un 403 del hub es "sin biblioteca", no una sesión caducada', async () => {
    stub(() => json({ error: 'forbidden', message: 'esta cuenta no tiene acceso' }, 403));
    const error = await failure(fetchStats());
    assert.equal(error.code, 'forbidden');
    assert.match(error.message, /isn't linked/);
  });
});

describe('códigos de error', () => {
  it('igdb_not_configured pide abrir Afterplay en el PC', async () => {
    stub(() => json({ error: 'igdb_not_configured', message: 'sin claves' }, 409));
    const error = await failure(searchGames('x'));
    assert.equal(error.code, 'igdb_not_configured');
    assert.equal(error.message, 'Open Afterplay on your PC once to enable search.');
  });

  it('igdb_unavailable dice que IGDB no responde', async () => {
    stub(() => json({ error: 'igdb_unavailable', message: 'timeout' }, 502));
    const error = await failure(searchGames('x'));
    assert.equal(error.code, 'igdb_unavailable');
    assert.equal(error.message, "IGDB isn't responding. Try again later.");
  });

  it('los choques del cronómetro traen el mensaje del hub', async () => {
    const message = 'ese juego se está jugando en PC-A';
    stub(() => json({ error: 'conflict', message }, 409));
    const error = await failure(startTimer('g1'));
    assert.equal(error.code, 'conflict');
    assert.equal(error.message, message);
  });

  it('un error interno no enseña el texto del hub', async () => {
    stub(() => json({ error: 'internal', message: 'error interno del hub' }, 500));
    const error = await failure(fetchStats());
    assert.equal(error.code, 'internal');
    assert.doesNotMatch(error.message, /hub/);
  });

  it('un 500 que no es JSON es un error interno, no una sesión caducada', async () => {
    stub(
      () => new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }),
    );
    assert.equal((await failure(fetchStats())).code, 'internal');
  });

  it('un fallo de red es "network"', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    assert.equal((await failure(fetchStats())).code, 'network');
  });
});

describe('tope de espera', () => {
  it('corta la petición a los 15 s con un mensaje claro', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.fetch = ((_url: RequestInfo | URL, init: RequestInit = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('abort', 'AbortError')),
        );
      })) as typeof fetch;

    const pending = failure(fetchStats());
    mock.timers.tick(REQUEST_TIMEOUT_MS);
    const error = await pending;
    assert.equal(error.code, 'timeout');
    assert.match(error.message, /too long/);
  });

  it('el tope es de 15 segundos', () => {
    assert.equal(REQUEST_TIMEOUT_MS, 15_000);
  });
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, beforeEach, describe, it, mock } from 'node:test';
import { pathToFileURL } from 'node:url';

// EL CLIENTE DE HOWLONGTOBEAT (client.ts).
//
// Existe porque el paquete hltb-client se quedo con las URLs viejas de la API
// (/api/bleed*, 404) y HLTB las movio a /api/search/site*. Lo que se blinda
// aqui no es "que busque", sino el contrato con esa API no oficial, que es
// justo lo que se rompe cuando HLTB rota algo:
//
//   1. Pide el token a /init y lo MANDA en cada busqueda (cabeceras + cuerpo).
//   2. El par hp va en el cuerpo con la clave DINAMICA como nombre de campo.
//   3. Cachea el token: dos busquedas seguidas = un solo /init.
//   4. Un 403 tira el token y reintenta UNA vez con uno fresco.
//   5. Convierte segundos a horas y descarta los tramos a 0 (juego sin envios).
//
// QUE ES REAL Y QUE ES DOBLE: el cliente es el de verdad; lo unico doblado es
// axios, que es lo que toca la red. Se dobla con la URL RESUELTA del paquete
// (misma cicatriz que drainMailbox.test.ts): mock.module('axios') a secas NO
// intercepta nada bajo tsx y encima falla en silencio, saliendo A LA RED REAL
// de HLTB. Si este test empieza a tardar segundos, es que el doble dejo de
// casar y se esta hablando con howlongtobeat.com de verdad.

type Capturada = { url: string; body?: unknown; headers?: Record<string, string> };
const gets: Capturada[] = [];
const posts: Capturada[] = [];

// Lo que contesta cada endpoint, sobrescribible por test.
let initResponse: () => unknown = () => ({
  data: { token: 'tok-1', hpKey: 'hpk-1', hpVal: 'hpv-1' },
});
let postResponse: (n: number) => unknown = () => ({ data: { data: [] } });
let postCount = 0;

class FakeAxiosError extends Error {
  response?: { status: number };
  constructor(status: number) {
    super(`status ${status}`);
    this.response = { status };
  }
}

const fakeInstance = {
  get: async (url: string): Promise<unknown> => {
    gets.push({ url });
    return initResponse();
  },
  post: async (
    url: string,
    body: unknown,
    config?: { headers?: Record<string, string> },
  ): Promise<unknown> => {
    posts.push({ url, body, headers: config?.headers });
    return postResponse(postCount++);
  },
};

mock.module(pathToFileURL(createRequire(__filename).resolve('axios')).href, {
  defaultExport: {
    create: (): typeof fakeInstance => fakeInstance,
  },
  namedExports: {
    // El cliente hace `error instanceof AxiosError`: tiene que ser la MISMA
    // clase que fabricamos abajo para simular el 403.
    AxiosError: FakeAxiosError,
  },
});

let HLTBClient: typeof import('../client').HLTBClient;

before(async () => {
  ({ HLTBClient } = await import('../client'));
});

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  postCount = 0;
  initResponse = () => ({ data: { token: 'tok-1', hpKey: 'hpk-1', hpVal: 'hpv-1' } });
  postResponse = () => ({ data: { data: [] } });
});

describe('cliente de HowLongToBeat', () => {
  it('pide el token a /init y lo manda en la busqueda (cabeceras + cuerpo)', async () => {
    postResponse = () => ({
      data: {
        data: [{ game_id: 1, game_name: 'Hollow Knight', comp_main: 97200, release_world: 2017 }],
      },
    });
    const client = new HLTBClient();
    const results = await client.search('hollow knight', { limit: 5 });

    assert.equal(gets.length, 1);
    assert.match(gets[0].url, /\/api\/search\/site\/init/);
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/api\/search\/site$/);

    // El token, en las tres cabeceras.
    assert.equal(posts[0].headers?.['x-auth-token'], 'tok-1');
    assert.equal(posts[0].headers?.['x-hp-key'], 'hpk-1');
    assert.equal(posts[0].headers?.['x-hp-val'], 'hpv-1');

    // Y el par hp DENTRO del cuerpo, con la clave dinamica como nombre de
    // campo: es la parte que mas facil se olvida y sin la que HLTB da 403.
    const body = posts[0].body as Record<string, unknown>;
    assert.equal(body['hpk-1'], 'hpv-1');
    assert.deepEqual(body.searchTerms, ['hollow', 'knight']);

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Hollow Knight');
  });

  it('convierte segundos a horas y descarta los tramos a 0', async () => {
    postResponse = () => ({
      data: {
        data: [
          // main 27h, extra 42h, 100% ausente (0 => sin envios todavia).
          { game_id: 2, game_name: 'X', comp_main: 97200, comp_plus: 151200, comp_100: 0 },
        ],
      },
    });
    const [game] = await new HLTBClient().search('x');
    assert.equal(game.completionTimes.main, 27);
    assert.equal(game.completionTimes.mainExtra, 42);
    assert.equal(game.completionTimes.completionist, undefined);
  });

  it('cachea el token: dos busquedas seguidas = un solo /init', async () => {
    const client = new HLTBClient();
    await client.search('a');
    await client.search('b');
    assert.equal(gets.length, 1, 'el /init deberia pedirse una sola vez');
    assert.equal(posts.length, 2);
  });

  it('ante un 403 tira el token y reintenta una vez con uno fresco', async () => {
    let initCalls = 0;
    initResponse = () => {
      initCalls += 1;
      return {
        data: { token: `tok-${initCalls}`, hpKey: `hpk-${initCalls}`, hpVal: `hpv-${initCalls}` },
      };
    };
    // Primera POST: 403. Segunda: OK.
    postResponse = (n) => {
      if (n === 0) throw new FakeAxiosError(403);
      return { data: { data: [{ game_id: 3, game_name: 'Y', comp_main: 3600 }] } };
    };

    const results = await new HLTBClient().search('y');

    assert.equal(initCalls, 2, 'el 403 deberia forzar un token nuevo');
    assert.equal(posts.length, 2);
    // El reintento usa el token FRESCO, no el quemado.
    assert.equal(posts[1].headers?.['x-auth-token'], 'tok-2');
    assert.equal(results[0].name, 'Y');
  });

  it('un token con forma inesperada falla limpio', async () => {
    initResponse = () => ({ data: { token: 'solo-el-token' } }); // faltan hpKey/hpVal
    await assert.rejects(() => new HLTBClient().search('z'), /token de HowLongToBeat/i);
  });
});

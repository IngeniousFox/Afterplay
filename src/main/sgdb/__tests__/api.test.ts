import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

// resolveSgdbId: LA VÍA EXACTA (appid) ANTES QUE LA DIFUSA (nombre+año).
//
// Lo que se blinda, tal cual lo documenta el propio módulo: con appid de
// Steam, el emparejado es EXACTO y no hay matcher difuso de por medio; sin
// appid (un juego de consola, por ejemplo) se cae al nombre+año con su
// umbral. Y la parte menos obvia, que es la que de verdad puede romperse en
// un refactor sin que nadie se dé cuenta: cuando SÍ hay appid pero
// SteamGridDB NO lo conoce (juego retirado, id equivocado…), resolveSgdbId
// NO reintenta por nombre — devuelve null tal cual. "El orden no es
// casual", dice el comentario: mezclar las dos vías dejaría que un juego
// con appid malo colara un match por nombre que nadie pidió.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: resolveSgdbId, sgdbSearch y
// sgdbSearchBySteamAppId son el código real; lo doblado es sgdb/client.ts
// (getSgdbClient), que es lo único que toca la red/el SDK de terceros.

type ClienteFalso = {
  searchGame: (title: string) => Promise<unknown>;
  getGameBySteamAppId: (appId: number) => Promise<unknown>;
  getGridsById: (id: number) => Promise<unknown>;
  getHeroesById: (id: number) => Promise<unknown>;
  getLogosById: (id: number) => Promise<unknown>;
};

const searchGameCalls: string[] = [];
const getByAppIdCalls: number[] = [];

let searchGameImpl: (title: string) => Promise<unknown> = async () => [];
let getByAppIdImpl: (appId: number) => Promise<unknown> = async () => null;

const clienteFalso: ClienteFalso = {
  searchGame: async (title) => {
    searchGameCalls.push(title);
    return searchGameImpl(title);
  },
  getGameBySteamAppId: async (appId) => {
    getByAppIdCalls.push(appId);
    return getByAppIdImpl(appId);
  },
  getGridsById: async () => [],
  getHeroesById: async () => [],
  getLogosById: async () => [],
};

mock.module('../client', {
  namedExports: {
    getSgdbClient: async (): Promise<ClienteFalso> => clienteFalso,
  },
});

let resolveSgdbId: typeof import('../api').resolveSgdbId;
let sgdbSearch: typeof import('../api').sgdbSearch;

before(async () => {
  ({ resolveSgdbId, sgdbSearch } = await import('../api'));
});

beforeEach(() => {
  searchGameCalls.length = 0;
  getByAppIdCalls.length = 0;
  searchGameImpl = async () => [];
  getByAppIdImpl = async () => null;
});

// La consola avisa (console.warn) cuando la vía por appid falla o no
// encuentra nada — correcto en la app, ruido en el test.
const realWarn = console.warn;
before(() => {
  console.warn = (): void => {};
});
after(() => {
  console.warn = realWarn;
});

describe('resolveSgdbId — appid antes que nombre', () => {
  it('con steamAppId, solo llama a la vía exacta: nunca busca por nombre', async () => {
    getByAppIdImpl = async () => ({ id: 555 });
    const resultado = await resolveSgdbId({
      title: 'Un Juego',
      releaseYear: 2020,
      steamAppId: 292030,
    });
    assert.equal(resultado, 555);
    assert.deepEqual(getByAppIdCalls, [292030]);
    assert.equal(searchGameCalls.length, 0, 'no debería haber buscado por nombre');
  });

  it('con steamAppId pero SGDB no lo conoce, null — SIN caer a la búsqueda por nombre', async () => {
    // La decisión que más fácil se rompe: "si el appid no encuentra nada,
    // probemos por nombre" parece razonable pero es justo lo que el
    // comentario del módulo descarta a propósito.
    getByAppIdImpl = async () => {
      throw new Error('Game not found');
    };
    const resultado = await resolveSgdbId({
      title: 'Un Juego',
      releaseYear: 2020,
      steamAppId: 292030,
    });
    assert.equal(resultado, null);
    assert.equal(searchGameCalls.length, 0, 'un appid sin ficha no debe reintentar por nombre');
  });

  it('sin steamAppId, cae a la búsqueda difusa por título y año', async () => {
    searchGameImpl = async () => [{ id: 10, name: 'Un Juego De Consola', release_date: null }];
    const resultado = await resolveSgdbId({
      title: 'Un Juego De Consola',
      releaseYear: 2015,
      steamAppId: null,
    });
    assert.equal(resultado, 10);
    assert.deepEqual(searchGameCalls, ['Un Juego De Consola']);
    assert.equal(getByAppIdCalls.length, 0, 'sin appid no hay vía exacta que probar');
  });

  it('sin steamAppId y sin match razonable por nombre, null', async () => {
    searchGameImpl = async () => [
      { id: 1, name: 'Algo Completamente Distinto', release_date: null },
    ];
    const resultado = await resolveSgdbId({
      title: 'Un Juego De Consola',
      releaseYear: 2015,
      steamAppId: null,
    });
    assert.equal(resultado, null);
  });

  it('sin steamAppId, un fallo de red en la búsqueda no lanza: null', async () => {
    // resolveSgdbId envuelve sgdbSearch en su propio try/catch — a
    // diferencia de la vía por appid, que ya se traga sus errores dentro de
    // sgdbSearchBySteamAppId.
    searchGameImpl = async () => {
      throw new Error('SteamGridDB tardó demasiado en responder');
    };
    const resultado = await resolveSgdbId({
      title: 'Un Juego',
      releaseYear: 2020,
      steamAppId: null,
    });
    assert.equal(resultado, null);
  });
});

describe('sgdbSearch — filtra DLC/mods devueltos junto al juego base', () => {
  it('con varios candidatos, elige el que de verdad casa por título y año', async () => {
    searchGameImpl = async () => [
      { id: 1, name: 'Elden Ring Seamless Co-op', release_date: null },
      { id: 2, name: 'Elden Ring', release_date: 1634169600 }, // 2021-10-14
    ];
    const resultado = await sgdbSearch('Elden Ring', 2022);
    assert.equal(resultado, 2, 'el mod no debería ganarle al juego base');
  });
});

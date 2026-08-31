import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';
import type { HltbSearchGame } from '../client';

// getHltbTimes: EL DESCARTE DE "FICHA SIN ENVÍOS TODAVÍA".
//
// La decisión que se blinda aquí, documentada en el propio api.ts: un
// candidato puede pasar findBestMatch (título y año encajan) sin que nadie
// haya enviado tiempos a HowLongToBeat todavía — típico de un lanzamiento
// reciente o un juego de nicho. Antes de la corrección, el llamante
// (hltb:refreshGame) trataba ese candidato como un ÉXITO: guardaba tres
// null (sin cambio real en la fila) y avisaba "times found" de un juego que
// se quedaba exactamente como estaba. getHltbTimes tiene que devolver null
// en ese caso, igual que si no hubiera habido match ninguno.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: getHltbTimes es el código real. Lo doblado es
// HLTBClient entero (../client): esto no es un test de la búsqueda HTTP —
// eso ya lo cubre client.test.ts, doblando axios un escalón más abajo — es
// un test de qué hace api.ts con lo que el cliente le devuelve.

let searchResult: HltbSearchGame[] = [];
const searchCalls: { query: string; options: { limit?: number } }[] = [];

mock.module('../client', {
  namedExports: {
    HLTBClient: class {
      async search(query: string, options: { limit?: number } = {}): Promise<HltbSearchGame[]> {
        searchCalls.push({ query, options });
        return searchResult;
      }
    },
  },
});

let getHltbTimes: typeof import('../api').getHltbTimes;

before(async () => {
  ({ getHltbTimes } = await import('../api'));
});

beforeEach(() => {
  searchResult = [];
  searchCalls.length = 0;
});

const candidato = (overrides: Partial<HltbSearchGame> = {}): HltbSearchGame => ({
  id: '1',
  name: 'Hollow Knight',
  releaseYear: 2017,
  completionTimes: {},
  ...overrides,
});

describe('getHltbTimes', () => {
  it('sin match de título/año, null', async () => {
    searchResult = [candidato({ name: 'Otro Juego Completamente Distinto' })];
    assert.equal(await getHltbTimes('Hollow Knight', 2017), null);
  });

  it('match de título/año con los TRES tiempos ausentes: null, no "tres null guardados"', async () => {
    // El caso exacto del comentario: ficha real (nombre y año casan) pero
    // sin ningún tramo enviado todavía.
    searchResult = [candidato({ completionTimes: {} })];
    assert.equal(await getHltbTimes('Hollow Knight', 2017), null);
  });

  it('con al menos UN tiempo presente, se devuelve (los ausentes van a null, no se descarta)', async () => {
    searchResult = [
      candidato({ completionTimes: { main: 27, mainExtra: undefined, completionist: undefined } }),
    ];
    const times = await getHltbTimes('Hollow Knight', 2017);
    assert.deepEqual(times, {
      hltbMain: 27,
      hltbMainExtras: null,
      hltbCompletionist: null,
    });
  });

  it('pide el título y el año recibidos, con límite 10', async () => {
    searchResult = [candidato()];
    await getHltbTimes('Hollow Knight', 2017);
    assert.equal(searchCalls.length, 1);
    assert.equal(searchCalls[0].query, 'Hollow Knight');
    assert.equal(searchCalls[0].options.limit, 10);
  });
});

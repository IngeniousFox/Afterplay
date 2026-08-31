import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { asc } from 'drizzle-orm';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { gamesTable } from '../../db/schema';

// LA ADOPCION POR LOTES: CUANDO IGDB POR FIN TIENE EL JUEGO.
//
// Lo que se blinda aqui es que un fallo de IGDB a mitad del lote no mienta. El
// try/catch envolvia el bucle ENTERO y devolvia 0 aunque ya hubiera adoptado a
// varios —cada UPDATE se commitea suelto, no hay transaccion del lote que
// deshacer—, y ese numero lo usa quien llama para decidir: la pasada de
// biblioteca solo relee su lista si es > 0 (external/refresh.ts), asi que los
// juegos ya cambiados de fuente seguian la pasada con igdbId null en memoria y
// el parte de Ajustes cantaba "0 adoptados". Encima el fallo cortaba la cola
// para los que venian detras.
//
// QUE ES REAL Y QUE ES DOBLE: la base es real (harness con las migraciones del
// repo) y adoptIgdbForCandidates corre entera. Doblado, solo IGDB.

type DetalleFalso = {
  igdbId: number;
  title: string;
  covers: string[];
  heroes: string[];
  developer: string | null;
  publisher: string | null;
  genres: string[];
  platforms: string[];
  summary: string | null;
  igdbCollections: { id: number; name: string }[] | null;
  release: null;
  releaseYear: number | null;
  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
};

const detalle = (igdbId: number): DetalleFalso => ({
  igdbId,
  title: `Ficha de IGDB ${igdbId}`,
  covers: [],
  heroes: [],
  developer: null,
  publisher: null,
  genres: [],
  platforms: [],
  summary: null,
  igdbCollections: null,
  release: null,
  releaseYear: null,
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
});

const detailsAsked: number[] = [];
let idsByAppId: (appIds: number[]) => Map<number, number> = () => new Map();
let detailImpl: (igdbId: number) => DetalleFalso | null = (igdbId) => detalle(igdbId);

mock.module('../../igdb/api', {
  namedExports: {
    getIgdbIdsBySteamAppIds: async (appIds: number[]): Promise<Map<number, number>> =>
      idsByAppId(appIds),
    getGameDetails: async (igdbId: number): Promise<DetalleFalso | null> => {
      detailsAsked.push(igdbId);
      return detailImpl(igdbId);
    },
  },
});

const warned: string[] = [];
const logged: string[] = [];
const realWarn = console.warn;
const realLog = console.log;
console.warn = (...args: unknown[]): void => {
  warned.push(args.map(String).join(' '));
};
console.log = (...args: unknown[]): void => {
  logged.push(args.map(String).join(' '));
};

let adoptIgdbForCandidates: typeof import('../adoptIgdb').adoptIgdbForCandidates;
let db: TestDb;

before(async () => {
  ({ adoptIgdbForCandidates } = await import('../adoptIgdb'));
});

beforeEach(async () => {
  db = await freshDb();
  detailsAsked.length = 0;
  warned.length = 0;
  logged.length = 0;
  idsByAppId = () => new Map();
  detailImpl = (igdbId) => detalle(igdbId);
});

after(() => {
  console.warn = realWarn;
  console.log = realLog;
  cleanupDbs();
});

const adoptados = async (): Promise<(number | null)[]> =>
  (await db.select({ igdbId: gamesTable.igdbId }).from(gamesTable).orderBy(asc(gamesTable.id))).map(
    (row) => row.igdbId,
  );

// Cinco juegos dados de alta solo con Steam, con appids 501..505 — que es de
// donde IGDB los reconoce.
const cincoDeSoloSteam = async (): Promise<number[]> => {
  const ids: number[] = [];
  for (let i = 1; i <= 5; i++) {
    ids.push(await makeGame(db, { title: `Solo Steam ${i}`, steamAppId: 500 + i }));
  }
  return ids;
};

describe('la adopcion por lotes de los juegos que solo estaban en Steam', () => {
  it('un fallo de IGDB a mitad del lote no borra lo ya adoptado ni corta la cola', async () => {
    await cincoDeSoloSteam();
    idsByAppId = (appIds) => new Map(appIds.map((appId) => [appId, 60_000 + appId]));
    // El tercero revienta (un 503 de IGDB pidiendo su detalle).
    detailImpl = (igdbId) => {
      if (igdbId === 60_503) throw new Error('IGDB 503');
      return detalle(igdbId);
    };

    const adopted = await adoptIgdbForCandidates(
      [1, 2, 3, 4, 5].map((i) => ({ id: i, steamAppId: 500 + i })),
    );

    assert.equal(adopted, 4, 'el contador cuenta los que SI se adoptaron, no cero');
    assert.deepEqual(detailsAsked.length, 5, 'el fallo de uno no corta la cola de los que faltan');
    assert.deepEqual(await adoptados(), [60_501, 60_502, null, 60_504, 60_505]);
    assert.equal(warned.length, 1, 'el que fallo se cuenta por consola y se sigue');
  });

  it('si falla la peticion del lote no se toca ni una fila y devuelve cero', async () => {
    await cincoDeSoloSteam();
    idsByAppId = () => {
      throw new Error('IGDB no contesta');
    };

    assert.equal(await adoptIgdbForCandidates([{ id: 1, steamAppId: 501 }]), 0);
    assert.deepEqual(detailsAsked, [], 'sin lote no hay a quien pedirle el detalle');
    assert.deepEqual(await adoptados(), [null, null, null, null, null]);
  });

  it('el que IGDB sigue sin tener se queda como esta, sin contar como adoptado', async () => {
    await cincoDeSoloSteam();
    // Solo reconoce al primero; del segundo dice que no esta en su catalogo.
    idsByAppId = () =>
      new Map([
        [501, 61_501],
        [502, 61_502],
      ]);
    detailImpl = (igdbId) => (igdbId === 61_502 ? null : detalle(igdbId));

    const adopted = await adoptIgdbForCandidates(
      [1, 2, 3].map((i) => ({ id: i, steamAppId: 500 + i })),
    );

    assert.equal(adopted, 1);
    assert.deepEqual(await adoptados(), [61_501, null, null, null, null]);
  });
});

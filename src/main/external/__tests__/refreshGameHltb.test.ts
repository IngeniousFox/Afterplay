import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { closeAppDbFixture, freshAppDb } from '../../db/v2/__tests__/appDbHarness';
import { seedGame, type QueryFixture } from '../../db/v2/queries/common/__tests__/fixtures';
import { gameMetadata } from '../../db/v2/schema';

// "ACTUALIZALO TODO" Y LOS TIEMPOS DE HOWLONGTOBEAT (refreshGame.ts).
//
// La regla que se blinda aqui es la de la cabecera de ese fichero, y es de la
// casa: un "no" de una fuente NUNCA borra lo que ya habia. Los tres tramos se
// escribian EN BLOQUE, y getHltbTimes solo descarta el match cuando los TRES
// vienen null — asi que un match parcial (una ficha de HLTB con un unico tramo
// enviado, o la que elige el matcher difuso cuando la buena no existe) entraba
// entero y sus dos null borraban el "main extras" y el "completionist" que el
// juego tenia desde el alta. En silencio, columna a columna y con el boton que
// el usuario pulsa para MEJORAR su ficha.
//
// QUE ES REAL Y QUE ES DOBLE: la base es real (base 2.0 en memoria con las
// migraciones del repo, appDbHarness.ts) y refreshGameEverything corre entera,
// incluida su escritura en la caché externa (game_metadata). Doblado, todo lo que sale a la red y la cola de logros.

type TiemposHltb = {
  hltbMain: number | null;
  hltbMainExtras: number | null;
  hltbCompletionist: number | null;
};

let hltbImpl: () => Promise<TiemposHltb | null> = async () => null;

mock.module('../../hltb/api', {
  namedExports: {
    getHltbTimes: async (): Promise<TiemposHltb | null> => hltbImpl(),
  },
});

mock.module('../../igdb/api', {
  namedExports: {
    // Sin ficha de IGDB: este test va de HLTB y solo de HLTB.
    getGameDetails: async (): Promise<null> => null,
    resolveAchievementsSteamAppId: async (): Promise<null> => null,
  },
});

mock.module('../../sgdb/api', {
  namedExports: {
    resolveSgdbId: async (): Promise<null> => null,
  },
});

mock.module('../../steam/backfill', {
  namedExports: {
    queueAchievementsRefreshForGame: async (): Promise<boolean> => false,
  },
});

mock.module('../adoptIgdb', {
  namedExports: {
    adoptIgdbForGame: async (): Promise<null> => null,
  },
});

mock.module('../steamAppIdFix', {
  namedExports: {
    findSteamAppIdFix: async (): Promise<undefined> => undefined,
  },
});

mock.module('../steamData', {
  namedExports: {
    getSteamGameData: async (): Promise<null> => null,
  },
});

let refreshGameEverything: typeof import('../refreshGame').refreshGameEverything;
let fx: QueryFixture;

before(async () => {
  ({ refreshGameEverything } = await import('../refreshGame'));
});

beforeEach(async () => {
  fx = freshAppDb();
  hltbImpl = async () => null;
});

after(() => {
  closeAppDbFixture();
});

// Un juego que ya vino con los tres tramos del dia del alta.
const conLosTresTiempos = async (): Promise<string> =>
  seedGame(fx.ctx, {
    title: 'Juego con tiempos de siempre',
    metadata: { hltbMain: 12, hltbMainExtras: 20, hltbCompletionist: 41 },
  });

const tiemposDe = async (id: string): Promise<TiemposHltb> => {
  const row = fx.ctx.db
    .select({
      hltbMain: gameMetadata.hltbMain,
      hltbMainExtras: gameMetadata.hltbMainExtras,
      hltbCompletionist: gameMetadata.hltbCompletionist,
    })
    .from(gameMetadata)
    .where(eq(gameMetadata.gameId, id))
    .get();
  return {
    hltbMain: row?.hltbMain ?? null,
    hltbMainExtras: row?.hltbMainExtras ?? null,
    hltbCompletionist: row?.hltbCompletionist ?? null,
  };
};

describe('el refresco entero de un juego y los tiempos de HowLongToBeat', () => {
  it('un match con un solo tramo actualiza ese y NO borra los otros dos', async () => {
    const gameId = await conLosTresTiempos();
    hltbImpl = async () => ({ hltbMain: 15, hltbMainExtras: null, hltbCompletionist: null });

    const result = await refreshGameEverything(gameId);

    assert.equal(result?.hltb, 'updated', 'un tramo nuevo sigue siendo un refresco bueno');
    assert.deepEqual(await tiemposDe(gameId), {
      hltbMain: 15,
      hltbMainExtras: 20,
      hltbCompletionist: 41,
    });
  });

  it('un match con los tres los escribe los tres', async () => {
    const gameId = await conLosTresTiempos();
    hltbImpl = async () => ({ hltbMain: 13, hltbMainExtras: 22, hltbCompletionist: 45 });

    await refreshGameEverything(gameId);

    assert.deepEqual(await tiemposDe(gameId), {
      hltbMain: 13,
      hltbMainExtras: 22,
      hltbCompletionist: 45,
    });
  });

  it('sin match no se toca ni un tramo', async () => {
    const gameId = await conLosTresTiempos();
    hltbImpl = async () => null;

    const result = await refreshGameEverything(gameId);

    assert.equal(result?.hltb, 'no-match');
    assert.deepEqual(await tiemposDe(gameId), {
      hltbMain: 12,
      hltbMainExtras: 20,
      hltbCompletionist: 41,
    });
  });

  it('un juego que no tenia ninguno se queda solo con el tramo que HLTB si supo', async () => {
    const gameId = seedGame(fx.ctx, { title: 'Huerfano' });
    hltbImpl = async () => ({ hltbMain: null, hltbMainExtras: null, hltbCompletionist: 60 });

    await refreshGameEverything(gameId);

    assert.deepEqual(await tiemposDe(gameId), {
      hltbMain: null,
      hltbMainExtras: null,
      hltbCompletionist: 60,
    });
  });
});

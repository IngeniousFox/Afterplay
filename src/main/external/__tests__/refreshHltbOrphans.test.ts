import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { gamesTable } from '../../db/schema';
import type { ExternalRefreshEvent } from '../../../shared/types';

// LA REPESCA DE HUERFANOS DE HOWLONGTOBEAT (refresh.ts, §5.2 del PLAN).
//
// La pasada externa pregunta a HLTB SOLO por los juegos con los TRES tiempos
// a null. Lo que se blinda aqui son las reglas que hacen que eso no degenere
// en el refresco masivo que el §5.2 descarta:
//
//   1. Solo huerfanos: un juego con tiempos (aunque sea UNO de los tres) no
//      se pregunta jamas — refrescar lo que existe es del boton de la ficha.
//   2. Lo repescado se ESCRIBE, y el no-match se queda null sin romper nada
//      (lo reintentara la proxima pasada).
//   3. El alcance se respeta: la puerta del Plan no toca la biblioteca.
//   4. Tres fallos seguidos = HLTB caido = la repesca se rinde, no insiste
//      con la lista entera.
//   5. El parte cuenta la verdad: hltbChecked/hltbFound.
//
// QUE ES REAL Y QUE ES DOBLE: la base es real (harness con las migraciones
// del repo) y runPass corre entero, de la seleccion a la transaccion final.
// Doblado, TODO lo que sale a la red: IGDB, Steam (tags y reseñas), la
// adopcion, el backfill de SGDB, las correcciones de appid — y HLTB, que es
// el que se observa. El notificador tambien, porque el final de la pasada es
// asincrono y su evento 'done' es la unica señal fiable de "ya termino".

type TiemposHltb = {
  hltbMain: number | null;
  hltbMainExtras: number | null;
  hltbCompletionist: number | null;
};

const hltbAsked: { title: string; year: number | null }[] = [];
let hltbImpl: (title: string) => Promise<TiemposHltb | null> = async () => null;

mock.module('../../hltb/api', {
  namedExports: {
    getHltbTimes: async (title: string, year: number | null): Promise<TiemposHltb | null> => {
      hltbAsked.push({ title, year });
      return hltbImpl(title);
    },
  },
});

mock.module('../../igdb/api', {
  namedExports: {
    getGameExternalBatch: async (): Promise<Map<number, never>> => new Map<number, never>(),
    getSteamAppIds: async (): Promise<Map<number, never>> => new Map<number, never>(),
  },
});

mock.module('../../steam/tags', {
  namedExports: {
    getSteamTags: async (): Promise<Map<number, never>> => new Map<number, never>(),
  },
});

mock.module('../../steam/reviews', {
  namedExports: {
    getSteamReviewCounts: async (): Promise<null> => null,
    // Al minimo: los juegos del test no tienen appid, pero si alguno colara,
    // que no meta pausas de verdad en la suite.
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
    fillMissingSgdbIds: async (): Promise<void> => {},
  },
});

mock.module('../steamAppIdFix', {
  namedExports: {
    findSteamAppIdFixes: async (): Promise<Map<number, never>> => new Map<number, never>(),
  },
});

// El evento final es la señal de que runPass termino (corre desatado del
// invoke): cada test espera su promesa antes de mirar la base.
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
let db: TestDb;

before(async () => {
  ({ startExternalRefresh } = await import('../refresh'));
});

beforeEach(async () => {
  db = await freshDb();
  hltbAsked.length = 0;
  hltbImpl = async () => null;
  doneEvent = null;
});

after(() => {
  cleanupDbs();
});

const tiemposDe = async (id: number): Promise<TiemposHltb> => {
  const [row] = await db
    .select({
      hltbMain: gamesTable.hltbMain,
      hltbMainExtras: gamesTable.hltbMainExtras,
      hltbCompletionist: gamesTable.hltbCompletionist,
    })
    .from(gamesTable)
    .where(eq(gamesTable.id, id));
  return row;
};

describe('la repesca de huerfanos de HowLongToBeat', () => {
  it('pregunta solo por los huerfanos, escribe el match y respeta al que no lo tiene', async () => {
    const huerfano = await makeGame(db, { title: 'Huerfano con suerte', releaseYear: 2024 });
    const sinMatch = await makeGame(db, { title: 'Huerfano de nicho' });
    // UN solo tiempo ya puesto basta para quedar fuera: HLTB ya lo conocio.
    const conTiempos = await makeGame(db, { title: 'Ya tenia', hltbMain: 30 });

    hltbImpl = async (title) =>
      title === 'Huerfano con suerte'
        ? { hltbMain: 12, hltbMainExtras: 20, hltbCompletionist: 41 }
        : null;

    const done = waitForDone();
    const total = await startExternalRefresh('all');
    assert.equal(total, 3, 'los tres juegos entran en la pasada general');
    await done;

    assert.deepEqual(
      hltbAsked.map((ask) => ask.title).sort(),
      ['Huerfano con suerte', 'Huerfano de nicho'],
      'a HLTB solo se le pregunta por los dos huerfanos',
    );
    // El año viaja al match: es lo que desempata ediciones en HLTB.
    assert.equal(hltbAsked.find((ask) => ask.title === 'Huerfano con suerte')?.year, 2024);

    assert.deepEqual(await tiemposDe(huerfano), {
      hltbMain: 12,
      hltbMainExtras: 20,
      hltbCompletionist: 41,
    });
    // El no-match se queda como estaba: null, listo para la proxima pasada.
    assert.deepEqual(await tiemposDe(sinMatch), {
      hltbMain: null,
      hltbMainExtras: null,
      hltbCompletionist: null,
    });
    assert.deepEqual(await tiemposDe(conTiempos), {
      hltbMain: 30,
      hltbMainExtras: null,
      hltbCompletionist: null,
    });

    assert.equal(doneEvent?.summary?.hltbChecked, 2);
    assert.equal(doneEvent?.summary?.hltbFound, 1);
  });

  it('la puerta del Plan solo repesca planeados', async () => {
    await makeGame(db, { title: 'De biblioteca, huerfano' });
    const planeado = await makeGame(db, { title: 'Planeado huerfano', planned: true });

    hltbImpl = async () => ({ hltbMain: 8, hltbMainExtras: null, hltbCompletionist: null });

    const done = waitForDone();
    await startExternalRefresh('plan');
    await done;

    assert.deepEqual(
      hltbAsked.map((ask) => ask.title),
      ['Planeado huerfano'],
      'el de biblioteca no entra por la puerta del Plan',
    );
    assert.equal((await tiemposDe(planeado)).hltbMain, 8);
  });

  it('se rinde tras tres fallos seguidos en vez de recorrer la lista entera', async () => {
    for (let i = 0; i < 5; i++) {
      await makeGame(db, { title: `Huerfano ${i}` });
    }
    hltbImpl = async () => {
      throw new Error('HLTB caido (o rotado otra vez)');
    };

    const done = waitForDone();
    await startExternalRefresh('all');
    await done;

    assert.equal(hltbAsked.length, 3, 'tras el tercer fallo seguido no se pregunta mas');
    // Y la pasada NO se cae: termina con su parte, contando solo lo intentado.
    assert.equal(doneEvent?.error, null);
    assert.equal(doneEvent?.summary?.hltbChecked, 3);
    assert.equal(doneEvent?.summary?.hltbFound, 0);
  });

  it('un fallo suelto no corta la repesca: la racha se resetea con cada exito', async () => {
    for (const title of ['A', 'B', 'C', 'D']) {
      await makeGame(db, { title: `Huerfano ${title}` });
    }
    // Falla, acierta, falla, acierta: cuatro preguntados, ningun abandono.
    let call = 0;
    hltbImpl = async () => {
      call++;
      if (call % 2 === 1) throw new Error('timeout puntual');
      return { hltbMain: call, hltbMainExtras: null, hltbCompletionist: null };
    };

    const done = waitForDone();
    await startExternalRefresh('all');
    await done;

    assert.equal(hltbAsked.length, 4, 'los fallos sueltos no abandonan la lista');
    assert.equal(doneEvent?.summary?.hltbFound, 2);
  });
});

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { gamesTable } from '../../db/schema';

// EL RELLENO DE IDS DE STEAMGRIDDB (external/sgdbBackfill.ts).
//
// Es un backfill de "un null que caduca", igual que la repesca de huerfanos de
// HowLongToBeat, y lo que se blinda aqui es justo lo que a este le faltaba
// para parecerse a ella:
//
//   1. Solo los que NO tienen id: el que ya esta puede ser el que TU elegiste
//      a mano en el CoverPicker, y re-resolverlo te cambiaria la portada.
//   2. El ALCANCE se respeta: la puerta del Plan no recorre la biblioteca.
//   3. Tres llamadas seguidas al limite de espera = SteamGridDB caido = se
//      rinde diciendo cuantos quedan, en vez de pagar diez segundos por cada
//      juego de la biblioteca ANTES de que la pasada llegue a IGDB.
//   4. Sin clave no se pregunta nada: cada llamada fallaria igual y con la
//      pausa de por medio serian minutos de espera por nada.
//
// QUE ES REAL Y QUE ES DOBLE: la base es real (harness con las migraciones del
// repo) y fillMissingSgdbIds corre entera. Doblado, solo lo que sale a la red
// (sgdb/api). El RELOJ se dobla en el test de la valvula —y solo Date, no los
// timers— porque el criterio de "esto no es una respuesta, es el servicio
// ahogado" son los segundos que tarda la llamada: sin eso, ese test tardaria
// quince segundos de verdad.

type JuegoPedido = { title: string; steamAppId: number | null };

const asked: JuegoPedido[] = [];
// Que devuelve resolveSgdbId y cuanto "tarda" (en ms de reloj falso).
let sgdbImpl: (game: JuegoPedido) => { id: number | null; tookMs?: number } = () => ({ id: null });

mock.module('../../sgdb/api', {
  namedExports: {
    resolveSgdbId: async (game: JuegoPedido): Promise<number | null> => {
      asked.push({ title: game.title, steamAppId: game.steamAppId });
      const { id, tookMs } = sgdbImpl(game);
      // El reloj solo avanza si el test lo ha doblado; en los demas no hay
      // timers falsos que tocar.
      if (tookMs !== undefined) mock.timers.tick(tookMs);
      return id;
    },
  },
});

const warned: string[] = [];
const realWarn = console.warn;
console.warn = (...args: unknown[]): void => {
  warned.push(args.map(String).join(' '));
};

let fillMissingSgdbIds: typeof import('../sgdbBackfill').fillMissingSgdbIds;
let db: TestDb;
let keyBefore: string | undefined;

before(async () => {
  ({ fillMissingSgdbIds } = await import('../sgdbBackfill'));
});

beforeEach(async () => {
  db = await freshDb();
  asked.length = 0;
  warned.length = 0;
  sgdbImpl = () => ({ id: null });
  keyBefore = process.env.STEAMGRIDDB_API_KEY;
  process.env.STEAMGRIDDB_API_KEY = 'clave-de-prueba';
});

afterEach(() => {
  mock.timers.reset();
  if (keyBefore === undefined) delete process.env.STEAMGRIDDB_API_KEY;
  else process.env.STEAMGRIDDB_API_KEY = keyBefore;
});

after(() => {
  console.warn = realWarn;
  cleanupDbs();
});

const sgdbIdDe = async (id: number): Promise<number | null> => {
  const [row] = await db
    .select({ steamGridDbId: gamesTable.steamGridDbId })
    .from(gamesTable)
    .where(eq(gamesTable.id, id));
  return row.steamGridDbId;
};

describe('el relleno de ids de SteamGridDB', () => {
  it('pregunta solo por los que no lo tienen y escribe lo que encuentra', async () => {
    const sinId = await makeGame(db, { title: 'Sin arte todavia', steamAppId: 400 });
    const conId = await makeGame(db, { title: 'Elegido a mano', steamGridDbId: 777 });
    const sinMatch = await makeGame(db, { title: 'Que SGDB no conoce' });

    sgdbImpl = (game) => ({ id: game.title === 'Sin arte todavia' ? 123 : null });

    assert.equal(await fillMissingSgdbIds(), 1);

    assert.deepEqual(
      asked.map((game) => game.title).sort(),
      ['Que SGDB no conoce', 'Sin arte todavia'],
      'al que ya tiene id no se le pregunta jamas',
    );
    assert.equal(await sgdbIdDe(sinId), 123);
    assert.equal(await sgdbIdDe(conId), 777, 'el elegido a mano se queda intacto');
    assert.equal(await sgdbIdDe(sinMatch), null);
  });

  it('la puerta del Plan solo rellena planeados', async () => {
    await makeGame(db, { title: 'De biblioteca' });
    const planeado = await makeGame(db, { title: 'Planeado', planned: true });

    sgdbImpl = () => ({ id: 55 });

    assert.equal(await fillMissingSgdbIds('plan'), 1);
    assert.deepEqual(
      asked.map((game) => game.title),
      ['Planeado'],
      'el de biblioteca no entra por la puerta del Plan',
    );
    assert.equal(await sgdbIdDe(planeado), 55);
  });

  it('se rinde tras tres llamadas seguidas al limite de espera y dice cuantas quedan', async () => {
    for (let i = 0; i < 5; i++) await makeGame(db, { title: `Juego ${i}` });

    // Solo Date: los timers de verdad siguen corriendo, asi que la pausa entre
    // juegos es la real (son 300 ms, no hay que fingirla) y lo unico falso es
    // el tiempo que "tarda" cada llamada.
    mock.timers.enable({ apis: ['Date'] });
    sgdbImpl = () => ({ id: null, tookMs: 6_000 });

    assert.equal(await fillMissingSgdbIds(), 0);

    assert.equal(asked.length, 3, 'tras la tercera lenta seguida no se pregunta mas');
    assert.equal(
      warned.filter((line) => line.includes('sin mirar')).length,
      1,
      'nada de topes silenciosos: se dice cuantos quedan',
    );
    assert.match(warned.join('\n'), /dejo 2 juegos sin mirar/);
  });

  it('una llamada lenta suelta no corta el relleno: la racha se resetea', async () => {
    for (const title of ['A', 'B', 'C', 'D']) await makeGame(db, { title: `Juego ${title}` });

    mock.timers.enable({ apis: ['Date'] });
    let call = 0;
    sgdbImpl = () => {
      call++;
      // Lenta, rapida, lenta, rapida: ninguna racha llega a tres.
      return call % 2 === 1 ? { id: null, tookMs: 6_000 } : { id: call, tookMs: 50 };
    };

    assert.equal(await fillMissingSgdbIds(), 2);
    assert.equal(asked.length, 4, 'las lentas sueltas no abandonan la lista');
  });

  it('sin clave de SteamGridDB no se pregunta nada', async () => {
    await makeGame(db, { title: 'Cualquiera' });
    delete process.env.STEAMGRIDDB_API_KEY;

    assert.equal(await fillMissingSgdbIds(), 0);
    assert.deepEqual(asked, [], 'ni una llamada, ni una pausa, ni un aviso por juego');
  });
});

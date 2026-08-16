import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { cleanupDbs, freshDb, makeGame, type TestDb } from '../../db/__tests__/harness';
import { gamesTable, planMailboxTable } from '../../db/schema';
import type { PlanMailboxEntry } from '../../../shared/planMailbox';

// EL DRENADO DEL BUZÓN DEL PLAN (REMOTO.md §6.2).
//
// El móvil encola en `plan_mailbox` y el escritorio aplica cada orden llamando
// al código de verdad. Lo que se blinda aquí no es "que drene", sino las
// decisiones que deciden si una orden del móvil SOBREVIVE o se destruye:
//
//   1. Una sola pasada a la vez (sin eso, dos juegos planeados idénticos).
//   2. Un fallo pasajero no quema la orden, y no la reintenta para siempre.
//   3. Un tipo desconocido se aparta de la cola en vez de taponarla.
//   4. El `false` de setPlanPinned/reorderUpNext es un fallo, no un éxito mudo.
//   5. Un fallo POSTERIOR al alta no la repite: la fila se sella igual.
//
// Y dos cosas que se ven en el móvil: lo que se GUARDA en la columna `error` es
// una línea legible (no el INSERT de 46 columnas que escupe drizzle), y el
// ORDEN de Up next que arrastraste en el teléfono llega intacto.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: la base de datos es de verdad (andamio con las
// migraciones del repo), y setPlanPinned/reorderUpNext son las funciones reales
// escribiendo en ella — probar el pin contra un doble sería probar el doble.
// Lo mockeado es lo que toca la RED: createPlannedGame (IGDB + HLTB +
// SteamGridDB + tienda de Steam) y los warm*/backfill del alta. La excepción es
// el último bloque, el del punto ciego de la tienda de Steam: ese baja al
// código real de store.ts y resolveGameEnrichment.ts doblando axios, porque lo
// que comprueba es justo la FORMA del error que sale de ahí.

// ── Dobles de red, registrados ANTES de importar el módulo bajo prueba ──────

type AltaInput = {
  source: unknown;
  note: string | null;
  gameNotes: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
  steamGridDbId: number | null;
};

// Lo mínimo que el alta usa del juego devuelto: warmImageCache mira las urls,
// warmSteamData el appid, y el backfill de logros el id.
type JuegoFalso = {
  id: number;
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  steamAppId: number | null;
};

const altaCalls: AltaInput[] = [];
const warmImagenCalls: number[] = [];
const warmSteamCalls: number[] = [];
const backfillCalls: { gameId: number; notify: boolean | undefined }[] = [];

let siguienteJuegoId = 500;
const juegoFalso = (overrides: Partial<JuegoFalso> = {}): JuegoFalso => ({
  id: siguienteJuegoId++,
  title: 'Juego enriquecido',
  coverUrl: 'https://images.igdb.com/cover.jpg',
  heroUrl: null,
  steamAppId: 292030,
  ...overrides,
});

let altaImpl: (input: AltaInput) => Promise<JuegoFalso> = async () => juegoFalso();
let warmImagenImpl: (game: JuegoFalso) => void = () => {};

mock.module('../../db/queries/games/createPlannedGame', {
  namedExports: {
    createPlannedGame: (input: AltaInput): Promise<JuegoFalso> => {
      altaCalls.push(input);
      return altaImpl(input);
    },
  },
});

mock.module('../../external/warmNewGame', {
  namedExports: {
    warmImageCache: (game: JuegoFalso): void => {
      warmImagenCalls.push(game.id);
      warmImagenImpl(game);
    },
    warmSteamData: (game: JuegoFalso): void => {
      warmSteamCalls.push(game.id);
    },
  },
});

mock.module('../../steam/backfill', {
  namedExports: {
    queueAchievementsRefreshForGame: async (
      gameId: number,
      options?: { notify?: boolean },
    ): Promise<boolean> => {
      backfillCalls.push({ gameId, notify: options?.notify });
      return true;
    },
  },
});

// ── El doble de axios, SOLO para el punto ciego de la tienda de Steam ───────
//
// El último bloque del fichero baja hasta el código DE VERDAD de la tienda
// (steam/store.ts) y del enriquecimiento (resolveGameEnrichment.ts): el arreglo
// de ese punto ciego vive ahí, y lo que hay que comprobar es que el error que
// llega hasta el clasificador de este módulo conserva su forma. Doblando la
// tienda se estaría probando el doble, así que se dobla un escalón más abajo.
//
// Es un martillo grande —sustituye axios para todo lo que se cargue después—,
// pero en este fichero no lo usa nadie más: el alta va doblada, la base es
// SQLite local y los warm*/backfill también son dobles.
//
// CICATRIZ CARA: mock.module('axios') NO intercepta nada bajo tsx, y encima
// falla en silencio — los tests salían verdes o rojos según lo que la tienda de
// Steam DE VERDAD contestase, con red y todo. Los dobles de arriba funcionan
// porque son rutas relativas a ficheros .ts; para un paquete de node_modules
// hay que registrar el doble con la URL RESUELTA del fichero, que es la clave
// por la que casa el cargador. Si esto vuelve a fallar, el síntoma es que el
// test tarda segundos y trae datos reales de The Witcher 3.
type RespuestaFalsa = { data: unknown };
let steamGet: (url: string) => Promise<RespuestaFalsa> = async () => ({ data: {} });

const nadieSaleAQui = async (): Promise<never> => {
  throw new Error('axios doblado: este fichero no sale a la red');
};

mock.module(pathToFileURL(createRequire(__filename).resolve('axios')).href, {
  defaultExport: {
    get: (url: string): Promise<RespuestaFalsa> => steamGet(url),
    isAxiosError: (value: unknown): boolean =>
      typeof value === 'object' && value !== null && 'isAxiosError' in value,
    // hltb-client se monta su propio cliente con axios.create() en cuanto se
    // IMPORTA (hltb/api.ts), y a ese lo arrastra resolveGameEnrichment. Aquí
    // no lo llama nadie —el alta va doblada—, así que basta con que exista.
    create: (): Record<string, unknown> => ({ get: nadieSaleAQui, post: nadieSaleAQui }),
  },
});

// ── El módulo real, importado DESPUÉS de registrar los dobles ───────────────
// En un before() y no con top-level await: los tests compilan como CJS.

let drainPlanMailbox: typeof import('../drainMailbox').drainPlanMailbox;
let runPlanMailboxDrain: typeof import('../drainMailbox').runPlanMailboxDrain;
let getSteamStoreDetails: typeof import('../../steam/store').getSteamStoreDetails;
let resolveGameEnrichment: typeof import('../../db/queries/games/resolveGameEnrichment').resolveGameEnrichment;

let db: TestDb;

before(async () => {
  ({ drainPlanMailbox, runPlanMailboxDrain } = await import('../drainMailbox'));
  ({ getSteamStoreDetails } = await import('../../steam/store'));
  ({ resolveGameEnrichment } = await import('../../db/queries/games/resolveGameEnrichment'));
});

// El drenado logea cada pasada y cada fallo. Correcto en la app, ruido aquí.
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
console.log = (): void => {};
console.warn = (): void => {};
console.error = (): void => {};
after(() => {
  console.log = realLog;
  console.warn = realWarn;
  console.error = realError;
  cleanupDbs();
});

// ── Utilidades ──────────────────────────────────────────────────────────────

// IDs DE BUZÓN ÚNICOS EN TODO EL FICHERO, y esto no es cosmético: el drenado
// guarda en memoria del PROCESO tanto los ids de tipo desconocido
// (`unsupportedIds`) como los intentos gastados (`transientAttempts`), y esa
// memoria no se limpia entre tests aunque la base sí. Con ids reiniciando en 1
// por test, una orden desconocida de un test anterior dejaría invisible a la
// fila #1 del siguiente — un fallo dependiente del orden de ejecución, que es
// justo el que se tarda una tarde en encontrar.
let siguienteOrdenId = 1;

const encolar = async (entry: PlanMailboxEntry): Promise<number> => {
  const id = siguienteOrdenId++;
  await db.insert(planMailboxTable).values({
    id,
    type: entry.type,
    payload: entry,
    createdAt: new Date('2026-01-10T18:00:00Z'),
    requestedBy: 'movil',
  });
  return id;
};

type EstadoOrden = { processedAt: Date | null; error: string | null };

const leerOrden = async (id: number): Promise<EstadoOrden> => {
  const [row] = await db
    .select({ processedAt: planMailboxTable.processedAt, error: planMailboxTable.error })
    .from(planMailboxTable)
    .where(eq(planMailboxTable.id, id));
  return row;
};

const leerPin = async (gameId: number): Promise<Date | null> => {
  const [row] = await db
    .select({ planPinnedAt: gamesTable.planPinnedAt })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId));
  return row.planPinnedAt;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (condition: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${what}`);
    await sleep(5);
  }
};

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

// Un error de axios de verdad tiene la respuesta colgando; el drenado la mira
// por ESTRUCTURA y no por el texto del mensaje.
const errorConEstado = (status: number): Error =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });

const errorConCodigo = (message: string, code: string): Error =>
  Object.assign(new Error(message), { code });

// Un alta que revienta con el error dado, para no repetir el andamiaje.
const altaQueFalla = (error: unknown): void => {
  altaImpl = async () => {
    throw error;
  };
};

const unAlta: PlanMailboxEntry = {
  type: 'add',
  source: { igdbId: 1942 },
  title: 'The Witcher 3',
  coverUrl: 'https://images.igdb.com/witcher3.jpg',
  note: 'me lo recomendó Marta',
};

beforeEach(async () => {
  db = await freshDb();
  altaCalls.length = 0;
  warmImagenCalls.length = 0;
  warmSteamCalls.length = 0;
  backfillCalls.length = 0;
  altaImpl = async () => juegoFalso();
  warmImagenImpl = () => {};
});

// ══ REENTRANCIA ════════════════════════════════════════════════════════════

describe('una sola pasada a la vez', () => {
  it('con una pasada en vuelo, la siguiente no toca nada y devuelve el resultado vacío', async () => {
    // LA CICATRIZ: el tic de 60s arrancaba una pasada sobre las MISMAS filas
    // que otra estaba aplicando. `processedAt` se sella al FINAL de cada orden
    // y withDbAccess cuenta queries, no es un mutex — así que con 25 altas de
    // un minuto largo las dos pasadas veían las mismas filas pendientes. Como
    // games.steamAppId no lleva UNIQUE, el resultado eran dos juegos planeados
    // idénticos que nadie pidió.
    const puerta = deferred();
    altaImpl = async () => {
      await puerta.promise;
      return juegoFalso();
    };
    await encolar(unAlta);
    await encolar(unAlta);

    const primera = drainPlanMailbox();
    await waitUntil(() => altaCalls.length === 1, 'primera alta en vuelo');

    const segunda = await drainPlanMailbox();
    assert.deepEqual(segunda, { applied: 0, failed: 0, deferred: 0 });

    puerta.resolve();
    assert.deepEqual(await primera, { applied: 2, failed: 0, deferred: 0 });
    // Dos órdenes, DOS altas. Ni tres ni cuatro.
    assert.equal(altaCalls.length, 2);
  });

  it('al terminar la pasada el candado se suelta', async () => {
    await encolar(unAlta);
    assert.equal((await drainPlanMailbox()).applied, 1);
    await encolar(unAlta);
    assert.equal((await drainPlanMailbox()).applied, 1);
  });

  it('una pasada que revienta suelta el candado, y runPlanMailboxDrain no propaga', async () => {
    // runPlanMailboxDrain corre en el arranque y después de CADA pull. Si
    // dejara escapar una excepción se llevaría por delante el ciclo de sync
    // entero; y si el candado se quedara echado, el buzón no volvería a
    // drenarse en toda la sesión.
    await encolar({ type: 'unpin', gameId: 4242 });
    cleanupDbs(); // desenchufa getDb(): el SELECT de pendientes lanza

    let avisos = 0;
    await runPlanMailboxDrain(() => {
      avisos++;
    });
    assert.equal(avisos, 0);

    db = await freshDb();
    const id = await encolar(unAlta);
    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });
    assert.equal((await leerOrden(id)).processedAt !== null, true);
  });
});

// ══ EL ALTA PASA POR EL CÓDIGO DE VERDAD ═══════════════════════════════════

describe('el alta desde el móvil', () => {
  it('llama a createPlannedGame con exactamente lo mismo que el botón Add del escritorio', async () => {
    await encolar(unAlta);
    await drainPlanMailbox();

    // deepEqual y no una lista de comprobaciones sueltas a propósito: si
    // alguien añade un campo al input (el `title` del payload, por ejemplo,
    // que NO debe viajar porque el título de verdad lo resuelve el
    // enriquecimiento), este test lo canta en vez de dejarlo pasar.
    assert.deepEqual(altaCalls, [
      {
        source: { igdbId: 1942 },
        note: 'me lo recomendó Marta',
        // El alta desde el móvil es un gesto de una pulsación: ni notas del
        // juego ni arte a medida. Eso se edita luego en el escritorio.
        gameNotes: null,
        coverUrl: 'https://images.igdb.com/witcher3.jpg',
        heroUrl: null,
        steamGridDbId: null,
      },
    ]);
  });

  it('calienta imagen, datos de Steam y catálogo de logros, y los logros SIN aviso', async () => {
    // LA CICATRIZ SE LLAMA ŌKAMI HD: createPlannedGame resuelve el appid, pero
    // etiquetas, reseñas y catálogo de logros los pedía el handler IPC — y el
    // buzón no pasa por ahí. Un juego añadido desde el móvil se quedaba a
    // medias hasta el siguiente refresco general.
    altaImpl = async () => juegoFalso({ id: 777 });
    await encolar(unAlta);
    await drainPlanMailbox();

    assert.deepEqual(warmImagenCalls, [777]);
    assert.deepEqual(warmSteamCalls, [777]);
    // notify:false porque planear un juego no es haberlo jugado: nadie quiere
    // un aviso de logros por algo que aún no ha tocado.
    assert.deepEqual(backfillCalls, [{ gameId: 777, notify: false }]);
  });

  it('avisa al renderer solo si se aplicó algo', async () => {
    // Los hooks de juegos van con staleTime: Infinity, y eso solo es seguro
    // mientras TODO el que escribe avisa. Sin este aviso, un juego añadido
    // desde el móvil no aparecía en el PC en toda la sesión.
    let avisos = 0;
    const contar = (): void => {
      avisos++;
    };

    // Una orden que FALLA no cambió nada: avisar sería invalidar caché por
    // gusto.
    await encolar({ type: 'unpin', gameId: 4242 });
    await runPlanMailboxDrain(contar);
    assert.equal(avisos, 0);

    await encolar(unAlta);
    await runPlanMailboxDrain(contar);
    assert.equal(avisos, 1);
  });

  it('un fallo POSTERIOR al alta ya no repite el alta: la orden queda sellada igual', async () => {
    // ARREGLADO, y era una trampa estructural más que un fallo vivo: el alta no
    // era atómica respecto al sellado de la fila. createPlannedGame escribía el
    // juego y sólo DESPUÉS, si nada más reventaba, se marcaba la orden como
    // procesada — así que cualquier cosa que lanzase entre medias (los remates
    // del alta, o lo que alguien añadiese ahí) devolvía la orden a la cola con
    // el juego YA creado. Y como games.steamAppId no lleva UNIQUE, el reintento
    // salía duplicado: el mismo duplicado que la guarda de reentrancia evita,
    // entrando por otra puerta.
    //
    // Ahora los remates salen de applyEntry y corren DESPUÉS del UPDATE que
    // sella la fila, así que entre el alta y el sello no queda nada que pueda
    // fallar. Que warmImageCache reviente —hoy no lo hace, se traga lo suyo, y
    // por eso esto es un blindaje y no un parche— ya no le cuesta nada a nadie.
    warmImagenImpl = () => {
      throw new Error('fetch failed');
    };
    const id = await encolar(unAlta);

    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });
    const orden = await leerOrden(id);
    assert.notEqual(orden.processedAt, null);
    // Aplicada de verdad: el remate que falló no es parte del alta, así que no
    // ensucia la tarjeta del móvil con un error.
    assert.equal(orden.error, null);

    warmImagenImpl = () => {};
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 0 });
    // UNA orden del móvil, UNA alta. Antes eran dos.
    assert.equal(altaCalls.length, 1);
  });

  it('un remate que revienta no se lleva por delante a los otros dos', async () => {
    // El borde que abre el arreglo: los tres remates van uno a uno con su
    // propia red. Que la caché de imágenes falle no puede costarte el catálogo
    // de logros, que es lo que pasaría con un solo try alrededor de los tres.
    warmImagenImpl = () => {
      throw new Error('fetch failed');
    };
    altaImpl = async () => juegoFalso({ id: 909 });
    await encolar(unAlta);

    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });
    assert.deepEqual(warmImagenCalls, [909]);
    assert.deepEqual(warmSteamCalls, [909]);
    assert.deepEqual(backfillCalls, [{ gameId: 909, notify: false }]);
  });
});

// ══ EL `false` DE setPlanPinned / reorderUpNext ════════════════════════════

describe('el false de setPlanPinned y reorderUpNext es un fallo de verdad', () => {
  it('un pin sobre un juego que ya no está planeado se guarda como fallo, no como aplicado', async () => {
    // LA CICATRIZ: estas dos devuelven `false` en vez de lanzar, y tragarse ese
    // false marcaba la orden como aplicada con error null — o sea, la orden no
    // aparecía ni en pendientes ni en fallos. Desaparecía.
    //
    // El caso real: fijas un juego desde el móvil y antes de que drene lo
    // promocionas a la biblioteca desde el PC. Ya no está planeado, así que
    // setPlanPinned acota por planned=true y no casa ninguna fila.
    const gameId = await makeGame(db, { title: 'Hollow Knight', planned: false });
    const id = await encolar({ type: 'pin', gameId, pinnedAt: Date.parse('2026-01-10T18:00:00Z') });

    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    const orden = await leerOrden(id);
    assert.notEqual(orden.processedAt, null);
    // El texto llega tal cual a la tarjeta del móvil: tiene que explicarse solo.
    assert.equal(orden.error, 'el juego ya no está en tu plan');
    assert.equal(await leerPin(gameId), null);
  });

  it('un unpin sobre un juego que ya no existe también es un fallo', async () => {
    const id = await encolar({ type: 'unpin', gameId: 4242 });
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    assert.equal((await leerOrden(id)).error, 'el juego ya no está en tu plan');
  });

  it('un reorden que se queda con menos de dos juegos fijados es un fallo', async () => {
    // reorderUpNext filtra por los que SIGUEN fijados y planeados; con uno solo
    // no hay nada que repartir y devuelve false. Pasa de verdad: sueltas uno
    // desde el PC entre el arrastre en el móvil y el drenado.
    const fijado = await makeGame(db, {
      title: 'Celeste',
      planned: true,
      planPinnedAt: new Date('2026-01-10T18:00:00Z'),
    });
    const suelto = await makeGame(db, { title: 'Tunic', planned: true, planPinnedAt: null });
    const id = await encolar({ type: 'reorder', orderedIds: [suelto, fijado] });

    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    assert.equal(
      (await leerOrden(id)).error,
      'ya no quedan suficientes juegos fijados que reordenar',
    );
    // Y no tocó la fecha del que sí estaba fijado.
    assert.deepEqual(await leerPin(fijado), new Date('2026-01-10T18:00:00Z'));
  });

  it('un pin bueno escribe de verdad en la base', async () => {
    const gameId = await makeGame(db, { title: 'Outer Wilds', planned: true, planPinnedAt: null });
    const id = await encolar({ type: 'pin', gameId, pinnedAt: Date.parse('2026-01-10T18:00:00Z') });

    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });
    const orden = await leerOrden(id);
    assert.notEqual(orden.processedAt, null);
    assert.equal(orden.error, null);
    assert.notEqual(await leerPin(gameId), null);
  });

  it('el pinnedAt que manda el móvil es el que se guarda, no el instante del drenado', async () => {
    // ARREGLADO. Antes applyEntry llamaba a setPlanPinned(gameId, true) a secas
    // y esa función sella con new Date(): el `pinnedAt` del payload viajaba del
    // móvil al escritorio —el Worker hasta se molesta en validarlo,
    // worker/src/queries/mailbox.ts:52— para que nadie lo mirase.
    //
    // Importaba porque planPinnedAt ES el orden de Up next. Ahora setPlanPinned
    // acepta la marca de quien fijó, y el buzón le pasa la del teléfono.
    const enElMovil = Date.parse('2026-01-10T18:00:00Z');
    const gameId = await makeGame(db, { title: 'Sable', planned: true, planPinnedAt: null });
    await encolar({ type: 'pin', gameId, pinnedAt: enElMovil });
    await drainPlanMailbox();

    assert.deepEqual(await leerPin(gameId), new Date(enElMovil));
  });

  it('dos pines de la misma pasada conservan el orden del TELÉFONO, no el del drenado', async () => {
    // El daño de verdad del bug anterior, y por eso este test existe: los pines
    // de un fin de semana se aplican todos en la misma pasada, así que con la
    // fecha del drenado quedaban separados sólo por lo que tardase SQLite —
    // pudiendo empatar al milisegundo, que es justo el empate contra el que
    // reorderUpNext se protege a mano subiendo los stamps (getPlannedGames.ts).
    //
    // Se encolan a propósito en orden INVERSO al de los pines: si el drenado
    // volviera a inventar las fechas, el orden final sería el de la cola.
    const tarde = Date.parse('2026-01-10T18:00:00Z');
    const pronto = Date.parse('2026-01-10T09:00:00Z');
    const elDeLaTarde = await makeGame(db, { title: 'Tunic', planned: true, planPinnedAt: null });
    const elDeLaManana = await makeGame(db, { title: 'Cocoon', planned: true, planPinnedAt: null });
    await encolar({ type: 'pin', gameId: elDeLaTarde, pinnedAt: tarde });
    await encolar({ type: 'pin', gameId: elDeLaManana, pinnedAt: pronto });

    assert.deepEqual(await drainPlanMailbox(), { applied: 2, failed: 0, deferred: 0 });
    const marcas = [
      { id: elDeLaTarde, stamp: ((await leerPin(elDeLaTarde)) as Date).getTime() },
      { id: elDeLaManana, stamp: ((await leerPin(elDeLaManana)) as Date).getTime() },
    ];
    assert.deepEqual(
      [...marcas].sort((a, b) => a.stamp - b.stamp).map((game) => game.id),
      [elDeLaManana, elDeLaTarde],
    );
    // Y sin empate posible: las dos marcas son las del móvil, tal cual.
    assert.deepEqual(
      marcas.map((game) => game.stamp),
      [tarde, pronto],
    );
  });

  it('un pinnedAt imposible no escribe un Invalid Date: se cae a la fecha del drenado', async () => {
    // La guarda que abre el arreglo. El Worker valida el campo, pero esto es el
    // borde con un payload JSON que escribió OTRO proceso, y una columna de
    // fechas con un Invalid Date dentro no se arregla luego. (El NaN ni llega
    // así: el JSON de la columna lo convierte en null por el camino, que es
    // igual de imposible y lo cubre la misma guarda.)
    const antes = Date.now();
    for (const [n, imposible] of [Number.NaN, 0, -1].entries()) {
      const gameId = await makeGame(db, {
        title: `Imposible ${n}`,
        planned: true,
        planPinnedAt: null,
      });
      await encolar({ type: 'pin', gameId, pinnedAt: imposible });
      assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });

      const guardado = (await leerPin(gameId)) as Date;
      assert.equal(Number.isNaN(guardado.getTime()), false, `pinnedAt ${imposible}`);
      assert.equal(guardado.getTime() >= antes, true, `pinnedAt ${imposible}`);
    }
  });

  it('un reorden bueno deja el orden pedido repartiendo las fechas que YA existían', async () => {
    const marcas = [
      new Date('2026-01-10T18:00:00Z'),
      new Date('2026-01-11T18:00:00Z'),
      new Date('2026-01-12T18:00:00Z'),
    ];
    const primero = await makeGame(db, { title: 'Uno', planned: true, planPinnedAt: marcas[0] });
    const segundo = await makeGame(db, { title: 'Dos', planned: true, planPinnedAt: marcas[1] });
    const tercero = await makeGame(db, { title: 'Tres', planned: true, planPinnedAt: marcas[2] });

    await encolar({ type: 'reorder', orderedIds: [tercero, primero, segundo] });
    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });

    const finales = await Promise.all(
      [primero, segundo, tercero].map(async (id) => ({
        id,
        stamp: ((await leerPin(id)) as Date).getTime(),
      })),
    );
    // El orden nuevo es el pedido…
    assert.deepEqual(
      [...finales].sort((a, b) => a.stamp - b.stamp).map((game) => game.id),
      [tercero, primero, segundo],
    );
    // …y no se inventó ninguna fecha: el multiset es el mismo de antes. Esto es
    // lo que hace que reordenar desde el móvil no derive el Up next hacia el
    // futuro cada vez que se arrastra.
    assert.deepEqual(
      finales.map((game) => game.stamp).sort((a, b) => a - b),
      marcas.map((marca) => marca.getTime()),
    );
  });

  it('las órdenes se aplican en el orden en que las encoló el móvil', async () => {
    // ORDER BY id ASC. Un pin seguido de un unpin del mismo juego tiene que
    // acabar SUELTO; al revés acabaría fijado. Aquí es donde un refactor que
    // cambie el orden de la página (por createdAt, por type…) se delata.
    const gameId = await makeGame(db, { title: 'Stray', planned: true, planPinnedAt: null });
    await encolar({ type: 'pin', gameId, pinnedAt: Date.parse('2026-01-10T18:00:00Z') });
    await encolar({ type: 'unpin', gameId });

    assert.deepEqual(await drainPlanMailbox(), { applied: 2, failed: 0, deferred: 0 });
    assert.equal(await leerPin(gameId), null);
  });
});

// ══ TIPOS DE ORDEN DESCONOCIDOS ════════════════════════════════════════════

describe('órdenes de un tipo que esta versión no conoce', () => {
  it('quedan PENDIENTES: ni se sellan ni cuentan como fallo', async () => {
    // Lo normal es un Worker más nuevo hablándole a un escritorio sin
    // actualizar. La orden es válida, sólo le falta una versión que la sepa
    // aplicar — sellarla sería destruirla sin posibilidad de recuperarla ni
    // actualizando después.
    const id = await encolar({ type: 'archivar' } as unknown as PlanMailboxEntry);

    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 1 });
    const orden = await leerOrden(id);
    assert.equal(orden.processedAt, null);
    assert.equal(orden.error, null);
  });

  it('una tanda de desconocidas no tapona la cabeza de la cola', async () => {
    // LA CICATRIZ ENTERA: la página es `ORDER BY id ASC LIMIT 25`. Sin apartar
    // los tipos desconocidos, 25 de ellos ocupan la página completa en cada
    // pasada y NINGUNA orden posterior —de un tipo que sí entendemos— se drena
    // jamás. El buzón queda muerto hasta que actualices la app.
    //
    // El 25 no es decorativo: es MAX_PER_PASS. Con 24 desconocidas el test
    // pasaría igual sin la lista de exclusión.
    for (let n = 0; n < 25; n++) {
      await encolar({ type: `futuro-${n}` } as unknown as PlanMailboxEntry);
    }
    const buena = await encolar(unAlta);

    // Primera pasada: la página se la comen las 25 desconocidas.
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 25 });
    assert.equal(altaCalls.length, 0);
    assert.equal((await leerOrden(buena)).processedAt, null);

    // Segunda: apartadas, el alta por fin entra.
    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });
    assert.equal(altaCalls.length, 1);
    assert.notEqual((await leerOrden(buena)).processedAt, null);
  });

  it('MAX_PER_PASS: 26 órdenes buenas necesitan dos pasadas', async () => {
    // El tope no es por la DB, es por la red: cada alta encadena IGDB, HLTB,
    // SteamGridDB y la tienda de Steam, y drenar cincuenta de golpe justo en el
    // arranque compite con todo lo demás que la app está pidiendo.
    for (let n = 0; n < 26; n++) await encolar(unAlta);

    assert.deepEqual(await drainPlanMailbox(), { applied: 25, failed: 0, deferred: 0 });
    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 0 });
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 0 });
  });
});

// ══ FALLOS PASAJEROS Y SU TOPE ═════════════════════════════════════════════

describe('un fallo pasajero no quema la orden', () => {
  it('se reintenta dos veces y a la TERCERA se da por perdida', async () => {
    // MAX_TRANSIENT_ATTEMPTS = 3. Un 503 de Twitch o un corte de red no dicen
    // nada sobre si el alta era buena, así que no puede quemarla; pero un error
    // mal clasificado tampoco puede quedarse dando vueltas para siempre.
    altaQueFalla(new Error('fetch failed'));
    const id = await encolar(unAlta);

    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 1 });
    assert.equal((await leerOrden(id)).processedAt, null);

    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 1 });
    assert.equal((await leerOrden(id)).processedAt, null);

    // Tercer intento: se acabó el crédito.
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    const orden = await leerOrden(id);
    assert.notEqual(orden.processedAt, null);
    assert.equal(orden.error, 'fetch failed');

    // Y sellada de verdad: la cuarta pasada ya no la ve.
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 0 });
    assert.equal(altaCalls.length, 3);
  });

  it('un 5xx y un 429 se reconocen por el status de la respuesta, no por el texto', async () => {
    // Aquí vivían dos firmas de texto en castellano ('devolvió 5', 'devolvió
    // 429') que no las producía NINGÚN error del main — axios habla en inglés.
    // Daban sensación falsa de cobertura del 5xx y del 429.
    for (const status of [500, 503, 429]) {
      db = await freshDb();
      altaQueFalla(errorConEstado(status));
      const id = await encolar(unAlta);
      assert.deepEqual(
        await drainPlanMailbox(),
        { applied: 0, failed: 0, deferred: 1 },
        `status ${status} debería ser pasajero`,
      );
      assert.equal((await leerOrden(id)).processedAt, null);
    }
  });

  it('un 404 es definitivo: ese juego ya no está en IGDB, insistir no lo trae', async () => {
    altaQueFalla(errorConEstado(404));
    const id = await encolar(unAlta);
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    assert.equal((await leerOrden(id)).error, 'Request failed with status code 404');
  });

  it('"connect ETIMEDOUT 1.2.3.4:443": lo salva el code, porque el texto no lo pilla', async () => {
    // El hueco exacto que abrió la clasificación por estructura: el mensaje
    // dice "ETIMEDOUT" pero la firma de texto es 'timed out' CON ESPACIO, y
    // 'timeout' tampoco casa dentro de 'etimedout'. Un timeout de conexión seco
    // se colaba como veredicto definitivo y quemaba el alta al primer intento.
    const conCode = await encolar(unAlta);
    altaQueFalla(errorConCodigo('connect ETIMEDOUT 1.2.3.4:443', 'ETIMEDOUT'));
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 1 });
    assert.equal((await leerOrden(conCode)).processedAt, null);

    // El MISMO mensaje sin `code` sigue siendo definitivo: lo que salva a la
    // orden es el dato estructurado, no la redacción.
    db = await freshDb();
    const sinCode = await encolar(unAlta);
    altaQueFalla(new Error('connect ETIMEDOUT 1.2.3.4:443'));
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    assert.notEqual((await leerOrden(sinCode)).processedAt, null);
  });

  it('un fallo de red envuelto DOS veces sigue siendo pasajero', async () => {
    // Antes se miraba uno de los dos: si había `cause`, sólo la causa; si no,
    // sólo el mensaje de fuera. Una capa que envuelva un fallo de red en un
    // error propio —o que envuelva dos veces— llegaba disfrazada de veredicto
    // definitivo, y un alta perfectamente buena se sellaba sin gastar ni uno de
    // los tres intentos.
    altaQueFalla(
      new Error('no pude dar de alta el juego', {
        cause: new Error('el enriquecimiento falló', { cause: new Error('fetch failed') }),
      }),
    );
    const id = await encolar(unAlta);
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 1 });
    assert.equal((await leerOrden(id)).processedAt, null);
  });

  it('la cadena de causas se corta a los 5 eslabones (lo que haya debajo no cuenta)', async () => {
    // Caracterización del tope, que existe para que un ciclo de `cause` no
    // congele el drenado. El precio: un envoltorio de seis capas esconde su
    // fallo de red. No es realista hoy (dos capas es lo que hay), pero si
    // alguien sube el envoltorio, este test dice dónde está la frontera.
    let error: Error = new Error('fetch failed');
    for (let capa = 5; capa >= 1; capa--) error = new Error(`capa ${capa}`, { cause: error });
    altaQueFalla(error);
    const id = await encolar(unAlta);

    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    assert.notEqual((await leerOrden(id)).processedAt, null);
  });

  it('un ciclo de causas no cuelga el drenado', { timeout: 10000 }, async () => {
    // `cause` es un campo cualquiera y nada impide montar un ciclo. Sin el tope
    // esto sería un bucle infinito DENTRO del drenado, que corre después de
    // cada pull: la app se quedaría clavada. Si este test agota su timeout, el
    // tope se ha perdido en un refactor.
    const fuera: Error & { cause?: unknown } = new Error('el alta reventó');
    const dentro: Error & { cause?: unknown } = new Error('fetch failed');
    fuera.cause = dentro;
    dentro.cause = fuera;
    altaQueFalla(fuera);
    const id = await encolar(unAlta);

    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 1 });
    assert.equal((await leerOrden(id)).processedAt, null);
  });

  it('un eslabón que no se puede convertir a texto no ciega a los de abajo ni tumba la pasada', async () => {
    // String() NO es una operación segura: un valor con prototipo nulo revienta
    // al convertirlo. Y esto corre DENTRO del catch del bucle de órdenes, donde
    // una excepción no la para nadie hasta runPlanMailboxDrain — se llevaría
    // por delante el resto de la pasada y dejaría la fila a medias, sin
    // processedAt y sin el error guardado.
    const ilegible = Object.create(null) as { cause?: unknown };
    ilegible.cause = new Error('fetch failed');
    const fuera: Error & { cause?: unknown } = new Error('el alta reventó');
    fuera.cause = ilegible;

    const conCadenaRota = await encolar(unAlta);
    // Una SEGUNDA orden detrás, que es la que demuestra que la pasada sigue
    // viva después del eslabón ilegible.
    const gameId = await makeGame(db, { title: 'Inscryption', planned: true, planPinnedAt: null });
    const detras = await encolar({
      type: 'pin',
      gameId,
      pinnedAt: Date.parse('2026-01-10T18:00:00Z'),
    });
    altaQueFalla(fuera);

    // El eslabón ilegible se queda sin texto y la cadena sigue: el 'fetch
    // failed' de debajo se ve, así que la orden se difiere en vez de quemarse.
    assert.deepEqual(await drainPlanMailbox(), { applied: 1, failed: 0, deferred: 1 });
    assert.equal((await leerOrden(conCadenaRota)).processedAt, null);
    assert.notEqual((await leerOrden(detras)).processedAt, null);
    assert.notEqual(await leerPin(gameId), null);
  });
});

// ══ EL PUNTO CIEGO DE LA TIENDA DE STEAM ═══════════════════════════════════
//
// El único bloque que baja al código real de la tienda, y con motivo: este
// clasificador sólo puede juzgar lo que le LLEGA, y lo que llegaba de un alta
// con source { steamAppId } era mentira. getSteamStoreDetails se tragaba
// CUALQUIER error y devolvía null, y resolveFromSteam convertía ese null en un
// Error pelado —sin cause, sin response.status, sin code— indistinguible del
// juego retirado de la tienda de verdad. Un 502 o un timeout de Steam
// destruían el alta que venías de encolar en el móvil, en el primer intento y
// sin gastar ninguno de los tres reintentos.

describe('un mal minuto de la tienda de Steam ya no quema el alta', () => {
  const APPID = 292030;
  const sinOverrides = { coverUrl: null, heroUrl: null, steamGridDbId: null };

  const altaDesdeSteam: PlanMailboxEntry = {
    type: 'add',
    source: { steamAppId: APPID },
    title: 'The Witcher 3',
    coverUrl: null,
    note: null,
  };

  // Lo que de verdad suelta axios cuando la tienda contesta un 502.
  const un502 = (): Error =>
    Object.assign(new Error('Request failed with status code 502'), {
      isAxiosError: true,
      code: 'ERR_BAD_RESPONSE',
      response: { status: 502 },
    });

  const laTiendaSeCae = (): void => {
    steamGet = async (url) => {
      // El de los géneros (appdetails) es accesorio y tiene su propio catch:
      // el que importa es GetItems.
      if (url.includes('IStoreBrowseService')) throw un502();
      return { data: {} };
    };
  };

  // Steam contesta perfectamente: no hay ficha de ese appid.
  const laTiendaNoLoTiene = (): void => {
    steamGet = async () => ({ data: { response: { store_items: [] } } });
  };

  it('la tienda ya no se traga los fallos de transporte: el 502 SALE con su status', async () => {
    laTiendaSeCae();
    const error = await getSteamStoreDetails(APPID).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    // Antes esto era `null` y ahí se perdía la diferencia para siempre.
    assert.equal((error as { response?: { status?: number } })?.response?.status, 502);
  });

  it('y "Steam no tiene ese appid" sigue siendo null, que es lo que null significa', async () => {
    laTiendaNoLoTiene();
    assert.equal(await getSteamStoreDetails(APPID), null);
  });

  it('el enriquecimiento envuelve el fallo de la tienda conservándolo en `cause`', async () => {
    laTiendaSeCae();
    const error = (await resolveGameEnrichment({ steamAppId: APPID }, sinOverrides).then(
      () => null,
      (thrown: unknown) => thrown,
    )) as Error;

    assert.equal(error.message, `No se pudo consultar la tienda de Steam (appid ${APPID})`);
    assert.equal((error.cause as { response?: { status?: number } })?.response?.status, 502);
  });

  it('ese error se DIFIERE en el buzón; el del juego retirado se sigue quemando', async () => {
    // La prueba de que las dos mitades encajan: el error que se clasifica no lo
    // escribe el test, lo fabrica el código de producción y de ahí se pasa tal
    // cual al alta doblada. Si mañana alguien cambia la forma del error en
    // resolveFromSteam, esto se entera.
    laTiendaSeCae();
    altaQueFalla(
      await resolveGameEnrichment({ steamAppId: APPID }, sinOverrides).catch(
        (error: unknown) => error,
      ),
    );
    const pasajera = await encolar(altaDesdeSteam);
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 0, deferred: 1 });
    assert.equal((await leerOrden(pasajera)).processedAt, null);

    // Y el otro "no" de la tienda, el que sí es un veredicto: insistir no
    // devuelve a la tienda un juego que la abandonó.
    db = await freshDb();
    laTiendaNoLoTiene();
    altaQueFalla(
      await resolveGameEnrichment({ steamAppId: APPID }, sinOverrides).catch(
        (error: unknown) => error,
      ),
    );
    const definitiva = await encolar(altaDesdeSteam);
    assert.deepEqual(await drainPlanMailbox(), { applied: 0, failed: 1, deferred: 0 });
    assert.equal(
      (await leerOrden(definitiva)).error,
      `Steam no tiene ficha del appid ${APPID} (¿se retiró de la tienda?)`,
    );
  });
});

// ══ LO QUE SE GUARDA EN LA COLUMNA `error` ═════════════════════════════════

describe('el error que se guarda cabe en una tarjeta de móvil', () => {
  it('guarda la CAUSA, no el volcado del INSERT de drizzle', async () => {
    // Un fallo de drizzle trae el INSERT entero como mensaje: los 46 nombres de
    // columna, los interrogantes y el RETURNING. La causa real es una línea, y
    // es la única que dice algo. Esto acaba en una tarjeta de 375px.
    const columnas = Array.from({ length: 46 }, (_, n) => `"col${n}"`).join(', ');
    const volcado = new Error(
      `Failed query: insert into "games" (${columnas}) values (${'?, '.repeat(46)}) returning *`,
      { cause: new Error('UNIQUE constraint failed: games.igdbid') },
    );
    altaQueFalla(volcado);
    const id = await encolar(unAlta);
    await drainPlanMailbox();

    assert.equal((await leerOrden(id)).error, 'UNIQUE constraint failed: games.igdbid');
  });

  it('se queda con la primera línea: el stack no se guarda', async () => {
    altaQueFalla(new Error('IGDB no conoce ese juego\n    at resolveFromIgdb (igdb.ts:88)'));
    const id = await encolar(unAlta);
    await drainPlanMailbox();

    assert.equal((await leerOrden(id)).error, 'IGDB no conoce ese juego');
  });

  it('un mensaje larguísimo se recorta a 200 con puntos suspensivos', async () => {
    altaQueFalla(new Error('x'.repeat(400)));
    const id = await encolar(unAlta);
    await drainPlanMailbox();

    const guardado = (await leerOrden(id)).error as string;
    assert.equal(guardado.length, 200);
    assert.equal(guardado.endsWith('…'), true);
    assert.equal(guardado.slice(0, 199), 'x'.repeat(199));
  });

  it('exactamente 200 caracteres se guardan enteros (el corte es > 200, no >=)', async () => {
    // El borde de un off-by-one: recortar aquí gastaría un carácter de los 200
    // en unos puntos suspensivos que no hacen falta.
    altaQueFalla(new Error('y'.repeat(200)));
    const id = await encolar(unAlta);
    await drainPlanMailbox();

    const guardado = (await leerOrden(id)).error as string;
    assert.equal(guardado, 'y'.repeat(200));
  });

  it('una causa que NO es Error también cuenta: un `throw "texto"` se guarda tal cual', async () => {
    // ARREGLADO. conciseError sólo miraba la causa si era `instanceof Error`, y
    // con una causa string —lo que sueltan algunas librerías, y lo que deja un
    // `throw 'texto'`— guardaba el mensaje del envoltorio y el dato bueno
    // desaparecía. isTransient sí recorría la cadena entera leyendo cualquier
    // valor: las dos discrepaban sobre qué era "el error", y la miope era justo
    // la que decide lo que se lee en el móvil.
    const fuera: Error & { cause?: unknown } = new Error('el alta reventó');
    fuera.cause = 'UNIQUE constraint failed: games.igdbid';
    altaQueFalla(fuera);
    const id = await encolar(unAlta);
    await drainPlanMailbox();

    assert.equal((await leerOrden(id)).error, 'UNIQUE constraint failed: games.igdbid');
  });

  it('una causa que no dice nada NO tapa el mensaje de fuera', async () => {
    // El borde contrario del arreglo, y el motivo de que no valga con "si hay
    // cause, la cause": String() de un objeto cualquiera es '[object Object]',
    // que en la tarjeta del móvil dice menos que el envoltorio. Sólo ganan las
    // causas que son texto de verdad (Error o string no vacío).
    for (const inutil of [{ codigo: 7 }, '', '   ', [], null]) {
      db = await freshDb();
      const fuera: Error & { cause?: unknown } = new Error('el alta reventó');
      fuera.cause = inutil;
      altaQueFalla(fuera);
      const id = await encolar(unAlta);
      await drainPlanMailbox();

      assert.equal(
        (await leerOrden(id)).error,
        'el alta reventó',
        `causa ${JSON.stringify(inutil)}`,
      );
    }
  });

  it('una orden aplicada se sella con error null', async () => {
    // El par (processedAt, error) es lo que la web usa para pintar pendientes y
    // fallos: aplicada = fecha + null, fallida = fecha + texto, pendiente =
    // null + null. No hay cuarto estado.
    const id = await encolar(unAlta);
    await drainPlanMailbox();

    const orden = await leerOrden(id);
    assert.notEqual(orden.processedAt, null);
    assert.equal(orden.error, null);
  });
});

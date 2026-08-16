import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  gamesTable,
  iterationsTable,
  planMailboxTable,
  sessionsTable,
  stateEventsTable,
} from '../../../../src/main/db/schema';
import type { PlanMailboxEntry } from '../../../../src/shared/planMailbox';
// El umbral y el predicado de frescura se importan de src/shared y NO del
// Worker: son los MISMOS que importa el watcher del escritorio, así que fijar
// aquí el número fija los dos lados a la vez. Cuando cada lado tenía su copia
// —y la del watcher era `private static readonly`, o sea imposible de
// importar— este test solo podía prometer la mitad.
import { TIMER_STALE_MS, isTimerStale } from '../../../../src/shared/timerFreshness';
import type { TenantDb } from '../../db';
import { getGameDetail } from '../game';
import { listLibrary } from '../library';
import {
  dismissFailure,
  enqueue,
  listPending,
  listRecentFailures,
  parseEntry,
  pendingAddKeys,
} from '../mailbox';
import { listSessions } from '../sessions';
import { getStatsSummary } from '../stats';
import { TimerError, beatTimer, getActiveTimer, startTimer, stopTimer } from '../timer';

// EL WORKER CONTRA UNA BASE DE VERDAD.
//
// Las consultas de worker/src/queries son la SEGUNDA implementación de reglas
// que ya existen en el escritorio: las horas de un año, el estado derivado del
// log de eventos, a qué playthrough cuelga un Play. No comparten código con
// aquéllas más que los helpers de src/shared, así que lo que hay que blindar
// aquí no es "¿la consulta compila?" sino "¿dice el MISMO número?". Eso solo
// se ve con datos, no con dobles del ORM.
//
// POR QUÉ NO USA EL ANDAMIO DE src/main/db/__tests__/harness.ts: aquél existe
// para enchufar una base al `getDb()` singleton que usan las consultas del
// escritorio, y para eso necesita mock.module. Aquí no hace falta ninguna de
// las dos cosas — el Worker recibe su `db` POR PARÁMETRO en cada llamada (la
// regla 1 del §5.2: un isolate de Cloudflare se reutiliza entre peticiones y
// un cliente guardado en una variable de módulo acabaría sirviendo datos del
// otro inquilino). Así que el montaje es el mismo (fichero temporal + las
// migraciones REALES del repo) pero sin doble de por medio.
//
// Lo que este montaje NO puede probar: la red. TenantDb es el cliente HTTP de
// `@libsql/client/web` hablando con Turso y aquí abajo hay un fichero local.
// Debajo son el mismo SQLite, el mismo drizzle y el mismo esquema, así que las
// consultas se comportan igual; el viaje, no.

const dirs: string[] = [];

// La carpeta de migraciones se resuelve desde ESTE fichero y no desde el cwd:
// `npm test` corre desde la raíz, pero lanzar el fichero suelto desde otra
// carpeta dejaría un `migrationsFolder: 'drizzle'` relativo apuntando a la
// nada, y el fallo sería "no such table" en el primer test en vez de "no
// encuentro las migraciones".
//
// Y se resuelve con import.meta y no con __dirname porque worker/package.json
// declara `"type": "module"`: estos tests corren como ESM, al revés que los de
// src/main —que son CJS y por eso no pueden usar await de nivel superior—.
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(HERE, '..', '..', '..', '..', 'drizzle');

// La conexión viva. Cada test abre la suya y CIERRA la anterior, y eso no es
// higiene: dejando los sesenta y pico clientes de libsql abiertos hasta el
// final, el proceso se caía al salir con una violación de acceso del binario
// nativo — con los sesenta y pico tests en verde. El peor rojo posible, porque
// no señala a ningún test y parece un fallo del código bajo prueba.
let openClient: Client | null = null;

const freshDb = async (): Promise<TenantDb> => {
  openClient?.close();
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-worker-test-'));
  dirs.push(dir);
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  openClient = client;
  const database = drizzle({ client });
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  return database as unknown as TenantDb;
};

// El barrido de rancias canta por consola cada sesión que cierra (es un log
// útil en producción y ruido aquí, donde media docena de tests lo provocan a
// propósito). Se silencia entero y se devuelve al terminar.
const realConsoleLog = console.log;
console.log = (): void => {};

after(() => {
  console.log = realConsoleLog;
  openClient?.close();
  openClient = null;
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows puede tener el fichero tomado todavía; da igual, es tmp.
    }
  }
  dirs.length = 0;
});

let db: TenantDb;
beforeEach(async () => {
  db = await freshDb();
});

// ── Relojes ────────────────────────────────────────────────────────────────
//
// El cronómetro recibe `now` POR PARÁMETRO en sus cuatro puertas (start, stop,
// beat, getActive) justo para que nadie decida la frescura con un reloj
// distinto del que el router ya tenía en la mano. Sus tests aprovechan eso y
// hablan en fechas fijas: cero Date.now(), cero tests que fallan los martes.

const T = (iso: string): number => new Date(iso).getTime();
const HOUR_MS = 3_600_000;

// buildLibraryData —y con ella listLibrary y getStatsSummary— sí llama a
// Date.now() por dentro y no acepta un `now`. Es lo único de este fichero que
// no puede hablar en fechas fijas: para que "fresco" y "rancio" signifiquen lo
// mismo hoy que dentro de un año, sus sesiones se colocan RELATIVAS al reloj
// de verdad y bien lejos del umbral (un minuto contra diez horas), de forma
// que ningún retraso del runner las mueva de lado.
const agoMs = (ms: number): Date => new Date(Date.now() - ms);

// Y el año tampoco puede ser un literal: getStatsSummary lo saca de
// `new Date().getFullYear()` (stats.ts) sin ninguna puerta por la que
// inyectarlo. Un test escrito contra 2026 pasaría este año y se caería el 1 de
// enero, que es el peor día posible para descubrirlo. Así que los tests hablan
// de "este año" y "el año pasado" y construyen las fechas alrededor.
const THIS_YEAR = new Date().getFullYear();
const LAST_YEAR = THIS_YEAR - 1;

// Mediados de junio a mediodía: lejos de cualquier frontera de año, así que el
// desfase UTC/local del que avisan library.ts y stats.ts no puede mover estas
// fechas al año de al lado y volver estos tests dependientes de la zona de
// quien los lance.
const midYear = (year: number): string => `${year}-06-15T12:00:00Z`;

// ── Fábricas ───────────────────────────────────────────────────────────────
//
// Rellenan los NOT NULL sin gracia para que cada test escriba solo lo que está
// probando y se lea como una jugada, no como un INSERT.

const makeGame = async (
  db: TenantDb,
  overrides: Partial<typeof gamesTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(gamesTable)
    .values({
      title: 'Juego de prueba',
      planned: false,
      addedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    })
    .returning({ id: gamesTable.id });
  return row.id;
};

const makeIteration = async (
  db: TenantDb,
  gameId: number,
  overrides: Partial<typeof iterationsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(iterationsTable)
    .values({
      gameId,
      label: 'Playthrough 1',
      playedPlatform: 'PC',
      origin: 'steam',
      ...overrides,
    })
    .returning({ id: iterationsTable.id });
  return row.id;
};

// Una sesión CERRADA y medida. `hours` calcula el fin y la duración a la vez
// para que no se puedan contradecir: un desfase entre endedAt y durationSec
// sería un dato imposible que ninguna parte de la app produce.
const makeSession = async (
  db: TenantDb,
  iterationId: number | null,
  startedAt: string,
  hours: number,
  overrides: Partial<typeof sessionsTable.$inferInsert> = {},
): Promise<number> => {
  const start = new Date(startedAt);
  const [row] = await db
    .insert(sessionsTable)
    .values({
      iterationId,
      isManual: false,
      startedAt: start,
      endedAt: new Date(start.getTime() + hours * HOUR_MS),
      durationSec: Math.round(hours * 3600),
      datePrecision: 'datetime',
      ...overrides,
    })
    .returning({ id: sessionsTable.id });
  return row.id;
};

// Una sesión de CRONÓMETRO abierta, tal y como la deja startTimer: sin fin, sin
// duración y con su último latido. `lastHeartbeatAt: null` es el caso real de
// la pestaña que murió en el primer minuto.
const makeTimerSession = async (
  db: TenantDb,
  iterationId: number,
  startedAt: Date,
  lastHeartbeatAt: Date | null,
): Promise<number> => {
  const [row] = await db
    .insert(sessionsTable)
    .values({
      iterationId,
      isManual: false,
      startedAt,
      endedAt: null,
      durationSec: null,
      lastHeartbeatAt,
      startedBy: 'timer',
      datePrecision: 'datetime',
    })
    .returning({ id: sessionsTable.id });
  return row.id;
};

// La otra sesión abierta posible: la que el vigilante de procesos tiene en
// marcha en el PC de casa.
const makeWatcherSession = async (
  db: TenantDb,
  iterationId: number,
  startedAt: Date,
): Promise<number> => {
  const [row] = await db
    .insert(sessionsTable)
    .values({
      iterationId,
      isManual: false,
      startedAt,
      endedAt: null,
      durationSec: null,
      lastHeartbeatAt: startedAt,
      startedBy: 'watcher',
      datePrecision: 'datetime',
    })
    .returning({ id: sessionsTable.id });
  return row.id;
};

const makeStateEvent = async (
  db: TenantDb,
  iterationId: number,
  type: typeof stateEventsTable.$inferInsert.type,
  occurredAt: string,
  overrides: Partial<typeof stateEventsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(stateEventsTable)
    .values({
      iterationId,
      type,
      occurredAt: new Date(occurredAt),
      datePrecision: 'datetime',
      ...overrides,
    })
    .returning({ id: stateEventsTable.id });
  return row.id;
};

const makeMailboxRow = async (
  db: TenantDb,
  entry: PlanMailboxEntry,
  overrides: Partial<typeof planMailboxTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(planMailboxTable)
    .values({
      type: entry.type,
      payload: entry,
      createdAt: new Date('2026-01-10T18:00:00Z'),
      requestedBy: 'test',
      ...overrides,
    })
    .returning({ id: planMailboxTable.id });
  return row.id;
};

// ── Lecturas de apoyo ──────────────────────────────────────────────────────

const readSession = async (
  db: TenantDb,
  id: number,
): Promise<typeof sessionsTable.$inferSelect> => {
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1);
  return row;
};

const eventTypesOf = async (db: TenantDb, iterationId: number): Promise<string[]> => {
  const rows = await db
    .select({ type: stateEventsTable.type })
    .from(stateEventsTable)
    .where(eq(stateEventsTable.iterationId, iterationId));
  return rows.map((row) => row.type);
};

const openSessionCount = async (db: TenantDb): Promise<number> => {
  const rows = await db.select().from(sessionsTable);
  return rows.filter((row) => row.endedAt === null).length;
};

// Un TimerError con el mensaje que le toca. Comprobar solo que "rechaza" dejaría
// pasar el error equivocado, y aquí el mensaje ES la funcionalidad: es lo único
// que el móvil enseña cuando el botón Start no arranca nada.
const rejectsTimer = async (run: Promise<unknown>, message: RegExp): Promise<void> => {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof TimerError, `esperaba TimerError y llegó ${String(error)}`);
    assert.match(error.message, message);
    return true;
  });
};

// ══ LAS HORAS DEL AÑO ══════════════════════════════════════════════════════

describe('las horas de un año (getStatsSummary)', () => {
  it('las horas del año son las sesiones de ese año MÁS las manuales ancladas a él', async () => {
    // La mitad que se olvidó al escribir esto la primera vez, y no es un
    // detalle: un playthrough de 200h terminado en un año aporta 0h a la vista
    // de ese año si solo se miran sesiones, aunque su Beaten sí salga en el
    // desglose de estados. Las horas manuales son lo jugado FUERA del tracking,
    // así que se SUMAN, y el año al que se cuelgan sale del log de estados.
    const tracked = await makeGame(db, { title: 'Celeste' });
    await makeSession(db, await makeIteration(db, tracked), midYear(THIS_YEAR), 2);

    const manual = await makeGame(db, { title: 'Elden Ring' });
    const manualIteration = await makeIteration(db, manual, { manualTotalPlayed: 200 });
    await makeStateEvent(db, manualIteration, 'completed', midYear(THIS_YEAR));

    const old = await makeGame(db, { title: 'Hollow Knight' });
    await makeSession(db, await makeIteration(db, old), midYear(LAST_YEAR), 5);

    const summary = await getStatsSummary(db);
    assert.equal(summary.hoursThisYear, 202);
    assert.equal(summary.year, THIS_YEAR);
    // Y el total sigue siendo todo lo jugado: el año recorta, no descuenta.
    assert.equal(summary.totalHours, 207);
  });

  it('un playthrough manual terminado hace años no aporta a este año, pero sí al total', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 200 });
    await makeStateEvent(db, iterationId, 'completed', midYear(LAST_YEAR));

    const summary = await getStatsSummary(db);
    assert.equal(summary.hoursThisYear, 0);
    assert.equal(summary.totalHours, 200);
    // Se jugó, aunque no este año: cuenta como juego jugado y como Beaten.
    assert.equal(summary.playedGames, 1);
    assert.equal(summary.beaten, 1);
    assert.equal(summary.gamesThisYear, 0);
  });

  it('el fin manda sobre el principio al colgar unas horas manuales de un año', async () => {
    // "Me pasé Elden Ring este año" coloca las 90 horas en este año aunque el
    // playthrough arrancara el anterior, que es como lo cuenta uno mismo.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 90 });
    await makeStateEvent(db, iterationId, 'started', midYear(LAST_YEAR));
    await makeStateEvent(db, iterationId, 'completed', midYear(THIS_YEAR));

    const summary = await getStatsSummary(db);
    assert.equal(summary.hoursThisYear, 90);
    assert.equal(summary.gamesThisYear, 1);
  });

  it('unas horas manuales sin un solo evento no se cuelgan de ningún año', async () => {
    // Sin fecha de la que colgarlas, el ancla es null y esas horas solo pueden
    // contar en All Time. Repartirlas por defecto en el año en curso sería
    // inventarse cuándo se jugaron.
    const gameId = await makeGame(db);
    await makeIteration(db, gameId, { manualTotalPlayed: 40 });

    const summary = await getStatsSummary(db);
    assert.equal(summary.hoursThisYear, 0);
    assert.equal(summary.totalHours, 40);
    assert.equal(summary.gamesThisYear, 0);
  });

  it('las horas manuales se SUMAN a lo medido, no lo reemplazan', async () => {
    // El bug histórico: un playthrough con horas manuales al que el watcher le
    // cuelga sesiones nuevas se quedaba clavado en el número manual para
    // siempre — las sesiones se guardaban, se veían en el historial, y el total
    // las ignoraba.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId, { manualTotalPlayed: 10 });
    await makeStateEvent(db, iterationId, 'started', midYear(THIS_YEAR));
    await makeSession(db, iterationId, midYear(THIS_YEAR), 2);

    const summary = await getStatsSummary(db);
    assert.equal(summary.totalHours, 12);
    assert.equal(summary.hoursThisYear, 12);
  });

  it('las horas del año no dependen de cuántas sesiones quepan en una página', async () => {
    // Cicatriz literal: las sesiones venían con un tope de 200 filas, así que el
    // total del año era "lo que cupo" — un número inventado que además cambiaba
    // según crecía la biblioteca. 205 sesiones de seis minutos son 20,5 h y
    // tienen que salir las 20,5.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const start = new Date(`${THIS_YEAR}-06-01T00:00:00Z`).getTime();
    await db.insert(sessionsTable).values(
      Array.from({ length: 205 }, (_, index) => {
        const from = new Date(start + index * HOUR_MS);
        return {
          iterationId,
          isManual: false,
          startedAt: from,
          endedAt: new Date(from.getTime() + 6 * 60_000),
          durationSec: 360,
          datePrecision: 'datetime' as const,
        };
      }),
    );

    const summary = await getStatsSummary(db);
    assert.equal(summary.totalSessions, 205);
    assert.equal(summary.hoursThisYear, 20.5);
    // Y la misma cifra por el otro camino: si el total y el año se calcularan
    // sobre poblaciones distintas, aquí se vería.
    assert.equal(summary.totalHours, 20.5);
  });

  it('cada juego cae en UN cajón de estado, y los seis cajones suman el total', async () => {
    // Seis y no cuatro: on_hold y resting existen en el modelo, y sin ellos la
    // portada estimaba esos dos por resta. Un juego en dos cajones (o en
    // ninguno) rompe la suma, que es la forma barata de detectarlo.
    const states = ['started', 'completed', 'dropped', 'on_hold', 'resting'] as const;
    for (const state of states) {
      const gameId = await makeGame(db, { title: `Juego ${state}` });
      const iterationId = await makeIteration(db, gameId);
      await makeStateEvent(db, iterationId, state, midYear(LAST_YEAR));
    }
    // Uno intacto y otro que solo está en la lista de deseos: 'plan_to_play' es
    // historial, nunca estado real, así que los dos son Unplayed.
    await makeIteration(db, await makeGame(db, { title: 'Juego intacto' }));
    const wished = await makeGame(db, { title: 'Juego en la lista' });
    await makeStateEvent(db, await makeIteration(db, wished), 'plan_to_play', midYear(LAST_YEAR));

    const summary = await getStatsSummary(db);
    assert.deepEqual(
      [
        summary.playing,
        summary.beaten,
        summary.dropped,
        summary.onHold,
        summary.resting,
        summary.unplayed,
      ],
      [1, 1, 1, 1, 1, 2],
    );
    assert.equal(summary.totalGames, 7);
    assert.equal(
      summary.playing +
        summary.beaten +
        summary.dropped +
        summary.onHold +
        summary.resting +
        summary.unplayed,
      summary.totalGames,
    );
  });

  it('el último evento manda aunque llegue el mismo día que otro', async () => {
    // Empate exacto de fecha: gana el id más alto (el insertado después). Sin
    // ese desempate, marcar Beaten y arrepentirse el mismo segundo dejaba el
    // estado a suertes.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-03-01T10:00:00Z');
    await makeStateEvent(db, iterationId, 'dropped', '2026-03-01T10:00:00Z');

    const summary = await getStatsSummary(db);
    assert.equal(summary.dropped, 1);
    assert.equal(summary.beaten, 0);
  });

  it('una sesión abierta cuenta como sesión pero todavía no suma horas', async () => {
    // Una sesión en marcha no tiene durationSec: sumarla como 0 es correcto (no
    // hay tiempo cerrado aún) y contarla como sesión también. Lo que no puede
    // pasar es que aparezca como "juego jugado" con 0 h — playedGames mira
    // horas, no filas.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeWatcherSession(db, iterationId, agoMs(30 * 60_000));

    const summary = await getStatsSummary(db);
    assert.equal(summary.totalSessions, 1);
    assert.equal(summary.totalHours, 0);
    assert.equal(summary.playedGames, 0);
    // Y sí está "jugando ahora": la sesión del watcher no caduca por tiempo.
    assert.equal(summary.live?.gameId, gameId);
  });

  it('un juego del Plan no aporta horas por ninguna de las dos puertas', async () => {
    // ARREGLADO: buildLibraryData filtraba `planned = false` para la LISTA de
    // juegos, pero las consultas de sesiones e iteraciones no llevaban ese
    // filtro y devolvían las de TODAS. Así que `totalHours` (que recorre
    // `games`) las descartaba y `hoursThisYear` (que recorre `sessions`) las
    // contaba: dos cifras de horas hablando de dos poblaciones distintas en la
    // misma pantalla, y un planeado con una sesión de 3 h daba totalGames 0,
    // totalHours 0 y hoursThisYear 3.
    //
    // Que un planeado TENGA sesiones no es un dato imposible: el Plan y la
    // biblioteca son la misma tabla con un flag, así que devolver al Plan un
    // juego ya jugado deja sus sesiones y sus horas manuales donde estaban.
    // Ahora las tres consultas de library.ts hablan de la misma población.
    const planned = await makeGame(db, { title: 'Planeado', planned: true });
    await makeSession(
      db,
      await makeIteration(db, planned, { manualTotalPlayed: 5 }),
      midYear(THIS_YEAR),
      3,
    );

    const summary = await getStatsSummary(db);
    assert.equal(summary.totalGames, 0, 'el planeado no está en la biblioteca');
    assert.equal(summary.totalHours, 0, 'ni en el total de horas');
    assert.equal(summary.hoursThisYear, 0, 'ni en las horas de este año');
    // Ni sus horas MANUALES, que entraban por la otra puerta (manualByGame) y
    // habrían sumado 5 h aquí y en el recuento de juegos del año.
    assert.equal(summary.gamesThisYear, 0);
    assert.equal(summary.totalSessions, 0);
  });

  it('y el juego de al lado, que no es del Plan, sigue aportando las suyas', async () => {
    // El borde contrario del filtro anterior: la guarda tenía que quitar los
    // planeados, no las sesiones. Con las dos poblaciones ya alineadas, un
    // planeado y un juego normal conviviendo en la misma base tienen que dar
    // exactamente las horas del normal por las DOS puertas.
    const planned = await makeGame(db, { title: 'Planeado', planned: true });
    await makeSession(db, await makeIteration(db, planned), midYear(THIS_YEAR), 3);
    const real = await makeGame(db, { title: 'Jugado de verdad' });
    await makeSession(db, await makeIteration(db, real), midYear(THIS_YEAR), 2);

    const summary = await getStatsSummary(db);
    assert.equal(summary.totalGames, 1);
    assert.equal(summary.totalHours, 2);
    // Las 5 h manuales del planeado se anclan al arranque de su sesión, o sea a
    // ESTE año: si el filtro se cayera, esta cifra sería 10 y no 2.
    assert.equal(summary.hoursThisYear, 2);
    assert.equal(summary.gamesThisYear, 1);
    assert.equal(summary.totalSessions, 1);
  });

  it('el alta de un juego no se disfraza de "última vez que lo jugué"', async () => {
    // Dar de alta un juego con estado escribe su evento en la MISMA transacción
    // que la fila del juego, así que ese evento no dice cuándo lo jugaste sino
    // cuándo lo metiste. Medido en la base real: 6 juegos de 331, y los seis
    // salían arriba del todo en "los últimos que jugué".
    //
    // El margen es de 5 s y aquí se prueban sus dos lados, que es donde un
    // refactor que cambie `<` por `<=` (o el número) da la cara.
    const addedAt = new Date('2026-02-01T10:00:00Z');
    const artifact = await makeGame(db, { title: 'Alta', addedAt });
    await makeStateEvent(
      db,
      await makeIteration(db, artifact),
      'completed',
      new Date(addedAt.getTime() + 4_999).toISOString(),
    );

    const real = await makeGame(db, { title: 'Beaten de verdad', addedAt });
    await makeStateEvent(
      db,
      await makeIteration(db, real),
      'completed',
      new Date(addedAt.getTime() + 5_000).toISOString(),
    );

    const library = await listLibrary(db);
    const byTitle = new Map(library.map((game) => [game.title, game]));
    assert.equal(byTitle.get('Alta')?.lastPlayedAt, null);
    assert.equal(byTitle.get('Beaten de verdad')?.lastPlayedAt, addedAt.getTime() + 5_000);
  });
});

// ══ LA AGRUPACIÓN DE SESIONES ══════════════════════════════════════════════

describe('la página de sesiones (listSessions)', () => {
  it('la más reciente primero, y el id desempata para que ninguna fila salga en dos páginas', async () => {
    // Dos sesiones que arrancan en el mismo milisegundo tendrían orden
    // indefinido, y con paginación eso significa que una fila puede salir en
    // dos páginas y otra en ninguna. El desempate por id lo cierra: la unión de
    // las dos páginas tiene que ser exactamente el conjunto entero.
    const gameId = await makeGame(db, { title: 'Celeste' });
    const iterationId = await makeIteration(db, gameId);
    const nueva = await makeSession(db, iterationId, '2026-03-10T20:00:00Z', 1);
    const empateA = await makeSession(db, iterationId, '2026-03-09T20:00:00Z', 1);
    const empateB = await makeSession(db, iterationId, '2026-03-09T20:00:00Z', 1);
    const vieja = await makeSession(db, iterationId, '2026-03-01T20:00:00Z', 1);

    const first = await listSessions(db, { limit: 2, offset: 0 });
    const second = await listSessions(db, { limit: 2, offset: 2 });
    const ids = [...first.sessions, ...second.sessions].map((session) => session.id);

    assert.deepEqual(ids, [nueva, empateB, empateA, vieja]);
    assert.equal(new Set(ids).size, 4, 'ninguna fila repetida entre páginas');
  });

  it('un limit que llega de fuera no puede convertir la pantalla del móvil en un volcado', async () => {
    // El límite viene de la query string. Se sanea en la consulta y no en el
    // router para que no haya forma de llamar a esto sin pasar por el tope.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-03-01T20:00:00Z', 1);

    assert.equal((await listSessions(db, { limit: 999_999 })).limit, 200);
    assert.equal((await listSessions(db, { limit: 0 })).limit, 1);
    assert.equal((await listSessions(db, { limit: -5 })).limit, 1);
    // Un limit fraccionario no se redondea hacia arriba: se trunca.
    assert.equal((await listSessions(db, { limit: 3.7 })).limit, 3);
    assert.equal((await listSessions(db, { offset: -10 })).offset, 0);
    // Y sin nada, el tamaño de página por defecto.
    assert.equal((await listSessions(db)).limit, 20);
  });

  it('el total cuenta la tabla entera, no la página', async () => {
    // Es lo que pinta "Page 2 of 7" sin traerse las siete.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    for (let day = 1; day <= 5; day++) {
      await makeSession(db, iterationId, `2026-03-0${day}T20:00:00Z`, 1);
    }

    const page = await listSessions(db, { limit: 2 });
    assert.equal(page.sessions.length, 2);
    assert.equal(page.total, 5);
  });

  it('filtrar por juego recorta la página Y el total', async () => {
    // Si el filtro se aplicara solo a las filas, el paginador prometería
    // páginas que no existen.
    const celeste = await makeGame(db, { title: 'Celeste' });
    const hollow = await makeGame(db, { title: 'Hollow Knight' });
    const celesteIteration = await makeIteration(db, celeste);
    await makeSession(db, celesteIteration, '2026-03-01T20:00:00Z', 1);
    await makeSession(db, celesteIteration, '2026-03-02T20:00:00Z', 1);
    await makeSession(db, await makeIteration(db, hollow), '2026-03-03T20:00:00Z', 1);

    const page = await listSessions(db, { gameId: celeste });
    assert.equal(page.total, 2);
    assert.deepEqual(new Set(page.sessions.map((session) => session.gameId)), new Set([celeste]));
  });

  it('una sesión de emulador sin playthrough no cuenta ni en la página ni en el total', async () => {
    // Una sesión de emulador sin asignar (iterationId null) vive en la bandeja
    // "Pending" y no pertenece todavía a ningún juego: el innerJoin la deja
    // fuera de las filas. Lo que este test blinda es que el CONTEO use el mismo
    // join — si alguien lo simplifica a un count(*) sobre `sessions`, la página
    // diría 1 y el total 2, y el paginador ofrecería una página vacía.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2026-03-01T20:00:00Z', 1);
    await makeSession(db, null, '2026-03-02T20:00:00Z', 1);

    const page = await listSessions(db);
    assert.equal(page.sessions.length, 1);
    assert.equal(page.total, 1);
  });

  it('una sesión en marcha sale en la lista sin fin ni duración', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeWatcherSession(db, iterationId, new Date('2026-03-01T20:00:00Z'));

    const [session] = (await listSessions(db)).sessions;
    assert.equal(session.endedAt, null);
    assert.equal(session.durationSec, null);
    // Las fechas viajan como epoch en milisegundos, no como Date ni como ISO.
    assert.equal(session.startedAt, T('2026-03-01T20:00:00Z'));
  });
});

// ══ EL CRONÓMETRO: ARRANCAR ════════════════════════════════════════════════

describe('el cronómetro exige un playthrough que se pueda seguir (REMOTO.md §7)', () => {
  const NOW = T('2026-01-10T18:00:00Z');

  it('un juego sin ningún playthrough manda al PC en vez de inventarse uno', async () => {
    // La rama que resolveIterationForPlay SÍ tiene y esta copia NO: crear un
    // playthrough. Es deliberado (§9) — el cronómetro no inventa playthroughs
    // desde el móvil.
    const gameId = await makeGame(db);
    await rejectsTimer(startTimer(db, gameId, NOW), /ábrelo en tu PC/);
  });

  it('un playthrough terminado no se reanuda desde el móvil', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-01-05T18:00:00Z');

    await rejectsTimer(startTimer(db, gameId, NOW), /ya está cerrado/);
    // Y no dejó nada a medias: ni sesión ni evento.
    assert.deepEqual(await eventTypesOf(db, iterationId), ['completed']);
    assert.equal((await db.select().from(sessionsTable)).length, 0);
  });

  it('un juego endless se reanuda aunque arrastre un completed: no hay otro que abrir', async () => {
    // En un juego sin final no hay playthroughs discretos, así que un
    // completed/dropped no lo cierra para siempre — el escritorio vuelve a su
    // contenedor único. Sin esta rama, el cronómetro le contestaba "empieza otro
    // desde tu PC" a un endless: doblemente falso, porque no hay otro y el PC
    // habría reanudado este.
    const gameId = await makeGame(db, { endless: true });
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'completed', '2026-01-05T18:00:00Z');

    const active = await startTimer(db, gameId, NOW);
    assert.equal(active.gameId, gameId);
    assert.deepEqual(await eventTypesOf(db, iterationId), ['completed', 'started']);
  });

  it('On Hold es una pausa, no un final: se reanuda y se deja su started', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'on_hold', '2026-01-05T18:00:00Z');

    await startTimer(db, gameId, NOW);
    assert.deepEqual(await eventTypesOf(db, iterationId), ['on_hold', 'started']);
  });

  it('un juego recién dado de alta arranca CON su started, para que las horas no caigan sobre un juego "sin jugar"', async () => {
    // El bug que puso esta rama aquí: como el estado se DERIVA del log de
    // eventos, un playthrough con CERO eventos acumulaba horas reales mientras
    // la biblioteca y las stats lo seguían contando como Unplayed. Cuatro horas
    // encima de un juego "sin jugar".
    const gameId = await makeGame(db, { title: 'Recién añadido' });
    const iterationId = await makeIteration(db, gameId);

    await startTimer(db, gameId, NOW);

    assert.deepEqual(await eventTypesOf(db, iterationId), ['started']);
    const [game] = await listLibrary(db);
    assert.equal(game.currentState, 'started');
    // Y el evento comparte instante exacto con el arranque de la sesión: esto
    // no es una fecha tecleada, es un botón pulsado.
    const [event] = await db.select().from(stateEventsTable);
    assert.equal(event.occurredAt.getTime(), NOW);
    assert.equal(event.datePrecision, 'datetime');
  });

  it('un playthrough ya activo no se lleva un segundo started', async () => {
    // Un 'started' por cada Start desde el móvil llenaría el Journey de hitos
    // que no ocurrieron.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-05T18:00:00Z');

    await startTimer(db, gameId, NOW);
    assert.deepEqual(await eventTypesOf(db, iterationId), ['started']);
  });

  it('la sesión cuelga del playthrough ACTIVO aunque no sea el último', async () => {
    // Quedarse siempre con la iteración de max(id) daba otra respuesta cuando la
    // activa no era la última — un rejugado abierto y luego un playthrough
    // viejo reabierto, por ejemplo.
    const gameId = await makeGame(db);
    const activa = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const ultima = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, activa, 'started', '2026-01-05T18:00:00Z');
    await makeStateEvent(db, ultima, 'completed', '2026-01-04T18:00:00Z');

    const active = await startTimer(db, gameId, NOW);
    const session = await readSession(db, active.sessionId);
    assert.equal(session.iterationId, activa);
    // Ya estaba activa: ni un evento más en ninguna de las dos.
    assert.deepEqual(await eventTypesOf(db, activa), ['started']);
    assert.deepEqual(await eventTypesOf(db, ultima), ['completed']);
  });

  it('un completed fechado en el futuro no bloquea el cronómetro de hoy', async () => {
    // Lo POSTERIOR al instante que se pregunta no existe todavía para esta
    // decisión. Un 'completed' fechado en el futuro —a mano, desde la ficha—
    // bloqueaba el cronómetro en la web mientras el PC seguía dejándote jugar.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeStateEvent(db, iterationId, 'started', '2026-01-05T18:00:00Z');
    await makeStateEvent(db, iterationId, 'completed', '2026-06-01T18:00:00Z');

    const active = await startTimer(db, gameId, NOW);
    assert.equal(active.gameId, gameId);
    // Y sigue viéndose como activo: el completed del futuro no era el estado.
    assert.deepEqual(await eventTypesOf(db, iterationId), ['started', 'completed']);
  });

  it('una sesión del watcher abierta bloquea, y lo dice señalando al PC', async () => {
    // Dos sesiones vivas del mismo juego serían horas contadas dos veces.
    const jugando = await makeGame(db, { title: 'Lo que corre en el PC' });
    await makeWatcherSession(db, await makeIteration(db, jugando), new Date(NOW - 30 * 60_000));

    const otro = await makeGame(db, { title: 'Lo que quiero cronometrar' });
    await makeIteration(db, otro);

    await rejectsTimer(startTimer(db, otro, NOW), /en marcha en tu PC/);
  });

  it('dos cronómetros a la vez, jamás', async () => {
    const primero = await makeGame(db, { title: 'Primero' });
    await makeIteration(db, primero);
    const segundo = await makeGame(db, { title: 'Segundo' });
    await makeIteration(db, segundo);

    await startTimer(db, primero, NOW);
    await rejectsTimer(startTimer(db, segundo, NOW + 60_000), /ya tienes un cronómetro en marcha/);
    assert.equal(await openSessionCount(db), 1);
  });

  it('un cronómetro rancio de anteayer no bloquea: se barre y el nuevo arranca', async () => {
    // Justo lo que hacía antes de que la guarda llamara primero a getActiveTimer:
    // un olvido del viernes, con el PC apagado el fin de semana, devolvía un 409
    // a cualquier Start del sábado.
    const olvidado = await makeGame(db, { title: 'El olvidado' });
    const olvidadoIteration = await makeIteration(db, olvidado);
    const ultimoLatido = new Date(NOW - 8 * HOUR_MS);
    const rancia = await makeTimerSession(
      db,
      olvidadoIteration,
      new Date(NOW - 9 * HOUR_MS),
      ultimoLatido,
    );

    const nuevo = await makeGame(db, { title: 'El de hoy' });
    await makeIteration(db, nuevo);

    const active = await startTimer(db, nuevo, NOW);
    assert.equal(active.gameId, nuevo);

    // La rancia se cerró DE VERDAD, en su último latido: una fila abierta para
    // siempre envenena a todo el que pregunte "¿está jugando?" por su cuenta.
    const cerrada = await readSession(db, rancia);
    assert.equal(cerrada.endedAt?.getTime(), ultimoLatido.getTime());
    assert.equal(cerrada.durationSec, 3600);
  });

  it('la sesión que abre el cronómetro es tiempo medido, no una sesión manual (§7.1)', async () => {
    // No confundir con las sesiones manuales del modelo v1 (isManual true,
    // precisión de mes/año), que quedan fuera de las gráficas de hábitos por
    // imprecisas. Esto es lo contrario: cuenta en el heatmap, las rachas y los
    // momentos igual que cualquier otra. Lo único distinto es quién apretó el
    // botón, y eso va en startedBy para que el watcher no la mate (§7.3).
    const gameId = await makeGame(db);
    await makeIteration(db, gameId);

    const active = await startTimer(db, gameId, NOW);
    const session = await readSession(db, active.sessionId);

    assert.equal(session.isManual, false);
    assert.equal(session.startedBy, 'timer');
    assert.equal(session.datePrecision, 'datetime');
    assert.equal(session.startedAt.getTime(), NOW);
    assert.equal(session.endedAt, null);
    assert.equal(session.durationSec, null);
    // El primer latido es el propio arranque: si el móvil se queda mudo desde el
    // minuto uno, el barrido tiene de dónde agarrarse para poner la hora de fin.
    assert.equal(session.lastHeartbeatAt?.getTime(), NOW);
  });
});

// ══ EL CRONÓMETRO: LA FRESCURA DEL §7.4 ════════════════════════════════════

describe('la frescura del cronómetro (§7.4)', () => {
  const START = T('2026-01-10T10:00:00Z');

  it('el umbral son SEIS horas exactas, y a las seis en punto ya está rancia', async () => {
    // ARREGLADO: el número estaba escrito DOS veces y con dos formas distintas
    // —`6 * 3_600_000` en el Worker y un `TIMER_STALE_HOURS = 6` privado en
    // ProcessWatcher— y esta prueba solo podía comprobar la del Worker: la del
    // watcher no se podía importar desde ningún sitio. O sea que bajarla a 3
    // dejaba la suite entera en verde y, a partir de ahí, el PC cerraba por
    // rancia una sesión que la web seguía pintando LIVE durante tres horas.
    //
    // Ahora las dos salen de src/shared/timerFreshness, que es lo que se fija
    // aquí: el valor y el lado del borde (`>=`, o sea que seis horas clavadas
    // ya son rancias). La divergencia ya no se puede escribir sin tocar esta
    // línea.
    assert.equal(TIMER_STALE_MS, 6 * HOUR_MS);

    // El predicado compartido, el mismo que corre en el watcher, en sus dos
    // bordes. El del Worker (getActiveTimer, aquí abajo) tiene que coincidir
    // con él porque es literalmente el mismo.
    const latiendo = { startedAt: new Date(START), lastHeartbeatAt: new Date(START) };
    assert.equal(isTimerStale(latiendo, START + TIMER_STALE_MS - 1), false);
    assert.equal(isTimerStale(latiendo, START + TIMER_STALE_MS), true);
    // Sin un solo latido, el arranque hace de vara: misma pareja en los dos lados.
    assert.equal(
      isTimerStale({ startedAt: new Date(START), lastHeartbeatAt: null }, START + TIMER_STALE_MS),
      true,
    );

    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const latido = new Date(START);
    const sessionId = await makeTimerSession(db, iterationId, new Date(START), latido);

    // Un minuto antes del umbral: sigue jugando.
    assert.notEqual(await getActiveTimer(db, START + TIMER_STALE_MS - 60_000), null);
    assert.equal((await readSession(db, sessionId)).endedAt, null);

    // A las seis en punto: abandonada, y se cierra en su último latido.
    assert.equal(await getActiveTimer(db, START + TIMER_STALE_MS), null);
    const cerrada = await readSession(db, sessionId);
    assert.equal(cerrada.endedAt?.getTime(), latido.getTime());
    assert.equal(cerrada.durationSec, 0);
  });

  it('sin un solo latido, el arranque hace de latido', async () => {
    // La pestaña murió en el primer minuto y nunca llegó a latir. Es lo mismo
    // que hace el watcher: endedAt = lastHeartbeatAt ?? startedAt.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeTimerSession(db, iterationId, new Date(START), null);

    assert.equal(await getActiveTimer(db, START + 7 * HOUR_MS), null);
    const cerrada = await readSession(db, sessionId);
    assert.equal(cerrada.endedAt?.getTime(), START);
    // Duración cero y no negativa ni inventada: no hubo tiempo que medir.
    assert.equal(cerrada.durationSec, 0);
  });

  it('la sesión fresca se devuelve con sus dos relojes, en epoch', async () => {
    const gameId = await makeGame(db, { title: 'Celeste', coverUrl: 'https://cdn/celeste.jpg' });
    const iterationId = await makeIteration(db, gameId);
    const latido = new Date(START + 30 * 60_000);
    const sessionId = await makeTimerSession(db, iterationId, new Date(START), latido);

    const active = await getActiveTimer(db, START + HOUR_MS);
    assert.deepEqual(active, {
      sessionId,
      gameId,
      gameTitle: 'Celeste',
      coverUrl: 'https://cdn/celeste.jpg',
      startedAt: START,
      lastHeartbeatAt: latido.getTime(),
    });
  });

  it('barrer no pisa la hora de fin que puso un "parar" que llegó antes (§7.5)', async () => {
    // El `endedAt IS NULL` del WHERE deja que el parar mande. Si el barrido
    // pudiera pisarlo, una sesión parada a las 23:00 se reescribiría con la hora
    // del último latido y el usuario perdería las horas que sí jugó.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeTimerSession(
      db,
      iterationId,
      new Date(START),
      new Date(START + 5 * 60_000),
    );

    const parada = START + 3 * HOUR_MS;
    await stopTimer(db, sessionId, parada);
    // Y horas después alguien abre la portada: el barrido ve la fila cerrada y
    // no la toca.
    assert.equal(await getActiveTimer(db, parada + 12 * HOUR_MS), null);

    const session = await readSession(db, sessionId);
    assert.equal(session.endedAt?.getTime(), parada);
    assert.equal(session.durationSec, 3 * 3600);
  });

  it('la biblioteca aplica la MISMA vara sin esperar al barrido', async () => {
    // isLive de /api/library no espera a que alguien pida /api/timer: aplica
    // TIMER_STALE_MS por su cuenta. Sin eso, abrir la portada pintaba LIVE un
    // cronómetro rancio si la carga llegaba antes que ese GET, o sea que lo que
    // veías dependía del orden en que la PWA lanzara sus peticiones.
    const rancio = await makeGame(db, { title: 'A rancio' });
    await makeTimerSession(
      db,
      await makeIteration(db, rancio),
      agoMs(11 * HOUR_MS),
      agoMs(10 * HOUR_MS),
    );

    const [game] = await listLibrary(db);
    assert.equal(game.isLive, false);
    assert.equal(game.liveSince, null);
    // Y sigue abierta en la base: la lista es una LECTURA, no barre.
    const [session] = await db.select().from(sessionsTable);
    assert.equal(session.endedAt, null);
  });

  it('un cronómetro que acaba de latir sí pinta LIVE', async () => {
    const gameId = await makeGame(db, { title: 'Fresco' });
    const startedAt = agoMs(45 * 60_000);
    await makeTimerSession(db, await makeIteration(db, gameId), startedAt, agoMs(60_000));

    const [game] = await listLibrary(db);
    assert.equal(game.isLive, true);
    assert.equal(game.liveSince, startedAt.getTime());
  });

  it('una sesión del watcher no caduca por tiempo: solo el PC sabe si el proceso vive', async () => {
    // Su regla no es un umbral sino "¿sigue vivo el proceso?", y su latido se
    // pausa cuando la pantalla se bloquea. Una que quede abierta por un corte de
    // luz sigue pintando LIVE hasta que el PC arranque y reconcilie — mismo
    // comportamiento que el escritorio.
    const gameId = await makeGame(db, { title: 'Watcher' });
    await makeTimerSession(db, await makeIteration(db, gameId), agoMs(30 * HOUR_MS), null);
    const conProceso = await makeGame(db, { title: 'Z con proceso' });
    await makeWatcherSession(db, await makeIteration(db, conProceso), agoMs(30 * HOUR_MS));

    const library = await listLibrary(db);
    const byTitle = new Map(library.map((game) => [game.title, game]));
    assert.equal(byTitle.get('Watcher')?.isLive, false);
    assert.equal(byTitle.get('Z con proceso')?.isLive, true);
  });

  it('la ficha y la lista contestan LO MISMO a "¿está jugando?"', async () => {
    // ARREGLADO: getGameDetail decidía isLive solo con `endedAt === null`, sin
    // la vara de frescura que sí aplican la lista y el barrido. O sea que hasta
    // que alguien pidiera /api/timer, dos pantallas de la misma app contestaban
    // distinto sobre el mismo cronómetro: la lista sin contador y la ficha con
    // uno corriendo desde hacía once horas.
    //
    // Ahora las dos llaman a isSessionLive (queries/timer.ts) y la respuesta no
    // depende de por dónde entres ni del orden en que la PWA lance sus
    // peticiones.
    const gameId = await makeGame(db, { title: 'Rancio' });
    await makeTimerSession(
      db,
      await makeIteration(db, gameId),
      agoMs(11 * HOUR_MS),
      agoMs(10 * HOUR_MS),
    );

    const [fromList] = await listLibrary(db);
    const detail = await getGameDetail(db, gameId);
    assert.equal(fromList.isLive, false, 'la lista aplica la frescura');
    assert.equal(detail?.isLive, false, 'y la ficha también');
    assert.equal(detail?.liveSince, null);
    // Y la ficha sigue sin barrer: es una LECTURA. La fila se queda abierta
    // hasta que pase el que sí cierra (/api/timer o el watcher).
    const [session] = await db.select().from(sessionsTable);
    assert.equal(session.endedAt, null);
  });

  it('un cronómetro fresco sí pinta LIVE en la ficha, y una del watcher también', async () => {
    // El borde contrario del arreglo anterior: la frescura tenía que apagar los
    // rancios, no los vivos. Y las del WATCHER no caducan por tiempo —su regla
    // es "¿sigue vivo el proceso?", que solo el PC puede contestar— así que una
    // de hace treinta horas sigue LIVE también en la ficha.
    const conCronometro = await makeGame(db, { title: 'Cronometro fresco' });
    const startedAt = agoMs(45 * 60_000);
    await makeTimerSession(db, await makeIteration(db, conCronometro), startedAt, agoMs(60_000));

    const conProceso = await makeGame(db, { title: 'Proceso viejo' });
    await makeWatcherSession(db, await makeIteration(db, conProceso), agoMs(30 * HOUR_MS));

    const fresco = await getGameDetail(db, conCronometro);
    assert.equal(fresco?.isLive, true);
    assert.equal(fresco?.liveSince, startedAt.getTime());
    assert.equal((await getGameDetail(db, conProceso))?.isLive, true);
  });
});

// ══ EL CRONÓMETRO: PARAR Y LATIR ═══════════════════════════════════════════

describe('parar el cronómetro (§7.5) y el latido', () => {
  const START = T('2026-01-10T20:00:00Z');

  const startedSession = async (): Promise<number> => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    return makeTimerSession(db, iterationId, new Date(START), new Date(START + 30 * 60_000));
  };

  it('el "parar" MANDA sobre el latido: cuenta hasta ahora, no hasta el último latido', async () => {
    // Los navegadores móviles suspenden las pestañas de fondo, así que es
    // probable que el latido lleve horas parado aunque siguieras jugando. Si el
    // fin fuera el último latido, parar a las 23:00 registraría media hora en
    // vez de tres.
    const sessionId = await startedSession();

    const { durationSec } = await stopTimer(db, sessionId, START + 3 * HOUR_MS);
    assert.equal(durationSec, 3 * 3600);

    const session = await readSession(db, sessionId);
    assert.equal(session.endedAt?.getTime(), START + 3 * HOUR_MS);
    assert.equal(session.durationSec, 3 * 3600);
  });

  it('parar dos veces no reabre nada ni recalcula la duración', async () => {
    // Y NO se afirma por qué estaba parada: aquí no hay forma de saber si la
    // paraste desde otra pestaña o si el escritorio la recogió por llevar horas
    // muda. Decir lo segundo cuando fue lo primero es inventarse una explicación
    // delante del usuario.
    const sessionId = await startedSession();
    await stopTimer(db, sessionId, START + 2 * HOUR_MS);

    await rejectsTimer(stopTimer(db, sessionId, START + 5 * HOUR_MS), /ya estaba parada/);

    const session = await readSession(db, sessionId);
    assert.equal(session.endedAt?.getTime(), START + 2 * HOUR_MS);
    assert.equal(session.durationSec, 2 * 3600);
  });

  it('el cronómetro no para una sesión que abrió el watcher', async () => {
    // Son la misma tabla: sin esta guarda, un sessionId cualquiera desde el
    // móvil cerraría la partida que está corriendo en el PC.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeWatcherSession(db, iterationId, new Date(START));

    await rejectsTimer(stopTimer(db, sessionId, START + HOUR_MS), /no la abrió el cronómetro/);
    assert.equal((await readSession(db, sessionId)).endedAt, null);
  });

  it('parar una sesión que no existe lo dice, no crea nada', async () => {
    await rejectsTimer(stopTimer(db, 9999, START), /no existe/);
    assert.equal((await db.select().from(sessionsTable)).length, 0);
  });

  it('un reloj que va hacia atrás no produce una duración negativa', async () => {
    // El móvil manda su instante y el Worker se lo cree. computeDurationSec es
    // la MISMA función que usa closeSession en el escritorio precisamente para
    // que una hora torcida dé 0 y no un número que envenene las stats.
    const sessionId = await startedSession();

    const { durationSec } = await stopTimer(db, sessionId, START - HOUR_MS);
    assert.equal(durationSec, 0);
    assert.equal((await readSession(db, sessionId)).durationSec, 0);
  });

  it('el latido no resucita una sesión ya parada', async () => {
    const sessionId = await startedSession();
    await stopTimer(db, sessionId, START + HOUR_MS);

    assert.equal(await beatTimer(db, sessionId, START + 2 * HOUR_MS), false);
    const session = await readSession(db, sessionId);
    assert.equal(session.endedAt?.getTime(), START + HOUR_MS);
    assert.equal(session.lastHeartbeatAt?.getTime(), START + 30 * 60_000);
  });

  it('el latido no toca una sesión del watcher', async () => {
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    const sessionId = await makeWatcherSession(db, iterationId, new Date(START));

    assert.equal(await beatTimer(db, sessionId, START + HOUR_MS), false);
    assert.equal((await readSession(db, sessionId)).lastHeartbeatAt?.getTime(), START);
  });

  it('un latido tardío no resucita la sesión: la cierra en su último latido', async () => {
    // ARREGLADO: beatTimer miraba solo `endedAt IS NULL` y `startedBy =
    // 'timer'`, sin la regla de frescura. Si la PWA volvía del limbo a las diez
    // horas y latía antes de que nadie pidiera /api/timer, la sesión se
    // declaraba fresca otra vez y esas diez horas de silencio acababan contadas
    // como jugadas: pararla ahí registraba 10 h en vez de los 30 min reales.
    //
    // Y no era el caso raro sino el normal: el §7.5 dice justo que los
    // navegadores móviles suspenden las pestañas de fondo. La tabla del §7.4 no
    // deja elegir — "latido rancio → abandonada: se cierra en el último
    // latido"— así que ese latido cierra igual que el barrido y contesta que
    // no, ya no está viva.
    const sessionId = await startedSession();
    const tarde = START + 10 * HOUR_MS;

    assert.equal(await beatTimer(db, sessionId, tarde), false);

    const cerrada = await readSession(db, sessionId);
    assert.equal(cerrada.endedAt?.getTime(), START + 30 * 60_000, 'cerrada en su último latido');
    assert.equal(cerrada.durationSec, 30 * 60, 'los 30 min que sí se jugaron');
    // El latido tardío tampoco se guarda: la sesión murió a las 20:30 y su
    // último latido es la hora de fin, no el momento en que la pestaña
    // despertó.
    assert.equal(cerrada.lastHeartbeatAt?.getTime(), START + 30 * 60_000);
    assert.equal(await getActiveTimer(db, tarde + 60_000), null);
    // Y ya no se puede parar a mano para colar las horas por la otra puerta.
    await rejectsTimer(stopTimer(db, sessionId, tarde), /ya estaba parada/);
  });

  it('un latido dentro del plazo sí mantiene viva la sesión', async () => {
    // El borde contrario: el umbral es generoso a propósito (§7.5) porque el
    // latido se para MIENTRAS SIGUES JUGANDO. Un silencio de cinco horas y
    // media no puede cerrar una tarde de consola.
    const sessionId = await startedSession();
    // El último latido es el de las 20:30, así que "casi seis horas después"
    // se mide desde ahí, no desde el arranque.
    const aTiempo = START + 30 * 60_000 + TIMER_STALE_MS - 60_000;

    assert.equal(await beatTimer(db, sessionId, aTiempo), true);

    const viva = await readSession(db, sessionId);
    assert.equal(viva.endedAt, null);
    assert.equal(viva.lastHeartbeatAt?.getTime(), aTiempo);
    // Y el latido corre la vara: seis horas más tarde sigue viva porque el
    // reloj se cuenta desde el último latido, no desde el arranque.
    assert.equal((await getActiveTimer(db, aTiempo + HOUR_MS))?.sessionId, sessionId);
  });

  it('el latido de una sesión que no existe no crea ni cierra nada', async () => {
    // La guarda nueva lee la fila antes de decidir. Sin ella —o con un `!`
    // mal puesto— un sessionId inventado podría acabar en el camino del cierre.
    assert.equal(await beatTimer(db, 9999, START), false);
    assert.equal((await db.select().from(sessionsTable)).length, 0);
  });
});

// ══ EL BUZÓN: PAYLOADS TORCIDOS ════════════════════════════════════════════

describe('parseEntry: el buzón con payloads torcidos', () => {
  // Lo que llega del navegador es texto sin ninguna garantía y de aquí sale
  // directo a una tabla que el ESCRITORIO va a leer y ejecutar. Si se cuela un
  // payload torcido, el fallo no ocurre aquí —donde se vería— sino dentro del
  // drenado, en la otra máquina, días después y sin nadie mirando. Por eso los
  // casos de este bloque son todos "basura entra, null sale".

  it('lo que no es un objeto no es una orden', () => {
    for (const raw of [null, undefined, 'add', 42, true, [], {}, { type: 'borrar_todo' }]) {
      assert.equal(parseEntry(raw), null, `debería rechazar ${JSON.stringify(raw)}`);
    }
  });

  it('un add trae UNA fuente del catálogo: ni las dos ni ninguna', () => {
    const base = { type: 'add', title: 'Celeste' };
    assert.equal(parseEntry({ ...base }), null, 'sin source');
    assert.equal(parseEntry({ ...base, source: null }), null);
    assert.equal(parseEntry({ ...base, source: {} }), null, 'source vacío');
    assert.equal(
      parseEntry({ ...base, source: { igdbId: 1, steamAppId: 2 } }),
      null,
      'las dos a la vez',
    );
    assert.deepEqual(parseEntry({ ...base, source: { igdbId: 7 } }), {
      type: 'add',
      source: { igdbId: 7 },
      title: 'Celeste',
      coverUrl: null,
      note: null,
    });
    assert.deepEqual(parseEntry({ ...base, source: { steamAppId: 504230 } }), {
      type: 'add',
      source: { steamAppId: 504230 },
      title: 'Celeste',
      coverUrl: null,
      note: null,
    });
  });

  it('los ids del catálogo son enteros positivos y nada más', () => {
    // Un 0, un -1 o un "7" de string acabarían en un WHERE del escritorio
    // buscando un juego que no existe, o peor, en un UNIQUE que revienta.
    for (const igdbId of [0, -1, 1.5, '7', null, NaN, Infinity]) {
      assert.equal(
        parseEntry({ type: 'add', source: { igdbId }, title: 'X' }),
        null,
        `debería rechazar igdbId ${String(igdbId)}`,
      );
    }
  });

  it('un add sin título no se encola: la PWA no tendría nada que pintar mientras espera', () => {
    const source = { igdbId: 7 };
    for (const title of ['', '   ', undefined, 42, null]) {
      assert.equal(
        parseEntry({ type: 'add', source, title }),
        null,
        `debería rechazar title ${JSON.stringify(title)}`,
      );
    }
  });

  it('los textos entran recortados: el buzón no es un sitio donde volcar un megabyte', () => {
    const entry = parseEntry({
      type: 'add',
      source: { igdbId: 7 },
      title: 'a'.repeat(400),
      coverUrl: 'b'.repeat(600),
      note: 'c'.repeat(700),
    });
    assert.ok(entry !== null && entry.type === 'add');
    assert.equal(entry.title.length, 300);
    assert.equal(entry.coverUrl?.length, 500);
    assert.equal(entry.note?.length, 500);
  });

  it('una nota en blanco es no-nota, y una portada que no es texto no es portada', () => {
    const base = { type: 'add', source: { igdbId: 7 }, title: 'Celeste' };
    const blanco = parseEntry({ ...base, note: '   ', coverUrl: 42 });
    assert.ok(blanco !== null && blanco.type === 'add');
    assert.equal(blanco.note, null);
    assert.equal(blanco.coverUrl, null);
  });

  it('del payload solo sobrevive lo que el escritorio va a leer', () => {
    // El objeto se RECONSTRUYE campo a campo en vez de pasarse tal cual, así que
    // un payload con extras no puede colar nada en la tabla. Este deepEqual es
    // el guardián: falla en cuanto aparezca una clave de más.
    const entry = parseEntry({
      type: 'add',
      source: { igdbId: 7, steamAppId: null, extra: 'ignórame' },
      title: 'Celeste',
      coverUrl: 'https://cdn/celeste.jpg',
      note: 'para el finde',
      processedAt: 12345,
      error: 'inyectado',
    });
    assert.deepEqual(entry, {
      type: 'add',
      source: { igdbId: 7 },
      title: 'Celeste',
      coverUrl: 'https://cdn/celeste.jpg',
      note: 'para el finde',
    });
  });

  it('se encola lo mismo que se juzga: el título y la nota entran recortados', () => {
    // ARREGLADO: el `trim()` decidía si el título estaba vacío y luego se
    // guardaba el original, así que ' Celeste ' viajaba a la tabla con sus dos
    // espacios — lo que se encolaba no era lo que el código aparentaba
    // encolar. Inofensivo hoy (el título de verdad lo resuelve IGDB al drenar),
    // pero el día que ese texto se use para casar contra algo el fallo aparece
    // en la otra máquina y días después.
    const entry = parseEntry({
      type: 'add',
      source: { igdbId: 7 },
      title: ' Celeste ',
      note: '  para el finde \n',
    });
    assert.ok(entry !== null && entry.type === 'add');
    assert.equal(entry.title, 'Celeste');
    assert.equal(entry.note, 'para el finde');
  });

  it('el recorte a 300 se mide DESPUÉS de quitar los espacios', () => {
    // El orden importa: cortando primero, un título con espacios delante
    // gastaba parte de sus 300 caracteres en nada y perdía letras del final.
    const entry = parseEntry({
      type: 'add',
      source: { igdbId: 7 },
      title: `   ${'a'.repeat(300)}   `,
    });
    assert.ok(entry !== null && entry.type === 'add');
    assert.equal(entry.title, 'a'.repeat(300));
  });

  it('pin exige un juego y un instante de verdad', () => {
    assert.deepEqual(parseEntry({ type: 'pin', gameId: 3, pinnedAt: T('2026-01-10T18:00:00Z') }), {
      type: 'pin',
      gameId: 3,
      pinnedAt: T('2026-01-10T18:00:00Z'),
    });
    for (const pinnedAt of [0, -1, NaN, Infinity, '123', null, undefined]) {
      assert.equal(
        parseEntry({ type: 'pin', gameId: 3, pinnedAt }),
        null,
        `debería rechazar pinnedAt ${String(pinnedAt)}`,
      );
    }
    assert.equal(parseEntry({ type: 'pin', gameId: 0, pinnedAt: 1 }), null);
  });

  it('unpin solo necesita el juego', () => {
    assert.deepEqual(parseEntry({ type: 'unpin', gameId: 3 }), { type: 'unpin', gameId: 3 });
    assert.equal(parseEntry({ type: 'unpin', gameId: '3' }), null);
    assert.equal(parseEntry({ type: 'unpin' }), null);
  });

  it('un reorden de menos de dos no es un reorden', () => {
    // Reordenar uno solo no cambia nada, y drenarlo repartiría marcas de tiempo
    // sin motivo.
    assert.equal(parseEntry({ type: 'reorder', orderedIds: [] }), null);
    assert.equal(parseEntry({ type: 'reorder', orderedIds: [5] }), null);
    assert.equal(parseEntry({ type: 'reorder', orderedIds: 'no soy un array' }), null);
    assert.deepEqual(parseEntry({ type: 'reorder', orderedIds: [5, 3] }), {
      type: 'reorder',
      orderedIds: [5, 3],
    });
  });

  it('un reorden de cientos no es un gesto de usuario, es alguien probando qué aguanta', () => {
    const ids = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);
    assert.notEqual(parseEntry({ type: 'reorder', orderedIds: ids(200) }), null, '200 pasa');
    assert.equal(parseEntry({ type: 'reorder', orderedIds: ids(201) }), null, '201 no');
  });

  it('un id repetido o torcido tumba el reorden entero', () => {
    // Un duplicado dejaría el reparto de marcas sin sentido, y medio reorden
    // aplicado es un orden que nadie pidió.
    assert.equal(parseEntry({ type: 'reorder', orderedIds: [5, 3, 5] }), null);
    assert.equal(parseEntry({ type: 'reorder', orderedIds: [5, '3'] }), null);
    assert.equal(parseEntry({ type: 'reorder', orderedIds: [5, 0] }), null);
    assert.equal(parseEntry({ type: 'reorder', orderedIds: [5, 3.5] }), null);
  });
});

// ══ EL BUZÓN: LO PENDIENTE Y LO QUE FALLÓ ══════════════════════════════════

describe('el buzón: pendientes, duplicados y fallos', () => {
  const add = (igdbId: number, title = 'Celeste'): PlanMailboxEntry => ({
    type: 'add',
    source: { igdbId },
    title,
    coverUrl: null,
    note: null,
  });

  it('un add encolado ya cuenta como duplicado antes de que el escritorio drene', async () => {
    // El fallo real: encolé Celeste desde el buscador, la orden viajó a Turso, y
    // como la guarda de duplicados solo miraba la tabla `games`, se pudo encolar
    // otra vez. La segunda reventó contra el UNIQUE al drenarse — en otra
    // máquina, más tarde y sin nadie delante.
    await enqueue(db, add(3001), 'test');
    const pending = await pendingAddKeys(db);
    assert.deepEqual([...pending.igdbIds], [3001]);
    assert.equal(pending.steamAppIds.size, 0);
  });

  it('lo ya drenado deja de contar como pendiente', async () => {
    await makeMailboxRow(db, add(3002), { processedAt: new Date('2026-01-11T09:00:00Z') });
    const pending = await pendingAddKeys(db);
    assert.equal(pending.igdbIds.size, 0);
    assert.deepEqual(await listPending(db), []);
  });

  it('lo pendiente sale en el orden en que se pidió', async () => {
    // La PWA lo pinta ENCIMA de lo que lee: si el orden bailara, el "Up next"
    // optimista enseñaría una cosa y el drenado aplicaría otra.
    const primero = await enqueue(db, add(1, 'Primero'), 'test');
    const segundo = await enqueue(db, { type: 'unpin', gameId: 9 }, 'test');
    const tercero = await enqueue(db, add(3, 'Tercero'), 'test');

    const pending = await listPending(db);
    assert.deepEqual(
      pending.map((row) => row.id),
      [primero.id, segundo.id, tercero.id],
    );
    // Y el payload vuelve como objeto, no como el texto JSON de la columna.
    assert.deepEqual(pending[1].entry, { type: 'unpin', gameId: 9 });
  });

  it('un fallo no se pierde detrás de un fin de semana de altas', async () => {
    // Cicatriz exacta: el filtro estaba DESPUÉS del limit, así que cogía las 20
    // últimas filas y solo entonces se quedaba con las que tenían error. El
    // drenado aplica hasta 25 por pasada, o sea que cualquier fallo salía de la
    // ventana al instante y desaparecía sin dejar rastro — justo lo que esta
    // función existe para evitar.
    const roto = await makeMailboxRow(db, add(4000, 'El que reventó'), {
      processedAt: new Date('2026-01-11T09:00:00Z'),
      error: 'UNIQUE constraint failed: games.igdbId',
    });
    for (let index = 0; index < 25; index++) {
      await makeMailboxRow(db, add(5000 + index), {
        processedAt: new Date('2026-01-12T09:00:00Z'),
      });
    }

    const failures = await listRecentFailures(db);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].id, roto);
    assert.match(failures[0].error, /UNIQUE constraint/);
  });

  it('descartar un fallo borra el aviso pero no resucita la orden', async () => {
    // Un aviso que no se puede quitar deja de ser un aviso y pasa a ser
    // decoración. Pero descartarlo no puede reencolar nada: processedAt sigue
    // puesto y la orden sigue sin aplicarse.
    const processedAt = new Date('2026-01-11T09:00:00Z');
    const id = await makeMailboxRow(db, add(6000), { processedAt, error: 'boom' });

    assert.equal(await dismissFailure(db, id), true);
    const [row] = await db.select().from(planMailboxTable).where(eq(planMailboxTable.id, id));
    assert.equal(row.error, null);
    assert.equal(row.processedAt?.getTime(), processedAt.getTime());
    assert.deepEqual(await listRecentFailures(db), []);
    // Y no reaparece como pendiente.
    assert.deepEqual(await listPending(db), []);
  });

  it('descartar no puede tocar una orden que todavía no se ha drenado', async () => {
    // El WHERE exige processedAt puesto. Sin eso, un dismiss desde el móvil
    // podría limpiar el error de una fila pendiente y confundir al drenado.
    const id = await makeMailboxRow(db, add(7000), { error: 'no debería estar aquí' });
    assert.equal(await dismissFailure(db, id), false);
    const [row] = await db.select().from(planMailboxTable).where(eq(planMailboxTable.id, id));
    assert.equal(row.error, 'no debería estar aquí');
  });
});

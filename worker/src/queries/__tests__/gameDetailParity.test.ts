import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from '../../../../src/main/db/schema';
import type { GameDetail } from '../../api-types';
import type { TenantDb } from '../../db';
import { getGameDetail } from '../game';

// LA FICHA DEL MÓVIL CONTRA LA DEL PC.
//
// getGameDetail es un PUERTO de src/main/db/queries/games/getGameById.ts: las
// mismas derivaciones escritas dos veces, sin más código compartido que los
// helpers de src/shared. Y las tres que este fichero fija ya habían divergido
// —el escritorio corrigió, el puerto se quedó con la versión vieja— así que la
// misma ficha del mismo juego contestaba distinto según la pantalla: repartía
// el gasto entre playthroughs de otra forma y fechaba el inicio en un instante
// que nadie midió. Los escenarios son los MISMOS que los de la regresión del
// escritorio (src/main/db/__tests__/getGameById.test.ts), con los mismos
// números, para que comparar los dos ficheros sea leerlos en paralelo.
//
// Vive aparte de workerQueries.test.ts porque lo que prueba no es una consulta
// más del Worker sino una PROMESA entre dos ficheros; el montaje de abajo es el
// de aquél —fichero temporal y las migraciones REALES del repo, sin dobles del
// ORM, porque lo que hay que blindar es "¿dice el MISMO número?"— reducido a lo
// que estos tres casos necesitan.

const HOUR_MS = 3_600_000;

const dirs: string[] = [];

// La carpeta de migraciones se resuelve desde ESTE fichero y no desde el cwd:
// lanzar el fichero suelto desde otra carpeta dejaría un `drizzle` relativo
// apuntando a la nada, y el fallo sería "no such table" en el primer test en
// vez de "no encuentro las migraciones". Con import.meta y no con __dirname
// porque worker/package.json declara `"type": "module"`.
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(HERE, '..', '..', '..', '..', 'drizzle');

// Cada test abre su conexión y CIERRA la anterior: dejando los clientes de
// libsql abiertos hasta el final, el proceso se cae al salir con una violación
// de acceso del binario nativo — con todos los tests en verde, que es el peor
// rojo posible.
let openClient: Client | null = null;

const freshDb = async (): Promise<TenantDb> => {
  openClient?.close();
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-ficha-test-'));
  dirs.push(dir);
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  openClient = client;
  const database = drizzle({ client });
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  return database as unknown as TenantDb;
};

after(() => {
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

// ── Fábricas ───────────────────────────────────────────────────────────────

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

// Una sesión CERRADA. `hours` calcula el fin y la duración a la vez para que no
// se puedan contradecir: un desfase entre endedAt y durationSec sería un dato
// imposible que ninguna parte de la app produce.
const makeSession = async (
  db: TenantDb,
  iterationId: number,
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

const makeSpend = async (
  db: TenantDb,
  gameId: number,
  occurredAt: string,
  amount: number,
  overrides: Partial<typeof spendEventsTable.$inferInsert> = {},
): Promise<number> => {
  const [row] = await db
    .insert(spendEventsTable)
    .values({
      gameId,
      type: 'purchase',
      amount,
      occurredAt: new Date(occurredAt),
      datePrecision: 'day',
      ...overrides,
    })
    .returning({ id: spendEventsTable.id });
  return row.id;
};

// La ficha no puede ser null en estos tests —el juego lo acaba de crear el
// propio test—, así que se afirma una vez aquí en vez de arrastrar un `?.` por
// cada aserción, que convertiría un null en "undefined === undefined" y dejaría
// pasar el fallo.
const detail = async (gameId: number): Promise<GameDetail> => {
  const game = await getGameDetail(db, gameId);
  assert.ok(game !== null, 'la ficha no debería ser null');
  return game;
};

const iso = (epochMs: number | null): string | null =>
  epochMs === null ? null : new Date(epochMs).toISOString();

// ══ EL REPARTO DEL GASTO ENTRE PLAYTHROUGHS ════════════════════════════════

describe('la ventana de gasto de la ficha del móvil', () => {
  it('se cierra con el completed, no con el plan_to_play del alta', async () => {
    // La divergencia que trajo este fichero: el puerto cerraba la ventana con
    // la ÚLTIMA FILA del log en vez de con latestRealStateEvent. Un juego
    // promovido desde el Plan conserva su 'plan_to_play' fechado el día del
    // alta, y como los eventos llegan ordenados por fecha ESA era la última
    // fila: tapaba el completed de 2023, terminalAt salía null y el DLC de
    // 2026 se le colgaba al Playthrough 1. El PC decía 60/25 y el móvil 85/0
    // para el mismo juego.
    const gameId = await makeGame(db, { title: 'Elden Ring' });
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2023-05-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2023-06-01T00:00:00Z');
    await makeStateEvent(db, first, 'plan_to_play', '2026-08-13T10:00:00Z');

    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-07-01T00:00:00Z');

    await makeSpend(db, gameId, '2023-04-20T00:00:00Z', 60); // la compra
    await makeSpend(db, gameId, '2026-07-05T00:00:00Z', 25); // el DLC, años después

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 60);
    assert.equal(game.iterations[1].spend, 25);
    assert.equal(game.totalSpend, 85);
    // Y el mismo 'plan_to_play' tampoco puede ser el estado que se pinta: el
    // Playthrough 1 sigue siendo Beaten y el juego, el estado del más reciente
    // de sus dos playthroughs.
    assert.equal(game.iterations[0].currentState, 'completed');
    assert.equal(iso(game.iterations[0].endedAt), '2023-06-01T00:00:00.000Z');
    assert.equal(game.currentState, 'started');
  });

  it('un gasto en el instante exacto del cierre se queda en el playthrough que cerraba', async () => {
    // Empatar no es raro, es lo normal: la fecha del completed y la del gasto
    // se teclean las dos con precisión de día (medianoche), así que comprar el
    // DLC el mismo día que te pasas el juego cae EXACTAMENTE aquí. Con el '<'
    // estricto que arrastraba el puerto, esos 20 euros se le colgaban al
    // Playthrough 2 —que ese día ni existía, arranca seis meses después— y el
    // panel del móvil pintaba "Free" en el playthrough que sí lo pagó.
    const gameId = await makeGame(db);
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2026-03-01T00:00:00Z', {
      datePrecision: 'day',
    });
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-09-01T00:00:00Z');

    await makeSpend(db, gameId, '2026-03-01T00:00:00Z', 20);

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 20);
    assert.equal(game.iterations[1].spend, 0);
    assert.equal(game.totalSpend, 20);
  });

  it('un milisegundo después del cierre ya es del siguiente playthrough', async () => {
    // El borde contrario del '<=', para que no se lea como "el primero se lo
    // queda todo": pasado el instante del cierre la ventana está cerrada de
    // verdad. Un milisegundo es el salto más pequeño que un Date de JS
    // distingue, así que esto fija el corte exacto.
    const gameId = await makeGame(db);
    const first = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    await makeStateEvent(db, first, 'started', '2026-01-01T00:00:00Z');
    await makeStateEvent(db, first, 'completed', '2026-03-01T00:00:00Z');
    const second = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    await makeStateEvent(db, second, 'started', '2026-09-01T00:00:00Z');

    await makeSpend(db, gameId, '2026-03-01T00:00:00.001Z', 20);

    const game = await detail(gameId);
    assert.equal(game.iterations[0].spend, 0);
    assert.equal(game.iterations[1].spend, 20);
  });
});

// ══ EL INICIO DERIVADO DEL PLAYTHROUGH ═════════════════════════════════════

describe('el inicio del playthrough en la ficha del móvil', () => {
  it('una sesión heredada con isManual NO arrastra el inicio ni lo marca como medido', async () => {
    // Una sesión manual es un bloque de horas TECLEADO (filas del modelo v1
    // que hoy ya nadie escribe, pero las bases viejas las tienen), no algo que
    // el watcher viera pasar. Sin el filtro, esa fila de 2020 se trataba como
    // una MEDICIÓN: el inicio saltaba a 2020 y startedBySession salía true, que
    // es el flag con el que el panel del móvil formatea la fecha con precisión
    // 'datetime' — enseñaba "Jan 1, 2020 - 00:00", un instante exacto que nadie
    // midió, mientras el PC enseñaba el 10 de enero de 2026 del evento.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2020-01-01T00:00:00Z', 30, { isManual: true });
    const startedId = await makeStateEvent(db, iterationId, 'started', '2026-01-10T00:00:00Z');

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2026-01-10T00:00:00.000Z');
    assert.equal(iteration.startedBySession, false);
    // La fecha sigue teniendo dueño editable: el evento, que es lo que el Edit
    // necesita para dejar corregirla.
    assert.equal(iteration.startEvent?.id, startedId);
    // Y las horas de esa fila NO se pierden: lo que se descarta es su fecha
    // como medición del arranque, no el tiempo que dice haber jugado.
    assert.equal(iteration.hours, 30);
  });

  it('una sesión MEDIDA anterior al evento sí manda sobre él', async () => {
    // El borde que la guarda podría haberse llevado por delante: el filtro
    // descarta las manuales, no todas las sesiones. Una medida que se adelanta
    // al 'started' tecleado sigue derivando el inicio, y con precisión de
    // instante porque eso sí lo midió alguien.
    const gameId = await makeGame(db);
    const iterationId = await makeIteration(db, gameId);
    await makeSession(db, iterationId, '2020-01-01T00:00:00Z', 30, { isManual: true });
    await makeSession(db, iterationId, '2025-12-20T18:30:00Z', 2);
    await makeStateEvent(db, iterationId, 'started', '2026-01-10T00:00:00Z');

    const [iteration] = (await detail(gameId)).iterations;
    assert.equal(iso(iteration.startedAt), '2025-12-20T18:30:00.000Z');
    assert.equal(iteration.startedBySession, true);
  });
});
